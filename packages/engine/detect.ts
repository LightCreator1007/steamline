import { type Ledger } from "./ledger.ts";
import { type OddsTick, type Signal, type EngineConfig } from "./model.ts";

function probOf(t: OddsTick, name: string): number | undefined {
  return t.outcomes.find((o) => o.name === name)?.fairProb;
}

function seriesFor(ticks: OddsTick[], name: string): number[] {
  const out: number[] = [];
  for (const t of ticks) {
    const p = probOf(t, name);
    if (p === undefined) return [];
    out.push(p);
  }
  return out;
}

// Last `persistence` consecutive step-deltas share the given sign.
function isSustained(series: number[], direction: 1 | -1, persistence: number): boolean {
  if (series.length < persistence + 1) return false;
  for (let i = series.length - persistence; i < series.length; i++) {
    const step = series[i] - series[i - 1];
    if (direction === 1 ? step < 0 : step > 0) return false;
  }
  return true;
}

// EWMA std of step-to-step deltas over the whole series.
function ewmaStd(series: number[], lambda = 0.94): number {
  if (series.length < 2) return 0;
  let mean = 0;
  let varr = 0;
  for (let i = 1; i < series.length; i++) {
    const d = series[i] - series[i - 1];
    mean = lambda * mean + (1 - lambda) * d;
    varr = lambda * varr + (1 - lambda) * (d - mean) * (d - mean);
  }
  return Math.sqrt(Math.max(0, varr));
}

export interface DetectGuards {
  recentSignals?: Signal[];
  lastScoreChangeTs?: number;
}

export function detectSteam(
  ledger: Ledger,
  fixtureId: number,
  market: string,
  cfg: EngineConfig,
  nextSeq: () => number,
  guards: DetectGuards = {},
): Signal | null {
  const win = ledger.window(fixtureId, market, cfg.windowTicks + 1);
  if (win.length < cfg.windowTicks + 1) return null;
  const cur = win[win.length - 1];
  const prev = win[0];
  if (cur.staleMs > cfg.staleMs) return null;
  if (cur.inRunning) {
    if (cfg.preMatchOnly) return null;
    if (guards.lastScoreChangeTs !== undefined && cur.ts - guards.lastScoreChangeTs < cfg.shockGuardMs) return null;
  }

  let best: { name: string; delta: number; pre: number; post: number } | null = null;
  for (const oc of cur.outcomes) {
    const pre = probOf(prev, oc.name);
    if (pre === undefined) continue;
    const delta = oc.fairProb - pre;
    if (!best || Math.abs(delta) > Math.abs(best.delta)) {
      best = { name: oc.name, delta, pre, post: oc.fairProb };
    }
  }
  if (!best || best.delta === 0) return null;
  const direction: 1 | -1 = best.delta >= 0 ? 1 : -1;

  const cooled = (guards.recentSignals ?? []).some(
    (s) => s.fixtureId === fixtureId && s.market === market && s.outcome === best!.name && cur.ts - s.ts < cfg.cooldownMs,
  );
  if (cooled) return null;

  const full = ledger.all(fixtureId, market);
  const series = seriesFor(full, best.name);
  const useAdaptive = cfg.method === "adaptive" && series.length >= cfg.warmupTicks;

  let fire: boolean;
  if (useAdaptive) {
    const sigma = ewmaStd(series);
    const z = sigma > 0 ? Math.abs(best.delta) / sigma : 0;
    fire = z >= cfg.zMin && Math.abs(best.delta) >= cfg.floor;
  } else {
    const windowSeries = seriesFor(win, best.name);
    fire = Math.abs(best.delta) >= cfg.theta && isSustained(windowSeries, direction, cfg.persistence);
  }
  if (!fire) return null;

  return {
    fixtureId,
    market,
    seq: nextSeq(),
    outcome: best.name,
    direction,
    magnitude: Math.abs(best.delta),
    preProb: best.pre,
    postProb: best.post,
    ts: cur.ts,
    messageId: cur.messageId,
    method: useAdaptive ? "adaptive" : "fixed",
  };
}
