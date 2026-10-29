import fs from 'node:fs';
import path from 'node:path';
import { app, protocol } from 'electron';
import type { RuntimeMode } from '../shared/types';
import { Logger } from './utils/logger';
import { Store } from './store/db';
import { SecretVault } from './core/secrets';
import { ConfigStore } from './core/config';
import { RuntimeState } from './core/runtime';
import { RateLimiter } from './core/rate-limiter';
import { Scheduler } from './core/scheduler';
import { Budget } from './core/budget';
import { UsageRepo } from './store/usage-repo';
import { EventsRepo } from './store/events-repo';
import { ConversationRepo } from './store/conversation-repo';
import { BiliHttpClient } from './bili/http-client';
import { AccountManager } from './bili/auth';
import { QrLogin } from './bili/qr-login';
import { BrowserImport } from './bili/browser-import';
import { RoomService } from './bili/room';
import { DanmakuSender, SendQueue } from './bili/send';
import { LiveClient } from './bili/live-client';
import { PersonaStore } from './agent/persona';
import { MemoryManager } from './agent/memory';
import { Guards } from './agent/guards';
import { DeepSeekClient } from './agent/deepseek';
import { PluginRegistry } from './plugins/registry';
import { AgentEngine } from './core/orchestrator';
import { createMainWindow } from './window';
import { TrayController } from './tray';
import { createPushBridge, registerIpc } from './ipc';

const appPath = app.getAppPath();
const dataDir = app.isPackaged
  ? path.join(path.dirname(app.getPath('exe')), 'BiliLiveAgent-Data')
  : path.join(appPath, 'data');
const builtinsDir = path.join(appPath, 'personas');
const rendererDir = path.join(appPath, 'dist', 'renderer');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

// 自定义协议需在 app ready 之前声明：渲染层以 app:// 加载，
// 避免 file:// 下模块脚本被 CORS 拦截导致的白屏
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true },
  },
]);

const logger = new Logger(dataDir);
logger.info('app', `主进程模块已加载 · Node ${process.versions.node}`);

const store = new Store(dataDir);
const vault = new SecretVault(dataDir, logger);
const config = new ConfigStore(dataDir);

const http = new BiliHttpClient(logger);
const accounts = new AccountManager(store, vault, http, logger);
const roomService = new RoomService(http, logger);
const qr = new QrLogin(http, logger);
const browserImport = new BrowserImport(vault, http, logger);
const sender = new DanmakuSender(http, logger);

const runtime = new RuntimeState(config.get().room.roomId);
const conversations = new ConversationRepo(store);
const events = new EventsRepo(store);
const usage = new UsageRepo(store);
const budget = new Budget(usage, () => config.get());
const limiter = new RateLimiter(() => config.get());
const scheduler = new Scheduler(() => config.get());
const guards = new Guards(() => config.get(), logger);
const persona = new PersonaStore(store, dataDir, builtinsDir, logger);
const memory = new MemoryManager(conversations, guards, logger);
const model = new DeepSeekClient(vault, logger);
const plugins = new PluginRegistry(
  () => config.get(),
  (name) => vault.get(name),
  logger,
);
plugins.registerBuiltins();

const bridge = createPushBridge();

const sendQueue = new SendQueue(
  sender,
  logger,
  {
    maxSegments: config.get().interaction.maxSegments,
    segmentDelayMs: config.get().interaction.segmentDelayMs,
    maxConsecutiveFailures: config.get().safety.maxConsecutiveFailures,
  },
  {
    onRecord: (record) => {
      conversations.appendSend(record);
      bridge.send(record);
    },
    onCircuitOpen: (reason) => engine.notifyCircuitOpen(reason),
  },
);

const liveClient = new LiveClient(
  roomService,
  logger,
  {
    onMessage: (raw) => engine.handleMessage(raw),
    onStatus: (state, detail) => engine.setConn(state, detail),
    onPopularity: (value) => engine.setPopularity(value),
  },
  config.get().runtime.autoReconnect,
);

