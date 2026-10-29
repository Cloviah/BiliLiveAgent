import type { RoomMemory, UserMemory } from '../../shared/types';
import type { ConversationRepo } from '../store/conversation-repo';
import type { Guards } from './guards';
import type { Logger } from '../utils/logger';

/** 摘要压缩函数：输入当前摘要与目标要点数，返回压缩后的摘要 */
export type Summarizer = (summary: string, keepBullets: number) => Promise<string>;

export class MemoryManager {
  constructor(
    private readonly repo: ConversationRepo,
    private readonly guards: Guards,
    private readonly logger: Logger,
  ) {}

  room(roomId: number): RoomMemory | undefined {
    return this.repo.getRoom(roomId);
  }

  /** 应用模型给出的房间摘要补丁（追加而非覆盖，便于人工修正） */
  applyRoomPatch(roomId: number, patch: string, meta?: { title?: string; anchorName?: string }): void {
    const safe = this.guards.filterSummary(patch, 400);
    if (!safe) return;
    const current = this.repo.getRoom(roomId);
    const merged = current?.summary
      ? `${current.summary}\n- ${safe}`.split('\n').slice(-12).join('\n')
      : `- ${safe}`;
    this.repo.saveRoom({
      roomId,
      title: meta?.title ?? current?.title ?? '',
      anchorName: meta?.anchorName ?? current?.anchorName ?? '',
      summary: merged,
      updatedAt: Date.now(),
    });
  }

  updateRoomMeta(roomId: number, meta: { title?: string; anchorName?: string }): void {
    const current = this.repo.getRoom(roomId);
    this.repo.saveRoom({
      roomId,
      title: meta.title ?? current?.title ?? '',
      anchorName: meta.anchorName ?? current?.anchorName ?? '',
      summary: current?.summary ?? '',
      updatedAt: current?.updatedAt ?? Date.now(),
    });
  }

  saveRoomSummary(roomId: number, summary: string): void {
    const current = this.repo.getRoom(roomId);
    this.repo.saveRoom({
      roomId,
      title: current?.title ?? '',
      anchorName: current?.anchorName ?? '',
      summary: this.guards.filterSummary(summary, 2000),
      updatedAt: Date.now(),
    });
  }

  /** 记录观众的公开互动信息（称呼、偏好等），不保存私密信息 */
  upsertUser(uid: number, uname: string, note: string): void {
    if (!uid) return;
    const safeNote = this.guards.filterSummary(note, 200);
    const current = this.repo.getUser(uid);
    const mergedNote = current?.note && safeNote ? `${current.note}；${safeNote}` : safeNote || current?.note || '';
    this.repo.saveUser({
      uid,
      uname: uname || current?.uname || '',
      note: mergedNote.slice(0, 400),
      lastSeen: Date.now(),
      updatedAt: Date.now(),
    });
  }

  touchUser(uid: number, uname: string): void {
    if (!uid) return;
    const current = this.repo.getUser(uid);
    this.repo.saveUser({
      uid,
      uname: uname || current?.uname || '',
      note: current?.note ?? '',
      lastSeen: Date.now(),
      updatedAt: current?.updatedAt ?? Date.now(),
    });
  }

  listUsers(): UserMemory[] {
    return this.repo.listUsers();
  }

  searchUsers(keyword: string): UserMemory[] {
    return this.repo.searchUsers(keyword);
  }

  deleteUser(uid: number): void {
    this.repo.deleteUser(uid);
    this.logger.info('memory', `已删除观众记忆 ${uid}`);
  }

  /** 供提示词使用的相关记忆：优先最近互动过的观众 */
  relevantUsers(roomId: number, limit = 12): UserMemory[] {
    void roomId;
    return this.repo
      .listUsers()
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, limit);
  }

  prune(retentionDays: number): number {
    return this.repo.pruneUsers(retentionDays);
  }

  /** 当前记忆规模，供界面展示与压缩判断 */
  stats(roomId: number): { summaryChars: number; userCount: number } {
    const room = this.repo.getRoom(roomId);
    return { summaryChars: room?.summary?.length ?? 0, userCount: this.repo.listUsers().length };
  }

  /** 房间摘要是否已超过阈值，需要压缩 */
  needsCompress(roomId: number, maxChars: number): boolean {
    if (maxChars <= 0) return false;
    return (this.repo.getRoom(roomId)?.summary?.length ?? 0) > maxChars;
  }

  /**
   * 把冗长的房间摘要压缩成少量要点。压缩失败时保留原文，绝不丢记忆。
   * 返回是否真的压缩成功。
   */
  async compressRoom(roomId: number, keepBullets: number, summarize: Summarizer): Promise<boolean> {
    const current = this.repo.getRoom(roomId);
    if (!current?.summary) return false;
    const before = current.summary.length;

    let compressed = '';
    try {
      compressed = (await summarize(current.summary, keepBullets)) ?? '';
    } catch (error) {
      this.logger.warn('memory', `房间摘要压缩失败，保留原文：${String(error)}`);
      return false;
    }

    const safe = this.guards.filterSummary(compressed, 2000);
    if (!safe) {
      this.logger.warn('memory', '压缩结果为空或触发安全过滤，保留原文');
      return false;
    }
    if (safe.length >= before) return false; // 没变小就没必要替换

    this.saveRoomSummary(roomId, safe);
    this.logger.info('memory', `房间摘要已压缩：${before} → ${safe.length} 字`);
    return true;
  }

  /** 归档长期没互动的观众记忆，避免越攒越多；days <= 0 表示不归档 */
  archiveStaleUsers(days: number): number {
    if (days <= 0) return 0;
    const deadline = Date.now() - days * 86_400_000;
    const stale = this.repo.listUsers().filter((u) => (u.lastSeen ?? 0) < deadline);
    stale.forEach((u) => this.repo.deleteUser(u.uid));
    if (stale.length) this.logger.info('memory', `已归档 ${stale.length} 条超过 ${days} 天未互动的观众记忆`);
    return stale.length;
  }

  /**
   * 兜底裁剪：即使模型不可用，也把摘要压到阈值内。
   * 注意：安全过滤会把换行压成空格，摘要通常是单行，所以必须同时支持按行与按句裁剪。
   */
  trimRoomSummary(roomId: number, maxChars: number): boolean {
    if (maxChars <= 0) return false;
    const current = this.repo.getRoom(roomId);
    const summary = current?.summary?.trim();
    if (!summary || summary.length <= maxChars) return false;

    const trimmed = this.cutSummary(summary, maxChars);
    if (!trimmed || trimmed.length >= summary.length) return false;
    this.saveRoomSummary(roomId, trimmed);
    this.logger.info('memory', `房间摘要已裁剪：${summary.length} → ${trimmed.length} 字`);
    return true;
  }

  /** 保留最近的内容：多行时按行保留，单行时从句号等边界处切断，避免留下半句话 */
  private cutSummary(summary: string, maxChars: number): string {
    const lines = summary.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      const kept: string[] = [];
      let size = 0;
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (kept.length && size + lines[i].length > maxChars) break;
        kept.unshift(lines[i]);
        size += lines[i].length + 1;
      }
      return kept.join('\n');
    }

    const tail = summary.slice(Math.max(0, summary.length - maxChars));
    const boundary = tail.search(/[。！？；;!?]/);
    return boundary >= 20 ? tail.slice(boundary + 1).trim() : tail.trim();
  }
}
