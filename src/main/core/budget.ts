import type { AppConfig, UsageStats } from '../../shared/types';
import type { UsageRepo } from '../store/usage-repo';

/** 每日预算与用量账本：超预算后自动切只读 */
export class Budget {
  constructor(
    private readonly usage: UsageRepo,
    private readonly getConfig: () => AppConfig,
  ) {}

  private cfg(): AppConfig['model'] {
    return this.getConfig().model;
  }

  withinBudget(): boolean {
    const cfg = this.cfg();
    if (cfg.dailyMaxRequests > 0 && this.usage.todayRequests() >= cfg.dailyMaxRequests) return false;
    if (cfg.dailyMaxTokens > 0 && this.usage.todayTokens() >= cfg.dailyMaxTokens) return false;
    return true;
  }

  costOf(promptTokens: number, completionTokens: number): number {
    const cfg = this.cfg();
    return (promptTokens / 1_000_000) * cfg.priceInputPerMTokens + (completionTokens / 1_000_000) * cfg.priceOutputPerMTokens;
  }

  note(promptTokens: number, completionTokens: number): number {
    const cost = this.costOf(promptTokens, completionTokens);
    this.usage.record(promptTokens, completionTokens, cost);
    return cost;
  }

  stats(): UsageStats {
    return this.usage.stats();
  }
}