const engine = new AgentEngine(
  config,
  runtime,
  logger,
  roomService,
  liveClient,
  sendQueue,
  accounts,
  persona,
  memory,
  guards,
  model,
  budget,
  limiter,
  scheduler,
  plugins,
  events,
  conversations,
  {
    onEvents: bridge.events,
    onSend: bridge.send,
    onStats: bridge.stats,
  },
);

let mainWindow: ReturnType<typeof createMainWindow> | undefined;
let tray: TrayController | undefined;
let quitting = false;

function persistState(): void {
  store.writeJson('state.json', { roomId: config.get().room.roomId, mode: runtime.get().mode });
}

function bootstrap(): void {
  logger.info('app', `启动中 · Electron ${process.versions.electron} · Node ${process.versions.node}`);
  const dpapi = vault.selfTest();
  if (dpapi.ok) logger.info('secrets', `凭据加密自检：${dpapi.message}`);
  else logger.error('secrets', `凭据加密自检：${dpapi.message}`);
  protocol.handle('app', (request) => {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const relative = pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '');
    const target = path.normalize(path.join(rendererDir, relative));
    if (!target.startsWith(rendererDir)) return new Response('Forbidden', { status: 403 });
    // 使用 fs 而非 net.fetch：打包后渲染层位于 app.asar 内，fs 支持 asar 虚拟路径
    const data = fs.readFileSync(target);
    const type = MIME_TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream';
    return new Response(data, { headers: { 'Content-Type': type } });
  });

  mainWindow = createMainWindow(logger);
  tray = new TrayController(mainWindow, {
    onTogglePause: () => {
      const mode = runtime.get().mode;
      if (mode === 'readonly' || mode === 'budget_exhausted') engine.resume();
      else engine.pause();
    },
    onQuit: () => {
      quitting = true;
      app.quit();
    },
  });

  runtime.onChange((status) => {
    tray?.update(status.mode);
    persistState();
  });

  registerIpc({
    config,
    runtime,
    logger,
    vault,
    store,
    accounts,
    qr,
    browserImport,
    roomService,
    sender,
    persona,
    memory,
    model,
    budget,
    plugins,
    engine,
    conversations,
    events,
    dataDir,
    getWindow: () => mainWindow,
  });

  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });

  accounts.applyActive();
  logger.info('app', `数据目录：${dataDir}`);

  const saved = store.readJson<{ roomId: number; mode: RuntimeMode }>('state.json', { roomId: 0, mode: 'stopped' });
  const cfg = config.get();
  const targetRoom = cfg.room.roomId || saved.roomId;
  if (targetRoom) runtime.patch({ roomId: targetRoom });
  if (cfg.runtime.restoreLastState && targetRoom && (saved.mode === 'running' || saved.mode === 'waiting')) {
    logger.info('app', `恢复上次运行状态：房间 ${targetRoom}（${saved.mode}）`);
    setTimeout(() => {
      void engine.start(targetRoom);
    }, 1500);
  }

  setInterval(
    () => {
      engine.cleanup();
      logger.cleanup(config.get().retention.logsDays);
      usage.prune(config.get().retention.summaryDays);
    },
    60 * 60 * 1000,
  );
}

// 未打包运行时默认 app 名为 Electron，会与其它 Electron 应用共用 userData
// 并导致单实例锁误判，这里显式设置应用名
app.setName('BiliLiveAgent');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  logger.error('app', '单实例锁被占用，本次启动退出');
  app.quit();
} else {
  app.on('second-instance', () => {
    tray?.show();
  });
  app.whenReady().then(() => {
    try {
      bootstrap();
    } catch (error) {
      logger.error('app', `启动过程异常：${String(error)}`);
    }
    app.on('activate', () => tray?.show());
  });
  app.on('before-quit', () => {
    quitting = true;
    liveClient.stop();
    tray?.destroy();
  });
  // 关闭主窗口时已阻止默认关闭（隐藏到托盘），因此这里无需额外处理；
  // 真正退出只会通过托盘菜单的"退出应用"触发。
  app.on('window-all-closed', () => {
    if (!quitting) tray?.show();
  });
}
