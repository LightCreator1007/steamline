"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import type { Game } from "../../lib/fixtures";

const PROGRAM = "E9jfScHBJRB2NyB2NFmE4Kec9D8hJ1X7k24AXufRbX5n";
const EXPLORER = `https://explorer.solana.com/address/${PROGRAM}?cluster=devnet`;
const DOCS = "https://steamline-docs.vercel.app";
const REPO = "https://github.com/LightCreator1007/steamline";

function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  const still = useReducedMotion() ?? false;
  return (
    <motion.div
      className={className}
      initial={still ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, ease: [0.21, 0.6, 0.35, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="num text-[11px] uppercase tracking-[0.18em] text-accent">{children}</p>;
}

/* ---------------------------------------------------------------- stats */

export function StatsStrip({ games }: { games: Game[] }) {
  const replayable = games.filter((g) => !g.live).length;
  const items = [
    { label: "fixtures replayable", value: String(replayable) },
    { label: "agents per arena", value: "follow + fade" },
    { label: "devnet program", value: `${PROGRAM.slice(0, 4)}..${PROGRAM.slice(-4)}`, href: EXPLORER },
    { label: "stakes", value: "play-money points" },
  ];
  return (
    <section className="border-y border-line bg-surface">
      <div className="mx-auto grid max-w-7xl grid-cols-2 divide-line lg:grid-cols-4 lg:divide-x">
        {items.map((it) => (
          <div key={it.label} className="px-4 py-5 lg:px-6">
            <div className="num text-lg font-medium text-fg">
              {it.href ? (
                <a href={it.href} target="_blank" rel="noopener" className="hover:text-accent">
                  {it.value}
                </a>
              ) : (
                it.value
              )}
            </div>
            <div className="mt-0.5 text-[11px] uppercase tracking-wider text-mute">{it.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* --------------------------------------------------------- how it works */

const STEPS = [
  {
    n: "01",
    verb: "Detect",
    copy: "The engine normalizes TxLINE's demargined consensus prices into fair probabilities and watches for a sustained shove of theta percentage points on one outcome. A goal jump is news, not steam, so detection runs pre-match only.",
    art: <DetectArt />,
  },
  {
    n: "02",
    verb: "Trade",
    copy: "Every signal is traded twice. Follow rides the move, fade bets against it. Stakes are sized from the edge left at the post-move price, and each position lands on the devnet program as a real transaction.",
    art: <TradeArt />,
  },
  {
    n: "03",
    verb: "Settle",
    copy: "At full time the regulation score settles every position. The program can re-fold TxLINE's score Merkle proof against the oracle's on-chain roots account, in-program, with no CPI. Provenance-verified, on purpose.",
    art: <SettleArt />,
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-20 lg:px-6 lg:py-28">
      <Reveal>
        <Eyebrow>The pipeline</Eyebrow>
        <h2 className="mt-3 max-w-xl font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
          One signal, two convictions, one verdict.
        </h2>
      </Reveal>
      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        {STEPS.map((s, i) => (
          <Reveal key={s.n} delay={i * 0.12}>
            <article className="flex h-full flex-col rounded-xl border border-line bg-surface p-6">
              <div className="flex items-baseline justify-between">
                <h3 className="font-display text-xl font-semibold text-fg">{s.verb}</h3>
                <span className="num text-[11px] text-faint">{s.n}</span>
              </div>
              <div className="my-5 text-mute">{s.art}</div>
              <p className="mt-auto text-sm leading-relaxed text-mute">{s.copy}</p>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function DetectArt() {
  return (
    <svg viewBox="0 0 220 72" className="h-[72px] w-full" aria-hidden>
      <path d="M6 46 C 40 44, 66 48, 92 45 L 116 24 C 150 20, 186 23, 214 21" fill="none" stroke="var(--chart-draw)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="116" cy="24" r="4" fill="var(--accent)" />
      <path d="M126 45 L 126 24" stroke="var(--accent)" strokeWidth="1.4" strokeDasharray="3 3" />
      <text x="132" y="38" fontSize="10" fill="var(--accent)" className="num">
        theta pp
      </text>
    </svg>
  );
}

function TradeArt() {
  return (
    <svg viewBox="0 0 220 72" className="h-[72px] w-full" aria-hidden>
      <line x1="110" y1="8" x2="110" y2="64" stroke="var(--accent)" strokeWidth="1.4" strokeDasharray="3 3" />
      <circle cx="110" cy="36" r="3.5" fill="var(--accent)" />
      <rect x="24" y="14" width="62" height="20" rx="4" fill="none" stroke="var(--chart-away)" strokeWidth="1.5" />
      <text x="55" y="27.5" fontSize="10.5" textAnchor="middle" fill="var(--chart-away)" className="num">
        follow
      </text>
      <path d="M86 24 L 104 24" stroke="var(--chart-away)" strokeWidth="1.2" strokeDasharray="2 3" />
      <rect x="134" y="38" width="62" height="20" rx="4" fill="none" stroke="var(--chart-draw)" strokeWidth="1.5" />
      <text x="165" y="51.5" fontSize="10.5" textAnchor="middle" fill="var(--chart-draw)" className="num">
        fade
      </text>
      <path d="M134 48 L 116 48" stroke="var(--chart-draw)" strokeWidth="1.2" strokeDasharray="2 3" />
    </svg>
  );
}

function SettleArt() {
  return (
    <svg viewBox="0 0 220 72" className="h-[72px] w-full" aria-hidden>
      {[10, 66, 122, 178].map((x) => (
        <rect key={x} x={x} y="50" width="32" height="12" rx="2" fill="none" stroke="var(--chart-draw)" strokeWidth="1.4" />
      ))}
      <path d="M26 50 L 61 36 M82 50 L 61 36 M138 50 L 173 36 M194 50 L 173 36 M61 36 L 61 30 L 114 18 M173 36 L 173 30 L 120 18" fill="none" stroke="var(--chart-draw)" strokeWidth="1.2" />
      <rect x="92" y="4" width="52" height="16" rx="3" fill="none" stroke="var(--won)" strokeWidth="1.6" />
      <text x="118" y="15.5" fontSize="9.5" textAnchor="middle" fill="var(--won)" className="num">
        root ok
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------ provenance */

const PROOF_LINES = [
  ["score leaf", "sha256(final score payload)"],
  ["fold left", "sha256(sibling || acc)"],
  ["fold right", "sha256(acc || sibling)"],
  ["root", "== Txoracle roots account, on chain"],
  ["settle_match_verified", "OK"],
] as const;

export function Provenance() {
  const still = useReducedMotion() ?? false;
  return (
    <section className="border-y border-line bg-surface">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-20 lg:grid-cols-2 lg:px-6 lg:py-28">
        <Reveal>
          <Eyebrow>Provenance</Eyebrow>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
            Don&apos;t take the agent&apos;s word for the score.
          </h2>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-mute">
            <span className="num">settle_match_verified</span>{" "}re-folds TxLINE&apos;s score Merkle proof inside the
            program, against the oracle&apos;s published roots account. No CPI, no off-chain referee. It is
            provenance-verified, not trustless: binding the leaf preimage is the next step on the roadmap, and the docs
            say exactly what is and is not proven.
          </p>
          <div className="mt-6 flex flex-wrap gap-4 text-sm">
            <a href={EXPLORER} target="_blank" rel="noopener" className="text-accent hover:underline">
              Program on Explorer
            </a>
            <a href={DOCS} target="_blank" rel="noopener" className="text-accent hover:underline">
              What is proven, exactly
            </a>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="num rounded-xl border border-line bg-bg p-5 text-[12.5px] leading-7">
            {PROOF_LINES.map(([k, v], i) => (
              <motion.div
                key={k}
                className="flex justify-between gap-4 border-b border-line/60 py-1 last:border-0"
                initial={still ? false : { opacity: 0, x: -8 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: 0.15 + i * 0.14 }}
              >
                <span className="text-mute">{k}</span>
                <span className={i === PROOF_LINES.length - 1 ? "font-semibold text-won" : "text-fg"}>{v}</span>
              </motion.div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- arena */

export function ArenaSection() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-20 lg:px-6 lg:py-28">
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <Reveal className="order-2 lg:order-1">
          <div className="rounded-xl border border-line bg-surface p-6">
            <FakeSlider label="steam threshold" value="0.5pp" pct={14} />
            <FakeSlider label="edge floor" value="0.5%" pct={22} />
            <div className="num mt-5 flex flex-wrap items-center gap-2 text-xs text-mute">
              <span className="rounded border border-line px-2 py-1">0.5pp / 0.5%</span>
              <span aria-hidden>{"->"}</span>
              <span className="rounded border border-accent/50 px-2 py-1 text-accent">arena 777, pinned</span>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-mute">
              Different numbers hash to a different season, and a different arena account on devnet. Identical numbers
              land every visitor in the same one.
            </p>
          </div>
        </Reveal>
        <Reveal className="order-1 lg:order-2">
          <Eyebrow>The arena</Eyebrow>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
            Your sliders are an address, not a preview.
          </h2>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-mute">
            Every calibration keys its own on-chain arena. The first visitor to run one creates it and both agents trade
            it for real; everyone who picks the same settings afterwards inherits that shared record. The arena is
            permissionless by design: any strategy can register a book and compete.
          </p>
          <Link
            href="/arena"
            className="mt-6 inline-block rounded-lg border border-line px-5 py-2.5 text-sm font-medium text-fg transition-colors hover:border-line-2"
          >
            Pick a fixture and turn the knobs
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

function FakeSlider({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div className="mb-4 flex items-center gap-3 text-xs text-mute">
      <span className="w-28 shrink-0">{label}</span>
      <span className="relative h-1 flex-1 rounded-full bg-raised">
        <span className="absolute inset-y-0 left-0 rounded-full bg-accent/60" style={{ width: `${pct}%` }} />
        <span className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-accent bg-surface" style={{ left: `calc(${pct}% - 6px)` }} />
      </span>
      <span className="num w-12 shrink-0 text-right text-fg">{value}</span>
    </div>
  );
}

/* -------------------------------------------------------------- fixtures */

export function FixturesGrid({ games }: { games: Game[] }) {
  // Latest knockout rounds first; the live final leads if there is one.
  const featured = [...games].reverse().slice(0, 6);
  return (
    <section className="border-t border-line bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-20 lg:px-6 lg:py-28">
        <Reveal className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>The record</Eyebrow>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
              Every match, replayable to the tick.
            </h2>
          </div>
          <Link href="/arena" className="text-sm text-accent hover:underline">
            All {games.length} fixtures in the arena
          </Link>
        </Reveal>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((g, i) => (
            <Reveal key={g.id} delay={i * 0.06}>
              <Link
                href={`/f/${g.id}`}
                className="group block rounded-xl border border-line bg-bg p-5 transition-colors hover:border-accent/50"
              >
                <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-mute">
                  <span>{g.stage}</span>
                  {g.live ? (
                    <span className="flex items-center gap-1.5 font-semibold text-won">
                      <span className="h-1.5 w-1.5 rounded-full bg-won" /> live
                    </span>
                  ) : (
                    <span className="num">FT {g.final}</span>
                  )}
                </div>
                <div className="mt-3 font-display text-lg font-semibold text-fg">
                  {g.home} <span className="text-faint">vs</span> {g.away}
                </div>
                <div className="num mt-1 text-xs text-mute">
                  {g.date} · fixture {g.id}
                </div>
                <div className="mt-4 text-xs text-accent opacity-0 transition-opacity group-hover:opacity-100">
                  {g.live ? "watch the chain" : "replay the tape"} {"->"}
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- footer */

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between lg:px-6">
        <div>
          <span className="font-display text-sm font-semibold text-fg">steamline</span>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-mute">
            Built for the TxLINE World Cup hackathon, track 3: autonomous agents. Play-money points on Solana devnet,
            no real stakes anywhere.
          </p>
        </div>
        <nav className="flex gap-5 text-sm text-mute">
          <a href={DOCS} target="_blank" rel="noopener" className="hover:text-fg">
            Docs
          </a>
          <a href={REPO} target="_blank" rel="noopener" className="hover:text-fg">
            GitHub
          </a>
          <a href={EXPLORER} target="_blank" rel="noopener" className="hover:text-fg">
            Program
          </a>
        </nav>
      </div>
    </footer>
  );
}
