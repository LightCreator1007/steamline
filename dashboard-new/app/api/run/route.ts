// GET  /api/run?fixture=&theta=&edge=  -> canonical run status, reconstructed from chain
// POST /api/run?fixture=&theta=&edge=  -> execute the canonical run once (the PDA is the lock)
//
// Port of server/run.ts. The chain layer (PDAs, instructions, send) is imported
// from packages/agent/client.ts rather than restated; the capture data is read
// off disk through lib/fixtures instead of over HTTP, which is the one
// behavioural difference from the frozen handler.
import { PublicKey } from "@solana/web3.js";
import { analyzeFixture, type AnalyzedDecision } from "../../../../packages/agent/analyze.ts";
import { outcomeFromScore, resultToOutcomeName } from "../../../../packages/engine/settle.ts";
import { TXORACLE_DEVNET } from "../../../../packages/feed/env.ts";
import {
  initializeArenaIx,
  oddsMsgRef,
  openMatchIx,
  openPositionIx,
  outcomeCode,
  positionPda,
  registerAgentIx,
  scoreProofRef,
  send,
  settleMatchIx,
  settlePositionIx,
} from "../../../../packages/agent/client.ts";
import { finalScore, loadGames, loadPayloads } from "../../../lib/fixtures";
import { ApiErrorException, errorResponse, isErrorCode, type LandedTx } from "../../../lib/errors";
import { assertDevnet, connection, envKeypair, pdas, readAccounts, seasonFor, STARTING_BANKROLL, txsFor } from "../../../lib/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_CAL = { theta: 0.005, edgeMin: 0.005 };

// ponytail: per-instance memory limiter, same budget as server/run.ts. A cold
// start resets it. Upgrade to the Redis bucket when M3 lands one.
const hits = new Map<string, number[]>();
function rateLimitRemaining(ip: string): number {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((ts) => now - ts < 60_000);
  list.push(now);
  hits.set(ip, list);
  let total = 0;
  for (const l of hits.values()) total += l.length;
  if (list.length > 3 || total > 20) return Math.ceil((60_000 - (now - list[0])) / 1000);
  return 0;
}

/** Dev-only escape hatch: ?force=<code> makes every tier of the error surface reachable without breaking anything. */
function forced(url: URL): Response | null {
  if (process.env.NODE_ENV === "production") return null;
  const code = url.searchParams.get("force");
  if (!isErrorCode(code)) return null;
  return errorResponse({
    code,
    message: `Forced ${code} for error-surface testing.`,
    retryAfterSec: code === "rate_limited" ? 45 : undefined,
    landed:
      code === "partial_run"
        ? [
            { label: "arena 900505 created", signature: "4Hxs".padEnd(64, "1") },
            { label: "follow position seq 0 opened", signature: "2Kpq".padEnd(64, "2") },
          ]
        : undefined,
  });
}

