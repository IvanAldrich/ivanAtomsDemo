import test from "node:test";
import assert from "node:assert/strict";
import { modularGenerationEnabled, structureModeFor } from "../flags";

test("modularGenerationEnabled can be rolled back with env", () => {
  assert.equal(modularGenerationEnabled({} as NodeJS.ProcessEnv), true);
  assert.equal(
    modularGenerationEnabled({ MODULAR_GENERATION: "off" } as unknown as NodeJS.ProcessEnv),
    false
  );
});

test("structureModeFor applies strict only to new or manifest projects", () => {
  assert.equal(
    structureModeFor({ modular: true, hasBase: false, hadManifest: false }),
    "strict"
  );
  assert.equal(
    structureModeFor({ modular: true, hasBase: true, hadManifest: true }),
    "strict"
  );
  assert.equal(
    structureModeFor({ modular: true, hasBase: true, hadManifest: false }),
    "advisory"
  );
  assert.equal(
    structureModeFor({
      modular: true,
      hasBase: true,
      hadManifest: false,
      strictEnv: "1",
    }),
    "strict"
  );
  assert.equal(
    structureModeFor({ modular: false, hasBase: false, hadManifest: false }),
    "advisory"
  );
});