import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSessionCookie } from "@/lib/session";
import { sanitizeRedirect } from "@/lib/redirect";
import { hashPassword } from "@/lib/password";

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
  const passwordHash = await hashPassword(parsed.data.password);
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    return NextResponse.json({ error: "email_taken" }, { status: 409 });
  }

  const user = await prisma.user.create({ data: { email, passwordHash } });

  await createSessionCookie({ uid: user.id, email: user.email });
  return NextResponse.json({
    ok: true,
    redirect: sanitizeRedirect(parsed.data.redirect, "/dashboard"),
  });
}