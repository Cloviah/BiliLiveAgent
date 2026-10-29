import type { UsageStats } from '../../shared/types';
import type { Store } from './db';
import { startOfToday } from '../utils/time';

interface DayUsage {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
}

interface UsageFile {
  days: Record<string, DayUsage>;
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
}

const EMPTY: UsageFile = { days: {}, totalRequests: 0, totalTokens: 0, totalCost: 0 };

function dayKey(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export class UsageRepo {
  constructor(private readonly store: Store) {}

  private read(): UsageFile {
    return this.store.readJson<UsageFile>('usage.json', { ...EMPTY, days: {} });
  }

  private write(data: UsageFile): void {
    this.store.writeJson('usage.json', data);
  }

  record(promptTokens: number, completionTokens: number, cost: number): void {
    const data = this.read();
    const key = dayKey();
    const day = data.days[key] ?? { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    day.requests += 1;
    day.promptTokens += promptTokens;
    day.completionTokens += completionTokens;
    day.cost += cost;
    data.days[key] = day;
    data.totalRequests += 1;
    data.totalTokens += promptTokens + completionTokens;
    data.totalCost += cost;
    this.write(data);
  }

  todayRequests(): number {
    return this.read().days[dayKey()]?.requests ?? 0;
  }

  todayTokens(): number {
    const day = this.read().days[dayKey()];
    return day ? day.promptTokens + day.completionTokens : 0;
  }

  stats(): UsageStats {
    const data = this.read();
    const day = data.days[dayKey()];
    const today = day ?? { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    return {
      todayRequests: today.requests,
      todayPromptTokens: today.promptTokens,
      todayCompletionTokens: today.completionTokens,
      todayCost: Number(today.cost.toFixed(4)),
      totalRequests: data.totalRequests,
      totalTokens: data.totalTokens,
      totalCost: Number(data.totalCost.toFixed(4)),
    };
  }

  /** 清理 N 天前的用量账本 */
  prune(retentionDays: number): void {
    const data = this.read();
    const cutoff = startOfToday() - retentionDays * 86_400_000;
    data.days = Object.fromEntries(
      Object.entries(data.days).filter(([key]) => new Date(`${key}T00:00:00`).getTime() >= cutoff),
    );
    this.write(data);
  }
}
