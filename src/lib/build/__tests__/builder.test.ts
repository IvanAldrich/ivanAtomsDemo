import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runSandboxedBuild } from "../builder";
import { normalizeManifest } from "../manifest";

test("ESM syntax gate catches corruption that CommonJS --check misses", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "atoms-builder-esm-"));
  try {
    await mkdir(path.join(dir, "public"), { recursive: true });
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "x", scripts: { start: "node server.js" } })
    );
    await writeFile(
      path.join(dir, "public/app.js"),
      "import { x } from './x.js';\nexport const a = 'function```javascript\naw = x;\n"
    );
    await writeFile(path.join(dir, "public/x.js"), "export const x = 1;\n");
    const manifest = normalizeManifest({
      profile: "custom",
      entry: "public/app.js",
      modules: [
        { path: "public/app.js", role: "app", exports: [], deps: [] },
        { path: "public/x.js", role: "lib", exports: [], deps: [] },
      ],
    });
    const logs: string[] = [];
    const outcome = await runSandboxedBuild(dir, (l) => logs.push(l), {
      structureMode: "strict",
      manifest,
    });
    assert.equal(outcome.ok, false);
    assert.match(outcome.errorTail, /JS 语法错误/);
    assert.ok(!logs.some((l) => l.includes("[install]")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("structure gate fails before npm install in strict mode", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "atoms-builder-"));
  try {
    await mkdir(path.join(dir, "public"), { recursive: true });
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "x", scripts: { start: "node server.js" } })
    );
    const code = `const app = 1;\n${"// padding\n".repeat(1700)}`;
    await writeFile(path.join(dir, "public/app.js"), code);
    const manifest = normalizeManifest({
      profile: "custom",
      entry: "public/app.js",
      modules: [{ path: "public/app.js", role: "app", exports: [], deps: [], maxKB: 16 }],
    });
    const logs: string[] = [];
    const outcome = await runSandboxedBuild(dir, (l) => logs.push(l), {
      structureMode: "strict",
      manifest,
    });
    assert.equal(outcome.ok, false);
    assert.ok(outcome.violations?.some((v) => v.code === "FILE_TOO_LARGE"));
    assert.ok(!logs.some((l) => l.includes("[install]")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});