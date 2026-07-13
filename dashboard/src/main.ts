// Steamline interactive dashboard: replays real captured TxLINE odds through
// the actual detection engine, entirely in the browser. The engine modules
// are the same files the agent runs; esbuild bundles them here.
import { defaultConfig, newAgentState, type AgentState, type OddsPayload, type Signal } from "../../packages/engine/model.ts";
import { normalizeOdds } from "../../packages/engine/normalize.ts";
import { inMemoryLedger, type Ledger } from "../../packages/engine/ledger.ts";
import { detectSteam } from "../../packages/engine/detect.ts";
import { follow, fade, type Pick } from "../../packages/engine/strategy.ts";
import { sizeStake } from "../../packages/engine/stake.ts";
import { settlePosition, outcomeFromScore, resultToOutcomeName } from "../../packages/engine/settle.ts";
import { applyGrade } from "../../packages/engine/grade.ts";

interface Game {
  id: number;
  home: string;
  away: string;
  stage: string;
  date: string;
  final?: string;
  onchain?: boolean;
  live?: boolean;
}

interface SimPosition {
  agent: 0 | 1;
  outcome: string;
  entryOdds: number;
  stake: number;
  belief: number;
  edge: number;
  signalSeq: number;
  status: "open" | "won" | "lost";
  payout: number;
}

const $ = (id: string) => document.getElementById(id)!;
const EXPL = (sig: string, kind = "tx") => `https://explorer.solana.com/${kind}/${sig}?cluster=devnet`;
const RPC = new URLSearchParams(location.search).get("rpc") || "https://api.devnet.solana.com";
const pts = (n: number) => n.toLocaleString("en-US");

let games: Game[] = [];
let chainState: any = null; // dashboard/state.json from the recorded on-chain run
let game: Game | null = null;
let payloads: OddsPayload[] = [];
let finalScore: { HomeScore: number; AwayScore: number } | null = null;

// replay state
let ledger: Ledger;
let books: AgentState[];
let signals: Signal[];
let positions: SimPosition[];
let tape: { ts: number; probs: number[] }[];
let idx = 0;
let timer: number | null = null;
let seq = 0;
let done = false;

const cfg = () => ({
  ...defaultConfig,
  theta: Number(($("theta") as HTMLInputElement).value) / 100,
  edgeMin: Number(($("edge") as HTMLInputElement).value) / 100,
});

function outcomeName(o: string): string {
  if (!game) return o;
  return o === "1" ? game.home : o === "2" ? game.away : "Draw";
}

async function boot(): Promise<void> {
  games = await (await fetch("./data/games.json")).json();
  try {
    chainState = await (await fetch("./state.json")).json();
  } catch {
    chainState = null;
  }
  renderRail();
  const first = games.find((g) => g.onchain) ?? games[0];
  await selectGame(first.id);
}

function renderRail(): void {
  $("rail").innerHTML = games
    .map((g) => {
      const active = game && g.id === game.id ? " active" : "";
      if (g.live) {
        return `<button class="gcard live" data-id="${g.id}" aria-disabled="true">
          <span class="teams">${g.home} vs ${g.away}</span>
          <span class="sub">${g.stage} · ${g.date}</span>
          <span class="livechip">LIVE · coming soon</span></button>`;
      }
      return `<button class="gcard${active}" data-id="${g.id}">
        <span class="teams">${g.home} vs ${g.away}</span>
        <span class="sub">${g.stage} · ${g.date} · FT ${g.final}</span>
        ${g.onchain ? '<span class="chainchip">on-chain run</span>' : '<span class="simchip">replay analysis</span>'}</button>`;
    })
    .join("");
  for (const el of document.querySelectorAll<HTMLButtonElement>(".gcard")) {
    el.addEventListener("click", () => {
      const g = games.find((x) => x.id === Number(el.dataset.id))!;
      if (g.live) {
        $("liveNote").textContent = `${g.home} vs ${g.away} kicks off ${g.date}. The agent will watch it live; this page streams it soon after.`;
        return;
      }
      selectGame(g.id);
    });
  }
}

async function selectGame(id: number): Promise<void> {
  stop();
  game = games.find((g) => g.id === id)!;
  const [oddsTxt, scoreTxt] = await Promise.all([
    (await fetch(`./data/${id}/odds.jsonl`)).text(),
    (await fetch(`./data/${id}/scores.jsonl`)).text(),
  ]);
  payloads = oddsTxt.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  finalScore = JSON.parse(scoreTxt.split("\n").filter(Boolean)[0] ?? "null");
  $("liveNote").textContent = "";
  renderRail();
  resetReplay();
  play();
}

