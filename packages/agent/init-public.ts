// One-time bootstrap of the PUBLIC web arena (season 777): dedicated keypairs
// so the website executor never touches the main deployer key. Generates and
// funds keypairs/web-*.json, initializes the arena, registers both books, and
// opens a match per replayable fixture.
// Usage: node --experimental-strip-types packages/agent/init-public.ts
import { existsSync, writeFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
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

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const ROOT = new URL("../..", import.meta.url).pathname;
const SEASON_ID = 777n;
const FIXTURES: bigint[] = JSON.parse(
  (await import("node:fs")).readFileSync(new URL("../../dashboard/data/games.json", import.meta.url), "utf8"),
)
  .filter((g: { live?: boolean }) => !g.live)
  .map((g: { id: number }) => BigInt(g.id));
const TXORACLE_DEVNET = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");

function loadOrCreate(path: string): Keypair {
  if (existsSync(path)) return loadKeypair(path);
  const kp = Keypair.generate();
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

async function main(): Promise<void> {
  const connection = new Connection(RPC, "confirmed");
  const deployer = loadKeypair(`${ROOT}keypairs/deployer.json`);
  const authority = loadOrCreate(`${ROOT}keypairs/web-authority.json`);
  const follow = loadOrCreate(`${ROOT}keypairs/web-follow.json`);
  const fade = loadOrCreate(`${ROOT}keypairs/web-fade.json`);

  console.log("web authority:", authority.publicKey.toBase58());
  console.log("web follow:   ", follow.publicKey.toBase58());
  console.log("web fade:     ", fade.publicKey.toBase58());

  for (const [kp, amount] of [
    [authority, 0.4],
    [follow, 0.15],
    [fade, 0.15],
  ] as const) {
    const bal = await connection.getBalance(kp.publicKey);
    if (bal < (amount / 2) * LAMPORTS_PER_SOL) {
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(
          SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: kp.publicKey, lamports: amount * LAMPORTS_PER_SOL }),
        ),
        [deployer],
        { commitment: "confirmed" },
      );
      console.log(`funded ${kp.publicKey.toBase58().slice(0, 8)}.. ${amount} SOL`);
    }
  }

  const arena = arenaPda(SEASON_ID);
  if (!(await connection.getAccountInfo(arena))) {
    const sig = await send(
      connection,
      [
        initializeArenaIx({
          authority: authority.publicKey,
          seasonId: SEASON_ID,
          startingBankroll: 1_000_000_000n,
          txoracleProgram: TXORACLE_DEVNET,
          scoresRootPrefix: Buffer.from("daily_scores_roots"),
          epochDayWidth: 2,
          rootsDataOffset: 8,
        }),
      ],
      authority,
    );
    console.log("initialize_arena:", sig.slice(0, 16));
  }
  console.log("public arena:", explorerAddr(arena));

  for (const [agent, tag] of [
    [follow, "follow"],
    [fade, "fade"],
  ] as const) {
    const book = bookPda(arena, agent.publicKey);
    if (!(await connection.getAccountInfo(book))) {
      await send(connection, [registerAgentIx({ authority: agent.publicKey, arena, strategyTag: tag })], agent);
      console.log(`registered ${tag} book`);
    }
    console.log(`${tag} book:`, book.toBase58());
  }

  for (const fid of FIXTURES) {
    const game = matchPda(arena, fid);
    if (!(await connection.getAccountInfo(game))) {
      await send(
        connection,
        [openMatchIx({ authority: authority.publicKey, arena, fixtureId: fid, startTime: BigInt(Math.floor(Date.now() / 1000)) })],
        authority,
      );
      console.log(`opened match ${fid}`);
    }
  }
  console.log("public arena ready");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
