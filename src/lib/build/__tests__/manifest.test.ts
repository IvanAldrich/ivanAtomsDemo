import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  deriveHeuristicManifest,
  isOverHardLimit,
  normalizeManifest,
  parseManifestJson,
  syncManifestFiles,
  topologicalModules,
  validateManifest,
  type ModuleManifest,
} from "../manifest";

function validManifest(): ModuleManifest {
  return normalizeManifest({
    profile: "browser-game",
    entry: "public/index.html",
    modules: [
      { path: "public/index.html", role: "entry", exports: [], deps: [], maxKB: 4 },
      {
        path: "public/src/main.js",
        role: "bootstrap",
        exports: ["bootstrap()"],
        deps: ["./core/engine.js"],
        maxKB: 4,
      },
      { path: "public/src/core/engine.js", role: "game-loop", exports: [], deps: [] },
      { path: "public/src/ui/hud.js", role: "ui", exports: [], deps: [] },
    ],
  });
}

test("validateManifest accepts a valid manifest", () => {
  assert.doesNotThrow(() => validateManifest(validManifest()));
});

test("validateManifest rejects missing entry, duplicate paths and missing deps", () => {
  const missingEntry = validManifest();
  missingEntry.entry = "public/missing.html";
  assert.throws(() => validateManifest(missingEntry), /入口不在模块清单/);

  const duplicate = validManifest();
  duplicate.modules.push({ ...duplicate.modules[0] });
  assert.throws(() => validateManifest(duplicate), /模块重复/);

  const missingDep = validManifest();
  missingDep.modules[1].deps = ["../core/nope.js"];
  assert.throws(() => validateManifest(missingDep), /依赖不存在/);
});

test("parseManifestJson strips prose and validates", () => {
  const raw = `说明文字\n${JSON.stringify(validManifest())}\n结束`;
  const m = parseManifestJson(raw);
  assert.equal(m.profile, "browser-game");
  assert.equal(m.modules.length, 4);
  assert.throws(() => parseManifestJson("not json"), /不是 manifest JSON/);
});

test("topologicalModules orders dependencies first and rejects cycles", () => {
  const order = topologicalModules(validManifest()).map((m) => m.path);
  assert.ok(order.indexOf("public/src/core/engine.js") < order.indexOf("public/src/main.js"));

  const cyclic = validManifest();
  cyclic.modules[2].deps = ["../../src/ui/hud.js"];
  cyclic.modules[3].deps = ["../core/engine.js"];
  assert.throws(() => topologicalModules(cyclic), /循环依赖/);
});

test("deriveHeuristicManifest scans files and infers roles", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "atoms-manifest-"));
  try {
    await mkdir(path.join(dir, "public/src/ui"), { recursive: true });
    await writeFile(path.join(dir, "public/index.html"), "<html></html>");
    await writeFile(path.join(dir, "public/src/ui/hud.js"), "export const a = 1;\n");
    await writeFile(path.join(dir, "server.js"), "// server\n");
    const m = await deriveHeuristicManifest(dir);
    assert.equal(m.entry, "public/index.html");
    assert.ok(m.modules.some((x) => x.path === "public/src/ui/hud.js" && x.role === "ui"));
    assert.ok(m.modules.some((x) => x.path === "server.js" && x.role === "server"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("isOverHardLimit uses code and html budgets", () => {
  const m = validManifest();
  assert.equal(isOverHardLimit(m, "public/src/main.js", 12 * 1024), false);
  assert.equal(isOverHardLimit(m, "public/src/main.js", 17 * 1024), true);
  assert.equal(isOverHardLimit(m, "public/index.html", 5 * 1024), true);
});

test("validateManifest rejects budgets outside the allowed range", () => {
  const m = validManifest();
  m.budgets.fileHardKB = 64;
  assert.throws(() => validateManifest(m), /预算超出允许范围/);

  const inverted = validManifest();
  inverted.budgets.fileSoftKB = 16;
  inverted.budgets.fileHardKB = 10;
  assert.throws(() => validateManifest(inverted), /不能大于/);
});

test("syncManifestFiles adds new files and removes missing ones", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "atoms-sync-"));
  try {
    await mkdir(path.join(dir, "public/src/ui"), { recursive: true });
    await writeFile(path.join(dir, "public/index.html"), "<html></html>");
    await writeFile(path.join(dir, "public/src/ui/hud.js"), "export const a = 1;\n");
    const declared = normalizeManifest({
      profile: "browser-game",
      entry: "public/index.html",
      modules: [
        { path: "public/index.html", role: "entry-html", exports: [], deps: [] },
        { path: "public/src/gone.js", role: "gone", exports: [], deps: [] },
        { path: "public/src/ui/hud.js", role: "custom-hud", exports: ["a"], deps: [] },
      ],
    });
    const synced = await syncManifestFiles(dir, declared);
    const paths = synced.modules.map((m) => m.path);
    assert.ok(paths.includes("public/src/ui/hud.js"));
    assert.ok(!paths.includes("public/src/gone.js"));
    assert.equal(
      synced.modules.find((m) => m.path === "public/src/ui/hud.js")?.role,
      "custom-hud"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("budgets honor environment overrides when manifest omits them", () => {
  const prev = process.env.MODULAR_FILE_HARD_KB;
  process.env.MODULAR_FILE_HARD_KB = "20";
  try {
    const m = normalizeManifest({
      profile: "custom",
      entry: "server.js",
      modules: [{ path: "server.js", role: "server", exports: [], deps: [] }],
    });
    assert.equal(m.budgets.fileHardKB, 20);
  } finally {
    if (prev === undefined) delete process.env.MODULAR_FILE_HARD_KB;
    else process.env.MODULAR_FILE_HARD_KB = prev;
  }
});