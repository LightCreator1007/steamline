import { redirect } from "next/navigation";
import { loadGames } from "../../lib/fixtures";

// The old dashboard opened on this fixture; the arena entry point keeps it.
const DEFAULT_FIXTURE = 18213979;

export default async function Arena() {
  const games = await loadGames();
  redirect(`/f/${games.find((g) => g.id === DEFAULT_FIXTURE)?.id ?? games[0].id}`);
}
