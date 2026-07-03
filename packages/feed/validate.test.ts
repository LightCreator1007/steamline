import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256, foldProof, verifyMerkle, type ProofNode } from "./validate.ts";

function hex(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
}

test("verifies a hand-built 4-leaf sha256 tree", () => {
  const leaves = ["a", "b", "c", "d"].map((s) => sha256(new TextEncoder().encode(s)));
  const ab = sha256(Buffer.concat([leaves[0], leaves[1]]));
  const cd = sha256(Buffer.concat([leaves[2], leaves[3]]));
  const root = sha256(Buffer.concat([ab, cd]));

  // proof for leaf "c": sibling d on the right, then ab on the left
  const proof: ProofNode[] = [
    { hash: hex(leaves[3]), side: "right" },
    { hash: hex(ab), side: "left" },
  ];
  assert.ok(verifyMerkle(leaves[2], proof, root));
});

test("rejects a tampered node", () => {
  const leaves = ["a", "b"].map((s) => sha256(new TextEncoder().encode(s)));
  const root = sha256(Buffer.concat([leaves[0], leaves[1]]));
  const bad: ProofNode[] = [{ hash: hex(sha256(new TextEncoder().encode("evil"))), side: "right" }];
  assert.equal(verifyMerkle(leaves[0], bad, root), false);
});

test("foldProof with no nodes returns the leaf", () => {
  const leaf = sha256(new TextEncoder().encode("x"));
  assert.equal(hex(foldProof(leaf, [])), hex(leaf));
});
