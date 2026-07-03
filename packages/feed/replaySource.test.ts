import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaySource } from "./replaySource.ts";

function jsonl(rows: unknown[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

test("merges odds and scores by timestamp ascending", async () => {
  const dir = mkdtempSync(join(tmpdir(), "steamline-replay-"));
  writeFileSync(join(dir, "odds.jsonl"), jsonl([
    { FixtureId: 1, MessageId: "a", Ts: 100, Bookmaker: "StablePrice", BookmakerId: 0, SuperOddsType: "1X2", InRunning: false, PriceNames: ["1"], Prices: [2000], Pct: ["50"] },
    { FixtureId: 1, MessageId: "b", Ts: 300, Bookmaker: "StablePrice", BookmakerId: 0, SuperOddsType: "1X2", InRunning: false, PriceNames: ["1"], Prices: [1900], Pct: ["52.6"] },
  ]));
  writeFileSync(join(dir, "scores.jsonl"), jsonl([{ FixtureId: 1, Seq: 1, Ts: 200 }]));

  const got: Array<{ kind: string; ts: number }> = [];
  for await (const e of replaySource(dir).events()) got.push({ kind: e.kind, ts: e.ts });
  assert.deepEqual(got, [
    { kind: "odds", ts: 100 },
    { kind: "score", ts: 200 },
    { kind: "odds", ts: 300 },
  ]);
});

test("missing files yield an empty stream", async () => {
  const dir = mkdtempSync(join(tmpdir(), "steamline-replay-"));
  let n = 0;
  for await (const _ of replaySource(dir).events()) n++;
  assert.equal(n, 0);
});
