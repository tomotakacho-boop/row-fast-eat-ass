"use client";

import { useEffect, useMemo, useState } from "react";

export type ScenarioPlayer = {
  id: string;
  name: string;
  team: string;
  pos: string;
  rank: number;
  adp?: number | null;
  projectedPoints?: number | null;
  projectedPPG?: number | null;
  projectedGames?: number | null;
  availabilityMultiplier?: number | null;
};

export type ScenarioTeam = { team: string; manager?: string };
export type ScenarioKeeper = { team: string; round: number; playerId: string; confirmed?: boolean };

type ProjectedPick = {
  team: string;
  round: number;
  overall: number;
  livePick?: number;
  player?: ScenarioPlayer;
  source: "keeper" | "plan" | "pivot" | "cpu";
  requested?: ScenarioPlayer;
  confirmed?: boolean;
};

type Simulation = {
  picks: ProjectedPick[];
  rosters: Map<string, ScenarioPlayer[]>;
};

const cpuStyles = ["Balanced", "RB foundation", "WR pressure", "Tier hunter", "Late QB", "Upside", "Floor", "Anchor TE"];
const skillPositions = ["QB", "RB", "WR", "TE"];

function hash(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return (value >>> 0) / 4294967295;
}

function ppg(player: ScenarioPlayer) {
  return Number(player.projectedPPG ?? (player.projectedPoints == null ? 0 : player.projectedPoints / (player.projectedGames || 17)));
}

function marketRank(player: ScenarioPlayer) {
  if (player.adp == null) return player.rank;
  return player.rank * .6 + player.adp * .4;
}

function rosterCounts(roster: ScenarioPlayer[]) {
  return roster.reduce<Record<string, number>>((result, player) => ({ ...result, [player.pos]: (result[player.pos] || 0) + 1 }), {});
}

function playerImage(player: ScenarioPlayer) {
  return `https://images.fantasypros.com/images/players/nfl/${player.id}/headshot/210x210.png`;
}

function choosePlayer(players: ScenarioPlayer[], used: Set<string>, roster: ScenarioPlayer[], round: number, rounds: number, team: string, scenario: string, style: string, starters: Record<string, number>) {
  const counts = rosterCounts(roster);
  const coreNeeded = (starters.RB || 0) + (starters.WR || 0) + (starters.TE || 0) + (starters.FLEX || 0);
  const coreHave = (counts.RB || 0) + (counts.WR || 0) + (counts.TE || 0);
  const scenarioVariance = 3 + Math.max(0, scenario.charCodeAt(0) - 65) * 1.4;
  const candidates = players.filter((player) => {
    if (used.has(player.id) || (player.availabilityMultiplier ?? 1) <= .05 || ppg(player) <= 0) return false;
    if ((player.pos === "QB" || player.pos === "TE") && (counts[player.pos] || 0) >= 2) return false;
    if ((player.pos === "K" || player.pos === "DST") && (counts[player.pos] || 0) >= 1) return false;
    if ((player.pos === "K" || player.pos === "DST") && round < Math.max(10, rounds - 2)) return false;
    if ((player.pos === "RB" || player.pos === "WR") && (counts[player.pos] || 0) >= 8) return false;
    if (round <= 3 && (player.pos === "RB" || player.pos === "WR") && (counts[player.pos] || 0) >= 2) return false;
    if (round <= 5 && (player.pos === "QB" || player.pos === "TE") && (counts[player.pos] || 0) >= 1) return false;
    return true;
  });
  return candidates.map((player) => {
    let score = 500 - player.rank + ppg(player) * 1.8;
    if ((counts[player.pos] || 0) < (starters[player.pos] || 0)) score += player.pos === "QB" || player.pos === "TE" ? (round >= 7 ? 92 : 18) : 72;
    if (["RB", "WR", "TE"].includes(player.pos) && coreHave < coreNeeded) score += 30;
    if (round >= rounds - 2 && player.pos === "DST" && !(counts.DST || 0)) score += 220;
    if (round >= rounds - 1 && player.pos === "K" && !(counts.K || 0)) score += 240;
    if (style === "RB foundation" && player.pos === "RB") score += round <= 6 ? 34 : 8;
    if (style === "WR pressure" && player.pos === "WR") score += round <= 8 ? 32 : 8;
    if (style === "Late QB" && player.pos === "QB" && round <= 7) score -= 80;
    if (style === "Anchor TE" && player.pos === "TE" && !(counts.TE || 0) && round <= 6) score += 50;
    if (style === "Upside" && ["RB", "WR"].includes(player.pos)) score += ppg(player) * .8;
    if (style === "Floor" && player.adp != null) score -= Math.abs(player.rank - player.adp) * .18;
    score += (hash(`${scenario}-${team}-${round}-${player.id}`) - .5) * scenarioVariance;
    return { player, score };
  }).sort((a, b) => b.score - a.score)[0]?.player;
}

