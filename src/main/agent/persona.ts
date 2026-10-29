import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PersonaCard } from '../../shared/types';
import type { Store } from '../store/db';
import type { Logger } from '../utils/logger';

const BUILTIN_IDS = ['builtin-neutral', 'builtin-snark', 'builtin-commentator'];

export function parsePersonaMarkdown(md: string, fallbackId?: string): PersonaCard {
  const lines = md.replace(/\r/g, '').split('\n');
  let name = '';
  let summary = '';
  const sections: Record<string, string[]> = {};
  let current = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('# ')) {
      name = trimmed.slice(2).trim();
      continue;
    }
    if (trimmed.startsWith('> ')) {
      summary = trimmed.slice(2).trim();
      continue;
    }
    const heading = trimmed.match(/^##\s+(.+)$/);
    if (heading) {
      current = heading[1].trim();
      sections[current] = [];
      continue;
    }
    if (current) sections[current].push(trimmed);
  }

  const text = (key: string) => (sections[key] ?? []).join('\n').trim();
  const identityRaw = text('AI身份');
  return {
    id: fallbackId ?? crypto.randomUUID(),
    name: name || '未命名人格',
    summary,
    tone: text('口吻'),
    boundaries: text('边界'),
    samples: text('示例对话'),
    aiIdentityRule: identityRaw.includes('始终') ? 'always_disclose' : 'ask_then_disclose',
    content: md.replace(/\r/g, '').trim(),
    category: '',
    updatedAt: Date.now(),
  };
}

export function personaToMarkdown(card: PersonaCard): string {
  if (card.content && card.content.trim()) return card.content.trim();
  return [
    `# ${card.name}`,
    card.summary ? `> ${card.summary}` : '',
    '## 口吻',
    card.tone,
    '## 边界',
    card.boundaries,
    '## 示例对话',
    card.samples,
    '## AI身份',
    card.aiIdentityRule === 'always_disclose' ? '始终说明' : '询问时说明',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export class PersonaStore {
  private readonly dataDir: string;

  constructor(
    private readonly store: Store,
    dataDir: string,
    private readonly builtinsDir: string,
    private readonly logger: Logger,
  ) {
    this.dataDir = dataDir;
    this.ensure();
  }

  private ensure(): void {
    const existing = this.store.readJson<PersonaCard[]>('personas.json', []);
    if (existing.length > 0) return;
    const builtins: PersonaCard[] = [];
    try {
      if (fs.existsSync(this.builtinsDir)) {
        for (const file of fs.readdirSync(this.builtinsDir).filter((f) => f.endsWith('.md'))) {
          const md = fs.readFileSync(path.join(this.builtinsDir, file), 'utf8');
          const card = parsePersonaMarkdown(md, `builtin-${file.replace(/\.md$/, '')}`);
          card.builtin = true;
          builtins.push(card);
        }
      }
    } catch (error) {
      this.logger.warn('persona', `内置人格加载失败：${String(error)}`);
    }
    if (builtins.length === 0) builtins.push(this.fallback());
    this.store.writeJson('personas.json', builtins);
  }

  private fallback(): PersonaCard {
    const card = parsePersonaMarkdown(
      ['# 中性陪伴', '> 温和、简短、不抢戏', '## 口吻', '口语化，短句，适度玩梗', '## 边界', '不争论、不刷屏', '## 示例对话', '- 观众：这把能赢吗\n- 智能体：看这走位，悬 pero 有戏', '## AI身份', '询问时说明'].join(
        '\n\n',
      ),
      BUILTIN_IDS[0],
    );
    card.builtin = true;
    return card;
  }

  list(): PersonaCard[] {
    const raw = this.store.readJson<PersonaCard[]>('personas.json', []);
    // 兼容旧数据：补齐 content 与 category
    return raw.map((card) => ({
      ...card,
      content: card.content && card.content.trim() ? card.content : personaToMarkdown({ ...card, content: '' }),
      category: card.category ?? '',
    }));
  }

  get(id: string): PersonaCard | undefined {
    return this.list().find((p) => p.id === id);
  }

  save(card: PersonaCard): PersonaCard {
    const list = this.list();
    const next: PersonaCard = { ...card, updatedAt: Date.now() };
    const index = list.findIndex((p) => p.id === card.id);
    if (index >= 0) list[index] = next;
    else list.push(next);
    this.store.writeJson('personas.json', list);
    const file = path.join(this.store.dataDir, 'personas', `${next.name.replace(/[\\/:*?"<>|]/g, '_')}.md`);
    try {
      fs.writeFileSync(file, personaToMarkdown(next), 'utf8');
    } catch {
      /* 导出副本失败不影响主存储 */
    }
    return next;
  }

  delete(id: string): void {
    this.store.writeJson(
      'personas.json',
      this.list().filter((p) => p.id !== id),
    );
  }

  importMarkdown(md: string, keepId?: string): PersonaCard {
    const card = parsePersonaMarkdown(md, keepId);
    return this.save(card);
  }

  exportMarkdown(id: string): string {
    const card = this.get(id);
    return card ? personaToMarkdown(card) : '';
  }

  get dataDirectory(): string {
    return this.dataDir;
  }
}
