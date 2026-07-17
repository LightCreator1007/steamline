// Steamline interactive dashboard: replays real captured TxLINE odds through
// the actual detection engine, entirely in the browser. The pipeline is the
// same analyzeFixture the agent and the web executor run; esbuild bundles it
// here and this file only renders its trace.
import { defaultConfig, newAgentState, type AgentState, type OddsPayload, type OddsTick, type Signal } from "../../packages/engine/model.ts";
import { resultToOutcomeName } from "../../packages/engine/settle.ts";
import { analyzeFixture, type Analysis } from "../../packages/agent/analyze.ts";

interface Game {
  id: number;
  home: string;
  away: string;
  stage: string;
  date: string;
  kickoff?: string;
  final?: string;
  live?: boolean;
  cal?: { theta: number; edgeMin: number };
}

const $ = (id: string) => document.getElementById(id)!;
const EXPL = (sig: string, kind = "tx") => `https://explorer.solana.com/${kind}/${sig}?cluster=devnet`;
const pts = (n: number) => n.toLocaleString("en-US");

let games: Game[] = [];
let game: Game | null = null;
let payloads: OddsPayload[] = [];
let finalScore: { HomeScore: number; AwayScore: number } | null = null;

// replay state
let analysis: Analysis | null = null;
let signalsSeen: Signal[] = [];
let tape: { ts: number; probs: number[] }[] = [];
let idx = 0;
let timer: number | null = null;
let done = false;

const cal = () => ({
  theta: Number(($("theta") as HTMLInputElement).value) / 100,
  edgeMin: Number(($("edge") as HTMLInputElement).value) / 100,
});

const freshBooks = () => [newAgentState(0, defaultConfig.startingBankroll), newAgentState(1, defaultConfig.startingBankroll)];

function outcomeName(o: string): string {
  if (!game) return o;
  return o === "1" ? game.home : o === "2" ? game.away : "Draw";
}

async function boot(): Promise<void> {
  games = await (await fetch("./data/games.json")).json();
  renderRail();
  const first = games.find((g) => g.id === 18213979) ?? games[0];
  await selectGame(first.id);
}

function renderRail(): void {
  let html = "";
  let stage = "";
  for (const g of games) {
    if (g.stage !== stage) {
      stage = g.stage;
      html += `<div class="stagehead">${stage}</div><div class="stagegrid">`;
    }
    const active = game && g.id === game.id ? " active" : "";
    if (g.live) {
      html += `<button class="gcard live${active}" data-id="${g.id}">
        <span class="teams">${g.home} vs ${g.away}</span>
        <span class="sub">${g.date}</span>
        <span class="livechip">LIVE</span></button>`;
    } else {
      html += `<button class="gcard${active}" data-id="${g.id}">
        <span class="teams">${g.home} vs ${g.away}</span>
        <span class="sub">${g.date}${g.final ? ` · FT ${g.final}` : ""}</span></button>`;
    }
    const next = games[games.indexOf(g) + 1];
    if (!next || next.stage !== stage) html += `</div>`;
  }
  $("rail").innerHTML = html;
  for (const el of document.querySelectorAll<HTMLButtonElement>(".gcard")) {
    el.addEventListener("click", () => {
      const g = games.find((x) => x.id === Number(el.dataset.id))!;
      if (g.live) {
        selectLiveGame(g);
        return;
      }
      selectGame(g.id);
    });
  }
}

async function selectGame(id: number): Promise<void> {
  stop();
  clearLive();
  game = games.find((g) => g.id === id)!;
  const [oddsTxt, scoreTxt] = await Promise.all([
    (await fetch(`./data/${id}/odds.jsonl`)).text(),
    (await fetch(`./data/${id}/scores.jsonl`)).text(),
  ]);
  payloads = oddsTxt.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  finalScore = JSON.parse(scoreTxt.split("\n").filter(Boolean)[0] ?? "null");
  $("liveNote").textContent = "";
  // Default the knobs to this game's pinned calibration (the canonical
  // on-chain run uses exactly these settings).
  if (game.cal) {
    ($("theta") as HTMLInputElement).value = String(game.cal.theta * 100);
    ($("edge") as HTMLInputElement).value = String(game.cal.edgeMin * 100);
    $("thetaVal").textContent = `${game.cal.theta * 100}pp`;
    $("edgeVal").textContent = `${game.cal.edgeMin * 100}%`;
  }
  renderRail();
  resetReplay();
  play();
}

