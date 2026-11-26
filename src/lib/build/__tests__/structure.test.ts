import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateStructure } from "../structure";
import { normalizeManifest } from "../manifest";

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "atoms-structure-"));
}

async function write(dir: string, rel: string, content: string) {
  const dest = path.join(dir, rel);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, content);
}

function codes(v: { violations: Array<{ code: string }> }) {
  return v.violations.map((x) => x.code);
}

test("reports FILE_TOO_LARGE for code and html", async () => {
  const dir = await tempDir();
  try {
    await write(dir, "public/app.js", "x".repeat(17 * 1024));
    await write(dir, "public/index.html", `<html>${"x".repeat(5 * 1024)}</html>`);
    const res = await validateStructure(dir);
    assert.ok(codes(res).includes("FILE_TOO_LARGE"));
    assert.ok(res.violations.some((v) => v.path === "public/index.html"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reports inline script and inline asset violations", async () => {
  const dir = await tempDir();
  try {
    await write(
      dir,
      "public/index.html",
      `<html><body><script>${"x".repeat(3 * 1024)}</script></body></html>`
    );
    await write(
      dir,
      "public/app.js",
      `const img = "data:image/png;base64,${"A".repeat(9 * 1024)}";\n`
    );
    const res = await validateStructure(dir);
    assert.ok(codes(res).includes("INLINE_TOO_LARGE"));
    assert.ok(codes(res).includes("INLINE_ASSET"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reports missing imports, cycles and absolute imports", async () => {
  const dir = await tempDir();
  try {
    await write(dir, "a.js", `import { b } from "./b.js";\nexport const a = b;\n`);
    await write(dir, "b.js", `import { a } from "./a.js";\nexport const b = a;\n`);
    await write(dir, "c.js", `import { x } from "./missing.js";\nexport const c = x;\n`);
    await write(dir, "d.js", `import { y } from "/root.js";\nexport const d = y;\n`);
    const res = await validateStructure(dir);
    assert.ok(codes(res).includes("CYCLE"));
    assert.ok(codes(res).includes("MISSING_DEP"));
    assert.ok(codes(res).includes("ABSOLUTE_IMPORT"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reports manifest drift for missing and undeclared files", async () => {
  const dir = await tempDir();
  try {
    await write(dir, "keep.js", "export const keep = 1;\n");
    await write(dir, "extra.js", "export const extra = 1;\n");
    const manifest = normalizeManifest({
      profile: "custom",
      entry: "keep.js",
      modules: [
        { path: "keep.js", role: "main", exports: [], deps: [] },
        { path: "gone.js", role: "gone", exports: [], deps: [] },
      ],
    });
    const res = await validateStructure(dir, { manifest });
    const drift = res.violations.filter((v) => v.code === "MANIFEST_DRIFT");
    assert.ok(drift.some((v) => v.path === "gone.js" && v.severity === "error"));
    assert.ok(drift.some((v) => v.path === "extra.js" && v.severity === "warning"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reports MODULE_MODE when browser imports lack type=module", async () => {
  const dir = await tempDir();
  try {
    await write(dir, "public/index.html", `<script src="./app.js"></script>`);
    await write(dir, "public/app.js", `import { x } from "./x.js";\nconsole.log(x);\n`);
    await write(dir, "public/x.js", "export const x = 1;\n");
    const res = await validateStructure(dir);
    assert.ok(codes(res).includes("MODULE_MODE"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rootless script src resolves for reachability (no false UNREACHABLE)", async () => {
  const dir = await tempDir();
  try {
    await write(dir, "public/index.html", `<script type="module" src="src/main.js"></script>`);
    await write(dir, "public/src/main.js", `import { x } from './x.js';\nconsole.log(x);\n`);
    await write(dir, "public/src/x.js", "export const x = 1;\n");
    const res = await validateStructure(dir);
    assert.ok(!codes(res).includes("UNREACHABLE_MODULE"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reports EXPORT_MISSING when import names don't match target exports", async () => {
  const dir = await tempDir();
  try {
    await write(dir, "public/index.html", `<script type="module" src="src/main.js"></script>`);
    await write(
      dir,
      "public/src/main.js",
      `import { setupRenderer } from './renderer.js';\nimport { bindInput } from './input.js';\nconsole.log(bindInput, setupRenderer);\n`
    );
    await write(dir, "public/src/renderer.js", `export function render(ctx, state) { return state; }\n`);
    await write(dir, "public/src/input.js", `export function bindInput(canvas, engine) { return engine; }\n`);
    const res = await validateStructure(dir);
    const exportMissing = res.violations.filter((v) => v.code === "EXPORT_MISSING");
    assert.ok(exportMissing.length > 0);
    assert.ok(exportMissing.some((v) => v.path === "public/src/main.js"));
    assert.match(exportMissing[0].message, /setupRenderer/);
    assert.match(exportMissing[0].message, /实际导出.*render/);
    // bindInput IS exported, so no violation for it
    assert.ok(!exportMissing.some((v) => v.message.includes("bindInput")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no EXPORT_MISSING when all import names resolve", async () => {
  const dir = await tempDir();
  try {
    await write(
      dir,
      "public/src/main.js",
      `import { render } from './renderer.js';\nimport { bindInput } from './input.js';\nrender(null, {});\n`
    );
    await write(dir, "public/src/renderer.js", `export function render(ctx, state) { return state; }\n`);
    await write(dir, "public/src/input.js", `export function bindInput(canvas, engine) { return engine; }\n`);
    const res = await validateStructure(dir);
    assert.ok(!codes(res).includes("EXPORT_MISSING"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reports ENTRY_BOOTSTRAP_TIMING for DOMContentLoaded-only bootstraps", async () => {
  const dir = await tempDir();
  try {
    await write(
      dir,
      "public/src/main.js",
      `document.addEventListener('DOMContentLoaded', () => { bootstrap(); });\nfunction bootstrap() {}\n`
    );
    const bad = await validateStructure(dir);
    assert.ok(codes(bad).includes("ENTRY_BOOTSTRAP_TIMING"));

    await write(
      dir,
      "public/src/main.js",
      `if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap);\nelse bootstrap();\nfunction bootstrap() {}\n`
    );
    const good = await validateStructure(dir);
    assert.ok(!codes(good).includes("ENTRY_BOOTSTRAP_TIMING"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});