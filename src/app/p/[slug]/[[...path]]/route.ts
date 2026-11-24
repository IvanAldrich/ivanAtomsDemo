import { prisma } from "@/lib/prisma";
import { proxyToRuntime } from "@/lib/proxy";
import { runtimeManager } from "@/lib/runtime/manager";

async function handle(
  req: Request,
  { params }: { params: Promise<{ slug: string; path?: string[] }> }
) {
  const { slug, path } = await params;

  const project = await prisma.project.findUnique({
    where: { publishedSlug: slug },
  });
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
  return proxyToRuntime(req, project.id, subPath, `/p/${slug}`);
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
