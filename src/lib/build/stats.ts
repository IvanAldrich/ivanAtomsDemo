import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export type LlmStat = {
  type: "llm";
  at: string;
  projectId: string;
  stage: string;
  model: string;
  file?: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  finishReason: string | null;
  ms: number;
};

export type FileSizeStat = {
  path: string;
  bytes: number;
  overSoft: boolean;
  overHard: boolean;
};

export type BuildStat = {
  type: "build";
  at: string;
  projectId: string;
  round: number;
  ok: boolean;
  durationMs: number;
  contextFiles: string[];
  contextBytes: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  edits: number;
  continuations: number;
  splits: number;
  repairRounds: number;
  failureCategory: string | null;
  fileSizes: FileSizeStat[];
};

export type StatRecord = LlmStat | BuildStat;

export function statsFile(projectId: string): string {
  return path.join(
    process.cwd(),
    "storage",
    "projects",
    projectId,
    "build-stats.jsonl"
  );
}

export async function appendStat(projectId: string, stat: StatRecord): Promise<void> {
  try {
    const file = statsFile(projectId);
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, JSON.stringify(stat) + "\n", "utf8");
  } catch {
    /* 指标失败不影响构建 */
  }
}

export function recordLlmStat(stat: Omit<LlmStat, "type" | "at">): void {
  void appendStat(stat.projectId, {
    type: "llm",
    at: new Date().toISOString(),
    ...stat,
  });
}

export function recordBuildStat(stat: Omit<BuildStat, "type" | "at">): void {
  void appendStat(stat.projectId, {
    type: "build",
    at: new Date().toISOString(),
    ...stat,
  });
}

export async function readStats(projectId: string): Promise<StatRecord[]> {
  try {
    const raw = await readFile(statsFile(projectId), "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as StatRecord);
  } catch {
    return [];
  }
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export type StatsAggregate = {
  rounds: number;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  durationMs: { p50: number; p95: number };
  inputTokensPerCall: { p50: number; p95: number };
  outputTokensPerCall: { p50: number; p95: number };
  reasoningTokensPerCall: { p50: number; p95: number };
  fileSizeKB: { p50: number; p95: number };
  failures: Record<string, number>;
};

export function aggregateStats(records: StatRecord[]): StatsAggregate {
  const builds = records.filter((r): r is BuildStat => r.type === "build");
  const llms = records.filter((r): r is LlmStat => r.type === "llm");
  const fileSizes = builds.flatMap((b) => b.fileSizes.map((f) => f.bytes / 1024));
  const failures: Record<string, number> = {};
  for (const b of builds) {
    if (!b.ok && b.failureCategory) {
      failures[b.failureCategory] = (failures[b.failureCategory] ?? 0) + 1;
    }
  }
  return {
    rounds: builds.length,
    llmCalls: llms.length,
    inputTokens: llms.reduce((n, l) => n + l.inputTokens, 0),
    outputTokens: llms.reduce((n, l) => n + l.outputTokens, 0),
    reasoningTokens: llms.reduce((n, l) => n + l.reasoningTokens, 0),
    durationMs: {
      p50: percentile(builds.map((b) => b.durationMs), 50),
      p95: percentile(builds.map((b) => b.durationMs), 95),
    },
    inputTokensPerCall: {
      p50: percentile(llms.map((l) => l.inputTokens), 50),
      p95: percentile(llms.map((l) => l.inputTokens), 95),
    },
    outputTokensPerCall: {
      p50: percentile(llms.map((l) => l.outputTokens), 50),
      p95: percentile(llms.map((l) => l.outputTokens), 95),
    },
    reasoningTokensPerCall: {
      p50: percentile(llms.map((l) => l.reasoningTokens), 50),
      p95: percentile(llms.map((l) => l.reasoningTokens), 95),
    },
    fileSizeKB: {
      p50: percentile(fileSizes, 50),
      p95: percentile(fileSizes, 95),
    },
    failures,
  };
}

export function containsSensitiveField(record: Record<string, unknown>): boolean {
  const banned = ["content", "prompt", "apikey", "apiKey", "authorization", "secret"];
  const keys = Object.keys(record).map((k) => k.toLowerCase());
  return keys.some((k) => banned.some((b) => k.includes(b.toLowerCase())));
}