function simulateDraft({ players, teams, userTeam, rounds, activeKey, planIds, starters, keepers, byId }: {
  players: ScenarioPlayer[];
  teams: ScenarioTeam[];
  userTeam: string;
  rounds: number;
  activeKey: string;
  planIds: string[];
  starters: Record<string, number>;
  keepers: ScenarioKeeper[];
  byId: Map<string, ScenarioPlayer>;
}): Simulation {
  const used = new Set<string>();
  keepers.forEach((keeper) => used.add(keeper.playerId));
  const rosters = new Map(teams.map((team) => [team.team, [] as ScenarioPlayer[]]));
  const picks: ProjectedPick[] = [];
  let livePick = 0;
  for (let round = 1; round <= rounds; round += 1) {
    const draftingOrder = round % 2 ? teams : [...teams].reverse();
    for (let pickIndex = 0; pickIndex < draftingOrder.length; pickIndex += 1) {
      const team = draftingOrder[pickIndex];
      const originalSlot = teams.findIndex((entry) => entry.team === team.team) + 1;
      const overall = (round - 1) * teams.length + pickIndex + 1;
      const keeper = keepers.find((entry) => entry.team === team.team && entry.round === round);
      if (keeper) {
        const player = byId.get(keeper.playerId);
        if (player) rosters.get(team.team)?.push(player);
        picks.push({ team: team.team, round, overall, player, source: "keeper", confirmed: keeper.confirmed });
        continue;
      }
      livePick += 1;
      const roster = rosters.get(team.team) || [];
      const style = cpuStyles[(originalSlot + activeKey.charCodeAt(0)) % cpuStyles.length];
      const requested = team.team === userTeam ? byId.get(planIds[round - 1]) : undefined;
      const requestedAvailable = requested && !used.has(requested.id) && (requested.availabilityMultiplier ?? 1) > .05;
      const selected = requestedAvailable ? requested : choosePlayer(players, used, roster, round, rounds, team.team, activeKey, style, starters);
      if (selected) {
        used.add(selected.id);
        roster.push(selected);
      }
      picks.push({ team: team.team, round, overall, livePick, player: selected, source: team.team === userTeam ? requestedAvailable ? "plan" : "pivot" : "cpu", requested });
    }
  }
  return { picks, rosters };
}

function PlayerPortrait({ player }: { player: ScenarioPlayer }) {
  return <span className={`decision-player-photo pos-photo-${player.pos}`} style={{ backgroundImage: `url(${playerImage(player)})` }} role="img" aria-label={`${player.name} profile`}><i>{player.pos}</i></span>;
}

function DecisionOption({ player, label, selected, onClick }: { player: ScenarioPlayer; label: string; selected: boolean; onClick: () => void }) {
  return <button className={`decision-option ${selected ? "selected" : ""}`} onClick={onClick} aria-pressed={selected}><span className="decision-option-label">{label}</span><PlayerPortrait player={player}/><b>{player.name}</b><small>{player.team} · {player.pos} · model #{player.rank}</small><em>{ppg(player).toFixed(1)} PPG</em></button>;
}

