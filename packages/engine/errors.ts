export type EngineErrorCode =
  | "BAD_ODDS_DECODE"
  | "ZERO_OVERROUND"
  | "MISSING_OUTCOME"
  | "STALE_TICK"
  | "INSUFFICIENT_BANKROLL"
  | "CAP_EXCEEDED"
  | "INVALID_INPUT";

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
  /X-Api-Token[:=]\s*[A-Za-z0-9._\-]+/gi,
] as const satisfies readonly RegExp[];

export function redactSecrets(s: string): string {
  let out = s;
  for (const p of SECRET_PATTERNS) {
    out = out.replace(p, (m) => {
      const separatorIndex = m.search(/[:=]/);
      if (separatorIndex === -1) return "Bearer [redacted]";
      return `${m.slice(0, separatorIndex)}: [redacted]`;
    });
  }
  return out;
}

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly remediation: string;
  constructor(code: EngineErrorCode, message: string, remediation: string) {
    super(redactSecrets(message));
    this.name = "EngineError";
    this.code = code;
    this.remediation = redactSecrets(remediation);
  }
}
