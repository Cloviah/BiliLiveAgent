import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const devUrl = 'http://127.0.0.1:5173';

function run(cmd, args, env) {
  const child = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit', shell: true });
  return child;
}

async function waitForServer(url, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* 尚未就绪 */
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

const vite = run('npx', ['vite']);
const ready = await waitForServer(devUrl);
if (!ready) {
  console.error('[dev] Vite 开发服务器启动超时，请检查端口 5173 是否被占用。');
  vite.kill();
  process.exit(1);
}

const electron = run('npx', ['electron', '.'], { ELECTRON_DEV_URL: devUrl });
electron.on('exit', (code) => {
  vite.kill();
  process.exit(code ?? 0);
});
