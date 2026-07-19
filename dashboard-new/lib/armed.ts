// Armed calibrations: the trading half of the cron loop.
//
// A visitor arms a calibration; the server checks it against the discrete
// slider grid, derives its season, and records it. Every cron tick then runs
// analyzeFixture over the stored ticks for each armed calibration and puts
// anything new on chain. Position PDAs derive from (match, book, signalSeq),
// so a retry is free and a double-open is impossible.
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { analyzeFixture, type AnalyzedDecision } from "../../packages/agent/analyze.ts";
import type { OddsPayload } from "../../packages/engine/model.ts";
import { outcomeFromScore, resultToOutcomeName } from "../../packages/engine/settle.ts";
import { RPC_DEVNET_DEFAULT, TXORACLE_DEVNET } from "../../packages/feed/env.ts";
import {
  arenaPda,
  bookPda,
  initializeArenaIx,
  matchPda,
  oddsMsgRef,
  openMatchIx,
  openPositionIx,
  outcomeCode,
  positionPda,
  registerAgentIx,
  scoreProofRef,
  send,
  settleMatchIx,
  settlePositionIx,
} from "../../packages/agent/client.ts";
import { armedKey, type Store } from "./store/index.ts";
import { checkSolFloor, floorSolFromEnv } from "./guard.ts";

const STARTING_BANKROLL = 1_000_000_000n;

export interface ArmedCal {
  thetaPp: number; // slider units: theta in percentage points
  edgePct: number; // slider units: minimum edge in percent
  season: number;
  /** Engine calibration: fractions, not slider units. */
  cal: { theta: number; edgeMin: number };
}

/**
 * The discrete grid, identical to calSeason() in server/run.ts: theta
 * 0.2-3.0pp step 0.1, edge 0-2.0% step 0.1. Off-grid input is rejected, not
 * clamped: a clamp would silently send the visitor to a different arena than
 * the one their URL claims.
 */
export function validateCal(thetaPp: unknown, edgePct: unknown): ArmedCal | null {
  const t = Number(thetaPp);
  const e = Number(edgePct);
  if (!Number.isFinite(t) || !Number.isFinite(e)) return null;
  const tt = Math.round(t * 10);
  const ee = Math.round(e * 10);
  if (Math.abs(t * 10 - tt) > 1e-6 || Math.abs(e * 10 - ee) > 1e-6) return null;
  if (tt < 2 || tt > 30 || ee < 0 || ee > 20) return null;
  return { thetaPp: tt / 10, edgePct: ee / 10, season: 900000 + tt * 100 + ee, cal: { theta: tt / 1000, edgeMin: ee / 1000 } };
}

/**
 * Everything armed for a fixture. The pinned calibration is always present,
 * so a fixture gets its canonical run with zero visitors.
 */
export async function readArmed(store: Store, fixtureId: number, pinnedThetaPp: number, pinnedEdgePct: number): Promise<ArmedCal[]> {
  const bySeason = new Map<number, ArmedCal>();
  const pinned = validateCal(pinnedThetaPp, pinnedEdgePct);
  if (pinned) bySeason.set(pinned.season, pinned);
  const raw = await store.hgetall(armedKey(fixtureId));
  for (const value of Object.values(raw)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const p = parsed as { thetaPp?: unknown; edgePct?: unknown };
    const cal = validateCal(p.thetaPp, p.edgePct);
    if (cal) bySeason.set(cal.season, cal);
  }
  return [...bySeason.values()].sort((a, b) => a.season - b.season);
}

export async function armCal(store: Store, fixtureId: number, cal: ArmedCal): Promise<void> {
  await store.hset(armedKey(fixtureId), String(cal.season), JSON.stringify({ thetaPp: cal.thetaPp, edgePct: cal.edgePct }));
}

// ponytail: per-instance rate limiter, same shape as server/run.ts. A cold
// start resets it. Enough to stop naive slider scripting; move to a store
// hash if arming ever becomes worth abusing.
const hits = new Map<string, number[]>();
export function rateLimited(ip: string, nowMs: number = Date.now()): boolean {
  const list = (hits.get(ip) ?? []).filter((ts) => nowMs - ts < 60_000);
  list.push(nowMs);
  hits.set(ip, list);
  let total = 0;
  for (const l of hits.values()) total += l.length;
  return list.length > 3 || total > 20;
}

