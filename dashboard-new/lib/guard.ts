// Spend guard. The web wallets pay rent and fees for every position PDA the
// cron opens; an unattended loop that drains them fails loudly and slowly.
// Check once per tick, before anything is sent, and refuse the whole batch
// rather than half-opening a fixture's positions.
import { Connection, LAMPORTS_PER_SOL, type PublicKey } from "@solana/web3.js";

/** Below this many SOL in any signer, the cron stops spending. */
export const DEFAULT_FLOOR_SOL = 0.02;

export interface FloorCheck {
  ok: boolean;
  floorSol: number;
  balances: { address: string; sol: number }[];
  reason: string | null;
}

export function floorSolFromEnv(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.STEAMLINE_SOL_FLOOR);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_FLOOR_SOL;
}

/**
 * Reads every signer's balance and reports whether spending is allowed.
 * An RPC failure is treated as "do not spend": an unknown balance is not a
 * safe balance.
 */
export async function checkSolFloor(
  connection: Connection,
  signers: PublicKey[],
  floorSol: number,
): Promise<FloorCheck> {
  const balances: { address: string; sol: number }[] = [];
  try {
    const infos = await connection.getMultipleAccountsInfo(signers);
    for (const [i, info] of infos.entries()) {
      balances.push({ address: signers[i].toBase58(), sol: (info?.lamports ?? 0) / LAMPORTS_PER_SOL });
    }
  } catch (e) {
    return {
      ok: false,
      floorSol,
      balances,
      reason: `balance read failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const low = balances.filter((b) => b.sol < floorSol);
  return {
    ok: low.length === 0,
    floorSol,
    balances,
    reason: low.length === 0 ? null : `below floor: ${low.map((b) => `${b.address} at ${b.sol.toFixed(4)} SOL`).join(", ")}`,
  };
}
