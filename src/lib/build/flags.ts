export type StructureMode = "strict" | "advisory";

export function modularGenerationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MODULAR_GENERATION !== "off";
}

export function structureModeFor(opts: {
  modular: boolean;
  hasBase: boolean;
  hadManifest: boolean;
  strictEnv?: string;
}): StructureMode {
  if (!opts.modular) return "advisory";
  if (!opts.hasBase || opts.hadManifest || opts.strictEnv === "1") return "strict";
  return "advisory";
}