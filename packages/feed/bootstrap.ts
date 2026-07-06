import { parseArgs } from "node:util";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { loadEnv, type FeedEnv, type Network } from "./env.ts";
import { FeedError } from "./txlineClient.ts";
import { buildActivationMessage, signActivation } from "./activation.ts";
import { loadCreds, saveCreds } from "./creds.ts";

// Token-2022 program id is not exported by @coral-xyz/anchor's utils (only
// the classic TOKEN_PROGRAM_ID is). Devnet probing showed the subscription
// token mint may live under this program instead.
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const TOKEN_PROGRAM_ID = anchor.utils.token.TOKEN_PROGRAM_ID;
const ASSOCIATED_TOKEN_PROGRAM_ID = anchor.utils.token.ASSOCIATED_PROGRAM_ID;

interface IdlAccountItemLike {
  name: string;
  accounts?: IdlAccountItemLike[];
}

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

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof PublicKey) return value.toBase58();
  if (value instanceof anchor.BN) return value.toString();
  if (typeof value === "bigint") return value.toString();
  return value;
}

// -- IDL introspection helpers -------------------------------------------------

function flattenAccountNames(accounts: IdlAccountItemLike[]): string[] {
  const names: string[] = [];
  for (const acc of accounts) {
    if (acc.accounts && acc.accounts.length > 0) names.push(...flattenAccountNames(acc.accounts));
    else names.push(acc.name);
  }
  return names;
}

function findIxDef(idl: anchor.Idl, name: string): { name: string; accounts: IdlAccountItemLike[] } {
  const ix = idl.instructions.find((i) => i.name === name);
  if (!ix) throw new FeedError("NETWORK", `instruction '${name}' not in fetched IDL; re-run probe`);
  return ix as unknown as { name: string; accounts: IdlAccountItemLike[] };
}

function missingAccountNames(names: string[], pubkeys: Record<string, unknown>): string[] {
  return names.filter((n) => pubkeys[n] === undefined);
}

async function assertNoMissingAccounts(
  idl: anchor.Idl,
  ixName: string,
  builder: { pubkeys(): Promise<Record<string, unknown>> },
  label: string,
): Promise<void> {
  const ixDef = findIxDef(idl, ixName);
  const required = flattenAccountNames(ixDef.accounts);
  const pubkeys = await builder.pubkeys();
  const missing = missingAccountNames(required, pubkeys);
  if (missing.length > 0) {
    throw new FeedError(
      "NETWORK",
      `${label}: accounts not resolved: ${missing.join(", ")}; re-run probe and check field names/PDAs`,
    );
  }
}

// Resolves an IDL *account type* name (e.g. "PricingMatrix") used for
// program.account.<name>.fetch()/.all(). The instruction *field* name (e.g.
// "pricingMatrix") usually matches, but is not guaranteed to.
function resolveAccountTypeName(idl: anchor.Idl, primaryGuess: string, hints: string[]): string {
  const names = (idl.accounts ?? []).map((a) => a.name);
  if (names.includes(primaryGuess)) return primaryGuess;
  const match = names.find((n) => hints.some((h) => n.toLowerCase().includes(h.toLowerCase())));
  if (match) {
    console.log(`  account type '${primaryGuess}' not in IDL; using '${match}' (matched by hint)`);
    return match;
  }
  throw new FeedError(
    "NETWORK",
    `no account type in the fetched IDL matches '${primaryGuess}' or hints [${hints.join(", ")}]; run probe and check 'accounts defined'`,
  );
}

// -- PDA / ATA / token program resolution --------------------------------------

function associatedAddressFor(mint: PublicKey, owner: PublicKey, tokenProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

async function tokenProgramForMint(connection: Connection, mint: PublicKey, label: string): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint);
  if (!info) {
    throw new FeedError("NETWORK", `${label} mint ${mint.toBase58()} not found on-chain; resolved address is likely wrong`);
  }
  const programId = info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  console.log(`  ${label} mint ${mint.toBase58()}: owned by ${programId.equals(TOKEN_2022_PROGRAM_ID) ? "Token-2022" : "classic Token"} program`);
  return programId;
}

async function verifyPda(connection: Connection, programId: PublicKey, seeds: Buffer[]): Promise<PublicKey | undefined> {
  const [pda] = PublicKey.findProgramAddressSync(seeds, programId);
  const info = await connection.getAccountInfo(pda);
  if (info && info.owner.equals(programId)) return pda;
  return undefined;
}

