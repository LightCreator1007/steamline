import { test } from "node:test";
import assert from "node:assert/strict";
import { brier, logLoss, applyGrade } from "./grade.ts";
import { newAgentState } from "./model.ts";

test("brier is the squared error", () => {
  assert.ok(Math.abs(brier(0.7, 1) - 0.09) < 1e-9);
  assert.ok(Math.abs(brier(0.7, 0) - 0.49) < 1e-9);
});

test("logLoss is clipped and finite at the boundaries", () => {
  assert.ok(Number.isFinite(logLoss(1, 0)));
  assert.ok(Number.isFinite(logLoss(0, 1)));
  assert.ok(logLoss(0.9, 1) < logLoss(0.6, 1));
});

test("applyGrade accumulates counts, pnl, and metric sums", () => {
  let b = newAgentState(0, 1_000_000_000);
  b = applyGrade(b, 0.7, 1, 5000);
  assert.equal(b.graded, 1);
  assert.equal(b.betsWon, 1);
  assert.equal(b.realizedPnl, 5000);
  b = applyGrade(b, 0.4, 0, -3000);
  assert.equal(b.graded, 2);
  assert.equal(b.betsLost, 1);
  assert.equal(b.realizedPnl, 2000);
});
