import { useEffect, useMemo, useState } from 'react';
import { Check, FileDown, FileUp, FolderInput, Plus, Save, Trash2, X } from 'lucide-react';
import type { AppCtx } from '../App';
import { api } from '../api/ipc-client';
import type { PersonaCard } from '../../shared/types';

const CONTENT_TEMPLATE = `# 新人格
> 一句话简介，例如：温和、简短、不抢戏

## 你是谁
（在这里用自由格式描述这个人格：身份、性格、说话习惯、喜欢与不喜欢的话题……）

## 口吻
口语化、短句、适度玩梗

## 边界
不争论、不剧透、不刷屏

## 示例对话
- 观众：这把能赢吗
- 智能体：看这走位，悬，但有戏

## AI身份
询问时说明`;

function blankCard(): PersonaCard {
  return {
    id: `p-${Date.now()}`,
    name: '新人格',
    summary: '',
    tone: '',
    boundaries: '',
    samples: '',
    aiIdentityRule: 'ask_then_disclose',
    content: CONTENT_TEMPLATE,
    category: '',
    updatedAt: Date.now(),
  };
}

const NONE = '__none';

export default function PersonaPage({ ctx }: { ctx: AppCtx }) {
  const [cards, setCards] = useState<PersonaCard[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [draft, setDraft] = useState<PersonaCard | undefined>();
  const [dirty, setDirty] = useState(false);
  const [catFilter, setCatFilter] = useState<string>('');
  const [catEditing, setCatEditing] = useState(false);
  const [catDraft, setCatDraft] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [markdown, setMarkdown] = useState('');

  const reload = () => {
    api.persona
      .list()
      .then((list) => {
        setCards(list);
        setSelectedId((current) => {
          const keep = current && list.some((c) => c.id === current) ? current : ctx.config.activePersonaId;
          const id = list.some((c) => c.id === keep) ? keep : (list[0]?.id ?? '');
          setDraft((d) => (d && d.id === id ? d : list.find((c) => c.id === id)));
          return id;
        });
      })
      .catch(console.error);
  };

  useEffect(reload, []);

  const categories = useMemo(() => {
    const set = new Map<string, number>();
    for (const card of cards) {
      const key = card.category?.trim() || NONE;
      set.set(key, (set.get(key) ?? 0) + 1);
    }
    return [...set.entries()];
  }, [cards]);

  const filtered = useMemo(() => {
    if (catFilter === '') return cards;
    if (catFilter === NONE) return cards.filter((c) => !c.category?.trim());
    return cards.filter((c) => c.category?.trim() === catFilter);
  }, [cards, catFilter]);

  const select = (card: PersonaCard) => {
    setSelectedId(card.id);
    setDraft({ ...card });
    setDirty(false);
    setCatEditing(false);
  };

  const save = () => {
    if (!draft) return;
    api.persona
      .save(draft)
      .then(() => {
        setDirty(false);
        ctx.toast(`已保存人格「${draft.name}」，下一次决策即生效`);
        reload();
      })
      .catch(console.error);
  };

  const activate = () => {
    if (!draft) return;
    api.persona
      .activate(draft.id)
      .then(() => {
        void ctx.saveConfig({ activePersonaId: draft.id });
        ctx.toast(`已将「${draft.name}」设为默认人格`);
        reload();
      })
      .catch(console.error);
  };

  const remove = () => {
    if (!draft) return;
    if (draft.builtin) {
      ctx.toast('内置人格不支持删除', 'bad');
      return;
    }
    api.persona.remove(draft.id).then(() => {
      ctx.toast('已删除人格卡');
      setSelectedId('');
      setDraft(undefined);
      reload();
    }).catch(console.error);
  };

  const exportMd = () => {
    if (!draft) return;
    api.persona
      .exportMd(draft.id)
      .then((text) => {
        setMarkdown(text);
        setShowImport(true);
      })
      .catch(console.error);
  };

  const importMd = () => {
    api.persona
      .importMd(markdown)
      .then((card) => {
        ctx.toast(`已导入人格「${card.name}」`);
        setMarkdown('');
        setShowImport(false);
        setSelectedId(card.id);
        reload();
      })
      .catch(console.error);
  };

  const applyCategory = () => {
    if (!draft) return;
    setDraft({ ...draft, category: catDraft.trim() });
    setDirty(true);
    setCatEditing(false);
  };

  const updatedAt = cards.reduce((max, c) => Math.max(max, c.updatedAt), 0);
  const isDefault = draft ? draft.id === ctx.config.activePersonaId : false;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold text-soft-text">人格卡</h1>
          <p className="mt-1 text-[13px] text-soft-sub">设置助手的性格、语气与聊天习惯；修改内容后保存即生效。</p>
        </div>
        <span className="text-[12px] text-soft-sub/70">
          {updatedAt ? `更新于 ${new Date(updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : ''}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[13px] text-soft-sub">{cards.length} 个人格 · 全自动发言使用「默认人格」</span>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost" onClick={() => { setMarkdown(''); setShowImport(true); }}>
            <FileUp size={14} /> 导入人格
          </button>
          <button type="button" className="btn-ghost" onClick={() => select(blankCard())}>
            <Plus size={14} /> 新建人格
          </button>
        </div>
      </div>

      {categories.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`chip cursor-pointer ${catFilter === '' ? 'bg-neon-teal/20 text-neon-teal' : 'bg-white/5 text-soft-sub'}`}
            onClick={() => setCatFilter('')}
          >
            全部 {cards.length}
          </button>
          {categories.map(([key, count]) => (
            <button
              key={key}
              type="button"
              className={`chip cursor-pointer ${catFilter === key ? 'bg-neon-teal/20 text-neon-teal' : 'bg-white/5 text-soft-sub'}`}
              onClick={() => setCatFilter(key)}
            >
              {key === NONE ? '未分类' : key} {count}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-[280px_1fr] items-start gap-4">
        <div className="space-y-1.5">
          {filtered.map((card) => {
            const active = card.id === ctx.config.activePersonaId;
            const selected = card.id === selectedId;
            return (
              <button
                key={card.id}
                type="button"
                className={`block w-full cursor-pointer rounded-xl border px-3 py-2.5 text-left transition ${
                  selected
                    ? 'border-neon-teal/50 bg-neon-teal/10'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
                onClick={() => select(card)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-soft-text">{card.name}</span>
                  {active ? <span className="chip bg-state-ok/20 text-state-ok">默认人格</span> : null}
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] text-soft-sub/70">
                  {card.summary || (card.category?.trim() ? card.category : '未分类')}
                </p>
              </button>
            );
          })}
          {filtered.length === 0 ? (
            <p className="px-1 py-4 text-[12px] text-soft-sub/70">该分类下还没有人格卡。</p>
          ) : null}
        </div>

        {draft ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <input
              className="w-full bg-transparent text-xl font-semibold text-soft-text outline-none"
              value={draft.name}
              onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setDirty(true); }}
            />
            <p className="mt-1 text-[12px] text-soft-sub/80">
              直接修改下方的内容，点击「保存人格」后立即生效；被问到 AI 身份时始终如实回答。
            </p>

            <div className="mt-4 flex items-center justify-between border-b border-white/10 pb-3">
              <span className="text-[12px] text-soft-sub">
                分类：{draft.category?.trim() || '未分类'}
              </span>
              {catEditing ? (
                <div className="flex items-center gap-1.5">
                  <input
                    className="input h-8 w-40 py-1 text-[12px]"
                    value={catDraft}
                    placeholder="输入分类名，留空为未分类"
                    onChange={(e) => setCatDraft(e.target.value)}
                  />
                  <button type="button" className="btn-ghost px-2 py-1 text-[11px]" onClick={applyCategory}>
                    确定
                  </button>
                  <button
                    type="button"
                    className="btn-ghost px-2 py-1 text-[11px]"
                    onClick={() => { setCatEditing(false); setCatDraft(''); }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn-ghost px-2 py-1 text-[11px]"
                  onClick={() => { setCatDraft(draft.category ?? ''); setCatEditing(true); }}
                >
                  <FolderInput size={12} /> 移动分类
                </button>
              )}
            </div>

            <div className="mt-4">
              <div className="text-[13px] font-medium text-soft-text">人格内容</div>
              <textarea
                className="input mt-2 min-h-[420px] resize-y text-[13px] leading-6"
                value={draft.content ?? ''}
                onChange={(e) => { setDraft({ ...draft, content: e.target.value }); setDirty(true); }}
              />
            </div>

            <div className="mt-3 flex items-center justify-between">
              <span className="text-[12px] text-soft-sub/70">
                {(draft.content ?? '').length} 字 · {dirty ? '未保存' : '已保存'}
              </span>
              <div className="flex items-center gap-2">
                {isDefault ? (
                  <span className="btn-ghost cursor-default text-state-ok">
                    <Check size={14} /> 已是默认人格
                  </span>
                ) : (
                  <button type="button" className="btn-ghost" onClick={activate}>
                    <Check size={14} /> 设为默认人格
                  </button>
                )}
                <button
                  type="button"
                  className="btn-ghost text-state-bad"
                  onClick={remove}
                  disabled={draft.builtin}
                >
                  <Trash2 size={14} /> 删除人格卡
                </button>
                <button type="button" className="btn-primary" onClick={save}>
                  <Save size={14} /> 保存人格
                </button>
              </div>
            </div>

            <p className="mt-3 text-[11px] text-soft-sub/60">
              保存仅覆盖当前人格；「导入人格」会创建新卡；导出 Markdown 可直接分享或备份。
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-[13px] text-soft-sub">
            请选择或新建一张人格卡。
          </div>
        )}
      </div>

      {showImport ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
          onClick={() => setShowImport(false)}
        >
          <div
            className="w-[720px] space-y-3 rounded-2xl border border-white/10 bg-[#121A2B] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-medium text-soft-text">Markdown 角色卡</span>
              <button type="button" className="btn-ghost px-2 py-1" onClick={() => setShowImport(false)}>
                <X size={14} />
              </button>
            </div>
            <textarea
              className="input min-h-[320px] resize-y font-mono text-[12px]"
              value={markdown}
              placeholder={'# 人格名称\n> 一句话简介\n\n## 你是谁\n...\n\n## 口吻\n...\n\n## 边界\n...\n\n## 示例对话\n...\n\n## AI身份\n询问时说明'}
              onChange={(e) => setMarkdown(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => { void navigator.clipboard.writeText(markdown); ctx.toast('已复制到剪贴板'); }}
              >
                <FileDown size={14} /> 复制
              </button>
              <button type="button" className="btn-primary" onClick={importMd} disabled={!markdown.trim()}>
                <FileUp size={14} /> 导入为新人格
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
