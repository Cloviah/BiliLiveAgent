/** 时间计算：静默时段、计划时段、退避抖动 */

export function parseHm(hm: string): number {
  const [h, m] = hm.split(':');
  const hh = Number.parseInt(h ?? '0', 10);
  const mm = Number.parseInt(m ?? '0', 10);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return 0;
  return hh * 60 + mm;
}

export function nowHm(date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** 判断当前时间是否落在区间内，支持跨零点区间 */
export function inRange(start: string, end: string, date = new Date()): boolean {
  const s = parseHm(start);
  const e = parseHm(end);
  const cur = nowHm(date);
  if (s === e) return true;
  if (s < e) return cur >= s && cur < e;
  return cur >= s || cur < e;
}

export function isSilentNow(ranges: Array<{ start: string; end: string }>, date = new Date()): boolean {
  return ranges.some((r) => inRange(r.start, r.end, date));
}

export function isScheduledNow(
  windows: Array<{ days: number[]; start: string; end: string }>,
  date = new Date(),
): boolean {
  if (windows.length === 0) return true;
  const day = date.getDay();
  return windows.some((w) => (w.days.length === 0 || w.days.includes(day)) && inRange(w.start, w.end, date));
}

export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const raw = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(raw * 0.2 * Math.random());
  return raw + jitter;
}

export function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
