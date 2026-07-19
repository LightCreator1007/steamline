"use client";

// The on-chain arena panel: what the run looks like on devnet at the current
// calibration, or the explaining state for why there is nothing there yet.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchLiveStatus, fetchRunStatus, postRun, runUrl, type LiveStatus, type PhaseStep, type RunStatus } from "../lib/api";
import { ApiErrorException, tierOf, type ApiError } from "../lib/errors";
import type { Game } from "../lib/fixtures";
import { activeLabel } from "../lib/phase";
import {
  ConfirmRunDialog,
  InlineNotice,
  PartialRunDialog,
  RateLimitDialog,
  useTransientErrorToast,
} from "./ErrorSurface";
import Chart from "./Chart";
import ReceiptRow, { PositionCard } from "./ReceiptRow";

const ADDR = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;
const asApiError = (e: unknown): ApiError | null => (e instanceof ApiErrorException ? e.detail : null);
const pp = (v: number) => `${(v * 100).toFixed(1)}`;

export default function ChainPanel({ game, thetaPp, edgePct }: { game: Game; thetaPp: number; edgePct: number }) {
  const force = useSearchParams().get("force") ?? undefined;
  const url = runUrl(game.id, thetaPp, edgePct, force);
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [dismissed, setDismissed] = useState<ApiError | null>(null);

  // Live fixtures have no replay capture and /api/run refuses them outright,
  // so asking would only surface "no replayable capture" as if it were a
  // fault. The chain panel is the whole story during a live window.
  const query = useQuery({
    queryKey: ["run", url],
    queryFn: () => fetchRunStatus(url),
    refetchInterval: 60_000,
    enabled: !game.live,
  });

  // Mirror of the gate above. A finished fixture has no ingestion window to
  // wait on, so polling it only ever renders "no ticks stored yet" as if the
  // cron were late, and duplicates the chart the replay already draws.
  const live = useQuery({
    queryKey: ["live", game.id, force],
    queryFn: () => fetchLiveStatus(game.id, force),
    refetchInterval: 60_000,
    enabled: game.live === true,
  });
  const liveError = asApiError(live.error);

  const run = useMutation({
    mutationFn: () => postRun(url),
    onSuccess: (data: RunStatus) => qc.setQueryData(["run", url], data),
  });

  const error = asApiError(query.error) ?? asApiError(run.error);
  useTransientErrorToast(error && tierOf(error.code) === "toast" ? error : null, query.isFetching || query.failureCount > 0);

  const dialogError = error && tierOf(error.code) === "dialog" && error !== dismissed ? error : null;

  const notices = [...new Set([liveError?.message, error && tierOf(error.code) === "inline" ? error.message : null].filter((m) => m != null))];

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-baseline gap-x-3 border-b border-navy-800 pb-2">
        <h2 className="text-[11px] uppercase tracking-wider text-ink-500">On-chain</h2>
        {query.data && (
          <span className="num text-[11px] text-ink-500">
            {query.data.calKeyed ? "calibration arena" : "public devnet arena"} · season {query.data.season} ·{" "}
            {pp(query.data.calibration.theta)}pp / {pp(query.data.calibration.edgeMin)}%
          </span>
        )}
        <Freshness at={query.data?.fetchedAt ?? null} stale={query.isStale} loading={query.isFetching} />
      </header>

      {live.data && <LiveStrip status={live.data} labels={[game.home, "Draw", game.away]} />}
      {!live.data && live.isLoading && (
        <InlineNotice>Reading live status from devnet and the tick store.</InlineNotice>
      )}

      {query.isLoading && <InlineNotice>Reading the arena from devnet.</InlineNotice>}

      {/* Both queries read the same arena, so one missing key fails both with the
          same message. Show it once. */}
      {notices.map((n) => (
        <InlineNotice key={n}>{n}</InlineNotice>
      ))}

      {query.data && <Body status={query.data} game={game} onRun={() => setConfirming(true)} running={run.isPending} />}

      {query.data && (
        <p className="num text-[11px] text-ink-500">
          Arena{" "}
          <a className="text-gold-400 hover:underline" href={ADDR(query.data.arena)} target="_blank" rel="noopener">
            {query.data.arena.slice(0, 8)}
          </a>{" "}
          · Match{" "}
          <a className="text-gold-400 hover:underline" href={ADDR(query.data.match)} target="_blank" rel="noopener">
            {query.data.match.slice(0, 8)}
          </a>{" "}
          · Books{" "}
          {query.data.books.map((b, i) => (
            <span key={b.agent}>
              {i > 0 && " / "}
              <a className="text-gold-400 hover:underline" href={ADDR(b.address)} target="_blank" rel="noopener">
                {b.agent}
              </a>
            </span>
          ))}
        </p>
      )}

      <ConfirmRunDialog
        open={confirming}
        onOpenChange={setConfirming}
        season={query.data?.season ?? ""}
        txCount={(query.data?.positions.length ?? 0) + (query.data?.calKeyed ? 4 : 1)}
        onConfirm={() => run.mutate()}
      />
      <RateLimitDialog
        error={dialogError?.code === "rate_limited" ? dialogError : null}
        onOpenChange={() => setDismissed(error)}
      />
      <PartialRunDialog
        error={dialogError?.code === "partial_run" ? dialogError : null}
        onOpenChange={() => setDismissed(error)}
      />
    </section>
  );
}

