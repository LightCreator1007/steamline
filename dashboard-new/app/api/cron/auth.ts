// Vercel's cron invocations carry `Authorization: Bearer $CRON_SECRET`.
// Without the secret set the routes stay open, which is what local dev wants
// and what a deploy must not have; the response says which mode it is in.
import { NextResponse } from "next/server";

export function authorizeCron(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.VERCEL_ENV === "production") {
      return NextResponse.json({ ok: false, error: "CRON_SECRET is not set" }, { status: 500 });
    }
    return null;
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}
