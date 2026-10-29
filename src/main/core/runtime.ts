import type { RuntimeMode, RuntimeStatus } from '../../shared/types';
import type { ConnState } from '../../shared/types';

/** 单一运行状态源：UI、托盘与编排器都以此为准 */
export class RuntimeState {
  private state: RuntimeStatus;
  private readonly listeners = new Set<(status: RuntimeStatus) => void>();

  constructor(roomId = 0) {
    this.state = { mode: 'stopped', conn: 'disconnected', roomId, eventsPerMinute: 0, sendCountToday: 0, updatedAt: Date.now() };
  }

  get(): RuntimeStatus {
    return this.state;
  }

  patch(patch: Partial<RuntimeStatus>): RuntimeStatus {
    this.state = { ...this.state, ...patch, updatedAt: Date.now() };
    this.listeners.forEach((fn) => fn(this.state));
    return this.state;
  }

  setMode(mode: RuntimeMode, lastError?: string): RuntimeStatus {
    return this.patch({ mode, lastError });
  }

  setConn(conn: ConnState, lastError?: string): RuntimeStatus {
    return this.patch({ conn, lastError });
  }

  onChange(listener: (status: RuntimeStatus) => void): void {
    this.listeners.add(listener);
  }
}
