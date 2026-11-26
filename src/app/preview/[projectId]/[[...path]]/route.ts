import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { proxyToRuntime } from "@/lib/proxy";
import { runtimeManager } from "@/lib/runtime/manager";
import { previewToken, verifyPreviewToken } from "@/lib/preview-token";

/**
 * 属主专享预览代理（App Viewer 使用，无需发布）。
 * 鉴权：会话 Cookie（直接访问）或短期 URL 令牌（沙箱 iframe 子资源不携带 Cookie）。
 */
async function handle(
  req: Request,
  { params }: { params: Promise<{ projectId: string; path?: string[] }> }
) {
  const { projectId, path: rawPath } = await params;
  const path = rawPath ?? [];
  const tokenInPath =
    path[0] && verifyPreviewToken(projectId, path[0]) ? path[0] : null;
  const hasValidToken = tokenInPath !== null;

  const session = await getSession();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  const ownsBySession = Boolean(
    session && project && project.ownerId === session.uid
  );
  if (!ownsBySession && !hasValidToken) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!project) return new Response("not found", { status: 404 });

  // 预览必须跟随当前版本：未运行则启动；运行的是旧版本则原子替换（修复预览长期服务旧构建的问题）
  if (project.currentVersionId) {
    const runningVersion = runtimeManager.versionFor(projectId);
    if (
      !runtimeManager.isRunning(projectId) ||
      runningVersion !== project.currentVersionId
    ) {
      const ok = await runtimeManager
        .start(projectId, project.currentVersionId)
        .catch(() => null);
      if (!ok) {
        return new Response("preview runtime failed to start", { status: 503 });
      }
    }
  }

  const token = tokenInPath ?? previewToken(projectId);
  const subPath =
    "/" +
    (tokenInPath ? path.slice(1) : path).map(encodeURIComponent).join("/");
  // 始终使用令牌前缀，保证 HTML 内部子资源（无 Cookie）也能通过鉴权
  const prefix = `/preview/${projectId}/${token}`;
  return proxyToRuntime(req, projectId, subPath, prefix);
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