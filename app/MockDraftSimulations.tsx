"use client";

import { useEffect, useMemo, useState } from "react";
import { runMonteCarloDecision, type MonteCarloPlayer, type MonteCarloTeam } from "./monteCarloDraft";

type SimulationPlayer = MonteCarloPlayer & {
  team: string;
  posRank?: string | null;
  consensusRank?: number | null;
  availabilityMultiplier?: number | null;
};

type SimulationNote = { liked?: boolean; avoid?: boolean; diamond?: boolean; rookie?: boolean };

type RosterMetrics = {
  score: number;
  starterPPG: number;
  rosterPPG: number;
  value: number;
  construction: number;
  risk: number;
  positions: Record<string, number>;
};

type SimulatedRoster = RosterMetrics & {
  id: string;
  name: string;
  thesis: string;
  ids: string[];
  seed: number;
  source: "monte-carlo" | "custom";
  simulations: number;
};

const STORAGE_KEY = "league-b-roster-simulation-lab-v1";
const STARTERS: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DST: 1, K: 1 };
const MAXIMUMS: Record<string, number> = { QB: 4, RB: 8, WR: 8, TE: 3, DST: 3, K: 3 };
const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DST"];

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}

function playerPPG(player: SimulationPlayer) {
  return Number(player.projectedPPG ?? (player.projectedPoints == null ? 0 : player.projectedPoints / (player.projectedGames || 17)));
}

function marketRank(player: SimulationPlayer) {
  return player.adp == null ? player.rank : player.rank * .58 + player.adp * .42;
}

function pickForRound(round: number, slot: number, teamCount: number) {
  return round % 2 ? (round - 1) * teamCount + slot : round * teamCount - slot + 1;
}

function rosterCounts(roster: SimulationPlayer[]) {
  return roster.reduce<Record<string, number>>((counts, player) => {
    counts[player.pos] = (counts[player.pos] || 0) + 1;
    return counts;
  }, {});
}

function startingLineup(roster: SimulationPlayer[]) {
  const remaining = [...roster];
  const starters: SimulationPlayer[] = [];
  const take = (eligible: string[], total: number) => {
    for (let index = 0; index < total; index += 1) {
      const player = remaining.filter((entry) => eligible.includes(entry.pos)).sort((a, b) => playerPPG(b) - playerPPG(a))[0];
      if (!player) return;
      starters.push(player);
      remaining.splice(remaining.findIndex((entry) => entry.id === player.id), 1);
    }
  };
  take(["QB"], 1);
  take(["RB"], 2);
  take(["WR"], 2);
  take(["TE"], 1);
  take(["RB", "WR", "TE"], 1);
  take(["DST"], 1);
  take(["K"], 1);
  return starters;
}

function evaluateRoster(ids: string[], playersById: Map<string, SimulationPlayer>, slot: number, teamCount: number): RosterMetrics {
  const roster = ids.flatMap((id) => {
    const player = playersById.get(id);
    return player ? [player] : [];
  });
  const starters = startingLineup(roster);
  const positions = rosterCounts(roster);
  const required = ["QB", "RB", "WR", "TE", "DST", "K"].reduce((sum, position) => sum + Math.min(STARTERS[position] || 0, positions[position] || 0), 0);
  const flexReady = Math.min(1, Math.max(0, roster.filter((player) => ["RB", "WR", "TE"].includes(player.pos)).length - 5));
  const construction = clamp((required + flexReady) / 9 * 100);
  const starterPPG = starters.reduce((sum, player) => sum + playerPPG(player), 0);
  const rosterPPG = roster.reduce((sum, player) => sum + playerPPG(player), 0);
  const value = roster.length ? clamp(50 + roster.reduce((sum, player, index) => sum + clamp(pickForRound(index + 1, slot, teamCount) - marketRank(player), -25, 25), 0) / roster.length * 2) : 0;
  const risk = roster.length ? roster.reduce((sum, player) => sum + Math.max(0, 1 - (player.availabilityMultiplier ?? 1)) * 100, 0) / roster.length : 0;
  const score = clamp(clamp(starterPPG / 150 * 100) * .52 + clamp(rosterPPG / 245 * 100) * .13 + value * .17 + construction * .18 - risk * .08);
  return { score, starterPPG, rosterPPG, value, construction, risk, positions };
}

