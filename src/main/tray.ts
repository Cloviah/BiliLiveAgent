import { Menu, Tray, nativeImage, type BrowserWindow } from 'electron';
import type { RuntimeMode } from '../shared/types';
import { createAppIcon } from './utils/icon';

const MODE_LABEL: Record<RuntimeMode, string> = {
  stopped: '已停止',
  running: '运行中',
  readonly: '只读（暂停发送）',
  waiting: '等待开播',
  error: '异常',
  budget_exhausted: '预算耗尽（只读）',
};

export interface TrayCallbacks {
  onTogglePause: () => void;
  onQuit: () => void;
}

export class TrayController {
  private readonly tray: Tray;
  private mode: RuntimeMode = 'stopped';
  private paused = false;

  constructor(
    private readonly window: BrowserWindow,
    callbacks: TrayCallbacks,
  ) {
    this.tray = new Tray(nativeImage.createFromBuffer(createAppIcon(32)));
    this.tray.setToolTip('BiliLiveAgent');
    this.render(callbacks);
  }

  private render(callbacks: TrayCallbacks): void {
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: `BiliLiveAgent · ${MODE_LABEL[this.mode]}`, enabled: false },
      { type: 'separator' },
      {
        label: this.paused ? '恢复自动发言' : '暂停自动发言（只读）',
        click: () => callbacks.onTogglePause(),
      },
      { label: '打开主窗口', click: () => this.show() },
      { type: 'separator' },
      { label: '退出应用', click: () => callbacks.onQuit() },
    ];
    this.tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  private callbacks?: TrayCallbacks;

  setCallbacks(callbacks: TrayCallbacks): void {
    this.callbacks = callbacks;
    this.render(callbacks);
  }

  update(mode: RuntimeMode): void {
    this.mode = mode;
    this.paused = mode === 'readonly' || mode === 'budget_exhausted';
    this.tray.setToolTip(`BiliLiveAgent · ${MODE_LABEL[mode]}`);
    if (this.callbacks) this.render(this.callbacks);
  }

  show(): void {
    if (this.window.isDestroyed()) return;
    if (this.window.isVisible()) this.window.focus();
    else this.window.show();
  }

  destroy(): void {
    this.tray.destroy();
  }
}
