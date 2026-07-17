# Steamline

An autonomous agent that reads live World Cup odds from [TxLINE](https://txline.txodds.com), detects **steam moves** (sharp, consensus odds shifts), and lets two rival strategies trade every signal with play-money points on a Solana devnet program. Follow bets with the steam, fade bets against it. Every position, settlement, and payout lands on-chain.

Built for the TxLINE World Cup hackathon, track 3 (autonomous agents).

- **Live site:** https://steamline-eosin.vercel.app
- **Docs:** https://steamline-docs.vercel.app
- **Program (devnet):** `E9jfScHBJRB2NyB2NFmE4Kec9D8hJ1X7k24AXufRbX5n`

## Why it is interesting

- **Steam detection on a demargined consensus line.** The agent ingests the `TXLineStablePriceDemargined` book, whose vig is already stripped, so an odds shift is a real change in consensus probability rather than a bookmaker margin artifact. Detection is pre-match only by default: a mid-match goal moves the line, but that is news, not steam.
- **Two strategies, one signal.** Follow and fade each hold their own bankroll and settle against the same real regulation score. The arena is a scoreboard for opposing hypotheses.
- **Permissionless arena.** Any strategy can register a book against a season and compete. Bankrolls are play-money points; system equity is conserved (stake debited on open, payout credited on settle).
- **Provenance-verified settlement.** Beyond authority settlement, the program carries `settle_match_verified`: an in-program Merkle path that checks a TxLINE score proof against the Txoracle roots account, with no CPI. It validates the roots account owner and PDA derivation, reads the anchored root at a configured offset, and folds the proof back to it. The instruction is deployed on devnet, has a hand-encoded client builder, and has been exercised there against real TxLINE proof material: every account and config check passes, the fold semantics match TxLINE's real proofs byte-exact at the sub-tree level, and the instruction correctly rejects the proof at the final root comparison because TxLINE's devnet does not currently anchor the roots its validation endpoints prove against. The proof establishes that the leaf is a member of TxLINE's published tree; it does not yet bind that leaf to the score arguments, which is why the wording is "provenance-verified" and not "trustless". Pinning the leaf preimage and dropping the `leaf_data` argument is the upgrade path.

## How it fits together

```
TxLINE API ──▶ feed ──▶ engine ──▶ agent ──▶ steamline_arena (devnet)
  odds/scores   client   detect     runtime   Anchor program
                         + settle    (ixs)     books, matches, positions
```

| Package | What it does | Tests |
| --- | --- | --- |
| `packages/engine` | Pure, dependency-free TypeScript. Normalize odds, maintain the tick ledger, detect steam, size stakes, settle on regulation score, grade. Runs unchanged in Node and in the browser. | 50 |
| `packages/feed` | TxLINE client: guest auth, subscription bootstrap, historical odds/scores capture, live SSE, Merkle proof validation. | 31 |
| `packages/agent` | Devnet runtime. Hand-encodes the instructions it needs straight from the IDL (no Anchor TS client), bootstraps the arena, replays a fixture through the shared `analyzeFixture` pipeline, and reconciles on-chain book state against the engine. Includes the live driver (`live.ts`) that trades a match in real time and settles at full time. | 11 |
| `packages/onchain` | The `steamline_arena` Anchor program. | 24 (LiteSVM) |

The web app is `dashboard/` (in-browser engine replay of the captured real World Cup fixtures, plus a live view for matches still to be played) with two serverless functions: `api/run.js` executes on-chain passes, and `api/live-status.js` reconstructs live-run state purely from chain PDAs. The detection sliders are calibration-keyed on chain: every discrete (threshold, edge) combination maps to its own arena PDA, so moving a slider and pressing run lands in that calibration's arena, and identical settings always resolve to the identical on-chain run.

## Quickstart

```bash
pnpm install

# Engine: normalization, steam detection, settlement, grading
node --test --experimental-strip-types "packages/engine/*.test.ts"   # 50 pass

# Feed: TxLINE client, capture, Merkle validation
node --test --experimental-strip-types "packages/feed/*.test.ts"     # 31 pass

# Agent: shared analysis pipeline, payout parity, equity conservation
node --test --experimental-strip-types "packages/agent/*.test.ts"    # 6 pass

# Program: LiteSVM integration tests
cd packages/onchain && anchor build && cargo test                     # 24 pass
```

Running the agent against devnet needs an RPC endpoint and funded keypairs, neither of which lives in the repo. The reproducible path is the test suites above and the live site, which executes real on-chain runs per game.

## The program

`steamline_arena` (Anchor 1.0). Play-money points only.

Instructions: `initialize_arena`, `register_agent`, `open_match`, `open_position`, `settle_match`, `settle_match_verified`, `settle_position`, `void_match`.

PDAs:

- Arena: `["arena", season_id]`
- AgentBook: `["book", arena, authority]`
- Match: `["match", arena, fixture_id]`
- Position: `["pos", match, book, signal_seq]`

Position idempotency is an init collision on the Position PDA, keyed by `signal_seq`, so a replayed signal cannot double-bet. Payouts use integer-milli odds (`(stake * entry_odds_milli + 500) / 1000`) so the on-chain and off-chain results are byte-identical.

## Layout

```
packages/
  engine/    steam detection and settlement (TypeScript)
  feed/      TxLINE API client and capture
  agent/     devnet runtime
  onchain/   steamline_arena Anchor program
dashboard/   web app (in-browser replay)
api/         serverless on-chain executor
fixtures/    captured real World Cup odds and scores
```

## License

MIT, see [LICENSE](LICENSE).
