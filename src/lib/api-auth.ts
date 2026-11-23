import { NextResponse } from "next/server";
import { getSession, type SessionPayload } from "./session";

export async function requireSession(): Promise<
  { session: SessionPayload } | { response: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return {
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  return { session };
}
