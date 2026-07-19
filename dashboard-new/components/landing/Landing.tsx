"use client";

/* Landing entrance (times absolute from mount):
     0ms     eyebrow fades up
     80ms    headline
     180ms   subhead
     280ms   CTAs
     360ms   tape card rises, sweep starts inside it
   Scroll sections reveal once, on view. */

import Link from "next/link";
import { ReactLenis } from "lenis/react";
import "lenis/dist/lenis.css";
import { motion, useReducedMotion } from "motion/react";
import type { Game } from "../../lib/fixtures";
import SteamTape, { type HeroTape } from "./SteamTape";
import { ArenaSection, FixturesGrid, Footer, HowItWorks, Provenance, StatsStrip } from "./sections";

const TIMING = { eyebrow: 0, headline: 0.08, sub: 0.18, ctas: 0.28, tape: 0.36 };

export default function Landing({ games, tape }: { games: Game[]; tape: HeroTape }) {
  const still = useReducedMotion() ?? false;
  const live = games.find((g) => g.live);

  const rise = (delay: number) => ({
    initial: still ? false : ({ opacity: 0, y: 20 } as const),
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.55, ease: [0.21, 0.6, 0.35, 1] as const, delay },
  });

  const page = (
    <div className="overflow-x-clip">
      {/* Hero */}
      <section className="relative">
        <div aria-hidden className="dotgrid pointer-events-none absolute inset-0" />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 pb-16 pt-14 sm:pt-20 lg:grid-cols-12 lg:items-center lg:gap-8 lg:px-6 lg:pb-24">
          <div className="lg:col-span-5">
            <motion.p {...rise(TIMING.eyebrow)} className="num text-[11px] uppercase tracking-[0.18em] text-mute">
              TxLINE World Cup · autonomous agent · Solana devnet
            </motion.p>
            <motion.h1
              {...rise(TIMING.headline)}
              className="mt-4 font-display text-4xl font-bold leading-[1.05] tracking-tight text-fg sm:text-5xl xl:text-[3.4rem]"
            >
              Catch the steam.
              <br />
              Trade both sides.
              <br />
              <span className="text-accent">Prove the settlement.</span>
            </motion.h1>
            <motion.p {...rise(TIMING.sub)} className="mt-5 max-w-md text-[15px] leading-relaxed text-mute">
              Steamline watches TxLINE consensus odds for steam moves, the sharp sustained shifts that mean smart money
              has spoken. Two rival agents trade every signal on a devnet arena, and settlement is provenance-verified
              against TxLINE&apos;s published Merkle roots.
            </motion.p>
            <motion.div {...rise(TIMING.ctas)} className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/arena"
                className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-2 dark:text-[#1a1005]"
              >
                Open the arena
              </Link>
              {live ? (
                <Link
                  href={`/f/${live.id}`}
                  className="flex items-center gap-2 rounded-lg border border-line px-5 py-2.5 text-sm font-medium text-fg transition-colors hover:border-line-2"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-won opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-won" />
                  </span>
                  {live.home} vs {live.away}, live
                </Link>
              ) : (
                <a
                  href="https://steamline-docs.vercel.app"
                  target="_blank"
                  rel="noopener"
                  className="rounded-lg border border-line px-5 py-2.5 text-sm font-medium text-fg transition-colors hover:border-line-2"
                >
                  Read the docs
                </a>
              )}
            </motion.div>
          </div>
          <motion.div {...rise(TIMING.tape)} className="lg:col-span-7">
            <SteamTape tape={tape} />
          </motion.div>
        </div>
      </section>

      <StatsStrip games={games} />
      <HowItWorks />
      <Provenance />
      <ArenaSection />
      <FixturesGrid games={games} />
      <Footer />
    </div>
  );

  // Smooth scroll on the landing page only; reduced motion opts out entirely.
  return still ? page : <ReactLenis root options={{ lerp: 0.12 }}>{page}</ReactLenis>;
}