function resetReplay(): void {
  stop();
  ledger = inMemoryLedger();
  books = [newAgentState(0, defaultConfig.startingBankroll), newAgentState(1, defaultConfig.startingBankroll)];
  signals = [];
  positions = [];
  tape = [];
  idx = 0;
  seq = 0;
  done = false;
  $("feed").innerHTML = "";
  $("settle").innerHTML = "";
  $("matchline").innerHTML = `<span class="label">${game!.home} vs ${game!.away}</span>
    <span class="chip">${game!.stage}</span><span class="chip">fixture ${game!.id}</span>
    <span class="chip" id="clock"></span>`;
  renderBoard(null);
  renderBooks();
  renderTape();
  renderChainPanel();
  updatePlayButton();
}

function step(): void {
  if (!game || idx >= payloads.length) {
    if (!done) settleNow();
    stop();
    return;
  }
  const c = cfg();
  const p = payloads[idx++];
  const tick = normalizeOdds(p, p.Ts, c);
  ledger.append(tick);
  tape.push({ ts: tick.ts, probs: tick.outcomes.map((o) => o.fairProb) });
  renderBoard(tick);
  renderTape();
  ($("clock") as HTMLElement).textContent =
    new Date(tick.ts).toUTCString().slice(17, 25) + ` UTC · tick ${idx}/${payloads.length}`;

  const sig = detectSteam(ledger, game.id, tick.market, c, () => seq++, { recentSignals: signals });
  if (sig) {
    signals.push(sig);
    feed(
      `<div class="ev steam"><b>STEAM #${signals.length}</b> on ${outcomeName(sig.outcome)}:
       ${(sig.preProb * 100).toFixed(1)}% -> ${(sig.postProb * 100).toFixed(1)}%
       (+${(sig.magnitude * 100).toFixed(1)}pp sustained)</div>`,
    );
    const win = ledger.window(game.id, tick.market, c.windowTicks + 1);
    const pre = win[0];
    const picks: (Pick | null)[] = [follow(sig, tick, pre, c), fade(sig, tick, pre, c)];
    picks.forEach((pick, agent) => {
      const name = agent === 0 ? "follow" : "fade";
      if (!pick) {
        feed(`<div class="ev hold"><b>${name}</b> holds: no outcome clears the ${(c.edgeMin * 100).toFixed(1)}% edge floor</div>`);
        return;
      }
      const openHere = positions.filter((x) => x.agent === agent).length;
      const stake = sizeStake(pick.belief, pick.entryOdds, books[agent], { killed: false, dailyLoss: 0 }, c, openHere);
      if (stake <= 0) {
        feed(`<div class="ev hold"><b>${name}</b> holds: stake sized to zero</div>`);
        return;
      }
      books[agent] = {
        ...books[agent],
        bankrollPoints: books[agent].bankrollPoints - stake,
        stakedPoints: books[agent].stakedPoints + stake,
        betsOpened: books[agent].betsOpened + 1,
      };
      positions.push({
        agent: agent as 0 | 1,
        outcome: pick.outcome,
        entryOdds: pick.entryOdds,
        stake,
        belief: pick.belief,
        edge: pick.edge,
        signalSeq: sig.seq,
        status: "open",
        payout: 0,
      });
      feed(
        `<div class="ev ${name}"><b>${name}</b> backs <b>${outcomeName(pick.outcome)}</b> at ${pick.entryOdds.toFixed(2)}
         · stake ${pts(stake)} pts · edge ${(pick.edge * 100).toFixed(1)}%${txLink(agent as 0 | 1, sig.seq)}</div>`,
      );
      renderBooks();
    });
  }
}

function settleNow(): void {
  done = true;
  if (!finalScore || !game) return;
  const result = outcomeFromScore(finalScore.HomeScore, finalScore.AwayScore);
  const winName = resultToOutcomeName(result);
  let rows = "";
  for (const pos of positions) {
    const r = settlePosition(
      { agentId: pos.agent, fixtureId: game.id, signalSeq: pos.signalSeq, outcome: pos.outcome, stakePoints: pos.stake, entryOdds: pos.entryOdds, belief: pos.belief, status: "open", payoutPoints: 0 },
      result,
    );
    pos.status = r.status;
    pos.payout = r.payout;
    books[pos.agent] = applyGrade(
      { ...books[pos.agent], bankrollPoints: books[pos.agent].bankrollPoints + r.payout, stakedPoints: books[pos.agent].stakedPoints - pos.stake },
      pos.belief,
      r.status === "won" ? 1 : 0,
      r.pnl,
    );
    rows += `<tr><td class="agent-${pos.agent === 0 ? "follow" : "fade"}">${pos.agent === 0 ? "follow" : "fade"}</td>
      <td>${outcomeName(pos.outcome)}</td><td class="odds">${pos.entryOdds.toFixed(2)}</td>
      <td>${pts(pos.stake)}</td><td><span class="${pos.status}">${pos.status.toUpperCase()}</span></td>
      <td>${pts(pos.payout)}</td><td>${txCell(pos)}</td></tr>`;
  }
  renderBooks();
  const noTrades = positions.length === 0;
  $("settle").innerHTML = `
    <div class="eyebrow">Settlement · regulation score</div>
    <div class="finalbox">FT ${finalScore.HomeScore}-${finalScore.AwayScore} · ${outcomeName(winName)} wins</div>
    ${noTrades
      ? `<p class="note">No steam cleared the threshold in this window, so neither agent traded. Discipline is a feature: quiet markets stay quiet. Lower the threshold and replay to see what a twitchier detector would have done.</p>`
      : `<div class="tablewrap"><table><thead><tr><th>agent</th><th>backed</th><th>odds</th><th>stake</th><th>result</th><th>payout</th><th>tx</th></tr></thead><tbody>${rows}</tbody></table></div>`}
  `;
}

