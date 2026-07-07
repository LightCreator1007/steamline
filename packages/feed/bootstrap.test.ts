import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { resolveAuthorityPda, type AccountInfoLookup } from "./bootstrap.ts";

const TOKEN_PROGRAM_ID = anchor.utils.token.TOKEN_PROGRAM_ID;

const EMPTY_IDL: anchor.Idl = {
  address: "11111111111111111111111111111111",
  metadata: { name: "test", version: "0.0.0", spec: "0.1.0" },
  instructions: [],
  accounts: [],
};

function fakeProgramId(fill: number): PublicKey {
  return new PublicKey(Buffer.alloc(32, fill));
}

// Fails loudly on any lookup not explicitly configured, so tests can assert
// exactly which accounts (if any) resolveAuthorityPda is allowed to fetch.
function fakeConnection(
  responses: Map<string, { owner: PublicKey; data: Buffer } | null>,
  calls: PublicKey[],
): AccountInfoLookup {
  return {
    async getAccountInfo(pubkey: PublicKey) {
      calls.push(pubkey);
      const key = pubkey.toBase58();
      if (!responses.has(key)) throw new Error(`unexpected getAccountInfo call for ${key}`);
      return responses.get(key) ?? null;
    },
  };
}

function tokenAccountData(owner: PublicKey): Buffer {
  const data = Buffer.alloc(165);
  owner.toBuffer().copy(data, 32);
  return data;
}

test("resolveAuthorityPda accepts a book PDA that matches seed derivation, with no RPC call at all", async () => {
  const programId = fakeProgramId(3);
  const seeds = [Buffer.from("usdt_treasury")];
  const [expectedPda] = PublicKey.findProgramAddressSync(seeds, programId);
  const calls: PublicKey[] = [];
  const connection = fakeConnection(new Map(), calls);

  const { pda, typeName } = await resolveAuthorityPda(
    connection,
    programId,
    EMPTY_IDL,
    expectedPda,
    undefined,
    "usdtTreasuryPda",
    ["usdt_treasury"],
    [seeds],
    "usdt_treasury_pda",
  );

  assert.ok(pda.equals(expectedPda));
  assert.equal(typeName, undefined);
  assert.equal(calls.length, 0, "derivation match must not require any on-chain lookup");
});

test("resolveAuthorityPda accepts a book PDA verified by treasury vault ownership when seed derivation misses", async () => {
  const programId = fakeProgramId(4);
  const bookPda = fakeProgramId(5); // deliberately does not match any seed guess below
  const bookVault = fakeProgramId(6);
  const responses = new Map<string, { owner: PublicKey; data: Buffer } | null>([
    [bookVault.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenAccountData(bookPda) }],
  ]);
  const calls: PublicKey[] = [];
  const connection = fakeConnection(responses, calls);

  const { pda, typeName } = await resolveAuthorityPda(
    connection,
    programId,
    EMPTY_IDL,
    bookPda,
    bookVault,
    "tokenTreasuryPda",
    ["token_treasury"],
    [[Buffer.from("token_treasury")]],
    "token_treasury_pda",
  );

  assert.ok(pda.equals(bookPda));
  assert.equal(typeName, undefined);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].equals(bookVault), "must fetch the vault, never the (possibly unallocated) authority PDA itself");
});

test("resolveAuthorityPda falls back to a computed, unverified PDA when there is no book entry", async () => {
  const programId = fakeProgramId(7);
  const seeds = [Buffer.from("usdt_treasury")];
  const [expectedPda] = PublicKey.findProgramAddressSync(seeds, programId);
  const calls: PublicKey[] = [];
  const connection = fakeConnection(new Map(), calls);

  const { pda, typeName } = await resolveAuthorityPda(
    connection,
    programId,
    EMPTY_IDL,
    undefined,
    undefined,
    "usdtTreasuryPda",
    ["usdt_treasury"],
    [seeds],
    "usdt_treasury_pda",
  );

  assert.ok(pda.equals(expectedPda));
  assert.equal(typeName, undefined);
  assert.equal(calls.length, 0, "no book entry means no RPC is possible or required");
});

test("resolveAuthorityPda falls through to computed seeds when a book PDA fails both derivation and vault checks", async () => {
  const programId = fakeProgramId(8);
  const bookPda = fakeProgramId(9); // does not match seed derivation
  const bookVault = fakeProgramId(10);
  const wrongOwner = fakeProgramId(11); // vault exists but is owned by someone else
  const seeds = [Buffer.from("token_treasury")];
  const [expectedComputed] = PublicKey.findProgramAddressSync(seeds, programId);
  const responses = new Map<string, { owner: PublicKey; data: Buffer } | null>([
    [bookVault.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenAccountData(wrongOwner) }],
  ]);
  const calls: PublicKey[] = [];
  const connection = fakeConnection(responses, calls);

  const { pda } = await resolveAuthorityPda(
    connection,
    programId,
    EMPTY_IDL,
    bookPda,
    bookVault,
    "tokenTreasuryPda",
    ["token_treasury"],
    [seeds],
    "token_treasury_pda",
  );

  assert.ok(pda.equals(expectedComputed));
  assert.ok(!pda.equals(bookPda));
});
