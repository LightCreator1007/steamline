import { test } from "node:test";
import assert from "node:assert/strict";
import { kellyFraction, sizeStake, type SafetyState } from "./stake.ts";
import { defaultConfig, newAgentState } from "./model.ts";

const open: SafetyState = { killed: false, dailyLoss: 0 };

test("kellyFraction matches the decimal-odds Kelly formula", () => {
  // p=0.5, d=2.2 -> (0.5*2.2 - 1)/(2.2 - 1) = 0.1/1.2 = 0.08333
  assert.ok(Math.abs(kellyFraction(0.5, 2.2) - 0.083333) < 1e-4);
});

test("kellyFraction floors at 0 for negative edge", () => {
  assert.equal(kellyFraction(0.4, 2.0), 0);
});

test("sizeStake applies fractional Kelly and integer floor", () => {
  const book = newAgentState(0, 1_000_000_000);
  // f = 0.08333, fractional 0.25 -> 0.020833 * 1e9 = 20,833,333
  const stake = sizeStake(0.5, 2.2, book, open, defaultConfig);
  assert.equal(stake, Math.floor(0.25 * kellyFraction(0.5, 2.2) * 1_000_000_000));
});

test("sizeStake respects the per-market cap", () => {
  const book = newAgentState(0, 1_000_000_000);
  const cfg = { ...defaultConfig, maxStakePerMarket: 1000 };
  assert.equal(sizeStake(0.6, 3.0, book, open, cfg), 1000);
});

test("kill switch and daily loss stop force zero", () => {
  const book = newAgentState(0, 1_000_000_000);
  assert.equal(sizeStake(0.6, 3.0, book, { killed: true, dailyLoss: 0 }, defaultConfig), 0);
  assert.equal(sizeStake(0.6, 3.0, book, { killed: false, dailyLoss: defaultConfig.dailyLossStop }, defaultConfig), 0);
});

test("per-fixture position cap forces zero", () => {
  const book = newAgentState(0, 1_000_000_000);
  assert.ok(sizeStake(0.6, 3.0, book, open, defaultConfig, defaultConfig.maxPositionsPerFixture - 1) > 0);
  assert.equal(sizeStake(0.6, 3.0, book, open, defaultConfig, defaultConfig.maxPositionsPerFixture), 0);
});
