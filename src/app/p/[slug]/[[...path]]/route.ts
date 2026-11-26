import { prisma } from "@/lib/prisma";
import { proxyToRuntime } from "@/lib/proxy";
import { runtimeManager } from "@/lib/runtime/manager";
import { isAppHost } from "@/lib/app-domain";

async function handle(
  req: Request,
  { params }: { params: Promise<{ slug: string; path?: string[] }> }
) {
  const { slug, path } = await params;

  const normalized = slug.toLowerCase();
  let project = await prisma.project.findUnique({
    where: { publishedSlug: normalized },
  });
  // 兼容历史大小写 slug
  if (!project && slug !== normalized) {
    project = await prisma.project.findUnique({
      where: { publishedSlug: slug },
    });
  }
  // 未发布或已取消发布：不可公开访问
  if (!project || !project.publishedSlug || project.publishedAt === null) {
    return new Response("not found", { status: 404 });
  }

  // 已发布但运行时不在（宿主重启等）：按当前版本惰性拉起
  if (!runtimeManager.isRunning(project.id) && project.currentVersionId) {
    await runtimeManager
      .start(project.id, project.currentVersionId)
      .catch(() => null);
  }

  const subPath = "/" + (path ?? []).map(encodeURIComponent).join("/");
  // 独立子域下根路径直接可用；平台路径代理下需要前缀重写
  const prefix = isAppHost(req.headers.get("host")) ? "" : `/p/${slug}`;
  return proxyToRuntime(req, project.id, subPath, prefix);
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
