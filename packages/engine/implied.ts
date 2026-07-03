import { EngineError } from "./errors.ts";

export function decodeOdds(price: number, scale: number): number {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(scale) || scale <= 0) {
    throw new EngineError("BAD_ODDS_DECODE", `invalid price ${price} or scale ${scale}`, "verify the odds decode scale against Pct");
  }
  const d = price / scale;
  if (d <= 1) {
    throw new EngineError("BAD_ODDS_DECODE", `decoded decimal odds ${d} must exceed 1`, "the scale is likely wrong; recalibrate");
  }
  return d;
}

// Recover the integer scale S such that price/S ~= 1/(pct/100).
// Since implied = S/price, S ~= price * (pct/100). Take the median and round to nearest 100.
export function calibrateScale(prices: number[], pct: string[]): number {
  if (prices.length === 0 || prices.length !== pct.length) {
    throw new EngineError("INVALID_INPUT", "prices and pct must be non-empty and equal length", "check the odds payload");
  }
  const candidates: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    const implied = Number(pct[i]) / 100;
    if (Number.isFinite(implied) && implied > 0) candidates.push(prices[i] * implied);
  }
  if (candidates.length === 0) {
    throw new EngineError("INVALID_INPUT", "no usable pct values for calibration", "check the Pct field");
  }
  candidates.sort((a, b) => a - b);
  const median = candidates[Math.floor(candidates.length / 2)];
  return Math.max(1, Math.round(median / 100) * 100);
}

export function fairProbs(decimalOdds: number[]): number[] {
  if (decimalOdds.length === 0) {
    throw new EngineError("ZERO_OVERROUND", "no outcomes to normalize", "check the odds payload");
  }
  const q = decimalOdds.map((d) => 1 / d);
  const overround = q.reduce((a, b) => a + b, 0);
  if (!(overround > 0)) {
    throw new EngineError("ZERO_OVERROUND", `overround ${overround} is not positive`, "check the odds payload");
  }
  return q.map((x) => x / overround);
}
