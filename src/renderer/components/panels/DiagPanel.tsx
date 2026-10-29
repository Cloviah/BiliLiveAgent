import { useState } from 'react';
import { Stethoscope } from 'lucide-react';
import type { AppCtx } from '../../App';
import { api } from '../../api/ipc-client';
import { Card } from '../ui';

const SCOPES = [
  { key: 'secrets', label: '凭据加密' },
  { key: 'account', label: 'B 站账号' },
  { key: 'room', label: '直播间可达' },
  { key: 'model', label: 'DeepSeek 连通' },
];

export default function DiagPanel({ ctx }: { ctx: AppCtx }) {
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [running, setRunning] = useState('');

  const run = (scope: string) => {
    setRunning(scope);
    api.diag
      .run(scope)
      .then((result) => setResults((prev) => ({ ...prev, [scope]: { ok: result.ok, message: result.message } })))
      .catch(console.error)
      .finally(() => setRunning(''));
  };

  return (
    <div className="space-y-4">
      <Card title="诊断">
        <div className="flex flex-wrap gap-2">
          {SCOPES.map((scope) => (
            <button
              key={scope.key}
              type="button"
              className="btn-ghost"
              onClick={() => run(scope.key)}
              disabled={running === scope.key}
            >
              <Stethoscope size={14} /> {running === scope.key ? '检测中…' : scope.label}
            </button>
          ))}
        </div>
        <div className="mt-3 space-y-1.5">
          {SCOPES.map((scope) => {
            const result = results[scope.key];
            if (!result) return null;
            return (
              <div
                key={scope.key}
                className={`rounded-xl border px-3 py-2 text-[12px] ${
                  result.ok ? 'border-state-ok/30 bg-state-ok/10 text-state-ok' : 'border-state-bad/30 bg-state-bad/10 text-state-bad'
                }`}
              >
                <span className="font-medium">{scope.label}</span>：{result.message}
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="运行日志（最新在前）">
        <div className="max-h-[320px] space-y-1 overflow-y-auto pr-1 font-mono text-[11px]">
          {ctx.logs.length === 0 ? (
            <p className="text-soft-sub/60">暂无日志。</p>
          ) : (
            ctx.logs.map((entry, index) => (
              <div key={`${entry.ts}-${index}`} className="flex gap-2 rounded-lg px-2 py-1 hover:bg-white/5">
                <span className="text-soft-sub/50">
                  {new Date(entry.ts).toLocaleTimeString('zh-CN', { hour12: false })}
                </span>
                <span
                  className={
                    entry.level === 'error'
                      ? 'text-state-bad'
                      : entry.level === 'warn'
                        ? 'text-state-warn'
                        : 'text-soft-sub'
                  }
                >
                  [{entry.level}]
                </span>
                <span className="text-soft-sub/60">{entry.scope}</span>
                <span className="flex-1 text-soft-text/90">{entry.message}</span>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
