import type { ModuleEntry, ModuleManifest } from "./manifest";

export function stubContent(module: ModuleEntry): string {
  if (module.path.endsWith(".html")) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${module.role}</title></head><body></body></html>`;
  }
  if (module.path.endsWith(".css")) return `/* ${module.role}: scaffold */\n`;
  if (module.path.endsWith(".json")) return "{}\n";
  return `// ${module.role}: scaffold\n`;
}

export function scaffoldFiles(
  manifest: ModuleManifest
): Array<{ path: string; content: string }> {
  return manifest.modules.map((m) => ({ path: m.path, content: stubContent(m) }));
}

const NODE_BUILTINS = new Set([
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "crypto",
  "dns",
  "events",
  "fs",
  "http",
  "https",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "querystring",
  "readline",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
]);

const IMPORT_RE =
  /(?:require\s*\(\s*|from\s+|import\s*\(\s*)["']([^"']+)["']/g;

export function detectDependencies(
  files: Array<{ path: string; content: string }>
): Record<string, string> {
  const deps: Record<string, string> = {};
  for (const file of files) {
    IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(file.content)) !== null) {
      const spec = m[1];
      if (
        spec.startsWith(".") ||
        spec.startsWith("/") ||
        spec.startsWith("node:") ||
        spec.startsWith("data:")
      ) {
        continue;
      }
      const name = spec.startsWith("@")
        ? spec.split("/").slice(0, 2).join("/")
        : spec.split("/")[0];
      if (NODE_BUILTINS.has(name)) continue;
      deps[name] = name === "express" ? "^4.21.0" : "*";
    }
  }
  return deps;
}

export function packageJsonFor(
  profile: string,
  dependencies: Record<string, string> = {}
): string {
  return (
    JSON.stringify(
      {
        name: "generated-app",
        version: "1.0.0",
        private: true,
        description: `Generated ${profile} application`,
        scripts: {
          start: "node server.js",
          build: "node -e \"process.exit(0)\"",
        },
        dependencies,
      },
      null,
      2
    ) + "\n"
  );
}