// --- planning (pure) ------------------------------------------------------

export interface TradePlan {
  season: number;
  cal: ArmedCal;
  decisions: AnalyzedDecision[];
  /** Indices into decisions whose position PDA is not on chain yet. */
  toOpen: number[];
  settle: boolean;
}

/** What this tick would do, given what already exists on chain. */
export function planTrades(
  fixtureId: number,
  payloads: OddsPayload[],
  finalScore: { HomeScore: number; AwayScore: number } | null,
  cal: ArmedCal,
  onChain: boolean[],
): TradePlan {
  const analysis = analyzeFixture(fixtureId, payloads, finalScore, cal.cal);
  const toOpen: number[] = [];
  for (let i = 0; i < analysis.decisions.length; i++) if (!onChain[i]) toOpen.push(i);
  return { season: cal.season, cal, decisions: analysis.decisions, toOpen, settle: finalScore !== null && analysis.decisions.length > 0 };
}

// --- execution ------------------------------------------------------------

export interface ChainCtx {
  connection: Connection;
  authority: Keypair;
  agents: [Keypair, Keypair];
}

function envKeypair(name: string, env: Record<string, string | undefined>): Keypair {
  const raw = env[name];
  if (!raw) throw new Error(`missing env ${name}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`env ${name} is not a JSON secret key array`);
  }
  if (!Array.isArray(parsed)) throw new Error(`env ${name} is not a JSON secret key array`);
  return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
}

/**
 * A chain context, or null when the cron must not spend. Null is the default:
 * the write path is opt-in via STEAMLINE_LIVE_CHAIN=1, and mainnet RPCs are
 * refused outright. Play-money points, devnet rent, nothing else.
 */
export function chainCtx(env: Record<string, string | undefined> = process.env): ChainCtx | null {
  if (env.STEAMLINE_LIVE_CHAIN !== "1") return null;
  const rpc = env.RPC_URL ?? RPC_DEVNET_DEFAULT;
  if (/mainnet/i.test(rpc)) throw new Error("refusing to run the cron against a mainnet RPC");
  return {
    connection: new Connection(rpc, "confirmed"),
    authority: envKeypair("WEB_AUTHORITY_KEYPAIR", env),
    agents: [envKeypair("WEB_FOLLOW_KEYPAIR", env), envKeypair("WEB_FADE_KEYPAIR", env)],
  };
}

/**
 * Arena, both agent books, and the match for this fixture. Every step is
 * skipped when the account already exists, so calling this on every tick and
 * on every arm costs one multi-account read and nothing else.
 */
export async function bootstrapArena(ctx: ChainCtx, seasonNumber: number, fixtureId: number): Promise<void> {
  const season = BigInt(seasonNumber);
  const arena = arenaPda(season);
  const match = matchPda(arena, BigInt(fixtureId));
  const books = ctx.agents.map((a) => bookPda(arena, a.publicKey));
  const [arenaInfo, b0, b1, matchInfo] = await ctx.connection.getMultipleAccountsInfo([arena, books[0], books[1], match]);
  if (!arenaInfo) {
    await send(
      ctx.connection,
      [
        initializeArenaIx({
          authority: ctx.authority.publicKey,
          seasonId: season,
          startingBankroll: STARTING_BANKROLL,
          txoracleProgram: new PublicKey(TXORACLE_DEVNET),
          scoresRootPrefix: Buffer.from("daily_scores_roots"),
          epochDayWidth: 2,
          rootsDataOffset: 8,
        }),
      ],
      ctx.authority,
    );
  }
  for (const [i, agent] of ctx.agents.entries()) {
    if ((i === 0 ? b0 : b1) === null) {
      await send(ctx.connection, [registerAgentIx({ authority: agent.publicKey, arena, strategyTag: i === 0 ? "follow" : "fade" })], agent);
    }
  }
  if (!matchInfo) {
    await send(
      ctx.connection,
      [openMatchIx({ authority: ctx.authority.publicKey, arena, fixtureId: BigInt(fixtureId), startTime: BigInt(Math.floor(Date.now() / 1000)) })],
      ctx.authority,
    );
  }
}

const tolerate = (e: unknown, ...needles: string[]): void => {
  const msg = String(e);
  if (!needles.some((n) => msg.includes(n))) throw e;
};

export interface ExecOutcome {
  season: number;
  dryRun: boolean;
  opened: number;
  settled: number;
  settledMatch: boolean;
  skipped: string | null;
}

/**
 * Runs one armed calibration for one fixture. Reads which positions already
 * exist, opens the rest, and settles once a final score is known. Every
 * failure that means "someone else already did this" is tolerated; anything
 * else propagates so the tick reports it.
 */
export async function runArmed(
  ctx: ChainCtx | null,
  fixtureId: number,
  payloads: OddsPayload[],
  finalScore: { HomeScore: number; AwayScore: number } | null,
  cal: ArmedCal,
  env: Record<string, string | undefined> = process.env,
): Promise<ExecOutcome> {
  const season = BigInt(cal.season);
  const arena = arenaPda(season);
  const match = matchPda(arena, BigInt(fixtureId));

  if (!ctx) {
    const plan = planTrades(fixtureId, payloads, finalScore, cal, []);
    return { season: cal.season, dryRun: true, opened: plan.toOpen.length, settled: plan.settle ? plan.decisions.length : 0, settledMatch: plan.settle, skipped: null };
  }

  const books = ctx.agents.map((a) => bookPda(arena, a.publicKey));
  const preview = planTrades(fixtureId, payloads, finalScore, cal, []);
  if (preview.decisions.length === 0) {
    // No steam at this calibration: no arena rent is spent on it at all.
    return { season: cal.season, dryRun: false, opened: 0, settled: 0, settledMatch: false, skipped: "no decisions" };
  }

  const posPdas = preview.decisions.map((d) => positionPda(match, books[d.agent], BigInt(d.signalSeq)));
  const infos = await ctx.connection.getMultipleAccountsInfo(posPdas);
  const plan = planTrades(fixtureId, payloads, finalScore, cal, infos.map((i) => i !== null));
  if (plan.toOpen.length === 0 && !plan.settle) {
    return { season: cal.season, dryRun: false, opened: 0, settled: 0, settledMatch: false, skipped: "up to date" };
  }

  const floor = await checkSolFloor(ctx.connection, [ctx.authority.publicKey, ...ctx.agents.map((a) => a.publicKey)], floorSolFromEnv(env));
  if (!floor.ok) {
    return { season: cal.season, dryRun: false, opened: 0, settled: 0, settledMatch: false, skipped: `sol floor: ${floor.reason}` };
  }

  await bootstrapArena(ctx, cal.season, fixtureId);

  let opened = 0;
  for (const i of plan.toOpen) {
    const d = plan.decisions[i];
    try {
      await send(
        ctx.connection,
        [
          openPositionIx({
            authority: ctx.agents[d.agent].publicKey,
            book: books[d.agent],
            game: match,
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
        ctx.agents[d.agent],
      );
      opened++;
    } catch (e) {
      // A racing tick already created this position; the PDA is the lock.
      tolerate(e, "already in use", "custom program error: 0x0");
    }
  }

  let settledMatch = false;
  let settled = 0;
  if (plan.settle && finalScore) {
    try {
      await send(
        ctx.connection,
        [
          settleMatchIx({
            authority: ctx.authority.publicKey,
            arena,
            game: match,
            fixtureId: BigInt(fixtureId),
            homeScore: finalScore.HomeScore,
            awayScore: finalScore.AwayScore,
            settledOutcome: outcomeCode(resultToOutcomeName(outcomeFromScore(finalScore.HomeScore, finalScore.AwayScore))),
            scoreProofRef: scoreProofRef(fixtureId, finalScore.HomeScore, finalScore.AwayScore),
          }),
        ],
        ctx.authority,
      );
      settledMatch = true;
    } catch (e) {
      tolerate(e, "MatchNotOpen", "0x177");
    }
    for (let i = 0; i < plan.decisions.length; i++) {
      try {
        await send(ctx.connection, [settlePositionIx({ game: match, position: posPdas[i], book: books[plan.decisions[i].agent] })], ctx.authority);
        settled++;
      } catch (e) {
        tolerate(e, "PositionAlreadySettled", "0x17");
      }
    }
  }

  return { season: cal.season, dryRun: false, opened, settled, settledMatch, skipped: null };
}
