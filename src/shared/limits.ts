/** 平台限制、默认配额与常量 */

export const APP_NAME = 'BiliLiveAgent';

/** B 站直播弹幕单条长度上限（服务端按字符数截断/拒绝） */
export const DANMAKU_MAX_LENGTH = 20;

/** 每条弹幕允许的最小发送间隔（平台侧保护） */
export const MIN_PLATFORM_SEND_GAP_MS = 3_000;

/** 弹幕 WebSocket 心跳间隔 */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** 重连退避 */
export const RECONNECT_BASE_MS = 2_000;
export const RECONNECT_MAX_MS = 60_000;
export const RECONNECT_MAX_ATTEMPTS = 12;

/** 默认互动频率 */
export const DEFAULT_MIN_SEND_INTERVAL_MS = 60_000;
export const DEFAULT_MAX_SEND_PER_MINUTE = 2;
export const DEFAULT_MAX_SEND_PER_HOUR = 20;
export const DEFAULT_DECISION_INTERVAL_MS = 20_000;
export const DEFAULT_IDLE_PROACTIVE_MS = 300_000;

/** 事件缓冲与模型输入上限 */
export const EVENT_BUFFER_SIZE = 400;
export const DEFAULT_BATCH_MAX_EVENTS = 24;

/** 默认保留天数 */
export const DEFAULT_RETENTION = {
  eventsDays: 7,
  logsDays: 14,
  summaryDays: 90,
  memoryDays: 180,
};

/** 默认每日预算 */
export const DEFAULT_DAILY_MAX_REQUESTS = 600;
export const DEFAULT_DAILY_MAX_TOKENS = 600_000;

/** DeepSeek 官方端点与默认模型 */
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const DEEPSEEK_MODELS = ['deepseek-chat', 'deepseek-reasoner'];

/** 默认价格（元 / 百万 tokens，可在设置中调整） */
export const DEFAULT_PRICE_INPUT = 2;
export const DEFAULT_PRICE_OUTPUT = 8;

export const RATE_LIMIT_REASONS: Record<string, string> = {
  min_interval: '未达最短发言间隔',
  window_limit: '已触及时间窗口上限',
  silent_hours: '当前处于静默时段',
  budget: '今日预算已耗尽',
  readonly: '当前为只读模式',
  circuit_open: '熔断已触发，暂停发言',
  schedule: '当前不在计划运行时段',
  no_content: '没有可发送的内容',
};
