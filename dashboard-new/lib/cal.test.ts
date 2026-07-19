// M1 parity: the URL calibration must land on exactly the engine config the
// shipped dashboard computes from its sliders (theta = slider/100), and on the
// same season as server/run.ts calSeason(). Run:
//   node --test --experimental-strip-types dashboard-new/lib/cal.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { calFromParams, calSeason, isPinned, toCal } from "./cal.ts";

const pinned = { theta: 0.004, edgeMin: 0.002 };

test("params default to the fixture's pinned calibration in slider units", () => {
  assert.deepEqual(calFromParams({}, pinned), { thetaPp: 0.4, edgePct: 0.2 });
});

test("slider units convert to the same engine config the old dashboard used", () => {
  // Old: theta = Number(sliderValue) / 100, edgeMin = Number(sliderValue) / 100.
  assert.deepEqual(toCal(0.4, 0.2), { theta: 0.004, edgeMin: 0.002 });
  assert.deepEqual(toCal(0.5, 0.5), { theta: 0.005, edgeMin: 0.005 });
});

test("season matches calSeason() in server/run.ts: 900000 + thetaTenths*100 + edgeTenths", () => {
  assert.equal(calSeason(0.5, 0.5), 900505);
  assert.equal(calSeason(0.4, 0.2), 900402);
  assert.equal(calSeason(3.0, 2.0), 903020);
});

test("out-of-grid params clamp to the server's accepted range", () => {
  assert.deepEqual(calFromParams({ theta: "99", edge: "-5" }, pinned), { thetaPp: 3.0, edgePct: 0 });
});

test("pinned detection matches the old calQuery() comparison", () => {
  assert.equal(isPinned(0.4, 0.2, pinned), true);
  assert.equal(isPinned(0.5, 0.2, pinned), false);
});
