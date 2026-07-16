// Steamline live driver: stream a fixture's pre-match odds from TxLINE,
// trade every steam signal on the devnet arena as it fires, and settle at
// full time on the game_finalised regulation score. Reuses the exact replay
// pipeline: payloads accumulate append-only and analyzeFixture re-runs on the
// whole prefix each tick, so signal seqs never shift and PDA idempotency holds.
// Usage: node --experimental-strip-types packages/agent/live.ts <fixtureId> <kickoffIso> [--mode poll|sse] [--network devnet|mainnet]
// Env: SEASON (default 2026), RPC_URL, THETA, EDGE_MIN, DRY_RUN=1 (no chain).
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Connection, type PublicKey } from "@solana/web3.js";
import { defaultConfig, type EngineConfig, type OddsPayload } from "../engine/model.ts";
import { resultToOutcomeName, type Result } from "../engine/settle.ts";
import { standing, renderMarkdown } from "../engine/report.ts";
import { type FeedSource } from "../feed/source.ts";
import { appendJsonl, readJsonl } from "../feed/replaySource.ts";
import { liveSource } from "../feed/liveSource.ts";
import { loadEnv, type Network } from "../feed/env.ts";
import { loadCreds } from "../feed/creds.ts";
import { makeClient, type ScoreEvent } from "../feed/txlineClient.ts";
import { analyzeFixture, type AnalyzedDecision, type Analysis } from "./analyze.ts";
import { initArena, loadOrCreate, ROOT, RPC } from "./initArena.ts";
import {
  arenaPda,
  bookPda,
  explorer,
  loadKeypair,
  matchPda,
  oddsMsgRef,
  openPositionIx,
  outcomeCode,
  positionPda,
  scoreProofRef,
  send,
  settleMatchIx,
  settlePositionIx,
} from "./client.ts";

const ALIAS: Record<string, string> = { part1: "1", draw: "X", part2: "2" };

// The same transform captureHistorical.ts applies to historical data: keep
// only the pre-match full-time 1X2 consensus line and canonicalize the
// outcome names, so live runs see exactly what the replay cards saw.
export function canonicalOdds(p: OddsPayload): OddsPayload | null {
  if (p.SuperOddsType !== "1X2_PARTICIPANT_RESULT" || p.MarketPeriod != null || p.InRunning) return null;
  if (
    !Array.isArray(p.PriceNames) ||
    !Array.isArray(p.Prices) ||
    p.PriceNames.length !== p.Prices.length ||
    p.PriceNames.length === 0 ||
    p.Prices.some((x) => !(x > 1000))
  ) {
    return null;
  }
  return { ...p, PriceNames: p.PriceNames.map((n) => ALIAS[n] ?? n) };
}

interface SideScore {
  H1?: { Goals?: number };
  H2?: { Goals?: number };
  Total?: { Goals?: number };
}

// 1X2 settles on the regulation (90 min) score, never extra time, so sum the
// two halves and only fall back to Total when the halves are absent entirely.
export function regulationScore(ev: ScoreEvent): { HomeScore: number; AwayScore: number } | null {
  const e = ev as { Action?: string; StatusId?: number; Score?: { Participant1?: SideScore; Participant2?: SideScore } };
  if (e.Action !== "game_finalised" || e.StatusId !== 100) return null;
  const p1 = e.Score?.Participant1;
  const p2 = e.Score?.Participant2;
  if (!p1 || !p2) return null;
  const reg = (s: SideScore): number => (s.H1 || s.H2 ? (s.H1?.Goals ?? 0) + (s.H2?.Goals ?? 0) : (s.Total?.Goals ?? 0));
  return { HomeScore: reg(p1), AwayScore: reg(p2) };
}

export interface LiveChain {
  open(d: AnalyzedDecision): Promise<string>;
  settleMatch(home: number, away: number, result: Result): Promise<string>;
  settlePosition(d: AnalyzedDecision): Promise<string>;
}

export interface LiveTradeOpts {
  fixtureId: number;
  kickoffMs: number;
  source: FeedSource;
  cal: Partial<EngineConfig>;
  chain: LiveChain | null; // null = dry run: decisions logged, nothing sent
  outDir?: string; // accepted odds and score events append here for replay
  deadlineMs?: number; // give up waiting for game_finalised (default kickoff + 6h)
  minGapMs?: number; // tick thinning, matches captureHistorical (default 60s)
  log?: (line: string) => void;
}

