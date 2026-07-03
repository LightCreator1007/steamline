export interface OddsPayload {
  FixtureId: number;
  MessageId: string;
  Ts: number;
  Bookmaker: string;
  BookmakerId: number;
  SuperOddsType: string;
  GameState?: string;
  InRunning: boolean;
  MarketParameters?: string;
  MarketPeriod?: string;
  PriceNames: string[];
  Prices: number[];
  Pct: string[];
}

export type OutcomeName = string;
export type AgentId = 0 | 1;
export type SteamMethod = "fixed" | "adaptive";
export type Result = "home" | "draw" | "away";

export interface Outcome {
  name: OutcomeName;
  decimalOdds: number;
  rawImplied: number;
  fairProb: number;
}

export interface OddsTick {
  fixtureId: number;
  messageId: string;
  ts: number;
  market: string;
  period?: string;
  inRunning: boolean;
  source: string;
  staleMs: number;
  outcomes: Outcome[];
}

export interface Signal {
  fixtureId: number;
  market: string;
  seq: number;
  outcome: OutcomeName;
  direction: 1 | -1;
  magnitude: number;
  preProb: number;
  postProb: number;
  ts: number;
  messageId: string;
  method: SteamMethod;
}

export interface Decision {
  agentId: AgentId;
  fixtureId: number;
  signalSeq: number;
  outcome: OutcomeName;
  belief: number;
  entryOdds: number;
  edge: number;
  stakePoints: number;
}

export interface PositionRecord {
  agentId: AgentId;
  fixtureId: number;
  signalSeq: number;
  outcome: OutcomeName;
  stakePoints: number;
  entryOdds: number;
  belief: number;
  status: "open" | "won" | "lost";
  payoutPoints: number;
}

export interface AgentState {
  agentId: AgentId;
  strategy: string;
  bankrollPoints: number;
  stakedPoints: number;
  realizedPnl: number;
  betsOpened: number;
  betsWon: number;
  betsLost: number;
  brierSum: number;
  logLossSum: number;
  graded: number;
}

export interface EngineConfig {
  scale: number;
  staleMs: number;
  windowTicks: number;
  theta: number;
  persistence: number;
  zMin: number;
  floor: number;
  warmupTicks: number;
  alpha: number;
  edgeMin: number;
  kellyFraction: number;
  startingBankroll: number;
  maxStakePerMarket: number;
  maxExposure: number;
  dailyLossStop: number;
  method: SteamMethod;
  preMatchOnly: boolean;
  shockGuardMs: number;
  cooldownMs: number;
  maxPositionsPerFixture: number;
}

export const defaultConfig: EngineConfig = {
  scale: 1000,
  staleMs: 120_000,
  windowTicks: 4,
  theta: 0.03,
  persistence: 2,
  zMin: 2.5,
  floor: 0.02,
  warmupTicks: 20,
  alpha: 0.5,
  edgeMin: 0.02,
  kellyFraction: 0.25,
  startingBankroll: 1_000_000_000,
  maxStakePerMarket: 50_000_000,
  maxExposure: 500_000_000,
  dailyLossStop: 200_000_000,
  method: "fixed",
  preMatchOnly: true,
  shockGuardMs: 300_000,
  cooldownMs: 600_000,
  maxPositionsPerFixture: 3,
};

export function newAgentState(agentId: AgentId, bankroll: number): AgentState {
  return {
    agentId,
    strategy: agentId === 0 ? "follow" : "fade",
    bankrollPoints: bankroll,
    stakedPoints: 0,
    realizedPnl: 0,
    betsOpened: 0,
    betsWon: 0,
    betsLost: 0,
    brierSum: 0,
    logLossSum: 0,
    graded: 0,
  };
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
