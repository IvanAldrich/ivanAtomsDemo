import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildExcerpt,
  buildIterationContext,
  pickTargets,
  resolveNeeds,
} from "../context";
import { normalizeManifest, writeManifest, type ModuleManifest } from "../manifest";

const manifest: ModuleManifest = normalizeManifest({
  profile: "browser-game",
  entry: "public/index.html",
  modules: [
    { path: "public/index.html", role: "entry", exports: [], deps: [], maxKB: 4 },
    { path: "public/styles/base.css", role: "styles", exports: [], deps: [], maxKB: 8 },
    {
      path: "public/src/main.js",
      role: "bootstrap",
      exports: ["bootstrap()"],
      deps: ["./core/engine.js"],
      maxKB: 4,
    },
    {
      path: "public/src/core/engine.js",
      role: "game-loop",
      exports: ["createEngine(state)", "start()", "stop()"],
      deps: [],
      maxKB: 12,
    },
    {
      path: "public/src/ui/hud.js",
      role: "ui",
      exports: ["renderHud(state)"],
      deps: ["../core/engine.js"],
      maxKB: 6,
    },
    {
      path: "public/src/services/storage.js",
      role: "storage",
      exports: ["loadSave()", "saveGame(state)"],
      deps: [],
      maxKB: 4,
    },
    {
      path: "public/src/core/input.js",
      role: "input",
      exports: ["bindInput()"],
      deps: [],
      maxKB: 5,
    },
    { path: "server.js", role: "server", exports: [], deps: [], maxKB: 6 },
  ],
});

async function setup(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "atoms-context-"));
  await mkdir(path.join(dir, "public/src/core"), { recursive: true });
  await mkdir(path.join(dir, "public/src/ui"), { recursive: true });
  await mkdir(path.join(dir, "public/src/services"), { recursive: true });
  await mkdir(path.join(dir, "public/styles"), { recursive: true });
  await writeFile(path.join(dir, "public/index.html"), "<html></html>");
  await writeFile(path.join(dir, "public/styles/base.css"), "body { margin: 0; }\n");
  await writeFile(
    path.join(dir, "public/src/core/engine.js"),
    "export function createEngine(state) { return state; }\n// secretEngineBody\n"
  );
  await writeFile(
    path.join(dir, "public/src/ui/hud.js"),
    "export function renderHud(state) { return state.score; }\n"
  );
  await writeFile(
    path.join(dir, "public/src/services/storage.js"),
    "export function loadSave() { return {}; }\nexport function saveGame(state) { return state; }\n"
  );
  await writeFile(path.join(dir, "public/src/main.js"), "export function bootstrap() {}\n");
  await writeManifest(dir, manifest);
  return dir;
}

test("buildExcerpt keeps synthetic index out of the code text", () => {
  const content = [
    "const A = 1;",
    "function render(ctx) { return ctx; }",
    "function update(dt) { return dt; }",
    "class Player {}",
    "const save = () => 1;",
  ].join("\n");
  const ex = buildExcerpt(content, "[stdin]:2\nSyntaxError: bad token");
  assert.ok(!ex.text.includes("符号索引"));
  assert.ok(!ex.text.includes("// ..."));
  assert.ok(ex.index.includes("render"));
  assert.ok(ex.index.includes("L2"));
});

test("pickTargets selects HUD for a HUD requirement", () => {
  const targets = pickTargets(manifest, "把 HUD 的分数显示改大", [], 3).map((m) => m.path);
  assert.ok(targets.includes("public/src/ui/hud.js"));
});

test("bug-report wording targets entry, bootstrap and styles instead of server", () => {
  const targets = pickTargets(
    manifest,
    "不对，点击“开始游戏”没响应，页面布局也不合理",
    [],
    3
  ).map((m) => m.path);
  assert.ok(targets.includes("public/index.html"));
  assert.ok(targets.includes("public/src/main.js"));
  assert.ok(targets.some((p) => p.includes("/styles/")));
  assert.ok(!targets.includes("server.js"));
});

test("layout-only feedback includes a stylesheet", () => {
  const targets = pickTargets(manifest, "页面布局不合理，文字都挤在一起", [], 3).map(
    (m) => m.path
  );
  assert.ok(targets.some((p) => p.includes("/styles/")));
});

test("buildIterationContext uses target files and dependency signatures", async () => {
  const dir = await setup();
  try {
    const history = ["需求1", "需求2", "需求3", "需求4", "需求5"];
    const bundle = await buildIterationContext(dir, "把 HUD 的分数显示改大", history, {
      manifest,
    });
    assert.ok(bundle.files.some((f) => f.path === "public/src/ui/hud.js"));
    assert.ok(bundle.stubs.some((s) => s.path === "public/src/core/engine.js"));
    assert.ok(bundle.stubs[0].exports.includes("createEngine(state)"));
    const allFileText = bundle.files.map((f) => f.content).join("\n");
    assert.ok(!allFileText.includes("secretEngineBody"));
    assert.equal(bundle.requirements.length, 3);
    assert.ok(bundle.totalBytes <= bundle.budgetKB * 1024);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildIterationContext truncates oversized target files within budget", async () => {
  const dir = await setup();
  try {
    const big = Array.from({ length: 1200 }, (_, i) => `const v${i} = ${i};`).join("\n");
    await writeFile(
      path.join(dir, "public/src/core/engine.js"),
      `export function update() {}\n${big}\nexport function render() {}\n`
    );
    const bundle = await buildIterationContext(dir, "修改 engine 主循环", [], { manifest });
    const engine = bundle.files.find((f) => f.path === "public/src/core/engine.js");
    assert.ok(engine?.truncated);
    assert.ok(bundle.totalBytes <= bundle.budgetKB * 1024);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveNeeds adds requested files and rejects traversal", async () => {
  const dir = await setup();
  try {
    const bundle = await buildIterationContext(dir, "修改 HUD", [], { manifest });
    const resolved = await resolveNeeds(dir, bundle, [
      "public/src/services/storage.js",
      "../secret.txt",
    ]);
    assert.deepEqual(resolved.added, ["public/src/services/storage.js"]);
    assert.ok(resolved.bundle.files.some((f) => f.path === "public/src/services/storage.js"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});