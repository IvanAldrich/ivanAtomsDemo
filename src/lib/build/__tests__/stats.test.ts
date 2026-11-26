import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import {
  aggregateStats,
  appendStat,
  containsSensitiveField,
  percentile,
  readStats,
  type BuildStat,
  type LlmStat,
} from "../stats";

function llm(i: number): LlmStat {
  return {
    type: "llm",
    at: new Date().toISOString(),
    projectId: "p",
    stage: "file",
    model: "m",
    inputTokens: 1000 + i * 100,
    outputTokens: 500 + i * 50,
    reasoningTokens: 200 + i * 10,
    finishReason: "stop",
    ms: 1000 + i * 100,
  };
}

function build(ok: boolean, category: string | null, ms: number): BuildStat {
  return {
    type: "build",
    at: new Date().toISOString(),
    projectId: "p",
    round: 1,
    ok,
    durationMs: ms,
    contextFiles: ["a.js"],
    contextBytes: 2048,
    inputTokens: 1200,
    outputTokens: 600,
    reasoningTokens: 210,
    edits: 1,
    continuations: 0,
    splits: 0,
    repairRounds: ok ? 0 : 1,
    failureCategory: category,
    fileSizes: [{ path: "a.js", bytes: 12 * 1024, overSoft: false, overHard: false }],
  };
}

test("percentile returns expected p50 and p95", () => {
  assert.equal(percentile([], 50), 0);
  assert.equal(percentile([1, 2, 3, 4], 50), 2);
  assert.equal(percentile([1, 2, 3, 4], 95), 4);
  assert.equal(percentile([4, 1, 3, 2], 50), 2);
});

test("aggregateStats computes tokens, p50/p95 and failures", () => {
  const records = [
    llm(0),
    llm(1),
    llm(2),
    build(true, null, 1000),
    build(false, "structure", 3000),
    build(false, "structure", 5000),
  ];
  const agg = aggregateStats(records);
  assert.equal(agg.rounds, 3);
  assert.equal(agg.llmCalls, 3);
  assert.equal(agg.inputTokens, 3300);
  assert.equal(agg.durationMs.p50, 3000);
  assert.equal(agg.durationMs.p95, 5000);
  assert.equal(agg.failures.structure, 2);
});

test("containsSensitiveField flags content and secrets", () => {
  assert.equal(containsSensitiveField({ file: "a.js" }), false);
  assert.equal(containsSensitiveField({ content: "x" }), true);
  assert.equal(containsSensitiveField({ prompt: "x" }), true);
  assert.equal(containsSensitiveField({ apiKey: "x" }), true);
});

test("appendStat and readStats persist metadata without file contents", async () => {
  const projectId = `test-stats-${Date.now()}`;
  try {
    await appendStat(projectId, {
      ...llm(0),
      projectId,
    });
    await appendStat(projectId, {
      ...build(true, null, 1000),
      projectId,
    });
    const records = await readStats(projectId);
    assert.equal(records.length, 2);
    for (const r of records) {
      const keys = Object.keys(r).map((k) => k.toLowerCase());
      assert.ok(!keys.some((k) => k.includes("content") || k.includes("prompt")));
    }
  } finally {
    await rm(path.join(process.cwd(), "storage", "projects", projectId), {
      recursive: true,
      force: true,
    });
  }
});