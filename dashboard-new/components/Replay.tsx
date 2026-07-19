"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Analysis } from "../../packages/agent/analyze.ts";
import { resultToOutcomeName } from "../../packages/engine/settle.ts";
import type { Game } from "../lib/fixtures";
import type { Cal } from "../lib/cal";
import Chart from "./Chart";
import ChainPanel from "./ChainPanel";
import Knobs from "./Knobs";

const pts = (n: number) => n.toLocaleString("en-US");
const SPEEDS = [
  { label: "1x", ms: 120 },
  { label: "4x", ms: 30 },
  { label: "20x", ms: 6 },
];

export default function Replay({
  game,
  analysis,
  thetaPp,
  edgePct,
  pinned,
}: {
  game: Game;
  analysis: Analysis;
  thetaPp: number;
  edgePct: number;
  pinned: Cal;
}) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(SPEEDS[1].ms);
  const total = analysis.trace.length;
  const key = `${game.id}:${thetaPp}:${edgePct}`;
  const lastKey = useRef(key);

  // A new analysis (fixture or calibration change) restarts the replay.
  if (lastKey.current !== key) {
    lastKey.current = key;
    setIdx(0);
    setPlaying(true);
  }

  useEffect(() => {
    if (!playing || idx >= total) return;
    const t = setInterval(() => setIdx((i) => Math.min(total, i + 1)), speed);
    return () => clearInterval(t);
  }, [playing, idx, total, speed]);

  const done = idx >= total;
  const shown = analysis.trace.slice(0, idx);
  const current = shown[shown.length - 1] ?? null;
  const outcomeName = (o: string) => (o === "1" ? game.home : o === "2" ? game.away : "Draw");

  const points = useMemo(
    () => shown.map((t) => ({ ts: t.tick.ts, probs: t.tick.outcomes.map((o) => o.fairProb) })),
    [shown],
  );
  const signalsSeen = useMemo(
    () => shown.flatMap((t) => t.events.filter((e) => e.kind === "signal").map((e) => e.signal)),
    [shown],
  );
  // Mid-replay the books are the last tick's snapshot (stake still at risk);
  // at full time they are the settled books, payouts and record included.
  const books = done ? analysis.books : (current?.books ?? analysis.trace[0]?.books ?? analysis.books);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-3">
        <h1 className="font-display text-xl font-semibold tracking-tight text-fg">
          {game.home} vs {game.away}
        </h1>
        <span className="num text-xs text-mute">
          {game.stage} · fixture {game.id} · {game.date}
          {game.final ? ` · FT ${game.final}` : ""}
        </span>
        <span className="num ml-auto text-xs text-mute">
          {current ? `${new Date(current.tick.ts).toUTCString().slice(17, 25)} UTC · ` : ""}tick {idx}/{total}
        </span>
      </header>

      <Knobs fixtureId={game.id} thetaPp={thetaPp} edgePct={edgePct} pinned={pinned} />

      <div className="grid grid-cols-3 gap-3">
        {["1", "X", "2"].map((n, k) => {
          const oc = current?.tick.outcomes.find((o) => o.name === n);
          return (
            <div key={n} className="rounded-lg border border-line bg-surface p-3">
              <div className="flex items-center gap-1.5 text-xs text-mute">
                <span
                  className="inline-block h-0.5 w-3 shrink-0 rounded-full"
                  style={{ background: `var(--chart-${k === 0 ? "home" : k === 1 ? "draw" : "away"})` }}
                />
                <span className="truncate">{outcomeName(n)}</span>
              </div>
              <div className="num mt-1 text-2xl font-medium text-fg">{oc ? oc.decimalOdds.toFixed(2) : "-.--"}</div>
              <div className="num text-xs text-mute">{oc ? `${(oc.fairProb * 100).toFixed(1)}% fair` : ""}</div>
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border border-line bg-surface p-3">
        {points.length < 2 ? (
          <p className="py-16 text-center text-sm text-mute">
            Consensus odds draw here from the second tick. {total} ticks captured for this fixture.
          </p>
        ) : (
          <Chart
            points={points}
            labels={[game.home, "Draw", game.away]}
            signalTs={signalsSeen.map((s) => s.ts)}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          onClick={() => (done ? (setIdx(0), setPlaying(true)) : setPlaying(!playing))}
          className="w-20 rounded-md bg-accent px-3 py-1.5 font-semibold text-white transition-colors hover:bg-accent-2 dark:text-[#1a1005]"
        >
          {done ? "restart" : playing ? "pause" : "play"}
        </button>
        <button
          onClick={() => {
            setPlaying(false);
            setIdx(total);
          }}
          className="rounded-md border border-line-2 px-3 py-1.5 text-mute transition-colors hover:border-accent/60 hover:text-fg"
        >
          skip to end
        </button>
        <div className="inline-flex overflow-hidden rounded-md border border-line">
          {SPEEDS.map((s) => (
            <button
              key={s.label}
              onClick={() => setSpeed(s.ms)}
              aria-pressed={speed === s.ms}
              className={`num px-2.5 py-1.5 transition-colors ${
                speed === s.ms ? "bg-raised text-fg" : "text-mute hover:text-fg"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="h-1 min-w-24 flex-1 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={idx} aria-label="Replay progress">
          <div className="h-full rounded-full bg-accent/70 transition-[width] duration-150" style={{ width: `${total ? (idx / total) * 100 : 0}%` }} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section>
          <h2 className="mb-2 text-[11px] uppercase tracking-wider text-mute">Books</h2>
          <div className="grid grid-cols-2 gap-3">
            {books.map((b) => (
              <div key={b.agentId} className="rounded-lg border border-line bg-surface p-3">
                <div className="text-sm font-medium text-fg">{b.strategy}</div>
                <div className="mb-2 text-[11px] text-mute">
                  {b.agentId === 0 ? "rides the steam" : "bets against the steam"}
                </div>
                <Row label="bankroll" value={pts(b.bankrollPoints)} />
                <Row label="at risk" value={pts(b.stakedPoints)} />
                <Row
                  label="realized pnl"
                  value={`${b.realizedPnl > 0 ? "+" : ""}${pts(b.realizedPnl)}`}
                  tone={b.realizedPnl > 0 ? "won" : b.realizedPnl < 0 ? "lost" : undefined}
                />
                <Row label="record" value={`${b.betsWon}W / ${b.betsLost}L`} />
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-[11px] uppercase tracking-wider text-mute">Tick feed</h2>
          <div className="h-56 overflow-y-auto rounded-lg border border-line bg-surface p-2 text-xs">
            {shown.length === 0 ? (
              <p className="p-2 text-mute">Replay starting.</p>
            ) : (
              [...shown]
                .reverse()
                .flatMap((t) =>
                  t.events.map((ev, i) => {
                    const k = `${t.tick.ts}-${i}`;
                    if (ev.kind === "signal") {
                      return (
                        <p key={k} className="border-l-2 border-accent py-1 pl-2">
                          <b className="text-accent">STEAM</b> on {outcomeName(ev.signal.outcome)}:{" "}
                          <span className="num">
                            {(ev.signal.preProb * 100).toFixed(1)}% -&gt; {(ev.signal.postProb * 100).toFixed(1)}% (
                            {ev.signal.postProb >= ev.signal.preProb ? "+" : "-"}
                            {(ev.signal.magnitude * 100).toFixed(1)}pp sustained)
                          </span>
                        </p>
                      );
                    }
                    if (ev.kind === "hold") {
                      return (
                        <p key={k} className="py-1 pl-2 text-mute">
                          <b>{ev.agent === 0 ? "follow" : "fade"}</b> holds:{" "}
                          {ev.reason === "no-edge" ? (
                            <>no outcome clears the <span className="num">{edgePct.toFixed(1)}%</span> edge floor</>
                          ) : (
                            "stake sized to zero"
                          )}
                        </p>
                      );
                    }
                    const d = ev.decision;
                    return (
                      <p key={k} className="border-l-2 border-accent/60 py-1 pl-2">
                        <b>{d.agent === 0 ? "follow" : "fade"}</b> backs <b>{outcomeName(d.outcome)}</b>{" "}
                        <span className="num">
                          at {d.entryOdds.toFixed(2)} · stake {pts(d.stake)} pts · edge {(d.edge * 100).toFixed(1)}%
                        </span>
                      </p>
                    );
                  }),
                )
                .slice(0, 60)
            )}
            {shown.length > 0 && shown.every((t) => t.events.length === 0) && (
              <p className="p-2 text-mute">
                No signals yet. The agent has seen <span className="num">{shown.length}</span> ticks; a steam move
                needs a <span className="num">{thetaPp.toFixed(1)}pp</span> sustained shove.
              </p>
            )}
          </div>
        </section>
      </div>

      {done && (
        <section>
          <h2 className="mb-2 text-[11px] uppercase tracking-wider text-mute">Settlement · regulation score</h2>
          {analysis.result && (
            <p className="num mb-2 text-sm">
              FT {game.final} · {outcomeName(resultToOutcomeName(analysis.result))} wins
            </p>
          )}
          {analysis.decisions.length === 0 ? (
            <p className="text-sm text-mute">
              No steam cleared <span className="num">{thetaPp.toFixed(1)}pp</span> at a{" "}
              <span className="num">{edgePct.toFixed(1)}%</span> edge floor, so neither agent traded. Discipline is a
              feature: quiet markets stay quiet. Lower the threshold and the replay reruns.
            </p>
          ) : (
            <>
              <div className="hidden overflow-x-auto sm:block">
                <table className="num w-full min-w-125 text-sm">
                  <thead className="text-left text-mute">
                    <tr>
                      <th className="py-1 font-normal">agent</th>
                      <th className="font-normal">backed</th>
                      <th className="text-right font-normal">odds</th>
                      <th className="text-right font-normal">stake</th>
                      <th className="text-right font-normal">result</th>
                      <th className="text-right font-normal">payout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.decisions.map((d) => (
                      <tr key={`${d.agent}-${d.signalSeq}`} className="border-t border-line">
                        <td className="py-1">{d.agent === 0 ? "follow" : "fade"}</td>
                        <td>{outcomeName(d.outcome)}</td>
                        <td className="text-right">{d.entryOdds.toFixed(2)}</td>
                        <td className="text-right">{pts(d.stake)}</td>
                        <td className={`text-right ${d.status === "won" ? "text-won" : d.status === "lost" ? "text-lost" : ""}`}>
                          {d.status.toUpperCase()}
                        </td>
                        <td className="text-right">{pts(d.payout)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Narrow screens: two-line rows instead of a horizontally-scrolled table. */}
              <div className="space-y-2 sm:hidden">
                {analysis.decisions.map((d) => (
                  <div key={`${d.agent}-${d.signalSeq}`} className="num rounded-md border border-line bg-surface p-2 text-xs">
                    <div className="flex items-center justify-between text-fg">
                      <span className="truncate">
                        {d.agent === 0 ? "follow" : "fade"} · {outcomeName(d.outcome)}
                      </span>
                      <span>{d.entryOdds.toFixed(2)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-mute">
                      <span>stake {pts(d.stake)}</span>
                      <span className={d.status === "won" ? "text-won" : d.status === "lost" ? "text-lost" : ""}>
                        {d.status.toUpperCase()}
                      </span>
                      <span>payout {pts(d.payout)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      <ChainPanel game={game} thetaPp={thetaPp} edgePct={edgePct} />

      <footer className="border-t border-line pt-3 text-[11px] text-mute">
        Play-money points. Settlement is provenance-verified against TxLINE&apos;s published roots where anchored; see
        docs for exactly what is and is not proven.
      </footer>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "won" | "lost" }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-mute">{label}</span>
      <span className={`num ${tone === "won" ? "text-won" : tone === "lost" ? "text-lost" : ""}`}>{value}</span>
    </div>
  );
}
