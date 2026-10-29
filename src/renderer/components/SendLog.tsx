import type { SendRecord } from '../../shared/types';

const STATUS: Record<SendRecord['status'], { label: string; className: string }> = {
  sent: { label: '已发送', className: 'bg-state-ok/20 text-state-ok' },
  blocked: { label: '已拦截', className: 'bg-state-warn/20 text-state-warn' },
  rejected: { label: '被风控', className: 'bg-neon-orange/20 text-neon-orange' },
  failed: { label: '失败', className: 'bg-state-bad/20 text-state-bad' },
};

export default function SendLog({ records }: { records: SendRecord[] }) {
  // 最新记录显示在最上方，与弹幕流保持一致
  const sorted = records.slice().sort((a, b) => b.ts - a.ts);
  return (
    <div className="max-h-[280px] space-y-1.5 overflow-y-auto pr-1">
      {sorted.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-[12px] text-soft-sub/60">
          暂无发送记录；被限频或安全规则拦截的内容也会记录在这里
        </div>
      ) : (
        sorted.map((record) => {
          const style = STATUS[record.status] ?? STATUS.blocked;
          return (
            <div key={record.id} className="rounded-xl border border-white/5 bg-white/[0.04] px-3 py-2">
              <div className="flex items-center gap-2 text-[11px] text-soft-sub">
                <span className={`chip ${style.className}`}>{style.label}</span>
                <span className="truncate">{record.reason || '未标注原因'}</span>
                <span className="ml-auto tabular-nums text-soft-sub/60">
                  {new Date(record.ts).toLocaleTimeString('zh-CN', { hour12: false })}
                </span>
              </div>
              <p className="mt-1 break-all text-[13px] text-soft-text">{record.text}</p>
              {record.detail ? <p className="mt-0.5 text-[11px] text-soft-sub/70">{record.detail}</p> : null}
            </div>
          );
        })
      )}
    </div>
  );
}
