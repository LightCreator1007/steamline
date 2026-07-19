// Phase strip derivation: window opens -> agent watching -> steam fired ->
// positions open -> full time -> settled. Pure and stateless so it is
// testable without a store or an RPC. Every step is lit from facts already
// recorded (kickoff time, stored tick timestamps, position counts, the watch
// record's finalScore/settled flags) plus a single "now" read to compare
// against them, never a standalone wall-clock guess about game state.
export type PhaseId = "window" | "watching" | "steam" | "positions" | "full_time" | "settled";

export interface PhaseStep {
  id: PhaseId;
  label: string;
  /** Epoch ms this step was reached, or null if it has not happened yet. */
  at: number | null;
  /** The furthest step reached: what the strip highlights as current. */
  active: boolean;
  /** Reached and superseded by a later step. */
  done: boolean;
}

export interface PhaseInput {
  nowMs: number;
  kickoffMs: number;
  /** How long before kickoff the agent starts watching (ingest.ts WINDOW_MS). */
  windowMs: number;
  /** Ts of the earliest stored tick for this fixture, or null if none ingested yet. */
  firstTickMs: number | null;
  /** Ts of the most recent stored tick / cron pass over this fixture, or null. */
  lastTickMs: number | null;
  /** How many positions exist on chain for this fixture at this season. */
  positionsCount: number;
  /** Ts of the tick that produced the earliest position, when known. */
  firstPositionMs: number | null;
  /** True once the watch record carries a final score. */
  hasFinalScore: boolean;
  /** True once the match is settled on chain. */
  settled: boolean;
}

const LABELS: Record<PhaseId, string> = {
  window: "window opens",
  watching: "agent watching",
  steam: "steam fired",
  positions: "positions open",
  full_time: "full time",
  settled: "settled",
};

export const PHASE_ORDER: PhaseId[] = ["window", "watching", "steam", "positions", "full_time", "settled"];

/** Derives every step's reached timestamp (or null) from stored facts, then marks the furthest-reached step active. */
export function derivePhases(input: PhaseInput): PhaseStep[] {
  const windowOpensMs = input.kickoffMs - input.windowMs;
  const steamAt = input.positionsCount > 0 ? (input.firstPositionMs ?? input.lastTickMs) : null;

  const at: Record<PhaseId, number | null> = {
    window: input.nowMs >= windowOpensMs ? windowOpensMs : null,
    watching: input.firstTickMs,
    steam: steamAt,
    positions: steamAt,
    full_time: input.hasFinalScore ? input.lastTickMs : null,
    settled: input.settled ? input.lastTickMs : null,
  };

  let lastReached = -1;
  for (let i = 0; i < PHASE_ORDER.length; i++) if (at[PHASE_ORDER[i]] !== null) lastReached = i;

  return PHASE_ORDER.map((id, i) => ({
    id,
    label: LABELS[id],
    at: at[id],
    done: i < lastReached,
    active: i === lastReached,
  }));
}

/** Human label for the currently active step, "not yet open" before the window. */
export function activeLabel(steps: PhaseStep[]): string {
  return steps.find((s) => s.active)?.label ?? "not yet open";
}
