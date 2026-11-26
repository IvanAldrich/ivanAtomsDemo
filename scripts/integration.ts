import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { buildQueue } from "@/lib/queue";

const email = `integration-${Date.now()}@example.com`;

async function main() {
  const user = await prisma.user.create({ data: { email } });
  const project = await prisma.project.create({
    data: { ownerId: user.id, title: "integration" },
  });
  const message = await prisma.message.create({
    data: {
      projectId: project.id,
      role: "user",
      content: "integration",
      buildRound: 1,
      buildStatus: "queued",
    },
  });

  try {
    await buildQueue.enqueue({ projectId: project.id, messageId: message.id });
    await buildQueue.enqueue({ projectId: project.id, messageId: message.id });
    assert.equal(
      await prisma.buildJob.count({ where: { messageId: message.id } }),
      1,
      "enqueue must be idempotent"
    );

    const job = await buildQueue.claim();
    assert.ok(job, "job should be claimable");
    assert.equal(job!.messageId, message.id);
    assert.equal(job!.attempts, 1);
    await buildQueue.markRunning(job!.id);

    await Promise.all([
      buildQueue.appendEvent(message.id, { type: "stage", stage: "generating" }),
      buildQueue.appendEvent(message.id, { type: "log", text: "a" }),
      buildQueue.appendEvent(message.id, { type: "log", text: "b" }),
    ]);
    const events = await buildQueue.eventsSince(message.id, 0);
    assert.deepEqual(
      events.map((e) => e.seq),
      [1, 2, 3],
      "event sequence must be monotonic"
    );
    assert.equal((await buildQueue.eventsSince(message.id, 1)).length, 2);

    await buildQueue.complete(job!.id);
    assert.equal(await buildQueue.jobStatus(message.id), "done");

    // done 任务再次入队 → 重置为 queued 且清空旧事件
    await buildQueue.enqueue({ projectId: project.id, messageId: message.id });
    assert.equal(await buildQueue.jobStatus(message.id), "queued");
    assert.equal((await buildQueue.eventsSince(message.id, 0)).length, 0);

    const retry = await buildQueue.claim();
    assert.ok(retry);
    await buildQueue.fail(retry!.id, "transient", true);
    assert.equal(await buildQueue.jobStatus(message.id), "queued");

    const retry2 = await buildQueue.claim();
    assert.ok(retry2);
    await buildQueue.fail(retry2!.id, "transient", true);
    const retry3 = await buildQueue.claim();
    assert.ok(retry3);
    await buildQueue.fail(retry3!.id, "final", false);
    assert.equal(await buildQueue.jobStatus(message.id), "failed");

    console.log("[integration] queue checks passed");
  } finally {
    await prisma.buildEvent.deleteMany({ where: { messageId: message.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[integration] failed", err);
    process.exit(1);
  });