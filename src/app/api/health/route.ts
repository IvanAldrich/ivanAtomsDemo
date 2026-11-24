import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isolationLevel } from "@/lib/build/executor";
import { ensureBoot } from "@/lib/boot";

export const dynamic = "force-dynamic";

/** 存活探针：供部署平台/运维监控 */
export async function GET() {
  void ensureBoot();
  const started = Date.now();
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }
  const iso = await isolationLevel();
  const code = db ? 200 : 503;
  return NextResponse.json(
    {
      ok: db,
      db,
      uptimeSec: Math.round(process.uptime()),
      isolation: iso.level,
      degraded: iso.degraded,
      latencyMs: Date.now() - started,
    },
    { status: code }
  );
}