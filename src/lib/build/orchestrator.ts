import { cp, readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { llmConfigured, llmModel } from "@/lib/llm";
import {
  generateFirstRound,
  generateProjectTwoPhase,
  generateRepairRound,
  type UsageHandler,
} from "./generator";
import {
  cleanupUncommittedSnapshots,
  gcSnapshots,
  readTree,
  selectKeyFiles,
  writeSnapshot,
} from "./snapshot";
import { readRunMetadata, snapshotDir } from "@/lib/storage";
import { runSandboxedBuild } from "./builder";
import { reviewRequirements } from "./reviewer";
import { isolationLevel, isolationNotice } from "./executor";
import { MAX_NEED_ROUNDS, validatePlan } from "./protocol";
import {
  buildIterationContext,
  resolveNeeds,
  type IterationContextBundle,
} from "./context";
import {
  deriveHeuristicManifest,
  readManifest,
  resolveBudgets,
  syncManifestFiles,
  writeManifest,
  type ModuleManifest,
} from "./manifest";
import { autoSplitOversized, splitFile } from "./split";
import { selectProfile } from "./profiles";
import { modularGenerationEnabled, structureModeFor } from "./flags";
import { removalRequested, shouldRunReview } from "./intent";
import { formatViolations, type Violation } from "./structure";
import { recordBuildStat, recordLlmStat, type FileSizeStat } from "./stats";
import type { IterationContext } from "./prompts";

export type BuildEvent =
  | {
      type: "stage";
      stage:
        | "queued"
        | "generating"
        | "building"
        | "repairing"
        | "success"
        | "failed";
      detail?: string;
    }
  | { type: "log"; text: string }
  | { type: "error"; message: string }
  | { type: "done"; ok: boolean }
  | { type: "round-end" };

type Emit = (ev: BuildEvent) => void;

const MAX_BUILD_ATTEMPTS = 5; // 生成 + 构建 + 修复共用上限
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const failedOnce = new Set<string>();

async function requirementHistory(projectId: string): Promise<string[]> {
  const messages = await prisma.message.findMany({
    where: { projectId, role: "user" },
    orderBy: { createdAt: "asc" },
    select: { content: true },
  });
  return messages.map((m) => m.content);
}

function toPromptCtx(bundle: IterationContextBundle): IterationContext {
  return {
    requirementHistory: bundle.requirements,
    fileTree: [],
    keyFileContents: bundle.files,
    manifestSummary: bundle.manifestSummary,
    stubs: bundle.stubs,
    targetPaths: bundle.targetPaths,
  };
}

function guardDeletes(plan: { deletes: string[] }, userText: string): void {
  if (plan.deletes.length > 0 && !removalRequested(userText)) {
    throw new Error(
      `本轮未请求删除文件，禁止删除模块：${plan.deletes.join(
        "、"
      )}；请在原文件内修复，不得删除绕过门禁`
    );
  }
}

async function guardModuleRemoval(opts: {
  candidate: string;
  baseDir: string | null;
  referencePaths: string[];
  manifest: ModuleManifest | null;
  userText: string;
  log: (text: string) => void;
}): Promise<ModuleManifest | null> {
  if (removalRequested(opts.userText)) return opts.manifest;
  const current = await readManifest(opts.candidate);
  const currentPaths = new Set(current?.modules.map((m) => m.path) ?? []);
  const removed = opts.referencePaths.filter((p) => !currentPaths.has(p));
  if (removed.length === 0) return opts.manifest;
  if (!opts.baseDir) {
    throw new Error(
      `检测到模块被删除：${removed.join("、")}；请恢复被删模块，不得删除绕过门禁`
    );
  }
  for (const rel of removed) {
    try {
      await cp(path.join(opts.baseDir, rel), path.join(opts.candidate, rel));
    } catch {
      /* 基线中不存在则无法恢复 */
    }
  }
  opts.log(`已恢复被删除的模块：${removed.join("、")}`);
  const base = opts.manifest ?? current ?? (await deriveHeuristicManifest(opts.candidate));
  const synced = await syncManifestFiles(opts.candidate, base);
  await writeManifest(opts.candidate, synced);
  return synced;
}

function changeLines(plan: {
  files: Array<{ path: string }>;
  edits: Array<{ path: string }>;
  deletes: string[];
}): string[] {
  return [
    ...plan.files.map((f) => `+ ${f.path}`),
    ...[...new Set(plan.edits.map((e) => e.path))].map((p) => `~ ${p}`),
    ...plan.deletes.map((p) => `- ${p}`),
  ];
}

async function collectFileSizes(
  dir: string,
  manifest: ModuleManifest | null
): Promise<FileSizeStat[]> {
  const tree = await readTree(dir);
  const budgets = resolveBudgets(manifest?.budgets);
  const out: FileSizeStat[] = [];
  for (const rel of tree) {
    if (!/\.(js|mjs|cjs|jsx|ts|tsx|css|html)$/i.test(rel)) continue;
    try {
      const bytes = Buffer.byteLength(await readFile(path.join(dir, rel), "utf8"), "utf8");
      const isHtml = rel.endsWith(".html");
      out.push({
        path: rel,
        bytes,
        overSoft: bytes > (isHtml ? budgets.htmlKB : budgets.fileSoftKB) * 1024,
        overHard: bytes > (isHtml ? budgets.htmlKB : budgets.fileHardKB) * 1024,
      });
    } catch {
      /* ignore */
    }
  }
  return out;
}

function classifyFailure(message: string, violations: Violation[]): string {
  if (violations.length > 0) return "structure";
  if (/未按协议|协议|manifest|JSON|缺少 package|文件超过模块预算/.test(message)) {
    return "protocol";
  }
  if (/语法/.test(message)) return "syntax";
  if (/npm install|\[install\]/.test(message)) return "install";
  if (/启动|端口/.test(message)) return "start";
  if (/需求覆盖/.test(message)) return "review";
  if (/超时|timeout|timed out/i.test(message)) return "timeout";
  return "build";
}

type RoundMetrics = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  continuations: number;
  splits: number;
  edits: number;
  repairRounds: number;
  contextFiles: string[];
  contextBytes: number;
};

