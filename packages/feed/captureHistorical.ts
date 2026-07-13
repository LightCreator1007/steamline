// Capture a fixture's pre-match odds and regulation final from TxLINE's
// historical interval API into fixtures/wc-<id>/{odds,scores}.jsonl.
// Usage: node --experimental-strip-types packages/feed/captureHistorical.ts <fixtureId> <kickoffIso> [hoursBefore]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const creds = JSON.parse(readFileSync(new URL("../../keypairs/creds.devnet.json", import.meta.url), "utf8"));
const BASE = "https://txline-dev.txodds.com";
const HEADERS = { Authorization: `Bearer ${creds.jwt}`, "X-Api-Token": creds.apiToken };
const ALIAS: Record<string, string> = { part1: "1", draw: "X", part2: "2" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function* slots(fromMs: number, toMs: number): Generator<{ day: number; hour: number; interval: number }> {
  for (let t = Math.floor(fromMs / 300000) * 300000; t < toMs; t += 300000) {
    const day = Math.floor(t / 86400000);
    const rem = t - day * 86400000;
    yield { day, hour: Math.floor(rem / 3600000), interval: Math.floor((rem % 3600000) / 300000) };
  }
}

async function getSlot(kind: "odds" | "scores", s: { day: number; hour: number; interval: number }, fid: number): Promise<any[]> {
  const res = await fetch(`${BASE}/api/${kind}/updates/${s.day}/${s.hour}/${s.interval}?fixtureId=${fid}`, { headers: HEADERS });
  if (!res.ok) return [];
  const arr = await res.json().catch(() => []);
  return Array.isArray(arr) ? arr : [];
}

export async function captureFixture(fid: number, kickoffMs: number, hoursBefore = 6): Promise<{ ticks: number; final: string | null }> {
  const all: any[] = [];
  for (const s of slots(kickoffMs - hoursBefore * 3600000, kickoffMs)) {
    all.push(...(await getSlot("odds", s, fid)));
    await sleep(160);
  }
  const ft = all.filter(
    (p) =>
      p.SuperOddsType === "1X2_PARTICIPANT_RESULT" &&
      p.MarketPeriod == null &&
      !p.InRunning &&
      Array.isArray(p.PriceNames) &&
      Array.isArray(p.Prices) &&
      p.PriceNames.length === p.Prices.length &&
      p.PriceNames.length > 0 &&
      p.Prices.every((x: number) => x > 1000),
  );
  ft.sort((a, b) => a.Ts - b.Ts);
  const thin: any[] = [];
  let last = 0;
  for (const p of ft) {
    if (p.Ts - last >= 60_000) {
      thin.push({ ...p, PriceNames: p.PriceNames.map((n: string) => ALIAS[n] ?? n) });
      last = p.Ts;
    }
  }
  const dir = new URL(`../../fixtures/wc-${fid}/`, import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL("odds.jsonl", dir), thin.map((p) => JSON.stringify(p)).join("\n") + "\n");

  let final: string | null = null;
  for (const s of slots(kickoffMs + 80 * 60000, kickoffMs + 4.5 * 3600000)) {
    for (const ev of await getSlot("scores", s, fid)) {
      if (ev.Action === "game_finalised") {
        const p1 = ev.Score?.Participant1?.Total?.Goals ?? 0;
        const p2 = ev.Score?.Participant2?.Total?.Goals ?? 0;
        final = `${p1}-${p2}`;
        writeFileSync(
          new URL("scores.jsonl", dir),
          JSON.stringify({ FixtureId: fid, Seq: ev.Seq, Ts: ev.Ts, StatKey: "regulation_final", HomeScore: p1, AwayScore: p2 }) + "\n",
        );
      }
    }
    if (final) break;
    await sleep(160);
  }
  return { ticks: thin.length, final };
}

if (process.argv[1]?.endsWith("captureHistorical.ts")) {
  const fid = Number(process.argv[2]);
  const kickoff = Date.parse(process.argv[3]);
  if (!fid || !Number.isFinite(kickoff)) {
    console.log("usage: captureHistorical.ts <fixtureId> <kickoffIso> [hoursBefore]");
    process.exit(1);
  }
  captureFixture(fid, kickoff, Number(process.argv[4] ?? 6)).then((r) => console.log(fid, "ticks:", r.ticks, "final:", r.final));
}
