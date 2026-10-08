import OpenAI from "openai";

/** LLM 提供商配置 */
export interface LlmConfig {
  provider: "openai" | "anthropic" | "deepseek" | "ollama" | "custom";
  apiKey?: string;
  baseURL?: string;
  model: string;
}

/** 统一消息类型 */
export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface CompletionResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
}

/**
 * LLM 抽象层接口
 * 屏蔽不同提供商 SDK 差异，统一通过 chat() 完成补全。
 */
export interface LlmClient {
  chat(messages: ChatMessage[], options?: CompletionOptions): Promise<CompletionResult>;
}

/** OpenAI 兼容提供商（DeepSeek / OpenAI / Ollama / 本地 vLLM） */
export class OpenAiCompatibleClient implements LlmClient {
  private client: OpenAI;
  private model: string;

  constructor(config: LlmConfig) {
    const baseURL =
      config.baseURL ??
      (config.provider === "deepseek" ? "https://api.deepseek.com" : undefined);
    this.client = new OpenAI({
      apiKey: config.apiKey ?? "not-needed",
      baseURL,
      timeout: 120_000,
    });
    this.model = config.model;
  }

  async chat(messages: ChatMessage[], options: CompletionOptions = {}): Promise<CompletionResult> {
    const resp = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      response_format: options.jsonMode ? { type: "json_object" } : undefined,
    });
    const usage = resp.usage;
    const msg = resp.choices[0]?.message as
      | { content?: string | null; reasoning_content?: string | null }
      | undefined;
    // 推理型模型（DeepSeek R1 等）可能把最终答案放 content，推理过程放 reasoning_content。
    // 若 content 为空，回退到 reasoning_content（llama.cpp 的 DeepSeek 模型如此）。
    const raw = msg?.content?.trim() ?? msg?.reasoning_content?.trim() ?? "";
    return {
      content: raw,
      tokensIn: usage?.prompt_tokens ?? 0,
      tokensOut: usage?.completion_tokens ?? 0,
    };
  }
}

/** Anthropic 提供商 */
export class AnthropicClient implements LlmClient {
  private apiKey: string;
  private baseURL: string;
  private model: string;

  constructor(config: LlmConfig) {
    this.apiKey = config.apiKey ?? "";
    this.baseURL = config.baseURL ?? "https://api.anthropic.com";
    this.model = config.model;
  }

  async chat(messages: ChatMessage[], options: CompletionOptions = {}): Promise<CompletionResult> {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const rest = messages.filter((m) => m.role !== "system");
    const resp = await fetch(`${this.baseURL}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        system: system || undefined,
        messages: rest.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
      }),
    });
    if (!resp.ok) {
      throw new Error(`Anthropic API 错误 ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    }
    const data = (await resp.json()) as {
      content: { type: string; text?: string }[];
      usage: { input_tokens?: number; output_tokens?: number };
    };
    const text = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
    return {
      content: text,
      tokensIn: data.usage?.input_tokens ?? 0,
      tokensOut: data.usage?.output_tokens ?? 0,
    };
  }
}

/** 工厂：根据 provider 创建客户端 */
export function createLlmClient(config: LlmConfig): LlmClient {
  if (config.provider === "anthropic") return new AnthropicClient(config);
  return new OpenAiCompatibleClient(config);
}
