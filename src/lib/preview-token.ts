import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_SEC = Number(process.env.PREVIEW_TOKEN_TTL_SEC ?? 24 * 60 * 60);

/**
 * 预览令牌：HMAC(SESSION_SECRET, "preview:{projectId}:{exp}")，带过期时间。
 * 沙箱 iframe（不透明源）的子资源请求不携带 Cookie，
 * 因此预览资源通过 URL 中的短期令牌鉴权。
 */
export function previewToken(
  projectId: string,
  ttlSec = DEFAULT_TTL_SEC
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return `${exp}.${sign(projectId, exp)}`;
}

export function verifyPreviewToken(projectId: string, token: string): boolean {
  const [expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) return false;
  if (!sig) return false;
  const expected = sign(projectId, exp);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sign(projectId: string, exp: number): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return createHmac("sha256", secret)
    .update(`preview:${projectId}:${exp}`)
    .digest("hex")
    .slice(0, 32);
}