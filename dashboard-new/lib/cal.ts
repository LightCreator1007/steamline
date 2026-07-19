// Calibration lives in the URL, in slider units (theta in pp, edge in percent),
// which is exactly what server/run.ts expects. The season derivation below
// mirrors calSeason() there; the two must not drift, since the season IS the
// arena address a visitor lands in.
export interface Cal {
  theta: number; // fraction, e.g. 0.005
  edgeMin: number;
}

export const THETA_RANGE = { min: 0.2, max: 3.0, step: 0.1 };
export const EDGE_RANGE = { min: 0, max: 2.0, step: 0.1 };

const clampTenths = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v * 10)));

/** Slider units (pp, %) out of a search-param pair, falling back to the pinned calibration. */
export function calFromParams(params: { theta?: string; edge?: string }, pinned: Cal): { thetaPp: number; edgePct: number } {
  const t = Number(params.theta);
  const e = Number(params.edge);
  return {
    thetaPp: Number.isFinite(t) ? clampTenths(t, 2, 30) / 10 : Math.round(pinned.theta * 1000) / 10,
    edgePct: Number.isFinite(e) ? clampTenths(e, 0, 20) / 10 : Math.round(pinned.edgeMin * 1000) / 10,
  };
}

// Slider units are hundredths: 0.4pp on the slider is theta 0.004, which is
// what calSeason() in server/run.ts also lands on (tt/1000 with tt = pp*10).
export const toCal = (thetaPp: number, edgePct: number): Cal => ({ theta: thetaPp / 100, edgeMin: edgePct / 100 });

/** 900000 + thetaTenths*100 + edgeTenths. Mirrors calSeason() in server/run.ts. */
export const calSeason = (thetaPp: number, edgePct: number): number =>
  900000 + Math.round(thetaPp * 10) * 100 + Math.round(edgePct * 10);

/** True when the sliders sit on the fixture's pinned calibration, whose canonical run lives on season 777. */
export const isPinned = (thetaPp: number, edgePct: number, pinned: Cal): boolean =>
  Math.round(thetaPp * 10) === Math.round(pinned.theta * 1000) && Math.round(edgePct * 10) === Math.round(pinned.edgeMin * 1000);
