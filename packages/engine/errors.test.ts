import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineError, redactSecrets } from "./errors.ts";

test("EngineError carries code and remediation", () => {
  const e = new EngineError("BAD_ODDS_DECODE", "price was 0", "check the feed decode scale");
  assert.equal(e.code, "BAD_ODDS_DECODE");
  assert.equal(e.remediation, "check the feed decode scale");
  assert.ok(e instanceof Error);
});

test("EngineError redacts bearer tokens and api tokens in the message", () => {
  const e = new EngineError(
    "INVALID_INPUT",
    "failed with Authorization: Bearer abc.def.ghi and X-Api-Token: secret123",
    "retry",
  );
  assert.ok(!e.message.includes("abc.def.ghi"));
  assert.ok(!e.message.includes("secret123"));
  assert.ok(e.message.includes("[redacted]"));
});

test("redaction is case-insensitive for bearer tokens", () => {
  const e = new EngineError("INVALID_INPUT", "sent bearer abc.def.ghi upstream", "retry");
  assert.ok(!e.message.includes("abc.def.ghi"));
  assert.ok(e.message.includes("[redacted]"));
});

test("redactSecrets leaves clean strings untouched", () => {
  assert.equal(redactSecrets("nothing secret here"), "nothing secret here");
});
