import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSteam } from "./detect.ts";
import { inMemoryLedger } from "./ledger.ts";
import { defaultConfig, type OddsTick } from "./model.ts";

function tick(ts: number, p1: number, inRunning = false): OddsTick {
  const p2 = (1 - p1) / 2;
  return {
    fixtureId: 1, messageId: "m" + ts, ts, market: "1X2",
    inRunning, source: "StablePrice", staleMs: 0,
    outcomes: [
      { name: "1", decimalOdds: 1 / p1, rawImplied: p1, fairProb: p1 },
      { name: "X", decimalOdds: 1 / p2, rawImplied: p2, fairProb: p2 },
      { name: "2", decimalOdds: 1 / p2, rawImplied: p2, fairProb: p2 },
    ],
  };
}

let seq = 0;
const nextSeq = () => seq++;

test("fires when a sustained move exceeds theta", () => {
  seq = 0;
  const l = inMemoryLedger();
  // outcome 1 prob rises 0.40 -> 0.46 sustained across ticks
  [0.40, 0.42, 0.44, 0.46, 0.46].forEach((p, i) => l.append(tick(i * 60000, p)));
  const sig = detectSteam(l, 1, "1X2", defaultConfig, nextSeq);
  assert.ok(sig, "expected a signal");
  assert.equal(sig!.outcome, "1");
  assert.equal(sig!.direction, 1);
  assert.ok(sig!.magnitude >= defaultConfig.theta);
});

test("rejects a single-tick blip that reverts", () => {
  seq = 0;
  const l = inMemoryLedger();
  // spike then revert: last step reverses direction, persistence fails
  [0.40, 0.40, 0.40, 0.47, 0.40].forEach((p, i) => l.append(tick(i * 60000, p)));
  assert.equal(detectSteam(l, 1, "1X2", defaultConfig, nextSeq), null);
});

test("does not fire below the theta threshold", () => {
  seq = 0;
  const l = inMemoryLedger();
  [0.40, 0.405, 0.41, 0.415, 0.42].forEach((p, i) => l.append(tick(i * 60000, p)));
  // total move 0.02 < theta 0.03
  assert.equal(detectSteam(l, 1, "1X2", defaultConfig, nextSeq), null);
});

test("stale current tick never fires", () => {
  seq = 0;
  const l = inMemoryLedger();
  [0.40, 0.42, 0.44, 0.46, 0.46].forEach((p, i) => {
    const t = tick(i * 60000, p);
    if (i === 4) t.staleMs = defaultConfig.staleMs + 1;
    l.append(t);
  });
  assert.equal(detectSteam(l, 1, "1X2", defaultConfig, nextSeq), null);
});

test("returns null with too few ticks", () => {
  seq = 0;
  const l = inMemoryLedger();
  [0.40, 0.46].forEach((p, i) => l.append(tick(i * 60000, p)));
  assert.equal(detectSteam(l, 1, "1X2", defaultConfig, nextSeq), null);
});

test("in-play current tick never fires under preMatchOnly, fires when in-play is enabled", () => {
  seq = 0;
  const l = inMemoryLedger();
  [0.40, 0.42, 0.44, 0.46, 0.46].forEach((p, i) => l.append(tick(i * 60000, p, i === 4)));
  assert.equal(detectSteam(l, 1, "1X2", defaultConfig, nextSeq), null);
  const inPlay = { ...defaultConfig, preMatchOnly: false };
  assert.ok(detectSteam(l, 1, "1X2", inPlay, nextSeq));
});

test("shock guard suppresses in-play signals right after a score change", () => {
  seq = 0;
  const t0 = 10_000_000;
  const l = inMemoryLedger();
  [0.40, 0.42, 0.44, 0.46, 0.46].forEach((p, i) => l.append(tick(t0 + i * 60000, p, true)));
  const inPlay = { ...defaultConfig, preMatchOnly: false };
  // current tick ts = t0 + 240000; a goal 40s earlier is inside shockGuardMs (300000)
  assert.equal(detectSteam(l, 1, "1X2", inPlay, nextSeq, { lastScoreChangeTs: t0 + 200000 }), null);
  // a goal well before the guard window does not block
  assert.ok(detectSteam(l, 1, "1X2", inPlay, nextSeq, { lastScoreChangeTs: t0 - 400000 }));
});

