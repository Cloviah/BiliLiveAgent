import crypto from 'node:crypto';
import type { Logger } from '../utils/logger';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38,
  41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

interface WbiKeys {
  imgKey: string;
  subKey: string;
  fetchedAt: number;
}

export interface BiliResponse<T> {
  code: number;
  message: string;
  data: T;
}

export class BiliHttpClient {
  private cookie = '';
  private wbi?: WbiKeys;
  private readonly timeoutMs = 15_000;

  constructor(private readonly logger: Logger) {}

  setCookie(cookie: string): void {
    this.cookie = cookie;
  }

  getCookie(): string {
    return this.cookie;
  }

  cookieValue(name: string): string | undefined {
    const match = this.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return match ? match[1] : undefined;
  }

  get csrf(): string {
    return this.cookieValue('bili_jct') ?? '';
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'User-Agent': UA,
      Referer: 'https://live.bilibili.com/',
      Origin: 'https://live.bilibili.com',
      Accept: 'application/json, text/plain, */*',
      ...(this.cookie ? { Cookie: this.cookie } : {}),
      ...extra,
    };
  }

  private async request(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
    const timeout = init.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async getJson<T>(url: string, opts: { wbi?: boolean; retries?: number } = {}): Promise<BiliResponse<T>> {
    const target = opts.wbi ? await this.signUrl(url) : url;
    const retries = opts.retries ?? 2;
    let lastError: unknown;
    for (let i = 0; i <= retries; i += 1) {
      try {
        const res = await this.request(target, { method: 'GET', headers: this.headers() });
        if (res.status === 412) {
          this.logger.warn('http', `412 风控，退避后重试：${url}`);
          await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
          continue;
        }
        return (await res.json()) as BiliResponse<T>;
      } catch (error) {
        lastError = error;
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
    }
    throw new Error(`请求失败：${url} ${String(lastError)}`);
  }

  async postForm<T>(url: string, form: Record<string, string | number>): Promise<BiliResponse<T>> {
    const body = new URLSearchParams();
    Object.entries(form).forEach(([k, v]) => body.append(k, String(v)));
    const res = await this.request(url, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: body.toString(),
    });
    return (await res.json()) as BiliResponse<T>;
  }

  /** 获取并缓存 WBI 签名密钥 */
  private async fetchWbiKeys(): Promise<WbiKeys> {
    if (this.wbi && Date.now() - this.wbi.fetchedAt < 30 * 60_000) return this.wbi;
    const res = await this.request('https://api.bilibili.com/x/web-interface/nav', {
      method: 'GET',
      headers: this.headers(),
    });
    const json = (await res.json()) as BiliResponse<{ wbi_img: { img_url: string; sub_url: string } }>;
    const imgUrl = json.data?.wbi_img?.img_url ?? '';
    const subUrl = json.data?.wbi_img?.sub_url ?? '';
    const pick = (u: string) => u.split('/').pop()?.split('.')[0] ?? '';
    this.wbi = { imgKey: pick(imgUrl), subKey: pick(subUrl), fetchedAt: Date.now() };
    return this.wbi;
  }

  private mixinKey(imgKey: string, subKey: string): string {
    const raw = `${imgKey}${subKey}`;
    return MIXIN_KEY_ENC_TAB.map((i) => raw[i]).join('').slice(0, 32);
  }

  async signUrl(url: string): Promise<string> {
    try {
      const keys = await this.fetchWbiKeys();
      const parsed = new URL(url);
      const params: Record<string, string> = {};
      parsed.searchParams.forEach((v, k) => {
        params[k] = v;
      });
      params.wts = Math.round(Date.now() / 1000).toString();
      const sorted = Object.keys(params)
        .sort()
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]).replace(/[!'()*]/g, ''))}`)
        .join('&');
      const wRid = crypto.createHash('md5').update(sorted + this.mixinKey(keys.imgKey, keys.subKey)).digest('hex');
      parsed.search = `${sorted}&w_rid=${wRid}`;
      return parsed.toString();
    } catch {
      return url;
    }
  }

  /** 从响应头收集 Set-Cookie，用于扫码登录 */
  static collectCookies(res: Response): string[] {
    const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
    if (typeof anyHeaders.getSetCookie === 'function') return anyHeaders.getSetCookie();
    const raw = res.headers.get('set-cookie');
    return raw ? [raw] : [];
  }
}