async function handle(req: Request, write: boolean): Promise<Response> {
  const url = new URL(req.url);
  const force = forced(url);
  if (force) return force;

  try {
    assertDevnet();
    const fixtureId = Number(url.searchParams.get("fixture"));
    const games = await loadGames();
    const game = games.find((g) => g.id === fixtureId && !g.live);
    if (!game) {
      throw new ApiErrorException({ code: "unknown_fixture", message: "No replayable capture for that fixture." });
    }

    const pinnedCal = game.cal ?? DEFAULT_CAL;
    const { season, cal, calKeyed } = seasonFor(
      pinnedCal,
      Number(url.searchParams.get("theta")),
      Number(url.searchParams.get("edge")),
    );

    const conn = connection();
    const authority = envKeypair("WEB_AUTHORITY_KEYPAIR");
    const follow = envKeypair("WEB_FOLLOW_KEYPAIR");
    const fade = envKeypair("WEB_FADE_KEYPAIR");
    const agents = [follow, fade];
    const { arena, match, books } = pdas(season, fixtureId, follow.publicKey, fade.publicKey);

    const payloads = await loadPayloads(fixtureId);
    const final = finalScore(game);
    const decisions = analyzeFixture(fixtureId, payloads, final, cal).decisions;
    const posPdas = decisions.map((d) => positionPda(match, books[d.agent], BigInt(d.signalSeq)));

    const infos = await readAccounts(conn, posPdas);
    const allExist = infos.length > 0 && infos.every((i) => i !== null);
    const landed: LandedTx[] = [];

    // A calibration-keyed run may land in an arena that does not exist yet.
    // Bootstrap it idempotently, and only when the calibration actually
    // trades, so no rent is spent on no-steam combinations.
    const bootstrap = async (): Promise<void> => {
      if (!calKeyed) return;
      const [arenaInfo, b0, b1, matchInfo] = await readAccounts(conn, [arena, books[0], books[1], match]);
      if (!arenaInfo) {
        const sig = await send(
          conn,
          [
            initializeArenaIx({
              authority: authority.publicKey,
              seasonId: season,
              startingBankroll: STARTING_BANKROLL,
              txoracleProgram: new PublicKey(TXORACLE_DEVNET),
              scoresRootPrefix: Buffer.from("daily_scores_roots"),
              epochDayWidth: 2,
              rootsDataOffset: 8,
            }),
          ],
          authority,
        );
        landed.push({ label: `arena ${season} created`, signature: String(sig) });
      }
      for (const [i, agent] of agents.entries()) {
        if (!(i === 0 ? b0 : b1)) {
          const sig = await send(
            conn,
            [registerAgentIx({ authority: agent.publicKey, arena, strategyTag: i === 0 ? "follow" : "fade" })],
            agent,
          );
          landed.push({ label: `${i === 0 ? "follow" : "fade"} book registered`, signature: String(sig) });
        }
      }
      if (!matchInfo) {
        const sig = await send(
          conn,
          [
            openMatchIx({
              authority: authority.publicKey,
              arena,
              fixtureId: BigInt(fixtureId),
              startTime: BigInt(Math.floor(Date.now() / 1000)),
            }),
          ],
          authority,
        );
        landed.push({ label: "match opened", signature: String(sig) });
      }
    };

    const trade = async (): Promise<void> => {
      for (let i = 0; i < decisions.length; i++) {
        if (infos[i]) continue;
        const d = decisions[i];
        try {
          const sig = await send(
            conn,
            [
              openPositionIx({
                authority: agents[d.agent].publicKey,
                book: books[d.agent],
                game: match,
                fixtureId: BigInt(fixtureId),
                outcome: outcomeCode(d.outcome),
                stakePoints: BigInt(d.stake),
                entryOddsMilli: d.entryOddsMilli,
                edgeBps: d.edgeBps,
                oddsMsgRef: oddsMsgRef(d.messageId),
                oddsTs: BigInt(d.ts),
                signalSeq: BigInt(d.signalSeq),
              }),
            ],
            agents[d.agent],
          );
          landed.push({ label: `${d.agent === 0 ? "follow" : "fade"} position seq ${d.signalSeq} opened`, signature: String(sig) });
        } catch (e) {
          // A racing run already created this position; the PDA is the lock.
          if (!String(e).includes("already in use") && !String(e).includes("custom program error: 0x0")) throw e;
        }
      }
      if (!final) return;
      const outcome = outcomeCode(resultToOutcomeName(outcomeFromScore(final.HomeScore, final.AwayScore)));
      try {
        const sig = await send(
          conn,
          [
            settleMatchIx({
              authority: authority.publicKey,
              arena,
              game: match,
              fixtureId: BigInt(fixtureId),
              homeScore: final.HomeScore,
              awayScore: final.AwayScore,
              settledOutcome: outcome,
              scoreProofRef: scoreProofRef(fixtureId, final.HomeScore, final.AwayScore),
            }),
          ],
          authority,
        );
        landed.push({ label: "match settled", signature: String(sig) });
      } catch (e) {
        if (!String(e).includes("MatchNotOpen") && !String(e).includes("0x177")) throw e;
      }
      for (let i = 0; i < decisions.length; i++) {
        try {
          const sig = await send(
            conn,
            [settlePositionIx({ game: match, position: posPdas[i], book: books[decisions[i].agent] })],
            authority,
          );
          landed.push({ label: `position seq ${decisions[i].signalSeq} settled`, signature: String(sig) });
        } catch (e) {
          if (!String(e).includes("PositionAlreadySettled") && !String(e).includes("0x17")) throw e;
        }
      }
    };

    if (write && decisions.length > 0 && !allExist) {
      // Writes are opt-in per deployment. A dev machine with the keypairs
      // mounted can read the arena all day and still cannot spend from it.
      if (process.env.ALLOW_RUN_WRITES !== "1") {
        throw new ApiErrorException({
          code: "not_configured",
          message: "This deployment reads the arena but is not authorised to submit transactions.",
        });
      }
      const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
      const retryAfterSec = rateLimitRemaining(ip);
      if (retryAfterSec > 0) {
        throw new ApiErrorException({
          code: "rate_limited",
          message: "Each visitor may trigger three runs a minute; the arena keys pay real devnet fees.",
          retryAfterSec,
        });
      }
      try {
        await bootstrap();
        await trade();
      } catch (e) {
        if (landed.length > 0) {
          throw new ApiErrorException({
            code: "partial_run",
            message: e instanceof Error ? e.message : String(e),
            landed,
          });
        }
        throw e;
      }
    }

    const finalInfos = await readAccounts(conn, posPdas);
    const positions = await Promise.all(
      decisions.map(async (d: AnalyzedDecision, i: number) => ({
        agent: d.agent === 0 ? "follow" : "fade",
        signalSeq: d.signalSeq,
        outcome: d.outcome,
        entryOdds: d.entryOdds,
        stake: d.stake,
        status: d.status,
        payout: d.payout,
        address: posPdas[i].toBase58(),
        onChain: finalInfos[i] !== null,
        oddsRef: d.messageId,
        oddsTs: d.ts,
        ...(finalInfos[i] ? await txsFor(conn, posPdas[i]) : { openTx: null, settleTx: null }),
      })),
    );

    return Response.json({
      season: season.toString(),
      calKeyed,
      fixtureId,
      calibration: cal,
      noSteam: decisions.length === 0,
      ran: decisions.length > 0 && finalInfos.every((i) => i !== null),
      arena: arena.toBase58(),
      match: match.toBase58(),
      books: [
        { agent: "follow", address: books[0].toBase58() },
        { agent: "fade", address: books[1].toBase58() },
      ],
      positions,
      fetchedAt: Date.now(),
    });
  } catch (e) {
    if (e instanceof ApiErrorException) return errorResponse(e.detail);
    return errorResponse({ code: "internal", message: e instanceof Error ? e.message : String(e) });
  }
}

export const GET = (req: Request) => handle(req, false);
export const POST = (req: Request) => handle(req, true);
