import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import {
  dockerNetworkGateway,
  dockerStatus,
  execSandboxed,
  startRuntime,
  stopRuntime,
} from "@/lib/build/executor";
import { waitForPort } from "@/lib/ports";

const REQUIRED = process.env.RUN_SANDBOX_TESTS === "1";
const RUNTIME_NETWORK = process.env.SANDBOX_RUNTIME_NETWORK ?? "atoms-runtime";

async function main() {
  const status = await dockerStatus(true);
  if (!status.ok) {
    console.log(`[sandbox] skipped: ${status.error ?? "docker unavailable"}`);
    if (REQUIRED) process.exitCode = 1;
    return;
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), "atoms-sandbox-"));
  const marker = path.join(os.tmpdir(), `atoms-host-only-${Date.now()}`);
  await writeFile(marker, "host-only", "utf8");
  await writeFile(
    path.join(dir, "server.js"),
    [
      'const http = require("node:http");',
      'const port = Number(process.env.PORT || 3000);',
      'http.createServer((q, s) => s.end("sandbox-ok")).listen(port, "0.0.0.0");',
    ].join("\n"),
    "utf8"
  );

  let handle = null;
  let hostServer: ReturnType<typeof createServer> | null = null;
  try {
    const logs: string[] = [];
    const exec = (argv: string[], network?: string) =>
      execSandboxed("node", argv, {
        cwd: dir,
        timeoutMs: 60_000,
        isolation: "container",
        ...(network ? { network } : {}),
        onLog: (line) => logs.push(line),
      });

    const info = await exec([
      "-e",
      `console.log(JSON.stringify({uid:process.getuid(),key:process.env.LLM_API_KEY ?? null,hostMarker:require("fs").existsSync(${JSON.stringify(marker)})}))`,
    ]);
    assert.equal(info.code, 0, logs.join("\n"));
    const parsed = JSON.parse(logs.join("\n").split("\n").filter(Boolean).pop() ?? "{}");
    assert.notEqual(parsed.uid, 0, "container must not run as root");
    assert.equal(parsed.key, null, "host LLM key must not leak into sandbox");
    assert.equal(parsed.hostMarker, false, "host filesystem must not be visible");

    const writable = await exec([
      "-e",
      'require("fs").writeFileSync("/app/.sandbox-write","1")',
    ]);
    assert.equal(writable.code, 0, "workspace mount must be writable");

    const readOnly = await exec([
      "-e",
      'try{require("fs").writeFileSync("/root/should-fail","1");process.exit(0)}catch{process.exit(1)}',
    ]);
    assert.equal(readOnly.code, 1, "rootfs must be read-only");

    const injection = path.join(os.tmpdir(), `atoms-injected-${Date.now()}`);
    const injected = await exec(["--check", `x.js; touch ${injection}`]);
    assert.notEqual(injected.code, 0);
    assert.equal(existsSync(injection), false, "shell metacharacters must not execute");

    handle = await startRuntime("node", ["server.js"], {
      cwd: dir,
      port: 3000,
      isolation: "container",
      name: `atoms-contract-${Date.now()}`,
      onLog: (line) => logs.push(line),
    });
    assert.equal(await waitForPort(handle.host, handle.port, 20_000), true);
    const res = await fetch(`http://${handle.host}:${handle.port}/`);
    assert.equal(await res.text(), "sandbox-ok");

    // 同网络容器互访必须被阻断
    const peerLogs: string[] = [];
    const peer = await execSandboxed(
      "node",
      [
        "-e",
        `fetch(${JSON.stringify(`http://${handle.host}:${handle.port}/`)},{signal:AbortSignal.timeout(3000)}).then(()=>process.exit(0)).catch(()=>process.exit(1))`,
      ],
      {
        cwd: dir,
        timeoutMs: 15_000,
        isolation: "container",
        network: RUNTIME_NETWORK,
        onLog: (line) => peerLogs.push(line),
      }
    );
    assert.equal(peer.code, 1, "peer containers must not reach each other");

    // 容器 -> 宿主必须被阻断（宿主 -> 容器仍然可用）
    hostServer = createServer((_req, res) => res.end("host-only"));
    await new Promise<void>((resolve) =>
      hostServer!.listen(0, "0.0.0.0", resolve)
    );
    const hostPort = (hostServer.address() as { port: number }).port;
    const gateway = await dockerNetworkGateway(RUNTIME_NETWORK);
    assert.ok(gateway, "runtime network gateway must be visible");
    const hostLogs: string[] = [];
    const toHost = await execSandboxed(
      "node",
      [
        "-e",
        `fetch(${JSON.stringify(`http://${gateway}:${hostPort}/`)},{signal:AbortSignal.timeout(3000)}).then(()=>process.exit(0)).catch(()=>process.exit(1))`,
      ],
      {
        cwd: dir,
        timeoutMs: 15_000,
        isolation: "container",
        network: RUNTIME_NETWORK,
        onLog: (line) => hostLogs.push(line),
      }
    );
    assert.equal(toHost.code, 1, "containers must not reach host services");

    const egressLogs: string[] = [];
    const egress = await execSandboxed(
      "node",
      [
        "-e",
        'fetch("https://example.com",{signal:AbortSignal.timeout(3000)}).then(()=>process.exit(0)).catch(()=>process.exit(1))',
      ],
      {
        cwd: dir,
        timeoutMs: 15_000,
        isolation: "container",
        network: RUNTIME_NETWORK,
        onLog: (line) => egressLogs.push(line),
      }
    );
    assert.equal(egress.code, 1, "runtime network must not allow egress");

    console.log("[sandbox] all contract checks passed");
  } finally {
    if (handle) await stopRuntime(handle).catch(() => undefined);
    if (hostServer) {
      await new Promise<void>((resolve) => hostServer!.close(() => resolve()));
    }
    await rm(marker, { force: true });
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[sandbox] failed", err);
  process.exit(1);
});