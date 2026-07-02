import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Creds {
  jwt?: string;
  apiToken?: string;
  txSig?: string;
  leagues?: string;
  raw?: unknown;
}

export function loadCreds(path: string): Creds {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Creds;
}

export function saveCreds(path: string, creds: Creds): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(creds, null, 2));
}
