import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSessionCookie } from "@/lib/session";
import { sanitizeRedirect } from "@/lib/redirect";
import { hashPassword, verifyPassword } from "@/lib/password";

const bodySchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
  redirect: z.string().max(2048).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email } });

  // 兼容迁移：历史演示账号（无密码）首次登录时以本次输入作为初始密码
  if (user && !user.passwordHash) {
    const passwordHash = await hashPassword(parsed.data.password);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  }

  const fresh = user?.passwordHash
    ? user
    : await prisma.user.findUnique({ where: { email } });
  const ok = await verifyPassword(
    parsed.data.password,
    fresh?.passwordHash ?? null
  );
  if (!fresh || !ok) {
    return NextResponse.json(
      { error: "invalid_credentials" },
      { status: 401 }
    );
  }

  await createSessionCookie({ uid: fresh.id, email: fresh.email });
  return NextResponse.json({
    ok: true,
    redirect: sanitizeRedirect(parsed.data.redirect, "/dashboard"),
  });
}