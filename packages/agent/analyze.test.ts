import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeFixture } from "./analyze.ts";
import { readJsonl } from "../feed/replaySource.ts";
import { defaultConfig, type OddsPayload } from "../engine/model.ts";
import { outcomeFromScore } from "../engine/settle.ts";

const FIXTURE_DIR = new URL("../../fixtures/wc-18213979/", import.meta.url).pathname;
const FIXTURE_ID = 18213979;
// Demo calibration for the quiet demargined pre-match line (HANDOFF section 9).
const CAL = { theta: 0.01, edgeMin: 0.005 };

function load(): { payloads: OddsPayload[]; finalScore: { HomeScore: number; AwayScore: number } } {
  const payloads = readJsonl<OddsPayload>(`${FIXTURE_DIR}odds.jsonl`);
  const [score] = readJsonl<{ HomeScore: number; AwayScore: number }>(`${FIXTURE_DIR}scores.jsonl`);
  return { payloads, finalScore: score };
}

test("analysis is deterministic across runs", () => {
  const { payloads, finalScore } = load();
  const a = analyzeFixture(FIXTURE_ID, payloads, finalScore, CAL);
  const b = analyzeFixture(FIXTURE_ID, payloads, finalScore, CAL);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
});

test("real fixture fires two steam signals and settles away win", () => {
  const { payloads, finalScore } = load();
  const a = analyzeFixture(FIXTURE_ID, payloads, finalScore, CAL);
  assert.equal(a.signals.length, 2);
  assert.equal(a.result, outcomeFromScore(1, 2));
  assert.equal(a.decisions.length, 4);
  for (const d of a.decisions) {
    assert.notEqual(d.status, "open");
    if (d.status === "won") {
      // On-chain payout parity: (stake * odds_milli + 500) / 1000, half up.
      assert.equal(d.payout, Math.round((d.stake * d.entryOddsMilli) / 1000));
    } else {
      assert.equal(d.payout, 0);
    }
  }
});

test("settlement grades books: graded count and score sums populated", () => {
  const { payloads, finalScore } = load();
  const a = analyzeFixture(FIXTURE_ID, payloads, finalScore, CAL);
  for (const book of a.books) {
    const settled = a.decisions.filter((d) => d.agent === book.agentId).length;
    assert.equal(book.graded, settled);
    assert.equal(book.betsWon + book.betsLost, settled);
    if (settled > 0) {
      assert.ok(book.brierSum > 0);
      assert.ok(book.logLossSum > 0);
    }
  }
});

test("trace mirrors decisions and conserves equity before settlement", () => {
  const { payloads, finalScore } = load();
  const a = analyzeFixture(FIXTURE_ID, payloads, finalScore, CAL);
  const traced = a.trace.flatMap((t) => t.events).filter((e) => e.kind === "decision");
  assert.deepEqual(traced.map((e) => (e.kind === "decision" ? e.decision : null)), a.decisions);
  const last = a.trace[a.trace.length - 1];
  for (const book of last.books) {
    assert.equal(book.bankrollPoints + book.stakedPoints, defaultConfig.startingBankroll);
  }
});

test("heartbeat payloads are skipped without aborting", () => {
  const { payloads, finalScore } = load();
  const heartbeat = { ...payloads[0], PriceNames: [], Prices: [] };
  const a = analyzeFixture(FIXTURE_ID, [heartbeat, ...payloads], finalScore, CAL);
  const b = analyzeFixture(FIXTURE_ID, payloads, finalScore, CAL);
  assert.equal(a.trace.length, b.trace.length);
  assert.equal(a.signals.length, b.signals.length);
});

test("no final score leaves positions open and books ungraded", () => {
  const { payloads } = load();
  const a = analyzeFixture(FIXTURE_ID, payloads, null, CAL);
  assert.equal(a.result, null);
  assert.ok(a.decisions.length > 0);
  for (const d of a.decisions) assert.equal(d.status, "open");
  for (const book of a.books) assert.equal(book.graded, 0);
});
