import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Brain, Sparkles, Settings as SettingsIcon } from 'lucide-react';
import { api } from './api/ipc-client';
import StatusBar from './components/StatusBar';
import ConsolePage from './pages/ConsolePage';
import PersonaPage from './pages/PersonaPage';
import MemoryPage from './pages/MemoryPage';
import SettingsPage from './pages/SettingsPage';
import type {
  AppConfig,
  BiliAccount,
  LiveEvent,
  LogEntry,
  RuntimeStatus,
  SendRecord,
  UsageStats,
} from '../shared/types';

export interface AppCtx {
  config: AppConfig;
  saveConfig: (patch: Partial<AppConfig>) => Promise<void>;
  status?: RuntimeStatus;
  accounts: BiliAccount[];
  refreshAccounts: () => void;
  usage?: UsageStats;
  refreshUsage: () => void;
  logs: LogEntry[];
  events: LiveEvent[];
  sends: SendRecord[];
  refreshSends: () => void;
  toast: (message: string, tone?: 'ok' | 'bad') => void;
}

const NAV = [
  { key: 'console', label: '直播控制台', icon: Activity },
  { key: 'persona', label: '人格管理', icon: Sparkles },
  { key: 'memory', label: '记忆管理', icon: Brain },
  { key: 'settings', label: '设置与诊断', icon: SettingsIcon },
] as const;

type PageKey = (typeof NAV)[number]['key'];

export default function App() {
  const [page, setPage] = useState<PageKey>('console');
  const [config, setConfig] = useState<AppConfig | undefined>();
  const [status, setStatus] = useState<RuntimeStatus | undefined>();
  const [accounts, setAccounts] = useState<BiliAccount[]>([]);
  const [usage, setUsage] = useState<UsageStats | undefined>();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [sends, setSends] = useState<SendRecord[]>([]);
  const [toastState, setToast] = useState<{ message: string; tone: 'ok' | 'bad' } | undefined>();

  const toast = useCallback((message: string, tone: 'ok' | 'bad' = 'ok') => {
    setToast({ message, tone });
    setTimeout(() => setToast(undefined), 2600);
  }, []);

  const refreshAccounts = useCallback(() => {
    api.account.list().then(setAccounts).catch(console.error);
  }, []);

  const refreshUsage = useCallback(() => {
    api.usage.get().then(setUsage).catch(console.error);
  }, []);

  const refreshSends = useCallback(() => {
    api.send.recent(60).then((list) => setSends([...list].reverse())).catch(console.error);
  }, []);

  useEffect(() => {
    api.config.get().then(setConfig).catch(console.error);
    api.runtime.status().then(setStatus).catch(console.error);
    api.usage.get().then(setUsage).catch(console.error);
    api.logs.get(120).then((list) => setLogs([...list].reverse())).catch(console.error);
    api.send.recent(60).then((list) => setSends([...list].reverse())).catch(console.error);
    refreshAccounts();
  }, [refreshAccounts]);

  useEffect(() => {
    const offStatus = api.on.status((payload) => setStatus(payload));
    const offEvents = api.on.events((payload) =>
      setEvents((prev) => [...prev, ...payload].slice(-200)),
    );
    const offSend = api.on.send((payload) => setSends((prev) => [payload, ...prev].slice(0, 120)));
    const offStats = api.on.stats(() => refreshUsage());
    const offLogs = api.on.logs((entry) => setLogs((prev) => [entry, ...prev].slice(0, 200)));
    const offAccounts = api.on.accounts(setAccounts);
    return () => {
      offStatus();
      offEvents();
      offSend();
      offStats();
      offLogs();
      offAccounts();
    };
  }, [refreshUsage]);

  const saveConfig = useCallback(async (patch: Partial<AppConfig>) => {
    const next = await api.config.save(patch);
    setConfig(next);
  }, []);

  const start = useCallback(() => {
    if (!config?.room.roomId) {
      toast('请先在控制台填写直播间房号', 'bad');
      return;
    }
    api.runtime
      .start(config.room.roomId)
      .then((res) => toast(res.ok ? res.message : `启动失败：${res.message}`, res.ok ? 'ok' : 'bad'))
      .catch(console.error);
  }, [config, toast]);

  const stop = useCallback(() => {
    api.runtime.stop().then(() => toast('已停止监听与互动')).catch(console.error);
  }, [toast]);

  const togglePause = useCallback(() => {
    const mode = status?.mode;
    if (mode === 'readonly' || mode === 'budget_exhausted') {
      api.runtime.resume().then(() => toast('已恢复自动发言')).catch(console.error);
    } else {
      api.runtime.pause().then(() => toast('已切换为只读，仅继续读取')).catch(console.error);
    }
  }, [status, toast]);

  const ctx: AppCtx | undefined = useMemo(() => {
    if (!config) return undefined;
    return {
      config,
      saveConfig,
      status,
      accounts,
      refreshAccounts,
      usage,
      refreshUsage,
      logs,
      events,
      sends,
      refreshSends,
      toast,
    };
  }, [config, saveConfig, status, accounts, refreshAccounts, usage, refreshUsage, logs, events, sends, refreshSends, toast]);

  return (
    <div className="flex h-full">
      <nav className="flex w-[212px] shrink-0 flex-col gap-1 border-r border-white/10 bg-ink-900/60 p-3">
        <div className="px-2 py-3">
          <div className="text-[13px] font-semibold tracking-wide text-neon-teal">BiliLiveAgent</div>
          <div className="mt-0.5 text-[11px] text-soft-sub/70">直播间弹幕智能体</div>
        </div>
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = page === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setPage(item.key)}
              className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] transition-all duration-200 ${
                active
                  ? 'bg-neon-teal/15 text-neon-teal shadow-glow'
                  : 'text-soft-sub hover:bg-white/5 hover:text-soft-text'
              }`}
            >
              <Icon size={16} />
              {item.label}
            </button>
          );
        })}
        <div className="mt-auto rounded-xl border border-white/10 bg-white/5 p-3 text-[11px] leading-relaxed text-soft-sub/70">
          关闭窗口会缩到系统托盘，程序继续在后台运行；需要完全退出请使用托盘菜单。
        </div>
      </nav>

      <main className="flex h-full flex-1 flex-col overflow-hidden">
        <div className="px-5 pt-4">
          <StatusBar status={status} onStart={start} onStop={stop} onTogglePause={togglePause} />
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-5 pt-4">
          {ctx ? (
            page === 'console' ? (
              <ConsolePage ctx={ctx} />
            ) : page === 'persona' ? (
              <PersonaPage ctx={ctx} />
            ) : page === 'memory' ? (
              <MemoryPage ctx={ctx} />
            ) : (
              <SettingsPage ctx={ctx} />
            )
          ) : (
            <div className="flex h-full items-center justify-center text-[13px] text-soft-sub">
              正在加载本地配置…
            </div>
          )}
        </div>
      </main>

      {toastState ? (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 animate-fade-up rounded-xl border px-4 py-2 text-[13px] shadow-card backdrop-blur-xl ${
            toastState.tone === 'ok'
              ? 'border-neon-teal/40 bg-neon-teal/15 text-neon-teal'
              : 'border-state-bad/40 bg-state-bad/15 text-state-bad'
          }`}
        >
          {toastState.message}
        </div>
      ) : null}
    </div>
  );
}
