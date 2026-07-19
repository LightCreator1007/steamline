"use client";

import { useEffect, useRef, useState } from "react";
import {
  ColorType,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
} from "lightweight-charts";

export interface Point {
  ts: number;
  probs: number[]; // [1, X, 2] fair probability
}

// Canvas cannot resolve CSS variables, so the palette is read off the root
// element and the chart is rebuilt when the theme flips.
function readPalette() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    series: [v("--chart-home"), v("--chart-draw"), v("--chart-away")],
    label: v("--chart-label"),
    grid: v("--chart-grid"),
    tip: v("--chart-tip"),
    steam: v("--accent"),
  };
}

// The market's fair probability per outcome over the replay, appended as the
// tape advances. Canvas, so appending a tick is a draw, not a re-render.
export default function Chart({
  points,
  labels,
  signalTs,
  height = 220,
}: {
  points: Point[];
  labels: string[];
  signalTs: number[];
  height?: number;
}) {
  // Rebuild when the theme class actually lands on <html>. Watching the DOM
  // instead of next-themes state avoids reading CSS variables before the
  // provider's own effect has swapped the class.
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const obs = new MutationObserver(() => setThemeTick((n) => n + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Line">[]>([]);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const steam = useRef("#ee7433");
  const latest = useRef({ points, signalTs });
  latest.current = { points, signalTs };

  useEffect(() => {
    if (!box.current) return;
    const pal = readPalette();
    steam.current = pal.steam;
    const c = createChart(box.current, {
      height,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: pal.label, fontSize: 11 },
      grid: { vertLines: { color: pal.grid }, horzLines: { color: pal.grid } },
      rightPriceScale: { borderColor: pal.grid },
      timeScale: { borderColor: pal.grid, timeVisible: true, secondsVisible: false },
      crosshair: { horzLine: { labelBackgroundColor: pal.tip }, vertLine: { labelBackgroundColor: pal.tip } },
      localization: { priceFormatter: (v: number) => `${(v * 100).toFixed(1)}%` },
    });
    chart.current = c;
    series.current = pal.series.map((color, k) =>
      c.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, ...(k === 1 ? { lineWidth: 1 as const } : {}) }),
    );
    markers.current = createSeriesMarkers(series.current[0]);
    feed(series.current, markers.current, latest.current.points, latest.current.signalTs, steam.current);
    c.timeScale().fitContent();
    const resize = () => c.applyOptions({ width: box.current?.clientWidth ?? 0 });
    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      c.remove();
      chart.current = null;
      series.current = [];
      markers.current = null;
    };
  }, [height, themeTick]);

  useEffect(() => {
    if (!chart.current) return;
    feed(series.current, markers.current, points, signalTs, steam.current);
    chart.current.timeScale().fitContent();
  }, [points, signalTs]);

  return (
    <div>
      <div ref={box} />
      <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-mute">
        {labels.map((l, k) => (
          <span key={l} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: `var(--chart-${k === 0 ? "home" : k === 1 ? "draw" : "away"})` }} />
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

function feed(
  lines: ISeriesApi<"Line">[],
  marks: ISeriesMarkersPluginApi<Time> | null,
  points: Point[],
  signalTs: number[],
  steamColor: string,
) {
  // Two ticks can share a whole second; lightweight-charts requires strictly
  // ascending times, so collapse duplicates to the last value seen.
  for (let k = 0; k < lines.length; k++) {
    const byTime = new Map<number, number>();
    for (const p of points) byTime.set(Math.floor(p.ts / 1000), p.probs[k]);
    lines[k].setData([...byTime].map(([time, value]) => ({ time: time as Time, value })));
  }
  marks?.setMarkers(
    signalTs.map((t, i) => ({
      time: Math.floor(t / 1000) as Time,
      position: "aboveBar" as const,
      color: steamColor,
      shape: "arrowDown" as const,
      text: `STEAM #${i + 1}`,
    })),
  );
}
