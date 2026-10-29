import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, ipcMain, shell } from 'electron';
import { CH, PUSH } from '../shared/ipc-channels';
import type { AppConfig, DiagnosticsResult, LiveEvent, PersonaCard, SendRecord } from '../shared/types';
import type { ConfigStore } from './core/config';
import type { RuntimeState } from './core/runtime';
import type { SecretVault } from './core/secrets';
import type { Store } from './store/db';
import type { Logger } from './utils/logger';
import type { AccountManager } from './bili/auth';
import type { QrLogin } from './bili/qr-login';
import type { BrowserImport } from './bili/browser-import';
import type { RoomService } from './bili/room';
import type { DanmakuSender } from './bili/send';
import type { PersonaStore } from './agent/persona';
import type { MemoryManager } from './agent/memory';
import type { DeepSeekClient } from './agent/deepseek';
import type { Budget } from './core/budget';
import type { AgentEngine } from './core/orchestrator';
import type { ConversationRepo } from './store/conversation-repo';
import type { EventsRepo } from './store/events-repo';
import type { PluginRegistry } from './plugins/registry';

export interface AppContext {
  config: ConfigStore;
  runtime: RuntimeState;
  logger: Logger;
  vault: SecretVault;
  store: Store;
  accounts: AccountManager;
  qr: QrLogin;
  browserImport: BrowserImport;
  roomService: RoomService;
  sender: DanmakuSender;
  persona: PersonaStore;
  memory: MemoryManager;
  model: DeepSeekClient;
  budget: Budget;
  plugins: PluginRegistry;
  engine: AgentEngine;
  conversations: ConversationRepo;
  events: EventsRepo;
  dataDir: string;
  getWindow: () => BrowserWindow | undefined;
}

function push(channel: string, payload: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  });
}

/** 完整状态快照：主动拉取与主动推送必须同构，否则推送会覆盖掉 activePersona 等字段 */
function statusSnapshot(ctx: AppContext) {
  return {
    ...ctx.runtime.get(),
    activePersona: ctx.persona.get(ctx.config.get().activePersonaId) ?? ctx.persona.list()[0],
    activeAccount: ctx.accounts.active(),
    sendCountToday: ctx.conversations.recentSends(500).filter((r) => r.status === 'sent').length,
  };
}

