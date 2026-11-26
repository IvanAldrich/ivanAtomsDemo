import "dotenv/config";
import { runBuildRound, type BuildEvent } from "@/lib/build/orchestrator";
import { buildQueue } from "@/lib/queue";
import { writeWorkerHeartbeat } from "@/lib/worker-heartbeat";

const POLL_MS = 1000;
const HEARTBEAT_MS = 30_000;
const PRESENCE_MS = 10_000;
const PRUNE_MS = 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let stopping = false;

async function main() {
  console.log(`[worker] started pid=${process.pid}`);
  let lastPrune = 0;
  const presence = setInterval(() => {
    void writeWorkerHeartbeat().catch(() => undefined);
  }, PRESENCE_MS);
  void writeWorkerHeartbeat().catch(() => undefined);

  while (!stopping) {
    if (Date.now() - lastPrune > PRUNE_MS) {
      lastPrune = Date.now();
      await buildQueue.pruneEvents().catch(() => 0);
    }

    const job = await buildQueue.claim().catch((err) => {
      console.error("[worker] claim failed", err);
      return null;
    });
    if (!job) {
      await sleep(POLL_MS);
      continue;
    }

    console.log(
      `[worker] job=${job.id} message=${job.messageId} attempt=${job.attempts}/${job.maxAttempts}`
    );
    const heartbeat = setInterval(() => {
      void buildQueue.heartbeat(job.id).catch(() => undefined);
    }, HEARTBEAT_MS);

    let ok = false;
    try {
      await buildQueue.markRunning(job.id);
      await runBuildRound(
        { projectId: job.projectId, messageId: job.messageId },
        (ev: BuildEvent) => {
          if (ev.type === "done") ok = ev.ok;
          void buildQueue.appendEvent(job.messageId, ev);
        }
      );
      await buildQueue.appendEvent(job.messageId, { type: "round-end" });
      if (ok) {
        await buildQueue.complete(job.id);
        console.log(`[worker] job=${job.id} done`);
      } else {
        await buildQueue.fail(job.id, "build round failed", false);
        console.log(`[worker] job=${job.id} failed`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "worker error";
      console.error(`[worker] job=${job.id} crashed`, err);
      await buildQueue
        .appendEvent(job.messageId, { type: "error", message })
        .catch(() => undefined);
      await buildQueue
        .appendEvent(job.messageId, { type: "round-end" })
        .catch(() => undefined);
      await buildQueue.fail(job.id, message, true).catch(() => undefined);
    } finally {
      clearInterval(heartbeat);
    }
  }
  clearInterval(presence);
  console.log("[worker] stopped");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[worker] ${signal} received, finishing current job...`);
    stopping = true;
  });
}

void main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exitCode = 1;
});