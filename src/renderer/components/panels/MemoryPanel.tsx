import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { AppCtx } from '../../App';
import { api } from '../../api/ipc-client';
import { Card, NumberField, Toggle } from '../ui';
import type { AppConfig } from '../../../shared/types';

export default function MemoryPanel({ ctx }: { ctx: AppCtx }) {
  const { config, saveConfig } = ctx;
  const m = config.memory;
  const patch = (next: Partial<AppConfig['memory']>) => saveConfig({ memory: { ...m, ...next } });
  const [stats, setStats] = useState<{ summaryChars: number; userCount: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const next = await api.memory.stats().catch(() => null);
    if (next) setStats(next);
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <Card title="记忆自动整理">
      <Toggle
        label="自动整理记忆"
        checked={m.autoCompress}
        onChange={(autoCompress) => patch({ autoCompress })}
        hint="房间摘要过长时压缩成要点，并归档长期没有互动的观众记忆，避免提示词越来越长、token 越烧越多"
      />

      <div className="mt-3 grid grid-cols-2 gap-3">
        <NumberField
          label="摘要触发字数"
          value={m.maxSummaryChars}
          min={200}
          step={100}
          onChange={(maxSummaryChars) => patch({ maxSummaryChars })}
          hint="房间摘要超过这个字数就整理一次"
        />
        <NumberField
          label="压缩后保留要点数"
          value={m.keepBullets}
          min={2}
          max={12}
          step={1}
          onChange={(keepBullets) => patch({ keepBullets })}
        />
        <NumberField
          label="观众记忆归档天数"
          value={m.staleUserDays}
          min={0}
          step={1}
          onChange={(staleUserDays) => patch({ staleUserDays })}
          hint="超过这么多天没互动就归档，0 = 不归档"
        />
        <NumberField
          label="整理间隔（分钟）"
          value={Math.round(m.intervalMs / 60_000)}
          min={10}
          step={10}
          onChange={(minutes) => patch({ intervalMs: Math.max(1, minutes) * 60_000 })}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const result = await api.memory.compress().catch(() => null);
            setBusy(false);
            ctx.toast(result?.message ?? '整理完成');
            void refresh();
          }}
        >
          <Sparkles size={14} /> {busy ? '整理中…' : '立即整理一次'}
        </button>
        <span className="text-[11px] text-soft-sub/70">
          {stats
            ? `当前：房间摘要 ${stats.summaryChars} 字 · 观众记忆 ${stats.userCount} 条`
            : '读取记忆规模…'}
        </span>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-soft-sub/70">
        压缩是一次额外的小额模型调用；预算耗尽时会自动跳过压缩，只做本地裁剪，不会丢记忆。
        也可在「记忆」页手动查看、修改或删除任意一条。
      </p>
    </Card>
  );
}