export function registerIpc(ctx: AppContext): void {
  const { config, runtime, logger } = ctx;

  runtime.onChange(() => push(PUSH.status, statusSnapshot(ctx)));
  logger.onEntry((entry) => push(PUSH.logs, entry));

  ipcMain.handle(CH.configGet, () => config.get());
  ipcMain.handle(CH.configSave, (_e, patch: Partial<AppConfig>) => {
    const next = config.save(patch ?? {});
    ctx.engine.cleanup();
    return next;
  });

  ipcMain.handle(CH.secretSet, (_e, name: string, value: string) => ctx.vault.set(name, value));
  ipcMain.handle(CH.secretHas, (_e, name: string) => ctx.vault.has(name));

  ipcMain.handle(CH.accountList, () => ctx.accounts.list());
  ipcMain.handle(CH.accountQrStart, () => ctx.qr.start());
  ipcMain.handle(CH.accountQrPoll, async (_e, key: string) => {
    const state = await ctx.qr.poll(key);
    if (state.state === 'success') {
      ctx.accounts.save({ uid: state.uid, uname: state.uname, source: 'qrcode' }, state.cookie);
      ctx.accounts.activate(state.uid);
      ctx.qr.drop(key);
      push(PUSH.accounts, ctx.accounts.list());
    }
    return state;
  });
  ipcMain.handle(CH.accountBrowserImport, async () => {
    const found = await ctx.browserImport.scan();
    for (const item of found) {
      ctx.accounts.save({ uid: item.uid, uname: item.uname, source: 'browser' }, item.cookie);
    }
    push(PUSH.accounts, ctx.accounts.list());
    return ctx.accounts.list();
  });
  ipcMain.handle(CH.accountActivate, (_e, uid: number) => {
    const ok = ctx.accounts.activate(uid);
    push(PUSH.accounts, ctx.accounts.list());
    return ok;
  });
  ipcMain.handle(CH.accountRemove, (_e, uid: number) => {
    ctx.accounts.remove(uid);
    push(PUSH.accounts, ctx.accounts.list());
    return true;
  });
  ipcMain.handle(CH.accountVerify, (_e, uid?: number) => ctx.accounts.verify(uid));

  ipcMain.handle(CH.roomInfo, async (_e, roomId: number) => {
    const meta = await ctx.roomService.fetchMeta(roomId);
    meta.anchorName = await ctx.roomService.fetchAnchorName(meta.anchorUid);
    runtime.patch({ room: meta });
    return meta;
  });

  ipcMain.handle(CH.runtimeStatus, () => statusSnapshot(ctx));
  ipcMain.handle(CH.runtimeStart, async (_e, roomId?: number) => {
    const target = roomId ?? config.get().room.roomId;
    if (!target) return { ok: false, message: '请先填写直播间房号' };
    return ctx.engine.start(target);
  });
  ipcMain.handle(CH.runtimeStop, () => {
    ctx.engine.stop();
    return true;
  });
  ipcMain.handle(CH.runtimePause, () => {
    ctx.engine.pause();
    return true;
  });
  ipcMain.handle(CH.runtimeResume, () => {
    ctx.engine.resume();
    return true;
  });
  ipcMain.handle(CH.runtimeSetRoom, (_e, roomId: number) => {
    config.save({ room: { ...config.get().room, roomId } });
    runtime.patch({ roomId });
    return true;
  });

  ipcMain.handle(CH.eventsRecent, (_e, roomId: number, limit = 200) => ctx.events.recent(roomId, limit));
  ipcMain.handle(CH.sendRecent, (_e, limit = 100) => ctx.conversations.recentSends(limit));
  ipcMain.handle(CH.sendTest, (_e, text: string) => {
    ctx.engine.manualSend(text);
    return true;
  });

  ipcMain.handle(CH.personaList, () => ctx.persona.list());
  ipcMain.handle(CH.personaSave, (_e, card: PersonaCard) => ctx.persona.save(card));
  ipcMain.handle(CH.personaDelete, (_e, id: string) => {
    ctx.persona.delete(id);
    return ctx.persona.list();
  });
  ipcMain.handle(CH.personaActivate, (_e, id: string) => {
    config.save({ activePersonaId: id });
    return true;
  });
  ipcMain.handle(CH.personaImport, (_e, markdown: string) => ctx.persona.importMarkdown(markdown));
  ipcMain.handle(CH.personaExport, (_e, id: string) => ctx.persona.exportMarkdown(id));

  ipcMain.handle(CH.memoryList, (_e, keyword = '') => {
    const roomId = config.get().room.roomId;
    return {
      room: ctx.memory.room(roomId),
      users: keyword ? ctx.memory.searchUsers(keyword) : ctx.memory.listUsers(),
    };
  });
  ipcMain.handle(CH.memorySaveRoom, (_e, summary: string) => {
    ctx.memory.saveRoomSummary(config.get().room.roomId, summary);
    return true;
  });
  ipcMain.handle(CH.memorySaveUser, (_e, payload: { uid: number; uname: string; note: string }) => {
    ctx.memory.upsertUser(payload.uid, payload.uname, payload.note);
    return true;
  });
  ipcMain.handle(CH.memoryDeleteUser, (_e, uid: number) => {
    ctx.memory.deleteUser(uid);
    return true;
  });

  ipcMain.handle(CH.usageGet, () => ctx.budget.stats());
  ipcMain.handle(CH.logsGet, (_e, limit = 200) => logger.recent(limit));
  ipcMain.handle(CH.logsExport, () => {
    const file = path.join(ctx.dataDir, `logs-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(logger.recent(500), null, 2), 'utf8');
    shell.showItemInFolder(file);
    return file;
  });
  ipcMain.handle(CH.dataExport, () => {
    const bundle = {
      exportedAt: new Date().toISOString(),
      config: config.get(),
      personas: ctx.persona.list(),
      roomMemory: ctx.memory.room(config.get().room.roomId),
      userMemory: ctx.memory.listUsers(),
      usage: ctx.budget.stats(),
      accounts: ctx.accounts.list().map((a) => ({ uid: a.uid, uname: a.uname, source: a.source })),
    };
    const file = path.join(ctx.dataDir, `export-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(bundle, null, 2), 'utf8');
    shell.showItemInFolder(file);
    return file;
  });
  ipcMain.handle(CH.dataCleanup, () => {
    ctx.engine.cleanup();
    logger.cleanup(config.get().retention.logsDays);
    return true;
  });

  ipcMain.handle(CH.pluginSearchTest, async (_e, query: string) => {
    if (!query?.trim()) return { ok: false, message: '请输入搜索关键词' };
    return ctx.plugins.testSearch(query.trim());
  });
  ipcMain.handle(CH.pluginUsage, () => ({
    usedToday: ctx.plugins.usedTodayCount(),
    limit: config.get().plugins.webSearch.dailyMaxCalls,
  }));

  ipcMain.handle(CH.diagRun, async (_e, scope: string): Promise<DiagnosticsResult> => {
    if (scope === 'room') {
      const roomId = config.get().room.roomId;
      if (!roomId) return { ok: false, scope, message: '未设置房号' };
      try {
        const meta = await ctx.roomService.fetchMeta(roomId);
        return { ok: true, scope, message: `房间可访问：${meta.title || roomId}`, detail: `直播状态 ${meta.liveStatus}` };
      } catch (error) {
        return { ok: false, scope, message: String(error) };
      }
    }
    if (scope === 'model') {
      const cfg = config.get();
      const result = await ctx.model.test({
        baseUrl: cfg.model.baseUrl,
        model: cfg.model.model,
        temperature: cfg.model.temperature,
        maxTokens: 32,
      });
      return { ok: result.ok, scope, message: result.message };
    }
    if (scope === 'account') {
      const result = await ctx.accounts.verify();
      return { ok: result.ok, scope, message: result.message };
    }
    if (scope === 'secrets') {
      const check = ctx.vault.selfTest();
      return { ok: check.ok, scope, message: check.message };
    }
    return { ok: false, scope, message: '未知诊断项' };
  });

  ipcMain.handle(CH.openDataDir, () => {
    shell.openPath(ctx.dataDir);
    return ctx.dataDir;
  });
}

/** 供编排器回调使用：把事件、发送记录与统计推送到界面 */
export function createPushBridge(): {
  events: (events: LiveEvent[]) => void;
  send: (record: SendRecord) => void;
  stats: () => void;
} {
  return {
    events: (events) => push(PUSH.events, events),
    send: (record) => push(PUSH.send, record),
    stats: () => push(PUSH.stats, Date.now()),
  };
}
