import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isolationLevel } from "@/lib/build/executor";
import { ensureBoot } from "@/lib/boot";
import { readWorkerHeartbeat, workerAlive } from "@/lib/worker-heartbeat";

export const dynamic = "force-dynamic";

/** 存活探针：供部署平台/运维监控 */
export async function GET() {
  void ensureBoot();
  const started = Date.now();
  let db = false;
  let queue = { queued: 0, running: 0 };
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
    const [queued, running] = await Promise.all([
      prisma.buildJob.count({ where: { status: "queued" } }),
      prisma.buildJob.count({ where: { status: { in: ["leased", "running"] } } }),
    ]);
    queue = { queued, running };
  } catch {
    db = false;
  }
  const iso = await isolationLevel();
  const heartbeat = await readWorkerHeartbeat();
  const worker = workerAlive(heartbeat);
  const code = db ? 200 : 503;
  return NextResponse.json(
    {
      ok: db,
      db,
      uptimeSec: Math.round(process.uptime()),
      isolation: iso.level,
      degraded: iso.degraded,
      worker: {
        alive: worker,
        pid: heartbeat?.pid ?? null,
        lastSeenSec: heartbeat
          ? Math.max(0, Math.round((Date.now() - Date.parse(heartbeat.at)) / 1000))
          : null,
      },
      queue,
      latencyMs: Date.now() - started,
    },
    { status: code }
  );
}