async function scanSingleton(program: anchor.Program, accountTypeName: string, label: string): Promise<PublicKey> {
  const ns = (program.account as Record<string, { all(): Promise<{ publicKey: PublicKey }[]> }>)[accountTypeName];
  if (!ns) throw new FeedError("NETWORK", `${label}: no '${accountTypeName}' account client on the program object`);
  const all = await ns.all();
  if (all.length === 0) {
    throw new FeedError(
      "NETWORK",
      `${label}: seed guesses missed and discriminator scan for '${accountTypeName}' found no accounts on-chain`,
    );
  }
  if (all.length > 1) {
    throw new FeedError(
      "NETWORK",
      `${label}: discriminator scan for '${accountTypeName}' found ${all.length} accounts, ambiguous: ${all
        .map((a) => a.publicKey.toBase58())
        .join(", ")}`,
    );
  }
  console.log(`  ${label}: resolved by discriminator scan (${accountTypeName}) -> ${all[0].publicKey.toBase58()}`);
  return all[0].publicKey;
}

async function resolveGlobalPda(
  connection: Connection,
  programId: PublicKey,
  program: anchor.Program,
  idl: anchor.Idl,
  primaryTypeGuess: string,
  typeHints: string[],
  seedGuesses: Buffer[][],
  label: string,
): Promise<{ pda: PublicKey; typeName: string }> {
  const typeName = resolveAccountTypeName(idl, primaryTypeGuess, typeHints);
  for (const seeds of seedGuesses) {
    const pda = await verifyPda(connection, programId, seeds);
    if (pda) {
      const seedLabel = seeds.map((s) => JSON.stringify(s.toString("utf8"))).join(", ");
      console.log(`  ${label}: resolved by seed guess [${seedLabel}] (verified on-chain) -> ${pda.toBase58()}`);
      return { pda, typeName };
    }
  }
  console.log(`  ${label}: seed guesses missed, scanning program accounts by discriminator...`);
  const pda = await scanSingleton(program, typeName, label);
  return { pda, typeName };
}

async function decodeAccount(program: anchor.Program, accountTypeName: string, pubkey: PublicKey): Promise<Record<string, unknown> | null> {
  try {
    const ns = (program.account as Record<string, { fetch(pk: PublicKey): Promise<Record<string, unknown>> }>)[accountTypeName];
    if (!ns) return null;
    return await ns.fetch(pubkey);
  } catch {
    return null;
  }
}

function findFieldMatching(data: Record<string, unknown>, hints: string[], exclude: string[] = []): [string, unknown] | undefined {
  for (const [key, value] of Object.entries(data)) {
    if (exclude.includes(key)) continue;
    const lkey = key.toLowerCase();
    if (hints.some((h) => lkey.includes(h.toLowerCase()))) return [key, value];
  }
  return undefined;
}

function findPubkeyField(data: Record<string, unknown>, hints: string[]): PublicKey | undefined {
  const match = findFieldMatching(data, hints);
  if (match && match[1] instanceof PublicKey) return match[1];
  return undefined;
}

function toBigIntLike(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (value instanceof anchor.BN) return BigInt(value.toString());
  return undefined;
}

function findIdlConstPubkey(idl: anchor.Idl, hints: string[]): PublicKey | undefined {
  for (const c of idl.constants ?? []) {
    if (c.type !== "pubkey") continue;
    const lname = c.name.toLowerCase();
    if (!hints.some((h) => lname.includes(h.toLowerCase()))) continue;
    const raw = c.value.replace(/^"(.*)"$/, "$1");
    try {
      return new PublicKey(raw);
    } catch {
      continue;
    }
  }
  return undefined;
}

async function resolveMint(
  idl: anchor.Idl,
  program: anchor.Program,
  constHints: string[],
  decodeCandidates: { typeName: string; pubkey: PublicKey }[],
  fieldHints: string[],
  label: string,
): Promise<PublicKey> {
  const fromConst = findIdlConstPubkey(idl, constHints);
  if (fromConst) {
    console.log(`  ${label}: resolved from IDL constant -> ${fromConst.toBase58()}`);
    return fromConst;
  }
  for (const cand of decodeCandidates) {
    const data = await decodeAccount(program, cand.typeName, cand.pubkey);
    if (!data) continue;
    const found = findPubkeyField(data, fieldHints);
    if (found) {
      console.log(`  ${label}: resolved by decoding ${cand.typeName} @ ${cand.pubkey.toBase58()} -> ${found.toBase58()}`);
      return found;
    }
  }
  throw new FeedError(
    "NETWORK",
    `could not resolve ${label}: no matching IDL constant and no decodable account field named like [${fieldHints.join(", ")}]; inspect probe output`,
  );
}

