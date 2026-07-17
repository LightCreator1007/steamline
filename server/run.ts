// Vercel serverless executor for the PUBLIC devnet arena (season 777).
// GET  /api/run?fixture=<id>  -> canonical run status, reconstructed from chain
// POST /api/run?fixture=<id>  -> execute the canonical run once (PDAs are the lock)
// Keys come from env vars (dedicated web keypairs, never the main deployer).
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { outcomeFromScore, resultToOutcomeName } from "../packages/engine/settle.ts";
import { RPC_DEVNET_DEFAULT, TXORACLE_DEVNET } from "../packages/feed/env.ts";
import { analyzeFixture, type AnalyzedDecision } from "../packages/agent/analyze.ts";
import {
  arenaPda,
  bookPda,
  initializeArenaIx,
  matchPda,
  openMatchIx,
  registerAgentIx,
  oddsMsgRef,
  openPositionIx,
  outcomeCode,
  positionPda,
  scoreProofRef,
  send,
  settleMatchIx,
  settlePositionIx,
} from "../packages/agent/client.ts";

const SEASON = 777n;
// Fallback for a game without a pinned cal; every runnable game in games.json
// carries its own, so this is only a safety net.
const DEMO_CAL = { theta: 0.01, edgeMin: 0.005 };
const STARTING_BANKROLL = 1_000_000_000n;

// Calibration-keyed seasons: the sliders are discrete (theta 0.2-3.0pp step
// 0.1, edge 0-2% step 0.1), so each combination maps to its own bounded
// arena. Identical settings = identical season = the same on-chain run for
// every visitor; that is the determinism claim made visible.
function calSeason(thetaPp: string | undefined, edgePct: string | undefined): { season: bigint; cal: { theta: number; edgeMin: number } } | null | "bad" {
  if (thetaPp === undefined && edgePct === undefined) return null;
  const t = Number(thetaPp);
  const e = Number(edgePct);
  const tt = Math.round(t * 10);
  const ee = Math.round(e * 10);
  if (!Number.isFinite(t) || !Number.isFinite(e) || Math.abs(t * 10 - tt) > 1e-6 || Math.abs(e * 10 - ee) > 1e-6) return "bad";
  if (tt < 2 || tt > 30 || ee < 0 || ee > 20) return "bad";
  return { season: BigInt(900000 + tt * 100 + ee), cal: { theta: tt / 1000, edgeMin: ee / 1000 } };
}

// ponytail: per-instance memory limiter; a cold start resets it and parallel
// instances each get their own budget. Enough to stop naive slider scripting;
// upgrade to a shared KV bucket if it ever matters.
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((ts) => now - ts < 60_000);
  list.push(now);
  hits.set(ip, list);
  let total = 0;
  for (const l of hits.values()) total += l.length;
  return list.length > 3 || total > 20;
}

