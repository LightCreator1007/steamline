// Shared devnet arena bootstrap: fund wallets from the deployer, initialize the
// arena, register the follow and fade books, and open matches. Idempotent: it
// skips anything that already exists on chain. Two thin callers drive it:
// init.ts (per-season CLI arenas) and init-public.ts (the public web arena 777).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { RPC_DEVNET_DEFAULT, TXORACLE_DEVNET } from "../feed/env.ts";
import {
  arenaPda,
  bookPda,
  explorerAddr,
  initializeArenaIx,
  loadKeypair,
  matchPda,
  openMatchIx,
  registerAgentIx,
  send,
} from "./client.ts";

export const RPC = process.env.RPC_URL ?? RPC_DEVNET_DEFAULT;
export const ROOT = new URL("../..", import.meta.url).pathname;
const STARTING_BANKROLL = 1_000_000_000n;

export function loadOrCreate(path: string): Keypair {
  if (existsSync(path)) return loadKeypair(path);
  const kp = Keypair.generate();
  mkdirSync(new URL(".", `file://${path}`).pathname, { recursive: true });
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

export interface FundTarget {
  wallet: Keypair;
  target: number; // SOL to transfer when topping up
  floor: number; // top up only when the balance is below this many SOL
}

export interface InitArenaParams {
  season: bigint;
  authority: Keypair; // arena + match authority (deployer for CLI, web key for the site)
  follow: Keypair;
  fade: Keypair;
  fixtures: bigint[]; // matches to open in this arena
  fund: FundTarget[]; // wallets the deployer tops up before running
}

export async function initArena(p: InitArenaParams): Promise<void> {
  const connection = new Connection(RPC, "confirmed");
  const deployer = loadKeypair(`${ROOT}keypairs/deployer.json`);

  for (const { wallet, target, floor } of p.fund) {
    const bal = await connection.getBalance(wallet.publicKey);
    if (bal < floor * LAMPORTS_PER_SOL) {
      const sig = await sendAndConfirmTransaction(
        connection,
        new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: deployer.publicKey,
            toPubkey: wallet.publicKey,
            lamports: target * LAMPORTS_PER_SOL,
          }),
        ),
        [deployer],
        { commitment: "confirmed" },
      );
      console.log(`funded ${wallet.publicKey.toBase58().slice(0, 8)}.. ${target} SOL: ${sig.slice(0, 16)}..`);
    }
  }

  const arena = arenaPda(p.season);
  if (!(await connection.getAccountInfo(arena))) {
    const sig = await send(
      connection,
      [
        initializeArenaIx({
          authority: p.authority.publicKey,
          seasonId: p.season,
          startingBankroll: STARTING_BANKROLL,
          txoracleProgram: new PublicKey(TXORACLE_DEVNET),
          scoresRootPrefix: Buffer.from("daily_scores_roots"),
          epochDayWidth: 2,
          rootsDataOffset: 8,
        }),
      ],
      p.authority,
    );
    console.log("initialize_arena:", sig.slice(0, 16));
  } else {
    console.log("arena exists:", arena.toBase58());
  }
  console.log("arena:", explorerAddr(arena));

  for (const [agent, tag] of [
    [p.follow, "follow"],
    [p.fade, "fade"],
  ] as const) {
    const book = bookPda(arena, agent.publicKey);
    if (!(await connection.getAccountInfo(book))) {
      await send(connection, [registerAgentIx({ authority: agent.publicKey, arena, strategyTag: tag })], agent);
      console.log(`register_agent ${tag}`);
    } else {
      console.log(`${tag} book exists:`, book.toBase58());
    }
    console.log(`${tag} book:`, explorerAddr(book));
  }

  for (const fid of p.fixtures) {
    const game = matchPda(arena, fid);
    if (!(await connection.getAccountInfo(game))) {
      await send(
        connection,
        [openMatchIx({ authority: p.authority.publicKey, arena, fixtureId: fid, startTime: BigInt(Math.floor(Date.now() / 1000)) })],
        p.authority,
      );
      console.log(`open_match ${fid}`);
    } else {
      console.log(`match ${fid} exists:`, game.toBase58());
    }
    console.log(`match ${fid}:`, explorerAddr(game));
  }
}
