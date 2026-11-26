import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectDependencies, packageJsonFor, scaffoldFiles, stubContent } from "../scaffold";
import { normalizeManifest, readManifest, writeManifest } from "../manifest";
import { writeSnapshot } from "../snapshot";

const manifest = normalizeManifest({
  profile: "browser-game",
  entry: "public/index.html",
  modules: [
    { path: "public/index.html", role: "entry", exports: [], deps: [], maxKB: 4 },
    { path: "public/src/ui/hud.js", role: "ui", exports: [], deps: [], maxKB: 6 },
    { path: "public/styles/hud.css", role: "hud-styles", exports: [], deps: [], maxKB: 4 },
  ],
});

test("scaffoldFiles produces a stub for every module", () => {
  const files = scaffoldFiles(manifest);
  assert.equal(files.length, 3);
  assert.match(stubContent(manifest.modules[1]), /ui: scaffold/);
  assert.match(stubContent(manifest.modules[2]), /hud-styles: scaffold/);
});

test("manifest and stubs can be written to a snapshot", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "atoms-scaffold-"));
  try {
    await writeManifest(dir, manifest);
    await writeSnapshot(dir, dir, { files: scaffoldFiles(manifest), deletes: [] });
    const read = await readManifest(dir);
    assert.equal(read?.profile, "browser-game");
    const hud = await readFile(path.join(dir, "public/src/ui/hud.js"), "utf8");
    assert.match(hud, /scaffold/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("packageJsonFor creates a runnable start script", () => {
  const pkg = JSON.parse(packageJsonFor("browser-game")) as {
    scripts: Record<string, string>;
  };
  assert.equal(pkg.scripts.start, "node server.js");
});

test("detectDependencies picks external packages but ignores builtins", () => {
  const deps = detectDependencies([
    {
      path: "server.js",
      content:
        'const express = require("express");\nconst fs = require("fs");\nconst x = require("./local.js");\n',
    },
    {
      path: "public/app.js",
      content: 'import { z } from "zod";\nimport y from "node:path";\n',
    },
  ]);
  assert.equal(deps.express, "^4.21.0");
  assert.equal(deps.zod, "*");
  assert.equal(deps.fs, undefined);
  assert.equal(deps["node:path"], undefined);
});