async function resolveTxlineAmount(
  program: anchor.Program,
  pricingMatrixPda: PublicKey,
  pricingMatrixType: string,
  level: number,
  txlineAmountFlag: string | undefined,
): Promise<anchor.BN> {
  if (txlineAmountFlag) {
    console.log(`  purchase amount: using --txline-amount ${txlineAmountFlag}`);
    return new anchor.BN(txlineAmountFlag);
  }
  const data = await decodeAccount(program, pricingMatrixType, pricingMatrixPda);
  if (!data) {
    throw new FeedError(
      "NETWORK",
      `PricingMatrix @ ${pricingMatrixPda.toBase58()} could not be decoded with the fetched IDL; pass --txline-amount explicitly`,
    );
  }
  const rows = data.rows;
  if (!Array.isArray(rows)) {
    throw new FeedError(
      "NETWORK",
      `PricingMatrix decoded but has no 'rows' array (keys: ${Object.keys(data).join(", ")}); pass --txline-amount explicitly`,
    );
  }
  const row = rows.find((r) => {
    if (typeof r !== "object" || r === null) return false;
    const match = findFieldMatching(r as Record<string, unknown>, ["servicelevel", "level", "id"]);
    if (!match) return false;
    const v = toBigIntLike(match[1]);
    return v !== undefined && v === BigInt(level);
  });
  if (!row) {
    throw new FeedError(
      "NETWORK",
      `no PricingMatrix row matched service level ${level} (found ${rows.length} rows); pass --txline-amount explicitly`,
    );
  }
  console.log(`  PricingMatrix row for level ${level}: ${JSON.stringify(row, jsonReplacer)}`);
  const priceField = findFieldMatching(row as Record<string, unknown>, ["price", "amount", "cost", "fee", "txline"]);
  const amount = priceField ? toBigIntLike(priceField[1]) : undefined;
  if (!priceField || amount === undefined) {
    throw new FeedError(
      "NETWORK",
      `matched PricingMatrix row for level ${level} but found no price-like field (row printed above); pass --txline-amount explicitly`,
    );
  }
  console.log(`  price field '${priceField[0]}' = ${amount.toString()}`);
  return new anchor.BN(amount.toString());
}

// -- Instruction steps ----------------------------------------------------------

async function stepRequestDevnetFaucet(
  program: anchor.Program,
  idl: anchor.Idl,
  user: PublicKey,
  faucetTrackerPda: PublicKey,
  usdtMint: PublicKey,
  userUsdtAta: PublicKey,
  usdtTreasuryPda: PublicKey,
): Promise<string> {
  const accounts = {
    user,
    faucetTracker: faucetTrackerPda,
    usdtMint,
    userUsdtAta,
    usdtTreasuryPda,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };
  const builder = program.methods.requestDevnetFaucet().accounts(accounts);
  await assertNoMissingAccounts(idl, "requestDevnetFaucet", builder, "request_devnet_faucet");
  return builder.rpc();
}

async function stepPurchase(
  program: anchor.Program,
  idl: anchor.Idl,
  user: PublicKey,
  usdtMint: PublicKey,
  buyerUsdtAccount: PublicKey,
  usdtTreasuryVault: PublicKey,
  usdtTreasuryPda: PublicKey,
  subscriptionTokenMint: PublicKey,
  tokenTreasuryVault: PublicKey,
  tokenTreasuryPda: PublicKey,
  buyerTokenAccount: PublicKey,
  usdtTokenProgramId: PublicKey,
  txlineAmount: anchor.BN,
): Promise<string> {
  const accounts = {
    buyer: user,
    usdtMint,
    buyerUsdtAccount,
    usdtTreasuryVault,
    usdtTreasuryPda,
    subscriptionTokenMint,
    tokenTreasuryVault,
    tokenTreasuryPda,
    buyerTokenAccount,
    tokenProgram: usdtTokenProgramId,
    token2022Program: TOKEN_2022_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  };
  const builder = program.methods.purchaseSubscriptionTokenUsdt(txlineAmount).accounts(accounts);
  await assertNoMissingAccounts(idl, "purchaseSubscriptionTokenUsdt", builder, "purchase_subscription_token_usdt");
  return builder.rpc();
}

