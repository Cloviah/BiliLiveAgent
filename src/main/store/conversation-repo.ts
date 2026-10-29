import type { RoomMemory, SendRecord, UserMemory } from '../../shared/types';
import type { Store } from './db';

interface MemoryFile {
  rooms: Record<string, RoomMemory>;
  users: Record<string, UserMemory>;
}

const EMPTY: MemoryFile = { rooms: {}, users: {} };

export class ConversationRepo {
  constructor(private readonly store: Store) {}

  private read(): MemoryFile {
    return this.store.readJson<MemoryFile>('memory.json', { ...EMPTY });
  }

  private write(data: MemoryFile): void {
    this.store.writeJson('memory.json', data);
  }

  getRoom(roomId: number): RoomMemory | undefined {
    return this.read().rooms[String(roomId)];
  }

  saveRoom(memory: RoomMemory): void {
    const data = this.read();
    data.rooms[String(memory.roomId)] = memory;
    this.write(data);
  }

  listRooms(): RoomMemory[] {
    return Object.values(this.read().rooms);
  }

  getUser(uid: number): UserMemory | undefined {
    return this.read().users[String(uid)];
  }

  saveUser(memory: UserMemory): void {
    const data = this.read();
    data.users[String(memory.uid)] = memory;
    this.write(data);
  }

  listUsers(): UserMemory[] {
    return Object.values(this.read().users);
  }

  deleteUser(uid: number): void {
    const data = this.read();
    delete data.users[String(uid)];
    this.write(data);
  }

  /** 按 UID、昵称或备注搜索 */
  searchUsers(keyword: string): UserMemory[] {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return this.listUsers();
    return this.listUsers().filter(
      (u) => u.uname.toLowerCase().includes(kw) || u.note.toLowerCase().includes(kw) || String(u.uid).includes(kw),
    );
  }

  appendSend(record: SendRecord): void {
    this.store.appendLine('send.jsonl', record);
  }

  recentSends(limit = 100): SendRecord[] {
    return this.store.readLines<SendRecord>('send.jsonl', limit).reverse();
  }

  cleanup(retentionDays: number): number {
    return this.store.trimLines('send.jsonl', Date.now() - retentionDays * 86_400_000);
  }

  /** 删除超过保留天数的用户记忆 */
  pruneUsers(retentionDays: number): number {
    const cutoff = Date.now() - retentionDays * 86_400_000;
    const data = this.read();
    const before = Object.keys(data.users).length;
    data.users = Object.fromEntries(Object.entries(data.users).filter(([, v]) => v.lastSeen >= cutoff));
    this.write(data);
    return before - Object.keys(data.users).length;
  }
}
