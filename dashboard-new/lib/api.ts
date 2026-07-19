// The API is ours, but the response still crosses a process boundary, so it is
// parsed rather than assumed. Every fetcher either returns a parsed payload or
// throws ApiErrorException carrying a typed code for the error surface.
import { z } from "zod";
import { ApiErrorException, apiErrorSchema, type ApiError } from "./errors";

export const positionSchema = z.object({
  agent: z.enum(["follow", "fade"]),
  signalSeq: z.number(),
  outcome: z.enum(["1", "X", "2"]),
  entryOdds: z.number(),
  stake: z.number(),
  status: z.enum(["open", "won", "lost", "refunded"]),
  payout: z.number(),
  address: z.string(),
  onChain: z.boolean(),
  openTx: z.string().nullable(),
  settleTx: z.string().nullable(),
  // Receipt: what the decision was made from.
  oddsRef: z.string(),
  oddsTs: z.number(),
});
export type Position = z.infer<typeof positionSchema>;

export const runStatusSchema = z.object({
  season: z.string(),
  calKeyed: z.boolean(),
  fixtureId: z.number(),
  calibration: z.object({ theta: z.number(), edgeMin: z.number() }),
  noSteam: z.boolean(),
  ran: z.boolean(),
  arena: z.string(),
  match: z.string(),
  books: z.array(z.object({ agent: z.enum(["follow", "fade"]), address: z.string() })),
  positions: z.array(positionSchema),
  fetchedAt: z.number(),
});
export type RunStatus = z.infer<typeof runStatusSchema>;

export const phaseStepSchema = z.object({
  id: z.enum(["window", "watching", "steam", "positions", "full_time", "settled"]),
  label: z.string(),
  at: z.number().nullable(),
  active: z.boolean(),
  done: z.boolean(),
});
export type PhaseStep = z.infer<typeof phaseStepSchema>;

export const liveStatusSchema = z.object({
  season: z.string(),
  fixtureId: z.number(),
  arena: z.string(),
  match: z.string(),
  books: z.array(z.object({ agent: z.enum(["follow", "fade"]), address: z.string() })),
  matchState: z.object({
    exists: z.boolean(),
    status: z.string(),
    homeScore: z.number(),
    awayScore: z.number(),
  }),
  positions: z.array(positionSchema.omit({ onChain: true, oddsRef: true, oddsTs: true })),
  ticks: z.array(
    z.object({
      ts: z.number(),
      outcomes: z.array(z.object({ name: z.string(), odds: z.number(), prob: z.number() })),
    }),
  ),
  phase: z.array(phaseStepSchema),
  /** Ts of the newest stored tick, driving the freshness stamp; null when nothing has been ingested yet. */
  lastTickMs: z.number().nullable(),
  ticksSeen: z.number(),
  fetchedAt: z.number(),
});
export type LiveStatus = z.infer<typeof liveStatusSchema>;

const internal = (message: string): ApiError => ({ code: "internal", message });

async function call<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiErrorException({ code: "chain_unavailable", message: "The status endpoint did not respond." });
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiErrorException(internal(`Status endpoint returned ${res.status} with a non-JSON body.`));
  }
  if (!res.ok || res.status === 207) {
    const parsed = apiErrorSchema.safeParse(body);
    throw new ApiErrorException(parsed.success ? parsed.data : internal(`Request failed with ${res.status}.`));
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiErrorException(internal("Status payload did not match the expected shape."));
  return parsed.data;
}

/** Dev-only escape hatch: ?force=<code> on the page URL is forwarded so every tier is reachable. */
export function runUrl(fixtureId: number, thetaPp: number, edgePct: number, force?: string): string {
  const q = new URLSearchParams({ fixture: String(fixtureId), theta: String(thetaPp), edge: String(edgePct) });
  if (force) q.set("force", force);
  return `/api/run?${q}`;
}

export const fetchRunStatus = (url: string) => call(url, runStatusSchema);
export const postRun = (url: string) => call(url, runStatusSchema, { method: "POST" });
export const fetchLiveStatus = (fixtureId: number, force?: string) => {
  const q = new URLSearchParams({ fixture: String(fixtureId) });
  if (force) q.set("force", force);
  return call(`/api/live-status?${q}`, liveStatusSchema);
};
