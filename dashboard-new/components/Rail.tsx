import Link from "next/link";
import type { Game } from "../lib/fixtures";

// Fixture rail, grouped by stage in capture order. Server-rendered links: the
// calibration deliberately does not follow you across fixtures, since each one
// has its own pinned calibration.
export default function Rail({ games, activeId }: { games: Game[]; activeId: number }) {
  const stages: { stage: string; games: Game[] }[] = [];
  for (const g of games) {
    const last = stages[stages.length - 1];
    if (last?.stage === g.stage) last.games.push(g);
    else stages.push({ stage: g.stage, games: [g] });
  }

  return (
    <>
      {/* Desktop: vertical rail, grouped by stage. */}
      <nav className="hidden w-60 shrink-0 lg:block">
        {stages.map((s) => (
          <section key={s.stage} className="mb-5">
            <h2 className="mb-2 text-[11px] uppercase tracking-wider text-ink-500">{s.stage}</h2>
            <ul className="space-y-1">
              {s.games.map((g) => (
                <li key={g.id}>
                  <Link
                    href={`/f/${g.id}`}
                    className={`block rounded border px-2 py-1.5 text-sm transition-colors ${
                      g.id === activeId
                        ? "border-gold-400/60 bg-navy-800 text-gold-400"
                        : "border-navy-800 bg-navy-900 hover:border-navy-700"
                    }`}
                  >
                    <span className="block truncate">
                      {g.home} vs {g.away}
                    </span>
                    <span className="num block text-[11px] text-ink-500">
                      {g.date}
                      {g.final ? ` · FT ${g.final}` : ""}
                      {g.live ? " · LIVE" : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>

      {/* Mobile: horizontal snap-scroll cards per stage, stage header sticky to
          the top of the viewport as the page scrolls past that group. */}
      <nav className="-mx-4 lg:hidden">
        {stages.map((s) => (
          <div key={s.stage}>
            <h2 className="sticky top-0 z-10 bg-navy-950 px-4 py-1.5 text-[11px] uppercase tracking-wider text-ink-500">
              {s.stage}
            </h2>
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3">
              {s.games.map((g) => (
                <Link
                  key={g.id}
                  href={`/f/${g.id}`}
                  className={`block w-[85vw] max-w-sm shrink-0 snap-center rounded border px-3 py-2 text-sm transition-colors ${
                    g.id === activeId
                      ? "border-gold-400/60 bg-navy-800 text-gold-400"
                      : "border-navy-800 bg-navy-900"
                  }`}
                >
                  <span className="block truncate">
                    {g.home} vs {g.away}
                  </span>
                  <span className="num block text-[11px] text-ink-500">
                    {g.date}
                    {g.final ? ` · FT ${g.final}` : ""}
                    {g.live ? " · LIVE" : ""}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </>
  );
}
