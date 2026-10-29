import { useEffect, useRef, useState } from 'react';
import { Check, Globe, QrCode, RefreshCw, Trash2 } from 'lucide-react';
import type { AppCtx } from '../../App';
import { api } from '../../api/ipc-client';
import { Card } from '../ui';

export default function AccountPanel({ ctx }: { ctx: AppCtx }) {
  const [qr, setQr] = useState<{ key: string; image: string } | undefined>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const stopPolling = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = undefined;
  };

  useEffect(() => stopPolling, []);

  const startQr = () => {
    setBusy(true);
    setMessage('正在获取二维码…');
    api.account
      .qrStart()
      .then((session) => {
        setQr({ key: session.key, image: session.image });
        setMessage('请用 B 站手机客户端扫码，确认时建议选择“记住我/长期”');
        stopPolling();
        timer.current = window.setInterval(() => {
          api.account
            .qrPoll(session.key)
            .then((state) => {
              setMessage(state.message);
              if (state.state === 'success') {
                stopPolling();
                setQr(undefined);
                ctx.refreshAccounts();
                ctx.toast(`已登录：${state.uname ?? ''}`);
              }
              if (state.state === 'expired' || state.state === 'error') {
                stopPolling();
                setQr(undefined);
              }
            })
            .catch(console.error);
        }, 2000);
      })
      .catch((error) => {
        setMessage(`二维码获取失败：${String(error)}`);
      })
      .finally(() => setBusy(false));
  };

  const importBrowser = () => {
    setBusy(true);
    setMessage('正在检测本机浏览器登录态…');
    api.account
      .browserImport()
      .then((list) => {
        ctx.refreshAccounts();
        setMessage(list.length ? `已导入 ${list.length} 个账号，请选择要激活的账号` : '没有找到可用的 B 站登录态');
      })
      .catch((error) => setMessage(`导入失败：${String(error)}`))
      .finally(() => setBusy(false));
  };

  return (
    <Card title="B 站账号">
      <div className="grid grid-cols-[200px_1fr] gap-4">
        <div className="flex flex-col items-center gap-2">
          {qr ? (
            <img src={qr.image} alt="B站登录二维码" className="w-[180px] rounded-xl border border-white/10" />
          ) : (
            <div className="flex h-[180px] w-[180px] items-center justify-center rounded-xl border border-dashed border-white/15 text-[12px] text-soft-sub/60">
              二维码区域
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-primary" onClick={startQr} disabled={busy}>
              <QrCode size={14} /> 扫码登录
            </button>
            <button type="button" className="btn-ghost" onClick={importBrowser} disabled={busy}>
              <Globe size={14} /> 浏览器导入
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[12px] text-soft-sub">{message || '登录态只以加密形式保存在本机，不上传任何服务器。'}</p>
          <div className="space-y-1.5">
            {ctx.accounts.length === 0 ? (
              <p className="text-[12px] text-soft-sub/60">尚未添加账号；自动发言前必须登录一个账号。</p>
            ) : (
              ctx.accounts.map((account) => (
                <div
                  key={account.uid}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                >
                  <span className="text-[13px] text-soft-text">{account.uname || `UID ${account.uid}`}</span>
                  <span className="chip bg-white/10 text-soft-sub">UID {account.uid}</span>
                  <span className="chip bg-white/10 text-soft-sub">
                    {account.source === 'qrcode' ? '扫码' : '浏览器'}
                  </span>
                  {account.isActive ? <span className="chip bg-state-ok/20 text-state-ok">已激活</span> : null}
                  {account.expired ? <span className="chip bg-state-bad/20 text-state-bad">已失效</span> : null}
                  <div className="ml-auto flex gap-1.5">
                    {account.isActive ? null : (
                      <button
                        type="button"
                        className="btn-ghost px-2 py-1 text-[11px]"
                        onClick={() => api.account.activate(account.uid).then(ctx.refreshAccounts).catch(console.error)}
                      >
                        <Check size={12} /> 激活
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-ghost px-2 py-1 text-[11px]"
                      onClick={() =>
                        api.account
                          .verify(account.uid)
                          .then((res) => ctx.toast(res.message, res.ok ? 'ok' : 'bad'))
                          .catch(console.error)
                      }
                    >
                      <RefreshCw size={12} /> 校验
                    </button>
                    <button
                      type="button"
                      className="btn-ghost px-2 py-1 text-[11px] text-state-bad"
                      onClick={() => api.account.remove(account.uid).then(ctx.refreshAccounts).catch(console.error)}
                    >
                      <Trash2 size={12} /> 移除
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
