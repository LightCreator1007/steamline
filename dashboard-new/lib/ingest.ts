// One stateless tick of ingestion: canonicalize an odds snapshot with the
// exact transform the laptop driver uses, keep only what is genuinely new,
// and append it to durable storage. The accumulated prefix stays append-only
// and monotonic in Ts, which is what makes analyzeFixture's signal seqs
// stable across invocations, which is what makes position PDAs idempotent.
import type { OddsPayload } from "../../packages/engine/model.ts";
import { canonicalOdds, regulationScore } from "../../packages/agent/live.ts";
import { makeClient, type ScoreEvent, type TxlineClient } from "../../packages/feed/txlineClient.ts";
import { loadEnv, type Network } from "../../packages/feed/env.ts";
import { type Store, WATCH_KEY } from "./store/index.ts";

/**
 * TxLINE client from env only. Credentials never come off disk here: the
 * cron runs on a platform with no keypairs/ directory.
 * Env: TXLINE_NETWORK (default devnet), TXLINE_JWT_DEVNET, TXLINE_API_TOKEN_DEVNET.
 */
export function feedClient(env: Record<string, string | undefined> = process.env): TxlineClient {
  const e = loadEnv(env, (env.TXLINE_NETWORK as Network) ?? "devnet");
  return makeClient({ apiBase: e.apiBase, jwt: e.jwt, apiToken: e.apiToken });
}

export const MIN_GAP_MS = 60_000;
/** How long before kickoff the agent starts watching a fixture. */
export const WINDOW_MS = 6 * 3_600_000;
/** How long after kickoff to keep asking for a final score before giving up. */
export const DEADLINE_MS = 6 * 3_600_000;

export interface Watch {
  fixtureId: number;
  home: string;
  away: string;
  kickoffMs: number;
  /** Slider units, as armed by default for this fixture. */
  pinnedThetaPp: number;
  pinnedEdgePct: number;
  lastTs: number;
  lastTickMs: number;
  ticks: number;
  finalScore: { HomeScore: number; AwayScore: number } | null;
  settled: boolean;
}

/** Nothing crossing a trust boundary is assumed; every field is checked. */
export function parseWatch(raw: string): Watch | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const w = v as Partial<Watch>;
  if (!Number.isFinite(w.fixtureId) || !Number.isFinite(w.kickoffMs)) return null;
  if (!Number.isFinite(w.pinnedThetaPp) || !Number.isFinite(w.pinnedEdgePct)) return null;
  const fs = w.finalScore;
  const finalScore =
    fs && Number.isFinite(fs.HomeScore) && Number.isFinite(fs.AwayScore)
      ? { HomeScore: Number(fs.HomeScore), AwayScore: Number(fs.AwayScore) }
      : null;
  return {
    fixtureId: Number(w.fixtureId),
    home: typeof w.home === "string" ? w.home : "",
    away: typeof w.away === "string" ? w.away : "",
    kickoffMs: Number(w.kickoffMs),
    pinnedThetaPp: Number(w.pinnedThetaPp),
    pinnedEdgePct: Number(w.pinnedEdgePct),
    lastTs: Number.isFinite(w.lastTs) ? Number(w.lastTs) : 0,
    lastTickMs: Number.isFinite(w.lastTickMs) ? Number(w.lastTickMs) : 0,
    ticks: Number.isFinite(w.ticks) ? Number(w.ticks) : 0,
    finalScore,
    settled: w.settled === true,
  };
}

export async function readWatches(store: Store): Promise<Watch[]> {
  const all = await store.hgetall(WATCH_KEY);
  const out: Watch[] = [];
  for (const raw of Object.values(all)) {
    const w = parseWatch(raw);
    if (w) out.push(w);
  }
  return out;
}

export async function writeWatch(store: Store, w: Watch): Promise<void> {
  await store.hset(WATCH_KEY, String(w.fixtureId), JSON.stringify(w));
}

/** A fixture is due for a tick from six hours out until a final score lands. */
export function inWindow(w: Watch, nowMs: number): boolean {
  if (w.finalScore) return false;
  return nowMs >= w.kickoffMs - WINDOW_MS && nowMs <= w.kickoffMs + DEADLINE_MS;
}

/** Stored JSON lines back to payloads, dropping anything unreadable. */
export function parsePayloads(lines: string[]): OddsPayload[] {
  const out: OddsPayload[] = [];
  for (const line of lines) {
    try {
      const p: unknown = JSON.parse(line);
      if (p && typeof p === "object" && Number.isFinite((p as OddsPayload).Ts)) out.push(p as OddsPayload);
    } catch {
      // A single corrupt line must not poison the whole replay.
    }
  }
  return out;
}

export interface SelectOpts {
  lastTs: number;
  kickoffMs: number;
  minGapMs?: number;
}

/**
 * The accept rule from packages/agent/live.ts, applied to a snapshot instead
 * of a stream: canonicalize, sort by Ts (a snapshot has no arrival order),
 * then keep only payloads at least minGap past the last accepted one and
 * strictly before kickoff.
 */
export function selectNewTicks(snapshot: unknown[], o: SelectOpts): OddsPayload[] {
  const minGap = o.minGapMs ?? MIN_GAP_MS;
  const candidates: OddsPayload[] = [];
  for (const raw of snapshot) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as OddsPayload;
    if (!Number.isFinite(p.Ts)) continue;
    const c = canonicalOdds(p);
    if (c) candidates.push(c);
  }
  candidates.sort((a, b) => a.Ts - b.Ts);

  let lastTs = o.lastTs;
  const accepted: OddsPayload[] = [];
  for (const p of candidates) {
    if (p.Ts < lastTs + minGap || p.Ts >= o.kickoffMs) continue;
    lastTs = p.Ts;
    accepted.push(p);
  }
  return accepted;
}

export interface IngestResult {
  accepted: OddsPayload[];
  /** Every payload for the fixture, stored order, ready for analyzeFixture. */
  all: OddsPayload[];
  lastTs: number;
}

/** Append whatever the snapshot adds and hand back the full prefix. */
export async function ingestSnapshot(
  store: Store,
  fixtureId: number,
  snapshot: unknown[],
  o: SelectOpts,
): Promise<IngestResult> {
  const accepted = selectNewTicks(snapshot, o);
  if (accepted.length > 0) {
    await store.appendTicks(
      fixtureId,
      accepted.map((p) => JSON.stringify(p)),
    );
  }
  const all = parsePayloads(await store.readTicks(fixtureId));
  const lastTs = all.length > 0 ? all[all.length - 1].Ts : o.lastTs;
  return { accepted, all, lastTs };
}

/** First regulation final in a scores snapshot, or null while the game runs. */
export function finalFromScores(scores: unknown[]): { HomeScore: number; AwayScore: number } | null {
  for (const ev of scores) {
    if (!ev || typeof ev !== "object") continue;
    const final = regulationScore(ev as ScoreEvent);
    if (final) return final;
  }
  return null;
}
