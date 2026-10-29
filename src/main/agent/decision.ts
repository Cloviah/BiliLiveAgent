import type { AgentDecision } from '../../shared/types';
import { segmentText } from '../utils/text';
import { DANMAKU_MAX_LENGTH } from '../../shared/limits';

interface RawDecision {
  shouldSpeak?: unknown;
  reason?: unknown;
  targetUid?: unknown;
  text?: unknown;
  segments?: unknown;
  memoryUpdates?: unknown;
}

/**
 * 解析模型输出：只接受结构化 JSON，任何解析失败都视为“保持沉默”，
 * 避免把模型的闲聊内容直接发到直播间。
 */
export function parseDecision(raw: string, maxSegments: number): AgentDecision | null {
  const cleaned = raw
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  let parsed: RawDecision;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1)) as RawDecision;
  } catch {
    return null;
  }

  const shouldSpeak = parsed.shouldSpeak === true;
  const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 120) : undefined;
  const targetUid = Number.isFinite(Number(parsed.targetUid)) ? Number(parsed.targetUid) : undefined;

  let segments: string[] = [];
  if (Array.isArray(parsed.segments)) {
    segments = parsed.segments.filter((s): s is string => typeof s === 'string');
  } else if (typeof parsed.text === 'string') {
    segments = [parsed.text];
  }
  const flattened = segments
    .flatMap((s) => segmentText(s, DANMAKU_MAX_LENGTH, maxSegments))
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, maxSegments);

  const memory: AgentDecision['memoryUpdates'] = { userMemoryPatch: [] };
  const updates = parsed.memoryUpdates as
    | { roomSummaryPatch?: unknown; userMemoryPatch?: unknown }
    | undefined;
  if (updates && typeof updates === 'object') {
    if (typeof updates.roomSummaryPatch === 'string') {
      memory!.roomSummaryPatch = updates.roomSummaryPatch.slice(0, 400);
    }
    if (Array.isArray(updates.userMemoryPatch)) {
      const patch = updates.userMemoryPatch as Array<{ uid?: unknown; note?: unknown }>;
      memory!.userMemoryPatch = patch
        .filter((p) => Number.isFinite(Number(p.uid)) && typeof p.note === 'string')
        .map((p) => ({ uid: Number(p.uid), note: String(p.note).slice(0, 200) }))
        .slice(0, 8);
    }
  }

  return {
    shouldSpeak: shouldSpeak && flattened.length > 0,
    reason,
    targetUid,
    segments: flattened,
    memoryUpdates: memory,
  };
}
