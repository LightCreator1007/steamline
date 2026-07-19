// Phase strip derivation across the lifecycle. Run:
//   node --test --experimental-strip-types dashboard-new/lib/phase.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { derivePhases, type PhaseInput } from "./phase.ts";

const KICKOFF = Date.parse("2026-07-18T21:00:00Z");
const WINDOW_MS = 6 * 3_600_000;

const base: PhaseInput = {
  nowMs: KICKOFF,
  kickoffMs: KICKOFF,
  windowMs: WINDOW_MS,
  firstTickMs: null,
  lastTickMs: null,
  positionsCount: 0,
  firstPositionMs: null,
  hasFinalScore: false,
  settled: false,
};

test("before the window: nothing reached, no step active", () => {
  const steps = derivePhases({ ...base, nowMs: KICKOFF - WINDOW_MS - 3_600_000 });
  assert.ok(steps.every((s) => s.at === null && !s.active && !s.done));
});

test("window opens on schedule, timestamped to the window boundary not now", () => {
  const nowMs = KICKOFF - WINDOW_MS + 1_000;
  const steps = derivePhases({ ...base, nowMs });
  const window = steps.find((s) => s.id === "window")!;
  assert.equal(window.at, KICKOFF - WINDOW_MS);
  assert.ok(window.active);
});

test("agent watching lights once a tick is stored, not from wall-clock alone", () => {
  const firstTickMs = KICKOFF - WINDOW_MS + 60_000;
  const steps = derivePhases({ ...base, nowMs: firstTickMs + 30_000, firstTickMs, lastTickMs: firstTickMs });
  const watching = steps.find((s) => s.id === "watching")!;
  assert.equal(watching.at, firstTickMs);
  assert.ok(watching.active);
  assert.ok(steps.find((s) => s.id === "window")!.done);
});

test("stale ticks: a long-quiet gap does not fabricate progress past watching", () => {
  const firstTickMs = KICKOFF - WINDOW_MS + 60_000;
  const lastTickMs = firstTickMs + 5 * 60_000;
  // "now" is 20 minutes past the last stored tick (stale), but no positions
  // and no final score exist, so the strip must still read "watching",
  // not jump ahead just because time has passed.
  const steps = derivePhases({
    ...base,
    nowMs: lastTickMs + 20 * 60_000,
    firstTickMs,
    lastTickMs,
    positionsCount: 0,
  });
  const watching = steps.find((s) => s.id === "watching")!;
  assert.ok(watching.active);
  assert.equal(watching.at, firstTickMs);
  for (const id of ["steam", "positions", "full_time", "settled"] as const) {
    const s = steps.find((x) => x.id === id)!;
    assert.equal(s.at, null);
    assert.equal(s.active, false);
  }
});

test("steam and positions both light the moment a position exists, stamped to its tick", () => {
  const firstTickMs = KICKOFF - WINDOW_MS + 60_000;
  const firstPositionMs = KICKOFF - 10 * 60_000;
  const steps = derivePhases({
    ...base,
    nowMs: firstPositionMs + 60_000,
    firstTickMs,
    lastTickMs: firstPositionMs,
    positionsCount: 2,
    firstPositionMs,
  });
  const steam = steps.find((s) => s.id === "steam")!;
  const positions = steps.find((s) => s.id === "positions")!;
  assert.equal(steam.at, firstPositionMs);
  assert.equal(positions.at, firstPositionMs);
  assert.ok(positions.active);
  assert.ok(steam.done);
});

test("full time lights once the watch record carries a final score", () => {
  const lastTickMs = KICKOFF + 2 * 3_600_000;
  const steps = derivePhases({
    ...base,
    nowMs: lastTickMs,
    firstTickMs: KICKOFF - WINDOW_MS + 60_000,
    lastTickMs,
    positionsCount: 2,
    firstPositionMs: KICKOFF - 10 * 60_000,
    hasFinalScore: true,
  });
  const fullTime = steps.find((s) => s.id === "full_time")!;
  assert.equal(fullTime.at, lastTickMs);
  assert.ok(fullTime.active);
  assert.ok(steps.find((s) => s.id === "positions")!.done);
});

test("settled branch: every earlier step reads done, only settled is active", () => {
  const lastTickMs = KICKOFF + 3 * 3_600_000;
  const steps = derivePhases({
    ...base,
    nowMs: lastTickMs + 60_000,
    firstTickMs: KICKOFF - WINDOW_MS + 60_000,
    lastTickMs,
    positionsCount: 2,
    firstPositionMs: KICKOFF - 10 * 60_000,
    hasFinalScore: true,
    settled: true,
  });
  const settled = steps.find((s) => s.id === "settled")!;
  assert.equal(settled.at, lastTickMs);
  assert.ok(settled.active);
  for (const id of ["window", "watching", "steam", "positions", "full_time"] as const) {
    assert.ok(steps.find((s) => s.id === id)!.done, `${id} should be done once settled`);
  }
});
