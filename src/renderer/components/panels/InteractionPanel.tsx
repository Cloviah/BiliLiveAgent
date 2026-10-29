import { Plus, Trash2 } from 'lucide-react';
import type { AppCtx } from '../../App';
import { Card, NumberField, TagInput, TextField, Toggle } from '../ui';
import type { AppConfig, TimeRange } from '../../../shared/types';

export default function InteractionPanel({ ctx }: { ctx: AppCtx }) {
  const { config, saveConfig } = ctx;
  const i = config.interaction;
  const s = config.safety;
  const patchInteraction = (patch: Partial<AppConfig['interaction']>) =>
    saveConfig({ interaction: { ...i, ...patch } });
  const patchSafety = (patch: Partial<AppConfig['safety']>) => saveConfig({ safety: { ...s, ...patch } });

  const updateRange = (index: number, patch: Partial<TimeRange>) => {
    const ranges = i.silentHours.map((r, idx) => (idx === index ? { ...r, ...patch } : r));
    patchInteraction({ silentHours: ranges });
  };

  return (
    <div className="space-y-4">
      <Card title="回复频率">
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="决策周期（毫秒）"
            value={i.decisionIntervalMs}
            min={5000}
            step={1000}
            onChange={(decisionIntervalMs) => patchInteraction({ decisionIntervalMs })}
            hint="每隔多久汇总一次弹幕交给模型判断"
          />
          <NumberField
            label="最短发言间隔（毫秒）"
            value={i.minSendIntervalMs}
            min={5000}
            step={1000}
            onChange={(minSendIntervalMs) => patchInteraction({ minSendIntervalMs })}
          />
          <NumberField
            label="点名回复间隔（毫秒）"
            value={i.mentionMinIntervalMs}
            min={0}
            step={1000}
            onChange={(mentionMinIntervalMs) => patchInteraction({ mentionMinIntervalMs })}
            hint="被点名/命中关键词时不受最短发言间隔与每分钟/每小时上限约束，立即回复；仅保留 5 秒防刷屏底线"
          />
          <NumberField
            label="每分钟最多发送"
            value={i.maxSendPerMinute}
            min={0}
            max={20}
            onChange={(maxSendPerMinute) => patchInteraction({ maxSendPerMinute })}
          />
          <NumberField
            label="每小时最多发送"
            value={i.maxSendPerHour}
            min={0}
            max={200}
            onChange={(maxSendPerHour) => patchInteraction({ maxSendPerHour })}
          />
          <NumberField
            label="长回复最多分段数"
            value={i.maxSegments}
            min={1}
            max={5}
            onChange={(maxSegments) => patchInteraction({ maxSegments })}
          />
          <NumberField
            label="分段间隔（毫秒）"
            value={i.segmentDelayMs}
            min={1000}
            step={500}
            onChange={(segmentDelayMs) => patchInteraction({ segmentDelayMs })}
          />
          <NumberField
            label="冷场多久后主动发言（毫秒）"
            value={i.idleProactiveMs}
            min={60000}
            step={30000}
            onChange={(idleProactiveMs) => patchInteraction({ idleProactiveMs })}
          />
          <TextField
            label="智能体昵称"
            value={i.agentNickname}
            onChange={(agentNickname) => patchInteraction({ agentNickname })}
            placeholder="弹幕里提到这个名字会优先回应"
          />
        </div>

        <div className="mt-3 space-y-2">
          <Toggle
            label="活跃度自适应"
            checked={i.adaptiveEnabled}
            onChange={(adaptiveEnabled) => patchInteraction({ adaptiveEnabled })}
            hint="弹幕越密，实际间隔越接近下限；范围在下方的自适应区间内"
          />
          {i.adaptiveEnabled ? (
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="自适应最短间隔（毫秒）"
                value={i.adaptiveMinMs}
                min={5000}
                step={1000}
                onChange={(adaptiveMinMs) => patchInteraction({ adaptiveMinMs })}
              />
              <NumberField
                label="自适应最长间隔（毫秒）"
                value={i.adaptiveMaxMs}
                min={10000}
                step={1000}
                onChange={(adaptiveMaxMs) => patchInteraction({ adaptiveMaxMs })}
              />
            </div>
          ) : null}
          <Toggle
            label="点名优先回应"
            checked={i.mentionPriority}
            onChange={(mentionPriority) => patchInteraction({ mentionPriority })}
            hint="被提到昵称或命中关键词时优先，但仍受总限频约束"
          />
        </div>
      </Card>

      <Card title="静默时段（只读不发言）">
        <div className="space-y-2">
          {i.silentHours.length === 0 ? (
            <p className="text-[12px] text-soft-sub/60">未设置静默时段；添加后该时段内只读取不发送。</p>
          ) : (
            i.silentHours.map((range, index) => (
              <div key={index} className="flex items-end gap-2">
                <TextField label="开始" value={range.start} onChange={(start) => updateRange(index, { start })} />
                <TextField label="结束" value={range.end} onChange={(end) => updateRange(index, { end })} />
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => patchInteraction({ silentHours: i.silentHours.filter((_, idx) => idx !== index) })}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
          <button
            type="button"
            className="btn-ghost"
            onClick={() => patchInteraction({ silentHours: [...i.silentHours, { start: '01:00', end: '07:00' }] })}
          >
            <Plus size={14} /> 添加时段
          </button>
        </div>
      </Card>

      <Card title="关键词与安全规则">
        <div className="space-y-3">
          <TagInput
            label="关注关键词"
            values={i.keywords}
            onChange={(keywords) => patchInteraction({ keywords })}
            placeholder="回车添加，例如：抽卡、攻略"
          />
          <TagInput
            label="禁止词（命中则不发送）"
            values={s.blockedWords}
            onChange={(blockedWords) => patchSafety({ blockedWords })}
            placeholder="回车添加"
          />
          <TagInput
            label="不回应话题"
            values={s.blockedTopics}
            onChange={(blockedTopics) => patchSafety({ blockedTopics })}
            placeholder="回车添加"
          />
          <TagInput
            label="忽略的观众 UID"
            values={s.ignoredUids.map(String)}
            onChange={(values) =>
              patchSafety({ ignoredUids: values.map((v) => Number(v.replace(/\D/g, ''))).filter((n) => n > 0) })
            }
            placeholder="回车添加 UID"
          />
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="连续失败熔断阈值"
              value={s.maxConsecutiveFailures}
              min={1}
              max={10}
              onChange={(maxConsecutiveFailures) => patchSafety({ maxConsecutiveFailures })}
              hint="达到后自动切换为只读并提示"
            />
            <NumberField
              label="每小时硬上限"
              value={s.maxSendPerHourHard}
              min={1}
              max={200}
              onChange={(maxSendPerHourHard) => patchSafety({ maxSendPerHourHard })}
            />
          </div>
          <p className="text-[11px] leading-relaxed text-soft-sub/70">
            内置的违法、色情低俗、暴力自伤、隐私泄露与冒充身份拦截不可关闭；所有弹幕都被视为不可信数据，
            无法改写人格、索取密钥或控制本应用。
          </p>
        </div>
      </Card>
    </div>
  );
}
