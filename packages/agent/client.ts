// Minimal steamline_arena client. Instruction layouts hand-encoded from
// packages/onchain/target/idl/steamline_arena.json (all args are fixed-size
// primitives, so a full Anchor client is unnecessary).
import { readFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey("E9jfScHBJRB2NyB2NFmE4Kec9D8hJ1X7k24AXufRbX5n");

const DISC = {
  initializeArena: [11, 37, 221, 1, 205, 120, 25, 230],
  registerAgent: [135, 157, 66, 195, 2, 113, 175, 30],
  openMatch: [208, 231, 100, 44, 102, 12, 220, 99],
  openPosition: [135, 128, 47, 77, 15, 152, 240, 49],
  settleMatch: [71, 124, 117, 96, 191, 217, 116, 24],
  settlePosition: [33, 156, 74, 218, 215, 42, 112, 175],
} as const;

export function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

function u64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

function i64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(n);
  return b;
}

export function arenaPda(seasonId: bigint): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("arena"), u64le(seasonId)], PROGRAM_ID)[0];
}

export function bookPda(arena: PublicKey, authority: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("book"), arena.toBuffer(), authority.toBuffer()], PROGRAM_ID)[0];
}

export function matchPda(arena: PublicKey, fixtureId: bigint): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("match"), arena.toBuffer(), u64le(fixtureId)], PROGRAM_ID)[0];
}

export function positionPda(game: PublicKey, book: PublicKey, signalSeq: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pos"), game.toBuffer(), book.toBuffer(), u64le(signalSeq)],
    PROGRAM_ID,
  )[0];
}

export function initializeArenaIx(opts: {
  authority: PublicKey;
  seasonId: bigint;
  startingBankroll: bigint;
  txoracleProgram: PublicKey;
  scoresRootPrefix: Uint8Array; // <= 24 bytes, zero padded
  epochDayWidth: number;
  rootsDataOffset: number;
}): TransactionInstruction {
  const prefix = Buffer.alloc(24);
  Buffer.from(opts.scoresRootPrefix).copy(prefix);
  const data = Buffer.concat([
    Buffer.from(DISC.initializeArena),
    u64le(opts.seasonId),
    u64le(opts.startingBankroll),
    opts.txoracleProgram.toBuffer(),
    prefix,
    Buffer.from([opts.scoresRootPrefix.length, opts.epochDayWidth]),
    (() => {
      const b = Buffer.alloc(2);
      b.writeUInt16LE(opts.rootsDataOffset);
      return b;
    })(),
  ]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: opts.authority, isSigner: true, isWritable: true },
      { pubkey: arenaPda(opts.seasonId), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function registerAgentIx(opts: {
  authority: PublicKey;
  arena: PublicKey;
  strategyTag: string; // <= 16 ascii chars
}): TransactionInstruction {
  const tag = Buffer.alloc(16);
  Buffer.from(opts.strategyTag, "ascii").copy(tag);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: opts.authority, isSigner: true, isWritable: true },
      { pubkey: opts.arena, isSigner: false, isWritable: false },
      { pubkey: bookPda(opts.arena, opts.authority), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from(DISC.registerAgent), tag]),
  });
}

export function openMatchIx(opts: {
  authority: PublicKey;
  arena: PublicKey;
  fixtureId: bigint;
  startTime: bigint;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: opts.authority, isSigner: true, isWritable: true },
      { pubkey: opts.arena, isSigner: false, isWritable: true },
      { pubkey: matchPda(opts.arena, opts.fixtureId), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from(DISC.openMatch), u64le(opts.fixtureId), i64le(opts.startTime)]),
  });
}

export function openPositionIx(opts: {
  authority: PublicKey; // book authority, signer
  book: PublicKey;
  game: PublicKey;
  fixtureId: bigint;
  outcome: number; // 0 home, 1 draw, 2 away
  stakePoints: bigint;
  entryOddsMilli: number;
  edgeBps: number;
  oddsMsgRef: Uint8Array; // 32 bytes
  oddsTs: bigint;
  signalSeq: bigint;
}): TransactionInstruction {
  const tail = Buffer.alloc(8);
  tail.writeUInt32LE(opts.entryOddsMilli, 0);
  tail.writeInt32LE(opts.edgeBps, 4);
  const data = Buffer.concat([
    Buffer.from(DISC.openPosition),
    u64le(opts.fixtureId),
    Buffer.from([opts.outcome]),
    u64le(opts.stakePoints),
    tail,
    Buffer.from(opts.oddsMsgRef),
    i64le(opts.oddsTs),
    u64le(opts.signalSeq),
  ]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: opts.authority, isSigner: true, isWritable: true },
      { pubkey: opts.book, isSigner: false, isWritable: true },
      { pubkey: opts.game, isSigner: false, isWritable: false },
      { pubkey: positionPda(opts.game, opts.book, opts.signalSeq), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function settleMatchIx(opts: {
  authority: PublicKey;
  arena: PublicKey;
  game: PublicKey;
  fixtureId: bigint;
  homeScore: number;
  awayScore: number;
  settledOutcome: number;
  scoreProofRef: Uint8Array; // 32 bytes
}): TransactionInstruction {
  const scores = Buffer.alloc(5);
  scores.writeUInt16LE(opts.homeScore, 0);
  scores.writeUInt16LE(opts.awayScore, 2);
  scores.writeUInt8(opts.settledOutcome, 4);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: opts.authority, isSigner: true, isWritable: false },
      { pubkey: opts.arena, isSigner: false, isWritable: false },
      { pubkey: opts.game, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([Buffer.from(DISC.settleMatch), u64le(opts.fixtureId), scores, Buffer.from(opts.scoreProofRef)]),
  });
}

export function settlePositionIx(opts: { game: PublicKey; position: PublicKey; book: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: opts.game, isSigner: false, isWritable: false },
      { pubkey: opts.position, isSigner: false, isWritable: true },
      { pubkey: opts.book, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(DISC.settlePosition),
  });
}

export async function send(
  connection: Connection,
  ixs: TransactionInstruction[],
  payer: Keypair,
  extraSigners: Keypair[] = [],
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  return sendAndConfirmTransaction(connection, tx, [payer, ...extraSigners], { commitment: "confirmed" });
}

export function explorer(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

export function explorerAddr(addr: PublicKey): string {
  return `https://explorer.solana.com/address/${addr.toBase58()}?cluster=devnet`;
}
