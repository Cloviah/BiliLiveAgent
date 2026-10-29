import fs from 'node:fs';
import path from 'node:path';

/**
 * 便携版本地存储：全部使用 JSON / JSONL 文件，放在应用数据目录旁，
 * 不引入原生模块，避免 Electron ABI 重建问题。
 */
export class Store {
  readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'events'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'personas'), { recursive: true });
  }

  private file(name: string): string {
    return path.join(this.dataDir, name);
  }

  readJson<T>(name: string, fallback: T): T {
    const file = this.file(name);
    try {
      if (!fs.existsSync(file)) return fallback;
      return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch {
      return fallback;
    }
  }

  writeJson<T>(name: string, value: T): void {
    const file = this.file(name);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }

  appendLine<T>(name: string, value: T): void {
    const file = this.file(name);
    try {
      fs.appendFileSync(file, `${JSON.stringify(value)}\n`, 'utf8');
    } catch {
      /* 写入失败不阻塞主流程 */
    }
  }

  readLines<T>(name: string, limit = 500): T[] {
    const file = this.file(name);
    try {
      if (!fs.existsSync(file)) return [];
      const text = fs.readFileSync(file, 'utf8').trim();
      if (!text) return [];
      const lines = text.split('\n').slice(-limit);
      const out: T[] = [];
      for (const line of lines) {
        try {
          out.push(JSON.parse(line) as T);
        } catch {
          /* 跳过损坏行 */
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  /** 按保留天数修剪 JSONL，只保留最近 keepFrom 之后的记录 */
  trimLines(name: string, keepFrom: number, tsField = 'ts'): number {
    const file = this.file(name);
    try {
      if (!fs.existsSync(file)) return 0;
      const text = fs.readFileSync(file, 'utf8').trim();
      if (!text) return 0;
      const kept: string[] = [];
      for (const line of text.split('\n')) {
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          const ts = Number(obj[tsField] ?? 0);
          if (ts >= keepFrom) kept.push(line);
        } catch {
          /* 丢弃损坏行 */
        }
      }
      fs.writeFileSync(file, kept.length ? `${kept.join('\n')}\n` : '', 'utf8');
      return kept.length;
    } catch {
      return 0;
    }
  }

  clearFile(name: string): void {
    fs.rmSync(this.file(name), { force: true });
  }
}
