// GET /api/live-status?fixture=<id>
// Read-only status for the public arena (season 777), reconstructed from chain
// PDAs plus the M3 tick store, so it works DURING a live window with no local
// process running. Port of server/live-status.ts.
//
// The frozen handler served a TxLINE consensus tick tape out of a
// warm-instance cache; that is gone. Ticks now come from the Redis (or local
// file, in dev) list the cron appends to, so history survives cold starts.
import { PublicKey } from "@solana/web3.js";
import { positionPda } from "../../../../packages/agent/client.ts";
import { defaultConfig } from "../../../../packages/engine/model.ts";
import { normalizeOdds } from "../../../../packages/engine/normalize.ts";
import { loadGames } from "../../../lib/fixtures";
import { ApiErrorException, errorResponse, isErrorCode } from "../../../lib/errors";
import { assertDevnet, connection, envPubkey, pdas, PUBLIC_SEASON, readAccounts, txsFor } from "../../../lib/chain";
import { canonicalOdds } from "../../../../packages/agent/live.ts";
import { feedClient, parsePayloads, parseWatch, WINDOW_MS } from "../../../lib/ingest";
import { getStore, WATCH_KEY } from "../../../lib/store";
import { derivePhases } from "../../../lib/phase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ponytail: probe depth 8 signal seqs per book; raise if a match ever fires more
const MAX_SEQ = 8;
const MATCH_STATUS = ["open", "settled", "voided"] as const;
const POS_STATUS = ["open", "won", "lost", "refunded"] as const;
const OUTCOME = ["1", "X", "2"] as const;

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (process.env.NODE_ENV !== "production") {
    const code = url.searchParams.get("force");
    if (isErrorCode(code)) return errorResponse({ code, message: `Forced ${code} for error-surface testing.` });
  }
  try {
    assertDevnet();
    const fixtureId = Number(url.searchParams.get("fixture"));
    const games = await loadGames();
    const game = games.find((g) => g.id === fixtureId);
    if (!game) {
      throw new ApiErrorException({ code: "unknown_fixture", message: "No such fixture." });
    }

    const conn = connection();
    const { arena, match, books } = pdas(PUBLIC_SEASON, fixtureId, envPubkey("WEB_FOLLOW_KEYPAIR"), envPubkey("WEB_FADE_KEYPAIR"));

    const probes: { agent: number; seq: number; pda: PublicKey }[] = [];
    for (let agent = 0; agent < 2; agent++) {
      for (let seq = 0; seq < MAX_SEQ; seq++) {
        probes.push({ agent, seq, pda: positionPda(match, books[agent], BigInt(seq)) });
      }
    }
    const infos = await readAccounts(conn, [match, ...probes.map((p) => p.pda)]);

    // Position layout: 8 disc + game 32 + book 32 + signal_seq u64, then
    // outcome u8 @80, stake u64 @81, entry_odds_milli u32 @89, edge i32 @93,
    // odds_msg_ref 32 @97, odds_ts i64 @129, status u8 @137, payout u64 @138.
    const positions = [];
    let firstPositionMs: number | null = null;
    for (let i = 0; i < probes.length; i++) {
      const info = infos[i + 1];
      if (!info) continue;
      const d = info.data;
      const { agent, seq, pda } = probes[i];
      const oddsTsMs = Number(d.readBigInt64LE(129));
      firstPositionMs = firstPositionMs === null ? oddsTsMs : Math.min(firstPositionMs, oddsTsMs);
      positions.push({
        agent: agent === 0 ? "follow" : "fade",
        signalSeq: seq,
        outcome: OUTCOME[d[80]] ?? "1",
        entryOdds: d.readUInt32LE(89) / 1000,
        stake: Number(d.readBigUInt64LE(81)),
        status: POS_STATUS[d[137]] ?? "open",
        payout: Number(d.readBigUInt64LE(138)),
        address: pda.toBase58(),
        ...(await txsFor(conn, pda)),
      });
    }
    positions.sort((a, b) => a.signalSeq - b.signalSeq || (a.agent < b.agent ? -1 : 1));

    // Match layout: 8 disc + arena 32 + fixture_id u64, then status u8 @48,
    // start_time i64 @49, home_score u16 @57, away_score u16 @59.
    const mi = infos[0];
    const matchState = mi
      ? {
          exists: true,
          status: (MATCH_STATUS[mi.data[48]] ?? "open") as string,
          homeScore: mi.data.readUInt16LE(57),
          awayScore: mi.data.readUInt16LE(59),
        }
      : { exists: false, status: "pending", homeScore: 0, awayScore: 0 };

    // Two tick sources, unioned, because either alone has a hole. The store
    // is durable but only as complete as the cron that fills it, so a fresh
    // database or a cron that never ran leaves the tape empty. TxLINE always
    // has the current line but keeps no history. Together: history from the
    // store, the newest tick from the feed, and the route still works with no
    // database provisioned at all (which is how the shipped build behaves).
    const store = getStore();
    const payloads = parsePayloads(await store.readTicks(fixtureId));
    const seen = new Set(payloads.map((p) => p.Ts));
    try {
      for (const raw of await feedClient().oddsSnapshot(fixtureId)) {
        const p = canonicalOdds(raw);
        if (p && !seen.has(p.Ts)) {
          seen.add(p.Ts);
          payloads.push({ ...p, FixtureId: fixtureId });
        }
      }
      payloads.sort((a, b) => a.Ts - b.Ts);
    } catch {
      // Feed unreachable or unconfigured: serve whatever the store holds.
    }
    const ticks = [];
    for (const p of payloads) {
      try {
        const t = normalizeOdds(p, p.Ts, defaultConfig);
        ticks.push({
          ts: p.Ts,
          outcomes: t.outcomes.map((o) => ({ name: o.name, odds: Number(o.decimalOdds.toFixed(3)), prob: Number(o.fairProb.toFixed(4)) })),
        });
      } catch {
        // A malformed stored tick must not break the whole tape.
      }
    }
    const firstTickMs = ticks.length > 0 ? ticks[0].ts : null;

    const watchRaw = await store.hget(WATCH_KEY, String(fixtureId));
    const watch = watchRaw ? parseWatch(watchRaw) : null;
    const lastTickMs = watch?.lastTickMs || (ticks.length > 0 ? ticks[ticks.length - 1].ts : null);
    const kickoffMs = Date.parse(game.kickoff ?? "") || Date.now();
    const settled = matchState.status === "settled" || watch?.settled === true;

    const phase = derivePhases({
      nowMs: Date.now(),
      kickoffMs,
      windowMs: WINDOW_MS,
      firstTickMs,
      lastTickMs,
      positionsCount: positions.length,
      firstPositionMs,
      hasFinalScore: watch?.finalScore != null,
      settled,
    });

    return Response.json(
      {
        season: PUBLIC_SEASON.toString(),
        fixtureId,
        arena: arena.toBase58(),
        match: match.toBase58(),
        books: [
          { agent: "follow", address: books[0].toBase58() },
          { agent: "fade", address: books[1].toBase58() },
        ],
        matchState,
        positions,
        ticks,
        phase,
        lastTickMs,
        ticksSeen: watch?.ticks ?? ticks.length,
        fetchedAt: Date.now(),
      },
      { headers: { "Cache-Control": "s-maxage=30, stale-while-revalidate=60" } },
    );
  } catch (e) {
    if (e instanceof ApiErrorException) return errorResponse(e.detail);
    return errorResponse({ code: "internal", message: e instanceof Error ? e.message : String(e) });
  }
}
