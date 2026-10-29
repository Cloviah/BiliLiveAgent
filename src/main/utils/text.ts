import { DANMAKU_MAX_LENGTH } from '../../shared/limits';

/** 文本清洗、长度计算与分段 */

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

export function sanitizeForPrompt(input: string, maxLen = 200): string {
  return input
    .replace(CONTROL_CHARS, ' ')
    .replace(/[`]{3}/g, "'''")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export function sanitizeDanmaku(input: string): string {
  return input.replace(CONTROL_CHARS, ' ').replace(/[\r\n]+/g, ' ').trim();
}

export function charLength(input: string): number {
  return Array.from(input).length;
}

/**
 * 按弹幕长度上限分段：优先按标点断句，其次硬切。
 * 返回的分段数不会超过 maxSegments，超出的内容会被丢弃。
 */
export function segmentText(input: string, maxLength = DANMAKU_MAX_LENGTH, maxSegments = 3): string[] {
  const text = sanitizeDanmaku(input);
  if (!text) return [];
  if (charLength(text) <= maxLength) return [text];

  const chars = Array.from(text);
  const segments: string[] = [];
  let start = 0;
  while (start < chars.length && segments.length < maxSegments) {
    let end = Math.min(chars.length, start + maxLength);
    if (end < chars.length) {
      const breakers = ['。', '！', '？', '，', '、', '；', '.', '!', '?', ',', ' '];
      for (let i = end - 1; i > start + Math.floor(maxLength / 2); i -= 1) {
        if (breakers.includes(chars[i])) {
          end = i + 1;
          break;
        }
      }
    }
    const piece = chars.slice(start, end).join('').trim();
    if (piece) segments.push(piece);
    start = end;
  }
  return segments;
}

export function truncate(input: string, max: number): string {
  const chars = Array.from(input);
  return chars.length <= max ? input : `${chars.slice(0, max).join('')}…`;
}

/**
 * 多行文本清洗：逐行净化并保留换行结构，用于人格卡等需要保持格式的长文本。
 * 总字符数受 maxChars 限制，行数受 maxLines 限制。
 */
export function sanitizeBlockForPrompt(input: string, maxChars = 2400, maxLines = 80): string {
  const lines = input
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(CONTROL_CHARS, ' ').replace(/[`]{3}/g, "'''").trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, maxLines);
  let used = 0;
  const out: string[] = [];
  for (const line of lines) {
    const piece = line.slice(0, 200);
    if (used + piece.length > maxChars) break;
    out.push(piece);
    used += piece.length + 1;
  }
  return out.join('\n');
}

export function matchesAny(text: string, words: string[]): boolean {
  if (!text || words.length === 0) return false;
  const lower = text.toLowerCase();
  return words.some((w) => w && lower.includes(w.toLowerCase()));
}

/** 归一化相似度，用于过滤与最近发言高度重复的内容 */
export function similarity(a: string, b: string): number {
  const setA = new Set(Array.from(a));
  const setB = new Set(Array.from(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let same = 0;
  setA.forEach((ch) => {
    if (setB.has(ch)) same += 1;
  });
  return same / Math.max(setA.size, setB.size);
}