async function stepSubscribe(
  program: anchor.Program,
  idl: anchor.Idl,
  user: PublicKey,
  pricingMatrixPda: PublicKey,
  tokenMint: PublicKey,
  userTokenAccount: PublicKey,
  tokenTreasuryVault: PublicKey,
  tokenTreasuryPda: PublicKey,
  tokenProgramId: PublicKey,
  level: number,
  weeks: number,
): Promise<string> {
  const accounts = {
    user,
    pricingMatrix: pricingMatrixPda,
    tokenMint,
    userTokenAccount,
    tokenTreasuryVault,
    tokenTreasuryPda,
    tokenProgram: tokenProgramId,
    systemProgram: SystemProgram.programId,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  };
  const builder = program.methods.subscribe(level, weeks).accounts(accounts);
  await assertNoMissingAccounts(idl, "subscribe", builder, "subscribe");
  return builder.rpc();
}

// -- CLI commands -----------------------------------------------------------

async function probe(env: FeedEnv): Promise<void> {
  const connection = new Connection(env.rpcUrl, "confirmed");
  const kp = loadOrCreateKeypair(env.keypairPath);
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(kp), {});
  const programId = new PublicKey(env.txoracleProgramId);
  const idl = await anchor.Program.fetchIdl(programId, provider);
  if (!idl) throw new FeedError("NETWORK", `no IDL published for ${env.txoracleProgramId} on ${env.network}`);
  console.log(`Txoracle IDL on ${env.network}:`);
  for (const ix of idl.instructions) {
    console.log(`  ${ix.name}(${ix.args.map((a) => `${a.name}: ${JSON.stringify(a.type)}`).join(", ")})`);
    console.log(`    accounts: ${ix.accounts.map((a) => a.name).join(", ")}`);
  }
  const accountNames = (idl.accounts ?? []).map((a) => a.name).join(", ");
  console.log(`  accounts defined: ${accountNames}`);

  const program = new anchor.Program(idl, provider);
  console.log("attempting to fetch PricingMatrix...");
  try {
    const { pda, typeName } = await resolveGlobalPda(
      connection,
      programId,
      program,
      idl,
      "pricingMatrix",
      ["pricing"],
      [[Buffer.from("pricing_matrix")]],
      "pricing_matrix",
    );
    const data = await decodeAccount(program, typeName, pda);
    if (data) {
      console.log(`PricingMatrix @ ${pda.toBase58()}:`);
      console.log(JSON.stringify(data, jsonReplacer, 2));
    } else {
      console.log(`PricingMatrix @ ${pda.toBase58()} found but could not be decoded with the fetched IDL`);
    }
  } catch (e) {
    console.log(`note: could not fetch/decode PricingMatrix: ${e instanceof Error ? e.message : String(e)}`);
  }
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

