"use client";

/* The hero replay: a real captured tape, not a mock.
   Storyboard (times absolute from mount):
     0ms           sweep starts, the tape reveals left to right
     sigMs         the steam signal the agent actually fired: ember pulse + label
     sigMs+400     follow chip enters
     sigMs+900     fade chip enters
     sweep+400     settlement stamp (FT score, per-agent pnl)
     sweep+4600    loop restarts
*/

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useAnimationFrame, useMotionValue, useReducedMotion, useTransform } from "motion/react";

export interface HeroTape {
  fixtureId: number;
  home: string;
  away: string;
  stage: string;
  final: string;
  ticks: number;
  thetaPp: number;
  points: { t: number; probs: number[] }[];
  signals: { t: number; outcome: string; prePct: number; postPct: number; magPp: number }[];
  decisions: { agent: number; outcome: string; entryOdds: number; stake: number; status: string; payout: number }[];
}

const TIMING = {
  sweepMs: 7200,
  signalChipMs: 400,
  chipStaggerMs: 500,
  stampAfterSweepMs: 400,
  holdMs: 4600,
};

const W = 720;
const H = 300;
const PAD = { top: 26, right: 14, bottom: 18, left: 40 };

const pts = (n: number) => n.toLocaleString("en-US");

export default function SteamTape({ tape }: { tape: HeroTape }) {
  const still = useReducedMotion() ?? false;
  const [stage, setStage] = useState(still ? 4 : 0);

  const geo = useMemo(() => buildGeometry(tape), [tape]);
  const sig = geo.signals[0] ?? null;
  const sigMs = (sig ? sig.x01 : 0.6) * TIMING.sweepMs;
  const outcomeName = (o: string) => (o === "1" ? tape.home : o === "2" ? tape.away : "Draw");

  // One clock drives the sweep AND the stages. Parallel setTimeout timers
  // desync from a duration tween the moment frames drop, so the clip, the
  // cursor, and every stage threshold derive from the same elapsed time.
  const progress = useMotionValue(still ? 1 : 0);
  const clip = useTransform(progress, (v) => `inset(0 ${(1 - Math.min(v, 1)) * 100}% 0 0)`);
  const cursorLeft = useTransform(progress, (v) => `${Math.min(v, 1) * 100}%`);
  const startRef = useRef<number | null>(null);
  useAnimationFrame(() => {
    if (still) return;
    const now = performance.now();
    if (startRef.current === null) startRef.current = now;
    const elapsed = now - startRef.current;
    if (elapsed >= TIMING.sweepMs + TIMING.stampAfterSweepMs + TIMING.holdMs) {
      startRef.current = now;
      progress.set(0);
      setStage(0);
      return;
    }
    progress.set(Math.min(elapsed / TIMING.sweepMs, 1));
    let s = 0;
    if (elapsed >= sigMs) s = 1;
    if (elapsed >= sigMs + TIMING.signalChipMs) s = 2;
    if (elapsed >= sigMs + TIMING.signalChipMs + TIMING.chipStaggerMs) s = 3;
    if (elapsed >= TIMING.sweepMs + TIMING.stampAfterSweepMs) s = 4;
    setStage(s);
  });

  return (
    <figure className="w-full">
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-[0_16px_48px_-24px_rgb(0_0_0/0.5)]">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-4 py-2.5 text-[11px] text-mute">
          <span className="font-medium text-fg">
            {tape.home} vs {tape.away}
          </span>
          <span>{tape.stage.toLowerCase()}, the real tape</span>
          <span className="num ml-auto hidden sm:block">
            theta {tape.thetaPp.toFixed(1)}pp · {pts(tape.ticks)} ticks
          </span>
        </div>

        <div className="relative">
          {/* The tape itself, revealed by the sweep. */}
          <motion.div style={{ clipPath: clip }}>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              className="block h-60 w-full sm:h-auto"
              role="img"
              aria-label={`Consensus odds for ${tape.home} vs ${tape.away} with the steam signal the agent traded`}
            >
              {geo.gridY.map((g) => (
                <g key={g.label}>
                  <line x1={PAD.left} x2={W - PAD.right} y1={g.y} y2={g.y} stroke="var(--chart-grid)" strokeWidth="1" />
                  <text x={PAD.left - 8} y={g.y + 3} textAnchor="end" fontSize="10" fill="var(--chart-label)" className="num">
                    {g.label}
                  </text>
                </g>
              ))}
              {geo.paths.map((d, k) => (
                <path
                  key={k}
                  d={d}
                  fill="none"
                  stroke={`var(--chart-${k === 0 ? "home" : k === 1 ? "draw" : "away"})`}
                  strokeWidth={k === 1 ? 1.5 : 2}
                  strokeLinejoin="round"
                  opacity={k === 1 ? 0.8 : 1}
                />
              ))}
              {sig && stage >= 1 && (
                <line x1={sig.px} x2={sig.px} y1={PAD.top - 6} y2={H - PAD.bottom} stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
              )}
            </svg>
          </motion.div>

          {/* Sweep cursor. */}
          {!still && stage < 4 && (
            <motion.div className="pointer-events-none absolute inset-y-0 w-px bg-fg/30" style={{ left: cursorLeft }} />
          )}

          {/* Signal pulse and label, at the real tick it fired on. */}
          {sig && stage >= 1 && (
            <div className="pointer-events-none absolute" style={{ left: `${(sig.px / W) * 100}%`, top: `${(sig.py / H) * 100}%` }}>
              <motion.span
                className="absolute -left-1.5 -top-1.5 block h-3 w-3 rounded-full bg-accent"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 22 }}
              />
              {!still && stage < 4 && (
                <motion.span
                  className="absolute -left-1.5 -top-1.5 block h-3 w-3 rounded-full bg-accent"
                  initial={{ scale: 1, opacity: 0.7 }}
                  animate={{ scale: 3.2, opacity: 0 }}
                  transition={{ duration: 1.1, repeat: 2, ease: "easeOut" }}
                />
              )}
              <motion.span
                className="num absolute -left-3 -top-8 -translate-x-full whitespace-nowrap rounded border border-accent/50 bg-surface px-1.5 py-0.5 text-[10px] font-medium text-accent"
                initial={still ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              >
                STEAM {sig.sign}
                {sig.magPp.toFixed(1)}pp on {outcomeName(sig.outcome)}
              </motion.span>
            </div>
          )}

          {/* Decision chips: both agents trade the signal. */}
          <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-end gap-1.5">
            {tape.decisions.slice(0, 2).map((d, i) => (
              <AnimatePresence key={`${d.agent}-${i}`}>
                {stage >= 2 + i && (
                  <motion.span
                    className="num rounded-md border border-line bg-raised/95 px-2 py-1 text-[10px] text-fg backdrop-blur-sm sm:text-[11px]"
                    initial={still ? false : { opacity: 0, y: -6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ type: "spring", stiffness: 420, damping: 28 }}
                  >
                    <b className="font-semibold">{d.agent === 0 ? "follow" : "fade"}</b> backs {outcomeName(d.outcome)} @{" "}
                    {d.entryOdds.toFixed(2)}
                    <span className="hidden sm:inline"> · {pts(d.stake)} pts</span>
                  </motion.span>
                )}
              </AnimatePresence>
            ))}
          </div>

          {/* Settlement stamp. */}
          <AnimatePresence>
            {stage >= 4 && (
              <motion.div
                className="absolute bottom-3 right-3 max-w-[calc(100%-1.5rem)] rounded-md border border-line bg-raised/95 px-2.5 py-1.5 text-[10px] backdrop-blur-sm sm:text-[11px]"
                initial={still ? false : { opacity: 0, scale: 1.25 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 380, damping: 26 }}
              >
                <span className="num font-semibold text-fg">FT {tape.final}</span>
                {tape.decisions.slice(0, 2).map((d, i) => {
                  const pnl = d.status === "won" ? d.payout - d.stake : d.status === "lost" ? -d.stake : 0;
                  return (
                    <span key={i} className="num ml-2.5 text-mute">
                      {d.agent === 0 ? "follow" : "fade"}{" "}
                      <b className={pnl > 0 ? "text-won" : pnl < 0 ? "text-lost" : ""}>
                        {pnl >= 0 ? "+" : ""}
                        {pts(pnl)}
                      </b>
                    </span>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-[11px] text-mute">
          {[tape.home, "Draw", tape.away].map((l, k) => (
            <span key={l} className="flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-4 rounded-full"
                style={{ background: `var(--chart-${k === 0 ? "home" : k === 1 ? "draw" : "away"})` }}
              />
              {l}
            </span>
          ))}
          <Link href={`/f/${tape.fixtureId}`} className="ml-auto text-accent hover:underline">
            replay it yourself
          </Link>
        </div>
      </div>
    </figure>
  );
}

/* Scale the tape into the viewBox: x by tick index, y across the probability
   band all three lines actually occupy. */
function buildGeometry(tape: HeroTape) {
  const { points, signals } = tape;
  const n = points.length;
  const all = points.flatMap((p) => p.probs);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo) * 0.12 || 0.05;
  const y0 = lo - pad;
  const y1 = hi + pad;
  const x = (i: number) => PAD.left + (i / Math.max(1, n - 1)) * (W - PAD.left - PAD.right);
  const y = (p: number) => PAD.top + (1 - (p - y0) / (y1 - y0)) * (H - PAD.top - PAD.bottom);

  const paths = [0, 1, 2].map((k) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.probs[k]).toFixed(1)}`).join(""),
  );

  const gridY = [0.25, 0.5, 0.75].map((f) => {
    const prob = y0 + f * (y1 - y0);
    return { y: y(prob), label: `${(prob * 100).toFixed(0)}%` };
  });

  const sigGeo = signals.slice(0, 1).map((s) => {
    let i = points.findIndex((p) => p.t >= s.t);
    if (i < 0) i = n - 1;
    const k = s.outcome === "1" ? 0 : s.outcome === "X" ? 1 : 2;
    return {
      px: x(i),
      py: y(points[i].probs[k]),
      x01: i / Math.max(1, n - 1),
      magPp: s.magPp,
      sign: s.postPct >= s.prePct ? "+" : "-",
      outcome: s.outcome,
    };
  });

  return { paths, gridY, signals: sigGeo };
}
