import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from '../utils/logger';

export type SecretName = 'deepseek_api_key' | string;

/**
 * 内嵌的 DPAPI 脚本。
 * 打包后 app.asar 内的文件对 PowerShell 不可见（PowerShell 无法读取 asar 虚拟路径），
 * 因此脚本内容随程序分发，启动时写入数据目录后再执行。
 */
const DPAPI_SCRIPT = `param(
  [Parameter(Mandatory = $true)][ValidateSet('protect', 'unprotect')][string]$Mode,
  [Parameter(Mandatory = $true)][string]$Payload,
  [switch]$MachineScope
)

Add-Type -AssemblyName System.Security

$bytes = [Convert]::FromBase64String($Payload)
$scope = if ($MachineScope) {
  [System.Security.Cryptography.DataProtectionScope]::LocalMachine
} else {
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
}

try {
  if ($Mode -eq 'protect') {
    $out = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)
  } else {
    $out = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)
  }
  [Convert]::ToBase64String($out)
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`;

const SELFTEST_PLAIN = 'BiliLiveAgent-dpapi-selftest';

/**
 * Windows DPAPI 密钥保险库：API Key 与 B 站凭据密文落在本机，
 * 只能由当前 Windows 用户解密，不随数据目录复制而迁移。
 */
export class SecretVault {
  private readonly dir: string;
  private readonly script: string;
  private readonly cache = new Map<string, string>();
  private lastError?: string;

  constructor(
    dataDir: string,
    private readonly logger?: Logger,
  ) {
    this.dir = path.join(dataDir, 'secrets');
    fs.mkdirSync(this.dir, { recursive: true });
    this.script = this.ensureScript(dataDir);
  }

  /** 将脚本写入数据目录（真实磁盘路径），保证打包后依然可读 */
  private ensureScript(dataDir: string): string {
    const file = path.join(dataDir, 'dpapi.ps1');
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (current !== DPAPI_SCRIPT) {
      fs.writeFileSync(file, DPAPI_SCRIPT, 'utf8');
    }
    return file;
  }

  getLastError(): string | undefined {
    return this.lastError;
  }

  /** 自检：加解密往返是否可用，用于启动日志与诊断面板 */
  selfTest(): { ok: boolean; message: string } {
    const cipher = this.protect(SELFTEST_PLAIN);
    if (!cipher) return { ok: false, message: `DPAPI 加密失败：${this.lastError ?? '未知原因'}` };
    const plain = this.unprotect(cipher);
    if (plain !== SELFTEST_PLAIN) {
      return { ok: false, message: `DPAPI 解密失败：${this.lastError ?? '结果与原文不一致'}` };
    }
    return { ok: true, message: 'DPAPI 可用（仅当前 Windows 用户可解密）' };
  }

  private call(mode: 'protect' | 'unprotect', payload: string): string | null {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        this.script,
        '-Mode',
        mode,
        '-Payload',
        payload,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    const out = (result.stdout ?? '').trim();
    if (result.status === 0 && out) {
      this.lastError = undefined;
      return out;
    }
    this.lastError = (result.stderr || out || `PowerShell 退出码 ${result.status}`).trim();
    this.logger?.error('secrets', `DPAPI ${mode} 失败：${this.lastError}`);
    return null;
  }

  protect(plain: string): string | null {
    if (!plain) return null;
    const payload = Buffer.from(plain, 'utf8').toString('base64');
    return this.call('protect', payload);
  }

  unprotect(cipherB64: string): string | null {
    if (!cipherB64) return null;
    const out = this.call('unprotect', cipherB64);
    if (!out) return null;
    return Buffer.from(out, 'base64').toString('utf8');
  }

  private fileOf(name: string): string {
    return path.join(this.dir, `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.bin`);
  }

  set(name: SecretName, value: string): boolean {
    const cipher = this.protect(value);
    if (!cipher) return false;
    fs.writeFileSync(this.fileOf(name), cipher, 'utf8');
    this.cache.set(name, value);
    return true;
  }

  get(name: SecretName): string | undefined {
    const cached = this.cache.get(name);
    if (cached !== undefined) return cached;
    const file = this.fileOf(name);
    if (!fs.existsSync(file)) return undefined;
    const plain = this.unprotect(fs.readFileSync(file, 'utf8').trim());
    if (plain === null) return undefined;
    this.cache.set(name, plain);
    return plain;
  }

  delete(name: SecretName): void {
    this.cache.delete(name);
    fs.rmSync(this.fileOf(name), { force: true });
  }

  has(name: SecretName): boolean {
    return fs.existsSync(this.fileOf(name));
  }
}
