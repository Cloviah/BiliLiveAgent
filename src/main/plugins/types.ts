import type { Logger } from '../utils/logger';

export interface PluginResult {
  ok: boolean;
  /** 回传给模型的纯文本结果（失败时也返回可读原因，便于模型改用别的方式回答） */
  output: string;
}

export interface PluginDefinition {
  name: string;
  /** 给模型看的描述，决定它会不会用、怎么用 */
  description: string;
  /** JSON Schema，描述参数 */
  parameters: Record<string, unknown>;
  /** 运行时是否启用（配置可随时关掉） */
  enabled(): boolean;
  execute(args: Record<string, unknown>): Promise<PluginResult>;
}

/** OpenAI/DeepSeek 兼容的 tool schema */
export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** 模型返回的调用请求 */
export interface ToolCallRequest {
  id: string;
  name: string;
  /** 原始 JSON 字符串，由注册表负责解析 */
  arguments: string;
}

export type { Logger };
