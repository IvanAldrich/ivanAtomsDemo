import test from "node:test";
import assert from "node:assert/strict";
import { PROFILES, profileForName, selectProfile } from "../profiles";
import { validateManifest, normalizeManifest, type ModuleManifest } from "../manifest";

function manifestForProfile(name: string): ModuleManifest {
  const profile = PROFILES[name];
  return normalizeManifest({
    profile: profile.name,
    entry: profile.modules[0].path,
    modules: profile.modules,
  });
}

test("all built-in profiles produce valid manifests", () => {
  assert.ok(Object.keys(PROFILES).length >= 6);
  for (const name of Object.keys(PROFILES)) {
    assert.doesNotThrow(() => validateManifest(manifestForProfile(name)), name);
  }
});

test("unmatched websites fall back to generic-webapp", () => {
  assert.equal(selectProfile("做一个在线画板，支持自由绘图").name, "generic-webapp");
  assert.equal(profileForName("unknown-profile").name, "generic-webapp");
});

test("specialised profiles are still selected when the request matches", () => {
  assert.equal(selectProfile("做一个贪吃蛇小游戏").name, "browser-game");
  assert.equal(selectProfile("做一个 SaaS 产品落地页").name, "landing-page");
  assert.equal(
    selectProfile("做一个只提供 REST API 的后端服务").name,
    "api-service"
  );
});