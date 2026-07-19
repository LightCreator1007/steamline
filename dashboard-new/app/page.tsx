import { analyzeFixture } from "../../packages/agent/analyze.ts";
import { finalScore, loadGames, loadPayloads } from "../lib/fixtures";
import Landing from "../components/landing/Landing";
import type { HeroTape } from "../components/landing/SteamTape";

// The hero replays a real capture: France vs Spain, semi-final, one steam
// signal at the pinned calibration. Nothing on the landing page is mocked.
const HERO_FIXTURE = 18237038;

export default async function Home() {
  const games = await loadGames();
  const hero = games.find((g) => g.id === HERO_FIXTURE) ?? games[0];
  const analysis = analyzeFixture(hero.id, await loadPayloads(hero.id), finalScore(hero), hero.cal);

  // Downsample the tape for the wire; ~160 points carry the shape.
  const trace = analysis.trace;
  const step = Math.max(1, Math.floor(trace.length / 160));
  const points = trace
    .filter((_, i) => i % step === 0 || i === trace.length - 1)
    .map((t) => ({ t: t.tick.ts, probs: t.tick.outcomes.map((o) => o.fairProb) }));

  const tape: HeroTape = {
    fixtureId: hero.id,
    home: hero.home,
    away: hero.away,
    stage: hero.stage,
    final: hero.final ?? "",
    ticks: trace.length,
    thetaPp: (hero.cal?.theta ?? 0.005) * 100,
    points,
    signals: analysis.signals.map((s) => ({
      t: s.ts,
      outcome: s.outcome,
      prePct: s.preProb * 100,
      postPct: s.postProb * 100,
      magPp: s.magnitude * 100,
    })),
    decisions: analysis.decisions.map((d) => ({
      agent: d.agent,
      outcome: d.outcome,
      entryOdds: d.entryOdds,
      stake: d.stake,
      status: d.status,
      payout: d.payout,
    })),
  };

  return <Landing games={games} tape={tape} />;
}
