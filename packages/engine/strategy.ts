import { clamp, type Signal, type OddsTick, type EngineConfig } from "./model.ts";

export interface Pick {
  outcome: string;
  belief: number;
  entryOdds: number;
  edge: number;
}

function outcome(t: OddsTick, name: string) {
  return t.outcomes.find((o) => o.name === name);
}

export function follow(sig: Signal, curTick: OddsTick, preTick: OddsTick, cfg: EngineConfig): Pick | null {
  const cur = outcome(curTick, sig.outcome);
  const pre = outcome(preTick, sig.outcome);
  if (!cur || !pre) return null;
  const delta = cur.fairProb - pre.fairProb;
  const belief = clamp(cur.fairProb + cfg.alpha * delta, 0, 1);
  const edge = belief * cur.decimalOdds - 1;
  return edge >= cfg.edgeMin ? { outcome: cur.name, belief, entryOdds: cur.decimalOdds, edge } : null;
}

export function fade(sig: Signal, curTick: OddsTick, preTick: OddsTick, cfg: EngineConfig): Pick | null {
  let best: Pick | null = null;
  for (const cur of curTick.outcomes) {
    if (cur.name === sig.outcome) continue;
    const pre = outcome(preTick, cur.name);
    if (!pre) continue;
    const belief = pre.fairProb; // reversion to the pre-move fair probability
    const edge = belief * cur.decimalOdds - 1;
    if (edge >= cfg.edgeMin && (!best || edge > best.edge)) {
      best = { outcome: cur.name, belief, entryOdds: cur.decimalOdds, edge };
    }
  }
  return best;
}
