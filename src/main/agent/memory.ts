import type { RoomMemory, UserMemory } from '../../shared/types';
import type { ConversationRepo } from '../store/conversation-repo';
import type { Guards } from './guards';
import type { Logger } from '../utils/logger';

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
}
