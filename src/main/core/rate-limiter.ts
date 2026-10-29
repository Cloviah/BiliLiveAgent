import type { AppConfig } from '../../shared/types';
import { isSilentNow } from '../utils/time';

export type RateReason = 'min_interval' | 'window_limit' | 'silent_hours' | 'budget' | 'readonly' | 'circuit_open';

export interface RateDecision {
  allowed: boolean;
  reason?: RateReason;
  nextAllowedAt?: number;
}

export interface RateContext {
  readonly: boolean;
  budgetOk: boolean;
  circuitOpen: boolean;
  /** 本批事件里是否有点名/关键词命中（命中时使用更短的 mention 间隔） */
  priority?: 'normal' | 'high';
}

/**
 * 点名回复的防刷屏硬底线（毫秒，不可配置）：即使点名豁免一切限频，
 * 两次发送之间也至少隔这么久，避免连续点名导致刷屏或触发平台风控。
 */
const MENTION_HARD_GAP_MS = 5_000;

/**
 * 限频器：在模型之后、发送之前做最终裁决。
 * 模型只能"请求发言"，是否真的发出由这里决定，防止模型绕过频率限制。
 */
export class RateLimiter {
  private lastSentAt = 0;
  private recentMinute: number[] = [];
  private recentHour: number[] = [];

  constructor(private readonly getConfig: () => AppConfig) {}

  /** 活跃度自适应：弹幕越密，间隔越接近下限 */
  effectiveInterval(eventsPerMinute: number): number {
    const cfg = this.getConfig().interaction;
    if (!cfg.adaptiveEnabled) return cfg.minSendIntervalMs;
    const ratio = Math.min(1, Math.max(0, eventsPerMinute / 60));
    const span = Math.max(cfg.adaptiveMinMs, cfg.minSendIntervalMs);
    const high = Math.max(cfg.adaptiveMaxMs, span);
    return Math.round(high - (high - span) * ratio);
  }

  /**
   * 本批应使用的发言间隔。
   * 点名/关键词命中（high）：不受最短发言间隔、活跃度自适应与窗口上限约束，
   * 仅保留 MENTION_HARD_GAP_MS 防刷屏底线。
   */
  intervalFor(eventsPerMinute: number, priority?: 'normal' | 'high'): number {
    if (priority !== 'high') return this.effectiveInterval(eventsPerMinute);
    const mention = this.getConfig().interaction.mentionMinIntervalMs;
    return Math.max(MENTION_HARD_GAP_MS, Math.max(0, mention));
  }

  /** 距下次可发言还剩多少毫秒（0 = 现在就可以发）；用于决定是否值得调用模型 */
  cooldownRemaining(now: number, eventsPerMinute: number, priority?: 'normal' | 'high'): number {
    const interval = this.intervalFor(eventsPerMinute, priority);
    const nextAllowedAt = this.lastSentAt + interval;
    return nextAllowedAt > now ? nextAllowedAt - now : 0;
  }

  private prune(now: number): void {
    this.recentMinute = this.recentMinute.filter((t) => now - t < 60_000);
    this.recentHour = this.recentHour.filter((t) => now - t < 3_600_000);
  }

  evaluate(now: number, eventsPerMinute: number, segmentCount: number, ctx: RateContext): RateDecision {
    const cfg = this.getConfig().interaction;
    if (ctx.readonly) return { allowed: false, reason: 'readonly' };
    if (ctx.circuitOpen) return { allowed: false, reason: 'circuit_open' };
    if (!ctx.budgetOk) return { allowed: false, reason: 'budget' };
    if (isSilentNow(cfg.silentHours)) return { allowed: false, reason: 'silent_hours' };

    this.prune(now);
    const interval = this.intervalFor(eventsPerMinute, ctx.priority);
    const nextAllowedAt = this.lastSentAt + interval;
    if (interval > 0 && now < nextAllowedAt) {
      return { allowed: false, reason: 'min_interval', nextAllowedAt };
    }

    // 点名/关键词回复豁免窗口上限（用户可感知的"被叫到就该回应"）；
    // 每分钟/每小时上限只约束普通主动搭话
    if (ctx.priority !== 'high') {
      const afterMinute = this.recentMinute.length + segmentCount;
      const afterHour = this.recentHour.length + segmentCount;
      if (cfg.maxSendPerMinute > 0 && afterMinute > cfg.maxSendPerMinute) {
        return { allowed: false, reason: 'window_limit', nextAllowedAt: now + 60_000 };
      }
      if (cfg.maxSendPerHour > 0 && afterHour > cfg.maxSendPerHour) {
        return { allowed: false, reason: 'window_limit', nextAllowedAt: now + 600_000 };
      }
    }
    return { allowed: true };
  }

  commit(now: number, segmentCount: number): void {
    for (let i = 0; i < segmentCount; i += 1) {
      this.recentMinute.push(now);
      this.recentHour.push(now);
    }
    this.lastSentAt = now;
  }

  sentInLastHour(): number {
    this.prune(Date.now());
    return this.recentHour.length;
  }
}
