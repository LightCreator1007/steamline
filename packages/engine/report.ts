import { type AgentState, type AgentId } from "./model.ts";

export interface Standing {
  agentId: AgentId;
  strategy: string;
  bankroll: number;
  realizedPnl: number;
  betsOpened: number;
  won: number;
  lost: number;
  avgBrier: number | null;
  avgLogLoss: number | null;
  roi: number | null;
}

export function standing(book: AgentState): Standing {
  const staked = book.betsWon + book.betsLost;
  return {
    agentId: book.agentId,
    strategy: book.strategy,
    bankroll: book.bankrollPoints,
    realizedPnl: book.realizedPnl,
    betsOpened: book.betsOpened,
    won: book.betsWon,
    lost: book.betsLost,
    avgBrier: book.graded > 0 ? book.brierSum / book.graded : null,
    avgLogLoss: book.graded > 0 ? book.logLossSum / book.graded : null,
    roi: staked > 0 ? book.realizedPnl / Math.max(1, book.stakedPoints + book.realizedPnl) : null,
  };
}

export function renderMarkdown(standings: Standing[]): string {
  const header = "| strategy | pnl | won | lost | avgBrier |\n| --- | --- | --- | --- | --- |";
  const rows = standings
    .slice()
    .sort((a, b) => b.realizedPnl - a.realizedPnl)
    .map((s) => `| ${s.strategy} | ${s.realizedPnl} | ${s.won} | ${s.lost} | ${s.avgBrier === null ? "n/a" : s.avgBrier.toFixed(4)} |`);
  return [header, ...rows].join("\n");
}
