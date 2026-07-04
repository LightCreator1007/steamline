import { test } from "node:test";
import assert from "node:assert/strict";
import { standing, renderMarkdown } from "./report.ts";
import { newAgentState } from "./model.ts";

test("standing computes averages and roi", () => {
  const b = { ...newAgentState(0, 1_000_000_000), betsOpened: 2, betsWon: 1, betsLost: 1, realizedPnl: 2000, brierSum: 0.58, logLossSum: 1.2, graded: 2, stakedPoints: 0 };
  const s = standing(b);
  assert.equal(s.strategy, "follow");
  assert.ok(Math.abs(s.avgBrier! - 0.29) < 1e-9);
});

test("renderMarkdown emits a table with both agents", () => {
  const a = standing(newAgentState(0, 1_000_000_000));
  const c = standing(newAgentState(1, 1_000_000_000));
  const md = renderMarkdown([a, c]);
  assert.ok(md.includes("| follow |"));
  assert.ok(md.includes("| fade |"));
});
