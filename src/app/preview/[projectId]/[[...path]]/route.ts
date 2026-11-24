import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { proxyToRuntime } from "@/lib/proxy";
import { runtimeManager } from "@/lib/runtime/manager";

/** 属主专享预览代理（App Viewer 使用，无需发布） */
async function handle(
  req: Request,
  { params }: { params: Promise<{ projectId: string; path?: string[] }> }
) {
  const { projectId, path } = await params;

  const session = await getSession();
  if (!session) return new Response("unauthorized", { status: 401 });

  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project || project.ownerId !== session.uid) {
    return new Response("not found", { status: 404 });
  }

  // 预览前按需拉起当前版本运行时（冷启动可能耗时数秒）
  if (!runtimeManager.isRunning(projectId) && project.currentVersionId) {
    const ok = await runtimeManager
      .start(projectId, project.currentVersionId)
      .catch(() => null);
    if (!ok) return new Response("preview runtime failed to start", { status: 503 });
  }

  const subPath = "/" + (path ?? []).map(encodeURIComponent).join("/");
  return proxyToRuntime(req, projectId, subPath, `/preview/${projectId}`);
}

export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
  handle as HEAD,
  handle as OPTIONS,
};
