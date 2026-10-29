import type { ReactNode } from 'react';
import type { RuntimeMode } from '../../shared/types';

export function Card({
  title,
  extra,
  children,
  className = '',
}: {
  title?: string;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass p-4 shadow-card ${className}`}>
      {title ? (
        <header className="mb-3 flex items-center justify-between">
          <h2 className="section-title">{title}</h2>
          {extra}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] text-soft-sub/70">{hint}</span> : null}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'password';
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        className="input"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        className="input"
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
      <div>
        <div className="text-[13px] text-soft-text">{label}</div>
        {hint ? <div className="mt-0.5 text-[11px] text-soft-sub/70">{hint}</div> : null}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ${
          checked ? 'bg-neon-teal/70' : 'bg-white/15'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all duration-200 ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}

export function TagInput({
  label,
  values,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-ink-900/70 p-2">
        {values.map((value, index) => (
          <span key={`${value}-${index}`} className="chip bg-neon-blue/15 text-neon-blue">
            {value}
            <button
              type="button"
              className="cursor-pointer text-soft-sub hover:text-state-bad"
              onClick={() => onChange(values.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="min-w-[140px] flex-1 bg-transparent px-1 text-[13px] text-soft-text outline-none placeholder:text-soft-sub/50"
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const value = e.currentTarget.value.trim();
            if (!value) return;
            onChange([...values, value]);
            e.currentTarget.value = '';
          }}
        />
      </div>
    </Field>
  );
}

const MODE_STYLE: Record<RuntimeMode, { label: string; className: string }> = {
  stopped: { label: '已停止', className: 'bg-state-idle/20 text-state-idle' },
  running: { label: '运行中', className: 'bg-state-ok/20 text-state-ok' },
  readonly: { label: '只读暂停', className: 'bg-state-warn/20 text-state-warn' },
  waiting: { label: '等待开播', className: 'bg-neon-blue/20 text-neon-blue' },
  error: { label: '异常', className: 'bg-state-bad/20 text-state-bad' },
  budget_exhausted: { label: '预算耗尽', className: 'bg-neon-orange/20 text-neon-orange' },
};

export function StatusBadge({ mode }: { mode: RuntimeMode }) {
  const style = MODE_STYLE[mode] ?? MODE_STYLE.stopped;
  return (
    <span className={`chip gap-1.5 ${style.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${mode === 'running' ? 'animate-breathe' : ''}`} />
      {style.label}
    </span>
  );
}

const CONN_LABEL: Record<string, string> = {
  disconnected: '未连接',
  connecting: '连接中',
  connected: '已连接',
  reconnecting: '重连中',
};

export function ConnBadge({ conn }: { conn: string }) {
  const tone =
    conn === 'connected'
      ? 'bg-state-ok/20 text-state-ok'
      : conn === 'connecting' || conn === 'reconnecting'
        ? 'bg-state-warn/20 text-state-warn'
        : 'bg-state-idle/20 text-state-idle';
  return <span className={`chip ${tone}`}>弹幕 {CONN_LABEL[conn] ?? conn}</span>;
}