function Body({
  status,
  game,
  onRun,
  running,
}: {
  status: RunStatus;
  game: Game;
  onRun: () => void;
  running: boolean;
}) {
  const outcomeName = (o: string) => (o === "1" ? game.home : o === "2" ? game.away : "Draw");
  const cal = `${pp(status.calibration.theta)}pp / ${pp(status.calibration.edgeMin)}%`;

  if (status.noSteam) {
    return (
      <InlineNotice>
        At {status.calKeyed ? "this calibration" : "the pinned calibration"} (<span className="num">{cal}</span>) this
        game produces no signals, so there is nothing to trade on chain. Move the sliders to a twitchier setting and
        this panel follows.
      </InlineNotice>
    );
  }

  if (!status.ran) {
    return (
      <div className="space-y-2">
        <InlineNotice>
          {status.calKeyed ? (
            <>
              These exact slider settings (<span className="num">{cal}</span>) map to their own arena on chain, and
              nobody has executed this combination yet. Running it creates the arena and trades both agents at your
              settings, on devnet. Anyone else choosing the same settings lands in the same arena and sees this same
              run.
            </>
          ) : (
            <>
              This game has not been executed on the public arena yet. Anyone can trigger its one canonical run at
              the pinned calibration (<span className="num">{cal}</span>).
            </>
          )}
        </InlineNotice>
        <button
          onClick={onRun}
          disabled={running}
          className="rounded border border-gold-400/60 px-3 py-1.5 text-xs text-gold-400 hover:bg-gold-400/10 disabled:opacity-50"
        >
          {running ? "submitting devnet transactions, up to a minute" : `Run this ${status.calKeyed ? "calibration" : "game"} on the devnet arena`}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-ink-500">
        Executed at {status.calKeyed ? "this calibration" : "the pinned calibration"} (<span className="num">{cal}</span>
        ). Every row is a real devnet transaction; open a receipt for the odds message it was taken from.
      </p>
      <div className="hidden overflow-x-auto sm:block">
        <table className="num w-full min-w-125 text-sm">
          <thead className="text-left text-ink-500">
            <tr>
              <th className="py-1 font-normal">agent</th>
              <th className="font-normal">backed</th>
              <th className="text-right font-normal">odds</th>
              <th className="text-right font-normal">stake</th>
              <th className="text-right font-normal">result</th>
              <th className="text-right font-normal">payout</th>
              <th className="text-right font-normal">receipt</th>
            </tr>
          </thead>
          <tbody>
            {status.positions.map((p) => (
              <ReceiptRow key={`${p.agent}-${p.signalSeq}`} p={p} outcomeName={outcomeName} />
            ))}
          </tbody>
        </table>
      </div>
      {/* Narrow screens: two-line rows, receipt still expands inline. */}
      <div className="space-y-2 sm:hidden">
        {status.positions.map((p) => (
          <PositionCard key={`${p.agent}-${p.signalSeq}`} p={p} outcomeName={outcomeName} />
        ))}
      </div>
    </div>
  );
}

function Freshness({ at, stale, loading }: { at: number | null; stale: boolean; loading: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (at === null) return null;
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  const label = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  return (
    <span className={`num ml-auto text-[11px] ${stale ? "text-[#e0a13a]" : "text-ink-500"}`}>
      {loading ? "reading chain" : `last read ${label} ago`}
    </span>
  );
}

/** M4 live view: status strip + phase strip, reconstructed each poll from chain PDAs and the tick store. */
function LiveStrip({ status, labels }: { status: LiveStatus; labels: string[] }) {
  return (
    <div className="space-y-2 rounded border border-navy-800 bg-navy-900 p-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-ink-500">
        <span>
          season <span className="num text-gold-400">{status.season}</span>
        </span>
        <span>
          match <span className="num">{status.matchState.status}</span>
        </span>
        <span>
          ticks seen <span className="num">{status.ticksSeen}</span>
        </span>
        <span>
          positions <span className="num">{status.positions.length}</span>
        </span>
        <TickFreshness lastTickMs={status.lastTickMs} />
      </div>
      <p className="text-[11px] text-ink-500">
        Now: <span className="text-gold-400">{activeLabel(status.phase)}</span>
        {activeLabel(status.phase) === "not yet open" &&
          " · the window opens automatically a few hours before kickoff; this strip updates the moment ingestion starts."}
      </p>
      <PhaseStrip phase={status.phase} />
      {status.ticks.length > 1 && (
        // The same chart the replay draws, fed from the live tape instead of a
        // capture. No signal markers: the status feed carries positions, not
        // the tick each one fired on.
        <Chart
          points={status.ticks.map((t) => ({ ts: t.ts, probs: t.outcomes.map((o) => o.prob) }))}
          labels={labels}
          signalTs={[]}
          height={180}
        />
      )}
      <LivePositions positions={status.positions} />
    </div>
  );
}

/**
 * On a live card the run-status panel never loads (there is no replay to run),
 * so this is the only place the on-chain record appears. Same rows, fewer
 * columns: the live payload carries no odds receipt.
 */
function LivePositions({ positions }: { positions: LiveStatus["positions"] }) {
  if (positions.length === 0) return null;
  return (
    <div className="overflow-x-auto border-t border-navy-800 pt-2">
      <table className="num w-full min-w-100 text-xs">
        <thead className="text-left text-ink-500">
          <tr>
            <th className="py-1 font-normal">agent</th>
            <th className="font-normal">backed</th>
            <th className="text-right font-normal">odds</th>
            <th className="text-right font-normal">stake</th>
            <th className="text-right font-normal">result</th>
            <th className="text-right font-normal">payout</th>
            <th className="text-right font-normal">tx</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={`${p.agent}-${p.signalSeq}`} className="border-t border-navy-800">
              <td className="py-1">{p.agent}</td>
              <td>{p.outcome}</td>
              <td className="text-right">{p.entryOdds.toFixed(2)}</td>
              <td className="text-right">{p.stake.toLocaleString("en-US")}</td>
              <td className={`text-right ${p.status === "won" ? "text-won" : p.status === "lost" ? "text-lost" : ""}`}>
                {p.status.toUpperCase()}
              </td>
              <td className="text-right">{p.payout.toLocaleString("en-US")}</td>
              <td className="text-right">
                {p.settleTx || p.openTx ? (
                  <a
                    className="text-gold-400 hover:underline"
                    href={`https://explorer.solana.com/tx/${p.settleTx ?? p.openTx}?cluster=devnet`}
                    target="_blank"
                    rel="noopener"
                  >
                    view
                  </a>
                ) : (
                  <span className="text-ink-500">lookup unavailable</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PhaseStrip({ phase }: { phase: PhaseStep[] }) {
  const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <ol className="num flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]">
      {phase.map((step, i) => (
        <li key={step.id} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-ink-500/40">{"->"}</span>}
          <span className={step.active ? "rounded border border-gold-400/60 px-1.5 py-0.5 text-gold-400" : step.done ? "text-ink-500" : "text-ink-500/40"}>
            {step.label}
          </span>
          {step.at !== null && <span className="text-ink-500/70">{clock(step.at)}</span>}
        </li>
      ))}
    </ol>
  );
}

function TickFreshness({ lastTickMs }: { lastTickMs: number | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (lastTickMs === null) {
    return <span className="ml-auto text-ink-500">no ticks stored yet, ingestion starts once the window opens</span>;
  }
  const secs = Math.max(0, Math.round((Date.now() - lastTickMs) / 1000));
  // Past an hour, mm:ss stops reading as a duration ("835:18 ago" is noise).
  const label =
    secs < 60
      ? `${secs}s`
      : secs < 3600
        ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`
        : secs < 86_400
          ? `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
          : `${Math.floor(secs / 86_400)}d ${Math.floor((secs % 86_400) / 3600)}h`;
  const stale = secs > 180;
  return (
    <span className={`num ml-auto ${stale ? "text-[#e0a13a]" : "text-ink-500"}`}>
      last tick {label} ago
      {stale && " · cron may be paused, or the match has not reached its ingestion window yet"}
    </span>
  );
}
