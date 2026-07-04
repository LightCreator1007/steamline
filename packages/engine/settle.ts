import { type PositionRecord, type Result } from "./model.ts";

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
    const payout = Math.round(pos.stakePoints * pos.entryOdds);
    return { status: "won", payout, pnl: payout - pos.stakePoints };
  }
  return { status: "lost", payout: 0, pnl: -pos.stakePoints };
}
