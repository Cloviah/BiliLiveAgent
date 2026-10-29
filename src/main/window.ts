import path from 'node:path';
import { BrowserWindow, nativeImage, shell } from 'electron';
import { createAppIcon } from './utils/icon';
import type { Logger } from './utils/logger';

export const RENDERER_URL = 'app://renderer/index.html';

export function createMainWindow(logger: Logger): BrowserWindow {
  const icon = nativeImage.createFromBuffer(createAppIcon(64));
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#0B1220',
    title: 'BiliLiveAgent',
    icon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // 渲染层加载失败或脚本报错时写入运行日志，便于在"设置与诊断"中排错
  window.webContents.on('did-fail-load', (_event, code, description) => {
    logger.error('renderer', `页面加载失败 code=${code} ${description}`);
  });
  // level: 1=info 2=warning 3=error
  window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) logger.error('renderer', message);
    else if (level === 2) logger.warn('renderer', message);
  });
  window.webContents.on('did-finish-load', () => {
    logger.debug('renderer', '界面加载完成');
  });

  const devUrl = process.env.ELECTRON_DEV_URL;
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadURL(RENDERER_URL);

  window.once('ready-to-show', () => window.show());
  return window;
}
