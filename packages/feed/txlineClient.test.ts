import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { makeClient, FeedError } from "./txlineClient.ts";

interface Seen { url: string; auth?: string; apiToken?: string }

function startServer(handler: (req: IncomingMessage, res: ServerResponse, seen: Seen[]) => void) {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url ?? "", auth: req.headers.authorization, apiToken: req.headers["x-api-token"] as string | undefined });
    handler(req, res, seen);
  });
  return new Promise<{ base: string; seen: Seen[]; close: () => void }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ base: `http://127.0.0.1:${addr.port}`, seen, close: () => server.close() });
    });
  });
}

test("sends both auth headers and parses JSON", async () => {
  const srv = await startServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify([{ FixtureId: 42 }]));
  });
  try {
    const client = makeClient({ apiBase: srv.base, jwt: "J", apiToken: "T", retries: 0 });
    const odds = await client.oddsSnapshot(42);
    assert.equal(odds[0].FixtureId, 42);
    assert.equal(srv.seen[0].url, "/api/odds/snapshot/42");
    assert.equal(srv.seen[0].auth, "Bearer J");
    assert.equal(srv.seen[0].apiToken, "T");
  } finally {
    srv.close();
  }
});

test("retries a 500 then succeeds", async () => {
  const srv = await startServer((_req, res, seen) => {
    if (seen.length === 1) {
      res.statusCode = 500;
      res.end("boom");
    } else {
      res.end(JSON.stringify({ ok: true }));
    }
  });
  try {
    const client = makeClient({ apiBase: srv.base, retries: 2, backoffMs: 1 });
    const proof = await client.oddsValidation("m1", 123);
    assert.deepEqual(proof, { ok: true });
    assert.equal(srv.seen.length, 2);
    assert.equal(srv.seen[0].url, "/api/odds/validation?messageId=m1&ts=123");
  } finally {
    srv.close();
  }
});

test("401 throws AUTH without retrying", async () => {
  const srv = await startServer((_req, res) => {
    res.statusCode = 401;
    res.end("no");
  });
  try {
    const client = makeClient({ apiBase: srv.base, retries: 3, backoffMs: 1 });
    await assert.rejects(
      client.scoresSnapshot(1),
      (e) => e instanceof FeedError && e.code === "AUTH" && e.status === 401,
    );
    assert.equal(srv.seen.length, 1);
  } finally {
    srv.close();
  }
});

test("timeout aborts and reports TIMEOUT", async () => {
  const srv = await startServer(() => {
    // never respond
  });
  try {
    const client = makeClient({ apiBase: srv.base, retries: 0, timeoutMs: 50 });
    await assert.rejects(
      client.fixturesSnapshot({ competitionId: 1 }),
      (e) => e instanceof FeedError && e.code === "TIMEOUT",
    );
  } finally {
    srv.close();
  }
});
