import { redactSecrets } from "../engine/errors.ts";
import { type OddsPayload } from "../engine/model.ts";

export interface Fixture {
  Ts: number;
  StartTime: number;
  Competition: string;
  CompetitionId: number;
  FixtureGroupId: number;
  Participant1Id: number;
  Participant1: string;
  Participant2Id: number;
  Participant2: string;
  FixtureId: number;
  Participant1IsHome: boolean;
}

// The scores schema is confirmed from captured payloads (spec section 12); keep it permissive.
export interface ScoreEvent {
  FixtureId: number;
  Seq?: number;
  Ts?: number;
  StatKey?: string;
  [k: string]: unknown;
}

export interface ValidationProof {
  [k: string]: unknown;
}

export type FeedErrorCode = "HTTP" | "AUTH" | "TIMEOUT" | "NETWORK" | "BAD_JSON";

export class FeedError extends Error {
  readonly code: FeedErrorCode;
  readonly status?: number;
  constructor(code: FeedErrorCode, message: string, status?: number) {
    super(redactSecrets(message));
    this.name = "FeedError";
    this.code = code;
    this.status = status;
  }
}

export interface ClientConfig {
  apiBase: string;
  jwt?: string;
  apiToken?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
}

export interface TxlineClient {
  fixturesSnapshot(q?: { competitionId?: number; startEpochDay?: number }): Promise<Fixture[]>;
  oddsSnapshot(fixtureId: number, asOf?: number): Promise<OddsPayload[]>;
  oddsValidation(messageId: string, ts: number): Promise<ValidationProof>;
  scoresSnapshot(fixtureId: number): Promise<ScoreEvent[]>;
  scoreStatValidation(fixtureId: number, seq: number, statKey: string): Promise<ValidationProof>;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function qs(params: Record<string, number | string | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export function makeClient(cfg: ClientConfig): TxlineClient {
  const f = cfg.fetchImpl ?? fetch;
  const timeoutMs = cfg.timeoutMs ?? 10_000;
  const retries = cfg.retries ?? 2;
  const backoffMs = cfg.backoffMs ?? 250;

  function authHeaders(): Record<string, string> {
    return {
      ...(cfg.jwt ? { Authorization: `Bearer ${cfg.jwt}` } : {}),
      ...(cfg.apiToken ? { "X-Api-Token": cfg.apiToken } : {}),
    };
  }

  async function once<T>(url: string): Promise<T> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      let res: Response;
      try {
        res = await f(url, { signal: ctl.signal, headers: authHeaders() });
      } catch (e) {
        throw new FeedError(ctl.signal.aborted ? "TIMEOUT" : "NETWORK", `request failed for ${url}: ${String(e)}`);
      }
      if (res.status === 401 || res.status === 403) {
        throw new FeedError("AUTH", `auth failed with ${res.status} for ${url}`, res.status);
      }
      if (!res.ok) {
        throw new FeedError("HTTP", `status ${res.status} for ${url}`, res.status);
      }
      try {
        return (await res.json()) as T;
      } catch {
        throw new FeedError("BAD_JSON", `unparseable JSON body from ${url}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async function get<T>(path: string): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await once<T>(`${cfg.apiBase}${path}`);
      } catch (e) {
        lastErr = e;
        const retriable =
          e instanceof FeedError &&
          (e.code === "NETWORK" || e.code === "TIMEOUT" || (e.code === "HTTP" && (e.status ?? 0) >= 500));
        if (!retriable || attempt === retries) throw e;
        await sleep(backoffMs * 2 ** attempt);
      }
    }
    throw lastErr;
  }

  return {
    fixturesSnapshot: (q = {}) =>
      get(`/api/fixtures/snapshot${qs({ competitionId: q.competitionId, startEpochDay: q.startEpochDay })}`),
    oddsSnapshot: (fixtureId, asOf) => get(`/api/odds/snapshot/${fixtureId}${qs({ asOf })}`),
    oddsValidation: (messageId, ts) => get(`/api/odds/validation${qs({ messageId, ts })}`),
    scoresSnapshot: (fixtureId) => get(`/api/scores/snapshot/${fixtureId}`),
    scoreStatValidation: (fixtureId, seq, statKey) =>
      get(`/api/scores/stat-validation${qs({ fixtureId, seq, statKey })}`),
  };
}
