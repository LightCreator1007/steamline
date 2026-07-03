import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { streamSse, liveSource } from "./liveSource.ts";
import { type SseEvent } from "./sse.ts";
import { type TxlineClient } from "./txlineClient.ts";

test("streamSse resumes with Last-Event-ID after a dropped stream", async () => {
  let connections = 0;
  const lastIdHeaders: Array<string | undefined> = [];
  const server = createServer((req, res) => {
    connections++;
    lastIdHeaders.push(req.headers["last-event-id"] as string | undefined);
    res.setHeader("content-type", "text/event-stream");
    if (connections === 1) {
      res.write('id: 1\ndata: {"n":1}\n\n');
      res.end();
    } else if (connections === 2) {
      res.write('id: 2\ndata: {"n":2}\n\n');
      res.end();
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  const got: SseEvent[] = [];
  await assert.rejects(
    streamSse(`http://127.0.0.1:${port}/stream`, {}, (e) => got.push(e), { maxReconnects: 1, backoffMs: 1 }),
  );
  server.close();

  assert.deepEqual(got.map((e) => e.data), ['{"n":1}', '{"n":2}']);
  assert.equal(lastIdHeaders[0], undefined);
  assert.equal(lastIdHeaders[1], "1");
});

test("poll mode dedupes odds by MessageId and scores by seq", async () => {
  const odds = [
    { FixtureId: 9, MessageId: "m1", Ts: 10, Bookmaker: "StablePrice", BookmakerId: 0, SuperOddsType: "1X2", InRunning: false, PriceNames: ["1"], Prices: [2000], Pct: ["50"] },
  ];
  const scores = [{ FixtureId: 9, Seq: 1, Ts: 11 }];
  const client: TxlineClient = {
    fixturesSnapshot: async () => [],
    oddsSnapshot: async () => odds,
    oddsValidation: async () => ({}),
    scoresSnapshot: async () => scores,
    scoreStatValidation: async () => ({}),
  };
  const ctl = new AbortController();
  const src = liveSource({ client, fixtureIds: [9], mode: "poll", pollMs: 5 });
  const got: string[] = [];
  for await (const e of src.events(ctl.signal)) {
    got.push(e.kind);
    if (got.length === 2) {
      // let a second poll cycle run, then stop; duplicates must not re-emit
      setTimeout(() => ctl.abort(), 20);
    }
    if (ctl.signal.aborted) break;
  }
  assert.deepEqual(got.sort(), ["odds", "score"]);
});
