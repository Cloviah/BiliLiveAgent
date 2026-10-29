import type { BiliAccount } from '../../shared/types';
import type { Logger } from '../utils/logger';
import type { SecretVault } from '../core/secrets';
import type { Store } from '../store/db';
import type { BiliHttpClient } from './http-client';

const ACCOUNTS_FILE = 'accounts.json';

/** 多 B 站账号管理：凭据加密落盘，同一时间只激活一个 */
export class AccountManager {
  constructor(
    private readonly store: Store,
    private readonly vault: SecretVault,
    private readonly http: BiliHttpClient,
    private readonly logger: Logger,
  ) {}

  private readAll(): BiliAccount[] {
    return this.store.readJson<BiliAccount[]>(ACCOUNTS_FILE, []);
  }

  private writeAll(list: BiliAccount[]): void {
    this.store.writeJson(ACCOUNTS_FILE, list);
  }

  list(): BiliAccount[] {
    return this.readAll();
  }

  active(): BiliAccount | undefined {
    return this.readAll().find((a) => a.isActive && !a.expired);
  }

  cookieOf(uid: number): string | undefined {
    return this.vault.get(`bili_cookie_${uid}`);
  }

  save(account: Omit<BiliAccount, 'addedAt' | 'isActive'>, cookie: string): boolean {
    if (!this.vault.set(`bili_cookie_${account.uid}`, cookie)) {
      this.logger.error('auth', `凭据加密失败：${this.vault.getLastError() ?? '未知原因'}`);
      return false;
    }
    const list = this.readAll().filter((a) => a.uid !== account.uid);
    const next: BiliAccount = {
      ...account,
      isActive: list.length === 0 ? true : false,
      addedAt: Date.now(),
      lastVerifiedAt: Date.now(),
      expired: false,
    };
    list.push(next);
    this.writeAll(list);
    this.logger.info('auth', `已保存账号 ${account.uname}（${account.uid}）`);
    return true;
  }

  activate(uid: number): boolean {
    const list = this.readAll();
    let found = false;
    for (const item of list) {
      item.isActive = item.uid === uid;
      if (item.uid === uid) found = true;
    }
    this.writeAll(list);
    if (found) this.applyActive();
    return found;
  }

  remove(uid: number): void {
    this.vault.delete(`bili_cookie_${uid}`);
    this.writeAll(this.readAll().filter((a) => a.uid !== uid));
    this.applyActive();
  }

  /** 把当前激活账号的 Cookie 注入 HTTP 客户端 */
  applyActive(): boolean {
    const account = this.active();
    if (!account) {
      this.http.setCookie('');
      return false;
    }
    const cookie = this.cookieOf(account.uid);
    if (!cookie) {
      this.http.setCookie('');
      return false;
    }
    this.http.setCookie(cookie);
    return true;
  }

  async verify(uid?: number): Promise<{ ok: boolean; message: string; uid?: number; uname?: string }> {
    const target = uid ? this.readAll().find((a) => a.uid === uid) : this.active();
    if (!target) return { ok: false, message: '没有可校验的账号' };
    const cookie = this.cookieOf(target.uid);
    if (!cookie) return { ok: false, message: '该账号的登录态已缺失，请重新登录' };
    this.http.setCookie(cookie);
    try {
      const nav = await this.http.getJson<{ mid: number; uname: string; isLogin: boolean }>(
        'https://api.bilibili.com/x/web-interface/nav',
      );
      const ok = nav.code === 0 && Boolean(nav.data?.mid);
      const list = this.readAll();
      const found = list.find((a) => a.uid === target.uid);
      if (found) {
        found.expired = !ok;
        found.lastVerifiedAt = Date.now();
        if (ok) found.uname = nav.data?.uname ?? found.uname;
      }
      this.writeAll(list);
      return {
        ok,
        message: ok ? `登录有效：${nav.data?.uname ?? ''}` : `登录已失效：${nav.message || '未登录'}`,
        uid: nav.data?.mid,
        uname: nav.data?.uname,
      };
    } catch (error) {
      return { ok: false, message: `校验失败：${String(error)}` };
    }
  }
}
