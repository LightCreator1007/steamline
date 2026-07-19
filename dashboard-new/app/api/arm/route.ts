// "Arm this calibration". Free for the visitor, rate limited per IP, and
// bounded by the 609-cell slider grid: a calibration is either on the grid
// and gets its own season, or it is rejected. Arming never trades; the cron
// tick does, once the fixture produces a signal at that calibration.
import { NextResponse } from "next/server";
import { armCal, bootstrapArena, chainCtx, rateLimited, validateCal } from "../../../lib/armed";
import { readWatches } from "../../../lib/ingest";
import { getStore } from "../../../lib/store";

export const dynamic = "force-dynamic";

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : "unknown";
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "body must be a JSON object" }, { status: 400 });
  }
  const { fixtureId, theta, edge } = body as { fixtureId?: unknown; theta?: unknown; edge?: unknown };
  const fid = Number(fixtureId);
  if (!Number.isInteger(fid) || fid <= 0) {
    return NextResponse.json({ ok: false, error: "fixtureId must be a positive integer" }, { status: 400 });
  }
  const cal = validateCal(theta, edge);
  if (!cal) {
    return NextResponse.json({ ok: false, error: "calibration off the slider grid" }, { status: 400 });
  }
  if (rateLimited(clientIp(req))) {
    return NextResponse.json({ ok: false, error: "rate limited; try again in a minute" }, { status: 429 });
  }

  const store = getStore();
  const watched = (await readWatches(store)).some((w) => w.fixtureId === fid);
  await armCal(store, fid, cal);

  let bootstrapped = false;
  try {
    const ctx = chainCtx();
    if (ctx) {
      await bootstrapArena(ctx, cal.season, fid);
      bootstrapped = true;
    }
  } catch (e) {
    // The calibration is armed either way; the next tick retries the arena.
    console.error(`arm ${fid} season ${cal.season} bootstrap:`, e instanceof Error ? e.message : String(e));
  }

  return NextResponse.json({ ok: true, fixtureId: fid, season: cal.season, theta: cal.thetaPp, edge: cal.edgePct, watched, bootstrapped });
}
