import { useState } from 'react';
import { Filter } from 'lucide-react';
import type { EventKind, LiveEvent } from '../../shared/types';

const KIND_STYLE: Record<EventKind, { label: string; className: string }> = {
  danmaku: { label: '弹幕', className: 'bg-white/10 text-soft-sub' },
  mention: { label: '点名', className: 'bg-neon-teal/20 text-neon-teal' },
  superchat: { label: '醒目留言', className: 'bg-neon-orange/20 text-neon-orange' },
  gift: { label: '礼物', className: 'bg-neon-blue/20 text-neon-blue' },
  guard: { label: '上舰', className: 'bg-neon-orange/20 text-neon-orange' },
  interact: { label: '进入', className: 'bg-white/5 text-soft-sub/70' },
  live_status: { label: '开播', className: 'bg-state-ok/20 text-state-ok' },
};

const FILTERS: Array<{ key: 'all' | 'chat' | 'high'; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'chat', label: '仅聊天' },
  { key: 'high', label: '需回应' },
];

export default function DanmakuStream({ events }: { events: LiveEvent[] }) {
  const [filter, setFilter] = useState<'all' | 'chat' | 'high'>('all');

  // 最新消息固定显示在最上方，无需滚动即可看到新弹幕
  const visible = events
    .filter((e) => {
      if (filter === 'chat') return e.kind === 'danmaku' || e.kind === 'mention';
      if (filter === 'high') return e.priority === 'high' || e.triggered;
      return true;
    })
    .slice()
    .sort((a, b) => b.ts - a.ts);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[12px] text-soft-sub">
          <Filter size={13} /> 实时消息 · {visible.length} 条
        </div>
        <div className="flex gap-1">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={`cursor-pointer rounded-lg px-2.5 py-1 text-[12px] transition ${
                filter === item.key ? 'bg-neon-teal/20 text-neon-teal' : 'bg-white/5 text-soft-sub hover:bg-white/10'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-[280px] flex-1 space-y-1.5 overflow-y-auto pr-1">
        {visible.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-soft-sub/60">
            还没有收到弹幕，连接直播间后这里会实时显示
          </div>
        ) : (
          visible.map((event) => {
            const style = KIND_STYLE[event.kind] ?? KIND_STYLE.danmaku;
            return (
              <div
                key={event.id}
                className="animate-fade-up rounded-xl border border-white/5 bg-white/[0.04] px-3 py-2 transition hover:bg-white/[0.07]"
              >
                <div className="flex items-center gap-2 text-[11px] text-soft-sub">
                  <span className={`chip ${style.className}`}>{style.label}</span>
                  <span className="font-medium text-soft-text/90">{event.uname}</span>
                  <span className="text-soft-sub/50">UID {event.uid}</span>
                  <span className="ml-auto tabular-nums text-soft-sub/60">
                    {new Date(event.ts).toLocaleTimeString('zh-CN', { hour12: false })}
                  </span>
                </div>
                <p className="mt-1 break-all text-[13px] leading-relaxed text-soft-text">{event.text}</p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