export function ScenarioDraftBoard({ players, teams, userTeam, slot, rounds, activeKey, activeName, activeThesis, planIds, onTargetChange, starters, keepers = [], unavailableIds = [], likedIds = [], avoidIds = [] }: {
  players: ScenarioPlayer[];
  teams: ScenarioTeam[];
  userTeam: string;
  slot: number;
  rounds: number;
  activeKey: string;
  activeName: string;
  activeThesis: string;
  planIds: string[];
  onTargetChange: (roundIndex: number, playerId: string) => void;
  starters: Record<string, number>;
  keepers?: ScenarioKeeper[];
  unavailableIds?: string[];
  likedIds?: string[];
  avoidIds?: string[];
}) {
  const [editingRound, setEditingRound] = useState<number | null>(null);
  const [previewId, setPreviewId] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("ALL");
  const byId = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const unavailable = useMemo(() => new Set([...unavailableIds, ...keepers.map((keeper) => keeper.playerId)]), [unavailableIds, keepers]);
  const liked = useMemo(() => new Set(likedIds), [likedIds]);
  const avoided = useMemo(() => new Set(avoidIds), [avoidIds]);
  const simulation = useMemo(() => simulateDraft({ players, teams, userTeam, rounds, activeKey, planIds, starters, keepers, byId }), [players, teams, userTeam, rounds, activeKey, planIds, starters, keepers, byId]);
  const userPicks = simulation.picks.filter((pick) => pick.team === userTeam);
  const pivots = userPicks.filter((pick) => pick.source === "pivot" && pick.requested);
  const earlyOpponent = simulation.picks.filter((pick) => pick.team !== userTeam && pick.round <= 3 && pick.player);
  const earlyCounts = rosterCounts(earlyOpponent.flatMap((pick) => pick.player ? [pick.player] : []));

  const decision = useMemo(() => {
    if (editingRound == null) return null;
    const currentPick = userPicks.find((pick) => pick.round === editingRound);
    if (!currentPick) return null;
    const original = byId.get(planIds[editingRound - 1]) || currentPick.player;
    const takenBefore = new Set(simulation.picks.filter((pick) => pick.overall < currentPick.overall && pick.player).map((pick) => pick.player!.id));
    const rosterBefore = simulation.picks.filter((pick) => pick.team === userTeam && pick.round < editingRound && pick.player).map((pick) => pick.player!);
    const counts = rosterCounts(rosterBefore);
    const windowAfter = teams.length * (editingRound <= 2 ? 1.5 : 2.25);
    const maximumMarket = currentPick.overall + windowAfter;
    const eligible = players.filter((player) => {
      if (unavailable.has(player.id) || avoided.has(player.id) || takenBefore.has(player.id)) return false;
      if ((player.availabilityMultiplier ?? 1) <= .05 || ppg(player) <= 0) return false;
      if (marketRank(player) > maximumMarket) return false;
      if (!skillPositions.includes(player.pos) && editingRound < Math.max(10, rounds - 2)) return false;
      if ((player.pos === "QB" || player.pos === "TE") && editingRound <= 5 && (counts[player.pos] || 0) >= 1) return false;
      if ((player.pos === "RB" || player.pos === "WR") && editingRound <= 3 && (counts[player.pos] || 0) >= 2) return false;
      return true;
    }).map((player) => {
      const need = Math.max(0, (starters[player.pos] || 0) - (counts[player.pos] || 0));
      const coreNeed = ["RB", "WR", "TE"].includes(player.pos) && (counts.RB || 0) + (counts.WR || 0) + (counts.TE || 0) < (starters.RB || 0) + (starters.WR || 0) + (starters.TE || 0) + (starters.FLEX || 0);
      const value = player.adp == null ? 0 : Math.max(-15, Math.min(25, player.adp - player.rank));
      const timing = -Math.abs(marketRank(player) - currentPick.overall) * .14;
      const score = (220 - player.rank) + ppg(player) * 4 + need * 26 + (coreNeed ? 18 : 0) + value * .7 + timing + (liked.has(player.id) ? 16 : 0);
      return { player, score };
    }).sort((a, b) => b.score - a.score);
    const suggestions = eligible.filter(({ player }) => player.id !== original?.id).slice(0, 3).map(({ player }) => player);
    return { currentPick, original, eligible: eligible.map(({ player }) => player), suggestions, maximumMarket };
  }, [editingRound, userPicks, byId, planIds, simulation.picks, players, unavailable, avoided, teams.length, rounds, starters, liked, userTeam]);

  useEffect(() => {
    if (editingRound == null) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setEditingRound(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [editingRound]);

  const previewPlanIds = useMemo(() => {
    if (!decision || !previewId) return planIds;
    return planIds.map((id, index) => index === decision.currentPick.round - 1 ? previewId : id);
  }, [decision, previewId, planIds]);
  const previewSimulation = useMemo(() => decision && previewId ? simulateDraft({ players, teams, userTeam, rounds, activeKey, planIds: previewPlanIds, starters, keepers, byId }) : simulation, [decision, previewId, players, teams, userTeam, rounds, activeKey, previewPlanIds, starters, keepers, byId, simulation]);
  const selectedPreview = previewId ? byId.get(previewId) : decision?.original;
  const downstream = decision ? previewSimulation.picks.filter((pick) => pick.team === userTeam && pick.round > decision.currentPick.round).slice(0, 4) : [];
  const customCandidates = useMemo(() => {
    if (!decision) return [];
    const normalizedQuery = query.trim().toLowerCase();
    return decision.eligible.filter((player) => {
      if (position !== "ALL" && player.pos !== position) return false;
      return !normalizedQuery || `${player.name} ${player.team} ${player.pos}`.toLowerCase().includes(normalizedQuery);
    }).slice(0, 28);
  }, [decision, query, position]);
  const selectedIsSuggestion = Boolean(selectedPreview && decision?.suggestions.some((player) => player.id === selectedPreview.id));
  const selectedIsOriginal = Boolean(selectedPreview && decision?.original?.id === selectedPreview.id);
  const selectedIsCustom = Boolean(selectedPreview && !selectedIsSuggestion && !selectedIsOriginal);

  function openDecision(round: number) {
    const pick = userPicks.find((entry) => entry.round === round);
    const initial = planIds[round - 1] || pick?.player?.id || "";
    setEditingRound(round);
    setPreviewId(initial);
    setCustomOpen(false);
    setQuery("");
    setPosition("ALL");
  }

  function selectCandidate(id: string, custom = false) {
    setPreviewId(id);
    if (custom) setCustomOpen(true);
  }

  function applyDecision() {
    if (!decision || !selectedPreview) return;
    onTargetChange(decision.currentPick.round - 1, selectedPreview.id);
    setEditingRound(null);
  }

  return <section className="scenario-board-shell">
    <div className="active-plan-callout"><div><span>YOU ARE VIEWING PLAN</span><strong>{activeKey}</strong></div><div><h3>{activeName}</h3><p>{activeThesis}</p></div><div className="active-plan-pressure"><span>Slot #{slot} · opponent opening pressure</span><b>RB {earlyCounts.RB || 0} · WR {earlyCounts.WR || 0} · QB {earlyCounts.QB || 0} · TE {earlyCounts.TE || 0}</b><small>{pivots.length ? `${pivots.length} planned target${pivots.length === 1 ? "" : "s"} require a projected pivot` : "Every current target reaches your pick in this projection"}</small></div></div>
    <div className="plan-target-rail" aria-label={`Plan ${activeKey} round targets`}>{userPicks.map((pick) => <div className={`plan-target-card ${pick.source === "keeper" ? "keeper" : pick.source === "pivot" ? "pivot" : ""}`} key={pick.round}><span>R{pick.round}<small>#{pick.overall}</small></span>{pick.source === "keeper" ? <div className="locked-plan-target"><b>{pick.player?.name || "Keeper"}</b><small>Locked keeper</small></div> : <button className="plan-target-button" onClick={() => openDecision(pick.round)}><b>{byId.get(planIds[pick.round - 1])?.name || pick.player?.name || "Best logical pivot"}</b><small>Compare alternatives</small></button>}<em>{pick.source === "pivot" && pick.requested ? `${pick.requested.name} projected gone` : pick.source === "keeper" ? "Reserved draft slot" : pick.player ? `${pick.player.pos} · ${ppg(pick.player).toFixed(1)} PPG` : "Open"}</em></div>)}</div>

    <section className="mock-board-section scenario-full-board"><div className="mock-section-heading"><div><p className="eyebrow">PLAN {activeKey} · PROJECTED FULL DRAFT BOARD</p><h3>See the opponent picks that create each decision</h3></div><p>Changing a target reruns every CPU projection. A red pivot means another team is projected to take your selected target first.</p></div><div className="mock-board-wrap"><table className="mock-board"><thead><tr><th>Round</th>{teams.map((team, index) => <th className={team.team === userTeam ? "user-column" : ""} key={team.team}><b>#{index + 1} {team.team}</b><small>{team.team === userTeam ? "YOUR PLAN" : `${cpuStyles[(index + 1 + activeKey.charCodeAt(0)) % cpuStyles.length]} CPU`}</small></th>)}</tr></thead><tbody>{Array.from({ length: rounds }, (_, roundIndex) => {
      const round = roundIndex + 1;
      return <tr key={round}><th><b>R{round}</b></th>{teams.map((team) => {
        const pick = simulation.picks.find((entry) => entry.round === round && entry.team === team.team);
        return <td className={`${pick?.source || ""} ${team.team === userTeam ? "user-column" : ""}`} key={team.team}>{pick?.player ? <><b>{pick.player.name}</b><small>{pick.source === "keeper" ? `${pick.confirmed ? "CONFIRMED" : "PROJECTED"} KEEPER` : pick.source === "plan" ? `YOUR TARGET · #${pick.overall}` : pick.source === "pivot" ? `PIVOT · #${pick.overall}` : `CPU · #${pick.overall}`} · {pick.player.pos}</small>{pick.source === "pivot" && pick.requested && <em>{pick.requested.name} was gone</em>}</> : <><span>Open</span><small>#{pick?.overall}</small></>}</td>;
      })}</tr>;
    })}</tbody></table></div></section>

    {decision && <div className="decision-panel-scrim" onMouseDown={(event) => event.target === event.currentTarget && setEditingRound(null)}><section className="decision-panel" role="dialog" aria-modal="true" aria-labelledby="decision-panel-title">
      <header className="decision-panel-header"><div><p className="eyebrow">PLAN {activeKey} · ROUND {decision.currentPick.round} DECISION</p><h2 id="decision-panel-title">Compare realistic alternatives at pick #{decision.currentPick.overall}</h2><p>Keepers, unavailable players, Avoids, and players outside this round&apos;s realistic market window are removed.</p></div><button className="decision-close" onClick={() => setEditingRound(null)} aria-label="Close player comparison">×</button></header>
      <div className="decision-flow">
        {decision.original && <button className={`decision-current ${selectedIsOriginal ? "selected" : ""}`} onClick={() => selectCandidate(decision.original!.id)}><span>CURRENT TARGET</span><PlayerPortrait player={decision.original}/><b>{decision.original.name}</b><small>{decision.original.team} · {decision.original.pos} · {ppg(decision.original).toFixed(1)} PPG</small></button>}
        <div className="decision-arrow"><span>R{decision.currentPick.round}</span><b>{selectedPreview?.name || "Choose a player"}</b><i>→</i></div>
        <div className="decision-recommendations">{decision.suggestions.map((player, index) => <DecisionOption player={player} label={`SUGGESTION ${String.fromCharCode(65 + index)}`} selected={selectedPreview?.id === player.id} onClick={() => selectCandidate(player.id)} key={player.id}/>)}
          <button className={`decision-custom-option ${customOpen || selectedIsCustom ? "selected" : ""}`} onClick={() => setCustomOpen((current) => !current)}><span>OPTION D</span>{selectedIsCustom && selectedPreview && <PlayerPortrait player={selectedPreview}/>}<b>{selectedIsCustom ? selectedPreview?.name : "Pick your own player"}</b><small>Search the realistic round pool</small><em>{decision.eligible.length} eligible</em></button>
        </div>
      </div>

      {customOpen && <section className="decision-player-browser"><div className="decision-browser-tools"><label><span>SEARCH ELIGIBLE PLAYERS</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Type a player or team…"/></label><div className="decision-position-filter">{["ALL", "QB", "RB", "WR", "TE", "K", "DST"].map((item) => <button className={position === item ? "active" : ""} onClick={() => setPosition(item)} key={item}>{item}</button>)}</div></div><div className="decision-player-grid">{customCandidates.map((player) => <button className={selectedPreview?.id === player.id ? "selected" : ""} onClick={() => selectCandidate(player.id, true)} key={player.id}><PlayerPortrait player={player}/><span><b>{player.name}</b><small>{player.team} · {player.pos} · model #{player.rank} · ADP {player.adp?.toFixed(1) || "—"}</small></span><strong>{ppg(player).toFixed(1)}<small>PPG</small></strong></button>)}</div>{!customCandidates.length && <p className="decision-empty">No realistic players match this search and position filter.</p>}</section>}

      <section className="decision-path-preview"><div className="decision-path-heading"><div><p className="eyebrow">DYNAMIC DOWNSTREAM PATH</p><h3>{selectedPreview ? `If you select ${selectedPreview.name} in Round ${decision.currentPick.round}` : "Select an alternative to preview its path"}</h3></div>{selectedPreview && <div><span>{selectedPreview.pos}</span><b>{ppg(selectedPreview).toFixed(1)} PPG</b><small>Model #{selectedPreview.rank} · ADP {selectedPreview.adp?.toFixed(1) || "—"}</small></div>}</div><div className="decision-path-list">{downstream.map((pick, index) => <article className={pick.source} key={`${pick.round}-${index}`}><span>{index + 1}</span><div><small>NEXT DECISION · R{pick.round} / PICK #{pick.overall}</small><b>{pick.player?.name || "Open decision"}</b><p>{pick.source === "keeper" ? "Locked keeper slot remains unchanged." : pick.source === "pivot" && pick.requested ? `${pick.requested.name} is projected gone, so the model pivots to ${pick.player?.name || "the next logical option"}.` : `${pick.player?.pos || "Best player"} remains the projected target after the board reruns.`}</p></div><strong>{pick.player ? `${ppg(pick.player).toFixed(1)} PPG` : "—"}</strong></article>)}</div>{!downstream.length && <p className="decision-empty">This is the final round, so there are no downstream selections to project.</p>}</section>
      <footer className="decision-panel-footer"><button onClick={() => setEditingRound(null)}>Cancel</button><p>The full opponent board will rerun when you apply this choice.</p><button className="primary-action" disabled={!selectedPreview} onClick={applyDecision}>Use {selectedPreview?.name || "selected player"} for R{decision.currentPick.round}</button></footer>
    </section></div>}
  </section>;
}
