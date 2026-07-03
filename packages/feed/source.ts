import { type OddsPayload } from "../engine/model.ts";
import { type ScoreEvent } from "./txlineClient.ts";

export type FeedEvent =
  | { kind: "odds"; ts: number; payload: OddsPayload }
  | { kind: "score"; ts: number; payload: ScoreEvent };

export interface FeedSource {
  events(signal?: AbortSignal): AsyncIterable<FeedEvent>;
}
