import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type OddsPayload } from "../engine/model.ts";
import { type ScoreEvent } from "./txlineClient.ts";
import { type FeedEvent, type FeedSource } from "./source.ts";

export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);
}

export function appendJsonl(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(value) + "\n");
}

export function replaySource(dir: string): FeedSource {
  return {
    async *events(): AsyncIterable<FeedEvent> {
      const odds = readJsonl<OddsPayload>(join(dir, "odds.jsonl")).map((p) => ({
        kind: "odds" as const,
        ts: p.Ts,
        payload: p,
      }));
      const scores = readJsonl<ScoreEvent>(join(dir, "scores.jsonl")).map((p) => ({
        kind: "score" as const,
        ts: Number(p.Ts ?? 0),
        payload: p,
      }));
      const merged = [...odds, ...scores].sort((a, b) => a.ts - b.ts);
      for (const e of merged) yield e;
    },
  };
}
