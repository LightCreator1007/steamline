// End-to-end test of the live driver against the real England vs Argentina
// semi-final capture (3,578 SSE payloads), served back through a local SSE
// endpoint so the whole live path runs at speed with no live match and no
// chain. The chain is a recorder fake; everything else is the real code path.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { appendJsonl, readJsonl } from "../feed/replaySource.ts";
import { liveSource } from "../feed/liveSource.ts";
import { type FeedSource } from "../feed/source.ts";
import { type TxlineClient, type ScoreEvent } from "../feed/txlineClient.ts";
import { type OddsPayload } from "../engine/model.ts";
import { analyzeFixture } from "./analyze.ts";
import { canonicalOdds, regulationScore, liveTrade, type LiveChain } from "./live.ts";

const ROOT = new URL("../..", import.meta.url).pathname;
const FID = 18241006;
const DIR = join(ROOT, `fixtures/live-${FID}/${FID}`);
const KICKOFF = 1784142000000; // StartTime from the capture's score events
const CAL = { theta: 0.005, edgeMin: 0.005 }; // the replay card's pinned calibration

const allOdds = readJsonl<OddsPayload>(join(DIR, "odds.jsonl"));
const allScores = readJsonl<ScoreEvent>(join(DIR, "scores.jsonl"));
const finalEvent = allScores.find((s) => (s as { Action?: string }).Action === "game_finalised");

// Mirror of liveTrade's accept gate: canonical, deduped, monotonic 60s apart,
// pre-kickoff only. Computed independently so the e2e run has an oracle.
function acceptedPayloads(): OddsPayload[] {
  const seen = new Set<string>();
  const out: OddsPayload[] = [];
  let last = 0;
  for (const raw of allOdds) {
    if (seen.has(raw.MessageId)) continue;
    seen.add(raw.MessageId);
    const p = canonicalOdds(raw);
    if (!p || p.Ts < last + 60_000 || p.Ts >= KICKOFF) continue;
    last = p.Ts;
    out.push(p);
  }
  return out;
}

test("canonicalOdds keeps only the pre-match full-time consensus line", () => {
  const kept = allOdds.map(canonicalOdds).filter((p) => p !== null);
  assert.ok(kept.length > 0);
  assert.ok(kept.length < allOdds.length);
  for (const p of kept) {
    for (const name of p.PriceNames) assert.ok(["1", "X", "2"].includes(name));
  }
  const half = allOdds.find((p) => p.MarketPeriod === "half=1");
  assert.ok(half);
  assert.equal(canonicalOdds(half), null);
  const handicap = allOdds.find((p) => p.SuperOddsType !== "1X2_PARTICIPANT_RESULT");
  assert.ok(handicap);
  assert.equal(canonicalOdds(handicap), null);
});

test("regulationScore extracts the regulation final from game_finalised only", () => {
  assert.ok(finalEvent);
  assert.deepEqual(regulationScore(finalEvent), { HomeScore: 1, AwayScore: 2 });
  assert.equal(regulationScore(allScores[0]), null);
});

