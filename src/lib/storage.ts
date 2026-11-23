import { mkdir, rm } from "node:fs/promises";
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

/** 删除项目时级联清理磁盘（终止运行时由运行时管理器在调用前完成） */
export async function removeProjectStorage(projectId: string) {
  await rm(projectRoot(projectId), { recursive: true, force: true });
}