function envKeypair(name: string): Keypair {
  const raw = process.env[name];
  if (!raw) throw new Error(`missing env ${name}`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return (await res.json()) as T;
}

async function fetchJsonl(url: string): Promise<any[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

export default async function handler(req: any, res: any): Promise<void> {
  try {
    const fixtureId = Number(req.query.fixture);
    const origin = `https://${req.headers.host}`;
    console.log("stage:games", origin, fixtureId);
    const games = await fetchJson<any[]>(`${origin}/data/games.json`);
    console.log("stage:games-ok", games.length);
    const game = games.find((g) => g.id === fixtureId && !g.live);
    if (!game) {
      res.status(404).json({ error: "unknown or live fixture" });
      return;
    }

    const rpc = process.env.RPC_URL ?? RPC_DEVNET_DEFAULT;
    const connection = new Connection(rpc, "confirmed");
    const authority = envKeypair("WEB_AUTHORITY_KEYPAIR");
    const follow = envKeypair("WEB_FOLLOW_KEYPAIR");
    const fade = envKeypair("WEB_FADE_KEYPAIR");
    const agents = [follow, fade];

    const keyed = calSeason(req.query.theta, req.query.edge);
    if (keyed === "bad") {
      res.status(400).json({ error: "calibration off the slider grid" });
      return;
    }
    const season = keyed ? keyed.season : SEASON;
    const arena = arenaPda(season);
    const match = matchPda(arena, BigInt(fixtureId));
    const books = [bookPda(arena, follow.publicKey), bookPda(arena, fade.publicKey)];

    const payloads = await fetchJsonl(`${origin}/data/${fixtureId}/odds.jsonl`);
    const scores = await fetchJsonl(`${origin}/data/${fixtureId}/scores.jsonl`);
    const finalScore = scores[0] ?? null;
    const cal = keyed ? keyed.cal : (game.cal ?? DEMO_CAL);
    const analysis = analyzeFixture(fixtureId, payloads, finalScore, cal);
    const decisions = analysis.decisions;
    console.log("stage:analysis-ok", decisions.length);

    const posPdas = decisions.map((d) => positionPda(match, books[d.agent], BigInt(d.signalSeq)));
    const infos = posPdas.length ? await connection.getMultipleAccountsInfo(posPdas) : [];
    console.log("stage:chain-read-ok", infos.length);
    const allExist = infos.length > 0 && infos.every((i) => i !== null);

    // A calibration-keyed POST may land in an arena that does not exist yet:
    // bootstrap it on demand (arena, both books, the match), idempotently.
    // Only when the calibration actually trades, so no rent is spent on
    // no-steam combinations.
    if (req.method === "POST" && keyed && decisions.length > 0 && !allExist) {
      const ip = String(req.headers["x-forwarded-for"] ?? "unknown").split(",")[0].trim();
      if (rateLimited(ip)) {
        res.status(429).json({ error: "rate limited; try again in a minute" });
        return;
      }
      const [arenaInfo, b0, b1, matchInfo] = await connection.getMultipleAccountsInfo([arena, books[0], books[1], match]);
      if (!arenaInfo) {
        await send(
          connection,
          [
            initializeArenaIx({
              authority: authority.publicKey,
              seasonId: season,
              startingBankroll: STARTING_BANKROLL,
              txoracleProgram: new PublicKey(TXORACLE_DEVNET),
              scoresRootPrefix: Buffer.from("daily_scores_roots"),
              epochDayWidth: 2,
              rootsDataOffset: 8,
            }),
          ],
          authority,
        );
        console.log("stage:cal-arena-init", season.toString());
      }
      for (const [i, agent] of agents.entries()) {
        if (!(i === 0 ? b0 : b1)) {
          await send(connection, [registerAgentIx({ authority: agent.publicKey, arena, strategyTag: i === 0 ? "follow" : "fade" })], agent);
        }
      }
      if (!matchInfo) {
        await send(
          connection,
          [openMatchIx({ authority: authority.publicKey, arena, fixtureId: BigInt(fixtureId), startTime: BigInt(Math.floor(Date.now() / 1000)) })],
          authority,
        );
      }
    }

    if (req.method === "POST" && !allExist && decisions.length > 0) {
      for (let i = 0; i < decisions.length; i++) {
        if (infos[i]) continue;
        const d = decisions[i];
        try {
          await send(
            connection,
            [
              openPositionIx({
                authority: agents[d.agent].publicKey,
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
            agents[d.agent],
          );
        } catch (e) {
          // A racing run already created this position; the PDA is the lock.
          if (!String(e).includes("already in use") && !String(e).includes("custom program error: 0x0")) throw e;
        }
      }
      if (finalScore) {
        const outcome = outcomeCode(resultToOutcomeName(outcomeFromScore(finalScore.HomeScore, finalScore.AwayScore)));
        try {
          await send(
            connection,
            [
              settleMatchIx({
                authority: authority.publicKey,
                arena,
                game: match,
                fixtureId: BigInt(fixtureId),
                homeScore: finalScore.HomeScore,
                awayScore: finalScore.AwayScore,
                settledOutcome: outcome,
                scoreProofRef: scoreProofRef(fixtureId, finalScore.HomeScore, finalScore.AwayScore),
              }),
            ],
            authority,
          );
        } catch (e) {
          if (!String(e).includes("MatchNotOpen") && !String(e).includes("0x177")) throw e;
        }
        for (let i = 0; i < decisions.length; i++) {
          try {
            await send(
              connection,
              [settlePositionIx({ game: match, position: posPdas[i], book: books[decisions[i].agent] })],
              authority,
            );
          } catch (e) {
            if (!String(e).includes("PositionAlreadySettled") && !String(e).includes("0x17")) throw e;
          }
        }
      }
    }

    // Reconstruct status from chain: existence + signatures per position.
    const finalInfos = posPdas.length ? await connection.getMultipleAccountsInfo(posPdas) : [];
    const positions: any[] = [];
    for (let i = 0; i < decisions.length; i++) {
      const d: AnalyzedDecision = decisions[i];
      let openTx: string | null = null;
      let settleTx: string | null = null;
      if (finalInfos[i]) {
        const sigs = await connection.getSignaturesForAddress(posPdas[i], { limit: 10 });
        openTx = sigs[sigs.length - 1]?.signature ?? null;
        settleTx = sigs.length > 1 ? sigs[0].signature : null;
      }
      positions.push({
        agent: d.agent === 0 ? "follow" : "fade",
        signalSeq: d.signalSeq,
        outcome: d.outcome,
        entryOdds: d.entryOdds,
        stake: d.stake,
        status: d.status,
        payout: d.payout,
        address: posPdas[i].toBase58(),
        onChain: finalInfos[i] !== null,
        openTx,
        settleTx,
      });
    }

    res.status(200).json({
      season: season.toString(),
      calKeyed: keyed !== null,
      fixtureId,
      calibration: cal,
      noSteam: decisions.length === 0,
      ran: decisions.length > 0 && finalInfos.every((i) => i !== null),
      arena: arena.toBase58(),
      match: match.toBase58(),
      books: [
        { agent: "follow", address: books[0].toBase58() },
        { agent: "fade", address: books[1].toBase58() },
      ],
      positions,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
}
