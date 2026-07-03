import { test } from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { streamSse, liveSource } from "./liveSource.ts";
import { type SseEvent } from "./sse.ts";
import { type TxlineClient, sleep } from "./txlineClient.ts";
import { startServer } from "./testServer.ts";

test("streamSse resumes with Last-Event-ID after a dropped stream", async () => {
  let connections = 0;
  const lastIdHeaders: Array<string | undefined> = [];
  const srv = await startServer((req, res) => {
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

  const got: SseEvent[] = [];
  await assert.rejects(
    streamSse(`${srv.base}/stream`, {}, (e) => got.push(e), { maxReconnects: 1, backoffMs: 1 }),
  );
  srv.close();

  assert.deepEqual(got.map((e) => e.data), ['{"n":1}', '{"n":2}']);
  assert.equal(lastIdHeaders[0], undefined);
  assert.equal(lastIdHeaders[1], "1");
});

test("streamSse reassembles multi-byte UTF-8 characters split across chunk boundaries", async () => {
  const payload = Buffer.from('data: {"team":"España"}\n\n', "utf8");
  const splitIndex = payload.indexOf(0xc3) + 1; // split inside the 2-byte "ñ" encoding
  const srv = await startServer((req, res) => {
    res.setHeader("content-type", "text/event-stream");
    res.write(payload.subarray(0, splitIndex));
    setTimeout(() => {
      res.write(payload.subarray(splitIndex));
      res.end();
    }, 10);
  });

  const got: SseEvent[] = [];
  await streamSse(`${srv.base}/stream`, {}, (e) => got.push(e), { maxReconnects: 0, backoffMs: 1 });
  srv.close();

  assert.equal(got.length, 1);
  assert.equal(JSON.parse(got[0].data).team, "España");
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

test("drain keeps a bounded abort-listener count across many events", async () => {
  let n = 0;
  const client: TxlineClient = {
    fixturesSnapshot: async () => [],
    oddsSnapshot: async (id) => {
      n++;
      return [
        {
          FixtureId: id,
          MessageId: `m${n}`,
          Ts: n,
          Bookmaker: "StablePrice",
          BookmakerId: 0,
          SuperOddsType: "1X2",
          InRunning: false,
          PriceNames: ["1"],
          Prices: [2000],
          Pct: ["50"],
        },
      ];
    },
    oddsValidation: async () => ({}),
    scoresSnapshot: async () => [],
    scoreStatValidation: async () => ({}),
  };
  const ctl = new AbortController();
  const src = liveSource({ client, fixtureIds: [1], mode: "poll", pollMs: 5 });
  const it = src.events(ctl.signal)[Symbol.asyncIterator]();

  for (let i = 0; i < 8; i++) {
    await it.next();
  }

  const listenerCount = getEventListeners(ctl.signal, "abort").length;
  assert.ok(listenerCount <= 2, `expected bounded abort-listener count, got ${listenerCount}`);

  ctl.abort();
  const result = await it.next();
  assert.equal(result.done, true);
});

test("aborting a poll-mode liveSource with a long pollMs exits promptly", async () => {
  const client: TxlineClient = {
    fixturesSnapshot: async () => [],
    oddsSnapshot: async (id) => [
      {
        FixtureId: id,
        MessageId: "m1",
        Ts: 1,
        Bookmaker: "StablePrice",
        BookmakerId: 0,
        SuperOddsType: "1X2",
        InRunning: false,
        PriceNames: ["1"],
        Prices: [2000],
        Pct: ["50"],
      },
    ],
    oddsValidation: async () => ({}),
    scoresSnapshot: async () => [],
    scoreStatValidation: async () => ({}),
  };
  const ctl = new AbortController();
  const src = liveSource({ client, fixtureIds: [1], mode: "poll", pollMs: 60_000 });

  const finished = (async () => {
    for await (const _e of src.events(ctl.signal)) {
      ctl.abort();
    }
  })();

  const timedOut = await Promise.race([finished.then(() => false), sleep(500).then(() => true)]);
  assert.equal(timedOut, false, "liveSource did not abort promptly");
});
