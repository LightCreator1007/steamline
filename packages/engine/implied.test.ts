import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeOdds, calibrateScale, fairProbs } from "./implied.ts";
import { EngineError } from "./errors.ts";

test("decodeOdds divides by scale", () => {
  assert.equal(decodeOdds(1950, 1000), 1.95);
});

test("decodeOdds rejects non-positive and sub-evens prices", () => {
  assert.throws(() => decodeOdds(0, 1000), (e) => e instanceof EngineError && e.code === "BAD_ODDS_DECODE");
  assert.throws(() => decodeOdds(900, 1000), (e) => e instanceof EngineError && e.code === "BAD_ODDS_DECODE");
});

test("calibrateScale recovers 1000 from consistent prices and pct", () => {
  // decimal 2.0, 3.5, 4.0 -> implied 50%, 28.57%, 25% -> prices at scale 1000
  const prices = [2000, 3500, 4000];
  const pct = ["50.0", "28.57", "25.0"];
  assert.equal(calibrateScale(prices, pct), 1000);
});

test("fairProbs removes vig and sums to 1", () => {
  const p = fairProbs([2.0, 3.5, 4.0]);
  const sum = p.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(p[0] > p[1] && p[1] > p[2]);
});

test("fairProbs throws on empty input", () => {
  assert.throws(() => fairProbs([]), (e) => e instanceof EngineError && e.code === "ZERO_OVERROUND");
});
