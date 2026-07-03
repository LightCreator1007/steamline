import { parseArgs } from "node:util";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { loadEnv, type FeedEnv, type Network } from "./env.ts";
import { FeedError } from "./txlineClient.ts";
import { buildActivationMessage, signActivation } from "./activation.ts";
import { loadCreds, saveCreds } from "./creds.ts";

function credsPath(network: Network): string {
  return `keypairs/creds.${network}.json`;
}

function loadOrCreateKeypair(path: string): Keypair {
  if (existsSync(path)) {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(path, "utf8"))));
  }
  const kp = Keypair.generate();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`created keypair ${kp.publicKey.toBase58()} at ${path}`);
  return kp;
}

async function ensureFunded(connection: Connection, kp: Keypair, network: Network): Promise<void> {
  const bal = await connection.getBalance(kp.publicKey);
  console.log(`wallet ${kp.publicKey.toBase58()} balance ${bal / LAMPORTS_PER_SOL} SOL`);
  if (network === "devnet" && bal < 0.05 * LAMPORTS_PER_SOL) {
    console.log("requesting devnet airdrop...");
    const sig = await connection.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  }
  if (network === "mainnet" && bal < 0.005 * LAMPORTS_PER_SOL) {
    throw new FeedError("NETWORK", "mainnet wallet needs ~0.01 SOL for the free-tier subscribe fee; fund it manually");
  }
}

async function probe(env: FeedEnv): Promise<void> {
  const connection = new Connection(env.rpcUrl, "confirmed");
  const kp = loadOrCreateKeypair(env.keypairPath);
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(kp), {});
  const idl = await anchor.Program.fetchIdl(new PublicKey(env.txoracleProgramId), provider);
  if (!idl) throw new FeedError("NETWORK", `no IDL published for ${env.txoracleProgramId} on ${env.network}`);
  console.log(`Txoracle IDL on ${env.network}:`);
  for (const ix of idl.instructions) {
    console.log(`  ${ix.name}(${ix.args.map((a) => `${a.name}: ${JSON.stringify(a.type)}`).join(", ")})`);
    console.log(`    accounts: ${ix.accounts.map((a) => a.name).join(", ")}`);
  }
  const accountNames = (idl.accounts ?? []).map((a) => a.name).join(", ");
  console.log(`  accounts defined: ${accountNames}`);
}

async function guest(env: FeedEnv): Promise<void> {
  const res = await fetch(`${env.apiBase}/auth/guest/start`, { method: "POST" });
  if (!res.ok) throw new FeedError("HTTP", `guest start failed with ${res.status}`, res.status);
  const body = (await res.json()) as Record<string, unknown>;
  const jwt = (body.jwt ?? body.token ?? body.accessToken) as string | undefined;
  if (!jwt) throw new FeedError("BAD_JSON", `guest response had no jwt field; keys: ${Object.keys(body).join(",")}`);
  const path = credsPath(env.network);
  saveCreds(path, { ...loadCreds(path), jwt, raw: body });
  console.log(`guest JWT saved to ${path}`);
}

async function subscribe(env: FeedEnv, level: number, durationDays: number): Promise<void> {
  const connection = new Connection(env.rpcUrl, "confirmed");
  const kp = loadOrCreateKeypair(env.keypairPath);
  await ensureFunded(connection, kp, env.network);
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(kp), {});
  const programId = new PublicKey(env.txoracleProgramId);
  const idl = await anchor.Program.fetchIdl(programId, provider);
  if (!idl) throw new FeedError("NETWORK", "no IDL for Txoracle; run probe and check the network");
  const program = new anchor.Program(idl, provider);
  // Documented flow: subscribe(serviceLevel, durationDays) for free tiers (1 devnet, 1 or 12 mainnet).
  // VERIFY against probe output on first run; adjust the method name and args here if the IDL differs.
  const txSig = await program.methods
    .subscribe(new anchor.BN(level), new anchor.BN(durationDays))
    .accounts({ subscriber: kp.publicKey })
    .rpc();
  const path = credsPath(env.network);
  saveCreds(path, { ...loadCreds(path), txSig });
  console.log(`subscribed level ${level} on ${env.network}: ${txSig} (saved to ${path})`);
}

async function activate(env: FeedEnv, leagues: string): Promise<void> {
  const path = credsPath(env.network);
  const creds = loadCreds(path);
  if (!creds.jwt || !creds.txSig) {
    throw new FeedError("AUTH", "missing jwt or txSig; run guest and subscribe first");
  }
  const kp = loadOrCreateKeypair(env.keypairPath);
  const message = buildActivationMessage(creds.txSig, leagues, creds.jwt);
  const walletSignature = signActivation(message, kp.secretKey);
  const res = await fetch(`${env.apiBase}/api/token/activate`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${creds.jwt}` },
    body: JSON.stringify({ txSig: creds.txSig, walletSignature, leagues }),
  });
  if (!res.ok) throw new FeedError("HTTP", `activate failed with ${res.status}: ${await res.text()}`, res.status);
  const body = (await res.json()) as Record<string, unknown>;
  const apiToken = (body.apiToken ?? body.token) as string | undefined;
  if (!apiToken) throw new FeedError("BAD_JSON", `activate response had no apiToken; keys: ${Object.keys(body).join(",")}`);
  saveCreds(path, { ...creds, apiToken, leagues });
  console.log(`api token saved to ${path}`);
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      network: { type: "string", default: process.env.TXLINE_NETWORK ?? "devnet" },
      level: { type: "string", default: "1" },
      duration: { type: "string", default: "28" },
      leagues: { type: "string", default: "" },
    },
  });
  const env = loadEnv(process.env, values.network as Network);
  const cmd = positionals[0];
  if (cmd === "probe") await probe(env);
  else if (cmd === "guest") await guest(env);
  else if (cmd === "subscribe") await subscribe(env, Number(values.level), Number(values.duration));
  else if (cmd === "activate") await activate(env, values.leagues as string);
  else {
    console.log("usage: bootstrap.ts <probe|guest|subscribe|activate> [--network devnet|mainnet] [--level N] [--duration D] [--leagues CSV]");
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
