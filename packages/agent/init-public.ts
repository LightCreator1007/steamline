// One-time bootstrap of the PUBLIC web arena (season 777): dedicated web-* keys
// so the site executor never touches the deployer key. Funds the keys, inits the
// arena, registers both books, and opens a match per non-live replayable fixture.
// Idempotent. Usage: node --experimental-strip-types packages/agent/init-public.ts
// Env: RPC_URL.
import { readFileSync } from "node:fs";
import { initArena, loadOrCreate, ROOT } from "./initArena.ts";

const SEASON_ID = 777n;

async function main(): Promise<void> {
  const fixtures: bigint[] = JSON.parse(readFileSync(new URL("../../dashboard/data/games.json", import.meta.url), "utf8"))
    .filter((g: { live?: boolean }) => !g.live)
    .map((g: { id: number }) => BigInt(g.id));

  const authority = loadOrCreate(`${ROOT}keypairs/web-authority.json`);
  const follow = loadOrCreate(`${ROOT}keypairs/web-follow.json`);
  const fade = loadOrCreate(`${ROOT}keypairs/web-fade.json`);

  console.log("web authority:", authority.publicKey.toBase58());
  console.log("web follow:   ", follow.publicKey.toBase58());
  console.log("web fade:     ", fade.publicKey.toBase58());

  await initArena({
    season: SEASON_ID,
    authority,
    follow,
    fade,
    fixtures,
    fund: [
      { wallet: authority, target: 0.4, floor: 0.2 },
      { wallet: follow, target: 0.15, floor: 0.075 },
      { wallet: fade, target: 0.15, floor: 0.075 },
    ],
  });

  console.log("public arena ready");
}

if (import.meta.filename === process.argv[1]) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
