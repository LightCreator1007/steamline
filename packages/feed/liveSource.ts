import { parseSseChunk, type SseEvent } from "./sse.ts";
import { FeedError, sleep, type TxlineClient, type ScoreEvent } from "./txlineClient.ts";
import { type OddsPayload } from "../engine/model.ts";
import { type FeedEvent, type FeedSource } from "./source.ts";

export interface StreamOpts {
  fetchImpl?: typeof fetch;
  maxReconnects?: number;
  backoffMs?: number;
  signal?: AbortSignal;
}

export async function streamSse(
  url: string,
  headers: Record<string, string>,
  onEvent: (e: SseEvent) => void,
  opts: StreamOpts = {},
): Promise<void> {
  const f = opts.fetchImpl ?? fetch;
  const maxReconnects = opts.maxReconnects ?? Number.POSITIVE_INFINITY;
  const backoffMs = opts.backoffMs ?? 500;
  let lastId: string | undefined;
  let attempt = 0;
  for (;;) {
    if (opts.signal?.aborted) return;
    try {
      const res = await f(url, {
        signal: opts.signal,
        headers: {
          ...headers,
          Accept: "text/event-stream",
          ...(lastId ? { "Last-Event-ID": lastId } : {}),
        },
      });
      if (!res.ok || !res.body) throw new FeedError("HTTP", `sse status ${res.status} for ${url}`, res.status);
      attempt = 0;
      let rest = "";
      const decoder = new TextDecoder();
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        rest += decoder.decode(chunk, { stream: true });
        const parsed = parseSseChunk(rest);
        rest = parsed.rest;
        for (const ev of parsed.events) {
          if (ev.id) lastId = ev.id;
          onEvent(ev);
        }
      }
      // stream ended cleanly; fall through to reconnect
    } catch (e) {
      if (opts.signal?.aborted) return;
      if (attempt >= maxReconnects) throw e;
    }
    if (attempt >= maxReconnects) return;
    attempt++;
    await sleep(backoffMs * Math.min(8, 2 ** attempt));
  }
}

export interface CommonLiveOpts {
  client: TxlineClient;
  fixtureIds: number[];
  pollMs?: number;
  fetchImpl?: typeof fetch;
  maxReconnects?: number;
  backoffMs?: number;
}

export type LiveOpts =
  | ({ mode: "poll" } & CommonLiveOpts)
  | ({ mode: "sse"; apiBase: string; headers: Record<string, string> } & CommonLiveOpts);

/**
 * Sleeps for `ms` milliseconds, resolving early if `signal` aborts first.
 * Removes its own abort listener before returning either way, so no listener
 * survives past the sleep call.
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    let onAbort: (() => void) | null = null;
    const timer = setTimeout(() => {
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function channel<T>() {
  const buf: T[] = [];
  let notify: (() => void) | null = null;
  let done = false;
  return {
    push(v: T) {
      buf.push(v);
      notify?.();
    },
    close() {
      done = true;
      notify?.();
    },
    async *drain(signal?: AbortSignal): AsyncIterable<T> {
      let onAbort: (() => void) | null = null;
      if (signal) {
        onAbort = () => notify?.();
        signal.addEventListener("abort", onAbort);
      }
      try {
        for (;;) {
          if (signal?.aborted) return;
          if (buf.length > 0) {
            yield buf.shift() as T;
            continue;
          }
          if (done) return;
          await new Promise<void>((r) => {
            notify = r;
          });
          notify = null;
        }
      } finally {
        if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      }
    },
  };
}

export function liveSource(opts: LiveOpts): FeedSource {
  return {
    async *events(signal?: AbortSignal): AsyncIterable<FeedEvent> {
      const ch = channel<FeedEvent>();
      const seenOdds = new Set<string>();
      const seenScores = new Set<string>();

      const pushOdds = (p: OddsPayload) => {
        if (seenOdds.has(p.MessageId)) return;
        seenOdds.add(p.MessageId);
        ch.push({ kind: "odds", ts: p.Ts, payload: p });
      };
      const pushScore = (s: ScoreEvent) => {
        const k = `${s.FixtureId}:${s.Seq ?? JSON.stringify(s)}`;
        if (seenScores.has(k)) return;
        seenScores.add(k);
        ch.push({ kind: "score", ts: Number(s.Ts ?? Date.now()), payload: s });
      };

      const workers: Promise<void>[] = [];
      if (opts.mode === "sse") {
        for (const id of opts.fixtureIds) {
          workers.push(
            streamSse(
              `${opts.apiBase}/api/odds/stream?fixtureId=${id}`,
              opts.headers,
              (e) => {
                try {
                  pushOdds(JSON.parse(e.data) as OddsPayload);
                } catch {
                  // non-JSON keepalive; ignore
                }
              },
              { fetchImpl: opts.fetchImpl, maxReconnects: opts.maxReconnects, backoffMs: opts.backoffMs, signal },
            ),
          );
          // scores stay on polling even in sse mode: settlement latency tolerance is minutes
        }
      }
      workers.push(
        (async () => {
          const pollMs = opts.pollMs ?? 60_000;
          for (;;) {
            if (signal?.aborted) return;
            for (const id of opts.fixtureIds) {
              try {
                if (opts.mode === "poll") (await opts.client.oddsSnapshot(id)).forEach(pushOdds);
                (await opts.client.scoresSnapshot(id)).forEach(pushScore);
              } catch {
                // transient poll errors are retried on the next cycle
              }
            }
            await abortableSleep(pollMs, signal);
            if (signal?.aborted) return;
          }
        })(),
      );
      void Promise.allSettled(workers).then(() => ch.close());

      yield* ch.drain(signal);
    },
  };
}
