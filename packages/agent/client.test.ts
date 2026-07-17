// Byte-layout regression for the hand-encoded settle_match_verified builder:
// the devnet simulation (2026-07-17) proved this layout deserializes in the
// deployed program (it reached the final ProofMismatch check); keep it pinned.
import test from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { outcomeCode, settleMatchVerifiedIx } from "./client.ts";

test("settleMatchVerifiedIx encodes the IDL layout", () => {
  const k = () => Keypair.generate().publicKey;
  const leafData = new Uint8Array(64).fill(7);
  const proof = [
    { hash: new Uint8Array(32).fill(1), side: 0 as const },
    { hash: new Uint8Array(32).fill(2), side: 1 as const },
  ];
  const ix = settleMatchVerifiedIx({
    authority: k(),
    arena: k(),
    game: k(),
    roots: k(),
    fixtureId: 18241006n,
    homeScore: 1,
    awayScore: 2,
    settledOutcome: outcomeCode("2"),
    epochDay: 20649n,
    leafData,
    proof,
  });
  // disc 8 + fixture u64 + home u16 + away u16 + outcome u8 + epoch u64
  // + leaf vec (4 + 64) + proof vec (4 + 2 * 33)
  assert.equal(ix.data.length, 8 + 8 + 2 + 2 + 1 + 8 + 4 + 64 + 4 + 2 * 33);
  assert.deepEqual([...ix.data.subarray(0, 8)], [173, 139, 114, 142, 7, 34, 213, 55]);
  assert.equal(ix.data.readBigUInt64LE(8), 18241006n);
  assert.equal(ix.data.readUInt16LE(16), 1);
  assert.equal(ix.data.readUInt16LE(18), 2);
  assert.equal(ix.data[20], 2); // outcome away
  assert.equal(ix.data.readBigUInt64LE(21), 20649n);
  assert.equal(ix.data.readUInt32LE(29), 64); // leaf len
  assert.equal(ix.data.readUInt32LE(29 + 4 + 64), 2); // proof len
  assert.equal(ix.data[29 + 4 + 64 + 4 + 32], 0); // first node side
  assert.equal(ix.keys.length, 4);
  assert.equal(ix.keys[0].isSigner, true);
  assert.equal(ix.keys[2].isWritable, true);
});
