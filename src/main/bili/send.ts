import crypto from 'node:crypto';
import type { Logger } from '../utils/logger';
import { DANMAKU_MAX_LENGTH, MIN_PLATFORM_SEND_GAP_MS } from '../../shared/limits';
import { charLength, segmentText } from '../utils/text';
import type { BiliHttpClient, BiliResponse } from './http-client';

export interface SendOutcome {
  ok: boolean;
  code?: number;
  message: string;
  risk?: boolean;
  text: string;
}

const RISK_PATTERNS = ['频繁', '风控', '太快', '间隔', '限制', '稍后再试'];

export class DanmakuSender {
  constructor(
    private readonly http: BiliHttpClient,
    private readonly logger: Logger,
  ) {}

  async sendOnce(roomId: number, text: string): Promise<SendOutcome> {
    const clean = text.replace(/[\r\n]+/g, ' ').trim();
    if (!clean) return { ok: false, message: '内容为空', text: clean };
    if (charLength(clean) > DANMAKU_MAX_LENGTH) {
      return { ok: false, message: `超过弹幕长度上限 ${DANMAKU_MAX_LENGTH}`, text: clean };
    }
    if (!roomId || roomId <= 0) {
      return { ok: false, message: '未设置直播间房号，请先在控制台填写并读取房间信息', text: clean };
    }
    const csrf = this.http.csrf;
    if (!csrf) return { ok: false, message: '未登录或缺少 bili_jct', text: clean };

    const rnd = Math.floor(Date.now() / 1000);
    const res = await this.http.postForm<{ mode_info?: unknown }>('https://api.live.bilibili.com/msg/send', {
      bubble: 0,
      msg: clean,
      color: 16777215,
      mode: 1,
      fontsize: 25,
      roomid: roomId,
      rnd,
      csrf,
      csrf_token: csrf,
    });

    const message = res.message || String(res.code);
    if (res.code === 0) return { ok: true, code: 0, message: '发送成功', text: clean };
    const risk = RISK_PATTERNS.some((p) => message.includes(p));
    this.logger.warn('send', `发送失败 code=${res.code} message=${message}`);
    return { ok: false, code: res.code, message, risk, text: clean };
  }
}

export interface SendQueueOptions {
  maxSegments: number;
  segmentDelayMs: number;
  maxConsecutiveFailures: number;
}

export interface SendJob {
  roomId: number;
  text: string;
  reason: string;
  replyToUid?: number;
}

/**
 * 串行发送队列：保证平台最小间隔、连续失败熔断，
 * 每个分段都计入一次实际发送。
 */
export class SendQueue {
  private queue: SendJob[] = [];
  private draining = false;
  private consecutiveFailures = 0;
  private lastSentAt = 0;
  private circuitOpen = false;

  constructor(
    private readonly sender: DanmakuSender,
    private readonly logger: Logger,
    private readonly options: SendQueueOptions,
    private readonly hooks: {
      onRecord: (record: {
        id: string;
        roomId: number;
        ts: number;
        text: string;
        reason: string;
        status: 'sent' | 'blocked' | 'rejected' | 'failed';
        detail?: string;
        replyToUid?: number;
      }) => void;
      onCircuitOpen: (reason: string) => void;
    },
  ) {}

  isOpen(): boolean {
    return this.circuitOpen;
  }

  reset(): void {
    this.circuitOpen = false;
    this.consecutiveFailures = 0;
  }

  enqueue(job: SendJob): void {
    const segments = segmentText(job.text, DANMAKU_MAX_LENGTH, this.options.maxSegments);
    if (segments.length === 0) {
      this.hooks.onRecord({
        id: crypto.randomUUID(),
        roomId: job.roomId,
        ts: Date.now(),
        text: job.text,
        reason: job.reason,
        status: 'blocked',
        detail: '分段后无有效内容',
      });
      return;
    }
    segments.forEach((text, index) => {
      this.queue.push({
        ...job,
        text,
        reason: index === 0 ? job.reason : `${job.reason}（分段 ${index + 1}/${segments.length}）`,
      });
    });
    void this.drain();
  }

  private async waitPlatformGap(): Promise<void> {
    const wait = this.lastSentAt + MIN_PLATFORM_SEND_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        if (this.circuitOpen) {
          const dropped = this.queue.splice(0);
          dropped.forEach((job) => {
            this.hooks.onRecord({
              id: crypto.randomUUID(),
              roomId: job.roomId,
              ts: Date.now(),
              text: job.text,
              reason: job.reason,
              status: 'blocked',
              detail: '熔断已打开，丢弃待发内容',
            });
          });
          break;
        }
        const job = this.queue.shift();
        if (!job) break;
        await this.waitPlatformGap();
        try {
          const outcome = await this.sender.sendOnce(job.roomId, job.text);
          this.hooks.onRecord({
            id: crypto.randomUUID(),
            roomId: job.roomId,
            ts: Date.now(),
            text: job.text,
            reason: job.reason,
            status: outcome.ok ? 'sent' : outcome.risk ? 'rejected' : 'failed',
            detail: outcome.message,
            replyToUid: job.replyToUid,
          });
          if (outcome.ok) {
            this.consecutiveFailures = 0;
            this.lastSentAt = Date.now();
          } else {
            this.consecutiveFailures += 1;
            if (this.consecutiveFailures >= this.options.maxConsecutiveFailures) {
              this.circuitOpen = true;
              this.logger.error('send', `连续 ${this.consecutiveFailures} 次发送失败，触发熔断`);
              this.hooks.onCircuitOpen(`连续发送失败 ${this.consecutiveFailures} 次`);
            }
          }
        } catch (error) {
          this.consecutiveFailures += 1;
          this.hooks.onRecord({
            id: crypto.randomUUID(),
            roomId: job.roomId,
            ts: Date.now(),
            text: job.text,
            reason: job.reason,
            status: 'failed',
            detail: String(error),
            replyToUid: job.replyToUid,
          });
          if (this.consecutiveFailures >= this.options.maxConsecutiveFailures) {
            this.circuitOpen = true;
            this.hooks.onCircuitOpen(`发送异常：${String(error)}`);
          }
        }
        if (this.queue.length) await new Promise((r) => setTimeout(r, this.options.segmentDelayMs));
      }
    } finally {
      this.draining = false;
    }
  }

  pending(): number {
    return this.queue.length;
  }
}

export type { BiliResponse };
