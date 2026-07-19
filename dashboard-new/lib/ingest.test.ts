// The correctness claim of the cron milestone: what the cron stores and
// re-analyzes is byte-for-byte the same run the laptop driver would produce
// from the same payloads. If ingestion drops, reorders, or mangles a tick,
// signal seqs shift, position PDAs move, and idempotency is gone.
//
// Run: node --test --experimental-strip-types dashboard-new/lib/ingest.test.ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { analyzeFixture } from "../../packages/agent/analyze.ts";
import type { OddsPayload } from "../../packages/engine/model.ts";
import { localStore } from "./store/index.ts";
import { planTrades, readArmed, validateCal } from "./armed.ts";
import { ingestSnapshot, parsePayloads, selectNewTicks } from "./ingest.ts";

const FIXTURE_ID = 18213979; // Norway vs England, the M1 parity fixture
const KICKOFF_MS = Date.parse("2026-07-11T21:00:00Z");
const FINAL = { HomeScore: 1, AwayScore: 2 };
const CAPTURE = path.join(import.meta.dirname, "..", "..", "dashboard", "data", String(FIXTURE_ID), "odds.jsonl");

async function capture(): Promise<OddsPayload[]> {
  const raw = await readFile(CAPTURE, "utf8");
  return raw.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as OddsPayload);
}

async function withStore<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "steamline-store-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("ingest keeps every tick of a real capture", async () => {
  const payloads = await capture();
  const accepted = selectNewTicks(payloads, { lastTs: 0, kickoffMs: KICKOFF_MS });
  assert.equal(payloads.length, 186);
  assert.equal(accepted.length, payloads.length);
});

test("ingest drops replays and post-kickoff payloads", async () => {
  const payloads = await capture();
  const half = payloads.slice(0, 40);
  const after = selectNewTicks(payloads, { lastTs: half[half.length - 1].Ts, kickoffMs: KICKOFF_MS });
  assert.equal(after.length, payloads.length - half.length);
  assert.equal(selectNewTicks(payloads, { lastTs: 0, kickoffMs: payloads[10].Ts }).length, 10);
});

test("stored ticks reproduce analyzeFixture exactly, snapshot by snapshot", async () => {
  const payloads = await capture();
  const reference = analyzeFixture(FIXTURE_ID, payloads, FINAL, { theta: 0.01, edgeMin: 0.005 });

  await withStore(async (dir) => {
    const store = localStore(dir);
    // Feed the capture the way the cron sees it: overlapping snapshots, one
    // per invocation, each carrying a tail of already-stored payloads.
    let lastTs = 0;
    let all: OddsPayload[] = [];
    for (let i = 0; i < payloads.length; i += 7) {
      const snapshot = payloads.slice(Math.max(0, i - 3), i + 7);
      const res = await ingestSnapshot(store, FIXTURE_ID, snapshot, { lastTs, kickoffMs: KICKOFF_MS });
      lastTs = res.lastTs;
      all = res.all;
    }

    const stored = parsePayloads(await store.readTicks(FIXTURE_ID));
    assert.equal(stored.length, payloads.length, "every tick survived the store round trip");
    assert.deepEqual(all, stored);
    assert.deepEqual(stored.map((p) => p.MessageId), payloads.map((p) => p.MessageId));

    const fromStore = analyzeFixture(FIXTURE_ID, stored, FINAL, { theta: 0.01, edgeMin: 0.005 });
    assert.deepEqual(fromStore.decisions, reference.decisions);
    assert.deepEqual(fromStore.signals, reference.signals);
    assert.deepEqual(fromStore.books, reference.books);
    assert.equal(fromStore.result, reference.result);
    assert.ok(reference.decisions.length > 0, "the fixture must actually trade for this to prove anything");
  });
});

test("armed calibrations drive the same decisions, pinned included", async () => {
  const payloads = await capture();
  await withStore(async (dir) => {
    const store = localStore(dir);
    await ingestSnapshot(store, FIXTURE_ID, payloads, { lastTs: 0, kickoffMs: KICKOFF_MS });
    const stored = parsePayloads(await store.readTicks(FIXTURE_ID));

    const extra = validateCal(0.5, 0.5);
    assert.ok(extra);
    await store.hset(`armed:${FIXTURE_ID}`, String(extra.season), JSON.stringify({ thetaPp: 0.5, edgePct: 0.5 }));

    // Pinned is 1.0pp / 0.5% and must be armed without ever being written.
    const armed = await readArmed(store, FIXTURE_ID, 1.0, 0.5);
    assert.deepEqual(armed.map((a) => a.season), [900505, 901005]);

    for (const cal of armed) {
      const plan = planTrades(FIXTURE_ID, stored, FINAL, cal, []);
      const reference = analyzeFixture(FIXTURE_ID, payloads, FINAL, cal.cal);
      assert.deepEqual(plan.decisions, reference.decisions, `season ${cal.season}`);
      assert.equal(plan.toOpen.length, reference.decisions.length);
      assert.equal(plan.settle, reference.decisions.length > 0);
    }

    // Nothing left to open once every position exists on chain.
    const onChain = new Array<boolean>(planTrades(FIXTURE_ID, stored, FINAL, armed[0], []).decisions.length).fill(true);
    assert.equal(planTrades(FIXTURE_ID, stored, FINAL, armed[0], onChain).toOpen.length, 0);
  });
});

test("the slider grid rejects off-grid calibrations", () => {
  assert.equal(validateCal(0.55, 0.5), null);
  assert.equal(validateCal(0.1, 0.5), null);
  assert.equal(validateCal(3.1, 0.5), null);
  assert.equal(validateCal(0.5, 2.1), null);
  assert.equal(validateCal("abc", 0.5), null);
  assert.deepEqual(validateCal(0.5, 0.5), { thetaPp: 0.5, edgePct: 0.5, season: 900505, cal: { theta: 0.005, edgeMin: 0.005 } });
});
