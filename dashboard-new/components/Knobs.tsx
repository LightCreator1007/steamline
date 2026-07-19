"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { EDGE_RANGE, THETA_RANGE, calSeason, isPinned, type Cal } from "../lib/cal";

// The knobs own no state beyond the drag: committing writes the calibration to
// the URL and the server re-analyzes. Shareable, and the URL is what the arena
// season derives from.
export default function Knobs({
  fixtureId,
  thetaPp,
  edgePct,
  pinned,
}: {
  fixtureId: number;
  thetaPp: number;
  edgePct: number;
  pinned: Cal;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [t, setT] = useState(thetaPp);
  const [e, setE] = useState(edgePct);
  const [copied, setCopied] = useState(false);

  // Server-committed values win whenever navigation lands (rail click, back button).
  useEffect(() => {
    setT(thetaPp);
    setE(edgePct);
  }, [thetaPp, edgePct]);

  const commit = (nextT: number, nextE: number) =>
    start(() => router.replace(`/f/${fixtureId}?theta=${nextT.toFixed(1)}&edge=${nextE.toFixed(1)}`, { scroll: false }));

  const season = calSeason(t, e);
  const atPinned = isPinned(t, e, pinned);

  const copyLink = async () => {
    await navigator.clipboard.writeText(`${location.origin}/f/${fixtureId}?theta=${t.toFixed(1)}&edge=${e.toFixed(1)}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded border border-navy-800 bg-navy-900 p-3">
      <Slider
        label="steam threshold"
        value={t}
        unit="pp"
        range={THETA_RANGE}
        onInput={setT}
        onCommit={(v) => commit(v, e)}
      />
      <Slider label="edge floor" value={e} unit="%" range={EDGE_RANGE} onInput={setE} onCommit={(v) => commit(t, v)} />
      <div className="num flex w-full flex-wrap items-center gap-2 text-xs sm:ml-auto sm:w-auto sm:flex-nowrap">
        <span
          className="rounded border border-navy-700 px-2 py-1 text-ink-300"
          title="Identical settings land every visitor in the same on-chain arena."
        >
          {t.toFixed(1)}pp / {e.toFixed(1)}% = arena {atPinned ? "777 (pinned)" : season}
        </span>
        <button onClick={copyLink} className="rounded border border-navy-700 px-2 py-1 hover:border-gold-400/60">
          {copied ? "copied" : "copy link"}
        </button>
        <span className={pending ? "text-gold-400" : "invisible"}>re-analyzing</span>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  unit,
  range,
  onInput,
  onCommit,
}: {
  label: string;
  value: number;
  unit: string;
  range: { min: number; max: number; step: number };
  onInput: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const pct = ((value - range.min) / (range.max - range.min)) * 100;
  return (
    <label className="flex w-full items-center gap-2 text-xs text-ink-500 sm:w-auto">
      <span className="w-24 shrink-0 sm:w-28">{label}</span>
      <span className="relative flex h-11 flex-1 items-center sm:w-40 sm:flex-none">
        {dragging && (
          <span
            className="num pointer-events-none absolute -top-6 -translate-x-1/2 rounded border border-gold-400/60 bg-navy-800 px-1.5 py-0.5 text-[11px] text-gold-400"
            style={{ left: `${pct}%` }}
          >
            {value.toFixed(1)}
            {unit}
          </span>
        )}
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          onChange={(ev) => onInput(Number(ev.target.value))}
          onPointerDown={() => setDragging(true)}
          onPointerUp={(ev) => {
            setDragging(false);
            onCommit(Number((ev.target as HTMLInputElement).value));
          }}
          onKeyDown={() => setDragging(true)}
          onKeyUp={(ev) => {
            setDragging(false);
            onCommit(Number((ev.target as HTMLInputElement).value));
          }}
          onBlur={() => setDragging(false)}
          className="h-11 w-full accent-gold-400"
        />
      </span>
      <span className="num w-12 shrink-0 text-gold-400">
        {value.toFixed(1)}
        {unit}
      </span>
    </label>
  );
}
