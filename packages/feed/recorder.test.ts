import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { record, epochDayOf } from "./recorder.ts";
import { deriveRootsPda } from "./roots.ts";
import { type TxlineClient } from "./txlineClient.ts";
import { type FeedSource } from "./source.ts";

const odds = (msg: string, ts: number) => ({
  FixtureId: 5, MessageId: msg, Ts: ts, Bookmaker: "StablePrice", BookmakerId: 0,
  SuperOddsType: "1X2", InRunning: false, PriceNames: ["1"], Prices: [2000], Pct: ["50"],
});

function fakeSource(): FeedSource {
  return {
    async *events() {
      yield { kind: "odds", ts: 1, payload: odds("m1", 1) };
      yield { kind: "score", ts: 2, payload: { FixtureId: 5, Seq: 1, Ts: 2, StatKey: "score" } };
      yield { kind: "odds", ts: 3, payload: odds("m2", 3) };
    },
  };
}

test("writes jsonl and proof files, tolerates proof failures", async () => {
  const dir = mkdtempSync(join(tmpdir(), "steamline-rec-"));
  let proofCalls = 0;
  const client: TxlineClient = {
    fixturesSnapshot: async () => [],
    oddsSnapshot: async () => [],
    oddsValidation: async (messageId) => {
      proofCalls++;
      if (messageId === "m2") throw new Error("proof gone");
      return { proof: ["x"] };
    },
    scoresSnapshot: async () => [],
    scoreStatValidation: async () => ({ proof: ["y"] }),
  };
  const stats = await record({ client, source: fakeSource(), outDir: dir, proofs: true });
  assert.deepEqual(stats, { odds: 2, scores: 1, proofErrors: 1 });
  const oddsLines = readFileSync(join(dir, "5", "odds.jsonl"), "utf8").trim().split("\n");
  assert.equal(oddsLines.length, 2);
  assert.ok(existsSync(join(dir, "5", "proofs", "odds-m1.json")));
  assert.ok(existsSync(join(dir, "5", "proofs", "score-1.json")));
  assert.equal(proofCalls, 2);
});

test("epochDayOf handles seconds and milliseconds timestamps", () => {
  const day = 20000; // an epoch day
  assert.equal(epochDayOf(day * 86400), day);
  assert.equal(epochDayOf(day * 86400 * 1000), day);
});

test("deriveRootsPda is deterministic per width", () => {
  const pid = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
  const a = deriveRootsPda("daily_scores_roots", 20000, pid, 8);
  const b = deriveRootsPda("daily_scores_roots", 20000, pid, 8);
  const c = deriveRootsPda("daily_scores_roots", 20000, pid, 4);
  assert.equal(a.toBase58(), b.toBase58());
  assert.notEqual(a.toBase58(), c.toBase58());
});
