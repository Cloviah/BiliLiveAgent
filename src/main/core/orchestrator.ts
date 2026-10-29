import type { AppConfig, LiveEvent, PersonaCard, RoomMeta, SendRecord } from '../../shared/types';
import { EVENT_BUFFER_SIZE, RATE_LIMIT_REASONS } from '../../shared/limits';
import type { Logger } from '../utils/logger';
import { matchesAny } from '../utils/text';
import type { LiveClient } from '../bili/live-client';
import type { RoomService } from '../bili/room';
import { parseCommand } from '../bili/danmaku-parser';
import type { SendQueue } from '../bili/send';
import type { AccountManager } from '../bili/auth';
import type { EventsRepo } from '../store/events-repo';
import type { ConversationRepo } from '../store/conversation-repo';
import type { PersonaStore } from '../agent/persona';
import type { MemoryManager } from '../agent/memory';
import type { Guards } from '../agent/guards';
import type { ChatMessage, ChatResult, DeepSeekClient } from '../agent/deepseek';
import type { PluginRegistry } from '../plugins/registry';
import { parseDecision } from '../agent/decision';
import { buildCompressPrompt, buildSystemPrompt, buildUserPrompt, COMPRESS_SYSTEM_PROMPT } from '../agent/prompts';
import type { Budget } from './budget';
import type { RateLimiter } from './rate-limiter';
import type { Scheduler } from './scheduler';
import type { RuntimeState } from './runtime';
import type { ConfigStore } from './config';

export interface EngineHooks {
  onEvents: (events: LiveEvent[]) => void;
  onSend: (record: SendRecord) => void;
  onStats: () => void;
}

export class AgentEngine {
  private buffer: LiveEvent[] = [];
  private pending: LiveEvent[] = [];
  private lastEventAt = 0;
  private lastDecisionAt = 0;
  private timer?: NodeJS.Timeout;
  private waitTimer?: NodeJS.Timeout;
  private roomMeta?: RoomMeta;
  private roomId = 0;
  private paused = false;
  private cooldownTimer?: NodeJS.Timeout;
  private recentKeys = new Map<string, number>();
  private lastCompressAt = 0;

  constructor(
    private readonly config: ConfigStore,
    private readonly runtime: RuntimeState,
    private readonly logger: Logger,
    private readonly roomService: RoomService,
    private readonly liveClient: LiveClient,
    private readonly sendQueue: SendQueue,
    private readonly accounts: AccountManager,
    private readonly persona: PersonaStore,
    private readonly memory: MemoryManager,
    private readonly guards: Guards,
    private readonly model: DeepSeekClient,
    private readonly budget: Budget,
    private readonly limiter: RateLimiter,
    private readonly scheduler: Scheduler,
    private readonly plugins: PluginRegistry,
    private readonly events: EventsRepo,
    private readonly conversations: ConversationRepo,
    private readonly hooks: EngineHooks,
  ) {}

  private cfg(): AppConfig {
    return this.config.get();
  }

  eventsPerMinute(): number {
    const cutoff = Date.now() - 60_000;
    return this.buffer.filter((e) => e.ts >= cutoff).length;
  }

  async start(roomId: number): Promise<{ ok: boolean; message: string }> {
    this.roomId = roomId;
    this.paused = false;
    this.runtime.patch({ roomId, mode: 'running' });
    this.config.save({ room: { ...this.cfg().room, roomId } });
    this.logger.info('engine', `开始运行，房间 ${roomId}`);

    try {
      this.roomMeta = await this.roomService.fetchMeta(roomId);
      this.roomMeta.anchorName = await this.roomService.fetchAnchorName(this.roomMeta.anchorUid);
      this.runtime.patch({ room: this.roomMeta });
      this.memory.updateRoomMeta(roomId, { title: this.roomMeta.title, anchorName: this.roomMeta.anchorName });
    } catch (error) {
      this.logger.warn('engine', `房间信息获取失败：${String(error)}`);
    }

    if (this.roomMeta && this.roomMeta.liveStatus !== 1 && this.cfg().room.autoFollowLive) {
      this.enterWaiting();
      return { ok: true, message: '主播未开播，已进入等待，开播后自动连接' };
    }
    this.connect();
    this.startLoop();
    return { ok: true, message: '已开始监听直播间' };
  }

