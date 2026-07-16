// One-time devnet setup for a per-season CLI arena: fund the follow and fade
// wallets, initialize the arena, register both books, and open one match.
// Idempotent. Usage: node --experimental-strip-types packages/agent/init.ts [fixtureId]
// Env: SEASON (default 2026), RPC_URL.
import { loadKeypair } from "./client.ts";
import { initArena, loadOrCreate, ROOT } from "./initArena.ts";

const SEASON_ID = BigInt(process.env.SEASON ?? "2026");
const FIXTURE_ID = BigInt(process.argv[2] ?? "901");

async function main(): Promise<void> {
  const deployer = loadKeypair(`${ROOT}keypairs/deployer.json`);
  const follow = loadOrCreate(`${ROOT}keypairs/agent-follow.json`);
  const fade = loadOrCreate(`${ROOT}keypairs/agent-fade.json`);

  console.log("deployer (arena authority):", deployer.publicKey.toBase58());
  console.log("follow agent:", follow.publicKey.toBase58());
  console.log("fade agent:  ", fade.publicKey.toBase58());

  await initArena({
    season: SEASON_ID,
    authority: deployer,
    follow,
    fade,
    fixtures: [FIXTURE_ID],
    fund: [
      { wallet: follow, target: 0.05, floor: 0.03 },
      { wallet: fade, target: 0.05, floor: 0.03 },
    ],
  });
}

if (import.meta.filename === process.argv[1]) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