function txLink(agent: 0 | 1, signalSeq: number): string {
  const m = matchChainPos(agent, signalSeq);
  return m && m.openTx ? ` · <a href="${EXPL(m.openTx)}" target="_blank" rel="noopener">devnet tx</a>` : "";
}

function txCell(pos: SimPosition): string {
  const m = matchChainPos(pos.agent, pos.signalSeq);
  if (!m) return "-";
  return `${m.openTx ? `<a href="${EXPL(m.openTx)}" target="_blank" rel="noopener">open</a>` : "-"}${m.settleTx ? ` · <a href="${EXPL(m.settleTx)}" target="_blank" rel="noopener">settle</a>` : ""}`;
}

function matchChainPos(agent: 0 | 1, signalSeq: number): any {
  if (!game || !chainState || chainState.fixtureId !== game.id) return null;
  const name = agent === 0 ? "follow" : "fade";
  return chainState.positions.find((p: any) => p.agent === name && p.signalSeq === signalSeq) ?? null;
}

function renderBoard(tick: any): void {
  const names = ["1", "X", "2"];
  $("board").innerHTML = names
    .map((n, i) => {
      const oc = tick?.outcomes.find((o: any) => o.name === n);
      return `<div class="tile"><div class="tname">${outcomeName(n)}</div>
        <div class="todds">${oc ? oc.decimalOdds.toFixed(2) : "-.--"}</div>
        <div class="tprob">${oc ? (oc.fairProb * 100).toFixed(1) + "%" : ""}</div></div>`;
    })
    .join("");
}

function renderBooks(): void {
  $("books").innerHTML = books
    .map((b, i) => {
      const name = i === 0 ? "follow" : "fade";
      const pnl = b.realizedPnl;
      const cls = pnl > 0 ? "pos" : pnl < 0 ? "neg" : "";
      return `<div class="book ${name}"><h2>${name}</h2>
        <div class="strat">${name === "follow" ? "rides the steam" : "bets against the steam"}</div>
        <div class="stat"><span>bankroll</span><span class="v">${pts(b.bankrollPoints)}</span></div>
        <div class="stat"><span>at risk</span><span class="v">${pts(b.stakedPoints)}</span></div>
        <div class="stat"><span>realized pnl</span><span class="v ${cls}">${pts(pnl)}</span></div>
        <div class="stat"><span>record</span><span class="v">${b.betsWon}W / ${b.betsLost}L</span></div></div>`;
    })
    .join("");
}

