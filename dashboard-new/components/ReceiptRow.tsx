"use client";

// A position row plus its receipt: what the agent saw (odds ref, signal seq,
// tick timestamp) and where it landed (open/settle transactions). Links are
// receipts, not the main display, so they live inside the expansion.
import { useState } from "react";
import type { Position } from "../lib/api";

const pts = (n: number) => n.toLocaleString("en-US");
const TX = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const ADDR = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;

export default function ReceiptRow({ p, outcomeName }: { p: Position; outcomeName: (o: string) => string }) {
  const [open, setOpen] = useState(false);
  const tone = p.status === "won" ? "text-won" : p.status === "lost" ? "text-lost" : "";
  return (
    <>
      <tr className="border-t border-navy-800">
        <td className="py-1">{p.agent}</td>
        <td>{outcomeName(p.outcome)}</td>
        <td className="text-right">{p.entryOdds.toFixed(2)}</td>
        <td className="text-right">{pts(p.stake)}</td>
        <td className={`text-right ${tone}`}>{p.status.toUpperCase()}</td>
        <td className="text-right">{pts(p.payout)}</td>
        <td className="text-right">
          <button
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="rounded border border-navy-700 px-2 py-0.5 text-[11px] hover:border-gold-400/60"
          >
            receipt
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-navy-800/60 bg-navy-900/60">
          <td colSpan={7} className="px-2 py-2 text-[11px] text-ink-500">
            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              <Field label="signal seq" value={String(p.signalSeq)} />
              <Field label="odds ref" value={p.oddsRef} />
              <Field label="odds tick" value={new Date(p.oddsTs).toISOString().replace("T", " ").slice(0, 19) + " UTC"} />
              <Field
                label="position"
                value={
                  <a className="text-gold-400 hover:underline" href={ADDR(p.address)} target="_blank" rel="noopener">
                    {p.address.slice(0, 12)}
                  </a>
                }
              />
              <Field
                label="open tx"
                value={
                  p.openTx ? (
                    <a className="text-gold-400 hover:underline" href={TX(p.openTx)} target="_blank" rel="noopener">
                      {p.openTx.slice(0, 12)}
                    </a>
                  ) : p.onChain ? (
                    "signature lookup unavailable"
                  ) : (
                    "not on chain yet"
                  )
                }
              />
              <Field
                label="settle tx"
                value={
                  p.settleTx ? (
                    <a className="text-gold-400 hover:underline" href={TX(p.settleTx)} target="_blank" rel="noopener">
                      {p.settleTx.slice(0, 12)}
                    </a>
                  ) : (
                    "not settled yet"
                  )
                }
              />
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="num truncate">{value}</dd>
    </div>
  );
}

/** Narrow-screen twin of the row above: two-line card, receipt expands inline below it. */
export function PositionCard({ p, outcomeName }: { p: Position; outcomeName: (o: string) => string }) {
  const [open, setOpen] = useState(false);
  const tone = p.status === "won" ? "text-won" : p.status === "lost" ? "text-lost" : "";
  return (
    <div className="rounded border border-navy-800 bg-navy-900 p-2 text-xs">
      <div className="num flex items-center justify-between text-ink-300">
        <span className="truncate">
          {p.agent} · {outcomeName(p.outcome)}
        </span>
        <span>{p.entryOdds.toFixed(2)}</span>
      </div>
      <div className="num mt-1 flex items-center justify-between text-ink-500">
        <span>stake {pts(p.stake)}</span>
        <span className={tone}>{p.status.toUpperCase()}</span>
        <span>payout {pts(p.payout)}</span>
      </div>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="mt-2 rounded border border-navy-700 px-2 py-0.5 text-[11px] hover:border-gold-400/60"
      >
        {open ? "hide receipt" : "receipt"}
      </button>
      {open && (
        <dl className="num mt-2 grid gap-x-4 gap-y-1 border-t border-navy-800 pt-2 text-[11px] text-ink-500">
          <Field label="signal seq" value={String(p.signalSeq)} />
          <Field label="odds ref" value={p.oddsRef} />
          <Field label="odds tick" value={new Date(p.oddsTs).toISOString().replace("T", " ").slice(0, 19) + " UTC"} />
          <Field
            label="position"
            value={
              <a className="text-gold-400 hover:underline" href={ADDR(p.address)} target="_blank" rel="noopener">
                {p.address.slice(0, 12)}
              </a>
            }
          />
          <Field
            label="open tx"
            value={
              p.openTx ? (
                <a className="text-gold-400 hover:underline" href={TX(p.openTx)} target="_blank" rel="noopener">
                  {p.openTx.slice(0, 12)}
                </a>
              ) : p.onChain ? (
                "signature lookup unavailable"
              ) : (
                "not on chain yet"
              )
            }
          />
          <Field
            label="settle tx"
            value={
              p.settleTx ? (
                <a className="text-gold-400 hover:underline" href={TX(p.settleTx)} target="_blank" rel="noopener">
                  {p.settleTx.slice(0, 12)}
                </a>
              ) : (
                "not settled yet"
              )
            }
          />
        </dl>
      )}
    </div>
  );
}
