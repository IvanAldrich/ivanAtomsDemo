import OpenAI from "openai";

export function llmConfigured(): boolean {
  return Boolean(
    process.env.LLM_API_KEY && process.env.LLM_BASE_URL && process.env.LLM_MODEL
  );
}

export function llmModel(): string {
  return process.env.LLM_MODEL ?? "";
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.LLM_API_KEY,
      baseURL: process.env.LLM_BASE_URL,
    });
  }
  return client;
}

export type ChatMessageInput = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmUsage = {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export type StreamOpts = {
  maxTokens?: number;
  onUsage?: (usage: LlmUsage, finishReason: string | null) => void;
};

/** 流式补全：逐块回调文本增量（与推理增量）。返回完整文本与结束原因。
 *  瞬时错误（限流/5xx/连接失败）在「尚未产生输出」时自动重试（指数退避）。
 */
export async function streamChat(
  messages: ChatMessageInput[],
  onDelta: (text: string) => void,
  onReasoning?: (text: string) => void,
  opts: StreamOpts = {}
): Promise<{ text: string; finishReason: string | null; usage: LlmUsage | null }> {
  const MAX_ATTEMPTS = 3;
  const state = { emitted: false };
  const wrappedDelta = (t: string) => {
    state.emitted = true;
    onDelta(t);
  };

  for (let attempt = 1; ; attempt++) {
    try {
      return await streamOnce(messages, wrappedDelta, onReasoning, opts);
    } catch (err) {
      // 已产生部分输出时不重试（避免重复增量污染），交给上层修复循环
      if (state.emitted || attempt >= MAX_ATTEMPTS || !isTransient(err)) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

function isTransient(err: unknown): boolean {
  if (err instanceof OpenAI.APIConnectionError) return true;
  if (err instanceof OpenAI.APIError) {
    const status = (err as { status?: number }).status;
    return !status || status === 429 || status >= 500;
  }
  const msg = err instanceof Error ? err.message : "";
  return /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(msg);
}

async function streamOnce(
  messages: ChatMessageInput[],
  onDelta: (text: string) => void,
  onReasoning?: (text: string) => void,
  opts: StreamOpts = {}
): Promise<{ text: string; finishReason: string | null; usage: LlmUsage | null }> {
  // 推理模型的思考过程会消耗输出预算（实测 deepseek-v4.1-flash 可占满 16k 导致截断），
  // 除非显式 LLM_ENABLE_THINKING=on，否则关闭思考换取完整代码输出。
  const extra: Record<string, unknown> =
    process.env.LLM_ENABLE_THINKING === "on" ? {} : { enable_thinking: false };
  const stream = await getClient().chat.completions.create({
    model: llmModel(),
    messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.2,
    max_tokens:
      opts.maxTokens ?? Number(process.env.LLM_MAX_OUTPUT_TOKENS ?? 32768),
    ...extra,
  });

  let full = "";
  let finishReason: string | null = null;
  let usage: LlmUsage | null = null;
  for await (const chunk of stream) {
    if (chunk.usage) {
      const u = chunk.usage as {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
      usage = {
        promptTokens: u.prompt_tokens ?? 0,
        completionTokens: u.completion_tokens ?? 0,
        reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
        totalTokens: u.total_tokens ?? 0,
      };
    }
    const choice = chunk.choices[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    const delta = choice?.delta;
    const reasoning = (delta as { reasoning_content?: string } | undefined)
      ?.reasoning_content;
    if (reasoning) onReasoning?.(reasoning);
    const content = delta?.content ?? "";
    if (content) {
      full += content;
      onDelta(content);
    }
  }
  if (usage) opts.onUsage?.(usage, finishReason);
  return { text: full, finishReason, usage };
}
