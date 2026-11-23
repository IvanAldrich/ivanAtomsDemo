import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  signSession,
  verifySessionToken,
  type SessionPayload,
} from "./session-core";

export { SESSION_COOKIE };
export type { SessionPayload };

const WEEK = 60 * 60 * 24 * 7;

export async function createSessionCookie(payload: SessionPayload) {
  const token = await signSession(payload);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: WEEK,
    secure: process.env.COOKIE_SECURE === "true",
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}