function resetReplay(): void {
  if (game?.live) return;
  stop();
  analysis = game ? analyzeFixture(game.id, payloads, finalScore, cal()) : null;
  signalsSeen = [];
  tape = [];
  idx = 0;
  done = false;
  $("feed").innerHTML = "";
  $("settle").innerHTML = "";
  $("matchline").innerHTML = `<span class="label">${game!.home} vs ${game!.away}</span>
    <span class="chip">${game!.stage}</span><span class="chip">fixture ${game!.id}</span>
    <span class="chip" id="clock"></span>`;
  renderBoard(null);
  renderBooks(freshBooks());
  renderTape();
  fetchRunState().then(renderChainPanel);
  updatePlayButton();
}

function step(): void {
  if (!game || !analysis || idx >= analysis.trace.length) {
    if (!done) settleNow();
    stop();
    return;
  }
  const t = analysis.trace[idx++];
  tape.push({ ts: t.tick.ts, probs: t.tick.outcomes.map((o) => o.fairProb) });
  renderBoard(t.tick);
  renderTape();
  ($("clock") as HTMLElement).textContent =
    new Date(t.tick.ts).toUTCString().slice(17, 25) + ` UTC · tick ${idx}/${analysis.trace.length}`;

  for (const ev of t.events) {
    if (ev.kind === "signal") {
      signalsSeen.push(ev.signal);
      feed(
        `<div class="ev steam"><b>STEAM #${signalsSeen.length}</b> on ${outcomeName(ev.signal.outcome)}:
         ${(ev.signal.preProb * 100).toFixed(1)}% -> ${(ev.signal.postProb * 100).toFixed(1)}%
         (+${(ev.signal.magnitude * 100).toFixed(1)}pp sustained)</div>`,
      );
    } else if (ev.kind === "hold") {
      const name = ev.agent === 0 ? "follow" : "fade";
      feed(
        ev.reason === "no-edge"
          ? `<div class="ev hold"><b>${name}</b> holds: no outcome clears the ${Number(($("edge") as HTMLInputElement).value).toFixed(1)}% edge floor</div>`
          : `<div class="ev hold"><b>${name}</b> holds: stake sized to zero</div>`,
      );
    } else {
      const d = ev.decision;
      const name = d.agent === 0 ? "follow" : "fade";
      feed(
        `<div class="ev ${name}"><b>${name}</b> backs <b>${outcomeName(d.outcome)}</b> at ${d.entryOdds.toFixed(2)}
         · stake ${pts(d.stake)} pts · edge ${(d.edge * 100).toFixed(1)}%</div>`,
      );
    }
  }
  if (t.events.length > 0) renderBooks(t.books);
}

function settleNow(): void {
  done = true;
  if (!finalScore || !game || !analysis || !analysis.result) return;
  const winName = resultToOutcomeName(analysis.result);
  let rows = "";
  for (const d of analysis.decisions) {
    rows += `<tr><td class="agent-${d.agent === 0 ? "follow" : "fade"}">${d.agent === 0 ? "follow" : "fade"}</td>
      <td>${outcomeName(d.outcome)}</td><td class="odds">${d.entryOdds.toFixed(2)}</td>
      <td>${pts(d.stake)}</td><td><span class="${d.status}">${d.status.toUpperCase()}</span></td>
      <td>${pts(d.payout)}</td></tr>`;
  }
  renderBooks(analysis.books);
  const noTrades = analysis.decisions.length === 0;
  $("settle").innerHTML = `
    <div class="eyebrow">Settlement · regulation score</div>
    <div class="finalbox">FT ${finalScore.HomeScore}-${finalScore.AwayScore} · ${outcomeName(winName)} wins</div>
    ${noTrades
      ? `<p class="note">No steam cleared the threshold at these settings, so neither agent traded. Discipline is a feature: quiet markets stay quiet. Lower the threshold and replay to see what a twitchier detector would have done.</p>`
      : `<div class="tablewrap"><table><thead><tr><th>agent</th><th>backed</th><th>odds</th><th>stake</th><th>result</th><th>payout</th></tr></thead><tbody>${rows}</tbody></table></div>`}
  `;
}

let runState: any = null;
let apiAvailable = true;
let liveTimer: number | null = null;

function clearLive(): void {
  if (liveTimer !== null) window.clearInterval(liveTimer);
  liveTimer = null;
}

