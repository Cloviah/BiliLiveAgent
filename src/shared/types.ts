/** 主进程与渲染进程共享的类型定义 */

export type RuntimeMode =
  | 'stopped'
  | 'running'
  | 'readonly'
  | 'waiting'
  | 'error'
  | 'budget_exhausted';

export type ConnState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export type EventKind =
  | 'danmaku'
  | 'mention'
  | 'superchat'
  | 'gift'
  | 'guard'
  | 'interact'
  | 'live_status';

export interface LiveEvent {
  id: string;
  roomId: number;
  ts: number;
  kind: EventKind;
  uid: number;
  uname: string;
  text?: string;
  priority: 'normal' | 'high';
  /** 命中点名/关键词时为 true，用于决策插队 */
  triggered?: boolean;
  meta?: Record<string, string | number>;
}

export interface SendRecord {
  id: string;
  roomId: number;
  ts: number;
  text: string;
  reason: string;
  status: 'sent' | 'blocked' | 'rejected' | 'failed';
  detail?: string;
  replyToUid?: number;
}

export interface AgentDecision {
  shouldSpeak: boolean;
  reason?: string;
  targetUid?: number;
  segments: string[];
  memoryUpdates?: {
    roomSummaryPatch?: string;
    userMemoryPatch?: Array<{ uid: number; note: string }>;
  };
}

export interface PersonaCard {
  id: string;
  name: string;
  summary: string;
  tone: string;
  boundaries: string;
  samples: string;
  aiIdentityRule: 'ask_then_disclose' | 'always_disclose';
  /** 完整 Markdown 角色卡内容（WeChatAgent 风格）；存在时优先于结构化字段生效 */
  content?: string;
  /** 分类标签，空表示未分类 */
  category?: string;
  builtin?: boolean;
  updatedAt: number;
}

export interface UserMemory {
  uid: number;
  uname: string;
  note: string;
  lastSeen: number;
  updatedAt: number;
}

export interface RoomMemory {
  roomId: number;
  title: string;
  anchorName: string;
  summary: string;
  updatedAt: number;
}

export interface BiliAccount {
  uid: number;
  uname: string;
  source: 'qrcode' | 'browser';
  isActive: boolean;
  addedAt: number;
  lastVerifiedAt?: number;
  expired?: boolean;
}

export interface RoomMeta {
  roomId: number;
  title: string;
  anchorUid: number;
  anchorName: string;
  areaName: string;
  parentAreaName: string;
  description: string;
  liveStatus: 0 | 1;
  popularity: number;
}

export interface UsageStats {
  todayRequests: number;
  todayPromptTokens: number;
  todayCompletionTokens: number;
  todayCost: number;
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  lastRequestAt?: number;
}

export interface ScheduleWindow {
  days: number[];
  start: string;
  end: string;
}

export interface TimeRange {
  start: string;
  end: string;
}

export interface AppConfig {
  room: {
    roomId: number;
    autoFollowLive: boolean;
  };
  runtime: {
    autoStart: boolean;
    restoreLastState: boolean;
    autoReconnect: boolean;
  };
  schedule: {
    enabled: boolean;
    windows: ScheduleWindow[];
    outsideMode: 'readonly' | 'stopped';
  };
  interaction: {
    decisionIntervalMs: number;
    minSendIntervalMs: number;
    /** 点名/关键词命中时的最短发言间隔（不受活跃度自适应拉长） */
    mentionMinIntervalMs: number;
    maxSendPerMinute: number;
    maxSendPerHour: number;
    adaptiveEnabled: boolean;
    adaptiveMinMs: number;
    adaptiveMaxMs: number;
    silentHours: TimeRange[];
    keywords: string[];
    mentionPriority: boolean;
    idleProactiveMs: number;
    maxSegments: number;
    segmentDelayMs: number;
    agentNickname: string;
  };
  model: {
    baseUrl: string;
    model: string;
    temperature: number;
    maxTokens: number;
    batchMaxEvents: number;
    dailyMaxRequests: number;
    dailyMaxTokens: number;
    priceInputPerMTokens: number;
    priceOutputPerMTokens: number;
  };
  plugins: {
    /** 插件总开关：关闭后模型不再看到任何工具 */
    enabled: boolean;
    /** 单次决策最多调用工具次数（防止无限循环烧 token） */
    maxCallsPerDecision: number;
    webSearch: {
      enabled: boolean;
      /** bing 为免密钥抓取通道；tavily/serper/bocha 需要填 API Key */
      provider: 'bing' | 'tavily' | 'serper' | 'bocha';
      maxResults: number;
      timeoutMs: number;
      /** 0 表示不限制 */
      dailyMaxCalls: number;
      /** 相同关键词的缓存有效期 */
      cacheTtlMs: number;
    };
  };
  safety: {
    blockedWords: string[];
    blockedTopics: string[];
    ignoredUids: number[];
    maxConsecutiveFailures: number;
    maxSendPerHourHard: number;
  };
  retention: {
    eventsDays: number;
    logsDays: number;
    summaryDays: number;
    memoryDays: number;
  };
  activePersonaId: string;
}

export interface RuntimeStatus {
  mode: RuntimeMode;
  conn: ConnState;
  roomId: number;
  room?: RoomMeta;
  activePersona?: PersonaCard;
  activeAccount?: BiliAccount;
  lastError?: string;
  eventsPerMinute: number;
  nextDecisionAt?: number;
  sendCountToday: number;
  updatedAt: number;
}

export interface LogEntry {
  ts: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  scope: string;
  message: string;
}

export interface DiagnosticsResult {
  ok: boolean;
  scope: string;
  message: string;
  detail?: string;
}

export interface QrLoginSession {
  key: string;
  url: string;
  image: string;
  expiresAt: number;
}
