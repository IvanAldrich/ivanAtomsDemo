import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { cleanupUncommittedSnapshots } from "../snapshot";

async function exists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false
  );
}

test("cleanupUncommittedSnapshots removes failed candidates only", async () => {
  const projectId = `test-snap-${Date.now()}`;
  const root = path.join(process.cwd(), "storage", "projects", projectId);
  try {
    await mkdir(path.join(root, "snapshots", "v1"), { recursive: true });
    await mkdir(path.join(root, "snapshots", "v2"), { recursive: true });
    await writeFile(path.join(root, "snapshots", "v1", "keep.txt"), "keep");
    await writeFile(path.join(root, "snapshots", "v2", "junk.txt"), "junk");
    const removed = await cleanupUncommittedSnapshots(projectId, new Set([1]));
    assert.equal(removed, 1);
    assert.equal(await exists(path.join(root, "snapshots", "v1", "keep.txt")), true);
    assert.equal(await exists(path.join(root, "snapshots", "v2")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});