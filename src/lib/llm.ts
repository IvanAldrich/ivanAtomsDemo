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

/** 流式补全：逐块回调文本增量，返回完整文本 */
export async function streamChat(
  messages: ChatMessageInput[],
  onDelta: (text: string) => void
): Promise<string> {
  const stream = await getClient().chat.completions.create({
    model: llmModel(),
    messages,
    stream: true,
    temperature: 0.2,
  });

  let full = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      full += delta;
      onDelta(delta);
    }
  }
  return full;
}
