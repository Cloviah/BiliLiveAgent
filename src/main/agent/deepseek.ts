import type { Logger } from '../utils/logger';
import type { SecretVault } from '../core/secrets';
import type { ToolCallRequest, ToolSchema } from '../plugins/types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** assistant 消息里携带的工具调用 */
  tool_calls?: ToolCallRequest[];
  /** tool 消息对应的调用 id */
  tool_call_id?: string;
  /** tool 消息对应的工具名 */
  name?: string;
}

export interface ChatOptions {
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  tools?: ToolSchema[];
}

export interface ChatResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  toolCalls?: ToolCallRequest[];
}

interface RawToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

export class DeepSeekClient {
  private readonly timeoutMs = 120_000;

  constructor(
    private readonly vault: SecretVault,
    private readonly logger: Logger,
  ) {}

  private apiKey(): string {
    return this.vault.get('deepseek_api_key') ?? '';
  }

  private endpoint(baseUrl: string): string {
    const base = baseUrl.replace(/\/+$/, '');
    return `${base}/chat/completions`;
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResult> {
    const key = this.apiKey();
    if (!key) throw new Error('未配置 DeepSeek API Key');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const body: Record<string, unknown> = {
        model: options.model,
        messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        stream: false,
      };
      const tools = options.tools ?? [];
      if (tools.length) {
        body.tools = tools;
        body.tool_choice = 'auto';
      }

      const res = await fetch(this.endpoint(options.baseUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const json = (await res.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
            tool_calls?: RawToolCall[];
          };
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: { message?: string };
      };
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      }
      const message = json.choices?.[0]?.message ?? {};
      const toolCalls = (message.tool_calls ?? [])
        .map<ToolCallRequest>((call) => ({
          id: call.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
          name: call.function?.name ?? '',
          arguments: call.function?.arguments ?? '{}',
        }))
        .filter((call) => Boolean(call.name));

      return {
        content: message.content ?? '',
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
        toolCalls: toolCalls.length ? toolCalls : undefined,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async test(options: ChatOptions): Promise<{ ok: boolean; message: string }> {
    try {
      const result = await this.chat(
        [
          { role: 'system', content: '你是一个连通性测试助手。' },
          { role: 'user', content: '只回复：OK' },
        ],
        { ...options, maxTokens: 16, tools: undefined },
      );
      return { ok: true, message: `连接正常，回复：${result.content.trim().slice(0, 30) || 'OK'}` };
    } catch (error) {
      this.logger.error('deepseek', `模型测试失败：${String(error)}`);
      return { ok: false, message: String(error) };
    }
  }
}
