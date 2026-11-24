import { llmConfigured, streamChat, type ChatMessageInput } from "@/lib/llm";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildRepairPrompt,
  type IterationContext,
} from "./prompts";
import { parseGenerationPlan, type GenerationPlan } from "./protocol";

export type StreamedGeneration = { raw: string; plan: GenerationPlan };

/** 共享流式生成：播报文件事件与思考进度，解析协议 */
async function streamGeneration(
  messages: ChatMessageInput[],
  onLog: (text: string) => void
): Promise<StreamedGeneration> {
  if (!llmConfigured()) {
    throw new Error("LLM 未配置（LLM_BASE_URL / LLM_API_KEY / LLM_MODEL）");
  }

  let buffer = "";
  let reasoningBytes = 0;
  const announced = new Set<string>();
  let dots = 0;

  const raw = await streamChat(
    messages,
    (delta) => {
      buffer += delta;
      const headerRe = /^### (FILE|DELETE):\s*(.+?)\s*$/gm;
      let m: RegExpExecArray | null;
      while ((m = headerRe.exec(buffer)) !== null) {
        const key = `${m[1]}:${m[2]}`;
        if (!announced.has(key)) {
          announced.add(key);
          onLog(m[1] === "FILE" ? `生成文件 ${m[2]}` : `标记删除 ${m[2]}`);
        }
      }
    },
    (reasoning) => {
      reasoningBytes += reasoning.length;
      if (reasoningBytes > dots * 3072) {
        dots += 1;
        onLog(`思考中… 约 ${Math.round(reasoningBytes / 1024)}KB`);
      }
    }
  );

  return { raw, plan: parseGenerationPlan(raw) };
}

/** 首轮/迭代轮生成（校验由编排器统一执行） */
export async function generateFirstRound(
  requirement: string,
  ctx: IterationContext | null,
  onLog: (text: string) => void
): Promise<StreamedGeneration> {
  return streamGeneration(
    [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(requirement, ctx) },
    ],
    onLog
  );
}

/** 修复轮生成：协议校验失败（无文件落盘）或构建失败（有文件） */
export async function generateRepairRound(
  input: {
    requirement: string;
    error: string;
    tree: string[];
    keyFileContents: Array<{ path: string; content: string }>;
    previousRawTail: string;
  },
  onLog: (text: string) => void
): Promise<StreamedGeneration> {
  return streamGeneration(
    [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildRepairPrompt(input) },
    ],
    onLog
  );
}
