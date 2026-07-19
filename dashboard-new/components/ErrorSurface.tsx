"use client";

// The three tiers of spec section 4, each driven by a typed code and never by
// the message text. Tier assignment lives in lib/errors.ts so there is one
// place to look when a new code appears.
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { tierOf, type ApiError } from "../lib/errors";

const EXPLORER_TX = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

/** Toast tier: transient, auto-dismissing, never blocking. */
export function useTransientErrorToast(error: ApiError | null, isRetrying: boolean): void {
  useEffect(() => {
    if (!error || tierOf(error.code) !== "toast") return;
    toast.error(error.message, {
      description: isRetrying ? "Retrying automatically." : undefined,
      id: error.code,
    });
  }, [error, isRetrying]);
}

/** Inline tier: expected conditions rendered as content, not as failure. */
export function InlineNotice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-line bg-surface p-3 text-xs text-mute">{children}</p>;
}

function Shell({
  open,
  onOpenChange,
  title,
  children,
  actions,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  children: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line-2 bg-surface p-5 shadow-2xl">
          <AlertDialog.Title className="font-display text-base font-semibold text-fg">{title}</AlertDialog.Title>
          <div className="mt-2 space-y-2 text-xs text-mute">{children}</div>
          <div className="mt-4 flex justify-end gap-2 text-xs">{actions}</div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

const btn = "rounded-md border border-line-2 px-3 py-1.5 text-mute transition-colors hover:border-accent/60 hover:text-fg";
const btnPrimary = "rounded-md bg-accent px-3 py-1.5 font-semibold text-white transition-colors hover:bg-accent-2 dark:text-[#1a1005]";

/** Dialog tier (a): the run is irreversible and shared, so it is confirmed. */
export function ConfirmRunDialog({
  open,
  onOpenChange,
  season,
  txCount,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  season: string;
  txCount: number;
  onConfirm: () => void;
}) {
  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      title={`Run this calibration on arena ${season}`}
      actions={
        <>
          <AlertDialog.Cancel className={btn}>Cancel</AlertDialog.Cancel>
          <AlertDialog.Action className={btnPrimary} onClick={onConfirm}>
            Run it
          </AlertDialog.Action>
        </>
      }
    >
      <p>
        This creates arena <span className="num">{season}</span> if it does not exist and submits roughly{" "}
        <span className="num">{txCount}</span> devnet transactions signed by the arena&apos;s server-held keys.
      </p>
      <p>It runs once per calibration, for everyone, forever. Anyone choosing these settings later sees this same run.</p>
    </Shell>
  );
}

/** Dialog tier (b): the limit has to be explained, and the wait made concrete. */
export function RateLimitDialog({ error, onOpenChange }: { error: ApiError | null; onOpenChange: (v: boolean) => void }) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!error) return;
    setLeft(error.retryAfterSec ?? 60);
    const t = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(t);
  }, [error]);
  return (
    <Shell
      open={error !== null}
      onOpenChange={onOpenChange}
      title="Rate limited"
      actions={
        <AlertDialog.Action className={btnPrimary} disabled={left > 0} onClick={() => onOpenChange(false)}>
          {left > 0 ? <span className="num">Retry in {left}s</span> : "Try again"}
        </AlertDialog.Action>
      }
    >
      <p>{error?.message}</p>
    </Shell>
  );
}

/** Dialog tier (c): a half-finished run must not be missed, and it is resumable. */
export function PartialRunDialog({ error, onOpenChange }: { error: ApiError | null; onOpenChange: (v: boolean) => void }) {
  return (
    <Shell
      open={error !== null}
      onOpenChange={onOpenChange}
      title="Run stopped part-way"
      actions={
        <AlertDialog.Action className={btnPrimary} onClick={() => onOpenChange(false)}>
          Close
        </AlertDialog.Action>
      }
    >
      <p>{error?.message}</p>
      <p>These transactions landed. Every step is idempotent, so running again resumes from here rather than repeating.</p>
      <ul className="space-y-1">
        {(error?.landed ?? []).map((t) => (
          <li key={t.signature} className="flex justify-between gap-3">
            <span>{t.label}</span>
            <a className="num text-accent hover:underline" href={EXPLORER_TX(t.signature)} target="_blank" rel="noopener">
              {t.signature.slice(0, 8)}
            </a>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
