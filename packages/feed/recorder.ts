import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type TxlineClient } from "./txlineClient.ts";
import { type FeedSource } from "./source.ts";
import { appendJsonl } from "./replaySource.ts";

export interface RecorderDeps {
  client: TxlineClient;
  source: FeedSource;
  outDir: string;
  proofs?: boolean;
  fetchRoots?: (epochDay: number) => Promise<Record<string, string>>;
}

export interface RecorderStats {
  odds: number;
  scores: number;
  proofErrors: number;
}

export function epochDayOf(ts: number): number {
  const seconds = ts > 1e12 ? ts / 1000 : ts;
  return Math.floor(seconds / 86400);
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

export async function record(deps: RecorderDeps, signal?: AbortSignal): Promise<RecorderStats> {
  const stats: RecorderStats = { odds: 0, scores: 0, proofErrors: 0 };
  const rootDays = new Set<number>();
  for await (const e of deps.source.events(signal)) {
    const fixtureDir = join(deps.outDir, String(e.payload.FixtureId));
    if (e.kind === "odds") {
      appendJsonl(join(fixtureDir, "odds.jsonl"), e.payload);
      stats.odds++;
      if (deps.proofs) {
        try {
          const proof = await deps.client.oddsValidation(e.payload.MessageId, e.payload.Ts);
          writeJson(join(fixtureDir, "proofs", `odds-${e.payload.MessageId}.json`), proof);
        } catch {
          stats.proofErrors++;
        }
      }
    } else {
      appendJsonl(join(fixtureDir, "scores.jsonl"), e.payload);
      stats.scores++;
      if (deps.proofs && e.payload.Seq !== undefined && e.payload.StatKey !== undefined) {
        try {
          const proof = await deps.client.scoreStatValidation(e.payload.FixtureId, e.payload.Seq, e.payload.StatKey);
          writeJson(join(fixtureDir, "proofs", `score-${e.payload.Seq}.json`), proof);
        } catch {
          stats.proofErrors++;
        }
      }
    }
    if (deps.fetchRoots) {
      const day = epochDayOf(e.ts);
      if (!rootDays.has(day)) {
        rootDays.add(day);
        try {
          writeJson(join(deps.outDir, "roots", `${day}.json`), await deps.fetchRoots(day));
        } catch {
          stats.proofErrors++;
        }
      }
    }
  }
  return stats;
}

// CLI: node --experimental-strip-types packages/feed/recorder.ts --fixtures 123,456 [--network devnet] [--mode poll|sse] [--out fixtures] [--proofs]
import { parseArgs } from "node:util";
import { Connection, PublicKey as Pk } from "@solana/web3.js";
import { loadEnv, type Network } from "./env.ts";
import { loadCreds } from "./creds.ts";
import { makeClient } from "./txlineClient.ts";
import { liveSource } from "./liveSource.ts";
import { deriveRootsPda } from "./roots.ts";

const ROOT_NAMES = ["daily_batch_roots", "daily_scores_roots", "ten_daily_fixtures_roots"];

async function mainRecorder(): Promise<void> {
  const { values } = parseArgs({
    options: {
      fixtures: { type: "string" },
      network: { type: "string", default: process.env.TXLINE_NETWORK ?? "devnet" },
      mode: { type: "string", default: "poll" },
      out: { type: "string", default: "fixtures" },
      proofs: { type: "boolean", default: true },
    },
  });
  if (!values.fixtures) {
    console.log("usage: recorder.ts --fixtures 123,456 [--network devnet|mainnet] [--mode poll|sse] [--out dir] [--proofs]");
    process.exitCode = 2;
    return;
  }
  const env = loadEnv(process.env, values.network as Network);
  const creds = loadCreds(`keypairs/creds.${env.network}.json`);
  const client = makeClient({ apiBase: env.apiBase, jwt: env.jwt ?? creds.jwt, apiToken: env.apiToken ?? creds.apiToken });
  const connection = new Connection(env.rpcUrl, "confirmed");
  const programId = new Pk(env.txoracleProgramId);
  const fetchRoots = async (epochDay: number): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    for (const name of ROOT_NAMES) {
      for (const width of [8, 4, 2] as const) {
        const pda = deriveRootsPda(name, epochDay, programId, width);
        const info = await connection.getAccountInfo(pda);
        if (info) {
          out[`${name}:${width}`] = info.data.toString("base64");
          break;
        }
      }
    }
    return out;
  };
  if (values.mode !== "poll" && values.mode !== "sse") {
    console.log("usage: recorder.ts --fixtures 123,456 [--network devnet|mainnet] [--mode poll|sse] [--out dir] [--proofs]");
    process.exitCode = 2;
    return;
  }
  const fixtureIds = values.fixtures.split(",").map(Number);
  const source =
    values.mode === "sse"
      ? liveSource({
          client,
          fixtureIds,
          mode: "sse",
          apiBase: env.apiBase,
          headers: {
            ...(env.jwt ?? creds.jwt ? { Authorization: `Bearer ${env.jwt ?? creds.jwt}` } : {}),
            ...(env.apiToken ?? creds.apiToken ? { "X-Api-Token": (env.apiToken ?? creds.apiToken) as string } : {}),
          },
        })
      : liveSource({ client, fixtureIds, mode: "poll" });
  console.log(`recording fixtures ${fixtureIds.join(", ")} on ${env.network} (${values.mode}) to ${values.out}`);
  const stats = await record({ client, source, outDir: values.out as string, proofs: values.proofs, fetchRoots });
  console.log(`done: ${JSON.stringify(stats)}`);
}

if (process.argv[1]?.endsWith("recorder.ts")) {
  mainRecorder().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}
