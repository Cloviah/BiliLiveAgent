import { useEffect, useState } from 'react';
import { KeyRound, Plug, Search } from 'lucide-react';
import type { AppCtx } from '../../App';
import { api } from '../../api/ipc-client';
import { Card, NumberField, TextField, Toggle } from '../ui';
import type { AppConfig } from '../../../shared/types';

const PROVIDERS: Array<{ value: AppConfig['plugins']['webSearch']['provider']; label: string; needKey: boolean }> = [
  { value: 'bing', label: 'Bing（免密钥，直接可用）', needKey: false },
  { value: 'tavily', label: 'Tavily（需 API Key）', needKey: true },
  { value: 'serper', label: 'Serper / Google（需 API Key）', needKey: true },
  { value: 'bocha', label: '博查 Bocha（需 API Key）', needKey: true },
];

export default function PluginPanel({ ctx }: { ctx: AppCtx }) {
  const { config, saveConfig } = ctx;
  const p = config.plugins;
  const ws = p.webSearch;
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [query, setQuery] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [usedToday, setUsedToday] = useState(0);

  useEffect(() => {
    api.secret.has('websearch_api_key').then(setHasKey).catch(console.error);
    api.plugin.usage().then((u) => setUsedToday(u.usedToday)).catch(console.error);
  }, []);

  const patch = (patchValue: Partial<AppConfig['plugins']>) => saveConfig({ plugins: { ...p, ...patchValue } });
  const patchSearch = (patchValue: Partial<AppConfig['plugins']['webSearch']>) =>
    patch({ webSearch: { ...ws, ...patchValue } });

  const saveKey = () => {
    api.secret
      .set('websearch_api_key', apiKey.trim())
      .then((ok) => {
        if (!ok) {
          ctx.toast('密钥加密保存失败，请检查 DPAPI 是否可用', 'bad');
          return;
        }
        setApiKey('');
        setHasKey(true);
        ctx.toast('搜索 API Key 已加密保存');
      })
      .catch(console.error);
  };

  const runTest = () => {
    if (!query.trim()) {
      ctx.toast('先输入一个搜索关键词', 'bad');
      return;
    }
    setTesting(true);
    setResult(null);
    api.plugin
      .searchTest(query.trim())
      .then((r) => {
        setResult(r);
        api.plugin.usage().then((u) => setUsedToday(u.usedToday)).catch(console.error);
      })
      .catch(console.error)
      .finally(() => setTesting(false));
  };

  const provider = PROVIDERS.find((item) => item.value === ws.provider) ?? PROVIDERS[0];

  return (
    <div className="space-y-4">
      <Card title="插件与联网搜索">
        <div className="grid grid-cols-2 gap-3">
          <Toggle
            label="启用插件系统"
            checked={p.enabled}
            onChange={(enabled) => patch({ enabled })}
            hint="启用后模型才能在需要时调用工具"
          />
          <Toggle
            label="联网搜索"
            checked={ws.enabled}
            onChange={(enabled) => patchSearch({ enabled })}
            hint="只在涉及时效性或事实性问题时才会用到"
          />

          <label className="col-span-2 block space-y-1.5">
            <span className="label">搜索提供方</span>
            <select
              className="input"
              value={ws.provider}
              onChange={(e) => patchSearch({ provider: e.target.value as AppConfig['plugins']['webSearch']['provider'] })}
            >
              {PROVIDERS.map((item) => (
                <option key={item.value} value={item.value} className="bg-ink-800">
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          {provider.needKey ? (
            <div className="col-span-2">
              <TextField
                label="搜索 API Key"
                type="password"
                value={apiKey}
                onChange={setApiKey}
                placeholder={hasKey ? '已保存密钥，留空表示不修改' : '填写对应平台的 API Key'}
                hint="DPAPI 加密保存在本机，导出数据时不包含密钥"
              />
              <button type="button" className="btn-primary mt-2" onClick={saveKey}>
                <KeyRound size={14} /> 保存密钥
              </button>
            </div>
          ) : (
            <p className="col-span-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] leading-relaxed text-soft-sub/80">
              Bing 通道直接抓取公开搜索结果页，不需要任何密钥；若你的网络无法访问 Bing，可换成带 Key 的提供方。
            </p>
          )}

          <NumberField
            label="每次返回条数"
            value={ws.maxResults}
            min={1}
            max={8}
            onChange={(maxResults) => patchSearch({ maxResults })}
          />
          <NumberField
            label="超时（毫秒）"
            value={ws.timeoutMs}
            min={2000}
            step={1000}
            onChange={(timeoutMs) => patchSearch({ timeoutMs })}
          />
          <NumberField
            label="每日调用上限"
            value={ws.dailyMaxCalls}
            min={0}
            step={10}
            onChange={(dailyMaxCalls) => patchSearch({ dailyMaxCalls })}
            hint="0 表示不限制；今日已用"
          />
          <NumberField
            label="单次决策最多调用"
            value={p.maxCallsPerDecision}
            min={1}
            max={5}
            onChange={(maxCallsPerDecision) => patch({ maxCallsPerDecision })}
            hint="防止模型反复搜索烧 token"
          />
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextField
                label="搜索测试"
                value={query}
                onChange={setQuery}
                placeholder="例如：世界计划 新曲 2026"
              />
            </div>
            <button type="button" className="btn-primary" onClick={runTest} disabled={testing}>
              <Search size={14} /> {testing ? '搜索中…' : '试搜一次'}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-soft-sub/70">
            今日插件调用：{usedToday} 次{ws.dailyMaxCalls > 0 ? ` / 上限 ${ws.dailyMaxCalls} 次` : '（不限）'}
          </p>
          {result ? (
            <div
              className={`mt-2 rounded-xl border px-3 py-2 text-[12px] whitespace-pre-wrap ${
                result.ok
                  ? 'border-state-ok/30 bg-state-ok/10 text-state-ok'
                  : 'border-state-bad/30 bg-state-bad/10 text-state-bad'
              }`}
            >
              {result.message}
            </div>
          ) : null}
        </div>
      </Card>

      <Card title="插件工作方式">
        <ul className="space-y-1.5 text-[12px] leading-relaxed text-soft-sub/85">
          <li className="flex gap-2">
            <Plug size={14} className="mt-0.5 shrink-0 text-neon-teal" />
            <span>
              模型自己判断要不要用：只有涉及<b>时效性</b>（比赛结果、更新时间、新闻）或<b>不确定事实</b>时才搜索，闲聊不会触发。
            </span>
          </li>
          <li className="flex gap-2">
            <Plug size={14} className="mt-0.5 shrink-0 text-neon-teal" />
            <span>搜索结果被当作不可信外部数据，其中的指令一律不执行，也不会原样刷链接。</span>
          </li>
          <li className="flex gap-2">
            <Plug size={14} className="mt-0.5 shrink-0 text-neon-teal" />
            <span>她不会说自己"搜索了一下"，表现得像一个本来就知道的观众。</span>
          </li>
        </ul>
      </Card>
    </div>
  );
}
