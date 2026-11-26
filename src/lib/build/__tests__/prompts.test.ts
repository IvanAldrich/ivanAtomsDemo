import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPlanPrompt,
  buildRepairPrompt,
  buildSingleFilePrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from "../prompts";
import { normalizeManifest } from "../manifest";
import { profileForName } from "../profiles";

const manifest = normalizeManifest({
  profile: "browser-game",
  entry: "public/index.html",
  modules: [
    { path: "public/index.html", role: "entry", exports: [], deps: [], maxKB: 4 },
    {
      path: "public/src/ui/hud.js",
      role: "ui",
      exports: ["renderHud(state)"],
      deps: ["../core/engine.js"],
      maxKB: 6,
    },
    {
      path: "public/src/core/engine.js",
      role: "game-loop",
      exports: ["createEngine(state)", "start()"],
      deps: [],
      maxKB: 10,
    },
  ],
});

test("buildSingleFilePrompt includes dependency signatures only", () => {
  const target = manifest.modules[1];
  const prompt = buildSingleFilePrompt("修改 HUD", manifest, target, [
    { path: "public/src/core/engine.js", role: "game-loop", exports: ["createEngine(state)"] },
  ]);
  assert.match(prompt, /### FILE: public\/src\/ui\/hud\.js/);
  assert.match(prompt, /createEngine\(state\)/);
  assert.doesNotMatch(prompt, /SECRET_ENGINE_BODY/);
  assert.match(prompt, /≤ 6KB/);
});

test("buildUserPrompt uses manifest, stubs, targets and last three requirements", () => {
  const prompt = buildUserPrompt("把 HUD 分数改大", {
    requirementHistory: ["需求1", "需求2", "需求3", "需求4", "需求5"],
    fileTree: [],
    keyFileContents: [{ path: "public/src/ui/hud.js", content: "export function renderHud(){}" }],
    manifestSummary: "profile: browser-game；entry: public/index.html",
    stubs: [
      { path: "public/src/core/engine.js", role: "game-loop", exports: ["createEngine(state)"] },
    ],
    targetPaths: ["public/src/ui/hud.js"],
  });
  assert.match(prompt, /profile: browser-game/);
  assert.match(prompt, /依赖签名/);
  assert.match(prompt, /目标文件（只修改这些文件）/);
  assert.doesNotMatch(prompt, /需求1/);
  assert.match(prompt, /需求5/);
  assert.match(prompt, /### NEED: 路径/);
});

test("buildUserPrompt keeps the symbol index outside the code block", () => {
  const prompt = buildUserPrompt("修复 engine 语法错误", {
    requirementHistory: [],
    fileTree: [],
    keyFileContents: [
      {
        path: "public/src/core/engine.js",
        content: "else if (typeof o.input === 'function') raw = o.input();",
        truncated: true,
        index: "片段行范围：L100-L110\nL104: intentOf",
      },
    ],
    targetPaths: ["public/src/core/engine.js"],
  });
  assert.match(prompt, /禁止用于 SEARCH/);
  assert.match(prompt, /L104: intentOf/);
  assert.match(prompt, /SEARCH 必须逐字符匹配代码块中的真实行/);
});

test("buildPlanPrompt asks for manifest JSON and profile skeleton", () => {
  const prompt = buildPlanPrompt("做一个浏览器小游戏", profileForName("browser-game"));
  assert.match(prompt, /"schemaVersion": 1/);
  assert.match(prompt, /browser-game/);
  assert.match(prompt, /public\/src\/engine\.js/);
  assert.match(prompt, /只输出一个 JSON 对象/);
});

test("system prompt contains size budgets and NEED protocol", () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /hard 16KB/);
  assert.match(prompt, /### NEED/);
  assert.match(prompt, /禁止把整个游戏/);
  assert.match(prompt, /禁止输出 DELETE/);
});

test("repair prompt renders structured violations as actionable text", () => {
  const prompt = buildRepairPrompt({
    requirement: "做一个游戏",
    error: "build failed",
    tree: ["public/app.js"],
    keyFileContents: [],
    previousRawTail: "",
    violations: ["[FILE_TOO_LARGE] public/app.js: 24KB > 16KB；建议按职责拆分"],
    targetPaths: ["public/app.js"],
  });
  assert.match(prompt, /结构门禁错误/);
  assert.match(prompt, /FILE_TOO_LARGE/);
  assert.match(prompt, /必须拆分/);
});