async function subscribeCommand(env: FeedEnv, level: number, weeks: number, txlineAmountFlag: string | undefined): Promise<void> {
  if (env.network === "mainnet" && !txlineAmountFlag) {
    throw new FeedError("NETWORK", "mainnet requires --txline-amount; confirm pricing manually before spending real funds");
  }

  const connection = new Connection(env.rpcUrl, "confirmed");
  const kp = loadOrCreateKeypair(env.keypairPath);
  await ensureFunded(connection, kp, env.network);
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(kp), {});
  const programId = new PublicKey(env.txoracleProgramId);
  const idl = await anchor.Program.fetchIdl(programId, provider);
  if (!idl) throw new FeedError("NETWORK", "no IDL for Txoracle; run probe and check the network");
  const program = new anchor.Program(idl, provider);
  const user = kp.publicKey;

  console.log("resolving on-chain accounts...");
  const { pda: pricingMatrixPda, typeName: pricingMatrixType } = await resolveGlobalPda(
    connection, programId, program, idl,
    "pricingMatrix", ["pricing"], [[Buffer.from("pricing_matrix")]], "pricing_matrix",
  );
  const { pda: usdtTreasuryPda, typeName: usdtTreasuryType } = await resolveGlobalPda(
    connection, programId, program, idl,
    "usdtTreasuryPda", ["usdttreasury", "usdt_treasury", "usdt"], [[Buffer.from("usdt_treasury")]], "usdt_treasury_pda",
  );
  const { pda: tokenTreasuryPda, typeName: tokenTreasuryType } = await resolveGlobalPda(
    connection, programId, program, idl,
    "tokenTreasuryPda", ["tokentreasury", "token_treasury"], [[Buffer.from("token_treasury")]], "token_treasury_pda",
  );

  const usdtMint = await resolveMint(
    idl, program, ["usdtmint", "usdt_mint", "usdt"],
    [{ typeName: usdtTreasuryType, pubkey: usdtTreasuryPda }],
    ["mint"], "usdt_mint",
  );
  const subscriptionTokenMint = await resolveMint(
    idl, program, ["subscriptiontoken", "tokenmint", "token_mint", "txline", "subscription"],
    [
      { typeName: tokenTreasuryType, pubkey: tokenTreasuryPda },
      { typeName: pricingMatrixType, pubkey: pricingMatrixPda },
    ],
    ["mint"], "subscription_token_mint",
  );

  const usdtTokenProgramId = await tokenProgramForMint(connection, usdtMint, "usdt");
  const subTokenProgramId = await tokenProgramForMint(connection, subscriptionTokenMint, "subscription_token");

  const userUsdtAta = associatedAddressFor(usdtMint, user, usdtTokenProgramId);
  const usdtTreasuryVault = associatedAddressFor(usdtMint, usdtTreasuryPda, usdtTokenProgramId);
  const userTokenAccount = associatedAddressFor(subscriptionTokenMint, user, subTokenProgramId);
  const tokenTreasuryVault = associatedAddressFor(subscriptionTokenMint, tokenTreasuryPda, subTokenProgramId);

  const [faucetTrackerPda] = PublicKey.findProgramAddressSync([Buffer.from("faucet_tracker"), user.toBuffer()], programId);
  const faucetInfo = await connection.getAccountInfo(faucetTrackerPda);
  console.log(
    `  faucet_tracker: derived -> ${faucetTrackerPda.toBase58()} (${
      faucetInfo ? "already exists, faucet is likely already claimed" : "does not exist yet, will be created by request_devnet_faucet"
    })`,
  );

  console.log(
    `resolved: pricingMatrix=${pricingMatrixPda.toBase58()} usdtTreasuryPda=${usdtTreasuryPda.toBase58()} tokenTreasuryPda=${tokenTreasuryPda.toBase58()}`,
  );
  console.log(`resolved: usdtMint=${usdtMint.toBase58()} subscriptionTokenMint=${subscriptionTokenMint.toBase58()}`);

  if (env.network === "mainnet") {
    console.log("request_devnet_faucet: skipped (mainnet has no faucet)");
  } else {
    try {
      const sig = await stepRequestDevnetFaucet(program, idl, user, faucetTrackerPda, usdtMint, userUsdtAta, usdtTreasuryPda);
      console.log(`request_devnet_faucet: ${sig}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/already in use|already claimed|alreadyclaimed|already initialized/i.test(msg)) {
        console.log(`request_devnet_faucet: skipped, wallet already claimed the faucet (${msg})`);
      } else {
        throw new FeedError("NETWORK", `request_devnet_faucet failed: ${msg}`);
      }
    }
  }

  const txlineAmount = await resolveTxlineAmount(program, pricingMatrixPda, pricingMatrixType, level, txlineAmountFlag);

  let purchaseSig: string;
  try {
    purchaseSig = await stepPurchase(
      program, idl, user,
      usdtMint, userUsdtAta, usdtTreasuryVault, usdtTreasuryPda,
      subscriptionTokenMint, tokenTreasuryVault, tokenTreasuryPda, userTokenAccount,
      usdtTokenProgramId, txlineAmount,
    );
  } catch (e) {
    throw new FeedError("NETWORK", `purchase_subscription_token_usdt failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  console.log(`purchase_subscription_token_usdt: ${purchaseSig}`);

  let subscribeSig: string;
  try {
    subscribeSig = await stepSubscribe(
      program, idl, user,
      pricingMatrixPda, subscriptionTokenMint, userTokenAccount, tokenTreasuryVault, tokenTreasuryPda,
      subTokenProgramId, level, weeks,
    );
  } catch (e) {
    throw new FeedError("NETWORK", `subscribe failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  console.log(`subscribe: ${subscribeSig}`);

  const path = credsPath(env.network);
  saveCreds(path, { ...loadCreds(path), txSig: subscribeSig });
  console.log(`subscribed level ${level} for ${weeks} weeks on ${env.network}: ${subscribeSig} (saved to ${path})`);
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
      weeks: { type: "string", default: "4" },
      "txline-amount": { type: "string" },
      leagues: { type: "string", default: "" },
    },
  });
  const env = loadEnv(process.env, values.network as Network);
  const cmd = positionals[0];
  if (cmd === "probe") await probe(env);
  else if (cmd === "guest") await guest(env);
  else if (cmd === "subscribe") {
    await subscribeCommand(env, Number(values.level), Number(values.weeks), values["txline-amount"] as string | undefined);
  } else if (cmd === "activate") await activate(env, values.leagues as string);
  else {
    console.log(
      "usage: bootstrap.ts <probe|guest|subscribe|activate> [--network devnet|mainnet] [--level N] [--weeks N] [--txline-amount N] [--leagues CSV]",
    );
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
