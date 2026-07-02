import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSseChunk } from "./sse.ts";

test("parses a complete event with id and data", () => {
  const { events, rest } = parseSseChunk('id: 7\nevent: odds\ndata: {"a":1}\n\n');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { id: "7", event: "odds", data: '{"a":1}' });
  assert.equal(rest, "");
});

test("keeps an incomplete trailing event in rest", () => {
  const { events, rest } = parseSseChunk('data: full\n\ndata: par');
  assert.equal(events.length, 1);
  assert.equal(events[0].data, "full");
  assert.equal(rest, "data: par");
});

test("joins multi-line data and ignores comments and CRLF", () => {
  const { events } = parseSseChunk(":keepalive\r\ndata: line1\r\ndata: line2\r\n\r\n");
  assert.equal(events.length, 1);
  assert.equal(events[0].data, "line1\nline2");
});

test("emits nothing for pure comment blocks", () => {
  const { events, rest } = parseSseChunk(":ping\n\n");
  assert.equal(events.length, 0);
  assert.equal(rest, "");
});
