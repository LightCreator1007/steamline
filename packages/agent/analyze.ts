// Deterministic fixture analysis shared by the CLI agent, the web executor,
// and the dashboard: payloads + calibration in, a tick-by-tick trace with
// signals, sized decisions, and settlement out. Position PDAs derive from
// the signal seq this produces, so determinism is load-bearing.
import { defaultConfig, newAgentState, type AgentState, type EngineConfig, type OddsPayload, type OddsTick, type Signal } from "../engine/model.ts";
import { normalizeOdds } from "../engine/normalize.ts";
import { inMemoryLedger } from "../engine/ledger.ts";
import { detectSteam } from "../engine/detect.ts";
import { follow, fade, type Pick } from "../engine/strategy.ts";
import { sizeStake } from "../engine/stake.ts";
import { settlePosition, outcomeFromScore, type Result } from "../engine/settle.ts";
import { applyGrade } from "../engine/grade.ts";

export interface AnalyzedDecision {
  agent: 0 | 1;
  signalSeq: number;
  outcome: string;
  entryOdds: number;
  entryOddsMilli: number;
  edge: number;
  edgeBps: number;
  belief: number;
  stake: number;
  messageId: string;
  ts: number;
  status: "won" | "lost" | "open";
  payout: number;
}

export type TickEvent =
  | { kind: "signal"; signal: Signal }
  | { kind: "decision"; decision: AnalyzedDecision }
  | { kind: "hold"; agent: 0 | 1; reason: "no-edge" | "zero-stake" };

export interface TraceTick {
  tick: OddsTick;
  events: TickEvent[];
  // Book snapshot after this tick's events; presentation reads it directly.
  books: AgentState[];
}

export interface Analysis {
  signals: Signal[];
  decisions: AnalyzedDecision[];
  trace: TraceTick[];
  result: Result | null;
  books: AgentState[];
}

export function analyzeFixture(
  fixtureId: number,
  payloads: OddsPayload[],
  finalScore: { HomeScore: number; AwayScore: number } | null,
  overrides: Partial<EngineConfig> = {},
): Analysis {
  const cfg: EngineConfig = { ...defaultConfig, ...overrides };
  const ledger = inMemoryLedger();
  const books = [newAgentState(0, cfg.startingBankroll), newAgentState(1, cfg.startingBankroll)];
  const signals: Signal[] = [];
  const decisions: AnalyzedDecision[] = [];
  const trace: TraceTick[] = [];
  let seq = 0;

  for (const p of payloads) {
    // Real feeds contain heartbeat and market-removal updates with empty or
    // misaligned price arrays; skip them rather than aborting the replay.
    if (!Array.isArray(p.PriceNames) || !Array.isArray(p.Prices) || p.PriceNames.length !== p.Prices.length || p.PriceNames.length === 0 || p.Prices.some((x) => !(x > 1000))) {
      continue;
    }
    const tick = normalizeOdds({ ...p, FixtureId: fixtureId }, p.Ts, cfg);
    ledger.append(tick);
    const events: TickEvent[] = [];
    const sig = detectSteam(ledger, fixtureId, tick.market, cfg, () => seq++, { recentSignals: signals });
    if (sig) {
      signals.push(sig);
      events.push({ kind: "signal", signal: sig });
      const win = ledger.window(fixtureId, tick.market, cfg.windowTicks + 1);
      const pre = win[0];
      const picks: (Pick | null)[] = [follow(sig, tick, pre, cfg), fade(sig, tick, pre, cfg)];
      picks.forEach((pick, agent) => {
        if (!pick) {
          events.push({ kind: "hold", agent: agent as 0 | 1, reason: "no-edge" });
          return;
        }
        const openHere = decisions.filter((d) => d.agent === agent).length;
        const stake = sizeStake(pick.belief, pick.entryOdds, books[agent], { killed: false, dailyLoss: 0 }, cfg, openHere);
        if (stake <= 0) {
          events.push({ kind: "hold", agent: agent as 0 | 1, reason: "zero-stake" });
          return;
        }
        books[agent] = {
          ...books[agent],
          bankrollPoints: books[agent].bankrollPoints - stake,
          stakedPoints: books[agent].stakedPoints + stake,
          betsOpened: books[agent].betsOpened + 1,
        };
        const decision: AnalyzedDecision = {
          agent: agent as 0 | 1,
          signalSeq: sig.seq,
          outcome: pick.outcome,
          entryOdds: pick.entryOdds,
          entryOddsMilli: Math.round(pick.entryOdds * 1000),
          edge: pick.edge,
          edgeBps: Math.round(pick.edge * 10000),
          belief: pick.belief,
          stake,
          messageId: sig.messageId,
          ts: sig.ts,
          status: "open",
          payout: 0,
        };
        decisions.push(decision);
        events.push({ kind: "decision", decision });
      });
    }
    trace.push({ tick, events, books: [...books] });
  }

  let result: Result | null = null;
  if (finalScore) {
    result = outcomeFromScore(finalScore.HomeScore, finalScore.AwayScore);
    for (const d of decisions) {
      const r = settlePosition(
        { agentId: d.agent, fixtureId, signalSeq: d.signalSeq, outcome: d.outcome, stakePoints: d.stake, entryOdds: d.entryOdds, belief: d.belief, status: "open", payoutPoints: 0 },
        result,
      );
      d.status = r.status;
      d.payout = r.payout;
      books[d.agent] = applyGrade(
        { ...books[d.agent], bankrollPoints: books[d.agent].bankrollPoints + r.payout, stakedPoints: books[d.agent].stakedPoints - d.stake },
        d.belief,
        r.status === "won" ? 1 : 0,
        r.pnl,
      );
    }
  }
  return { signals, decisions, trace, result, books };
}
