import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOdds, selectConsensus } from "./normalize.ts";
import { defaultConfig, type OddsPayload } from "./model.ts";

function payload(over: Partial<OddsPayload> = {}): OddsPayload {
  return {
    FixtureId: 1,
    MessageId: "m1",
    Ts: 1000,
    Bookmaker: "StablePrice",
    BookmakerId: 0,
    SuperOddsType: "1X2",
    InRunning: false,
    PriceNames: ["1", "X", "2"],
    Prices: [2000, 3500, 4000],
    Pct: ["50.0", "28.57", "25.0"],
    ...over,
  };
}

test("normalizeOdds decodes, labels staleness, and computes fair probs", () => {
  const t = normalizeOdds(payload(), 1500, defaultConfig);
  assert.equal(t.staleMs, 500);
  assert.equal(t.market, "1X2");
  assert.equal(t.outcomes.length, 3);
  assert.equal(t.outcomes[0].decimalOdds, 2.0);
  const sum = t.outcomes.reduce((a, o) => a + o.fairProb, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test("selectConsensus prefers the StablePrice line", () => {
  const others = payload({ Bookmaker: "BookieX", MessageId: "m2" });
  const stable = payload({ Bookmaker: "StablePrice", MessageId: "m1" });
  const t = selectConsensus([others, stable], 1000, defaultConfig);
  assert.ok(t);
  assert.equal(t!.source, "StablePrice");
  assert.equal(t!.messageId, "m1");
});

test("selectConsensus returns null on empty input", () => {
  assert.equal(selectConsensus([], 1000, defaultConfig), null);
});
