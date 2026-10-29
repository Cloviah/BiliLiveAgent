import type { AppConfig } from '../../shared/types';
import { isScheduledNow } from '../utils/time';

/**
 * 运行调度：计划时段、未开播低频等待与决策节奏。
 * 只负责"什么时候该跑"，不负责具体业务。
 */
export class Scheduler {
  constructor(private readonly getConfig: () => AppConfig) {}

  /** 当前是否应处于计划运行时段内 */
  inSchedule(): boolean {
    const cfg = this.getConfig();
    if (!cfg.schedule.enabled) return true;
    return isScheduledNow(cfg.schedule.windows);
  }

  /** 未开播时的低频轮询间隔 */
  waitPollIntervalMs(): number {
    const cfg = this.getConfig();
    return cfg.room.autoFollowLive ? 60_000 : 120_000;
  }

  decisionIntervalMs(): number {
    return this.getConfig().interaction.decisionIntervalMs;
  }

  idleThresholdMs(): number {
    return this.getConfig().interaction.idleProactiveMs;
  }
}
