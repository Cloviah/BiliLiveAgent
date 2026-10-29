import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Logger } from '../utils/logger';
import type { SecretVault } from '../core/secrets';
import type { BiliHttpClient } from './http-client';

export interface ImportedAccount {
  browser: string;
  profile: string;
  uid: number;
  uname: string;
  cookie: string;
}

const NEEDED = ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid', 'buvid3', 'buvid4', 'b_nut'];

interface ChromiumTarget {
  browser: string;
  root: string;
}

function chromiumTargets(): ChromiumTarget[] {
  const local = process.env.LOCALAPPDATA ?? '';
  return [
    { browser: 'Chrome', root: path.join(local, 'Google', 'Chrome', 'User Data') },
    { browser: 'Edge', root: path.join(local, 'Microsoft', 'Edge', 'User Data') },
  ].filter((t) => fs.existsSync(t.root));
}

function firefoxProfiles(): string[] {
  const root = path.join(process.env.APPDATA ?? '', 'Mozilla', 'Firefox', 'Profiles');
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(root, d.name));
}

/** 浏览器登录态导入：自动检测 Chromium / Firefox 并读取 bilibili.com 的 Cookie */
export class BrowserImport {
  constructor(
    private readonly vault: SecretVault,
    private readonly http: BiliHttpClient,
    private readonly logger: Logger,
  ) {}

  private async sql(): Promise<any> {
    const candidates = [
      ...(process.resourcesPath ? [path.join(process.resourcesPath, 'sql-wasm.wasm')] : []),
      path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    ];
    let wasmBinary: Buffer | undefined;
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        wasmBinary = fs.readFileSync(candidate);
        break;
      }
    }
    const mod: any = await import('sql.js');
    const init = mod.default ?? mod;
    return init(wasmBinary ? { wasmBinary } : {});
  }

  private chromiumAesKey(root: string): Buffer | undefined {
    const localStatePath = path.join(root, 'Local State');
    if (!fs.existsSync(localStatePath)) return undefined;
    try {
      const localState = JSON.parse(fs.readFileSync(localStatePath, 'utf8')) as {
        os_crypt?: { encrypted_key?: string };
      };
      const b64 = localState.os_crypt?.encrypted_key;
      if (!b64) return undefined;
      const raw = Buffer.from(b64, 'base64').subarray(5); // 去掉 DPAPI 前缀
      const plain = this.vault.unprotect(raw.toString('base64'));
      return plain ? Buffer.from(plain, 'base64') : undefined;
    } catch {
      return undefined;
    }
  }

  private decryptValue(encrypted: Buffer, aesKey?: Buffer): string {
    const prefix = encrypted.subarray(0, 3).toString('utf8');
    if ((prefix === 'v10' || prefix === 'v11' || prefix === 'v20') && aesKey) {
      try {
        const nonce = encrypted.subarray(3, 15);
        const body = encrypted.subarray(15, encrypted.length - 16);
        const tag = encrypted.subarray(encrypted.length - 16);
        const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, nonce);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
      } catch {
        /* 落到 DPAPI 兜底 */
      }
    }
    const plain = this.vault.unprotect(encrypted.toString('base64'));
    if (plain) return plain;
    return encrypted.toString('utf8');
  }

  private async readChromium(SQL: any, target: ChromiumTarget, aesKey?: Buffer): Promise<ImportedAccount[]> {
    const out: ImportedAccount[] = [];
    const dirs = fs
      .readdirSync(target.root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^(Default|Profile \d+)$/.test(d.name))
      .map((d) => d.name);

    for (const profile of dirs) {
      const dbPath = path.join(target.root, profile, 'Network', 'Cookies');
      if (!fs.existsSync(dbPath)) continue;
      const tmp = path.join(os.tmpdir(), `bili-cookies-${crypto.randomUUID()}.db`);
      try {
        fs.copyFileSync(dbPath, tmp);
        const db = new SQL.Database(fs.readFileSync(tmp));
        const result = db.exec(
          "SELECT name, value, encrypted_value FROM cookies WHERE host_key LIKE '%bilibili.com%'",
        );
        db.close();
        const jar = new Map<string, string>();
        for (const row of result[0]?.values ?? []) {
          const [name, value, encryptedValue] = row as [string, string, Uint8Array];
          if (!NEEDED.includes(name)) continue;
          const enc = Buffer.from(encryptedValue ?? new Uint8Array());
          const text = enc.length ? this.decryptValue(enc, aesKey) : String(value ?? '');
          if (text) jar.set(name, text);
        }
        const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
        if (jar.has('SESSDATA')) {
          const account = await this.identify(cookie, target.browser, profile);
          if (account) out.push(account);
        }
      } catch (error) {
        this.logger.warn('browser-import', `读取 ${target.browser}/${profile} 失败：${String(error)}`);
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    }
    return out;
  }

  private async readFirefox(SQL: any): Promise<ImportedAccount[]> {
    const out: ImportedAccount[] = [];
    for (const profile of firefoxProfiles()) {
      const dbPath = path.join(profile, 'cookies.sqlite');
      if (!fs.existsSync(dbPath)) continue;
      const tmp = path.join(os.tmpdir(), `bili-cookies-ff-${crypto.randomUUID()}.db`);
      try {
        fs.copyFileSync(dbPath, tmp);
        const db = new SQL.Database(fs.readFileSync(tmp));
        const result = db.exec(
          "SELECT name, value FROM moz_cookies WHERE host LIKE '%bilibili.com%'",
        );
        db.close();
        const jar = new Map<string, string>();
        for (const row of result[0]?.values ?? []) {
          const [name, value] = row as [string, string];
          if (NEEDED.includes(name) && value) jar.set(name, value);
        }
        const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
        if (jar.has('SESSDATA')) {
          const account = await this.identify(cookie, 'Firefox', path.basename(profile));
          if (account) out.push(account);
        }
      } catch (error) {
        this.logger.warn('browser-import', `读取 Firefox 配置失败：${String(error)}`);
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    }
    return out;
  }

  private async identify(cookie: string, browser: string, profile: string): Promise<ImportedAccount | null> {
    const previous = this.http.getCookie();
    this.http.setCookie(cookie);
    try {
      const nav = await this.http.getJson<{ mid: number; uname: string }>(
        'https://api.bilibili.com/x/web-interface/nav',
      );
      if (nav.code !== 0 || !nav.data?.mid) return null;
      return { browser, profile, uid: nav.data.mid, uname: nav.data.uname ?? '', cookie };
    } catch {
      return null;
    } finally {
      this.http.setCookie(previous);
    }
  }

  async scan(): Promise<ImportedAccount[]> {
    this.logger.info('browser-import', '开始检测本机浏览器登录态');
    const SQL = await this.sql();
    const out: ImportedAccount[] = [];
    for (const target of chromiumTargets()) {
      const key = this.chromiumAesKey(target.root);
      out.push(...(await this.readChromium(SQL, target, key)));
    }
    out.push(...(await this.readFirefox(SQL)));
    return out.filter((a, i, arr) => arr.findIndex((b) => b.uid === a.uid) === i);
  }
}
