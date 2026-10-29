import fs from 'node:fs';
import path from 'node:path';
import type { LogEntry } from '../../shared/types';

const RING_SIZE = 500;
const SECRET_PATTERNS = [
  /(SESSDATA|bili_jct|DedeUserID|sid|ac_time_value|refresh_token|access_key)=[^;\s"']+/gi,
  /(sk-[A-Za-z0-9_-]{8,})/g,
  /(Bearer\s+)[A-Za-z0-9._-]{8,}/gi,
];

function redact(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, prefix) => `${prefix ?? ''}***`);
  }
  return out;
}

export class Logger {
  private ring: LogEntry[] = [];
  private readonly dir: string;
  private readonly listeners = new Set<(entry: LogEntry) => void>();

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'logs');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  onEntry(listener: (entry: LogEntry) => void): void {
    this.listeners.add(listener);
  }

  private write(level: LogEntry['level'], scope: string, message: string): void {
    const entry: LogEntry = { ts: Date.now(), level, scope, message: redact(message) };
    this.ring.push(entry);
    if (this.ring.length > RING_SIZE) this.ring.shift();
    this.listeners.forEach((fn) => fn(entry));
    if (level === 'debug') return;
    const line = JSON.stringify(entry);
    try {
      const file = path.join(this.dir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
      fs.appendFileSync(file, `${line}\n`, 'utf8');
    } catch {
      /* 日志写入失败不影响主流程 */
    }
  }

  debug(scope: string, message: string): void {
    this.write('debug', scope, message);
  }
  info(scope: string, message: string): void {
    this.write('info', scope, message);
  }
  warn(scope: string, message: string): void {
    this.write('warn', scope, message);
  }
  error(scope: string, message: string): void {
    this.write('error', scope, message);
  }

  recent(limit = 200): LogEntry[] {
    return this.ring.slice(-limit);
  }

  /** 按保留天数清理历史日志 */
  cleanup(retentionDays: number): void {
    const cutoff = Date.now() - retentionDays * 86_400_000;
    try {
      for (const file of fs.readdirSync(this.dir)) {
        const full = path.join(this.dir, file);
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) fs.rmSync(full, { force: true });
      }
    } catch {
      /* 忽略清理失败 */
    }
  }
}
