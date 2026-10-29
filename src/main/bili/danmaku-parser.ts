import crypto from 'node:crypto';
import type { EventKind, LiveEvent } from '../../shared/types';
import { sanitizeDanmaku } from '../utils/text';

interface RawMessage {
  cmd?: string;
  info?: unknown[];
  data?: Record<string, unknown>;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 解析直播弹幕协议中的各种命令为统一事件 */
export function parseCommand(raw: RawMessage, roomId: number): LiveEvent | null {
  const cmd = raw.cmd ?? '';
  const data = raw.data ?? {};
  const base = { roomId, id: crypto.randomUUID(), ts: Date.now() };

  switch (cmd) {
    case 'DANMU_MSG': {
      const info = Array.isArray(raw.info) ? raw.info : [];
      const text = sanitizeDanmaku(str(info[1]));
      const user = Array.isArray(info[2]) ? info[2] : [];
      const extra = Array.isArray(info[0]) ? info[0] : [];
      const uid = num(user[0]);
      const uname = str(user[1]) || `游客${uid}`;
      const ts = num(extra[4]) || Date.now();
      if (!text) return null;
      return { ...base, ts, kind: 'danmaku', uid, uname, text, priority: 'normal' };
    }
    case 'SUPER_CHAT_MESSAGE': {
      const userInfo = (data.user_info ?? {}) as Record<string, unknown>;
      const uid = num(data.uid || userInfo.uid);
      const text = sanitizeDanmaku(str(data.message || data.message_trans));
      return {
        ...base,
        kind: 'superchat',
        uid,
        uname: str(userInfo.uname) || str(data.uname) || `游客${uid}`,
        text,
        priority: 'high',
        meta: { price: num(data.price) },
      };
    }
    case 'SEND_GIFT': {
      const uid = num(data.uid);
      return {
        ...base,
        kind: 'gift',
        uid,
        uname: str(data.uname) || `游客${uid}`,
        text: `${str(data.giftName) || '礼物'} x${num(data.num) || 1}`,
        priority: 'normal',
        meta: { gift: str(data.giftName), num: num(data.num) || 1 },
      };
    }
    case 'GUARD_BUY': {
      const uid = num(data.uid);
      return {
        ...base,
        kind: 'guard',
        uid,
        uname: str(data.username) || `游客${uid}`,
        text: `上舰：${str(data.gift_name) || '大航海'}`,
        priority: 'high',
      };
    }
    case 'INTERACT_WORD': {
      const uid = num(data.uid);
      return {
        ...base,
        kind: 'interact',
        uid,
        uname: str(data.uname) || `游客${uid}`,
        text: '进入直播间',
        priority: 'normal',
        meta: { msgType: num(data.msg_type) },
      };
    }
    case 'LIVE':
    case 'PREPARING': {
      return {
        ...base,
        kind: 'live_status',
        uid: num(data.uid),
        uname: str(data.uname) || '系统',
        text: cmd === 'LIVE' ? '直播开始' : '直播结束',
        priority: 'high',
        meta: { liveStatus: cmd === 'LIVE' ? 1 : 0 },
      };
    }
    default:
      return null;
  }
}

export function kindLabel(kind: EventKind): string {
  switch (kind) {
    case 'danmaku':
      return '弹幕';
    case 'mention':
      return '点名';
    case 'superchat':
      return '醒目留言';
    case 'gift':
      return '礼物';
    case 'guard':
      return '上舰';
    case 'interact':
      return '进入';
    case 'live_status':
      return '开播状态';
    default:
      return kind;
  }
}
