import { type PositionRecord, type Result } from "./model.ts";

// Callers import Result alongside these helpers; re-export so the type travels
// with the module that produces it.
export type { Result };

export function outcomeFromScore(home: number, away: number): Result {
  if (home > away) return "home";
  if (home < away) return "away";
  return "draw";
}

export function resultToOutcomeName(r: Result): string {
  return r === "home" ? "1" : r === "draw" ? "X" : "2";
}

export function settlePosition(
  pos: PositionRecord,
  result: Result,
): { status: "won" | "lost"; payout: number; pnl: number } {
  const winName = resultToOutcomeName(result);
  if (pos.outcome === winName) {
    // Mirror the on-chain integer formula: (stake * odds_milli + 500) / 1000,
    // round half up. stake <= 5e7 and oddsMilli <= ~20000 keep
    // stakePoints * oddsMilli <= ~1e12, exactly representable as a double, so
    // Math.round matches the on-chain rounding at exact .5 tie boundaries.
    const oddsMilli = Math.round(pos.entryOdds * 1000);
    const payout = Math.round((pos.stakePoints * oddsMilli) / 1000);
    return { status: "won", payout, pnl: payout - pos.stakePoints };
  }
  return { status: "lost", payout: 0, pnl: -pos.stakePoints };
}
