import { useState } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import type { AppCtx } from '../App';
import { api } from '../api/ipc-client';
import { Card } from '../components/ui';
import DanmakuStream from '../components/DanmakuStream';
import SendLog from '../components/SendLog';
import type { RoomMeta } from '../../shared/types';

export default function ConsolePage({ ctx }: { ctx: AppCtx }) {
  const { config, saveConfig, status } = ctx;
  const [roomId, setRoomId] = useState(String(config.room.roomId || ''));
  const [meta, setMeta] = useState<RoomMeta | undefined>(status?.room);
  const [loading, setLoading] = useState(false);
  const [testText, setTestText] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const personaName = status?.activePersona?.name ?? '未选择人格';

  const fetchMeta = () => {
    const id = Number(roomId);
    if (!id) {
      ctx.toast('请输入有效的直播间房号', 'bad');
      return;
    }
    setLoading(true);
    Promise.all([api.runtime.setRoom(id), api.room.info(id)])
      .then(([, info]) => {
        setMeta(info);
        void saveConfig({ room: { ...config.room, roomId: id } });
        ctx.toast(`已读取房间：${info.title || id}`);
      })
      .catch((error) => ctx.toast(`读取失败：${String(error)}`, 'bad'))
      .finally(() => setLoading(false));
  };

  const sendTest = () => {
    if (!testText.trim()) {
      ctx.toast('请输入要发送的内容', 'bad');
      return;
    }
    if (!confirmed) {
      ctx.toast('请先勾选确认，真实发送会发到直播间', 'bad');
      return;
    }
    api.send
      .test(testText.trim())
      .then(() => {
        ctx.toast('已加入发送队列，结果见下方记录');
        setTestText('');
        setConfirmed(false);
        setTimeout(ctx.refreshSends, 2500);
      })
      .catch(console.error);
  };

  return (
    <div className="space-y-4">
      <Card
        title="直播间"
        extra={
          <button type="button" className="btn-ghost" onClick={fetchMeta} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 读取房间信息
          </button>
        }
      >
        <div className="grid grid-cols-[220px_1fr] gap-4">
          <div className="space-y-2">
            <label className="label">直播间房号</label>
            <input
              className="input"
              value={roomId}
              inputMode="numeric"
              placeholder="例如 21452505"
              onChange={(e) => setRoomId(e.target.value.replace(/[^\d]/g, ''))}
            />
            <p className="text-[11px] leading-relaxed text-soft-sub/70">
              只读取公开弹幕与互动事件，不拉取也不播放直播音视频。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
            <Info label="标题" value={meta?.title || '—'} />
            <Info label="主播" value={meta?.anchorName || (meta?.anchorUid ? String(meta.anchorUid) : '—')} />
            <Info label="分区" value={meta ? `${meta.parentAreaName || '—'} / ${meta.areaName || '—'}` : '—'} />
            <Info
              label="状态"
              value={meta ? (meta.liveStatus === 1 ? `直播中 · 人气 ${meta.popularity}` : '未开播') : '—'}
            />
            <Info label="公告" value={meta?.description || '—'} span />
            <Info label="当前人格" value={personaName} />
            <Info
              label="当前频率"
              value={`最短间隔 ${Math.round(config.interaction.minSendIntervalMs / 1000)} 秒 · 每小时上限 ${config.interaction.maxSendPerHour} 条`}
            />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-[1fr_380px] gap-4">
        <Card title="实时弹幕流" className="min-h-[420px]">
          <DanmakuStream events={ctx.events} />
        </Card>

        <div className="space-y-4">
          <Card title="发送与拦截记录">
            <SendLog records={ctx.sends} />
          </Card>

          <Card title="手动试发（诊断用）">
            <div className="space-y-2">
              <input
                className="input"
                value={testText}
                placeholder="输入一条弹幕内容"
                onChange={(e) => setTestText(e.target.value)}
              />
              <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-relaxed text-soft-sub">
                <input
                  type="checkbox"
                  className="mt-0.5 cursor-pointer"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                我确认这会真实发送到当前直播间（房号 {config.room.roomId || '未设置'}）
              </label>
              <button type="button" className="btn-danger w-full justify-center" onClick={sendTest}>
                <Send size={14} /> 真实发送一条
              </button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value, span }: { label: string; value: string; span?: boolean }) {
  return (
    <div className={span ? 'col-span-2' : ''}>
      <div className="text-[11px] text-soft-sub/70">{label}</div>
      <div className="mt-0.5 truncate text-[13px] text-soft-text" title={value}>
        {value}
      </div>
    </div>
  );
}
