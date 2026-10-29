import type { AppConfig } from '../../shared/types';
import type { Logger } from '../utils/logger';
import type { PluginDefinition, PluginResult, ToolCallRequest, ToolSchema } from './types';
import { formatHits, webSearch } from './web-search';

/**
 * 插件注册表：把插件暴露给模型（tool schema），并在调用时做
 * 启用校验、超时、每日配额与日志审计。
 */
export class PluginRegistry {
  private readonly plugins = new Map<string, PluginDefinition>();
  private day = '';
  private usedToday = 0;

  constructor(
    private readonly getConfig: () => AppConfig,
    private readonly getSecret: (name: string) => string | undefined,
    private readonly logger: Logger,
  ) {}

  register(def: PluginDefinition): void {
    this.plugins.set(def.name, def);
  }

  registerBuiltins(): void {
    this.register(this.webSearchPlugin());
  }

  /** 供模型使用的 tool schema（总开关关闭时为空） */
  schemas(): ToolSchema[] {
    const cfg = this.getConfig().plugins;
    if (!cfg.enabled) return [];
    return [...this.plugins.values()]
      .filter((p) => p.enabled())
      .map((p) => ({ type: 'function', function: { name: p.name, description: p.description, parameters: p.parameters } }));
  }

  /** 单次决策允许的最大调用次数 */
  maxCallsPerDecision(): number {
    return Math.max(1, Math.min(this.getConfig().plugins.maxCallsPerDecision, 5));
  }

  usedTodayCount(): number {
    this.rollDay();
    return this.usedToday;
  }

  private rollDay(): void {
    const key = new Date().toISOString().slice(0, 10);
    if (key !== this.day) {
      this.day = key;
      this.usedToday = 0;
    }
  }

  private quotaLeft(): boolean {
    this.rollDay();
    const limit = this.getConfig().plugins.webSearch.dailyMaxCalls;
    return limit <= 0 || this.usedToday < limit;
  }

  /** 执行模型发起的一次工具调用，返回要给模型看的文本 */
  async invoke(call: ToolCallRequest): Promise<string> {
    const plugin = this.plugins.get(call.name);
    const cfg = this.getConfig().plugins;
    if (!cfg.enabled || !plugin || !plugin.enabled()) {
      return `工具 ${call.name} 当前不可用，请直接用已有知识回答。`;
    }
    if (!this.quotaLeft()) {
      this.logger.warn('plugin', `今日插件调用已到上限（${cfg.webSearch.dailyMaxCalls} 次），拒绝调用 ${call.name}`);
      return '联网搜索今日额度已用完，请用已有知识回答，不确定就直接说不确定。';
    }

    let args: Record<string, unknown> = {};
    try {
      args = call.arguments ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
    } catch {
      return '工具参数不是合法 JSON，请重新调用或直接作答。';
    }

    this.rollDay();
    this.usedToday += 1;
    this.logger.info('plugin', `调用 ${call.name}，参数：${JSON.stringify(args).slice(0, 160)}`);

    try {
      const result: PluginResult = await plugin.execute(args);
      this.logger.info('plugin', `${call.name} 返回 ${result.ok ? '成功' : '失败'}：${result.output.slice(0, 120)}`);
      return result.output;
    } catch (error) {
      const message = String(error);
      this.logger.warn('plugin', `${call.name} 执行异常：${message}`);
      return `工具执行失败（${message.slice(0, 80)}），请用已有知识回答。`;
    }
  }

  /** 界面上的搜索测试 */
  async testSearch(query: string): Promise<{ ok: boolean; message: string }> {
    const cfg = this.getConfig().plugins;
    if (!cfg.enabled || !cfg.webSearch.enabled) {
      return { ok: false, message: '联网搜索插件未启用' };
    }
    try {
      const hits = await webSearch(query, this.searchOptions());
      if (!hits.length) return { ok: false, message: '没有搜到结果，可换关键词或换提供方试试' };
      return { ok: true, message: hits.map((h) => `${h.title} — ${h.url}`).join('\n') };
    } catch (error) {
      this.logger.warn('plugin', `搜索测试失败：${String(error)}`);
      return { ok: false, message: String(error) };
    }
  }

  private searchOptions() {
    const ws = this.getConfig().plugins.webSearch;
    return {
      provider: ws.provider,
      maxResults: Math.max(1, Math.min(ws.maxResults, 8)),
      timeoutMs: Math.max(2_000, ws.timeoutMs),
      cacheTtlMs: Math.max(0, ws.cacheTtlMs),
      apiKey: this.getSecret('websearch_api_key') ?? '',
    };
  }

  private webSearchPlugin(): PluginDefinition {
    return {
      name: 'web_search',
      description:
        '联网搜索实时信息。仅在涉及时效性或事实性内容且你不确定时使用（如比赛结果、版本更新、新闻、某首歌的信息、某个人物的近况）。不要用于闲聊或你本来就懂的问题。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词，尽量简短，10 个字以内最佳' },
        },
        required: ['query'],
      },
      enabled: () => this.getConfig().plugins.enabled && this.getConfig().plugins.webSearch.enabled,
      execute: async (args) => {
        const query = String(args.query ?? '').trim();
        if (!query) return { ok: false, output: '搜索关键词为空，请直接作答。' };
        try {
          const hits = await webSearch(query, this.searchOptions());
          return { ok: hits.length > 0, output: formatHits(query, hits) };
        } catch (error) {
          return { ok: false, output: `搜索失败（${String(error).slice(0, 80)}），请用已有知识回答。` };
        }
      },
    };
  }
}
