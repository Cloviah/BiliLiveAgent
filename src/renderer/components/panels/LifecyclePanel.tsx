import { Plus, Trash2 } from 'lucide-react';
import type { AppCtx } from '../../App';
import { Card, NumberField, Toggle } from '../ui';
import type { AppConfig, ScheduleWindow } from '../../../shared/types';

const DAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

export default function LifecyclePanel({ ctx }: { ctx: AppCtx }) {
  const { config, saveConfig } = ctx;
  const runtime = config.runtime;
  const schedule = config.schedule;
  const room = config.room;

  const patchSchedule = (patch: Partial<AppConfig['schedule']>) => saveConfig({ schedule: { ...schedule, ...patch } });

  const updateWindow = (index: number, patch: Partial<ScheduleWindow>) => {
    patchSchedule({ windows: schedule.windows.map((w, idx) => (idx === index ? { ...w, ...patch } : w)) });
  };

  return (
    <Card title="房间生命周期">
      <div className="space-y-2">
        <Toggle
          label="启动时恢复上次房间与运行状态"
          checked={runtime.restoreLastState}
          onChange={(restoreLastState) => saveConfig({ runtime: { ...runtime, restoreLastState } })}
        />
        <Toggle
          label="断线自动重连（指数退避）"
          checked={runtime.autoReconnect}
          onChange={(autoReconnect) => saveConfig({ runtime: { ...runtime, autoReconnect } })}
        />
        <Toggle
          label="跟随开播状态"
          checked={room.autoFollowLive}
          onChange={(autoFollowLive) => saveConfig({ room: { ...room, autoFollowLive } })}
          hint="未开播时低频等待，开播后自动连接；下播回到等待"
        />
        <Toggle
          label="按计划时段运行"
          checked={schedule.enabled}
          onChange={(enabled) => patchSchedule({ enabled })}
        />

        {schedule.enabled ? (
          <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
            {schedule.windows.length === 0 ? (
              <p className="text-[12px] text-soft-sub/60">尚未添加运行时段。</p>
            ) : (
              schedule.windows.map((window, index) => (
                <div key={index} className="space-y-2 border-b border-white/5 pb-2 last:border-0">
                  <div className="flex items-center gap-1.5">
                    {DAY_LABELS.map((label, day) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => {
                          const days = window.days.includes(day)
                            ? window.days.filter((d) => d !== day)
                            : [...window.days, day];
                          updateWindow(index, { days });
                        }}
                        className={`h-7 w-7 cursor-pointer rounded-lg text-[12px] transition ${
                          window.days.includes(day)
                            ? 'bg-neon-teal/20 text-neon-teal'
                            : 'bg-white/5 text-soft-sub hover:bg-white/10'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="btn-ghost ml-auto px-2 py-1 text-[11px]"
                      onClick={() => patchSchedule({ windows: schedule.windows.filter((_, idx) => idx !== index) })}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block space-y-1">
                      <span className="label">开始</span>
                      <input
                        className="input"
                        value={window.start}
                        onChange={(e) => updateWindow(index, { start: e.target.value })}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="label">结束</span>
                      <input
                        className="input"
                        value={window.end}
                        onChange={(e) => updateWindow(index, { end: e.target.value })}
                      />
                    </label>
                  </div>
                </div>
              ))
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => patchSchedule({ windows: [...schedule.windows, { days: [1, 2, 3, 4, 5], start: '20:00', end: '23:59' }] })}
              >
                <Plus size={14} /> 添加时段
              </button>
              <label className="ml-auto flex items-center gap-2 text-[12px] text-soft-sub">
                时段外行为
                <select
                  className="input w-[120px]"
                  value={schedule.outsideMode}
                  onChange={(e) => patchSchedule({ outsideMode: e.target.value as 'readonly' | 'stopped' })}
                >
                  <option value="readonly" className="bg-ink-800">
                    只读
                  </option>
                  <option value="stopped" className="bg-ink-800">
                    停止
                  </option>
                </select>
              </label>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function RetentionCard({ ctx }: { ctx: AppCtx }) {
  const { config, saveConfig } = ctx;
  const retention = config.retention;
  const patch = (key: keyof AppConfig['retention'], value: number) =>
    saveConfig({ retention: { ...retention, [key]: value } });

  return (
    <Card title="数据保留">
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="弹幕原文保留天数"
          value={retention.eventsDays}
          min={1}
          max={90}
          onChange={(v) => patch('eventsDays', v)}
        />
        <NumberField
          label="运行日志保留天数"
          value={retention.logsDays}
          min={1}
          max={90}
          onChange={(v) => patch('logsDays', v)}
        />
        <NumberField
          label="房间摘要保留天数"
          value={retention.summaryDays}
          min={7}
          max={365}
          onChange={(v) => patch('summaryDays', v)}
        />
        <NumberField
          label="观众记忆保留天数"
          value={retention.memoryDays}
          min={7}
          max={365}
          onChange={(v) => patch('memoryDays', v)}
        />
      </div>
    </Card>
  );
}
