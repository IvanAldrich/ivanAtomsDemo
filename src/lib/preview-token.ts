import { createHmac } from "node:crypto";

/**
 * 预览令牌：HMAC(SESSION_SECRET, "preview:{projectId}")。
 * 沙箱 iframe（不透明源）的子资源请求不携带 Cookie，
 * 因此预览资源通过 URL 中的令牌鉴权（仅属主会话可见该 URL）。
 */
export function previewToken(projectId: string): string {
  const secret = process.env.SESSION_SECRET ?? "dev-secret";
  return createHmac("sha256", secret)
    .update(`preview:${projectId}`)
    .digest("hex")
    .slice(0, 32);
}