// Server-only chain access shared by the two route handlers. Every PDA and
// instruction comes from packages/agent/client.ts, which is also what the
// frozen server/*.ts handlers use, so there is one implementation of the chain
// layer. What lives here is request plumbing: env keys, the connection, and
// the calibration-to-season decision.
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { RPC_DEVNET_DEFAULT } from "../../packages/feed/env.ts";
import { arenaPda, bookPda, matchPda } from "../../packages/agent/client.ts";
import { ApiErrorException } from "./errors";
import { calSeason, isPinned, toCal, type Cal } from "./cal";

export const PUBLIC_SEASON = 777n;
export const STARTING_BANKROLL = 1_000_000_000n;

export const connection = () => new Connection(process.env.RPC_URL ?? RPC_DEVNET_DEFAULT, "confirmed");

/** Never mainnet. A misconfigured RPC_URL must fail loudly, not trade. */
export function assertDevnet(): void {
  const url = process.env.RPC_URL ?? RPC_DEVNET_DEFAULT;
  if (/mainnet/i.test(url)) {
    throw new ApiErrorException({ code: "not_configured", message: "RPC_URL points at mainnet; this arena is devnet only." });
  }
}

export function envKeypair(name: string): Keypair {
  const raw = process.env[name];
  if (!raw) {
    throw new ApiErrorException({
      code: "not_configured",
      message: "This deployment holds no arena keys, so it can read the arena but not run it.",
    });
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

export const envPubkey = (name: string): PublicKey => envKeypair(name).publicKey;

/**
 * Calibration-keyed seasons. Pinned sliders land on the public season 777 run;
 * anything else maps to its own bounded arena. Mirrors calSeason() in
 * server/run.ts, which dashboard-new/lib/cal.test.ts pins against drift.
 */
export function seasonFor(pinnedCal: Cal, thetaPp: number, edgePct: number): { season: bigint; cal: Cal; calKeyed: boolean } {
  const tt = Math.round(thetaPp * 10);
  const ee = Math.round(edgePct * 10);
  const onGrid =
    Number.isFinite(thetaPp) &&
    Number.isFinite(edgePct) &&
    Math.abs(thetaPp * 10 - tt) < 1e-6 &&
    Math.abs(edgePct * 10 - ee) < 1e-6 &&
    tt >= 2 &&
    tt <= 30 &&
    ee >= 0 &&
    ee <= 20;
  if (!onGrid) {
    throw new ApiErrorException({
      code: "bad_calibration",
      message: "These slider values are off the discrete grid (theta 0.2-3.0pp, edge 0-2.0%, step 0.1).",
    });
  }
  if (isPinned(thetaPp, edgePct, pinnedCal)) return { season: PUBLIC_SEASON, cal: pinnedCal, calKeyed: false };
  return { season: BigInt(calSeason(thetaPp, edgePct)), cal: toCal(thetaPp, edgePct), calKeyed: true };
}

export function pdas(season: bigint, fixtureId: number, follow: PublicKey, fade: PublicKey) {
  const arena = arenaPda(season);
  const match = matchPda(arena, BigInt(fixtureId));
  return { arena, match, books: [bookPda(arena, follow), bookPda(arena, fade)] as const };
}

/** Read PDA existence without letting an RPC hiccup look like an application error. */
export async function readAccounts(conn: Connection, keys: PublicKey[]) {
  if (keys.length === 0) return [];
  try {
    return await conn.getMultipleAccountsInfo(keys);
  } catch {
    throw new ApiErrorException({ code: "chain_unavailable", message: "Devnet RPC did not answer the account read." });
  }
}

/** Open tx is the oldest signature on the position PDA, settle the newest when there is more than one. */
export async function txsFor(conn: Connection, pda: PublicKey): Promise<{ openTx: string | null; settleTx: string | null }> {
  try {
    const sigs = await conn.getSignaturesForAddress(pda, { limit: 10 });
    return {
      openTx: sigs[sigs.length - 1]?.signature ?? null,
      settleTx: sigs.length > 1 ? sigs[0].signature : null,
    };
  } catch {
    return { openTx: null, settleTx: null };
  }
}
