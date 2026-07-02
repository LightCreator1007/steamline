import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultConfig, newAgentState, clamp } from "./model.ts";

test("defaultConfig matches the spec defaults", () => {
  assert.equal(defaultConfig.scale, 1000);
  assert.equal(defaultConfig.staleMs, 120000);
  assert.equal(defaultConfig.windowTicks, 4);
  assert.equal(defaultConfig.theta, 0.03);
  assert.equal(defaultConfig.persistence, 2);
  assert.equal(defaultConfig.zMin, 2.5);
  assert.equal(defaultConfig.floor, 0.02);
  assert.equal(defaultConfig.warmupTicks, 20);
  assert.equal(defaultConfig.alpha, 0.5);
  assert.equal(defaultConfig.edgeMin, 0.02);
  assert.equal(defaultConfig.kellyFraction, 0.25);
  assert.equal(defaultConfig.startingBankroll, 1_000_000_000);
  assert.equal(defaultConfig.maxStakePerMarket, 50_000_000);
  assert.equal(defaultConfig.maxExposure, 500_000_000);
  assert.equal(defaultConfig.dailyLossStop, 200_000_000);
  assert.equal(defaultConfig.method, "fixed");
  assert.equal(defaultConfig.preMatchOnly, true);
  assert.equal(defaultConfig.shockGuardMs, 300000);
  assert.equal(defaultConfig.cooldownMs, 600000);
  assert.equal(defaultConfig.maxPositionsPerFixture, 3);
});

test("newAgentState starts flat with the given bankroll", () => {
  const s = newAgentState(0, 1_000_000_000);
  assert.equal(s.agentId, 0);
  assert.equal(s.bankrollPoints, 1_000_000_000);
  assert.equal(s.stakedPoints, 0);
  assert.equal(s.realizedPnl, 0);
  assert.equal(s.graded, 0);
});

test("clamp bounds a value", () => {
  assert.equal(clamp(1.5, 0, 1), 1);
  assert.equal(clamp(-0.2, 0, 1), 0);
  assert.equal(clamp(0.4, 0, 1), 0.4);
});