// Live view: no replay data exists yet, so everything renders from the
// chain-only /api/live-status probe, refreshed once a minute while the CLI
// live driver trades the match on season 777.
async function selectLiveGame(g: Game): Promise<void> {
  stop();
  clearLive();
  game = g;
  payloads = [];
  finalScore = null;
  analysis = null;
  done = true;
  renderRail();
  $("liveNote").textContent = "";
  $("feed").innerHTML = "";
  $("settle").innerHTML = "";
  $("legend").innerHTML = "";
  $("tape").innerHTML = "";
  $("books").innerHTML = "";
  renderBoard(null);
  $("matchline").innerHTML = `<span class="label">${g.home} vs ${g.away}</span>
    <span class="chip">${g.stage}</span><span class="chip">fixture ${g.id}</span>
    <span class="livechip">LIVE</span>`;
  updatePlayButton();
  const tick = () => refreshLive(g);
  await tick();
  liveTimer = window.setInterval(tick, 60_000);
}

async function refreshLive(g: Game): Promise<void> {
  if (game?.id !== g.id) return;
  let status: any = null;
  if (apiAvailable) {
    try {
      const res = await fetch(`/api/live-status?fixture=${g.id}`);
      if (res.ok && res.headers.get("content-type")?.includes("json")) status = await res.json();
      else if (!res.headers.get("content-type")?.includes("json")) apiAvailable = false;
    } catch {
      apiAvailable = false;
    }
  }
  if (game?.id !== g.id) return;
  renderLivePanel(g, status);
}

function renderLivePanel(g: Game, status: any): void {
  const el = $("chain");
  const kickoff = Date.parse(g.kickoff ?? "");
  const windowOpen = kickoff - 6 * 3600_000;
  const now = Date.now();
  const fmt = (t: number) => new Date(t).toUTCString().slice(0, 22) + " UTC";
  let phase: string;
  if (status?.matchState?.status === "settled") {
    phase = `Full time: ${g.home} ${status.matchState.homeScore}-${status.matchState.awayScore} ${g.away}. ` +
      `Settled on chain; every row below is a real devnet transaction the agent submitted during the live run.`;
  } else if (now < windowOpen) {
    phase = `Steam window opens ${fmt(windowOpen)} (kickoff ${fmt(kickoff)}). The agent starts watching the pre-match line then.`;
  } else if (now < kickoff) {
    phase = `The agent is watching the pre-match line right now. Positions appear below the moment steam fires; this page refreshes every minute.`;
  } else {
    phase = `Kickoff has passed; detection is pre-match only, so no new positions open. Open positions settle at full time.`;
  }
  const head = `<div class="eyebrow">Live · public devnet arena · season 777</div>`;
  if (!apiAvailable || !status || status.error) {
    el.innerHTML = `${head}<p class="note">${phase}</p>${apiAvailable ? "" : `<p class="note">On-chain status API not available on this host.</p>`}`;
    return;
  }
  const links = `Arena <a href="${EXPL(status.arena, "address")}" target="_blank" rel="noopener">${status.arena.slice(0, 8)}…</a>
    · Match <a href="${EXPL(status.match, "address")}" target="_blank" rel="noopener">${status.match.slice(0, 8)}…</a>
    · Books <a href="${EXPL(status.books[0].address, "address")}" target="_blank" rel="noopener">follow</a> /
    <a href="${EXPL(status.books[1].address, "address")}" target="_blank" rel="noopener">fade</a>`;
  const table = status.positions.length
    ? `<div class="tablewrap"><table><thead><tr><th>agent</th><th>backed</th><th>odds</th><th>stake</th><th>result</th><th>payout</th><th>solana tx</th></tr></thead><tbody>${positionRows(status.positions)}</tbody></table></div>`
    : `<p class="note">No positions on chain yet.</p>`;
  el.innerHTML = `${head}<p class="note">${phase} ${links}</p>${table}`;
}

function positionRows(list: any[]): string {
  return list
    .map(
      (p: any) => `<tr><td class="agent-${p.agent}">${p.agent}</td>
      <td>${outcomeName(p.outcome)}</td><td class="odds">${p.entryOdds.toFixed(2)}</td>
      <td>${pts(p.stake)}</td><td><span class="${p.status}">${p.status.toUpperCase()}</span></td>
      <td>${pts(p.payout)}</td>
      <td>${p.openTx ? `<a href="${EXPL(p.openTx)}" target="_blank" rel="noopener">open</a>` : "-"}${p.settleTx ? ` · <a href="${EXPL(p.settleTx)}" target="_blank" rel="noopener">settle</a>` : ""}</td></tr>`,
    )
    .join("");
}

