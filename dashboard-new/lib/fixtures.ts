// Server-only fixture access. The captures still live in ../dashboard/data
// (the frozen build reads them over HTTP); here they are read straight off
// disk so server components can call the engine with zero round trips.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { OddsPayload } from "../../packages/engine/model.ts";

const DATA = path.join(process.cwd(), "..", "dashboard", "data");

export interface Game {
  id: number;
  home: string;
  away: string;
  stage: string;
  date: string;
  kickoff?: string;
  final?: string;
  live?: boolean;
  cal?: { theta: number; edgeMin: number };
}

export async function loadGames(): Promise<Game[]> {
  return JSON.parse(await readFile(path.join(DATA, "games.json"), "utf8"));
}

export async function loadPayloads(fixtureId: number): Promise<OddsPayload[]> {
  const raw = await readFile(path.join(DATA, String(fixtureId), "odds.jsonl"), "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

export function finalScore(game: Game): { HomeScore: number; AwayScore: number } | null {
  if (!game.final) return null;
  const [home, away] = game.final.split("-").map(Number);
  return Number.isFinite(home) && Number.isFinite(away) ? { HomeScore: home, AwayScore: away } : null;
}
