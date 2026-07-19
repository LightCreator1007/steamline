"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const DOCS = "https://steamline-docs.vercel.app";
const REPO = "https://github.com/LightCreator1007/steamline";

export default function SiteNav() {
  const pathname = usePathname();
  const inArena = pathname.startsWith("/f/") || pathname.startsWith("/arena");
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/80 backdrop-blur-md">
      <nav className="mx-auto flex h-14 max-w-7xl items-center gap-5 px-4 lg:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="Steamline home">
          <Wordmark />
        </Link>
        <div className="ml-auto flex items-center gap-1 text-sm">
          <Link
            href="/arena"
            className={`rounded-md px-3 py-1.5 transition-colors hover:text-fg ${inArena ? "text-fg" : "text-mute"}`}
          >
            Arena
          </Link>
          <a href={DOCS} target="_blank" rel="noopener" className="hidden rounded-md px-3 py-1.5 text-mute transition-colors hover:text-fg sm:block">
            Docs
          </a>
          <a href={REPO} target="_blank" rel="noopener" className="hidden rounded-md px-3 py-1.5 text-mute transition-colors hover:text-fg sm:block">
            GitHub
          </a>
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}

/* The mark is the product: a consensus line holding flat, then a steam move. */
function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden className="shrink-0">
        <path
          d="M2 16.5 H9 L12.5 6.5 H20"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="font-display text-[17px] font-semibold tracking-tight text-fg">steamline</span>
    </span>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = resolvedTheme !== "light";
  return (
    <button
      type="button"
      aria-label={mounted && dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="ml-1 grid h-8 w-8 place-items-center rounded-md border border-line text-mute transition-colors hover:border-line-2 hover:text-fg"
    >
      {!mounted ? (
        <span className="block h-4 w-4" />
      ) : dark ? (
        /* moon */
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
        </svg>
      ) : (
        /* sun */
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )}
    </button>
  );
}