async function fetchRunState(): Promise<void> {
  runState = null;
  if (!apiAvailable || !game) return;
  try {
    const res = await fetch(`/api/run?fixture=${game.id}`);
    if (res.status === 404 && !res.headers.get("content-type")?.includes("json")) {
      apiAvailable = false; // local static server without functions
      return;
    }
    runState = await res.json();
  } catch {
    apiAvailable = false;
  }
}

async function executeOnChain(): Promise<void> {
  if (!game) return;
  const btn = document.getElementById("runbtn") as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "submitting devnet transactions... (up to a minute)";
  }
  try {
    const res = await fetch(`/api/run?fixture=${game.id}`, { method: "POST" });
    runState = await res.json();
  } catch {
    if (btn) btn.textContent = "execution failed, try again";
  }
  renderChainPanel();
}

function renderBoard(tick: OddsTick | null): void {
  const names = ["1", "X", "2"];
  $("board").innerHTML = names
    .map((n) => {
      const oc = tick?.outcomes.find((o) => o.name === n);
      return `<div class="tile"><div class="tname">${outcomeName(n)}</div>
        <div class="todds">${oc ? oc.decimalOdds.toFixed(2) : "-.--"}</div>
        <div class="tprob">${oc ? (oc.fairProb * 100).toFixed(1) + "%" : ""}</div></div>`;
    })
    .join("");
}

function renderBooks(books: AgentState[]): void {
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
    const steamed = signalsSeen.length > 0 && signalsSeen[0].outcome === ["1", "X", "2"][k];
    const d = tape.map((p, i) => `${i ? "L" : "M"}${x(p.ts).toFixed(1)},${y(p.probs[k]).toFixed(1)}`).join("");
    paths += `<path d="${d}" fill="none" stroke="${colors[k]}" stroke-width="${steamed ? 2.4 : 1.1}" opacity="${steamed ? 1 : 0.6}"/>`;
  }
  let marks = "";
  signalsSeen.forEach((s, n) => {
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
  if (!game || !apiAvailable || !runState || runState.error) {
    el.innerHTML = apiAvailable ? "" : `<p class="note">On-chain execution API not available on this host.</p>`;
    return;
  }
  const head = `<div class="eyebrow">Public devnet arena · season ${runState.season}</div>`;
  const links = `Arena <a href="${EXPL(runState.arena, "address")}" target="_blank" rel="noopener">${runState.arena.slice(0, 8)}…</a>
    · Match <a href="${EXPL(runState.match, "address")}" target="_blank" rel="noopener">${runState.match.slice(0, 8)}…</a>
    · Books <a href="${EXPL(runState.books[0].address, "address")}" target="_blank" rel="noopener">follow</a> /
    <a href="${EXPL(runState.books[1].address, "address")}" target="_blank" rel="noopener">fade</a>`;
  if (runState.noSteam) {
    el.innerHTML = `${head}<p class="note">At the pinned calibration this game produces no signals, so there is
      nothing to trade on-chain. ${links}</p>`;
    return;
  }
  if (!runState.ran) {
    el.innerHTML = `${head}<p class="note">This game has not been executed on the public arena yet. Anyone can
      trigger its one canonical run (pinned calibration: ${runState.calibration.theta * 100}pp threshold,
      ${runState.calibration.edgeMin * 100}% edge floor). The button submits real devnet transactions signed by
      the arena's server-held keys. ${links}</p>
      <button id="runbtn" class="runbtn">Run this game on the devnet arena</button>`;
    document.getElementById("runbtn")?.addEventListener("click", executeOnChain);
    return;
  }
  const rows = positionRows(runState.positions);
  el.innerHTML = `${head}<p class="note">Executed on the public arena at the pinned calibration
    (${runState.calibration.theta * 100}pp / ${runState.calibration.edgeMin * 100}%). Every row is a real devnet
    transaction. ${links}</p>
    <div class="tablewrap"><table><thead><tr><th>agent</th><th>backed</th><th>odds</th><th>stake</th><th>result</th><th>payout</th><th>solana tx</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function feed(html: string): void {
  $("feed").insertAdjacentHTML("afterbegin", html);
}

function speedMs(): number {
  return Number(($("speed") as HTMLSelectElement).value);
}

function play(): void {
  if (timer !== null || done || game?.live) return;
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
  if (game?.live) return;
  stop();
  while (analysis && idx < analysis.trace.length) step();
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
