// One-time devnet setup: initialize the arena, register the follow and fade
// books, and open the demo match. Idempotent: skips anything that already exists.
// Usage: node --experimental-strip-types packages/agent/init.ts [fixtureId]
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
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
  explorer,
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
const SEASON_ID = 2026n;
const STARTING_BANKROLL = 1_000_000_000n;
const TXORACLE_DEVNET = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const FIXTURE_ID = BigInt(process.argv[2] ?? "901");

function loadOrCreate(path: string): Keypair {
  if (existsSync(path)) return loadKeypair(path);
  const kp = Keypair.generate();
  mkdirSync(new URL(".", `file://${path}`).pathname, { recursive: true });
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

async function main(): Promise<void> {
  const connection = new Connection(RPC, "confirmed");
  const deployer = loadKeypair(`${ROOT}keypairs/deployer.json`);
  const follow = loadOrCreate(`${ROOT}keypairs/agent-follow.json`);
  const fade = loadOrCreate(`${ROOT}keypairs/agent-fade.json`);

  console.log("deployer (arena authority):", deployer.publicKey.toBase58());
  console.log("follow agent:", follow.publicKey.toBase58());
  console.log("fade agent:  ", fade.publicKey.toBase58());

  // Fund agent wallets from the deployer so they can pay position rent + fees.
  for (const agent of [follow, fade]) {
    const bal = await connection.getBalance(agent.publicKey);
    if (bal < 0.03 * LAMPORTS_PER_SOL) {
      const sig = await sendAndConfirmTransaction(
        connection,
        new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: deployer.publicKey,
            toPubkey: agent.publicKey,
            lamports: 0.05 * LAMPORTS_PER_SOL,
          }),
        ),
        [deployer],
        { commitment: "confirmed" },
      );
      console.log(`funded ${agent.publicKey.toBase58().slice(0, 8)}.. 0.05 SOL: ${sig.slice(0, 16)}..`);
    }
  }

  const arena = arenaPda(SEASON_ID);
  if (!(await connection.getAccountInfo(arena))) {
    const sig = await send(
      connection,
      [
        initializeArenaIx({
          authority: deployer.publicKey,
          seasonId: SEASON_ID,
          startingBankroll: STARTING_BANKROLL,
          txoracleProgram: TXORACLE_DEVNET,
          scoresRootPrefix: Buffer.from("daily_scores_roots"),
          epochDayWidth: 2,
          rootsDataOffset: 8,
        }),
      ],
      deployer,
    );
    console.log("initialize_arena:", explorer(sig));
  } else {
    console.log("arena exists:", arena.toBase58());
  }
  console.log("arena:", explorerAddr(arena));

  for (const [agent, tag] of [
    [follow, "follow"],
    [fade, "fade"],
  ] as const) {
    const book = bookPda(arena, agent.publicKey);
    if (!(await connection.getAccountInfo(book))) {
      const sig = await send(connection, [registerAgentIx({ authority: agent.publicKey, arena, strategyTag: tag })], agent);
      console.log(`register_agent ${tag}:`, explorer(sig));
    } else {
      console.log(`${tag} book exists:`, book.toBase58());
    }
    console.log(`${tag} book:`, explorerAddr(book));
  }

  const game = matchPda(arena, FIXTURE_ID);
  if (!(await connection.getAccountInfo(game))) {
    const sig = await send(
      connection,
      [
        openMatchIx({
          authority: deployer.publicKey,
          arena,
          fixtureId: FIXTURE_ID,
          startTime: BigInt(Math.floor(Date.now() / 1000)),
        }),
      ],
      deployer,
    );
    console.log(`open_match ${FIXTURE_ID}:`, explorer(sig));
  } else {
    console.log(`match ${FIXTURE_ID} exists:`, game.toBase58());
  }
  console.log("match:", explorerAddr(game));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