async function maybeAutoSplit(
  dir: string,
  manifest: ModuleManifest | null,
  metrics: RoundMetrics,
  log: (text: string) => void
): Promise<ModuleManifest | null> {
  if (!manifest) return null;
  const result = await autoSplitOversized(dir, manifest, { onLog: log });
  if (result.splits > 0) {
    metrics.splits += result.splits;
    await writeManifest(dir, result.manifest);
    log(`[split] 已自动拆分 ${result.splits} 个超限文件`);
  }
  return result.manifest;
}

async function syncAndMaybeSplit(
  dir: string,
  manifest: ModuleManifest | null,
  metrics: RoundMetrics,
  log: (text: string) => void
): Promise<ModuleManifest | null> {
  if (!manifest) return null;
  const synced = await syncManifestFiles(dir, manifest);
  await writeManifest(dir, synced);
  return maybeAutoSplit(dir, synced, metrics, log);
}

/**
 * 执行一轮构建：生成 →（协议校验或构建失败则）自修复循环 → 版本落账。
 */
export async function runBuildRound(
  job: { projectId: string; messageId: string },
  emit: Emit
) {
  const message = await prisma.message.findUnique({
    where: { id: job.messageId },
  });
  if (!message || message.role !== "user") return;
  const round = message.buildRound ?? 1;

  await prisma.message.update({
    where: { id: message.id },
    data: { buildStatus: "generating" },
  });
  await prisma.project.update({
    where: { id: job.projectId },
    data: { status: "generating", updatedAt: new Date() },
  });
  emit({ type: "stage", stage: "generating" });

  let finalizeStats: ((ok: boolean, failureCategory: string | null) => void) | null = null;

  try {
    let summary: string;

    if (llmConfigured()) {
      const modular = modularGenerationEnabled();
      const iso = await isolationLevel();
      emit({ type: "log", text: isolationNotice(iso.level, iso.degraded) });
      emit({
        type: "log",
        text: modular ? "模块化生成：on" : "模块化生成：off（回滚模式）",
      });

      const candidates: { manifest: ModuleManifest | null } = { manifest: null };
      const committed = await prisma.appVersion.findMany({
        where: { projectId: job.projectId },
        orderBy: { version: "desc" },
        select: { version: true, snapshotDir: true },
      });
      const baseDir = committed[0]?.snapshotDir ?? null;
      const history = await requirementHistory(job.projectId);
      const cleaned = await cleanupUncommittedSnapshots(
        job.projectId,
        new Set(committed.map((v) => v.version))
      );
      if (cleaned > 0) {
        emit({ type: "log", text: `清理 ${cleaned} 个失败候选快照` });
      }
      let manifest: ModuleManifest | null = null;
      let hadManifest = false;
      let bundle: IterationContextBundle | null = null;
      let ctx: IterationContext | null = null;

      const startedAt = Date.now();
      const metrics: RoundMetrics = {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        continuations: 0,
        splits: 0,
        edits: 0,
        repairRounds: 0,
        contextFiles: [],
        contextBytes: 0,
      };
      const onUsage: UsageHandler = (usage, meta) => {
        metrics.inputTokens += usage.promptTokens;
        metrics.outputTokens += usage.completionTokens;
        metrics.reasoningTokens += usage.reasoningTokens;
        recordLlmStat({
          projectId: job.projectId,
          stage: meta.stage,
          model: llmModel(),
          file: meta.file,
          inputTokens: usage.promptTokens,
          outputTokens: usage.completionTokens,
          reasoningTokens: usage.reasoningTokens,
          finishReason: meta.finishReason ?? null,
          ms: meta.ms ?? 0,
        });
      };

      if (baseDir) {
        const stored = modular ? await readManifest(baseDir) : null;
        hadManifest = Boolean(stored);
        if (modular) {
          manifest = stored ?? (await deriveHeuristicManifest(baseDir));
          if (!stored) await writeManifest(baseDir, manifest);
          bundle = await buildIterationContext(baseDir, message.content, history, {
            manifest,
          });
          ctx = toPromptCtx(bundle);
          metrics.contextFiles = bundle.files.map((f) => f.path);
          metrics.contextBytes = bundle.totalBytes;
          emit({
            type: "log",
            text: `迭代上下文：${bundle.files.length} 个文件 / ${Math.round(
              bundle.totalBytes / 1024
            )}KB（预算 ${bundle.budgetKB}KB）`,
          });
        } else {
          const keyFiles = await selectKeyFiles(baseDir);
          ctx = {
            requirementHistory: history,
            fileTree: await readTree(baseDir),
            keyFileContents: keyFiles,
          };
          metrics.contextFiles = keyFiles.map((f) => f.path);
        }
        emit({ type: "log", text: "迭代模式：基于当前工程生成修改" });
      } else {
        emit({ type: "log", text: "首次构建：从零生成工程" });
      }
      candidates.manifest = manifest;
      let referenceModulePaths: string[] =
        manifest?.modules.map((m) => m.path) ?? [];

      const candidate = snapshotDir(job.projectId, round);
      const structureMode = structureModeFor({
        modular,
        hasBase: Boolean(baseDir),
        hadManifest,
        strictEnv: process.env.MODULAR_STRICT,
      });
      finalizeStats = (ok, failureCategory) => {
        void (async () => {
          const fileSizes = await collectFileSizes(candidate, candidates.manifest);
          recordBuildStat({
            projectId: job.projectId,
            round,
            ok,
            durationMs: Date.now() - startedAt,
            contextFiles: metrics.contextFiles,
            contextBytes: metrics.contextBytes,
            inputTokens: metrics.inputTokens,
            outputTokens: metrics.outputTokens,
            reasoningTokens: metrics.reasoningTokens,
            edits: metrics.edits,
            continuations: metrics.continuations,
            splits: metrics.splits,
            repairRounds: metrics.repairRounds,
            failureCategory,
            fileSizes,
          });
        })();
      };

      let wroteSnapshot = false;
      let lastError = "";
      let lastRaw = "";
      let lastPreamble = "";
      let lastViolations: Violation[] = [];
      let buildOk = false;
      let finalFileList: string[] = [];
      let reviewFailCount = 0;
      let reviewCaveat = "";
      const editFailures = new Map<string, number>();

      for (let attempt = 1; attempt <= MAX_BUILD_ATTEMPTS; attempt++) {
        if (attempt > 1) {
          metrics.repairRounds += 1;
          emit({
            type: "stage",
            stage: "repairing",
            detail: `attempt ${attempt}/${MAX_BUILD_ATTEMPTS}`,
          });
          emit({
            type: "log",
            text: `自动修复第 ${attempt - 1}/${MAX_BUILD_ATTEMPTS - 1} 轮`,
          });
        }

        try {
          if (attempt === 1) {
            if (baseDir) {
              let gen = await generateFirstRound(
                message.content,
                ctx,
                (text) => emit({ type: "log", text }),
                { onUsage }
              );
              let needRounds = 0;
              while (
                modular &&
                bundle &&
                gen.plan.needs.length > 0 &&
                needRounds < MAX_NEED_ROUNDS
              ) {
                emit({
                  type: "log",
                  text: `模型请求补充上下文：${gen.plan.needs.join("、")}`,
                });
                const resolved = await resolveNeeds(baseDir, bundle, gen.plan.needs);
                if (resolved.added.length === 0) break;
                bundle = resolved.bundle;
                ctx = toPromptCtx(bundle);
                metrics.contextFiles = bundle.files.map((f) => f.path);
                metrics.contextBytes = bundle.totalBytes;
                needRounds += 1;
                gen = await generateFirstRound(
                  message.content,
                  ctx,
                  (text) => emit({ type: "log", text }),
                  { onUsage }
                );
              }
              lastRaw = gen.raw;
              metrics.continuations += gen.continuations;
              metrics.edits += gen.plan.edits.length;

              if (
                gen.plan.needs.length > 0 &&
                gen.plan.files.length === 0 &&
                gen.plan.edits.length === 0 &&
                gen.plan.deletes.length === 0
              ) {
                throw new Error(
                  `模型连续请求上下文（${gen.plan.needs.join("、")}）但未产出修改；请缩小目标文件或检查 manifest`
                );
              }

              const conversational =
                ctx !== null &&
                gen.plan.files.length === 0 &&
                gen.plan.deletes.length === 0 &&
                gen.plan.edits.length === 0 &&
                gen.plan.needs.length === 0 &&
                gen.raw.trim().length > 0;
              if (conversational) {
                const reply = gen.raw.trim().slice(0, 4000);
                await prisma.message.create({
                  data: {
                    projectId: job.projectId,
                    role: "assistant",
                    content: reply,
                    buildRound: round,
                    buildStatus: "success",
                  },
                });
                await prisma.message.update({
                  where: { id: message.id },
                  data: { buildStatus: "success" },
                });
                await prisma.project.update({
                  where: { id: job.projectId },
                  data: { status: "ready", updatedAt: new Date() },
                });
                finalizeStats?.(true, null);
                finalizeStats = null;
                emit({ type: "stage", stage: "success" });
                emit({ type: "done", ok: true });
                return;
              }

              validatePlan(gen.plan, {
                requirePackageJson: !baseDir,
                maxCodeFileKB: 512,
              });
              guardDeletes(gen.plan, message.content);
              await writeSnapshot(baseDir, candidate, gen.plan);
              if (modular) {
                manifest = await syncAndMaybeSplit(
                  candidate,
                  (await readManifest(candidate)) ?? manifest,
                  metrics,
                  (text) => emit({ type: "log", text })
                );
                manifest =
                  (await guardModuleRemoval({
                    candidate,
                    baseDir,
                    referencePaths: referenceModulePaths,
                    manifest,
                    userText: message.content,
                    log: (text) => emit({ type: "log", text }),
                  })) ?? manifest;
              }
              finalFileList = changeLines(gen.plan);
              lastPreamble = gen.plan.preamble.trim();
            } else {
              const profile = selectProfile(message.content);
              const gen = await generateProjectTwoPhase(
                message.content,
                (text) => emit({ type: "log", text }),
                {
                  profile,
                  modular,
                  onUsage,
                  onScaffold: async (mf, stubs) => {
                    referenceModulePaths = mf.modules.map((m) => m.path);
                    await writeManifest(candidate, mf);
                    await writeSnapshot(candidate, candidate, {
                      files: stubs,
                      deletes: [],
                    });
                  },
                }
              );
              lastRaw = gen.raw;
              metrics.continuations += gen.continuations;
              metrics.edits += gen.plan.edits.length;
              validatePlan(gen.plan, {
                requirePackageJson: true,
                maxCodeFileKB: 512,
              });
              guardDeletes(gen.plan, message.content);
              if (modular) {
                await writeSnapshot(candidate, candidate, gen.plan);
              } else {
                await writeSnapshot(null, candidate, gen.plan);
              }
              if (modular) {
                manifest = await syncAndMaybeSplit(
                  candidate,
                  (await readManifest(candidate)) ?? manifest,
                  metrics,
                  (text) => emit({ type: "log", text })
                );
                manifest =
                  (await guardModuleRemoval({
                    candidate,
                    baseDir,
                    referencePaths: referenceModulePaths,
                    manifest,
                    userText: message.content,
                    log: (text) => emit({ type: "log", text }),
                  })) ?? manifest;
              }
              finalFileList = changeLines(gen.plan);
              lastPreamble = gen.plan.preamble.trim();
            }
          } else {
            const tree = wroteSnapshot ? await readTree(candidate) : [];
            const currentManifest = await readManifest(candidate);
            let repairCtx: IterationContext | null = null;
            if (modular) {
              const recent = lastViolations.map((v) => v.path);
              const b = await buildIterationContext(
                candidate,
                lastError.slice(0, 4000),
                history,
                { manifest: currentManifest ?? manifest, recentPaths: recent }
              );
              repairCtx = toPromptCtx(b);
            } else {
              repairCtx = {
                requirementHistory: history,
                fileTree: tree,
                keyFileContents: wroteSnapshot ? await selectKeyFiles(candidate) : [],
              };
            }
            const gen = await generateRepairRound(
              {
                requirement: message.content,
                error: lastError,
                tree,
                keyFileContents: repairCtx?.keyFileContents ?? [],
                previousRawTail: lastRaw.slice(-2000),
                violations: lastViolations.length
                  ? [formatViolations(lastViolations)]
                  : undefined,
                targetPaths: repairCtx?.targetPaths,
              },
              (text) => emit({ type: "log", text }),
              { onUsage }
            );
            lastRaw = gen.raw;
            metrics.continuations += gen.continuations;
            metrics.edits += gen.plan.edits.length;
            validatePlan(gen.plan, {
              requirePackageJson: !wroteSnapshot && !baseDir,
              maxCodeFileKB: 512,
            });
            guardDeletes(gen.plan, message.content);
            await writeSnapshot(wroteSnapshot ? candidate : baseDir, candidate, gen.plan);
            if (modular) {
              manifest = await syncAndMaybeSplit(
                candidate,
                (await readManifest(candidate)) ?? manifest,
                metrics,
                (text) => emit({ type: "log", text })
              );
              manifest =
                (await guardModuleRemoval({
                  candidate,
                  baseDir,
                  referencePaths: referenceModulePaths,
                  manifest,
                  userText: message.content,
                  log: (text) => emit({ type: "log", text }),
                })) ?? manifest;
            }
            finalFileList = changeLines(gen.plan);
            lastPreamble = gen.plan.preamble.trim();
          }
          wroteSnapshot = true;
          candidates.manifest = manifest;
        } catch (err) {
          lastError = err instanceof Error ? err.message : "generation protocol error";
          lastViolations = [];
          emit({
            type: "log",
            text: `第 ${attempt} 次生成未通过校验：${lastError}`,
          });
          if (modular) {
            const editFailure = /EDIT 失败：在 (.+?) 中/.exec(lastError);
            if (editFailure) {
              const failingPath = editFailure[1].trim();
              const count = (editFailures.get(failingPath) ?? 0) + 1;
              editFailures.set(failingPath, count);
              // 连续 EDIT 匹配失败时，强制改为整文件输出（flash 模型逐字匹配不可靠）
              if (count >= 2) {
                lastError += `\n\n修复要求：对 ${failingPath} 禁止再使用 EDIT——必须用「### FILE: ${failingPath}」输出该文件完整内容（已连续 ${count} 次 SEARCH 匹配失败）。`;
              }
              if (count >= 2) {
                const currentManifest = (await readManifest(candidate)) ?? manifest;
                if (currentManifest && wroteSnapshot) {
                  const split = await splitFile(
                    candidate,
                    failingPath,
                    currentManifest,
                    await readTree(candidate)
                  );
                  if (split) {
                    metrics.splits += 1;
                    manifest = split.manifest;
                    await writeManifest(candidate, split.manifest);
                    emit({
                      type: "log",
                      text: `[split] ${failingPath} 连续 EDIT 失败，已拆分为 ${split.newFiles.join(
                        "、"
                      )}`,
                    });
                  } else {
                    emit({
                      type: "log",
                      text: `[split] ${failingPath} 未拆分（未超过 hard 或拆分计划不安全），继续修复`,
                    });
                  }
                }
                editFailures.delete(failingPath);
              }
            }
          }
          continue;
        }

        emit({
          type: "stage",
          stage: "building",
          detail: `attempt ${attempt}/${MAX_BUILD_ATTEMPTS}`,
        });
        const outcome = await runSandboxedBuild(
          candidate,
          (l) => emit({ type: "log", text: l }),
          {
            structureMode,
            manifest: (await readManifest(candidate)) ?? manifest,
          }
        );
        if (!outcome.ok) {
          lastError = outcome.errorTail;
          lastViolations = outcome.violations ?? [];
          emit({
            type: "log",
            text: `第 ${attempt} 次构建失败，错误尾部：\n${lastError.slice(-600)}`,
          });
          continue;
        }

        // L4 需求自检：构建通过 ≠ 需求满足（可 LLM_REVIEW=off 关闭）
        // 熔断：构建/启动/冒烟已通过但 review 连续 3 次不通过时，接受版本并附带提醒，
        // 避免「门禁全过 → review 模糊反馈 → 模型无法收敛 → 5 轮全废」的死循环。
        const reviewEnabled =
          process.env.LLM_REVIEW !== "off" && process.env.LLM_REVIEW !== "false";
        if (reviewEnabled) {
          if (!shouldRunReview(message.content, { isNewProject: !baseDir })) {
            emit({
              type: "log",
              text: "验收自检：跳过（缺陷报告/咨询类消息；构建与冒烟已通过）",
            });
          } else {
            emit({ type: "log", text: "验收自检：对照需求核对功能覆盖…" });
            try {
              const reviewStart = Date.now();
              const review = await reviewRequirements(
                message.content,
                candidate,
                (usage, finishReason) =>
                  onUsage(usage, {
                    stage: "review",
                    finishReason,
                    ms: Date.now() - reviewStart,
                  })
              );
              if (!review.pass) {
                reviewFailCount += 1;
                lastError = `需求覆盖检查未通过：${review.feedback}`;
                lastViolations = [];
                emit({ type: "log", text: lastError });
                if (reviewFailCount >= 3) {
                  emit({
                    type: "log",
                    text: `验收熔断：构建/启动/冒烟已通过但 review 连续 ${reviewFailCount} 次不通过；接受本版本并附验收提醒`,
                  });
                  reviewCaveat = review.feedback;
                } else {
                  continue;
                }
              } else {
                emit({ type: "log", text: "验收自检通过" });
              }
            } catch (err) {
              emit({
                type: "log",
                text: `（验收自检调用失败，本次跳过：${
                  err instanceof Error ? err.message : "unknown"
                }）`,
              });
            }
          }
        }

        buildOk = true;
        break;
      }

      if (!buildOk) {
        finalizeStats?.(false, classifyFailure(lastError, lastViolations));
        finalizeStats = null;
        throw new Error(
          `构建在 ${MAX_BUILD_ATTEMPTS} 次尝试（含自修复）后失败。最后错误：\n${lastError.slice(
            -800
          )}`
        );
      }

      const version = await prisma.appVersion.create({
        data: {
          projectId: job.projectId,
          version: round,
          snapshotDir: candidate,
          triggeredMessageId: message.id,
        },
      });
      await prisma.project.update({
        where: { id: job.projectId },
        data: { currentVersionId: version.id, updatedAt: new Date() },
      });
      const protect = [candidate];
      const run = await readRunMetadata(job.projectId);
      const runningVersionId =
        typeof run?.versionId === "string" ? run.versionId : null;
      if (runningVersionId) {
        const running = await prisma.appVersion.findUnique({
          where: { id: runningVersionId },
          select: { snapshotDir: true },
        });
        if (running) protect.push(running.snapshotDir);
      }
      await gcSnapshots(job.projectId, 3, protect).catch(() => 0);

      summary = [
        lastPreamble ? `变更说明：${lastPreamble.slice(0, 400)}` : "",
        `工程快照 v${round} 已通过沙箱构建与启动验证：`,
        ...finalFileList,
        reviewCaveat
          ? `⚠ 验收提醒（review 连续 ${reviewFailCount} 次未完全通过，已按熔断策略接受）：${reviewCaveat.slice(0, 500)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      finalizeStats?.(true, reviewCaveat ? "review-caveat" : null);
      finalizeStats = null;
    } else {
      // —— 演示生成器（临时占位）——
      emit({ type: "log", text: "demo generator: analyzing request…" });
      await sleep(600);
      const forcedFailure =
        message.content.trim().startsWith("/fail") && !failedOnce.has(message.id);
      if (forcedFailure) {
        failedOnce.add(message.id);
        throw new Error("演示失败：消息以 /fail 开头（重试将成功）");
      }
      emit({ type: "log", text: "demo generator: composing files…" });
      await sleep(400);
      summary = `已收到需求：「${message.content.slice(0, 120)}」。\n（演示生成器响应 —— 配置 LLM_BASE_URL/LLM_API_KEY/LLM_MODEL 后启用真实全栈工程生成。）`;
    }

    await prisma.message.create({
      data: {
        projectId: job.projectId,
        role: "assistant",
        content: summary,
        buildRound: round,
        buildStatus: "success",
      },
    });
    await prisma.message.update({
      where: { id: message.id },
      data: { buildStatus: "success" },
    });
    await prisma.project.update({
      where: { id: job.projectId },
      data: { status: "ready", updatedAt: new Date() },
    });
    emit({ type: "stage", stage: "success" });
    emit({ type: "done", ok: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    finalizeStats?.(false, classifyFailure(reason, []));
    await prisma.message.create({
      data: {
        projectId: job.projectId,
        role: "assistant",
        content: `构建失败：${reason}`,
        buildRound: round,
        buildStatus: "failed",
      },
    });
    await prisma.message.update({
      where: { id: message.id },
      data: { buildStatus: "failed" },
    });
    await prisma.project.update({
      where: { id: job.projectId },
      data: { status: "failed", updatedAt: new Date() },
    });
    emit({ type: "error", message: reason });
    emit({ type: "stage", stage: "failed" });
    emit({ type: "done", ok: false });
  }
}