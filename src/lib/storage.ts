import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

const STORAGE_ROOT = path.join(process.cwd(), "storage");

export function projectRoot(projectId: string) {
  return path.join(STORAGE_ROOT, "projects", projectId);
}

export function snapshotDir(projectId: string, version: number) {
  return path.join(projectRoot(projectId), "snapshots", `v${version}`);
}

export function runtimeDataDir(projectId: string, version: number) {
  return path.join(projectRoot(projectId), "runtime", `v${version}`, "data");
}

export async function ensureProjectDirs(projectId: string) {
  await mkdir(projectRoot(projectId), { recursive: true });
}

/** 读取运行时元数据（跨进程：Web 写入，worker/恢复逻辑读取） */
export async function readRunMetadata(
  projectId: string
): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(
      await readFile(path.join(projectRoot(projectId), "run.json"), "utf8")
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 删除项目时级联清理磁盘（终止运行时由运行时管理器在调用前完成） */
export async function removeProjectStorage(projectId: string) {
  await rm(projectRoot(projectId), { recursive: true, force: true });
}
