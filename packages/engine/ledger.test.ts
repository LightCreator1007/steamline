import { test } from "node:test";
import assert from "node:assert/strict";
import { inMemoryLedger } from "./ledger.ts";
import { type OddsTick } from "./model.ts";

function tick(ts: number): OddsTick {
  return {
    fixtureId: 1, messageId: "m" + ts, ts, market: "1X2",
    inRunning: false, source: "StablePrice", staleMs: 0,
    outcomes: [{ name: "1", decimalOdds: 2, rawImplied: 0.5, fairProb: 0.5 }],
  };
}

test("append then read preserves timestamp order", () => {
  const l = inMemoryLedger();
  l.append(tick(30));
  l.append(tick(10));
  l.append(tick(20));
  const all = l.all(1, "1X2");
  assert.deepEqual(all.map((t) => t.ts), [10, 20, 30]);
});

test("window returns the last n oldest-to-newest", () => {
  const l = inMemoryLedger();
  [10, 20, 30, 40].forEach((ts) => l.append(tick(ts)));
  assert.deepEqual(l.window(1, "1X2", 2).map((t) => t.ts), [30, 40]);
});

test("distinct fixture and market keys do not collide", () => {
  const l = inMemoryLedger();
  l.append(tick(10));
  assert.equal(l.all(2, "1X2").length, 0);
  assert.equal(l.all(1, "OU2.5").length, 0);
});
