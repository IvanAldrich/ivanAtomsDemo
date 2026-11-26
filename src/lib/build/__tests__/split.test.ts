import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applySplitPlan,
  autoSplitOversized,
  extractTopLevelSymbols,
  parseSplitPlan,
  planDeterministicSplit,
  splitFile,
} from "../split";
import { normalizeManifest } from "../manifest";

const source = `function render(ctx) { return ctx; }
function drawHud(state) { return state; }
function update(dt) { return dt; }
class Player { move() { return 1; } }
const save = () => 1;
`;

async function setup(content = source): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "atoms-split-"));
  const file = "public/app.js";
  await mkdir(path.join(dir, "public"), { recursive: true });
  await writeFile(path.join(dir, file), content);
  return { dir, file };
}

test("extractTopLevelSymbols finds functions, classes and variables", async () => {
  const symbols = await extractTopLevelSymbols("app.js", source);
  const names = symbols.flatMap((s) => s.names);
  for (const n of ["render", "drawHud", "update", "Player", "save"]) {
    assert.ok(names.includes(n), `missing ${n}`);
  }
});

test("planDeterministicSplit creates responsibility groups", async () => {
  const symbols = await extractTopLevelSymbols("app.js", source);
  const plan = planDeterministicSplit("public/app.js", symbols, [
    "public/app.js",
    "public/hud.js",
  ]);
  assert.ok(plan.newFiles.length >= 3);
  const all = plan.newFiles.map((f) => f.path);
  assert.equal(new Set(all).size, all.length);
  assert.ok(all.every((p) => p.includes("app-parts/")));
  assert.ok(all.some((p) => p.endsWith("render.js")));
  assert.ok(all.some((p) => p.endsWith("entities.js")));
});

test("applySplitPlan moves symbols and preserves re-exports", async () => {
  const { dir, file } = await setup();
  try {
    const symbols = await extractTopLevelSymbols(file, source);
    const plan = planDeterministicSplit(file, symbols, [file]);
    const manifest = normalizeManifest({
      profile: "custom",
      entry: file,
      modules: [{ path: file, role: "game", exports: [], deps: [], maxKB: 16 }],
    });
    const result = await applySplitPlan(dir, plan, manifest, symbols);
    assert.ok(result.newFiles.length >= 3);
    const original = await readFile(path.join(dir, file), "utf8");
    assert.ok(original.includes("export * from"));
    for (const f of result.newFiles) {
      const content = await readFile(path.join(dir, f), "utf8");
      assert.ok(/export\s+(function|class|const)/.test(content), `${f} lacks export`);
    }
    assert.ok(result.manifest.modules.length > 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("autoSplitOversized splits a file over the hard limit", async () => {
  const body = Array.from(
    { length: 900 },
    (_, i) => `function fn${i}(x) { return x + ${i}; }`
  ).join("\n");
  const { dir, file } = await setup(body);
  try {
    const manifest = normalizeManifest({
      profile: "custom",
      entry: file,
      modules: [{ path: file, role: "logic", exports: [], deps: [], maxKB: 16 }],
    });
    const result = await autoSplitOversized(dir, manifest);
    assert.ok(result.splits >= 1);
    assert.ok(result.manifest.modules.length > 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("splitFile refuses to split files under the soft budget", async () => {
  const { dir, file } = await setup();
  try {
    const manifest = normalizeManifest({
      profile: "custom",
      entry: file,
      modules: [{ path: file, role: "game", exports: [], deps: [], maxKB: 16 }],
    });
    const result = await splitFile(dir, file, manifest, [file]);
    assert.equal(result, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("splitFile refuses files between soft and hard budgets", async () => {
  const body = Array.from(
    { length: 300 },
    (_, i) => `function fn${i}(x) { return x + ${i}; }`
  ).join("\n");
  const { dir, file } = await setup(body);
  try {
    const manifest = normalizeManifest({
      profile: "custom",
      entry: file,
      modules: [{ path: file, role: "logic", exports: [], deps: [], maxKB: 16 }],
    });
    const bytes = Buffer.byteLength(body, "utf8");
    assert.ok(bytes > 10 * 1024 && bytes < 16 * 1024);
    const result = await splitFile(dir, file, manifest, [file]);
    assert.equal(result, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parseSplitPlan validates minimum structure", () => {
  const raw = JSON.stringify({
    source: "public/app.js",
    newFiles: [
      { path: "public/render.js", role: "render", exports: ["render"], symbols: ["render"] },
      { path: "public/logic.js", role: "logic", exports: ["update"], symbols: ["update"] },
    ],
  });
  const plan = parseSplitPlan(`说明\n${raw}\n结束`);
  assert.equal(plan.newFiles.length, 2);
  assert.throws(() => parseSplitPlan("not json"), /JSON/);
  assert.throws(
    () => parseSplitPlan(JSON.stringify({ source: "a.js", newFiles: [] })),
    /至少两个/
  );
});

test("parseSplitPlan rejects path traversal and absolute paths", () => {
  const base = {
    source: "public/app.js",
    newFiles: [
      { path: "public/render.js", role: "render", exports: ["render"], symbols: ["render"] },
      { path: "public/logic.js", role: "logic", exports: ["update"], symbols: ["update"] },
    ],
  };
  assert.throws(
    () => parseSplitPlan(JSON.stringify({ ...base, source: "../app.js" })),
    /路径非法/
  );
  assert.throws(
    () =>
      parseSplitPlan(
        JSON.stringify({
          ...base,
          newFiles: [
            base.newFiles[0],
            { ...base.newFiles[1], path: "../../host.js" },
          ],
        })
      ),
    /路径非法/
  );
  assert.throws(
    () =>
      parseSplitPlan(
        JSON.stringify({
          ...base,
          newFiles: [base.newFiles[0], { ...base.newFiles[1], path: "/etc/passwd" }],
        })
      ),
    /路径非法/
  );
});