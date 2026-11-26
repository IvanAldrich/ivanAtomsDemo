import {
  llmConfigured,
  streamChat,
  type ChatMessageInput,
  type LlmUsage,
} from "@/lib/llm";
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
import {
  dependencySignatures,
  parseManifestJson,
  resolveDep,
  topologicalModules,
  type ModuleEntry,
  type ModuleManifest,
} from "./manifest";
import type { Profile } from "./profiles";
import { detectDependencies, packageJsonFor, scaffoldFiles } from "./scaffold";

export type StreamedGeneration = {
  raw: string;
  plan: GenerationPlan;
  continuations: number;
};

export type UsageMeta = {
  stage: string;
  file?: string;
  finishReason?: string | null;
  ms?: number;
};
export type UsageHandler = (usage: LlmUsage, meta: UsageMeta) => void;

type StreamOpts = {
  maxTokens?: number;
  onUsage?: UsageHandler;
  stage: string;
  file?: string;
};

/** 流式生成（含断点续写）：播报文件事件与思考进度，解析协议 */
async function streamGeneration(
  messages: ChatMessageInput[],
  onLog: (text: string) => void,
  opts: StreamOpts
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
  let continuations = 0;
  for (let round = 0; round < 4; round++) {
    const callStart = Date.now();
    const boundaryStart = buffer.length;
    const res = await streamChat(convo, onDelta, onReasoning, {
      maxTokens: opts.maxTokens,
      onUsage: (u, finishReason) =>
        opts.onUsage?.(u, {
          stage: opts.stage,
          file: opts.file,
          finishReason,
          ms: Date.now() - callStart,
        }),
    });
    if (round > 0) {
      // 续写边界清洗：模型重开的代码围栏行会污染文件内容（触发围栏门禁）
      const segment = buffer.slice(boundaryStart);
      const cleaned = segment.replace(
        /^(?:[ \t]*```[A-Za-z0-9_+-]*[ \t]*\r?\n)+/,
        ""
      );
      if (cleaned !== segment) {
        buffer = buffer.slice(0, boundaryStart) + cleaned;
        onLog("续写边界：已清理模型重开的代码围栏");
      }
    }
    if (res.finishReason !== "length") {
      return { raw: buffer, plan: parseGenerationPlan(buffer), continuations };
    }
    if (round === 3) break;
    continuations += 1;
    onLog(`输出达到长度上限，从断点继续（第 ${round + 1} 次续写）…`);
    convo = [
      ...convo,
      { role: "assistant", content: buffer },
      {
        role: "user",
        content:
          "请从断点精确继续输出剩余内容。若仍在上一个文件内，不要输出新的 ### FILE 头，也不要重新打开代码围栏，直接续写剩余代码；完成当前文件后，再按协议输出后续文件块。不要重复已输出的部分，不要重新开始。",
      },
    ];
  }

  onLog("警告：多次续写后输出仍不完整，交由构建门禁校验");
  return { raw: buffer, plan: parseGenerationPlan(buffer), continuations };
}

/** 迭代轮 / 修复轮：单次调用（协议含 FILE/EDIT/DELETE/NEED） */
export async function generateFirstRound(
  requirement: string,
  ctx: IterationContext | null,
  onLog: (text: string) => void,
  opts: { onUsage?: UsageHandler } = {}
): Promise<StreamedGeneration> {
  return streamGeneration(
    [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(requirement, ctx) },
    ],
    onLog,
    { stage: "iterate", onUsage: opts.onUsage }
  );
}

/** 从旧版计划文本中提取文件路径（兼容 MODULAR_GENERATION=off） */
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

type TwoPhaseOpts = {
  profile?: Profile;
  modular?: boolean;
  onUsage?: UsageHandler;
  onScaffold?: (
    manifest: ModuleManifest,
    stubs: Array<{ path: string; content: string }>
  ) => Promise<void>;
};

function moduleLayers(manifest: ModuleManifest): ModuleEntry[][] {
  const order = topologicalModules(manifest);
  const depth = new Map<string, number>();
  for (const m of order) {
    let d = 0;
    for (const dep of m.deps) {
      const resolved = resolveDep(m.path, dep);
      d = Math.max(d, (depth.get(resolved) ?? 0) + 1);
    }
    depth.set(m.path, d);
  }
  const layers: ModuleEntry[][] = [];
  for (const m of order) {
    const d = depth.get(m.path) ?? 0;
    (layers[d] ??= []).push(m);
  }
  return layers;
}

async function runPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const item = items[idx++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * 两阶段创建（新项目首轮）：
 * modular=true：计划输出 manifest，按依赖层生成，只注入依赖签名；
 * modular=false：旧版自由文本计划 + 上游全文（回滚路径）。
 */
export async function generateProjectTwoPhase(
  requirement: string,
  onLog: (text: string) => void,
  opts: TwoPhaseOpts = {}
): Promise<StreamedGeneration> {
  if (!llmConfigured()) {
    throw new Error("LLM 未配置（LLM_BASE_URL / LLM_API_KEY / LLM_MODEL）");
  }
  const modular = opts.modular !== false;

  if (!modular) return generateProjectLegacy(requirement, onLog, opts);

  onLog("两阶段生成 · 规划 Module Manifest…");
  let planRaw = "";
  const planMessages: ChatMessageInput[] = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: buildPlanPrompt(requirement, opts.profile) },
  ];
  const planStart = Date.now();
  await streamChat(
    planMessages,
    (d) => {
      planRaw += d;
    },
    undefined,
    {
      maxTokens: 2048,
      onUsage: (u, finishReason) =>
        opts.onUsage?.(u, {
          stage: "plan",
          finishReason,
          ms: Date.now() - planStart,
        }),
    }
  );
  const manifest = parseManifestJson(planRaw);
  if (manifest.modules.some((m) => m.path === "package.json")) {
    if (manifest.entry === "package.json") {
      throw new ProtocolError("manifest 入口不能是 package.json");
    }
    manifest.modules = manifest.modules.filter((m) => m.path !== "package.json");
    onLog("计划包含 package.json 模块，改由平台按依赖自动生成");
  }
  onLog(
    `计划 ${manifest.modules.length} 个模块（${manifest.profile}）：${manifest.modules
      .map((m) => m.path)
      .join("、")}`
  );

  const stubs = scaffoldFiles(manifest);
  await opts.onScaffold?.(manifest, stubs);

  const files: Array<{ path: string; content: string }> = [];
  const layers = moduleLayers(manifest);
  // 默认串行（1）：后续模块能看到已生成文件的真实实现，避免 DOM id/签名/状态字段漂移
  const concurrency = Math.max(
    1,
    Number(process.env.MODULAR_GEN_CONCURRENCY ?? 1) || 1
  );

  for (const layer of layers) {
    await runPool(layer, concurrency, async (module) => {
      onLog(`生成模块 ${module.path}（${module.role}）`);
      const deps = dependencySignatures(manifest, module);
      const gen = await streamGeneration(
        [
          { role: "system", content: buildSystemPrompt() },
          {
            role: "user",
            content: buildSingleFilePrompt(
              requirement,
              manifest,
              module,
              deps,
              files
            ),
          },
        ],
        onLog,
        { maxTokens: Number(process.env.LLM_FILE_OUTPUT_TOKENS ?? 24576), stage: "file", file: module.path, onUsage: opts.onUsage }
      );
      const file = gen.plan.files.find((f) => f.path === module.path);
      if (!file) {
        throw new ProtocolError(
          `模型未按协议输出文件 ${module.path}（实际输出：${
            gen.plan.files.map((f) => f.path).join(", ") || "无 FILE 块"
          }）`
        );
      }
      const bytes = Buffer.byteLength(file.content, "utf8");
      if (bytes > manifest.budgets.fileHardKB * 1024) {
        onLog(
          `警告：${module.path} 生成 ${Math.round(bytes / 1024)}KB，超过硬上限 ${
            manifest.budgets.fileHardKB
          }KB，将尝试自动拆分`
        );
      }
      files.push(file);
    });
  }

  const dependencies = detectDependencies(files);
  const packageJson = {
    path: "package.json",
    content: packageJsonFor(manifest.profile, dependencies),
  };
  return {
    raw: planRaw,
    continuations: 0,
    plan: {
      files: [...files, packageJson],
      edits: [],
      deletes: [],
      needs: [],
      preamble: "",
    },
  };
}

async function generateProjectLegacy(
  requirement: string,
  onLog: (text: string) => void,
  opts: TwoPhaseOpts
): Promise<StreamedGeneration> {
  onLog("两阶段生成 ·（回滚模式）规划文件清单…");
  const planPrompt = `用户需求：
${requirement}

请只输出本工程的实现计划（不要输出任何代码或文件内容）：
第一行给出工程整体方案一句话；然后每行一个文件，格式：
- 路径 — 该文件职责
路径使用相对路径。文件数控制在 4–12 个。`;
  let planRaw = "";
  const planStart = Date.now();
  await streamChat(
    [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: planPrompt },
    ],
    (d) => {
      planRaw += d;
    },
    undefined,
    {
      maxTokens: 2048,
      onUsage: (u, finishReason) =>
        opts.onUsage?.(u, {
          stage: "plan",
          finishReason,
          ms: Date.now() - planStart,
        }),
    }
  );
  const paths = parsePlanPaths(planRaw);
  if (paths.length < 2) {
    throw new ProtocolError(
      `工程计划输出不符合格式（需要每行 "- 路径 — 职责"）：${planRaw.slice(0, 300)}`
    );
  }
  onLog(`计划 ${paths.length} 个文件：${paths.join("、")}`);

  const files: Array<{ path: string; content: string }> = [];
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
    const priorText = prior
      .map((f) => `### 已生成文件 ${f.path}\n\`\`\`\n${f.content.slice(0, 12000)}\n\`\`\``)
      .join("\n\n");
    const gen = await streamGeneration(
      [
        { role: "system", content: buildSystemPrompt() },
        {
          role: "user",
          content: `工程需求：\n${requirement}\n\n# 工程文件计划\n${paths
            .map((p) => `- ${p}`)
            .join("\n")}\n\n${priorText ? `# 已生成的文件（保持接口/命名一致）\n${priorText}\n` : ""}
现在**只输出文件 ${target} 的完整内容**，格式：
### FILE: ${target}
\`\`\`语言
完整内容
\`\`\`
只输出这一个文件块，不要输出其他文件。`,
        },
      ],
      onLog,
      { maxTokens: Number(process.env.LLM_FILE_OUTPUT_TOKENS ?? 24576), stage: "file", file: target, onUsage: opts.onUsage }
    );
    const file = gen.plan.files.find((f) => f.path === target);
    if (!file) {
      throw new ProtocolError(
        `模型未按协议输出文件 ${target}（实际输出：${
          gen.plan.files.map((f) => f.path).join(", ") || "无 FILE 块"
        }）`
      );
    }
    files.push(file);
  }
  return {
    raw: planRaw,
    continuations: 0,
    plan: { files, edits: [], deletes: [], needs: [], preamble: "" },
  };
}

/** 修复轮生成：协议校验失败（无文件落盘）或构建失败（有文件） */
export async function generateRepairRound(
  input: {
    requirement: string;
    error: string;
    tree: string[];
    keyFileContents: Array<{ path: string; content: string; truncated?: boolean }>;
    previousRawTail: string;
    violations?: string[];
    targetPaths?: string[];
  },
  onLog: (text: string) => void,
  opts: { onUsage?: UsageHandler } = {}
): Promise<StreamedGeneration> {
  return streamGeneration(
    [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildRepairPrompt(input) },
    ],
    onLog,
    { stage: "repair", onUsage: opts.onUsage }
  );
}