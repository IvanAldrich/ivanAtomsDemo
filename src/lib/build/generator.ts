import { llmConfigured, streamChat, type ChatMessageInput } from "@/lib/llm";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildRepairPrompt,
  buildPlanPrompt,
  buildSingleFilePrompt,
  type IterationContext,
} from "./prompts";
import {
  parseGenerationPlan,
  isValidPath,
  ProtocolError,
  type GenerationPlan,
} from "./protocol";

export type StreamedGeneration = { raw: string; plan: GenerationPlan };

type GenerationOpts = { maxTokens?: number };

/** 流式生成（含断点续写）：播报文件事件与思考进度，解析协议 */
async function streamGeneration(
  messages: ChatMessageInput[],
  onLog: (text: string) => void,
  opts: GenerationOpts = {}
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
    const headerRe = /^### (FILE|EDIT|DELETE):\s*(.+?)\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = headerRe.exec(buffer)) !== null) {
      const key = `${m[1]}:${m[2]}`;
      if (!announced.has(key)) {
        announced.add(key);
        onLog(
          m[1] === "FILE"
            ? `生成文件 ${m[2]}`
            : m[1] === "EDIT"
              ? `增量修改 ${m[2]}`
              : `标记删除 ${m[2]}`
        );
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

  // 断点续写：达到 max_tokens 时让模型从断点精确续写（最多 3 次）
  let convo = [...messages];
  for (let round = 0; round < 4; round++) {
    const res = await streamChat(convo, onDelta, onReasoning, opts);
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
          "你的输出因长度限制被截断。请从断点精确继续输出剩余内容：不要重复已输出的部分，不要重新开始，直接续写当前文件剩余内容与后续块（保持输出协议）。",
      },
    ];
  }

  onLog("警告：多次续写后输出仍不完整，交由构建门禁校验");
  return { raw: buffer, plan: parseGenerationPlan(buffer) };
}

/** 迭代轮 / 修复轮：单次调用（协议含 FILE/EDIT/DELETE） */
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

/** 从计划文本中提取文件路径（每行 "- 路径 — 职责"） */
function parsePlanPaths(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    const m = /^\s*[-*]\s*([A-Za-z0-9_][A-Za-z0-9_./-]*)\s*(?:[—–:：-]|$)/.exec(
      line
    );
    if (!m) continue;
    const p = m[1].replace(/\/$/, "");
    if (!isValidPath(p)) continue;
    if (!/\.[A-Za-z0-9]+$/.test(p) && p !== "package.json") continue;
    if (!out.includes(p)) out.push(p);
    if (out.length >= 30) break;
  }
  if (out.length > 0 && !out.includes("package.json")) out.unshift("package.json");
  return out;
}

/**
 * 两阶段创建（新项目首轮）：
 * 阶段一计划文件清单（小输出）；阶段二逐文件独立生成（每文件独立预算）。
 * 从根本上规避「多个大文件挤在单次输出里撞 max_tokens」。
 */
export async function generateProjectTwoPhase(
  requirement: string,
  onLog: (text: string) => void
): Promise<StreamedGeneration> {
  if (!llmConfigured()) {
    throw new Error("LLM 未配置（LLM_BASE_URL / LLM_API_KEY / LLM_MODEL）");
  }

  // —— 阶段一：文件清单 ——
  onLog("两阶段生成 · 规划工程结构…");
  const planMessages: ChatMessageInput[] = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: buildPlanPrompt(requirement) },
  ];
  let planRaw = "";
  await streamChat(
    planMessages,
    (d) => {
      planRaw += d;
    },
    undefined,
    { maxTokens: 2048 }
  );
  const planLines = planRaw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s/.test(l))
    .slice(0, 30);
  const paths = parsePlanPaths(planRaw);
  if (paths.length < 2) {
    throw new ProtocolError(
      `工程计划输出不符合格式（需要每行 "- 路径 — 职责"）：${planRaw.slice(0, 300)}`
    );
  }
  onLog(`计划 ${paths.length} 个文件：${paths.join("、")}`);

  // —— 阶段二：逐文件生成（每个文件独立调用与预算） ——
  const files: Array<{ path: string; content: string }> = [];
  const raws: string[] = [planRaw];
  for (let i = 0; i < paths.length; i++) {
    const target = paths[i];
    onLog(`生成文件 ${i + 1}/${paths.length}：${target}`);

    const prior: Array<{ path: string; content: string }> = [];
    let budget = 24000;
    for (const f of [...files].reverse()) {
      const size = Math.min(f.content.length, 6000);
      if (budget - size < 0) break;
      prior.unshift({ path: f.path, content: f.content.slice(0, 6000) });
      budget -= size;
    }

    const gen = await streamGeneration(
      [
        { role: "system", content: buildSystemPrompt() },
        {
          role: "user",
          content: buildSingleFilePrompt(requirement, planLines, target, prior),
        },
      ],
      () => {},
      { maxTokens: 12000 }
    );

    const file =
      gen.plan.files.find((f) => f.path === target) ??
      (gen.plan.files.length === 1 ? gen.plan.files[0] : null);
    if (!file) {
      throw new ProtocolError(
        `模型未按协议输出文件 ${target}（实际输出：${gen.plan.files.map((f) => f.path).join(", ") || "无 FILE 块"}）`
      );
    }
    files.push(file);
    raws.push(gen.raw);
  }

  return {
    raw: raws.join("\n\n"),
    plan: { files, edits: [], deletes: [], preamble: "" },
  };
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