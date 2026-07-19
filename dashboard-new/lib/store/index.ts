// Durable storage for the cron loop. Narrow on purpose: a list per fixture
// (ticks:<fid>) and two hashes (armed:<fid>, watch). Two implementations,
// picked by env: Upstash Redis over its REST API when the URL and token are
// present, otherwise a file-backed store so dev and tests need no service.
//
// Env contract (both required to select Upstash, exactly as the Vercel
// Marketplace integration injects them):
//   UPSTASH_REDIS_REST_URL    e.g. https://eu1-xxx.upstash.io
//   UPSTASH_REDIS_REST_TOKEN  the read/write token
// Local fallback only:
//   STEAMLINE_STORE_DIR       directory for the JSON file (default .steamline-store)
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface Store {
  /** Append raw JSON lines to the fixture's tick list. */
  appendTicks(fixtureId: number, lines: string[]): Promise<void>;
  /** Whole tick list in insertion order. */
  readTicks(fixtureId: number): Promise<string[]>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  hset(key: string, field: string, value: string): Promise<void>;
}

export const ticksKey = (fixtureId: number): string => `ticks:${fixtureId}`;
export const armedKey = (fixtureId: number): string => `armed:${fixtureId}`;
export const WATCH_KEY = "watch";

// --- Upstash Redis over REST ---------------------------------------------
// Plain fetch against the documented command endpoint; no SDK, no dependency.

interface UpstashReply {
  result?: unknown;
  error?: string;
}

function upstashStore(url: string, token: string): Store {
  const base = url.replace(/\/+$/, "");

  async function cmd(args: (string | number)[]): Promise<unknown> {
    const res = await fetch(base, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args.map(String)),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`upstash ${args[0]} failed with ${res.status}`);
    let body: UpstashReply;
    try {
      body = (await res.json()) as UpstashReply;
    } catch {
      throw new Error(`upstash ${args[0]} returned unparseable JSON`);
    }
    if (body.error) throw new Error(`upstash ${args[0]}: ${body.error}`);
    return body.result;
  }

  const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

  return {
    async appendTicks(fixtureId, lines) {
      if (lines.length === 0) return;
      await cmd(["RPUSH", ticksKey(fixtureId), ...lines]);
    },
    async readTicks(fixtureId) {
      return asStrings(await cmd(["LRANGE", ticksKey(fixtureId), 0, -1]));
    },
    async hget(key, field) {
      const v = await cmd(["HGET", key, field]);
      return typeof v === "string" ? v : null;
    },
    async hgetall(key) {
      // Upstash returns HGETALL as a flat [field, value, ...] array.
      const flat = asStrings(await cmd(["HGETALL", key]));
      const out: Record<string, string> = {};
      for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = flat[i + 1];
      return out;
    },
    async hset(key, field, value) {
      await cmd(["HSET", key, field, value]);
    },
  };
}

// --- Local file fallback --------------------------------------------------
// One JSON document, read-modify-written per mutation. Single-writer dev and
// test use only.
// ponytail: no locking, last write wins. Upstash is the real store; if this
// ever needs concurrent writers it should just be Upstash.

interface Doc {
  lists: Record<string, string[]>;
  hashes: Record<string, Record<string, string>>;
}

export function localStore(dir: string): Store {
  const file = path.join(dir, "store.json");

  async function load(): Promise<Doc> {
    try {
      const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
      if (parsed && typeof parsed === "object") {
        const d = parsed as Partial<Doc>;
        return { lists: d.lists ?? {}, hashes: d.hashes ?? {} };
      }
    } catch {
      // Missing or corrupt file starts empty; the store is a cache of the
      // feed, never the only copy of anything that cannot be refetched.
    }
    return { lists: {}, hashes: {} };
  }

  async function save(doc: Doc): Promise<void> {
    await mkdir(dir, { recursive: true });
    await writeFile(file, JSON.stringify(doc), "utf8");
  }

  return {
    async appendTicks(fixtureId, lines) {
      if (lines.length === 0) return;
      const doc = await load();
      const key = ticksKey(fixtureId);
      doc.lists[key] = [...(doc.lists[key] ?? []), ...lines];
      await save(doc);
    },
    async readTicks(fixtureId) {
      return (await load()).lists[ticksKey(fixtureId)] ?? [];
    },
    async hget(key, field) {
      return (await load()).hashes[key]?.[field] ?? null;
    },
    async hgetall(key) {
      return { ...((await load()).hashes[key] ?? {}) };
    },
    async hset(key, field, value) {
      const doc = await load();
      doc.hashes[key] = { ...(doc.hashes[key] ?? {}), [field]: value };
      await save(doc);
    },
  };
}

/** Upstash when its two env vars are set, the file store otherwise. */
export function getStore(env: Record<string, string | undefined> = process.env): Store {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return upstashStore(url, token);
  return localStore(env.STEAMLINE_STORE_DIR ?? path.join(process.cwd(), ".steamline-store"));
}

/** True when the cron is running against real durable storage. */
export const isDurable = (env: Record<string, string | undefined> = process.env): boolean =>
  Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
