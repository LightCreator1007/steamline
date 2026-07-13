// Vercel serverless executor for the PUBLIC devnet arena (season 777).
// GET  /api/run?fixture=<id>  -> canonical run status, reconstructed from chain
// POST /api/run?fixture=<id>  -> execute the canonical run once (PDAs are the lock)
// Keys come from env vars (dedicated web keypairs, never the main deployer).
import { createHash } from "node:crypto";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { analyzeFixture, type AnalyzedDecision } from "../packages/agent/analyze.ts";
import {
  arenaPda,
  bookPda,
  matchPda,
  openPositionIx,
  positionPda,
  send,
  settleMatchIx,
  settlePositionIx,
} from "../packages/agent/client.ts";

const SEASON = 777n;

function envKeypair(name: string): Keypair {
  const raw = process.env[name];
  if (!raw) throw new Error(`missing env ${name}`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

function sha256(s: string): Uint8Array {
  return createHash("sha256").update(s).digest();
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

    const rpc = process.env.RPC_URL ?? "https://api.devnet.solana.com";
    const connection = new Connection(rpc, "confirmed");
    const authority = envKeypair("WEB_AUTHORITY_KEYPAIR");
    const follow = envKeypair("WEB_FOLLOW_KEYPAIR");
    const fade = envKeypair("WEB_FADE_KEYPAIR");
    const agents = [follow, fade];

    const arena = arenaPda(SEASON);
    const match = matchPda(arena, BigInt(fixtureId));
    const books = [bookPda(arena, follow.publicKey), bookPda(arena, fade.publicKey)];

    const payloads = await fetchJsonl(`${origin}/data/${fixtureId}/odds.jsonl`);
    const scores = await fetchJsonl(`${origin}/data/${fixtureId}/scores.jsonl`);
    const finalScore = scores[0] ?? null;
    const cal = game.cal ?? { theta: 0.01, edgeMin: 0.005 };
    const analysis = analyzeFixture(fixtureId, payloads, finalScore, cal);
    const decisions = analysis.decisions;
    console.log("stage:analysis-ok", decisions.length);

    const posPdas = decisions.map((d) => positionPda(match, books[d.agent], BigInt(d.signalSeq)));
    const infos = posPdas.length ? await connection.getMultipleAccountsInfo(posPdas) : [];
    console.log("stage:chain-read-ok", infos.length);
    const allExist = infos.length > 0 && infos.every((i) => i !== null);

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
                outcome: { "1": 0, X: 1, "2": 2 }[d.outcome] ?? 255,
                stakePoints: BigInt(d.stake),
                entryOddsMilli: d.entryOddsMilli,
                edgeBps: d.edgeBps,
                oddsMsgRef: sha256(d.messageId),
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
        const outcome = finalScore.HomeScore > finalScore.AwayScore ? 0 : finalScore.HomeScore < finalScore.AwayScore ? 2 : 1;
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
                scoreProofRef: sha256(`score:${fixtureId}:${finalScore.HomeScore}-${finalScore.AwayScore}`),
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
      season: SEASON.toString(),
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
