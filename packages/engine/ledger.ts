import { type OddsTick } from "./model.ts";

export interface Ledger {
  append(t: OddsTick): void;
  window(fixtureId: number, market: string, n: number): OddsTick[];
  all(fixtureId: number, market: string): OddsTick[];
}

function key(fixtureId: number, market: string): string {
  return `${fixtureId}:${market}`;
}

export function inMemoryLedger(): Ledger {
  const store = new Map<string, OddsTick[]>();
  return {
    append(t: OddsTick): void {
      const k = key(t.fixtureId, t.market);
      const arr = store.get(k) ?? [];
      arr.push(t);
      arr.sort((a, b) => a.ts - b.ts);
      store.set(k, arr);
    },
    all(fixtureId: number, market: string): OddsTick[] {
      return (store.get(key(fixtureId, market)) ?? []).slice();
    },
    window(fixtureId: number, market: string, n: number): OddsTick[] {
      const arr = store.get(key(fixtureId, market)) ?? [];
      return arr.slice(Math.max(0, arr.length - n));
    },
  };
}
