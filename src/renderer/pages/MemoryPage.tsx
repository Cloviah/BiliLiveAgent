import { useEffect, useState } from 'react';
import { Save, Search, Trash2 } from 'lucide-react';
import type { AppCtx } from '../App';
import { api } from '../api/ipc-client';
import { Card } from '../components/ui';
import type { RoomMemory, UserMemory } from '../../shared/types';

export default function MemoryPage({ ctx }: { ctx: AppCtx }) {
  const [keyword, setKeyword] = useState('');
  const [room, setRoom] = useState<RoomMemory | undefined>();
  const [users, setUsers] = useState<UserMemory[]>([]);
  const [summary, setSummary] = useState('');
  const [editing, setEditing] = useState<UserMemory | undefined>();

  const reload = (kw = keyword) => {
    api.memory
      .list(kw)
      .then((data) => {
        setRoom(data.room);
        setUsers(data.users);
        setSummary(data.room?.summary ?? '');
      })
      .catch(console.error);
  };

  useEffect(() => {
    reload('');
  }, []);

  const saveRoom = () => {
    api.memory.saveRoom(summary).then(() => {
      ctx.toast('房间摘要已保存');
      reload();
    }).catch(console.error);
  };

  const saveUser = () => {
    if (!editing) return;
    api.memory
      .saveUser({ uid: editing.uid, uname: editing.uname, note: editing.note })
      .then(() => {
        ctx.toast('观众记忆已更新');
        setEditing(undefined);
        reload();
      })
      .catch(console.error);
  };

  return (
    <div className="space-y-4">
      <Card
        title={`房间摘要 · ${ctx.config.room.roomId || '未设置房号'}`}
        extra={
          <button type="button" className="btn-primary" onClick={saveRoom}>
            <Save size={14} /> 保存摘要
          </button>
        }
      >
        <textarea
          className="input min-h-[120px] resize-y"
          value={summary}
          placeholder="记录这个直播间的常态：主播风格、常见话题、观众偏好等"
          onChange={(e) => setSummary(e.target.value)}
        />
        {room?.updatedAt ? (
          <p className="mt-2 text-[11px] text-soft-sub/70">
            最近更新：{new Date(room.updatedAt).toLocaleString('zh-CN', { hour12: false })}
          </p>
        ) : null}
      </Card>

      <Card
        title="观众记忆（按 UID）"
        extra={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-2.5 text-soft-sub/60" />
              <input
                className="input w-[220px] pl-8"
                value={keyword}
                placeholder="搜索昵称 / UID / 备注"
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') reload(keyword);
                }}
              />
            </div>
            <button type="button" className="btn-ghost" onClick={() => reload(keyword)}>
              搜索
            </button>
          </div>
        }
      >
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-ink-800/90 text-soft-sub">
              <tr className="text-left">
                <th className="px-2 py-2 font-medium">UID</th>
                <th className="px-2 py-2 font-medium">昵称</th>
                <th className="px-2 py-2 font-medium">公开互动记忆</th>
                <th className="px-2 py-2 font-medium">最近互动</th>
                <th className="px-2 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-6 text-center text-soft-sub/60">
                    暂无观众记忆；智能体学到观众的公开偏好后会自动记录
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.uid} className="border-t border-white/5 hover:bg-white/5">
                    <td className="px-2 py-2 tabular-nums text-soft-sub">{user.uid}</td>
                    <td className="px-2 py-2 text-soft-text">{user.uname}</td>
                    <td className="px-2 py-2 text-soft-text/90">{user.note || '—'}</td>
                    <td className="px-2 py-2 text-soft-sub/70">
                      {new Date(user.lastSeen).toLocaleString('zh-CN', { hour12: false })}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1 text-[11px]"
                          onClick={() => setEditing({ ...user })}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1 text-[11px] text-state-bad"
                          onClick={() => {
                            api.memory.deleteUser(user.uid).then(() => {
                              ctx.toast('已删除该观众记忆');
                              reload();
                            }).catch(console.error);
                          }}
                        >
                          <Trash2 size={12} /> 删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {editing ? (
        <Card title={`编辑观众记忆 · ${editing.uname || editing.uid}`}>
          <div className="grid grid-cols-[120px_1fr] gap-3">
            <label className="block space-y-1.5">
              <span className="label">UID</span>
              <input className="input" value={editing.uid} readOnly />
            </label>
            <label className="block space-y-1.5">
              <span className="label">昵称</span>
              <input
                className="input"
                value={editing.uname}
                onChange={(e) => setEditing({ ...editing, uname: e.target.value })}
              />
            </label>
          </div>
          <label className="mt-3 block space-y-1.5">
            <span className="label">公开互动记忆</span>
            <textarea
              className="input min-h-[80px] resize-y"
              value={editing.note}
              onChange={(e) => setEditing({ ...editing, note: e.target.value })}
            />
          </label>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn-primary" onClick={saveUser}>
              <Save size={14} /> 保存
            </button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(undefined)}>
              取消
            </button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
