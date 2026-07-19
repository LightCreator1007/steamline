import { notFound } from "next/navigation";
import { analyzeFixture } from "../../../../packages/agent/analyze.ts";
import { finalScore, loadGames, loadPayloads, type Game } from "../../../lib/fixtures";
import { calFromParams, toCal, type Cal } from "../../../lib/cal";
import ChainPanel from "../../../components/ChainPanel";
import Rail from "../../../components/Rail";
import Replay from "../../../components/Replay";

const DEFAULT_CAL: Cal = { theta: 0.005, edgeMin: 0.005 };

export default async function FixturePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ theta?: string; edge?: string }>;
}) {
  const { id } = await params;
  const games = await loadGames();
  const game = games.find((g) => g.id === Number(id));
  if (!game) notFound();

  const pinned = game.cal ?? DEFAULT_CAL;
  const { thetaPp, edgePct } = calFromParams(await searchParams, pinned);

  // Live cards have no captured tape to replay, so there is nothing to
  // analyze: the chain is the record of what the agent did, and the panel
  // polls it. Sliders stay replay-only during a live window, deliberately,
  // so a visitor cannot fork the run that is executing.
  const body = game.live ? (
    <LiveHeader game={game} pinned={pinned} />
  ) : (
    <Replay
      game={game}
      analysis={analyzeFixture(game.id, await loadPayloads(game.id), finalScore(game), toCal(thetaPp, edgePct))}
      thetaPp={thetaPp}
      edgePct={edgePct}
      pinned={pinned}
    />
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 lg:flex-row lg:gap-8 lg:p-6">
      <Rail games={games} activeId={game.id} />
      <main className="min-w-0 flex-1">{body}</main>
    </div>
  );
}

function LiveHeader({ game, pinned }: { game: Game; pinned: Cal }) {
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-3">
        <h1 className="font-display text-xl font-semibold tracking-tight text-fg">
          {game.home} vs {game.away}
        </h1>
        <span className="num text-xs text-mute">
          {game.stage} · fixture {game.id} · {game.date}
        </span>
        <span className="num ml-auto text-xs text-mute">
          {(pinned.theta * 100).toFixed(1)}pp / {(pinned.edgeMin * 100).toFixed(1)}% · arena 777
        </span>
      </header>
      <p className="text-sm text-mute">
        This one is live, so there is no replay to scrub. The agent watches the pre-match window and executes on
        devnet as steam fires; everything below is read back from the chain.
      </p>
      <ChainPanel game={game} thetaPp={pinned.theta * 100} edgePct={pinned.edgeMin * 100} />
      <footer className="border-t border-line pt-3 text-[11px] text-mute">
        Play-money points. Settlement is provenance-verified against TxLINE&apos;s published roots where anchored; see
        docs for exactly what is and is not proven.
      </footer>
    </div>
  );
}
