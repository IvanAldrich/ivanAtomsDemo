import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";

export type WorkerHeartbeat = {
  pid: number;
  host: string;
  at: string;
};

function heartbeatFile() {
  return path.join(process.cwd(), "storage", "worker-heartbeat.json");
}

export async function writeWorkerHeartbeat(): Promise<void> {
  const file = heartbeatFile();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const data: WorkerHeartbeat = {
    pid: process.pid,
    host: process.env.HOSTNAME ?? "local",
    at: new Date().toISOString(),
  };
  await writeFile(tmp, JSON.stringify(data), "utf8");
  await rename(tmp, file);
}

export async function readWorkerHeartbeat(): Promise<WorkerHeartbeat | null> {
  try {
    return JSON.parse(await readFile(heartbeatFile(), "utf8")) as WorkerHeartbeat;
  } catch {
    return null;
  }
}

export function workerAlive(
  hb: WorkerHeartbeat | null,
  maxAgeMs = 30_000
): boolean {
  if (!hb) return false;
  const at = Date.parse(hb.at);
  return Number.isFinite(at) && Date.now() - at < maxAgeMs;
}