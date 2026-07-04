import { type AgentState, type EngineConfig } from "./model.ts";

export interface SafetyState {
  killed: boolean;
  dailyLoss: number;
}

export function kellyFraction(belief: number, decimalOdds: number): number {
  if (decimalOdds <= 1) return 0;
  const f = (belief * decimalOdds - 1) / (decimalOdds - 1);
  return Math.max(0, f);
}

export function sizeStake(
  belief: number,
  entryOdds: number,
  book: AgentState,
  safety: SafetyState,
  cfg: EngineConfig,
  openPositionsOnFixture = 0,
): number {
  if (safety.killed || safety.dailyLoss >= cfg.dailyLossStop) return 0;
  if (openPositionsOnFixture >= cfg.maxPositionsPerFixture) return 0;
  const f = kellyFraction(belief, entryOdds);
  const raw = Math.floor(cfg.kellyFraction * f * book.bankrollPoints);
  const exposureRoom = Math.max(0, cfg.maxExposure - book.stakedPoints);
  const stake = Math.min(raw, cfg.maxStakePerMarket, book.bankrollPoints, exposureRoom);
  return Math.max(0, stake);
}
