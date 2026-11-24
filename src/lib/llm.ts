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

/** 流式补全：逐块回调文本增量（与推理增量）。返回完整文本与结束原因。
 *  瞬时错误（限流/5xx/连接失败）在「尚未产生输出」时自动重试（指数退避）。
 */
export async function streamChat(
  messages: ChatMessageInput[],
  onDelta: (text: string) => void,
  onReasoning?: (text: string) => void,
  opts: { maxTokens?: number } = {}
): Promise<{ text: string; finishReason: string | null }> {
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
  opts: { maxTokens?: number } = {}
): Promise<{ text: string; finishReason: string | null }> {
  const stream = await getClient().chat.completions.create({
    model: llmModel(),
    messages,
    stream: true,
    temperature: 0.2,
    max_tokens:
      opts.maxTokens ?? Number(process.env.LLM_MAX_OUTPUT_TOKENS ?? 16384),
  });

  let full = "";
  let finishReason: string | null = null;
  for await (const chunk of stream) {
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
  return { text: full, finishReason };
}
