#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const projectId = process.argv[2];
if (!projectId) {
  console.error("用法: node scripts/build-stats.mjs <projectId>");
  process.exit(1);
}

const file = path.join(
  process.cwd(),
  "storage",
  "projects",
  projectId,
  "build-stats.jsonl"
);
if (!fs.existsSync(file)) {
  console.error(`未找到指标文件: ${file}`);
  process.exit(1);
}

const records = fs
  .readFileSync(file, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[idx];
}

const builds = records.filter((r) => r.type === "build");
const llms = records.filter((r) => r.type === "llm");
const failures = {};
for (const b of builds) {
  if (!b.ok && b.failureCategory) {
    failures[b.failureCategory] = (failures[b.failureCategory] ?? 0) + 1;
  }
}

const fileSizes = builds.flatMap((b) => b.fileSizes.map((f) => f.bytes / 1024));
const summary = {
  projectId,
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

console.log(JSON.stringify(summary, null, 2));