  private enterWaiting(): void {
    this.runtime.setMode('waiting');
    this.logger.info('engine', '等待开播中');
    this.waitTimer = setInterval(async () => {
      try {
        const meta = await this.roomService.fetchMeta(this.roomId);
        this.roomMeta = meta;
        this.runtime.patch({ room: meta });
        if (meta.liveStatus === 1) {
          clearInterval(this.waitTimer);
          this.waitTimer = undefined;
          if (this.runtime.get().mode !== 'stopped') {
            this.runtime.setMode('running');
            this.connect();
            this.startLoop();
          }
        }
      } catch {
        /* 轮询失败下次继续 */
      }
    }, this.scheduler.waitPollIntervalMs());
  }

  private connect(): void {
    if (this.cfg().runtime.autoReconnect === false) return;
    // 必须带登录 UID，uid=0 会被弹幕服务器立刻断开
    const uid = this.accounts.active()?.uid ?? 0;
    void this.liveClient.start(this.roomId, uid);
  }

  private startLoop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    this.cooldownTimer = undefined;
    this.timer = setInterval(() => {
      void this.decide(false);
      void this.maybeCompress();
    }, this.scheduler.decisionIntervalMs());
  }

  /**
   * 改由定时器在 delayMs 后触发一次决策，之后恢复常规周期。
   * 用于：冷却未结束时不调用模型，等可发言时刻再读弹幕思考。
   */
  private scheduleDecision(delayMs: number): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    const delay = Math.max(500, Math.min(Math.round(delayMs), 300_000));
    this.cooldownTimer = setTimeout(() => {
      this.cooldownTimer = undefined;
      if (this.runtime.get().mode === 'stopped') return;
      void this.decide(false);
      if (this.runtime.get().mode !== 'stopped') this.startLoop();
    }, delay);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.waitTimer) clearInterval(this.waitTimer);
    if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
    this.timer = undefined;
    this.waitTimer = undefined;
    this.cooldownTimer = undefined;
    this.liveClient.stop();
    this.runtime.patch({ mode: 'stopped', conn: 'disconnected' });
    this.logger.info('engine', '已停止');
  }

  pause(): void {
    this.paused = true;
    this.runtime.setMode('readonly');
    this.logger.info('engine', '已切换为只读暂停（继续读取，不再自动发送）');
  }

  resume(): void {
    this.paused = false;
    this.runtime.setMode('running');
    this.logger.info('engine', '已恢复自动互动');
  }

  /** 处理弹幕服务器下发的原始命令 */
  handleMessage(raw: { cmd?: string; info?: unknown[]; data?: Record<string, unknown> }): void {
    const event = parseCommand(raw, this.roomId);
    if (!event) return;
    const cfg = this.cfg();
    const nickname = cfg.interaction.agentNickname.trim();
    const keywords = cfg.interaction.keywords;
    const text = event.text ?? '';
    const mentioned = (nickname && text.includes(nickname)) || Boolean(raw.cmd === 'DANMU_MSG' && event.kind === 'danmaku' && nickname && text.startsWith(`@${nickname}`));
    const keywordHit = matchesAny(text, keywords);
    if (mentioned || keywordHit) {
      event.priority = 'high';
      event.triggered = true;
      if (mentioned) event.kind = 'mention';
    }
    if (cfg.safety.ignoredUids.includes(event.uid)) return;

    // 服务端偶发重复投递（重连窗口/批量包），同 UID+内容在短窗口内只收一次
    const dedupeKey = `${event.uid}|${event.text ?? ''}|${event.kind}`;
    const lastSeenAt = this.recentKeys.get(dedupeKey);
    if (lastSeenAt !== undefined && event.ts - lastSeenAt < 10_000) return;
    this.recentKeys.set(dedupeKey, event.ts);
    if (this.recentKeys.size > 600) {
      for (const [k, seenAt] of this.recentKeys) {
        if (event.ts - seenAt > 60_000) this.recentKeys.delete(k);
      }
    }

    const inspection = this.guards.inspectIncoming(event);
    if (inspection.injection) {
      event.text = '[已按可疑内容处理]';
    }

    this.buffer.push(event);
    if (this.buffer.length > EVENT_BUFFER_SIZE) this.buffer.shift();
    this.pending.push(event);
    this.lastEventAt = event.ts;
    this.events.append(event);
    this.memory.touchUser(event.uid, event.uname);
    this.runtime.patch({ eventsPerMinute: this.eventsPerMinute() });
    this.hooks.onEvents([event]);

    // 被点名/命中关键词：不受最短发言间隔限制，尽快进入一次决策
    if (event.priority === 'high') this.scheduleDecision(1_500);

    if (event.kind === 'live_status') {
      const status = Number(event.meta?.liveStatus ?? 0);
      if (status === 0 && this.cfg().room.autoFollowLive) this.enterWaiting();
    }
  }

  setPopularity(value: number): void {
    if (this.roomMeta) this.runtime.patch({ room: { ...this.roomMeta, popularity: value } });
  }

  setConn(state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected', detail?: string): void {
    this.runtime.patch({ conn: state, lastError: detail });
  }

  /** 一个决策周期：批量事件 → 模型 → 安全/限频 → 发送 → 记忆回流 */
  async decide(idle: boolean): Promise<void> {
    const cfg = this.cfg();
    const mode = this.runtime.get().mode;
    if (mode === 'stopped') return;
    if (!this.scheduler.inSchedule()) {
      if (cfg.schedule.outsideMode === 'stopped') {
        this.stop();
        return;
      }
      this.pause();
      return;
    }

    // 冷却未结束时直接跳过：不调用模型、不消耗 token，等可发言时刻再读弹幕思考
    const priority: 'normal' | 'high' = this.pending.some((e) => e.priority === 'high') ? 'high' : 'normal';
    const cooldown = this.limiter.cooldownRemaining(Date.now(), this.eventsPerMinute(), priority);
    if (cooldown > 0) {
      this.logger.debug('engine', `距可发言还有 ${Math.round(cooldown / 1000)} 秒，本轮不调用模型`);
      this.scheduleDecision(cooldown + 1_000);
      return;
    }

    const sinceIdle = Date.now() - this.lastEventAt;
    if (!idle && this.pending.length === 0) {
      if (sinceIdle > this.scheduler.idleThresholdMs() && Date.now() - this.lastDecisionAt > this.scheduler.idleThresholdMs()) {
        await this.runModel(true);
      }
      return;
    }
    if (idle) {
      await this.runModel(true);
      return;
    }
    await this.runModel(false);
  }

  /**
   * 调用模型；若模型发起工具调用（如联网搜索），执行插件后把结果回灌，
   * 再让模型给出最终决策。轮次受 maxCallsPerDecision 限制，防止无限循环烧 token。
   */
  private async runWithTools(systemPrompt: string, userPrompt: string, cfg: AppConfig): Promise<ChatResult> {
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
    const options = {
      baseUrl: cfg.model.baseUrl,
      model: cfg.model.model,
      temperature: cfg.model.temperature,
      maxTokens: cfg.model.maxTokens,
    };
    const tools = this.plugins.schemas();

    let result = await this.model.chat(messages, { ...options, tools });
    this.noteUsage(result);

    const maxRounds = this.plugins.maxCallsPerDecision();
    for (let round = 0; round < maxRounds && result.toolCalls?.length; round += 1) {
      const calls = result.toolCalls;
      messages.push({ role: 'assistant', content: result.content, tool_calls: calls });
      for (const call of calls) {
        const output = await this.plugins.invoke(call);
        messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: output });
      }
      result = await this.model.chat(messages, { ...options, tools: undefined });
      this.noteUsage(result);
      this.logger.info('engine', `工具调用第 ${round + 1} 轮完成（${calls.map((c) => c.name).join('、')}）`);
    }
    return result;
  }

  /** 按配置周期检查一次记忆整理（低频，不会每个决策周期都跑） */
  private async maybeCompress(): Promise<void> {
    const cfg = this.cfg();
    if (!cfg.memory?.autoCompress) return;
    const now = Date.now();
    if (now - this.lastCompressAt < cfg.memory.intervalMs) return;
    this.lastCompressAt = now;
    await this.compressNow(false);
  }

  /**
   * 整理记忆：压缩过长的房间摘要、归档长期不互动的观众记忆。
   * force = true 时忽略阈值与周期，立即整理（界面按钮用）。
   */
  async compressNow(force = true): Promise<{ compressed: boolean; archived: number }> {
    const cfg = this.cfg();
    const mem = cfg.memory;
    let compressed = false;

    if (this.roomId && (force || this.memory.needsCompress(this.roomId, mem.maxSummaryChars))) {
      // 预算耗尽时不做模型压缩，只做兜底裁剪，避免额外花钱
      if (!force && !this.budget.withinBudget()) {
        compressed = this.memory.trimRoomSummary(this.roomId, mem.maxSummaryChars);
      } else {
        compressed = await this.memory.compressRoom(this.roomId, mem.keepBullets, (summary, bullets) =>
          this.summarizeWithModel(summary, bullets),
        );
        if (!compressed) compressed = this.memory.trimRoomSummary(this.roomId, mem.maxSummaryChars);
      }
    }

    let archived = 0;
    if (force || mem.autoCompress) archived = this.memory.archiveStaleUsers(mem.staleUserDays);
    if (compressed || archived) this.hooks.onStats();
    return { compressed, archived };
  }

  /** 当前记忆规模，供界面显示 */
  memoryStats(): { summaryChars: number; userCount: number } {
    return this.memory.stats(this.roomId || this.cfg().room.roomId);
  }

  private async summarizeWithModel(summary: string, keepBullets: number): Promise<string> {
    const cfg = this.cfg();
    const result = await this.model.chat(
      [
        { role: 'system', content: COMPRESS_SYSTEM_PROMPT },
        { role: 'user', content: buildCompressPrompt(summary, keepBullets) },
      ],
      {
        baseUrl: cfg.model.baseUrl,
        model: cfg.model.model,
        temperature: 0.2,
        maxTokens: 400,
      },
    );
    this.noteUsage(result);
    return (result.content ?? '').trim();
  }

  private noteUsage(result: ChatResult): void {
    const cost = this.budget.note(result.promptTokens, result.completionTokens);
    this.logger.debug(
      'engine',
      `模型调用完成，tokens=${result.promptTokens}+${result.completionTokens}，成本≈${cost.toFixed(4)}元`,
    );
  }

  private async runModel(idleMode: boolean): Promise<void> {
    const cfg = this.cfg();
    const window = this.pending.slice(-cfg.model.batchMaxEvents);
    this.pending = [];
    // 普通消息按时间排列，点名/关键词消息挪到末尾（模型注意力最强处），
    // 避免冷却结束后被迫从最老的一条开始回应
    const batch = [...window.filter((e) => e.priority !== 'high'), ...window.filter((e) => e.priority === 'high')];
    this.lastDecisionAt = Date.now();

    if (!this.budget.withinBudget()) {
      this.runtime.setMode('budget_exhausted', '今日预算已耗尽');
      this.logger.warn('engine', '今日预算耗尽，切换为只读');
      return;
    }

    const personaCard: PersonaCard = this.persona.get(cfg.activePersonaId) ?? this.persona.list()[0];
    const recentSent = this.conversations.recentSends(12).map((r) => r.text);
    const systemPrompt = buildSystemPrompt({
      config: cfg,
      persona: personaCard,
      room: this.roomMeta,
      roomMemory: this.memory.room(this.roomId),
      users: this.memory.relevantUsers(this.roomId),
      events: batch,
      idle: idleMode,
      recentSent,
    });
    const userPrompt = buildUserPrompt({
      config: cfg,
      persona: personaCard,
      room: this.roomMeta,
      roomMemory: this.memory.room(this.roomId),
      users: this.memory.relevantUsers(this.roomId),
      events: batch,
      idle: idleMode,
      recentSent,
    });

    try {
      const result = await this.runWithTools(systemPrompt, userPrompt, cfg);
      this.hooks.onStats();

      const decision = parseDecision(result.content, cfg.interaction.maxSegments);
      if (!decision) {
        this.logger.warn('engine', '模型输出无法解析为结构化决策，本轮保持沉默');
        return;
      }

      this.applyMemoryUpdates(decision.memoryUpdates);

      if (!decision.shouldSpeak || decision.segments.length === 0) {
        this.logger.debug('engine', `本轮保持沉默：${decision.reason ?? '模型判断无需发言'}`);
        return;
      }

      const verdicts = decision.segments.map((text) => this.guards.filterOutgoing(text, recentSent));
      const blocked = verdicts.find((v) => !v.allowed);
      if (blocked) {
        this.conversations.appendSend({
          id: `${Date.now()}-blocked`,
          roomId: this.roomId,
          ts: Date.now(),
          text: decision.segments.join(' / '),
          reason: decision.reason ?? '',
          status: 'blocked',
          detail: blocked.reason,
        });
        this.hooks.onSend(this.conversations.recentSends(1)[0]);
        this.logger.warn('engine', `内容被拦截：${blocked.reason}`);
        return;
      }

      if (this.paused || this.runtime.get().mode === 'readonly') {
        this.conversations.appendSend({
          id: `${Date.now()}-readonly`,
          roomId: this.roomId,
          ts: Date.now(),
          text: decision.segments.join(' / '),
          reason: decision.reason ?? '',
          status: 'blocked',
          detail: '只读模式，未发送',
        });
        this.hooks.onSend(this.conversations.recentSends(1)[0]);
        return;
      }

      const rate = this.limiter.evaluate(
        Date.now(),
        this.eventsPerMinute(),
        verdicts.length,
        {
          readonly: this.paused,
          budgetOk: this.budget.withinBudget(),
          circuitOpen: this.sendQueue.isOpen(),
          priority: batch.some((e) => e.priority === 'high') ? 'high' : 'normal',
        },
      );
      if (!rate.allowed) {
        this.conversations.appendSend({
          id: `${Date.now()}-rate`,
          roomId: this.roomId,
          ts: Date.now(),
          text: decision.segments.join(' / '),
          reason: decision.reason ?? '',
          status: 'blocked',
          detail: RATE_LIMIT_REASONS[rate.reason ?? 'readonly'] ?? '未通过限频裁决',
        });
        this.hooks.onSend(this.conversations.recentSends(1)[0]);
        this.logger.info('engine', `限频拦截：${rate.reason}`);
        return;
      }

      if (!this.accounts.active()) {
        this.logger.warn('engine', '未登录 B 站账号，无法发送弹幕');
        this.runtime.setMode('error', '未登录 B 站账号');
        return;
      }

      this.limiter.commit(Date.now(), verdicts.length);
      verdicts.forEach((v, index) => {
        this.sendQueue.enqueue({
          roomId: this.roomId,
          text: v.text,
          reason: decision.reason ?? (idleMode ? '冷场主动发言' : '弹幕互动'),
          replyToUid: index === 0 ? decision.targetUid : undefined,
        });
      });
    } catch (error) {
      this.logger.error('engine', `决策失败：${String(error)}`);
      this.runtime.patch({ lastError: String(error) });
    }
  }

  private applyMemoryUpdates(updates?: {
    roomSummaryPatch?: string;
    userMemoryPatch?: Array<{ uid: number; note: string }>;
  }): void {
    if (!updates) return;
    if (updates.roomSummaryPatch) {
      this.memory.applyRoomPatch(this.roomId, updates.roomSummaryPatch, {
        title: this.roomMeta?.title,
        anchorName: this.roomMeta?.anchorName,
      });
    }
    (updates.userMemoryPatch ?? []).forEach((patch) => {
      const known = this.buffer.find((e) => e.uid === patch.uid);
      this.memory.upsertUser(patch.uid, known?.uname ?? String(patch.uid), patch.note);
    });
  }

  /** 手动试发（仅用于诊断，需用户在界面上确认） */
  manualSend(text: string): void {
    // 引擎尚未启动时回退到配置里的房号，避免把 roomid=0 发给平台
    const roomId = this.roomId || this.cfg().room.roomId;
    this.sendQueue.enqueue({ roomId, text, reason: '手动试发' });
  }

  notifyCircuitOpen(reason: string): void {
    this.runtime.patch({ mode: 'readonly', lastError: `熔断：${reason}` });
    this.logger.error('engine', `熔断触发：${reason}`);
  }

  cleanup(): void {
    const cfg = this.cfg();
    this.events.cleanup(this.roomId, cfg.retention.eventsDays);
    this.conversations.cleanup(cfg.retention.summaryDays);
    this.memory.prune(cfg.retention.memoryDays);
  }
}