test("cooldown suppresses a repeat signal on the same outcome", () => {
  seq = 0;
  const t0 = 10_000_000;
  const l = inMemoryLedger();
  [0.40, 0.42, 0.44, 0.46, 0.46].forEach((p, i) => l.append(tick(t0 + i * 60000, p)));
  const recent = {
    fixtureId: 1, market: "1X2", seq: 0, outcome: "1", direction: 1 as const,
    magnitude: 0.05, preProb: 0.4, postProb: 0.45, ts: t0 + 200000, messageId: "mx", method: "fixed" as const,
  };
  assert.equal(detectSteam(l, 1, "1X2", defaultConfig, nextSeq, { recentSignals: [recent] }), null);
  // the same signal older than cooldownMs does not block
  const old = { ...recent, ts: t0 - 600000 };
  assert.ok(detectSteam(l, 1, "1X2", defaultConfig, nextSeq, { recentSignals: [old] }));
});

test("rejects persistence violation despite exceeding theta, but fires once the reversal is removed", () => {
  seq = 0;
  const rejected = inMemoryLedger();
  // outcome "1": 0.40 -> 0.42 -> 0.46 -> 0.49 -> 0.45
  // window delta = 0.45 - 0.40 = 0.05 >= theta (0.03), so theta alone would fire
  // but the last step (0.49 -> 0.45 = -0.04) reverses the positive direction,
  // so isSustained fails over persistence=2 (steps +0.03, -0.04) => null
  [0.40, 0.42, 0.46, 0.49, 0.45].forEach((p, i) => rejected.append(tick(i * 60000, p)));
  assert.equal(detectSteam(rejected, 1, "1X2", defaultConfig, nextSeq), null);

  seq = 0;
  const fires = inMemoryLedger();
  // same series but the last tick continues upward instead of reversing:
  // steps are +0.02, +0.04, +0.03, +0.02 (all positive) so isSustained holds,
  // and window delta = 0.51 - 0.40 = 0.11 >= theta, proving theta was genuinely
  // exceeded and only the persistence check blocked the series above
  [0.40, 0.42, 0.46, 0.49, 0.51].forEach((p, i) => fires.append(tick(i * 60000, p)));
  const sig = detectSteam(fires, 1, "1X2", defaultConfig, nextSeq);
  assert.ok(sig, "expected a signal once the reversal is removed");
  assert.equal(sig!.outcome, "1");
});

test("adaptive method fires when z-score and floor are both exceeded", () => {
  seq = 0;
  const l = inMemoryLedger();
  // outcome "1" step-deltas: +0.001, +0.001, +0.001 (quiet) then +0.047 (steam move)
  // ewmaStd (lambda=0.94) over those four step-deltas is ~0.01079
  // window delta = 0.450 - 0.400 = 0.05, so z = 0.05 / 0.01079 ~= 4.63 >= zMin(2.5)
  // and |delta| 0.05 >= floor(0.02), so the adaptive rule fires
  [0.400, 0.401, 0.402, 0.403, 0.450].forEach((p, i) => l.append(tick(i * 60000, p)));
  const cfg = { ...defaultConfig, method: "adaptive" as const, warmupTicks: 5 };
  const sig = detectSteam(l, 1, "1X2", cfg, nextSeq);
  assert.ok(sig, "expected an adaptive signal");
  assert.equal(sig!.method, "adaptive");
  assert.equal(sig!.outcome, "1");
});

test("adaptive method requires the floor even when z-score qualifies", () => {
  seq = 0;
  const l = inMemoryLedger();
  // identical series to the adaptive-fires case above: z ~= 4.63 still clears
  // zMin, but raising floor to 0.1 blocks the 0.05 window delta from firing
  [0.400, 0.401, 0.402, 0.403, 0.450].forEach((p, i) => l.append(tick(i * 60000, p)));
  const cfg = { ...defaultConfig, method: "adaptive" as const, warmupTicks: 5, floor: 0.1 };
  assert.equal(detectSteam(l, 1, "1X2", cfg, nextSeq), null);
});

test("adaptive method falls back to the fixed rule below warmup", () => {
  seq = 0;
  const l = inMemoryLedger();
  // only 5 ticks recorded, well under the default warmupTicks (20), so
  // useAdaptive is false and the fixed rule runs instead: window delta
  // 0.46 - 0.40 = 0.06 >= theta(0.03) with a sustained rise, so it fires as "fixed"
  [0.40, 0.42, 0.44, 0.46, 0.46].forEach((p, i) => l.append(tick(i * 60000, p)));
  const cfg = { ...defaultConfig, method: "adaptive" as const };
  const sig = detectSteam(l, 1, "1X2", cfg, nextSeq);
  assert.ok(sig, "expected a fallback signal");
  assert.equal(sig!.method, "fixed");
});
