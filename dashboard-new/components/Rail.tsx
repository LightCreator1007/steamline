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
      {/* Desktop: vertical rail, grouped by stage, pinned below the site nav. */}
      <nav className="hidden w-60 shrink-0 lg:sticky lg:top-[72px] lg:block lg:max-h-[calc(100dvh-5.5rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
        {stages.map((s) => (
          <section key={s.stage} className="mb-5">
            <h2 className="mb-2 text-[11px] uppercase tracking-wider text-mute">{s.stage}</h2>
            <ul className="space-y-1">
              {s.games.map((g) => (
                <li key={g.id}>
                  <Link
                    href={`/f/${g.id}`}
                    aria-current={g.id === activeId ? "page" : undefined}
                    className={`block rounded-md border px-2.5 py-1.5 text-sm transition-colors ${
                      g.id === activeId
                        ? "border-accent/50 bg-raised text-fg"
                        : "border-line bg-surface text-mute hover:border-line-2 hover:text-fg"
                    }`}
                  >
                    <span className="block truncate font-medium">
                      {g.home} vs {g.away}
                    </span>
                    <span className="num block text-[11px] text-mute">
                      {g.date}
                      {g.final ? ` · FT ${g.final}` : ""}
                      {g.live ? " · " : ""}
                      {g.live ? <span className="font-semibold text-won">LIVE</span> : null}
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
            <h2 className="sticky top-14 z-10 bg-bg px-4 py-1.5 text-[11px] uppercase tracking-wider text-mute">
              {s.stage}
            </h2>
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3">
              {s.games.map((g) => (
                <Link
                  key={g.id}
                  href={`/f/${g.id}`}
                  aria-current={g.id === activeId ? "page" : undefined}
                  className={`block w-[85vw] max-w-sm shrink-0 snap-center rounded-md border px-3 py-2 text-sm transition-colors ${
                    g.id === activeId
                      ? "border-accent/50 bg-raised text-fg"
                      : "border-line bg-surface text-mute"
                  }`}
                >
                  <span className="block truncate">
                    {g.home} vs {g.away}
                  </span>
                  <span className="num block text-[11px] text-mute">
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
