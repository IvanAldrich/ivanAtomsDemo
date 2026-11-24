import { llmConfigured, streamChat, type ChatMessageInput } from "@/lib/llm";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildRepairPrompt,
  type IterationContext,
} from "./prompts";
import { parseGenerationPlan, type GenerationPlan } from "./protocol";

export type StreamedGeneration = { raw: string; plan: GenerationPlan };

/** 共享流式生成：播报文件事件与思考进度，截断时自动断点续写，解析协议 */
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

  const onDelta = (delta: string) => {
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
  };
  const onReasoning = (reasoning: string) => {
    reasoningBytes += reasoning.length;
    if (reasoningBytes > dots * 3072) {
      dots += 1;
      onLog(`思考中… 约 ${Math.round(reasoningBytes / 1024)}KB`);
    }
  };

  // 断点续写：达到 max_tokens 时让模型从断点精确续写（最多 3 次续写）
  let convo = [...messages];
  for (let round = 0; round < 4; round++) {
    const res = await streamChat(convo, onDelta, onReasoning);
    buffer += "";
    if (res.finishReason !== "length") {
      return { raw: buffer, plan: parseGenerationPlan(buffer) };
    }
    if (round === 3) break;
    onLog(`输出达到长度上限，从断点继续（第 ${round + 1} 次续写）…`);
    convo = [
      ...convo,
      { role: "assistant", content: res.text },
      {
        role: "user",
        content:
          "你的输出因长度限制被截断。请从断点精确继续输出剩余内容：不要重复已输出的部分，不要重新开始，直接续写当前文件剩余内容与后续文件（保持输出协议）。",
      },
    ];
  }

  // 续写后仍未结束：以已有内容解析（配合语法/结构门禁兜底）
  onLog("警告：多次续写后输出仍不完整，交由构建门禁校验");
  return { raw: buffer, plan: parseGenerationPlan(buffer) };
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
