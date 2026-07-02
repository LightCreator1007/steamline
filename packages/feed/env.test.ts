import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEnv, TXORACLE_DEVNET, TXORACLE_MAINNET } from "./env.ts";
import { EngineError } from "../engine/errors.ts";

test("devnet defaults resolve without any env", () => {
  const e = loadEnv({});
  assert.equal(e.network, "devnet");
  assert.equal(e.apiBase, "https://txline-dev.txodds.com");
  assert.equal(e.rpcUrl, "https://api.devnet.solana.com");
  assert.equal(e.txoracleProgramId, TXORACLE_DEVNET);
  assert.equal(e.keypairPath, "keypairs/feed-devnet.json");
});

test("mainnet requires an explicit API base", () => {
  assert.throws(
    () => loadEnv({}, "mainnet"),
    (err) => err instanceof EngineError && err.code === "INVALID_INPUT",
  );
  const e = loadEnv({ TXLINE_MAINNET_API_BASE: "https://example.test" }, "mainnet");
  assert.equal(e.apiBase, "https://example.test");
  assert.equal(e.txoracleProgramId, TXORACLE_MAINNET);
});

test("env overrides and per-network tokens are picked up", () => {
  const e = loadEnv({
    TXLINE_NETWORK: "devnet",
    SOLANA_DEVNET_RPC: "https://rpc.test",
    TXLINE_JWT_DEVNET: "jwt-abc",
    TXLINE_API_TOKEN_DEVNET: "tok-abc",
  });
  assert.equal(e.rpcUrl, "https://rpc.test");
  assert.equal(e.jwt, "jwt-abc");
  assert.equal(e.apiToken, "tok-abc");
});
