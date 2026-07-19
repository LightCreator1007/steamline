// One stateless minute-tick. Everything it needs is in the store, so a cold
// start, a missed invocation, or a redeploy costs at most one minute of
// ticks: the next odds snapshot still carries the current line.
import { NextResponse } from "next/server";
import { chainCtx, readArmed, runArmed, type ExecOutcome } from "../../../../lib/armed";
import { feedClient, finalFromScores, ingestSnapshot, inWindow, readWatches, writeWatch, type Watch } from "../../../../lib/ingest";
import { getStore, isDurable } from "../../../../lib/store";
import { authorizeCron } from "../auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface FixtureReport {
  fixtureId: number;
  accepted: number;
  ticks: number;
  final: { HomeScore: number; AwayScore: number } | null;
  armed: ExecOutcome[];
  error: string | null;
}

export async function GET(req: Request): Promise<NextResponse> {
  const denied = authorizeCron(req);
  if (denied) return denied;

  const store = getStore();
  const now = Date.now();
  const watches = (await readWatches(store)).filter((w) => inWindow(w, now));
  if (watches.length === 0) {
    return NextResponse.json({ ok: true, durable: isDurable(), watching: 0, fixtures: [] });
  }

  const client = feedClient();
  const ctx = chainCtx();
  const fixtures: FixtureReport[] = [];

  for (const w of watches) {
    const report: FixtureReport = { fixtureId: w.fixtureId, accepted: 0, ticks: w.ticks, final: w.finalScore, armed: [], error: null };
    try {
      const snapshot = await client.oddsSnapshot(w.fixtureId);
      const ingested = await ingestSnapshot(store, w.fixtureId, snapshot, { lastTs: w.lastTs, kickoffMs: w.kickoffMs });
      report.accepted = ingested.accepted.length;
      report.ticks = ingested.all.length;

      // Scores only matter once the game can plausibly have finished.
      let final = w.finalScore;
      if (!final && now >= w.kickoffMs) final = finalFromScores(await client.scoresSnapshot(w.fixtureId));
      report.final = final;

      const next: Watch = { ...w, lastTs: ingested.lastTs, lastTickMs: now, ticks: ingested.all.length, finalScore: final };

      for (const cal of await readArmed(store, w.fixtureId, w.pinnedThetaPp, w.pinnedEdgePct)) {
        report.armed.push(await runArmed(ctx, w.fixtureId, ingested.all, final, cal));
      }
      next.settled = final !== null && report.armed.every((a) => a.settledMatch || a.skipped !== null);
      await writeWatch(store, next);
    } catch (e) {
      // One bad fixture must not stop the others; the next tick retries it.
      report.error = e instanceof Error ? e.message : String(e);
      console.error(`cron/tick fixture ${w.fixtureId}:`, report.error);
    }
    fixtures.push(report);
  }

  return NextResponse.json({ ok: true, durable: isDurable(), dryRun: ctx === null, watching: watches.length, fixtures });
}
