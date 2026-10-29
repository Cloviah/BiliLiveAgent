import { brotliDecompressSync, inflateSync } from 'node:zlib';
import WebSocket from 'ws';
import type { Logger } from '../utils/logger';
import { HEARTBEAT_INTERVAL_MS, RECONNECT_BASE_MS, RECONNECT_MAX_ATTEMPTS, RECONNECT_MAX_MS } from '../../shared/limits';
import { backoffDelay } from '../utils/time';
import type { RoomService, DanmakuEndpoint } from './room';

export interface LiveClientHandlers {
  onMessage: (raw: { cmd?: string; info?: unknown[]; data?: Record<string, unknown> }) => void;
  onStatus: (state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected', detail?: string) => void;
  onPopularity: (value: number) => void;
}

function authPacket(roomId: number, token: string, uid: number, buvid = ''): Buffer {
  // uid 必须与登录态一致：登录后的 token 配 uid=0 会被服务端立刻断开
  const body = Buffer.from(
    JSON.stringify({ uid, roomid: roomId, protover: 3, buvid, platform: 'web', type: 2, key: token }),
    'utf8',
  );
  return pack(7, body);
}

function heartbeatPacket(): Buffer {
  return pack(2, Buffer.from('[object Object]', 'utf8'));
}

function pack(op: number, body: Buffer): Buffer {
  const header = Buffer.alloc(16);
  header.writeUInt32BE(16 + body.length, 0); // 包总长度
  header.writeUInt16BE(16, 4); // 头部长度
  header.writeUInt16BE(1, 6); // 协议版本
  header.writeUInt32BE(op, 8); // 操作码（4 字节，写成 2 字节会被服务端判定为非法包）
  header.writeUInt32BE(1, 12); // 序列号
  return Buffer.concat([header, body]);
}

/** 从一段文本中提取完整的 JSON 对象（弹幕包解压后常含多个拼接对象） */
function extractJsonObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

export class LiveClient {
  private ws?: WebSocket;
  private heartbeat?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;
  private buffer = Buffer.alloc(0);
  private attempts = 0;
  private running = false;
  private roomId = 0;
  private uid = 0;
  private endpoint?: DanmakuEndpoint;

  constructor(
    private readonly roomService: RoomService,
    private readonly logger: Logger,
    private readonly handlers: LiveClientHandlers,
    private readonly autoReconnect = true,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  async start(roomId: number, uid = 0): Promise<void> {
    this.roomId = roomId;
    this.uid = uid;
    this.running = true;
    this.attempts = 0;
    await this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.heartbeat = undefined;
    this.retryTimer = undefined;
    try {
      this.ws?.close();
    } catch {
      /* 忽略关闭异常 */
    }
    this.ws = undefined;
    this.handlers.onStatus('disconnected');
  }

  private async connect(): Promise<void> {
    if (!this.running) return;
    this.handlers.onStatus(this.attempts === 0 ? 'connecting' : 'reconnecting');
    try {
      this.endpoint = await this.roomService.fetchDanmakuEndpoint(this.roomId);
      const ws = new WebSocket(this.endpoint.url, { handshakeTimeout: 10_000 });
      this.ws = ws;
      ws.on('open', () => {
        this.attempts = 0;
        ws.send(authPacket(this.roomId, this.endpoint?.token ?? '', this.uid));
        ws.send(heartbeatPacket());
        this.heartbeat = setInterval(() => {
          try {
            ws.send(heartbeatPacket());
          } catch {
            /* 心跳失败由 close 事件处理 */
          }
        }, HEARTBEAT_INTERVAL_MS);
        this.handlers.onStatus('connected');
        this.logger.info('live', `已连接弹幕服务器（房间 ${this.roomId}）`);
      });
      ws.on('message', (data: Buffer) => this.onData(Buffer.from(data)));
      ws.on('error', (err) => {
        this.logger.warn('live', `弹幕连接异常：${err.message}`);
      });
      ws.on('close', (code, reason) => {
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = undefined;
        const detail = reason?.toString('utf8') ?? '';
        this.logger.info('live', `连接关闭 code=${code}${detail ? ` reason=${detail}` : ''}`);
        this.buffer = Buffer.alloc(0);
        this.scheduleReconnect();
      });
    } catch (error) {
      this.logger.error('live', `连接失败：${String(error)}`);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    if (!this.autoReconnect || this.attempts >= RECONNECT_MAX_ATTEMPTS) {
      this.handlers.onStatus('disconnected', '已停止重连');
      return;
    }
    this.attempts += 1;
    const delay = backoffDelay(this.attempts, RECONNECT_BASE_MS, RECONNECT_MAX_MS);
    this.handlers.onStatus('reconnecting', `${Math.round(delay / 1000)} 秒后重连`);
    this.logger.info('live', `第 ${this.attempts} 次重连，${delay}ms 后重试`);
    this.retryTimer = setTimeout(() => {
      void this.connect();
    }, delay);
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 16) {
      const total = this.buffer.readUInt32BE(0);
      if (total < 16 || this.buffer.length < total) break;
      const packet = this.buffer.subarray(0, total);
      this.buffer = this.buffer.subarray(total);
      this.handlePacket(packet);
    }
  }

  private handlePacket(packet: Buffer): void {
    const protover = packet.readUInt16BE(6);
    const op = packet.readUInt32BE(8); // 操作码为 4 字节
    let body = packet.subarray(16);

    if (protover === 2) {
      try {
        body = inflateSync(body);
      } catch {
        return;
      }
    } else if (protover === 3) {
      try {
        body = brotliDecompressSync(body);
      } catch {
        return;
      }
    }

    if (op === 3) {
      if (body.length >= 4) this.handlers.onPopularity(body.readUInt32BE(0));
      return;
    }
    if (op === 8) {
      this.logger.info('live', '弹幕鉴权通过');
      return;
    }
    if (op !== 5) return;

    const text = body.toString('utf8');
    for (const piece of extractJsonObjects(text)) {
      try {
        this.handlers.onMessage(JSON.parse(piece));
      } catch {
        /* 跳过无法解析的片段 */
      }
    }
  }
}
