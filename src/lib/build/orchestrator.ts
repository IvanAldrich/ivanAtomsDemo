import { prisma } from "@/lib/prisma";
import { llmConfigured } from "@/lib/llm";
import { generateFirstRound, generateRepairRound } from "./generator";
import {
  gcSnapshots,
  latestSnapshot,
  readTree,
  selectKeyFiles,
  writeSnapshot,
} from "./snapshot";
import { snapshotDir } from "@/lib/storage";
import { runSandboxedBuild } from "./builder";
import { reviewRequirements } from "./reviewer";
import { isolationLevel, isolationNotice } from "./executor";
import { validatePlan } from "./protocol";

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

// 演示失败只触发一次：同一消息重试即成功（用于验证失败保护与重试链路）
const failedOnce = new Set<string>();

async function requirementHistory(projectId: string): Promise<string[]> {
  const messages = await prisma.message.findMany({
    where: { projectId, role: "user" },
    orderBy: { createdAt: "asc" },
    select: { content: true },
  });
  return messages.map((m) => m.content);
}

/**
 * 执行一轮构建：生成 →（协议校验或构建失败则）自修复循环 → 版本落账。
 * 协议校验失败同样进入修复循环（把校验错误回传模型重出）。
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

  try {
    let summary: string;

    if (llmConfigured()) {
      // —— 真实自由生成 + 沙箱构建 + 统一自修复 ——
      const iso = await isolationLevel();
      emit({ type: "log", text: isolationNotice(iso.level, iso.degraded) });

      const baseDir = await latestSnapshot(job.projectId);
      const ctx = baseDir
        ? {
            requirementHistory: await requirementHistory(job.projectId),
            fileTree: await readTree(baseDir),
            keyFileContents: await selectKeyFiles(baseDir),
          }
        : null;
      emit({
        type: "log",
        text: ctx ? "迭代模式：基于当前工程生成修改" : "首次构建：从零生成工程",
      });

      const candidate = snapshotDir(job.projectId, round);
      let wroteSnapshot = false;
      let lastError = "";
      let lastRaw = "";
      let buildOk = false;
      let finalFileList: string[] = [];

      for (let attempt = 1; attempt <= MAX_BUILD_ATTEMPTS; attempt++) {
        if (attempt > 1) {
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
            const gen = await generateFirstRound(
              message.content,
              ctx,
              (text) => emit({ type: "log", text })
            );
            lastRaw = gen.raw;

            // 对话式消息：迭代轮中模型无文件输出且给了文字回答 → 直接回复，不构建
            const conversational =
              ctx !== null &&
              gen.plan.files.length === 0 &&
              gen.plan.deletes.length === 0 &&
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
              emit({ type: "stage", stage: "success" });
              emit({ type: "done", ok: true });
              return;
            }

            validatePlan(gen.plan, { requirePackageJson: !baseDir });
            await writeSnapshot(baseDir, candidate, gen.plan);
            finalFileList = gen.plan.files.map((f) => f.path);
          } else {
            const tree = wroteSnapshot ? await readTree(candidate) : [];
            const files = wroteSnapshot ? await selectKeyFiles(candidate) : [];
            const gen = await generateRepairRound(
              {
                requirement: message.content,
                error: lastError,
                tree,
                keyFileContents: files,
                previousRawTail: lastRaw.slice(-2000),
              },
              (text) => emit({ type: "log", text })
            );
            lastRaw = gen.raw;
            validatePlan(gen.plan, {
              requirePackageJson: !wroteSnapshot && !baseDir,
            });
            await writeSnapshot(wroteSnapshot ? candidate : baseDir, candidate, gen.plan);
            finalFileList = gen.plan.files.map((f) => f.path);
          }
          wroteSnapshot = true;
        } catch (err) {
          // 协议/校验失败 → 进入修复循环
          lastError =
            err instanceof Error ? err.message : "generation protocol error";
          emit({
            type: "log",
            text: `第 ${attempt} 次生成未通过校验：${lastError}`,
          });
          continue;
        }

        emit({
          type: "stage",
          stage: "building",
          detail: `attempt ${attempt}/${MAX_BUILD_ATTEMPTS}`,
        });
        const outcome = await runSandboxedBuild(candidate, (l) =>
          emit({ type: "log", text: l })
        );
        if (!outcome.ok) {
          lastError = outcome.errorTail;
          emit({
            type: "log",
            text: `第 ${attempt} 次构建失败，错误尾部：\n${lastError.slice(-600)}`,
          });
          continue;
        }

        // L4 需求自检：构建通过 ≠ 需求满足（可 LLM_REVIEW=off 关闭）
        if (process.env.LLM_REVIEW !== "off" && process.env.LLM_REVIEW !== "false") {
          emit({ type: "log", text: "验收自检：对照需求核对功能覆盖…" });
          try {
            const review = await reviewRequirements(message.content, candidate);
            if (!review.pass) {
              lastError = `需求覆盖检查未通过：${review.feedback}`;
              emit({ type: "log", text: lastError });
              continue;
            }
            emit({ type: "log", text: "验收自检通过" });
          } catch (err) {
            emit({
              type: "log",
              text: `（验收自检调用失败，本次跳过：${
                err instanceof Error ? err.message : "unknown"
              }）`,
            });
          }
        }

        buildOk = true;
        break;
      }

      if (!buildOk) {
        throw new Error(
          `构建在 ${MAX_BUILD_ATTEMPTS} 次尝试（含自修复）后失败。最后错误：\n${lastError.slice(-800)}`
        );
      }

      // —— 版本落账（仅构建验证成功）——
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
      // 磁盘治理：保留最新 3 个版本快照（含 node_modules 的旧快照是磁盘增长主因）
      await gcSnapshots(job.projectId, 3).catch(() => 0);

      summary = [
        `工程快照 v${round} 已通过沙箱构建与启动验证：`,
        ...finalFileList.map((f) => `+ ${f}`),
      ].join("\n");
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
