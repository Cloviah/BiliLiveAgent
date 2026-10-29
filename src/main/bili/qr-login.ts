import QRCode from 'qrcode';
import type { QrLoginSession } from '../../shared/types';
import type { Logger } from '../utils/logger';
import { BiliHttpClient } from './http-client';
import type { BiliResponse } from './http-client';

const GENERATE_URL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate';
const POLL_URL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll';
const SPI_URL = 'https://api.bilibili.com/x/frontend/finger/spi';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36';

/** 登录成功后下发在 crossDomain 链接里的 Cookie 字段 */
const COOKIE_KEYS = [
  'DedeUserID',
  'DedeUserID__ckMd5',
  'SESSDATA',
  'bili_jct',
  'sid',
  'refresh_token',
  'ac_time_value',
];

interface GenerateData {
  url: string;
  qrcode_key: string;
}

interface PollData {
  url?: string;
  refresh_token?: string;
  timestamp?: number;
  /** 真实状态在 data.code 里，顶层 code 恒为 0 表示接口调用成功 */
  code?: number;
  message?: string;
}

export type QrPollState =
  | { state: 'pending' | 'scanned' | 'expired' | 'error'; message: string }
  | { state: 'success'; message: string; cookie: string; uid: number; uname: string };

/** 从登录成功返回的 crossDomain 链接里提取 Cookie（保持原始编码，与浏览器里的 Cookie 一致） */
export function cookiesFromCrossDomain(url: string): string {
  if (!url) return '';
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  const raw = new Map<string, string>();
  for (const seg of query.split('&')) {
    const idx = seg.indexOf('=');
    if (idx <= 0) continue;
    const key = seg.slice(0, idx);
    if (!raw.has(key)) raw.set(key, seg.slice(idx + 1));
  }
  const parts: string[] = [];
  for (const key of COOKIE_KEYS) {
    const value = raw.get(key);
    if (value) parts.push(`${key}=${value}`);
  }
  return parts.join('; ');
}

