import type { LiveEvent } from '../../shared/types';
import { EVENT_BUFFER_SIZE } from '../../shared/limits';
import type { Store } from './db';

export class EventsRepo {
  constructor(private readonly store: Store) {}

  private fileOf(roomId: number): string {
    return `events/room-${roomId}.jsonl`;
  }

  append(event: LiveEvent): void {
    this.store.appendLine(this.fileOf(event.roomId), event);
  }

  recent(roomId: number, limit = 200): LiveEvent[] {
    return this.store.readLines<LiveEvent>(this.fileOf(roomId), limit);
  }

  /** 内存缓冲：只保留最近若干条，避免弹幕洪峰拖垮 UI */
  buffer(roomId: number): LiveEvent[] {
    return this.recent(roomId, EVENT_BUFFER_SIZE);
  }

  cleanup(roomId: number, retentionDays: number): number {
    return this.store.trimLines(this.fileOf(roomId), Date.now() - retentionDays * 86_400_000);
  }

  clear(roomId: number): void {
    this.store.clearFile(this.fileOf(roomId));
  }
}
