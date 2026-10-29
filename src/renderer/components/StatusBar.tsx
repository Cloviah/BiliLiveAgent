import { Activity, Pause, Play, Square, Users } from 'lucide-react';
import type { RuntimeStatus } from '../../shared/types';
import { ConnBadge, StatusBadge } from './ui';

export default function StatusBar({
  status,
  onStart,
  onStop,
  onTogglePause,
}: {
  status?: RuntimeStatus;
  onStart: () => void;
  onStop: () => void;
  onTogglePause: () => void;
}) {
  const mode = status?.mode ?? 'stopped';
  const running = mode === 'running' || mode === 'waiting';
  const paused = mode === 'readonly' || mode === 'budget_exhausted';
  const room = status?.room;

  return (
    <header className="glass flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 shadow-card">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-neon-teal/15 text-neon-teal shadow-glow">
          <Activity size={18} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[15px] font-semibold tracking-wide">BiliLiveAgent</h1>
            <StatusBadge mode={mode} />
            <ConnBadge conn={status?.conn ?? 'disconnected'} />
          </div>
          <p className="mt-0.5 text-[12px] text-soft-sub">
            {room ? (
              <>
                房间 {room.roomId} · {room.anchorName || '主播未知'} · {room.title || '（无标题）'}
              </>
            ) : status?.roomId ? (
              <>房间 {status.roomId} · 等待元数据</>
            ) : (
              '尚未设置直播间房号'
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="chip gap-1.5 bg-white/5 text-soft-sub">
          <Users size={12} /> 弹幕 {status?.eventsPerMinute ?? 0}/分钟
        </span>
        {running ? (
          <>
            <button type="button" className="btn-ghost" onClick={onTogglePause}>
              <Pause size={14} /> 只读暂停
            </button>
            <button type="button" className="btn-danger" onClick={onStop}>
              <Square size={14} /> 停止
            </button>
          </>
        ) : (
          <>
            {paused ? (
              <button type="button" className="btn-primary" onClick={onTogglePause}>
                <Play size={14} /> 恢复发言
              </button>
            ) : null}
            <button type="button" className="btn-primary" onClick={onStart}>
              <Play size={14} /> 开始
            </button>
          </>
        )}
      </div>
    </header>
  );
}
