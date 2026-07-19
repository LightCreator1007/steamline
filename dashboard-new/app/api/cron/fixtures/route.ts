// Daily fixture discovery. Closes the loop the laptop driver left open: a
// fixture has to be typed on a command line today, and after this it does
// not. New fixtures get a watch record and their pinned calibration armed,
// so a match trades with zero visitors.
import { NextResponse } from "next/server";
import type { Fixture } from "../../../../../packages/feed/txlineClient.ts";
import { armCal, bootstrapArena, chainCtx, validateCal } from "../../../../lib/armed";
import { feedClient, readWatches, writeWatch, type Watch } from "../../../../lib/ingest";
import { getStore, isDurable } from "../../../../lib/store";
import { authorizeCron } from "../auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_THETA_PP = 1.0;
const DEFAULT_EDGE_PCT = 0.5;

function num(raw: string | undefined, fallback: number): number {
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

/** TxLINE has shipped both epoch seconds and epoch ms; normalize either. */
export function startMs(startTime: number): number {
  return startTime < 1e12 ? startTime * 1000 : startTime;
}

export async function GET(req: Request): Promise<NextResponse> {
  const denied = authorizeCron(req);
  if (denied) return denied;

  const competitionId = Number(process.env.STEAMLINE_COMPETITION_ID);
  if (!Number.isFinite(competitionId)) {
    return NextResponse.json({ ok: false, error: "STEAMLINE_COMPETITION_ID is not set" }, { status: 500 });
  }
  const pinned = validateCal(num(process.env.STEAMLINE_PINNED_THETA_PP, DEFAULT_THETA_PP), num(process.env.STEAMLINE_PINNED_EDGE_PCT, DEFAULT_EDGE_PCT));
  if (!pinned) {
    return NextResponse.json({ ok: false, error: "pinned calibration is off the slider grid" }, { status: 500 });
  }

  const lookaheadMs = num(process.env.STEAMLINE_LOOKAHEAD_HOURS, 48) * 3_600_000;
  const store = getStore();
  const known = new Set((await readWatches(store)).map((w) => w.fixtureId));
  const now = Date.now();

  let snapshot: Fixture[];
  try {
    snapshot = await feedClient().fixturesSnapshot({ competitionId });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  const ctx = chainCtx();
  const added: number[] = [];
  for (const f of snapshot) {
    if (!f || !Number.isFinite(f.FixtureId) || !Number.isFinite(f.StartTime)) continue;
    const kickoffMs = startMs(f.StartTime);
    if (kickoffMs <= now || kickoffMs > now + lookaheadMs) continue;
    if (known.has(f.FixtureId)) continue;

    const watch: Watch = {
      fixtureId: f.FixtureId,
      home: f.Participant1 ?? "",
      away: f.Participant2 ?? "",
      kickoffMs,
      pinnedThetaPp: pinned.thetaPp,
      pinnedEdgePct: pinned.edgePct,
      lastTs: 0,
      lastTickMs: 0,
      ticks: 0,
      finalScore: null,
      settled: false,
    };
    await writeWatch(store, watch);
    await armCal(store, f.FixtureId, pinned);
    // The arena and match open here when the chain is live; when it is not,
    // the first tick with a decision bootstraps them instead. Both paths are
    // idempotent, so which one wins does not matter.
    if (ctx) await bootstrapArena(ctx, pinned.season, f.FixtureId);
    known.add(f.FixtureId);
    added.push(f.FixtureId);
  }

  return NextResponse.json({ ok: true, durable: isDurable(), dryRun: ctx === null, scanned: snapshot.length, added });
}
