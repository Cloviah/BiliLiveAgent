import { useEffect, useState } from 'react';
import { KeyRound, Save } from 'lucide-react';
import type { AppCtx } from '../../App';
import { api } from '../../api/ipc-client';
import { Card, NumberField, TextField } from '../ui';
import { DEEPSEEK_MODELS } from '../../../shared/limits';

export default function ModelPanel({ ctx }: { ctx: AppCtx }) {
  const { config, saveConfig } = ctx;
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);

  useEffect(() => {
    api.secret.has('deepseek_api_key').then(setHasKey).catch(console.error);
  }, []);

  const saveKey = () => {
    api.secret
      .set('deepseek_api_key', apiKey.trim())
      .then(async (ok) => {
        if (!ok) {
          ctx.toast('密钥加密保存失败，请检查 DPAPI 是否可用', 'bad');
          return;
        }
        setApiKey('');
        setHasKey(true);
        ctx.toast('已加密保存，正在验证 Key…');
        const res = await api.diag.run('model');
        ctx.toast(
          res.ok ? `DeepSeek 可用：${res.message}` : `DeepSeek 不可用：${res.message}`,
          res.ok ? 'ok' : 'bad',
        );
      })
      .catch(console.error);
  };

  const model = config.model;

  return (
    <Card title="DeepSeek 模型与预算">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <TextField
            label="DeepSeek API Key"
            type="password"
            value={apiKey}
            onChange={setApiKey}
            placeholder={hasKey ? '已保存密钥，留空表示不修改' : 'sk-...'}
            hint="使用 Windows DPAPI 加密保存在本机，导出数据时不包含密钥"
          />
          <button type="button" className="btn-primary mt-2" onClick={saveKey}>
            <KeyRound size={14} /> 保存密钥
          </button>
        </div>

        <TextField
          label="接口地址"
          value={model.baseUrl}
          onChange={(baseUrl) => saveConfig({ model: { ...model, baseUrl } })}
          hint="官方接口 https://api.deepseek.com"
        />
        <label className="block space-y-1.5">
          <span className="label">模型</span>
          <select
            className="input"
            value={model.model}
            onChange={(e) => saveConfig({ model: { ...model, model: e.target.value } })}
          >
            {DEEPSEEK_MODELS.map((name) => (
              <option key={name} value={name} className="bg-ink-800">
                {name}
              </option>
            ))}
          </select>
        </label>

        <NumberField
          label="温度"
          value={model.temperature}
          step={0.1}
          min={0}
          max={2}
          onChange={(temperature) => saveConfig({ model: { ...model, temperature } })}
        />
        <NumberField
          label="最大输出 tokens"
          value={model.maxTokens}
          min={64}
          max={4096}
          onChange={(maxTokens) => saveConfig({ model: { ...model, maxTokens } })}
        />
        <NumberField
          label="每批最多送入事件数"
          value={model.batchMaxEvents}
          min={4}
          max={80}
          onChange={(batchMaxEvents) => saveConfig({ model: { ...model, batchMaxEvents } })}
          hint="批量决策可显著降低调用次数"
        />
        <NumberField
          label="每日最多调用次数"
          value={model.dailyMaxRequests}
          min={0}
          max={10000}
          onChange={(dailyMaxRequests) => saveConfig({ model: { ...model, dailyMaxRequests } })}
          hint="0 表示不限制；达到后自动切只读"
        />
        <NumberField
          label="每日 token 预算"
          value={model.dailyMaxTokens}
          min={0}
          step={10000}
          onChange={(dailyMaxTokens) => saveConfig({ model: { ...model, dailyMaxTokens } })}
        />
        <NumberField
          label="输入单价（元/百万 tokens）"
          value={model.priceInputPerMTokens}
          step={0.5}
          min={0}
          onChange={(priceInputPerMTokens) => saveConfig({ model: { ...model, priceInputPerMTokens } })}
        />
        <NumberField
          label="输出单价（元/百万 tokens）"
          value={model.priceOutputPerMTokens}
          step={0.5}
          min={0}
          onChange={(priceOutputPerMTokens) => saveConfig({ model: { ...model, priceOutputPerMTokens } })}
        />
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-[12px]">
        <Stat label="今日调用" value={String(ctx.usage?.todayRequests ?? 0)} />
        <Stat label="今日 tokens" value={String((ctx.usage?.todayPromptTokens ?? 0) + (ctx.usage?.todayCompletionTokens ?? 0))} />
        <Stat label="今日费用" value={`¥${(ctx.usage?.todayCost ?? 0).toFixed(3)}`} />
        <Stat label="累计费用" value={`¥${(ctx.usage?.totalCost ?? 0).toFixed(3)}`} />
      </div>

      <button type="button" className="btn-ghost mt-3" onClick={ctx.refreshUsage}>
        <Save size={14} /> 刷新用量
      </button>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-soft-sub/70">{label}</div>
      <div className="mt-0.5 text-[13px] text-soft-text">{value}</div>
    </div>
  );
}
