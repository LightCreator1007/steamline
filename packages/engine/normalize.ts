import { type OddsPayload, type OddsTick, type Outcome, type EngineConfig } from "./model.ts";
import { decodeOdds, fairProbs } from "./implied.ts";
import { EngineError } from "./errors.ts";

export function normalizeOdds(p: OddsPayload, now: number, cfg: EngineConfig): OddsTick {
  if (p.PriceNames.length !== p.Prices.length || p.PriceNames.length === 0) {
    throw new EngineError("INVALID_INPUT", "PriceNames and Prices must align and be non-empty", "check the odds payload");
  }
  const decimals = p.Prices.map((x) => decodeOdds(x, cfg.scale));
  const fair = fairProbs(decimals);
  const outcomes: Outcome[] = p.PriceNames.map((name, i) => ({
    name,
    decimalOdds: decimals[i],
    rawImplied: 1 / decimals[i],
    fairProb: fair[i],
  }));
  return {
    fixtureId: p.FixtureId,
    messageId: p.MessageId,
    ts: p.Ts,
    market: p.SuperOddsType,
    period: p.MarketPeriod,
    inRunning: p.InRunning,
    source: p.Bookmaker,
    staleMs: Math.max(0, now - p.Ts),
    outcomes,
  };
}

export function selectConsensus(payloads: OddsPayload[], now: number, cfg: EngineConfig): OddsTick | null {
  if (payloads.length === 0) return null;
  const chosen = payloads.find((p) => p.Bookmaker === "StablePrice") ?? payloads[0];
  return normalizeOdds(chosen, now, cfg);
}