export interface LiveTradeResult {
  analysis: Analysis;
  final: { HomeScore: number; AwayScore: number } | null;
  openTxs: Map<string, string>; // "agent:signalSeq" -> tx signature
  settleMatchTx: string | null;
  settleTxs: Map<string, string>;
}

async function withRetry<T>(fn: () => Promise<T>, tries: number, log: (l: string) => void): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      log(`attempt ${i + 1}/${tries} failed: ${e instanceof Error ? e.message : String(e)}`);
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function liveTrade(o: LiveTradeOpts): Promise<LiveTradeResult> {
  const log = o.log ?? console.log;
  const minGap = o.minGapMs ?? 60_000;
  const deadline = o.deadlineMs ?? o.kickoffMs + 6 * 3_600_000;
  const ac = new AbortController();
  const openTxs = new Map<string, string>();
  const loggedSignals = new Set<number>();
  let final: { HomeScore: number; AwayScore: number } | null = null;

  const persist = (name: string, value: unknown): void => {
    if (o.outDir) appendJsonl(join(o.outDir, String(o.fixtureId), name), value);
  };

  // Resume from the persisted capture after a crash: the same prefix yields
  // the same signal seqs, so positions opened before the restart line up.
  const payloads: OddsPayload[] = o.outDir ? readJsonl<OddsPayload>(join(o.outDir, String(o.fixtureId), "odds.jsonl")) : [];
  let lastTs = payloads.length > 0 ? payloads[payloads.length - 1].Ts : 0;
  if (payloads.length > 0) log(`resumed from ${payloads.length} persisted ticks`);
  let analysis = analyzeFixture(o.fixtureId, payloads, null, o.cal);

  const handleAnalysis = async (a: Analysis): Promise<void> => {
    for (const s of a.signals) {
      if (loggedSignals.has(s.seq)) continue;
      loggedSignals.add(s.seq);
      log(
        `*** STEAM on "${s.outcome}": ${(s.preProb * 100).toFixed(1)}% -> ${(s.postProb * 100).toFixed(1)}% ` +
          `(delta ${(s.magnitude * 100).toFixed(1)}pp, ${s.method}) ***`,
      );
    }
    for (const d of a.decisions) {
      const key = `${d.agent}:${d.signalSeq}`;
      if (openTxs.has(key)) continue;
      const name = d.agent === 0 ? "follow" : "fade";
      log(
        `${name}: BACK "${d.outcome}" at ${d.entryOdds.toFixed(2)}, stake ${d.stake.toLocaleString()} pts ` +
          `(edge ${(d.edge * 100).toFixed(1)}%, seq ${d.signalSeq})`,
      );
      if (!o.chain) {
        openTxs.set(key, "dry-run");
        continue;
      }
      try {
        const sig = await o.chain.open(d);
        openTxs.set(key, sig);
        log(`${name}: open_position tx ${explorer(sig)}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("already in use") || msg.includes("custom program error: 0x0")) {
          // A duplicate open is a PDA init collision: the position is already
          // on chain from before a restart, adopt it.
          openTxs.set(key, "pre-existing");
          log(`${name}: position already on chain, adopted`);
        } else {
          log(`${name}: open failed, retrying next tick: ${msg}`);
        }
      }
    }
  };
  await handleAnalysis(analysis);

  for await (const ev of o.source.events(ac.signal)) {
    if (Date.now() >= deadline) {
      log("deadline reached before game_finalised; stopping");
      break;
    }
    if (ev.kind === "score") {
      persist("scores.jsonl", ev.payload);
      final = regulationScore(ev.payload);
      if (final) break;
      continue;
    }
    // Accept in arrival order with a monotonic minimum gap: late or
    // out-of-order payloads are dropped, so the accumulated prefix is
    // append-only and every earlier re-analysis stays valid verbatim.
    const p = canonicalOdds(ev.payload);
    if (!p || p.Ts < lastTs + minGap || p.Ts >= o.kickoffMs) continue;
    lastTs = p.Ts;
    payloads.push(p);
    persist("odds.jsonl", p);
    analysis = analyzeFixture(o.fixtureId, payloads, null, o.cal);
    const t = analysis.trace[analysis.trace.length - 1];
    log(
      `tick ${t.tick.messageId}  ` +
        t.tick.outcomes.map((x) => `${x.name}=${x.decimalOdds.toFixed(2)} (${(x.fairProb * 100).toFixed(1)}%)`).join("  "),
    );
    await handleAnalysis(analysis);
  }
  ac.abort();

  analysis = analyzeFixture(o.fixtureId, payloads, final, o.cal);
  let settleMatchTx: string | null = null;
  const settleTxs = new Map<string, string>();
  if (final && analysis.result) {
    log(`=== regulation final: ${final.HomeScore}-${final.AwayScore} (${analysis.result}) ===`);
    if (o.chain) {
      const { HomeScore, AwayScore } = final;
      const result = analysis.result;
      settleMatchTx = await withRetry(() => o.chain!.settleMatch(HomeScore, AwayScore, result), 3, log);
      log(`settle_match tx ${explorer(settleMatchTx)}`);
      for (const d of analysis.decisions) {
        const key = `${d.agent}:${d.signalSeq}`;
        const openSig = openTxs.get(key);
        if (!openSig || openSig === "dry-run") continue;
        const sig = await withRetry(() => o.chain!.settlePosition(d), 3, log);
        settleTxs.set(key, sig);
        const name = d.agent === 0 ? "follow" : "fade";
        log(`${name}: "${d.outcome}" ${d.status.toUpperCase()}, payout ${d.payout.toLocaleString()}, tx ${explorer(sig)}`);
      }
    }
  } else if (!final) {
    log("no game_finalised received; on-chain positions stay open for a later settle");
  }
  return { analysis, final, openTxs, settleMatchTx, settleTxs };
}

// CLI wiring: TxLINE live source in, devnet arena out.
async function mainLive(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      mode: { type: "string", default: "poll" },
      network: { type: "string", default: process.env.TXLINE_NETWORK ?? "devnet" },
    },
  });
  const fixtureId = Number(positionals[0]);
  const kickoffMs = Date.parse(positionals[1] ?? "");
  if (!fixtureId || !Number.isFinite(kickoffMs) || (values.mode !== "poll" && values.mode !== "sse")) {
    console.log("usage: live.ts <fixtureId> <kickoffIso> [--mode poll|sse] [--network devnet|mainnet]");
    process.exitCode = 2;
    return;
  }
  const DRY = process.env.DRY_RUN === "1";
  const seasonId = BigInt(process.env.SEASON ?? "2026");
  const cal = {
    theta: Number(process.env.THETA ?? defaultConfig.theta),
    edgeMin: Number(process.env.EDGE_MIN ?? defaultConfig.edgeMin),
  };
  const env = loadEnv(process.env, values.network as Network);
  const creds = loadCreds(`keypairs/creds.${env.network}.json`);
  const jwt = env.jwt ?? creds.jwt;
  const apiToken = env.apiToken ?? creds.apiToken;
  const client = makeClient({ apiBase: env.apiBase, jwt, apiToken });
  const source =
    values.mode === "sse"
      ? liveSource({
          client,
          fixtureIds: [fixtureId],
          mode: "sse",
          apiBase: env.apiBase,
          headers: {
            ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
            ...(apiToken ? { "X-Api-Token": apiToken } : {}),
          },
        })
      : liveSource({ client, fixtureIds: [fixtureId], mode: "poll" });

  let chain: LiveChain | null = null;
  let parity: (() => Promise<void>) | null = null;
  let finalAnalysis: Analysis | null = null;
  if (!DRY) {
    const connection = new Connection(RPC, "confirmed");
    // Keypair paths are overridable so the run can target the public web
    // arena (777, keypairs/web-*.json) instead of the CLI agents.
    const authority = loadKeypair(`${ROOT}${process.env.AUTHORITY_KEYPAIR ?? "keypairs/deployer.json"}`);
    const follow = loadOrCreate(`${ROOT}${process.env.FOLLOW_KEYPAIR ?? "keypairs/agent-follow.json"}`);
    const fade = loadOrCreate(`${ROOT}${process.env.FADE_KEYPAIR ?? "keypairs/agent-fade.json"}`);
    const agents = [follow, fade];
    await initArena({
      season: seasonId,
      authority,
      follow,
      fade,
      fixtures: [BigInt(fixtureId)],
      fund: [
        { wallet: follow, target: 0.05, floor: 0.03 },
        { wallet: fade, target: 0.05, floor: 0.03 },
      ],
    });
    const arena = arenaPda(seasonId);
    const game = matchPda(arena, BigInt(fixtureId));
    const books = agents.map((a) => bookPda(arena, a.publicKey));
    chain = {
      open: (d) =>
        send(
          connection,
          [
            openPositionIx({
              authority: agents[d.agent].publicKey,
              book: books[d.agent],
              game,
              fixtureId: BigInt(fixtureId),
              outcome: outcomeCode(d.outcome),
              stakePoints: BigInt(d.stake),
              entryOddsMilli: d.entryOddsMilli,
              edgeBps: d.edgeBps,
              oddsMsgRef: oddsMsgRef(d.messageId),
              oddsTs: BigInt(d.ts),
              signalSeq: BigInt(d.signalSeq),
            }),
          ],
          agents[d.agent],
        ),
      settleMatch: (home, away, result) =>
        send(
          connection,
          [
            settleMatchIx({
              authority: authority.publicKey,
              arena,
              game,
              fixtureId: BigInt(fixtureId),
              homeScore: home,
              awayScore: away,
              settledOutcome: outcomeCode(resultToOutcomeName(result)),
              scoreProofRef: scoreProofRef(fixtureId, home, away),
            }),
          ],
          authority,
        ),
      settlePosition: (d) =>
        send(
          connection,
          [settlePositionIx({ game, position: positionPda(game, books[d.agent], BigInt(d.signalSeq)), book: books[d.agent] })],
          authority,
        ),
    };

    // AgentBook layout offsets as in run.ts; parity compares this run's deltas.
    const readBook = async (pk: PublicKey): Promise<{ bankroll: bigint; pnl: bigint; won: number; lost: number } | null> => {
      const info = await connection.getAccountInfo(pk);
      if (!info) return null;
      const d = info.data;
      return { bankroll: d.readBigUInt64LE(88), pnl: d.readBigInt64LE(104), won: d.readUInt32LE(116), lost: d.readUInt32LE(120) };
    };
    const startBooks = await Promise.all(books.map(readBook));
    parity = async () => {
      console.log("\n=== on-chain vs engine parity (this run's deltas) ===");
      for (let agentId = 0; agentId < 2; agentId++) {
        const name = agentId === 0 ? "follow" : "fade";
        const end = await readBook(books[agentId]);
        const start = startBooks[agentId];
        if (!end || !start || !finalAnalysis) {
          console.log(`${name}: book MISSING on-chain`);
          continue;
        }
        const local = finalAnalysis.books[agentId];
        const startingBankroll = defaultConfig.startingBankroll;
        const dBankroll = end.bankroll - start.bankroll;
        const dPnl = end.pnl - start.pnl;
        const engBankroll = BigInt(local.bankrollPoints - startingBankroll);
        const engPnl = BigInt(local.realizedPnl);
        const match =
          dBankroll === engBankroll && dPnl === engPnl && end.won - start.won === local.betsWon && end.lost - start.lost === local.betsLost
            ? "MATCH"
            : "MISMATCH";
        console.log(
          `${name}: on-chain delta bankroll ${dBankroll.toLocaleString()} pnl ${dPnl.toLocaleString()} ` +
            `(+${end.won - start.won}W/+${end.lost - start.lost}L) vs engine ${engBankroll.toLocaleString()} / ${engPnl.toLocaleString()} -> ${match}`,
        );
      }
    };
  }

  console.log(
    `steamline live: fixture ${fixtureId}, kickoff ${new Date(kickoffMs).toISOString()}, season ${seasonId}` +
      `${DRY ? " [DRY RUN, no chain]" : ""} (theta ${cal.theta}, edgeMin ${cal.edgeMin}, ${values.mode})`,
  );
  const res = await liveTrade({ fixtureId, kickoffMs, source, cal, chain, outDir: `${ROOT}fixtures/live-run-${fixtureId}` });
  finalAnalysis = res.analysis;

  console.log("\n=== leaderboard (engine) ===");
  console.log(renderMarkdown(res.analysis.books.map((b) => standing(b))));
  if (parity && res.final) await parity();
  if (!res.final) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("live.ts")) {
  mainLive().catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    process.exit(1);
  });
}