function renderTape(): void {
  const svg = $("tape");
  const W = 940, H = 150, PAD = 6;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  if (tape.length < 2) {
    svg.innerHTML = "";
    return;
  }
  const t0 = payloads[0].Ts, t1 = payloads[payloads.length - 1].Ts;
  const x = (ts: number) => PAD + ((ts - t0) / (t1 - t0)) * (W - 2 * PAD);
  let lo = 1, hi = 0;
  for (const p of tape) for (const v of p.probs) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  lo = Math.max(0, lo - 0.015); hi = Math.min(1, hi + 0.015);
  const y = (v: number) => H - PAD - ((v - lo) / (hi - lo)) * (H - 2 * PAD);
  const colors = ["#ffd84d", "#8b93b8", "#7fd4dc"];
  let g = "";
  for (let v = Math.ceil(lo * 20) / 20; v <= hi; v += 0.05) {
    g += `<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="#2a3560" stroke-width="0.5"/>
      <text x="2" y="${y(v) - 3}" fill="#8b93b8" font-size="9">${Math.round(v * 100)}%</text>`;
  }
  let paths = "";
  for (let k = 0; k < 3; k++) {
    const steamed = signals.length > 0 && signals[0].outcome === ["1", "X", "2"][k];
    const d = tape.map((p, i) => `${i ? "L" : "M"}${x(p.ts).toFixed(1)},${y(p.probs[k]).toFixed(1)}`).join("");
    paths += `<path d="${d}" fill="none" stroke="${colors[k]}" stroke-width="${steamed ? 2.4 : 1.1}" opacity="${steamed ? 1 : 0.6}"/>`;
  }
  let marks = "";
  signals.forEach((s, n) => {
    const xx = x(s.ts);
    const flip = xx > W * 0.8;
    marks += `<line x1="${xx}" x2="${xx}" y1="${PAD}" y2="${H - PAD}" stroke="#ff7a5c" stroke-width="1" stroke-dasharray="3 3"/>
      <circle cx="${xx}" cy="${y(s.postProb)}" r="4" fill="#ff7a5c"/>
      <text x="${xx + (flip ? -5 : 5)}" text-anchor="${flip ? "end" : "start"}" y="${PAD + 12}" fill="#ff7a5c" font-size="10">STEAM #${n + 1}</text>`;
  });
  svg.innerHTML = g + paths + marks;
  $("legend").innerHTML =
    ["1", "X", "2"].map((o, k) => `<span><span class="k" style="background:${colors[k]}"></span>${outcomeName(o)}</span>`).join("") +
    `<span><span class="k" style="background:#ff7a5c"></span>steam signal</span>`;
}

async function renderChainPanel(): Promise<void> {
  const el = $("chain");
  if (!game?.onchain || !chainState || chainState.fixtureId !== game.id) {
    el.innerHTML = game && !game.onchain
      ? `<p class="note">Replay analysis only for this game. Norway vs England carries a full on-chain arena run with real devnet transactions.</p>`
      : "";
    return;
  }
  el.innerHTML = `<div class="eyebrow">On-chain arena run · devnet</div>
    <p class="note">This game was traded for real by the agent on the Solana devnet arena
    (season ${chainState.season}). Book accounts, live from chain: <span id="chainbal">reading...</span><br>
    Program <a href="${EXPL(chainState.programId, "address")}" target="_blank" rel="noopener">${chainState.programId.slice(0, 8)}…</a>
    · Arena <a href="${EXPL(chainState.arena, "address")}" target="_blank" rel="noopener">${chainState.arena.slice(0, 8)}…</a>
    · Match <a href="${EXPL(chainState.match, "address")}" target="_blank" rel="noopener">${chainState.match.slice(0, 8)}…</a>
    ${chainState.settleMatchTx ? `· Settlement <a href="${EXPL(chainState.settleMatchTx)}" target="_blank" rel="noopener">tx</a>` : ""}</p>`;
  try {
    const out: string[] = [];
    for (const b of chainState.books) {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [b.address, { encoding: "base64" }] }),
      });
      const j = await res.json();
      const b64 = j.result?.value?.data?.[0];
      if (!b64) continue;
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dv = new DataView(raw.buffer);
      out.push(`${b.agent} ${pts(Number(dv.getBigUint64(88, true)))} pts (${dv.getUint32(116, true)}W/${dv.getUint32(120, true)}L)`);
    }
    $("chainbal").textContent = out.join(" · ") || "unavailable";
  } catch {
    const cb = document.getElementById("chainbal");
    if (cb) cb.textContent = "devnet RPC unreachable from this browser";
  }
}

function feed(html: string): void {
  $("feed").insertAdjacentHTML("afterbegin", html);
}

function speedMs(): number {
  return Number(($("speed") as HTMLSelectElement).value);
}

function play(): void {
  if (timer !== null || done) return;
  timer = window.setInterval(step, speedMs());
  updatePlayButton();
}

function stop(): void {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  updatePlayButton();
}

function updatePlayButton(): void {
  $("play").textContent = timer !== null ? "pause" : done ? "done" : "play";
}

function skipToEnd(): void {
  stop();
  while (idx < payloads.length) step();
  if (!done) settleNow();
  updatePlayButton();
}

$("play").addEventListener("click", () => (timer !== null ? stop() : play()));
$("skip").addEventListener("click", skipToEnd);
$("restart").addEventListener("click", () => {
  resetReplay();
  play();
});
$("speed").addEventListener("change", () => {
  if (timer !== null) {
    stop();
    play();
  }
});
for (const id of ["theta", "edge"]) {
  $(id).addEventListener("input", () => {
    $("thetaVal").textContent = `${($("theta") as HTMLInputElement).value}pp`;
    $("edgeVal").textContent = `${($("edge") as HTMLInputElement).value}%`;
  });
  $(id).addEventListener("change", () => {
    resetReplay();
    skipToEnd();
  });
}

boot().catch((e) => {
  $("matchline").textContent = "failed to load game data";
  console.error(e);
});
