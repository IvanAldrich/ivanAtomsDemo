import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSessionCookie } from "@/lib/session";
import { sanitizeRedirect } from "@/lib/redirect";

const bodySchema = z.object({
  email: z.string().email().max(255),
  redirect: z.string().max(2048).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_email" },
      { status: 400 }
    );
  }

  const email = parsed.data.email.toLowerCase().trim();
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
  });

  await createSessionCookie({ uid: user.id, email: user.email });

  return NextResponse.json({
    ok: true,
    redirect: sanitizeRedirect(parsed.data.redirect, "/dashboard"),
  });
}
