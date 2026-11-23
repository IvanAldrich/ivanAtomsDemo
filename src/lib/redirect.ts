/**
 * 仅接受站内相对路径，防开放重定向；其余一律回退到 fallback。
 */
export function sanitizeRedirect(
  input: string | null | undefined,
  fallback: string
): string {
  if (!input) return fallback;
  if (!input.startsWith("/")) return fallback;
  if (input.startsWith("//") || input.includes("://")) return fallback;
  return input;
}