function rosterSignature(ids: string[]) {
  return ids.filter(Boolean).join("|");
}

function fmt(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

export function MockDraftSimulations({ players, notes, teams, userTeam, slot, rounds = 16, onOpen }: {
  players: SimulationPlayer[];
  notes: Record<string, SimulationNote>;
  teams: MonteCarloTeam[];
  userTeam: string;
  slot: number;
  rounds?: number;
  onOpen: (id: string) => void;
}) {
  const [rosters, setRosters] = useState<SimulatedRoster[]>([]);
  const [busy, setBusy] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [replace, setReplace] = useState<{ rosterId: string; roundIndex: number } | null>(null);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("ALL");
  const playersById = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && !cancelled) setRosters(JSON.parse(saved));
      } catch { /* A corrupt local cache should never block a fresh simulation. */ }
      if (!cancelled) setHasLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (hasLoaded) localStorage.setItem(STORAGE_KEY, JSON.stringify(rosters));
  }, [hasLoaded, rosters]);

  function runBatch(additional: boolean) {
    if (busy) return;
    setBusy(true);
    window.setTimeout(() => {
      const seed = (Date.now() + rosters.length * 104729) >>> 0;
      const openingCandidates = players
        .filter((player) => ["QB", "RB", "WR", "TE"].includes(player.pos))
        .filter((player) => playerPPG(player) > 0 && (player.availabilityMultiplier ?? 1) > .1 && !notes[player.id]?.avoid)
        .sort((a, b) => marketRank(a) - marketRank(b) || a.rank - b.rank)
        .slice(0, additional ? 22 : 18);
      const report = runMonteCarloDecision({
        players,
        candidates: openingCandidates,
        notes,
        teams,
        userTeam,
        slot,
        rounds,
        picks: [],
        decisionOverall: slot,
        positionMaximums: MAXIMUMS,
        simulationsPerCandidate: additional ? 54 : 84,
        seed,
      });
      const candidates = report.results.flatMap((result, index) => {
        const ids = result.mostLikelyPath.sort((a, b) => a.overall - b.overall).map((pick) => pick.playerId).slice(0, rounds);
        if (ids.length !== rounds || new Set(ids).size !== ids.length) return [];
        const metrics = evaluateRoster(ids, playersById, slot, teams.length);
        const opener = playersById.get(ids[0]);
        return [{
          id: `mc-${seed}-${index}`,
          name: opener ? `${opener.name} opening` : `Simulation ${index + 1}`,
          thesis: `Monte Carlo path from pick #${slot}; ${result.simulations} opponent-room outcomes modeled with roster constraints and current availability.`,
          ids,
          seed,
          source: "monte-carlo" as const,
          simulations: result.simulations,
          ...metrics,
        }];
      }).sort((a, b) => b.score - a.score || b.starterPPG - a.starterPPG);
      setRosters((current) => {
        const existing = additional ? current : [];
        const seen = new Set(existing.map((roster) => rosterSignature(roster.ids)));
        const wanted = additional ? 5 : 10;
        const fresh: SimulatedRoster[] = [];
        for (const candidate of candidates) {
          const signature = rosterSignature(candidate.ids);
          if (seen.has(signature)) continue;
          seen.add(signature);
          fresh.push(candidate);
          if (fresh.length === wanted) break;
        }
        return [...existing, ...fresh];
      });
      setBusy(false);
    }, 30);
  }

  function duplicate(roster: SimulatedRoster) {
    setRosters((current) => {
      const copyNumber = current.filter((entry) => entry.source === "custom").length + 1;
      const copy = { ...roster, id: `custom-${copyNumber}-${roster.id}`, name: `${roster.name} · custom copy`, source: "custom" as const };
      return [...current, copy];
    });
  }

  function replacePlayer(playerId: string) {
    if (!replace) return;
    setRosters((current) => current.map((roster) => {
      if (roster.id !== replace.rosterId) return roster;
      const ids = roster.ids.map((id, index) => index === replace.roundIndex ? playerId : id);
      return { ...roster, ids, source: "custom", name: roster.source === "custom" ? roster.name : `${roster.name} · edited`, ...evaluateRoster(ids, playersById, slot, teams.length) };
    }));
    setReplace(null);
    setSearch("");
    setPosition("ALL");
  }

  // The first ten cards remain the comparison baseline even after the user edits
  // one of them. Additional simulations and duplicated rosters are appended below.
  const baseline = rosters.slice(0, 10);
  const targetBoard = useMemo(() => Array.from({ length: rounds }, (_, roundIndex) => {
    const counts = new Map<string, number>();
    baseline.forEach((roster) => {
      const id = roster.ids[roundIndex];
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, count]) => ({ player: playersById.get(id), frequency: baseline.length ? count / baseline.length * 100 : 0 }));
  }), [baseline, playersById, rounds]);

  const replacementRoster = replace ? rosters.find((roster) => roster.id === replace.rosterId) : undefined;
  const replacementCurrent = replace && replacementRoster ? playersById.get(replacementRoster.ids[replace.roundIndex]) : undefined;
  const replacementPick = replace ? pickForRound(replace.roundIndex + 1, slot, teams.length) : 0;
  const alternativePlayers = replace && replacementRoster ? players
    .filter((player) => !replacementRoster.ids.includes(player.id) && (position === "ALL" || player.pos === position))
    .filter((player) => ["QB", "RB", "WR", "TE", "K", "DST"].includes(player.pos) && playerPPG(player) > 0 && (player.availabilityMultiplier ?? 1) > .05)
    .filter((player) => !search || `${player.name} ${player.team} ${player.pos}`.toLowerCase().includes(search.toLowerCase()))
    .filter((player) => {
      const round = replace.roundIndex + 1;
      if (["K", "DST"].includes(player.pos) && round < 13) return false;
      const window = round <= 3 ? 22 : round <= 8 ? 34 : 52;
      return Math.abs(marketRank(player) - replacementPick) <= window;
    })
    .sort((a, b) => {
      const aScore = playerPPG(a) * 4 - Math.abs(marketRank(a) - replacementPick) * .2 + (notes[a.id]?.liked ? 8 : 0) - (notes[a.id]?.avoid ? 25 : 0);
      const bScore = playerPPG(b) * 4 - Math.abs(marketRank(b) - replacementPick) * .2 + (notes[b.id]?.liked ? 8 : 0) - (notes[b.id]?.avoid ? 25 : 0);
      return bScore - aScore;
    }).slice(0, 36) : [];

  return <section className="workspace simulation-lab">
    <div className="simulation-hero">
      <div><p className="eyebrow">MONTE CARLO ROSTER LAB</p><h2>Best team builds from the fifth pick</h2><p>The computer drafts every opponent, tests practical choices at each of your sixteen turns, and ranks the strongest complete rosters. Nothing runs until you ask it to.</p></div>
      <div className="simulation-hero-metrics"><span><b>{rosters.length}</b><small>saved team builds</small></span><span><b>{baseline.length}</b><small>top baseline paths</small></span><span><b>#{slot}</b><small>confirmed slot</small></span></div>
      <button disabled={busy} onClick={() => runBatch(false)}>{busy ? "Running simulations…" : rosters.length ? "Rebuild top 10" : "Run top 10 simulations"}</button>
    </div>

    {baseline.length > 0 && <section className="simulation-targets"><header><div><p className="eyebrow">ACTUAL-DRAFT TARGET MAP</p><h3>What appears most often in the top ten</h3></div><p>Percentages are appearance rates across the current top ten, not guarantees that a player reaches your pick.</p></header><div>{targetBoard.map((targets, index) => <article key={index}><span>R{index + 1}<small>#{pickForRound(index + 1, slot, teams.length)}</small></span><div>{targets.length ? targets.map(({ player, frequency }) => player && <button key={player.id} onClick={() => onOpen(player.id)}><b>{player.name}</b><small>{player.pos} · {frequency.toFixed(0)}%</small></button>) : <em>No stable target</em>}</div></article>)}</div></section>}

    {!rosters.length ? <div className="simulation-empty"><strong>Ten high-difficulty draft rooms are ready.</strong><p>Run the model to compare complete roster outcomes—not individual mock-draft clicks—from your confirmed fifth slot.</p><button disabled={busy} onClick={() => runBatch(false)}>{busy ? "Building 10 teams…" : "Simulate the top 10 teams"}</button></div> : <>
      <div className="simulation-list-heading"><div><p className="eyebrow">RANKED TEAM BUILDS</p><h3>Top ten first, added and custom teams below</h3></div><button disabled={busy} onClick={() => runBatch(true)}>{busy ? "Simulating…" : "+ Add 5 more teams"}</button></div>
      <div className="simulation-roster-list">{rosters.map((roster, index) => <details open={index === 0} className={roster.source === "custom" ? "custom" : ""} key={roster.id}><summary><span>#{index + 1}<small>{roster.source === "custom" ? "CUSTOM" : "SIMULATED"}</small></span><div><b>{roster.name}</b><small>{roster.thesis}</small><em>{roster.ids.slice(0, 5).flatMap((id) => { const player = playersById.get(id); return player ? [player.name] : []; }).join(" · ")}</em></div><strong>{roster.score.toFixed(1)}<small>MODEL SCORE</small></strong></summary><div className="simulation-score-strip"><span><b>{roster.starterPPG.toFixed(1)}</b><small>STARTER PPG</small></span><span><b>{roster.rosterPPG.toFixed(1)}</b><small>ROSTER PPG</small></span><span><b>{roster.value.toFixed(0)}</b><small>DRAFT VALUE</small></span><span><b>{roster.construction.toFixed(0)}</b><small>BUILD</small></span><span><b>{roster.risk.toFixed(0)}</b><small>HEALTH RISK</small></span><span><b>{Object.entries(roster.positions).map(([pos, count]) => `${pos}${count}`).join(" · ")}</b><small>POSITION MIX</small></span></div><div className="simulation-roster-actions"><button onClick={() => duplicate(roster)}>Duplicate roster</button><span>Change any player below; edited builds are marked custom and rescored instantly.</span>{roster.source === "custom" && <button className="danger" onClick={() => setRosters((current) => current.filter((entry) => entry.id !== roster.id))}>Delete custom</button>}</div><div className="simulation-pick-grid">{roster.ids.map((id, roundIndex) => { const player = playersById.get(id); return <article key={`${id}-${roundIndex}`}><span>R{roundIndex + 1}<small>#{pickForRound(roundIndex + 1, slot, teams.length)}</small></span>{player ? <><button className="simulation-player" onClick={() => onOpen(player.id)}><i className={`pos pos-${player.pos}`}>{player.pos}</i><b>{player.name}</b><small>{player.team} · ADP {fmt(player.adp)} · {fmt(playerPPG(player))} PPG</small></button><button className="simulation-change" onClick={() => setReplace({ rosterId: roster.id, roundIndex })}>Change</button></> : <em>Open slot</em>}</article>; })}</div></details>)}</div>
    </>}

    {replace && replacementRoster && <div className="simulation-editor-scrim" onMouseDown={(event) => event.target === event.currentTarget && setReplace(null)}><aside className="simulation-editor"><header><div><p className="eyebrow">ROSTER EDITOR · ROUND {replace.roundIndex + 1}</p><h3>Replace {replacementCurrent?.name || "this player"}</h3><span>Practical options near pick #{replacementPick}; keepers and already-rostered players are excluded.</span></div><button onClick={() => setReplace(null)}>×</button></header><div className="simulation-editor-tools"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search practical alternatives…"/><div>{POSITIONS.map((pos) => <button className={position === pos ? "active" : ""} onClick={() => setPosition(pos)} key={pos}>{pos}</button>)}</div></div><div className="simulation-alternatives">{alternativePlayers.map((player) => <button className={notes[player.id]?.avoid ? "avoid" : notes[player.id]?.liked ? "liked" : ""} onClick={() => replacePlayer(player.id)} key={player.id}><span className={`pos pos-${player.pos}`}>{player.pos}</span><div><b>{player.name}</b><small>{player.team} · {player.posRank || ""}</small></div><strong>{fmt(playerPPG(player))}<small>PPG</small></strong><em>RK {player.rank} · ADP {fmt(player.adp)}</em></button>)}{!alternativePlayers.length && <p>No practical alternatives match these filters.</p>}</div></aside></div>}
  </section>;
}
