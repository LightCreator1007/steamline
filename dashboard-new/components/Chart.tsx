"use client";

import { useEffect, useRef } from "react";
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

const COLORS = ["#ffd84d", "#7b88a8", "#7fd4dc"];

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
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Line">[]>([]);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      height,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#7b88a8", fontSize: 11 },
      grid: { vertLines: { color: "#1d2842" }, horzLines: { color: "#1d2842" } },
      rightPriceScale: { borderColor: "#1d2842" },
      timeScale: { borderColor: "#1d2842", timeVisible: true, secondsVisible: false },
      crosshair: { horzLine: { labelBackgroundColor: "#141d33" }, vertLine: { labelBackgroundColor: "#141d33" } },
      localization: { priceFormatter: (v: number) => `${(v * 100).toFixed(1)}%` },
    });
    chart.current = c;
    series.current = COLORS.map((color) => c.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false }));
    markers.current = createSeriesMarkers(series.current[0]);
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
  }, [height]);

  useEffect(() => {
    if (!chart.current) return;
    // Two ticks can share a whole second; lightweight-charts requires strictly
    // ascending times, so collapse duplicates to the last value seen.
    for (let k = 0; k < series.current.length; k++) {
      const byTime = new Map<number, number>();
      for (const p of points) byTime.set(Math.floor(p.ts / 1000), p.probs[k]);
      series.current[k].setData([...byTime].map(([time, value]) => ({ time: time as Time, value })));
    }
    markers.current?.setMarkers(
      signalTs.map((t, i) => ({
        time: Math.floor(t / 1000) as Time,
        position: "aboveBar" as const,
        color: "#ff7a5c",
        shape: "arrowDown" as const,
        text: `STEAM #${i + 1}`,
      })),
    );
    chart.current.timeScale().fitContent();
  }, [points, signalTs]);

  return (
    <div>
      <div ref={box} />
      <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-ink-500">
        {labels.map((l, k) => (
          <span key={l} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: COLORS[k] }} />
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
