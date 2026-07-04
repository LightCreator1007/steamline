import { test } from "node:test";
import assert from "node:assert/strict";
import { outcomeFromScore, resultToOutcomeName, settlePosition } from "./settle.ts";
import { type PositionRecord } from "./model.ts";

function pos(outcome: string, stake = 30000, odds = 1.95): PositionRecord {
  return {
    agentId: 0, fixtureId: 1, signalSeq: 0, outcome, stakePoints: stake,
    entryOdds: odds, belief: 0.55, status: "open", payoutPoints: 0,
  };
}

test("outcomeFromScore maps regulation score to 1X2", () => {
  assert.equal(outcomeFromScore(2, 1), "home");
  assert.equal(outcomeFromScore(1, 1), "draw");
  assert.equal(outcomeFromScore(0, 2), "away");
});

test("a 1-1 match decided in extra time still settles as a draw at regulation", () => {
  // Caller passes regulation score 1-1; the ET winner is irrelevant here.
  assert.equal(resultToOutcomeName(outcomeFromScore(1, 1)), "X");
});

test("winning position pays round(stake*odds) and books the profit", () => {
  const r = settlePosition(pos("1", 30000, 1.95), "home");
  assert.equal(r.status, "won");
  assert.equal(r.payout, Math.round(30000 * 1.95)); // 58500
  assert.equal(r.pnl, r.payout - 30000);
});

test("losing position books minus the stake", () => {
  const r = settlePosition(pos("1"), "away");
  assert.equal(r.status, "lost");
  assert.equal(r.payout, 0);
  assert.equal(r.pnl, -30000);
});

test("payout parity with the on-chain milli formula", () => {
  const stake = 12345;
  const oddsMilli = 2137; // 2.137
  const onChain = Math.round((stake * oddsMilli) / 1000);
  const r = settlePosition(pos("1", stake, oddsMilli / 1000), "home");
  assert.equal(r.payout, onChain);
});
