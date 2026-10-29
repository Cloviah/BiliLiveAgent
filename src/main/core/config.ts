import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../../shared/types';
import {
  DEFAULT_BATCH_MAX_EVENTS,
  DEFAULT_DAILY_MAX_REQUESTS,
  DEFAULT_DAILY_MAX_TOKENS,
  DEFAULT_DECISION_INTERVAL_MS,
  DEFAULT_IDLE_PROACTIVE_MS,
  DEFAULT_MAX_SEND_PER_HOUR,
  DEFAULT_MAX_SEND_PER_MINUTE,
  DEFAULT_MIN_SEND_INTERVAL_MS,
  DEFAULT_PRICE_INPUT,
  DEFAULT_PRICE_OUTPUT,
  DEFAULT_RETENTION,
  DEEPSEEK_BASE_URL,
} from '../../shared/limits';

export function defaultConfig(): AppConfig {
  return {
    room: { roomId: 0, autoFollowLive: true },
    runtime: { autoStart: false, restoreLastState: true, autoReconnect: true },
    schedule: { enabled: false, windows: [], outsideMode: 'readonly' },
    interaction: {
      decisionIntervalMs: DEFAULT_DECISION_INTERVAL_MS,
      minSendIntervalMs: DEFAULT_MIN_SEND_INTERVAL_MS,
      // 点名回复不受最短间隔、活跃度自适应与窗口上限约束，仅保留 5 秒防刷屏硬底线
      mentionMinIntervalMs: 0,
      maxSendPerMinute: DEFAULT_MAX_SEND_PER_MINUTE,
      maxSendPerHour: DEFAULT_MAX_SEND_PER_HOUR,
      adaptiveEnabled: true,
      adaptiveMinMs: 30_000,
      adaptiveMaxMs: 180_000,
      silentHours: [],
      keywords: [],
      mentionPriority: true,
      idleProactiveMs: DEFAULT_IDLE_PROACTIVE_MS,
      maxSegments: 3,
      segmentDelayMs: 4_000,
      agentNickname: '',
    },
    model: {
      baseUrl: DEEPSEEK_BASE_URL,
      model: 'deepseek-chat',
      temperature: 0.9,
      maxTokens: 400,
      batchMaxEvents: DEFAULT_BATCH_MAX_EVENTS,
      dailyMaxRequests: DEFAULT_DAILY_MAX_REQUESTS,
      dailyMaxTokens: DEFAULT_DAILY_MAX_TOKENS,
      priceInputPerMTokens: DEFAULT_PRICE_INPUT,
      priceOutputPerMTokens: DEFAULT_PRICE_OUTPUT,
    },
    plugins: {
      enabled: true,
      maxCallsPerDecision: 2,
      webSearch: {
        enabled: true,
        provider: 'bing',
        maxResults: 4,
        timeoutMs: 8_000,
        dailyMaxCalls: 60,
        cacheTtlMs: 10 * 60_000,
      },
    },
    safety: {
      blockedWords: [],
      blockedTopics: [],
      ignoredUids: [],
      maxConsecutiveFailures: 3,
      maxSendPerHourHard: 40,
    },
    retention: { ...DEFAULT_RETENTION },
    activePersonaId: 'builtin-neutral',
  };
}

/** 浅层合并，保证旧配置缺字段时能用默认值补齐 */
export function mergeConfig(base: AppConfig, patch: Partial<AppConfig>): AppConfig {
  const defaults = defaultConfig();
  return {
    room: { ...defaults.room, ...base.room, ...(patch.room ?? {}) },
    runtime: { ...defaults.runtime, ...base.runtime, ...(patch.runtime ?? {}) },
    schedule: {
      ...defaults.schedule,
      ...base.schedule,
      ...(patch.schedule ?? {}),
      windows: patch.schedule?.windows ?? base.schedule?.windows ?? defaults.schedule.windows,
    },
    interaction: { ...defaults.interaction, ...base.interaction, ...(patch.interaction ?? {}) },
    model: { ...defaults.model, ...base.model, ...(patch.model ?? {}) },
    plugins: { ...defaults.plugins, ...base.plugins, ...(patch.plugins ?? {}) },
    safety: { ...defaults.safety, ...base.safety, ...(patch.safety ?? {}) },
    retention: { ...defaults.retention, ...base.retention, ...(patch.retention ?? {}) },
    activePersonaId: patch.activePersonaId ?? base.activePersonaId ?? defaults.activePersonaId,
  };
}

export class ConfigStore {
  private readonly file: string;
  private data: AppConfig;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'config.json');
    this.data = defaultConfig();
    this.load();
  }

  load(): AppConfig {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<AppConfig>;
        this.data = mergeConfig(raw as AppConfig, {});
      }
    } catch {
      this.data = defaultConfig();
    }
    return this.data;
  }

  get(): AppConfig {
    return this.data;
  }

  save(patch: Partial<AppConfig>): AppConfig {
    this.data = mergeConfig(this.data, patch);
    this.flush();
    return this.data;
  }

  replace(next: AppConfig): AppConfig {
    this.data = next;
    this.flush();
    return this.data;
  }

  private flush(): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }
}
