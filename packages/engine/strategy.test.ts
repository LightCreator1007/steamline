import { test } from "node:test";
import assert from "node:assert/strict";
import { follow, fade } from "./strategy.ts";
import { defaultConfig, type OddsTick, type Signal } from "./model.ts";

function mkTick(probs: Record<string, number>): OddsTick {
  return {
    fixtureId: 1, messageId: "m", ts: 0, market: "1X2",
    inRunning: false, source: "StablePrice", staleMs: 0,
    outcomes: Object.entries(probs).map(([name, p]) => ({
      name, decimalOdds: 1 / p, rawImplied: p, fairProb: p,
    })),
  };
}

const sig: Signal = {
  fixtureId: 1, market: "1X2", seq: 0, outcome: "1", direction: 1,
  magnitude: 0.06, preProb: 0.40, postProb: 0.46, ts: 0, messageId: "m", method: "fixed",
};

test("follow backs the steamed outcome and extrapolates the move", () => {
  const pre = mkTick({ "1": 0.40, X: 0.30, "2": 0.30 });
  const cur = mkTick({ "1": 0.46, X: 0.27, "2": 0.27 });
  const pick = follow(sig, cur, pre, defaultConfig);
  assert.ok(pick);
  assert.equal(pick!.outcome, "1");
  // belief = 0.46 + 0.5*(0.06) = 0.49; edge = 0.49*(1/0.46) - 1 > 0
  assert.ok(pick!.belief > 0.48 && pick!.belief < 0.50);
  assert.ok(pick!.edge >= defaultConfig.edgeMin);
});

test("fade picks the highest positive-EV non-steamed outcome, not just the biggest drop", () => {
  // X fell less than 2 in probability, but its post odds give a better EV under reversion.
  const pre = mkTick({ "1": 0.40, X: 0.33, "2": 0.27 });
  const cur = mkTick({ "1": 0.46, X: 0.31, "2": 0.23 });
  const pick = fade(sig, cur, pre, defaultConfig);
  assert.ok(pick);
  assert.notEqual(pick!.outcome, "1"); // never the steamed side
  // EV_X = 0.33*(1/0.31)-1 = 0.0645 ; EV_2 = 0.27*(1/0.23)-1 = 0.1739 -> picks "2"
  assert.equal(pick!.outcome, "2");
  assert.ok(pick!.edge >= defaultConfig.edgeMin);
});

test("follow returns null when edge is below edge_min", () => {
  const pre = mkTick({ "1": 0.40, X: 0.30, "2": 0.30 });
  const cur = mkTick({ "1": 0.405, X: 0.2975, "2": 0.2975 });
  const flat: Signal = { ...sig, preProb: 0.40, postProb: 0.405, magnitude: 0.005 };
  assert.equal(follow(flat, cur, pre, defaultConfig), null);
});
