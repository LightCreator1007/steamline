// One typed vocabulary for every way an API call can fail, shared by the route
// handlers and the client. The UI switches on the code and never on the
// message, so wording can change without breaking a surface.
import { z } from "zod";

export const ERROR_CODES = [
  "unknown_fixture", // fixture id is not in games.json
  "bad_calibration", // sliders off the discrete grid
  "not_configured", // server has no web keypairs, so it cannot sign
  "chain_unavailable", // devnet RPC read failed
  "upstream_unavailable", // capture data or TxLINE unreachable
  "rate_limited", // per-IP run budget spent
  "partial_run", // some transactions landed, some did not
  "internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const landedTxSchema = z.object({
  label: z.string(),
  signature: z.string(),
});
export type LandedTx = z.infer<typeof landedTxSchema>;

export const apiErrorSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  retryAfterSec: z.number().optional(),
  landed: z.array(landedTxSchema).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

// Spec section 4: inline states are content, toasts are transient, dialogs are
// the two things a visitor must decide on or must not miss.
export type Tier = "inline" | "toast" | "dialog";

const TIERS: Record<ErrorCode, Tier> = {
  unknown_fixture: "inline",
  bad_calibration: "inline",
  not_configured: "inline",
  chain_unavailable: "toast",
  upstream_unavailable: "toast",
  rate_limited: "dialog",
  partial_run: "dialog",
  internal: "toast",
};

export const tierOf = (code: ErrorCode): Tier => TIERS[code];

const STATUS: Record<ErrorCode, number> = {
  unknown_fixture: 404,
  bad_calibration: 400,
  not_configured: 503,
  chain_unavailable: 502,
  upstream_unavailable: 502,
  rate_limited: 429,
  partial_run: 207,
  internal: 500,
};

export class ApiErrorException extends Error {
  constructor(readonly detail: ApiError) {
    super(detail.message);
    this.name = "ApiErrorException";
  }
}

export function errorResponse(detail: ApiError): Response {
  return Response.json(detail, { status: STATUS[detail.code] });
}

export const isErrorCode = (v: string | null): v is ErrorCode =>
  v !== null && (ERROR_CODES as readonly string[]).includes(v);
