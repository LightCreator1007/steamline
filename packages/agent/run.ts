// Steamline autonomous agent: replay a recorded odds fixture through the
// deterministic engine, trade every steam signal with the follow and fade
// books on the devnet arena, settle on the regulation score, and print the
// leaderboard with on-chain vs engine parity.
// Usage: node --experimental-strip-types packages/agent/run.ts fixtures/demo-901 [fixtureId]
// Env: DRY_RUN=1 skips all chain calls; DEMO_TICK_MS paces the replay (default 1200).
import { writeFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { defaultConfig, type OddsPayload, type Outcome } from "../engine/model.ts";
import { resultToOutcomeName } from "../engine/settle.ts";
import { standing, renderMarkdown } from "../engine/report.ts";
import { replaySource } from "../feed/replaySource.ts";
import { analyzeFixture, type AnalyzedDecision } from "./analyze.ts";
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

const ROOT = new URL("../..", import.meta.url).pathname;
const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const DRY = process.env.DRY_RUN === "1";
const TICK_MS = Number(process.env.DEMO_TICK_MS ?? 1200);
const SEASON_ID = BigInt(process.env.SEASON ?? "2026");

const fixtureDir = process.argv[2] ?? "fixtures/demo-901";
const fixtureId = Number(process.argv[3] ?? fixtureDir.match(/(\d+)\/?$/)?.[1] ?? 901);

// THETA and EDGE_MIN env overrides calibrate for quiet demo windows and
// TxLINE's demargined stable line (no vig cushion); production defaults stay
// 0.03 / 0.02.
const cfg = {
  ...defaultConfig,
  theta: Number(process.env.THETA ?? defaultConfig.theta),
  edgeMin: Number(process.env.EDGE_MIN ?? defaultConfig.edgeMin),
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function fmtProbs(outcomes: Outcome[]): string {
  return outcomes.map((o) => `${o.name}=${o.decimalOdds.toFixed(2)} (${(o.fairProb * 100).toFixed(1)}%)`).join("  ");
}

interface OpenPos {
  d: AnalyzedDecision;
  address?: PublicKey;
  openTx?: string;
  settleTx?: string;
}

async function main(): Promise<void> {
  console.log(`steamline replay: ${fixtureDir} (fixture ${fixtureId})${DRY ? " [DRY RUN, no chain]" : ""}`);

  const connection = DRY ? null : new Connection(RPC, "confirmed");
  const deployer = DRY ? null : loadKeypair(`${ROOT}keypairs/deployer.json`);
  const agents: Keypair[] = DRY
    ? []
    : [loadKeypair(`${ROOT}keypairs/agent-follow.json`), loadKeypair(`${ROOT}keypairs/agent-fade.json`)];
  const arena = arenaPda(SEASON_ID);
  const game = matchPda(arena, BigInt(fixtureId));
  const books = DRY ? [] : agents.map((a) => bookPda(arena, a.publicKey));

  // AgentBook layout: 8 disc + 32 arena + 32 authority + 16 tag, then
  // bankroll u64, staked u64, pnl i64, opened u32, won u32, lost u32.
  async function readBook(pk: PublicKey): Promise<{ bankroll: bigint; pnl: bigint; won: number; lost: number } | null> {
    const info = await connection!.getAccountInfo(pk);
    if (!info) return null;
    const d = info.data;
    return { bankroll: d.readBigUInt64LE(88), pnl: d.readBigInt64LE(104), won: d.readUInt32LE(116), lost: d.readUInt32LE(120) };
  }
  // Books persist across matches; parity compares this run's deltas.
  const startBooks = DRY ? [] : await Promise.all(books.map((b) => readBook(b)));

  const payloads: OddsPayload[] = [];
  let scorePayload: { HomeScore?: number; AwayScore?: number } | null = null;
  for await (const ev of replaySource(`${ROOT}${fixtureDir}`).events()) {
    if (ev.kind === "odds") payloads.push(ev.payload);
    else scorePayload ??= ev.payload;
  }
  const score = scorePayload
    ? { HomeScore: Number(scorePayload.HomeScore ?? 0), AwayScore: Number(scorePayload.AwayScore ?? 0) }
    : null;

  const analysis = analyzeFixture(fixtureId, payloads, score, { theta: cfg.theta, edgeMin: cfg.edgeMin });
  const openPositions: OpenPos[] = [];
  let settleMatchTx: string | undefined;
  let finalScore: { home: number; away: number; outcome: string } | undefined;

  for (const t of analysis.trace) {
    console.log(`tick ${t.tick.messageId}  ${fmtProbs(t.tick.outcomes)}`);
    let signalled = false;
    for (const ev of t.events) {
      if (ev.kind === "signal") {
        signalled = true;
        const sig = ev.signal;
        console.log(
          `\n*** STEAM on outcome "${sig.outcome}": ${(sig.preProb * 100).toFixed(1)}% -> ${(sig.postProb * 100).toFixed(1)}% ` +
            `(delta ${(sig.magnitude * 100).toFixed(1)}pp, ${sig.method}) ***`,
        );
      } else if (ev.kind === "hold") {
        const name = ev.agent === 0 ? "follow" : "fade";
        console.log(`${name}: HOLD (${ev.reason === "no-edge" ? "no positive edge" : "stake sized to zero"})`);
      } else {
        const d = ev.decision;
        const name = d.agent === 0 ? "follow" : "fade";
        const pos: OpenPos = { d };
        openPositions.push(pos);
        console.log(
          `${name}: BACK "${d.outcome}" at ${d.entryOdds.toFixed(2)}, ` +
            `stake ${d.stake.toLocaleString()} pts (edge ${(d.edge * 100).toFixed(1)}%, belief ${(d.belief * 100).toFixed(1)}%)`,
        );
        if (!DRY) {
          pos.address = positionPda(game, books[d.agent], BigInt(d.signalSeq));
          const txSig = await send(
            connection!,
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
          );
          pos.openTx = txSig;
          console.log(`${name}: open_position tx ${explorer(txSig)}`);
        }
      }
    }
    if (signalled) console.log("");
    await sleep(TICK_MS);
  }

  if (score && analysis.result) {
    const result = analysis.result;
    finalScore = { home: score.HomeScore, away: score.AwayScore, outcome: result };
    console.log(`\n=== regulation final: ${score.HomeScore}-${score.AwayScore} (${result}) ===`);

    if (!DRY) {
      const txSig = await send(
        connection!,
        [
          settleMatchIx({
            authority: deployer!.publicKey,
            arena,
            game,
            fixtureId: BigInt(fixtureId),
            homeScore: score.HomeScore,
            awayScore: score.AwayScore,
            settledOutcome: outcomeCode(resultToOutcomeName(result)),
            scoreProofRef: scoreProofRef(fixtureId, score.HomeScore, score.AwayScore),
          }),
        ],
        deployer!,
      );
      settleMatchTx = txSig;
      console.log(`settle_match tx ${explorer(txSig)}`);
    }

    for (const pos of openPositions) {
      const d = pos.d;
      const name = d.agent === 0 ? "follow" : "fade";
      console.log(
        `${name}: "${d.outcome}" ${d.status.toUpperCase()}, payout ${d.payout.toLocaleString()}, pnl ${(d.payout - d.stake).toLocaleString()}`,
      );
      if (!DRY && pos.address) {
        const txSig = await send(
          connection!,
          [settlePositionIx({ game, position: pos.address, book: books[d.agent] })],
          deployer!,
        );
        pos.settleTx = txSig;
        console.log(`${name}: settle_position tx ${explorer(txSig)}`);
      }
    }
  }

  console.log("\n=== leaderboard (engine replay) ===");
  console.log(renderMarkdown(analysis.books.map((b) => standing(b))));

  // Snapshot for the hosted dashboard: everything a judge needs to inspect
  // the run without the terminal.
  const state = {
    generatedAt: new Date().toISOString(),
    network: DRY ? "dry-run" : "devnet",
    matchLabel: process.env.MATCH_LABEL ?? `fixture ${fixtureId}`,
    season: SEASON_ID.toString(),
    fixtureId,
    programId: "E9jfScHBJRB2NyB2NFmE4Kec9D8hJ1X7k24AXufRbX5n",
    arena: arena.toBase58(),
    match: game.toBase58(),
    books: DRY ? [] : books.map((b, i) => ({ agent: i === 0 ? "follow" : "fade", address: b.toBase58() })),
    outcomes: ["1", "X", "2"],
    tape: analysis.trace.map((t) => ({ ts: t.tick.ts, probs: t.tick.outcomes.map((o) => Number(o.fairProb.toFixed(4))) })),
    signals: analysis.signals.map((s) => ({ ts: s.ts, outcome: s.outcome, preProb: s.preProb, postProb: s.postProb, seq: s.seq })),
    positions: openPositions.map((p) => ({
      agent: p.d.agent === 0 ? "follow" : "fade",
      outcome: p.d.outcome,
      entryOdds: p.d.entryOdds,
      stake: p.d.stake,
      status: p.d.status,
      payout: p.d.payout,
      signalSeq: p.d.signalSeq,
      openTx: p.openTx ?? null,
      settleTx: p.settleTx ?? null,
    })),
    finalScore: finalScore ?? null,
    settleMatchTx: settleMatchTx ?? null,
    standings: analysis.books.map((b) => standing(b)),
    config: { theta: cfg.theta, edgeMin: cfg.edgeMin, windowTicks: cfg.windowTicks, startingBankroll: cfg.startingBankroll },
  };
  writeFileSync(`${ROOT}dashboard/state.json`, JSON.stringify(state, null, 1));
  console.log("dashboard state written to dashboard/state.json");

  if (!DRY) {
    console.log("\n=== on-chain vs engine parity (this run's deltas) ===");
    for (let agentId = 0; agentId < 2; agentId++) {
      const name = agentId === 0 ? "follow" : "fade";
      const end = await readBook(books[agentId]);
      const start = startBooks[agentId];
      if (!end || !start) {
        console.log(`${name}: book MISSING on-chain`);
        continue;
      }
      const local = analysis.books[agentId];
      const dBankroll = end.bankroll - start.bankroll;
      const dPnl = end.pnl - start.pnl;
      const engBankroll = BigInt(local.bankrollPoints - cfg.startingBankroll);
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
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