test("live driver end to end: SSE stream in, opens as signals fire, settles at full time", async () => {
  assert.ok(finalEvent);
  const expected = acceptedPayloads();
  assert.ok(expected.length >= 50, `expected a real pre-match window, got ${expected.length} ticks`);
  const oracle = analyzeFixture(FID, expected, { HomeScore: 1, AwayScore: 2 }, CAL);
  assert.ok(oracle.decisions.length > 0, "pinned calibration must actually trade on this capture");

  const outDir = mkdtempSync(join(tmpdir(), "steamline-live-"));
  const oddsPath = join(outDir, String(FID), "odds.jsonl");

  // Local SSE endpoint serving the raw capture, held open until aborted.
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const p of allOdds) res.write(`data: ${JSON.stringify(p)}\n\n`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  // Scores stay on polling in sse mode; the fake returns game_finalised only
  // once the driver has persisted every accepted tick, so the run is
  // deterministic instead of racing the stream.
  const client = {
    scoresSnapshot: async () =>
      existsSync(oddsPath) && readJsonl(oddsPath).length >= expected.length ? [finalEvent] : [],
  } as unknown as TxlineClient;

  const calls: string[] = [];
  const chain: LiveChain = {
    open: async (d) => {
      calls.push(`open:${d.agent}:${d.signalSeq}`);
      return `open-${d.agent}-${d.signalSeq}`;
    },
    settleMatch: async (home, away) => {
      calls.push(`settleMatch:${home}-${away}`);
      return "settle-match-sig";
    },
    settlePosition: async (d) => {
      calls.push(`settlePos:${d.agent}:${d.signalSeq}`);
      return `settle-${d.agent}-${d.signalSeq}`;
    },
  };

  const source = liveSource({ client, fixtureIds: [FID], mode: "sse", apiBase: base, headers: {}, pollMs: 20 });
  const res = await liveTrade({
    fixtureId: FID,
    kickoffMs: KICKOFF,
    source,
    cal: CAL,
    chain,
    outDir,
    deadlineMs: Date.now() + 120_000,
    log: () => {},
  });
  server.closeAllConnections();
  server.close();

  // Settled on the regulation final.
  assert.deepEqual(res.final, { HomeScore: 1, AwayScore: 2 });
  assert.equal(res.analysis.result, "away");
  assert.equal(res.settleMatchTx, "settle-match-sig");

  // Prefix stability: the incremental live run reaches the exact analysis a
  // pure replay over the same accepted payloads produces.
  assert.deepEqual(res.analysis.decisions, oracle.decisions);
  assert.deepEqual(readJsonl<OddsPayload>(oddsPath), expected);

  // Every decision opened exactly once, and all opens precede the settle.
  const opens = calls.filter((c) => c.startsWith("open:"));
  assert.equal(new Set(opens).size, opens.length);
  assert.deepEqual(
    [...res.openTxs.keys()].sort(),
    oracle.decisions.map((d) => `${d.agent}:${d.signalSeq}`).sort(),
  );
  const settleIdx = calls.indexOf(`settleMatch:1-2`);
  assert.ok(settleIdx > -1);
  for (const [i, c] of calls.entries()) {
    if (c.startsWith("open:")) assert.ok(i < settleIdx, `open after settle: ${c}`);
  }
  assert.equal(res.settleTxs.size, oracle.decisions.length);

  rmSync(outDir, { recursive: true, force: true });
});

test("restart resumes from the persisted capture and adopts existing positions", async () => {
  assert.ok(finalEvent);
  const expected = acceptedPayloads();
  const oracle = analyzeFixture(FID, expected, { HomeScore: 1, AwayScore: 2 }, CAL);
  assert.ok(oracle.decisions.length > 0);

  // Simulate a prior session that accepted the whole window and opened every
  // position on chain, then died before full time.
  const outDir = mkdtempSync(join(tmpdir(), "steamline-restart-"));
  for (const p of expected) appendJsonl(join(outDir, String(FID), "odds.jsonl"), p);

  const calls: string[] = [];
  const chain: LiveChain = {
    open: async (d) => {
      calls.push(`open:${d.agent}:${d.signalSeq}`);
      throw new Error("Allocate: account already in use");
    },
    settleMatch: async (home, away) => {
      calls.push(`settleMatch:${home}-${away}`);
      return "settle-match-sig";
    },
    settlePosition: async (d) => {
      calls.push(`settlePos:${d.agent}:${d.signalSeq}`);
      return `settle-${d.agent}-${d.signalSeq}`;
    },
  };
  // The restarted session only sees the finalise; all odds are pre-persisted.
  const source: FeedSource = {
    async *events() {
      yield { kind: "score", ts: 0, payload: finalEvent };
    },
  };

  const res = await liveTrade({
    fixtureId: FID,
    kickoffMs: KICKOFF,
    source,
    cal: CAL,
    chain,
    outDir,
    deadlineMs: Date.now() + 60_000,
    log: () => {},
  });

  // Same prefix, same seqs, same decisions as the uninterrupted run.
  assert.deepEqual(res.analysis.decisions, oracle.decisions);
  assert.deepEqual(res.final, { HomeScore: 1, AwayScore: 2 });
  for (const v of res.openTxs.values()) assert.equal(v, "pre-existing");
  // Adopted positions still settle.
  assert.equal(res.settleMatchTx, "settle-match-sig");
  assert.equal(res.settleTxs.size, oracle.decisions.length);

  rmSync(outDir, { recursive: true, force: true });
});
