import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nacl from "tweetnacl";
import { buildActivationMessage, signActivation } from "./activation.ts";
import { loadCreds, saveCreds } from "./creds.ts";

test("activation message is txSig:leagues:jwt exactly", () => {
  assert.equal(buildActivationMessage("SIG", "1,2", "JWT"), "SIG:1,2:JWT");
});

test("signature verifies with the matching public key", () => {
  const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
  const msg = buildActivationMessage("SIG", "1", "JWT");
  const sigB64 = signActivation(msg, kp.secretKey);
  const ok = nacl.sign.detached.verify(new TextEncoder().encode(msg), Buffer.from(sigB64, "base64"), kp.publicKey);
  assert.ok(ok);
});

test("creds round-trip through disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "steamline-creds-"));
  const path = join(dir, "creds.json");
  saveCreds(path, { jwt: "J", apiToken: "T", txSig: "S", leagues: "1" });
  const back = loadCreds(path);
  assert.equal(back.jwt, "J");
  assert.equal(back.apiToken, "T");
  assert.deepEqual(loadCreds(join(dir, "missing.json")), {});
});
