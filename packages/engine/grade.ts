import { type AgentState } from "./model.ts";

export function brier(belief: number, hit: 0 | 1): number {
  return (belief - hit) * (belief - hit);
}

export function logLoss(belief: number, hit: 0 | 1): number {
  const p = Math.min(1 - 1e-9, Math.max(1e-9, belief));
  return -(hit * Math.log(p) + (1 - hit) * Math.log(1 - p));
}

export function applyGrade(book: AgentState, belief: number, hit: 0 | 1, pnl: number): AgentState {
  return {
    ...book,
    realizedPnl: book.realizedPnl + pnl,
    betsWon: book.betsWon + (hit === 1 ? 1 : 0),
    betsLost: book.betsLost + (hit === 0 ? 1 : 0),
    brierSum: book.brierSum + brier(belief, hit),
    logLossSum: book.logLossSum + logLoss(belief, hit),
    graded: book.graded + 1,
  };
}
