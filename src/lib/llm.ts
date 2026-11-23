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

/** 流式补全：逐块回调文本增量（与推理增量），返回完整文本 */
export async function streamChat(
  messages: ChatMessageInput[],
  onDelta: (text: string) => void,
  onReasoning?: (text: string) => void
): Promise<string> {
  const stream = await getClient().chat.completions.create({
    model: llmModel(),
    messages,
    stream: true,
    temperature: 0.2,
    // 整工程自由生成需要大输出（默认上限可能截断导致协议解析失败）
    max_tokens: Number(process.env.LLM_MAX_OUTPUT_TOKENS ?? 16384),
  });

  let full = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    const reasoning = (delta as { reasoning_content?: string } | undefined)
      ?.reasoning_content;
    if (reasoning) onReasoning?.(reasoning);
    const content = delta?.content ?? "";
    if (content) {
      full += content;
      onDelta(content);
    }
  }
  return full;
}
