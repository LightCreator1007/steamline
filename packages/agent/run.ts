// Steamline autonomous agent: replay a recorded odds fixture through the
// deterministic engine, trade every steam signal with the follow and fade
// books on the devnet arena, settle on the regulation score, and print the
// leaderboard with on-chain vs engine parity.
// Usage: node --experimental-strip-types packages/agent/run.ts fixtures/demo-901 [fixtureId]
// Env: DRY_RUN=1 skips all chain calls; DEMO_TICK_MS paces the replay (default 1200).
import { createHash } from "node:crypto";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { defaultConfig, newAgentState, type AgentState, type PositionRecord, type Signal } from "../engine/model.ts";
import { normalizeOdds } from "../engine/normalize.ts";
import { inMemoryLedger } from "../engine/ledger.ts";
import { detectSteam } from "../engine/detect.ts";
import { follow, fade, type Pick } from "../engine/strategy.ts";
import { sizeStake, type SafetyState } from "../engine/stake.ts";
import { settlePosition as settleLocal, outcomeFromScore } from "../engine/settle.ts";
import { applyGrade } from "../engine/grade.ts";
import { standing, renderMarkdown } from "../engine/report.ts";
import { replaySource } from "../feed/replaySource.ts";
import {
  arenaPda,
  bookPda,
  explorer,
  loadKeypair,
  matchPda,
  openPositionIx,
  positionPda,
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

const OUTCOME_CODE: Record<string, number> = { "1": 0, X: 1, "2": 2 };
// THETA and EDGE_MIN env overrides calibrate for quiet demo windows and
// TxLINE's demargined stable line (no vig cushion); production defaults stay
// 0.03 / 0.02.
const cfg = {
  ...defaultConfig,
  theta: Number(process.env.THETA ?? defaultConfig.theta),
  edgeMin: Number(process.env.EDGE_MIN ?? defaultConfig.edgeMin),
};

function sha256(s: string): Uint8Array {
  return createHash("sha256").update(s).digest();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function fmtProbs(outcomes: { name: string; fairProb: number; decimalOdds: number }[]): string {
  return outcomes.map((o) => `${o.name}=${o.decimalOdds.toFixed(2)} (${(o.fairProb * 100).toFixed(1)}%)`).join("  ");
}

interface OpenPos {
  record: PositionRecord;
  pick: Pick;
  address?: PublicKey;
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

  const ledger = inMemoryLedger();
  const bookStates: AgentState[] = [newAgentState(0, cfg.startingBankroll), newAgentState(1, cfg.startingBankroll)];
  const safety: SafetyState = { killed: false, dailyLoss: 0 };
  const signals: Signal[] = [];
  const openPositions: OpenPos[] = [];
  let seq = 0;
  const nextSeq = () => seq++;
  let settled = false;

  for await (const ev of replaySource(`${ROOT}${fixtureDir}`).events()) {
    if (ev.kind === "odds") {
      // Re-key to the CLI fixture id so retakes can use a fresh on-chain match
      // (position PDAs are idempotent per fixture + signal_seq by design).
      ev.payload.FixtureId = fixtureId;
      const tick = normalizeOdds(ev.payload, ev.payload.Ts, cfg);
      ledger.append(tick);
      console.log(`tick ${tick.messageId}  ${fmtProbs(tick.outcomes)}`);

      const sig = detectSteam(ledger, fixtureId, tick.market, cfg, nextSeq, { recentSignals: signals });
      if (sig) {
        signals.push(sig);
        console.log(
          `\n*** STEAM on outcome "${sig.outcome}": ${(sig.preProb * 100).toFixed(1)}% -> ${(sig.postProb * 100).toFixed(1)}% ` +
            `(delta ${(sig.magnitude * 100).toFixed(1)}pp, ${sig.method}) ***`,
        );
        const win = ledger.window(fixtureId, tick.market, cfg.windowTicks + 1);
        const preTick = win[0];
        const picks: (Pick | null)[] = [follow(sig, tick, preTick, cfg), fade(sig, tick, preTick, cfg)];
        for (let agentId = 0 as 0 | 1; agentId < 2; agentId++) {
          const pick = picks[agentId];
          const name = agentId === 0 ? "follow" : "fade";
          if (!pick) {
            console.log(`${name}: HOLD (no positive edge)`);
            continue;
          }
          const openHere = openPositions.filter((p) => p.record.agentId === agentId).length;
          const stake = sizeStake(pick.belief, pick.entryOdds, bookStates[agentId], safety, cfg, openHere);
          if (stake <= 0) {
            console.log(`${name}: HOLD (stake sized to zero)`);
            continue;
          }
          const record: PositionRecord = {
            agentId,
            fixtureId,
            signalSeq: sig.seq,
            outcome: pick.outcome,
            stakePoints: stake,
            entryOdds: pick.entryOdds,
            belief: pick.belief,
            status: "open",
            payoutPoints: 0,
          };
          bookStates[agentId] = {
            ...bookStates[agentId],
            bankrollPoints: bookStates[agentId].bankrollPoints - stake,
            stakedPoints: bookStates[agentId].stakedPoints + stake,
            betsOpened: bookStates[agentId].betsOpened + 1,
          };
          const pos: OpenPos = { record, pick };
          openPositions.push(pos);
          console.log(
            `${name}: BACK "${pick.outcome}" at ${pick.entryOdds.toFixed(2)}, ` +
              `stake ${stake.toLocaleString()} pts (edge ${(pick.edge * 100).toFixed(1)}%, belief ${(pick.belief * 100).toFixed(1)}%)`,
          );
          if (!DRY) {
            pos.address = positionPda(game, books[agentId], BigInt(sig.seq));
            const txSig = await send(
              connection!,
              [
                openPositionIx({
                  authority: agents[agentId].publicKey,
                  book: books[agentId],
                  game,
                  fixtureId: BigInt(fixtureId),
                  outcome: OUTCOME_CODE[pick.outcome],
                  stakePoints: BigInt(stake),
                  entryOddsMilli: Math.round(pick.entryOdds * 1000),
                  edgeBps: Math.round(pick.edge * 10000),
                  oddsMsgRef: sha256(sig.messageId),
                  oddsTs: BigInt(sig.ts),
                  signalSeq: BigInt(sig.seq),
                }),
              ],
              agents[agentId],
            );
            console.log(`${name}: open_position tx ${explorer(txSig)}`);
          }
        }
        console.log("");
      }
      await sleep(TICK_MS);
    } else if (!settled) {
      const home = Number(ev.payload.HomeScore ?? 0);
      const away = Number(ev.payload.AwayScore ?? 0);
      settled = true;
      const result = outcomeFromScore(home, away);
      console.log(`\n=== regulation final: ${home}-${away} (${result}) ===`);

      if (!DRY) {
        const outcomeCode = result === "home" ? 0 : result === "away" ? 2 : 1;
        const txSig = await send(
          connection!,
          [
            settleMatchIx({
              authority: deployer!.publicKey,
              arena,
              game,
              fixtureId: BigInt(fixtureId),
              homeScore: home,
              awayScore: away,
              settledOutcome: outcomeCode,
              scoreProofRef: sha256(`score:${fixtureId}:${home}-${away}`),
            }),
          ],
          deployer!,
        );
        console.log(`settle_match tx ${explorer(txSig)}`);
      }

      for (const pos of openPositions) {
        const r = settleLocal(pos.record, result);
        const hit: 0 | 1 = r.status === "won" ? 1 : 0;
        const agentId = pos.record.agentId;
        bookStates[agentId] = applyGrade(
          {
            ...bookStates[agentId],
            bankrollPoints: bookStates[agentId].bankrollPoints + r.payout,
            stakedPoints: bookStates[agentId].stakedPoints - pos.record.stakePoints,
          },
          pos.record.belief,
          hit,
          r.pnl,
        );
        pos.record.status = r.status;
        pos.record.payoutPoints = r.payout;
        const name = agentId === 0 ? "follow" : "fade";
        console.log(
          `${name}: "${pos.record.outcome}" ${r.status.toUpperCase()}, payout ${r.payout.toLocaleString()}, pnl ${r.pnl.toLocaleString()}`,
        );
        if (!DRY && pos.address) {
          const txSig = await send(
            connection!,
            [settlePositionIx({ game, position: pos.address, book: books[agentId] })],
            deployer!,
          );
          console.log(`${name}: settle_position tx ${explorer(txSig)}`);
        }
      }
    }
  }

  console.log("\n=== leaderboard (engine replay) ===");
  console.log(renderMarkdown(bookStates.map((b) => standing(b))));

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
      const local = bookStates[agentId];
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