/** 合并多段 Cookie，同名以先出现的为准 */
export function mergeCookies(...parts: string[]): string {
  const map = new Map<string, string>();
  for (const part of parts) {
    if (!part) continue;
    for (const seg of part.split(';')) {
      const idx = seg.indexOf('=');
      const key = (idx >= 0 ? seg.slice(0, idx) : seg).trim();
      const value = idx >= 0 ? seg.slice(idx + 1).trim() : '';
      if (key && !map.has(key)) map.set(key, value);
    }
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function cookiesFromResponse(res: Response): string {
  return BiliHttpClient.collectCookies(res)
    .map((c) => c.split(';')[0])
    .filter((c) => /SESSDATA|bili_jct|DedeUserID|sid|refresh_token|ac_time_value|buvid/i.test(c))
    .join('; ');
}

export class QrLogin {
  /** 二维码会话缓存：key -> 生成时使用的 buvid3 等风控 Cookie */
  private readonly sessions = new Map<string, string>();

  constructor(
    private readonly http: BiliHttpClient,
    private readonly logger: Logger,
  ) {}

  /** 取 buvid3/buvid4：B 站接口缺少这两个字段时容易被风控拦截 */
  private async fetchDeviceCookie(): Promise<string> {
    try {
      const res = await fetch(SPI_URL, { method: 'GET', headers: { 'User-Agent': UA } });
      const json = (await res.json()) as BiliResponse<{ b_3?: string; b_4?: string }>;
      const buvid3 = json.data?.b_3 ?? '';
      const buvid4 = json.data?.b_4 ?? '';
      const parts = [
        buvid3 ? `buvid3=${buvid3}` : '',
        buvid4 ? `buvid4=${buvid4}` : '',
        `b_nut=${Date.now()}`,
      ].filter(Boolean);
      const headerCookies = cookiesFromResponse(res);
      return mergeCookies(parts.join('; '), headerCookies);
    } catch (error) {
      this.logger.warn('qrlogin', `获取 buvid3 失败，继续但不带风控字段：${String(error)}`);
      return `b_nut=${Date.now()}`;
    }
  }

  async start(): Promise<QrLoginSession> {
    const seed = await this.fetchDeviceCookie();
    const res = await fetch(GENERATE_URL, {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        Referer: 'https://passport.bilibili.com/',
        ...(seed ? { Cookie: seed } : {}),
      },
    });
    const json = (await res.json()) as BiliResponse<GenerateData>;
    if (json.code !== 0) throw new Error(`二维码获取失败：${json.message || json.code}`);
    const key = json.data.qrcode_key;
    this.sessions.set(key, mergeCookies(seed, cookiesFromResponse(res)));
    const image = await QRCode.toDataURL(json.data.url, { margin: 1, width: 320 });
    this.logger.info('qrlogin', `已生成二维码（key=${key.slice(0, 8)}…）`);
    return { key, url: json.data.url, image, expiresAt: Date.now() + 180_000 };
  }

  async poll(key: string): Promise<QrPollState> {
    const seed = this.sessions.get(key) ?? '';
    const res = await fetch(`${POLL_URL}?qrcode_key=${encodeURIComponent(key)}`, {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        Referer: 'https://passport.bilibili.com/',
        ...(seed ? { Cookie: seed } : {}),
      },
    });
    const json = (await res.json()) as BiliResponse<PollData>;
    const data = json.data ?? {};
    // 真实状态在 data.code：0 成功 / 86101 未扫码 / 86090 已扫码待确认 / 86038 已失效
    const status = typeof data.code === 'number' ? data.code : json.code;

    if (status === 86101) return { state: 'pending', message: data.message || '等待扫码' };
    if (status === 86090) return { state: 'scanned', message: data.message || '已扫码，请在手机上确认' };
    if (status === 86038) {
      this.sessions.delete(key);
      return { state: 'expired', message: data.message || '二维码已失效，请重新获取' };
    }
    if (status !== 0) {
      return { state: 'error', message: data.message || json.message || `未知返回码 ${status}` };
    }

    const cookie = mergeCookies(cookiesFromResponse(res), cookiesFromCrossDomain(data.url ?? ''), seed);
    if (!/SESSDATA=/i.test(cookie)) {
      return { state: 'error', message: '已确认但未取得有效登录态，请重新扫码（建议勾选“记住我”）' };
    }

    this.http.setCookie(cookie);
    const nav = await this.http.getJson<{ mid: number; uname: string }>(
      'https://api.bilibili.com/x/web-interface/nav',
    );
    let uid = nav.data?.mid ?? 0;
    let uname = nav.data?.uname ?? '';
    if (!uid) {
      await this.refreshCookie(cookie);
      const retry = await this.http.getJson<{ mid: number; uname: string }>(
        'https://api.bilibili.com/x/web-interface/nav',
      );
      uid = retry.data?.mid ?? 0;
      uname = retry.data?.uname ?? '';
    }
    if (!uid) return { state: 'error', message: '登录态校验失败，请重新扫码登录' };

    this.sessions.delete(key);
    this.logger.info('qrlogin', `扫码登录成功：${uname}（UID ${uid}）`);
    return { state: 'success', message: '登录成功', cookie, uid, uname };
  }

  /** 登录成功后刷新一次 Cookie，补齐 buvid3 / b_nut 等风控字段 */
  private async refreshCookie(cookie: string): Promise<void> {
    const device = await this.fetchDeviceCookie();
    const merged = mergeCookies(cookie, device);
    try {
      const res = await fetch('https://www.bilibili.com/', {
        method: 'GET',
        headers: { 'User-Agent': UA, Cookie: merged },
      });
      const extra = BiliHttpClient.collectCookies(res).map((c) => c.split(';')[0]);
      this.http.setCookie(mergeCookies(merged, extra.join('; ')));
    } catch {
      this.http.setCookie(merged);
    }
  }

  drop(key: string): void {
    this.sessions.delete(key);
  }
}
