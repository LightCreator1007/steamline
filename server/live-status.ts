// Read-only live-run status for the public arena (season 777). Unlike
// api/run.js, it reconstructs everything from chain PDAs alone, no replay
// data needed, so it works DURING a live window while the CLI live driver
// (packages/agent/live.ts) is trading the match.
// GET /api/live-status?fixture=<id>
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { defaultConfig, type OddsPayload } from "../packages/engine/model.ts";
import { normalizeOdds } from "../packages/engine/normalize.ts";
import { RPC_DEVNET_DEFAULT } from "../packages/feed/env.ts";
import { makeClient } from "../packages/feed/txlineClient.ts";
import { arenaPda, bookPda, matchPda, positionPda } from "../packages/agent/client.ts";
import { canonicalOdds } from "../packages/agent/live.ts";

const SEASON = 777n;
// ponytail: probe depth 8 signal seqs per book; raise if a match ever fires more
const MAX_SEQ = 8;
const MATCH_STATUS = ["open", "settled", "voided"] as const;
const POS_STATUS = ["open", "won", "lost", "refunded"] as const;
const OUTCOME = ["1", "X", "2"];

function envPubkey(name: string): PublicKey {
  const raw = process.env[name];
  if (!raw) throw new Error(`missing env ${name}`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))).publicKey;
}

// Live consensus odds from TxLINE, same canonical transform the live driver
// applies (FT 1X2 consensus line, 60s thinning), so the tiles and sparkline
// show exactly what the agent sees. Empty when the market has not opened or
// creds are absent; the panel degrades gracefully either way.
async function fetchTicks(fixtureId: number): Promise<any[]> {
  const jwt = process.env.TXLINE_JWT_DEVNET;
  const apiToken = process.env.TXLINE_API_TOKEN_DEVNET;
  if (!jwt || !apiToken) return [];
  try {
    const client = makeClient({ apiBase: "https://txline-dev.txodds.com", jwt, apiToken, timeoutMs: 6_000, retries: 1 });
    const raw = await client.oddsSnapshot(fixtureId);
    const ft = raw
      .map((p) => canonicalOdds(p as OddsPayload))
      .filter((p): p is OddsPayload => p !== null)
      .sort((a, b) => a.Ts - b.Ts);
    const ticks: any[] = [];
    let last = 0;
    for (const p of ft) {
      if (p.Ts < last + 60_000) continue;
      last = p.Ts;
      const t = normalizeOdds({ ...p, FixtureId: fixtureId }, p.Ts, defaultConfig);
      ticks.push({
        ts: p.Ts,
        outcomes: t.outcomes.map((o) => ({ name: o.name, odds: Number(o.decimalOdds.toFixed(3)), prob: Number(o.fairProb.toFixed(4)) })),
      });
    }
    return ticks.slice(-360);
  } catch {
    return [];
  }
}

export default async function handler(req: any, res: any): Promise<void> {
  try {
    const fixtureId = Number(req.query.fixture);
    const origin = `https://${req.headers.host}`;
    const games = await (await fetch(`${origin}/data/games.json`)).json();
    if (!Array.isArray(games) || !games.some((g: any) => g.id === fixtureId)) {
      res.status(404).json({ error: "unknown fixture" });
      return;
    }

    const connection = new Connection(process.env.RPC_URL ?? RPC_DEVNET_DEFAULT, "confirmed");
    const follow = envPubkey("WEB_FOLLOW_KEYPAIR");
    const fade = envPubkey("WEB_FADE_KEYPAIR");
    const arena = arenaPda(SEASON);
    const match = matchPda(arena, BigInt(fixtureId));
    const books = [bookPda(arena, follow), bookPda(arena, fade)];

    const ticksPromise = fetchTicks(fixtureId);
    const probes: { agent: number; seq: number; pda: PublicKey }[] = [];
    for (let agent = 0; agent < 2; agent++) {
      for (let seq = 0; seq < MAX_SEQ; seq++) {
        probes.push({ agent, seq, pda: positionPda(match, books[agent], BigInt(seq)) });
      }
    }
    const infos = await connection.getMultipleAccountsInfo([match, ...probes.map((p) => p.pda)]);

    // Position layout: 8 disc + game 32 + book 32 + signal_seq u64, then
    // outcome u8 @80, stake u64 @81, entry_odds_milli u32 @89, edge i32 @93,
    // odds_msg_ref 32 @97, odds_ts i64 @129, status u8 @137, payout u64 @138.
    const positions: any[] = [];
    for (let i = 0; i < probes.length; i++) {
      const info = infos[i + 1];
      if (!info) continue;
      const d = info.data;
      const { agent, seq, pda } = probes[i];
      const sigs = await connection.getSignaturesForAddress(pda, { limit: 10 });
      positions.push({
        agent: agent === 0 ? "follow" : "fade",
        signalSeq: seq,
        outcome: OUTCOME[d[80]] ?? "?",
        entryOdds: d.readUInt32LE(89) / 1000,
        stake: Number(d.readBigUInt64LE(81)),
        status: POS_STATUS[d[137]] ?? "open",
        payout: Number(d.readBigUInt64LE(138)),
        address: pda.toBase58(),
        openTx: sigs[sigs.length - 1]?.signature ?? null,
        settleTx: sigs.length > 1 ? sigs[0].signature : null,
      });
    }
    positions.sort((a, b) => a.signalSeq - b.signalSeq || (a.agent < b.agent ? -1 : 1));

    // Match layout: 8 disc + arena 32 + fixture_id u64, then status u8 @48,
    // start_time i64 @49, home_score u16 @57, away_score u16 @59.
    const mi = infos[0];
    const matchState = mi
      ? {
          exists: true,
          status: MATCH_STATUS[mi.data[48]] ?? "open",
          homeScore: mi.data.readUInt16LE(57),
          awayScore: mi.data.readUInt16LE(59),
        }
      : { exists: false, status: "pending", homeScore: 0, awayScore: 0 };

    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    res.status(200).json({
      season: SEASON.toString(),
      fixtureId,
      arena: arena.toBase58(),
      match: match.toBase58(),
      books: [
        { agent: "follow", address: books[0].toBase58() },
        { agent: "fade", address: books[1].toBase58() },
      ],
      matchState,
      positions,
      ticks: await ticksPromise,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
