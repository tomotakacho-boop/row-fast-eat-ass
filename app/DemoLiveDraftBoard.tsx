"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { gradeCompletedDraft, runMonteCarloDecision, type DraftTeamGrade, type MonteCarloCandidateResult, type MonteCarloReport } from "./monteCarloDraft";
import { getPlayerResearch, isResearchTarget, researchPlayerAdjustment } from "./draftResearch";
import { isMockDraftHistoryEntry, mockDraftHistoryKey, type MockDraftHistoryEntry } from "./mockDraftHistory";
import { getPotentialDiamond } from "./potentialDiamonds";
import { getLeagueWinner } from "./leagueWinners";

export type LiveDraftPlayer = {
  id: string;
  name: string;
  team: string;
  pos: string;
  posRank: string | null;
  rank: number;
  adp: number | null;
  tier: number | null;
  projectedPoints: number | null;
  projectedPPG: number | null;
  projectedGames: number | null;
  rankStdDev: number | null;
  bestRank?: number | null;
  worstRank?: number | null;
  bye?: number | null;
  availabilityMultiplier?: number | null;
  injuryStatus?: string | null;
  injuryHeadline?: string | null;
  injuryRiskScore?: number | null;
  injuryRiskBand?: string | null;
  rookieRank?: number | null;
  dynastyRank?: number | null;
};

type LiveDraftNote = { liked?: boolean; avoid?: boolean; diamond?: boolean; rookie?: boolean };
type LiveDraftTeam = { team: string; manager?: string };
export type LivePick = { overall: number; playerId: string; team: string };
type PlannedPick = { overall: number; round: number; player: LiveDraftPlayer; reason: string };
type Route = {
  pos: string;
  candidate: LiveDraftPlayer;
  path: PlannedPick[];
  starterPPG: number;
  balance: number;
  value: number;
  survival: number;
  routeScore: number;
  monteCarlo?: MonteCarloCandidateResult;
};
type SortKey = "rank" | "name" | "pos" | "adp" | "delta" | "tier" | "projected" | "ppg" | "expert" | "confidence" | "injury" | "flag" | "survival";
type SortDirection = "asc" | "desc";
type ScenarioPreset = {
  id: string;
  label: string;
  phase: string;
  description: string;
  stopBefore: number;
  userStrategy: string[];
  lateRadar?: boolean;
};
type BoardMode = "live" | "mock";
type CpuArchetype = "Balanced" | "RB anchor" | "WR volume" | "Elite QB" | "Late QB" | "Anchor TE";
type StarterSlots = { QB: number; RB: number; WR: number; TE: number; FLEX: number; DST: number; K: number };
type PositionMaximums = Record<string, number>;

const LIVE_STORAGE_KEY = "league-b-demo-live-draft-v2";
const MOCK_STORAGE_KEY = "league-b-demo-mock-draft-v1";
const DEMO_OPENING = ["Ja'Marr Chase", "Jahmyr Gibbs", "Bijan Robinson", "Jaxon Smith-Njigba"];
const FILTER_POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DST"];
const DEFAULT_SCENARIO = "opening";
const EMPTY_LOCKED_PICKS: LivePick[] = [];
const DEFAULT_STARTER_SLOTS: StarterSlots = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DST: 1, K: 1 };
const DEFAULT_POSITION_MAXIMUMS: PositionMaximums = { QB: 4, RB: 8, WR: 8, TE: 3, K: 1, DST: 1 };
const SCENARIOS: ScenarioPreset[] = [
  { id: "start", label: "Start at #1", phase: "Opening", description: "Practice every announcement from the beginning of Round 1.", stopBefore: 1, userStrategy: [] },
  { id: "opening", label: "Your first pick", phase: "Opening", description: "Chase, Gibbs, Bijan, and JSN are gone; compare four realistic choices at #5.", stopBefore: 5, userStrategy: [] },
  { id: "r3-rbrb", label: "R3 · RB/RB", phase: "Round 3", description: "Two running backs are rostered. Test the WR pivot and positional opportunity cost.", stopBefore: 29, userStrategy: ["RB", "RB"] },
  { id: "r3-wrwr", label: "R3 · WR/WR", phase: "Round 3", description: "Two wide receivers are rostered. Compare the RB pocket against more receiving value.", stopBefore: 29, userStrategy: ["WR", "WR"] },
  { id: "r3-rbwr", label: "R3 · RB/WR", phase: "Round 3", description: "A balanced opening lets the board—not a forced position—drive pick #29.", stopBefore: 29, userStrategy: ["RB", "WR"] },
  { id: "qb-early", label: "Early QB", phase: "QB timing", description: "An elite quarterback was taken in Round 2. See how the skill-position path recovers.", stopBefore: 44, userStrategy: ["WR", "QB", "RB"] },
  { id: "qb-mid", label: "Mid QB", phase: "QB timing", description: "A Round 6 quarterback anchors a balanced build entering pick #92.", stopBefore: 92, userStrategy: ["RB", "WR", "WR", "RB", "TE", "QB", "RB"] },
  { id: "qb-late", label: "Late QB", phase: "QB timing", description: "Eight skill players are rostered without a quarterback. Decide whether to strike at pick #101.", stopBefore: 101, userStrategy: ["WR", "RB", "WR", "RB", "TE", "RB", "WR", "RB"] },
  { id: "late-upside", label: "Late upside", phase: "Rounds 13–16", description: "Core starters are built. Hunt diamonds, rookies, sleepers, and injury stashes.", stopBefore: 149, userStrategy: ["WR", "RB", "WR", "RB", "TE", "QB", "RB", "WR", "RB", "WR", "RB", "WR"], lateRadar: true },
];

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}

function fmt(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function playerPPG(player: LiveDraftPlayer) {
  return player.projectedPPG ?? (player.projectedPoints == null ? 0 : player.projectedPoints / (player.projectedGames || 17));
}

function marketRank(player: LiveDraftPlayer) {
  return player.adp == null ? player.rank : player.rank * .58 + player.adp * .42;
}

function confidence(player: LiveDraftPlayer) {
  return clamp(100 - (player.rankStdDev || 24) * 2);
}

function roundForPick(overall: number, teamCount: number) {
  return Math.floor((overall - 1) / teamCount) + 1;
}

function teamAtPick(overall: number, teams: LiveDraftTeam[]) {
  const round = roundForPick(overall, teams.length);
  const withinRound = (overall - 1) % teams.length;
  const index = round % 2 ? withinRound : teams.length - 1 - withinRound;
  return teams[index];
}

function userPickNumbers(slot: number, teamCount: number, rounds: number) {
  return Array.from({ length: rounds }, (_, index) => {
    const round = index + 1;
    return round % 2 ? (round - 1) * teamCount + slot : round * teamCount - slot + 1;
  });
}

function rosterCounts(roster: LiveDraftPlayer[]) {
  return roster.reduce<Record<string, number>>((counts, player) => {
    counts[player.pos] = (counts[player.pos] || 0) + 1;
    return counts;
  }, {});
}

function survivalChance(player: LiveDraftPlayer, overall: number) {
  return clamp(100 / (1 + Math.exp((overall - marketRank(player)) / 4.5)));
}

function preferenceClass(note: LiveDraftNote | undefined, player: LiveDraftPlayer) {
  if (note?.avoid) return "player-flag-avoid";
  if (getLeagueWinner(player.name)) return "player-flag-league-winner";
  if (note?.diamond || getPotentialDiamond(player.name)) return "player-flag-diamond";
  if (note?.liked) return "player-flag-like";
  if (note?.rookie || player.rookieRank) return "player-flag-rookie";
  if (getPlayerResearch(player.name)) return "player-research-row";
  return "";
}

function preferenceLabel(note: LiveDraftNote | undefined, player: LiveDraftPlayer) {
  if (note?.avoid) return "Avoid";
  if (getLeagueWinner(player.name)) return "League winner";
  if (note?.diamond || getPotentialDiamond(player.name)) return "Diamond";
  if (note?.liked) return "Like";
  if (note?.rookie || player.rookieRank) return "Rookie";
  if (getPlayerResearch(player.name)) return "Research";
  return "—";
}

function positionNeed(player: LiveDraftPlayer, roster: LiveDraftPlayer[], round: number) {
  const counts = rosterCounts(roster);
  const starterTargets: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 };
  const missing = Math.max(0, (starterTargets[player.pos] || 0) - (counts[player.pos] || 0));
  let score = missing * 30;
  if (["RB", "WR"].includes(player.pos) && (counts.RB || 0) + (counts.WR || 0) < 5) score += 16;
  if (player.pos === "QB" && round < 4) score -= 20;
  if (player.pos === "TE" && round < 4) score -= 12;
  if (["K", "DST"].includes(player.pos) && round < 14) score -= 200;
  return score;
}

function candidateScore(player: LiveDraftPlayer, roster: LiveDraftPlayer[], notes: Record<string, LiveDraftNote>, overall: number, teamCount: number, exactTurn: boolean) {
  const round = roundForPick(overall, teamCount);
  const note = notes[player.id];
  const value = player.adp == null ? 0 : (player.adp - player.rank) * .6;
  const availability = exactTurn ? 0 : survivalChance(player, overall) * .18;
  const healthAdjustment = -Math.max(0, 1 - (player.availabilityMultiplier ?? 1)) * 250;
  const research = researchPlayerAdjustment(player.name, round, 16, "league-b");
  const diamond = (note?.diamond || getPotentialDiamond(player.name)) && round >= 10 ? 12 : 0;
  const leagueWinner = getLeagueWinner(player.name) ? 8 : 0;
  return 310 - player.rank + playerPPG(player) * 5 + positionNeed(player, roster, round) + value + availability + healthAdjustment + research + diamond + leagueWinner + (note?.liked ? 15 : 0) - (note?.avoid ? 38 : 0);
}

function canDraft(player: LiveDraftPlayer, roster: LiveDraftPlayer[], round: number, rounds = 16, maximums: PositionMaximums = DEFAULT_POSITION_MAXIMUMS) {
  const counts = rosterCounts(roster);
  if ((counts[player.pos] || 0) >= (maximums[player.pos] || rounds)) return false;
  if (["K", "DST"].includes(player.pos) && round < Math.max(1, rounds - 1)) return false;
  if (round <= 3 && ["RB", "WR"].includes(player.pos) && (counts[player.pos] || 0) >= 2) return false;
  if (round <= 5 && ["QB", "TE"].includes(player.pos) && (counts[player.pos] || 0) >= 1) return false;
  return true;
}

function planReason(player: LiveDraftPlayer, roster: LiveDraftPlayer[], note: LiveDraftNote | undefined, round: number) {
  const counts = rosterCounts(roster);
  const needs: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 };
  if ((counts[player.pos] || 0) < (needs[player.pos] || 0)) return `Fills starting ${player.pos}`;
  if (note?.liked) return "Like-list priority";
  if (getLeagueWinner(player.name)) return "Source-tagged league-winner upside at this price";
  if ((note?.diamond || getPotentialDiamond(player.name)) && round >= 10) return "Potential future keeper surplus";
  if (isResearchTarget(player.name, "league-b")) return "Public-research format fit";
  if (player.adp != null && player.adp - player.rank >= 8) return "Value versus ADP";
  if (round >= 14 && ["K", "DST"].includes(player.pos)) return `Completes ${player.pos}`;
  return "Best logical roster fit";
}

function chooseForPick(
  pool: LiveDraftPlayer[],
  roster: LiveDraftPlayer[],
  notes: Record<string, LiveDraftNote>,
  overall: number,
  teamCount: number,
  exactTurn: boolean,
  forcedPosition?: string,
  rounds = 16,
  maximums: PositionMaximums = DEFAULT_POSITION_MAXIMUMS,
) {
  const round = roundForPick(overall, teamCount);
  const counts = rosterCounts(roster);
  let candidates = pool.filter((player) => (!forcedPosition || player.pos === forcedPosition) && canDraft(player, roster, round, rounds, maximums));
  if (!exactTurn) {
    const tolerance = round <= 3 ? 4 : Math.max(5, Math.round(teamCount * .5));
    const plausible = candidates.filter((player) => marketRank(player) >= overall - tolerance);
    if (plausible.length) candidates = plausible;
  }
  if (round >= 10 && !(counts.QB || 0)) candidates = candidates.filter((player) => player.pos === "QB");
  else if (round >= 11 && !(counts.TE || 0)) candidates = candidates.filter((player) => player.pos === "TE");
  else if (round >= rounds - 1 && !(counts.DST || 0)) candidates = candidates.filter((player) => player.pos === "DST");
  else if (round >= rounds && !(counts.K || 0)) candidates = candidates.filter((player) => player.pos === "K");
  return [...candidates].sort((a, b) => candidateScore(b, roster, notes, overall, teamCount, exactTurn) - candidateScore(a, roster, notes, overall, teamCount, exactTurn))[0];
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function cpuArchetype(team: string): CpuArchetype {
  const profiles: CpuArchetype[] = ["Balanced", "RB anchor", "WR volume", "Elite QB", "Late QB", "Anchor TE"];
  return profiles[stableHash(team) % profiles.length];
}

function chooseHardCpu(
  pool: LiveDraftPlayer[],
  roster: LiveDraftPlayer[],
  overall: number,
  teamCount: number,
  team: string,
  rounds = 16,
  maximums: PositionMaximums = DEFAULT_POSITION_MAXIMUMS,
) {
  const round = roundForPick(overall, teamCount);
  const counts = rosterCounts(roster);
  const profile = cpuArchetype(team);
  let candidates = pool.filter((player) => canDraft(player, roster, round, rounds, maximums));
  if (round >= 9 && !(counts.QB || 0)) candidates = candidates.filter((player) => player.pos === "QB");
  else if (round >= 10 && !(counts.TE || 0)) candidates = candidates.filter((player) => player.pos === "TE");
  else if (round >= rounds - 1 && !(counts.DST || 0)) candidates = candidates.filter((player) => player.pos === "DST");
  else if (round >= rounds && !(counts.K || 0)) candidates = candidates.filter((player) => player.pos === "K");

  const scored = candidates.map((player) => {
    let score = candidateScore(player, roster, {}, overall, teamCount, true) + confidence(player) * .22;
    if (profile === "RB anchor" && player.pos === "RB" && (counts.RB || 0) < 2) score += round <= 5 ? 18 : 6;
    if (profile === "WR volume" && player.pos === "WR" && (counts.WR || 0) < 3) score += round <= 7 ? 17 : 5;
    if (profile === "Elite QB" && player.pos === "QB" && !(counts.QB || 0) && round <= 5) score += 22;
    if (profile === "Late QB" && player.pos === "QB" && round <= 7) score -= 38;
    if (profile === "Anchor TE" && player.pos === "TE" && !(counts.TE || 0) && round <= 6) score += 20;
    const controlledVariation = (stableHash(`${team}-${overall}-${player.id}`) % 1000) / 1000 * 7;
    return { player, score: score + controlledVariation };
  }).sort((a, b) => b.score - a.score || a.player.rank - b.player.rank);

  return scored[0]?.player;
}

function makeScenarioPicks(players: LiveDraftPlayer[], teams: LiveDraftTeam[], userTeam: string, preset: ScenarioPreset, hardCpu = false, lockedPicks: LivePick[] = [], rounds = 16, maximums: PositionMaximums = DEFAULT_POSITION_MAXIMUMS) {
  const lockedOverall = new Set(lockedPicks.map((pick) => pick.overall));
  const lockedIds = new Set(lockedPicks.map((pick) => pick.playerId));
  if (preset.id === "start") return [];
  const picks: LivePick[] = [];
  const drafted = new Set<string>(lockedIds);
  const rosters = new Map<string, LiveDraftPlayer[]>();
  lockedPicks.forEach((pick) => {
    const player = players.find((item) => item.id === pick.playerId);
    if (player) rosters.set(pick.team, [...(rosters.get(pick.team) || []), player]);
  });
  for (let overall = 1; overall < preset.stopBefore; overall += 1) {
    if (lockedOverall.has(overall)) continue;
    const owner = teamAtPick(overall, teams);
    const roster = rosters.get(owner.team) || [];
    const round = roundForPick(overall, teams.length);
    const pool = players.filter((player) => !drafted.has(player.id) && (player.availabilityMultiplier ?? 1) > .05);
    const forcedPosition = owner.team === userTeam ? preset.userStrategy[round - 1] : undefined;
    const preferredOpening = preset.id === "opening" ? players.find((player) => player.name === DEMO_OPENING[overall - 1] && !drafted.has(player.id)) : undefined;
    const selected = preferredOpening || (owner.team !== userTeam && hardCpu
      ? chooseHardCpu(pool, roster, overall, teams.length, owner.team, rounds, maximums)
      : chooseForPick(pool, roster, {}, overall, teams.length, true, forcedPosition, rounds, maximums) || chooseForPick(pool, roster, {}, overall, teams.length, true, undefined, rounds, maximums));
    if (!selected) break;
    picks.push({ overall, playerId: selected.id, team: owner.team });
    drafted.add(selected.id);
    rosters.set(owner.team, [...roster, selected]);
  }
  return picks;
}

function buildPath(
  first: LiveDraftPlayer,
  firstOverall: number,
  players: LiveDraftPlayer[],
  actualRoster: LiveDraftPlayer[],
  draftedIds: Set<string>,
  notes: Record<string, LiveDraftNote>,
  slot: number,
  teamCount: number,
  rounds: number,
  lockedOverall: Set<number>,
  maximums: PositionMaximums,
) {
  const used = new Set(draftedIds);
  const roster = [...actualRoster];
  const path: PlannedPick[] = [];
  const pickNumbers = userPickNumbers(slot, teamCount, rounds).filter((pick) => pick >= firstOverall && !lockedOverall.has(pick));
  for (const overall of pickNumbers) {
    const round = roundForPick(overall, teamCount);
    const available = players.filter((player) => !used.has(player.id) && (player.availabilityMultiplier ?? 1) > .05);
    const selected = overall === firstOverall && !used.has(first.id)
      ? first
      : chooseForPick(available, roster, notes, overall, teamCount, false, undefined, rounds, maximums);
    if (!selected) continue;
    path.push({ overall, round, player: selected, reason: overall === firstOverall ? "Decision fork" : planReason(selected, roster, notes[selected.id], round) });
    roster.push(selected);
    used.add(selected.id);
  }
  return path;
}

function startingPPG(roster: LiveDraftPlayer[], starterSlots: StarterSlots = DEFAULT_STARTER_SLOTS) {
  const remaining = [...roster];
  const take = (positions: string[]) => {
    const selected = remaining.filter((player) => positions.includes(player.pos)).sort((a, b) => playerPPG(b) - playerPPG(a))[0];
    if (selected) remaining.splice(remaining.findIndex((player) => player.id === selected.id), 1);
    return selected ? playerPPG(selected) : 0;
  };
  let total = 0;
  for (let index = 0; index < starterSlots.QB; index += 1) total += take(["QB"]);
  for (let index = 0; index < starterSlots.RB; index += 1) total += take(["RB"]);
  for (let index = 0; index < starterSlots.WR; index += 1) total += take(["WR"]);
  for (let index = 0; index < starterSlots.TE; index += 1) total += take(["TE"]);
  for (let index = 0; index < starterSlots.FLEX; index += 1) total += take(["RB", "WR", "TE"]);
  for (let index = 0; index < starterSlots.DST; index += 1) total += take(["DST"]);
  for (let index = 0; index < starterSlots.K; index += 1) total += take(["K"]);
  return total;
}

function constructionScore(roster: LiveDraftPlayer[]) {
  const counts = rosterCounts(roster);
  const targets: Record<string, number> = { QB: 1, RB: 4, WR: 4, TE: 1, K: 1, DST: 1 };
  const filled = Object.entries(targets).reduce((sum, [pos, target]) => sum + Math.min(counts[pos] || 0, target), 0);
  return clamp(filled / Object.values(targets).reduce((sum, value) => sum + value, 0) * 100);
}

function practicalCandidates(
  available: LiveDraftPlayer[],
  roster: LiveDraftPlayer[],
  notes: Record<string, LiveDraftNote>,
  decisionOverall: number,
  teamCount: number,
  rounds: number,
  maximums: PositionMaximums,
) {
  const round = roundForPick(decisionOverall, teamCount);
  const reachAllowance = round <= 2 ? 8 : round <= 5 ? 14 : round <= 9 ? 22 : 34;
  const ranked = available.filter((player) => canDraft(player, roster, round, rounds, maximums)).map((player) => {
    const needWeight = round <= 2 ? 0 : round <= 6 ? .08 : .14;
    const healthPenalty = Math.max(0, 1 - (player.availabilityMultiplier ?? 1)) * 16;
    const avoidPenalty = notes[player.id]?.avoid ? 2.5 : 0;
    return {
      player,
      practicalRank: marketRank(player) - Math.max(0, positionNeed(player, roster, round)) * needWeight + healthPenalty + avoidPenalty,
    };
  }).sort((a, b) => a.practicalRank - b.practicalRank || a.player.rank - b.player.rank);
  if (!ranked.length) return [];
  const bestMarket = marketRank(ranked[0].player);
  const plausible = ranked.filter(({ player }) => marketRank(player) <= Math.max(decisionOverall + reachAllowance, bestMarket + reachAllowance));
  const pool = plausible.length >= 4 ? plausible : ranked.slice(0, 8);
  const firstThree = pool.slice(0, 3);
  const positions = new Set(firstThree.map(({ player }) => player.pos));
  const fourth = positions.size === 1
    ? pool.slice(3).find(({ player }) => !positions.has(player.pos)) || pool[3]
    : pool[3];
  return [...firstThree, ...(fourth ? [fourth] : [])].map(({ player }) => player);
}

function routeFor(
  candidate: LiveDraftPlayer,
  decisionOverall: number,
  exactTurn: boolean,
  players: LiveDraftPlayer[],
  actualRoster: LiveDraftPlayer[],
  draftedIds: Set<string>,
  notes: Record<string, LiveDraftNote>,
  slot: number,
  teamCount: number,
  rounds: number,
  lockedOverall: Set<number>,
  starterSlots: StarterSlots,
  maximums: PositionMaximums,
): Route | null {
  const path = buildPath(candidate, decisionOverall, players, actualRoster, draftedIds, notes, slot, teamCount, rounds, lockedOverall, maximums);
  const projectedRoster = [...actualRoster, ...path.map((pick) => pick.player)];
  const value = clamp(55 + path.reduce((sum, pick) => sum + ((pick.player.adp ?? pick.player.rank) - pick.overall), 0) / Math.max(1, path.length) * 1.4);
  const starter = startingPPG(projectedRoster, starterSlots);
  const balance = constructionScore(projectedRoster);
  return {
    pos: candidate.pos,
    candidate,
    path,
    starterPPG: starter,
    balance,
    value,
    survival: exactTurn ? 100 : survivalChance(candidate, decisionOverall),
    routeScore: candidateScore(candidate, actualRoster, notes, decisionOverall, teamCount, exactTurn) + starter * .1 + balance * .05,
  };
}

function playerImage(player: LiveDraftPlayer) {
  return `https://images.fantasypros.com/images/players/nfl/${player.id}/headshot/210x210.png`;
}

function PlayerPhoto({ player }: { player: LiveDraftPlayer }) {
  return <span className={`live-player-photo pos-photo-${player.pos}`} style={{ backgroundImage: `url(${playerImage(player)})` }} role="img" aria-label={`${player.name} profile`}><i>{player.pos}</i></span>;
}

function gradeLetter(score: number) {
  if (score >= 93) return "A";
  if (score >= 90) return "A−";
  if (score >= 87) return "B+";
  if (score >= 83) return "B";
  if (score >= 80) return "B−";
  if (score >= 77) return "C+";
  if (score >= 73) return "C";
  if (score >= 70) return "C−";
  if (score >= 65) return "D";
  return "F";
}

function MockDraftResults({ grades, userTeam }: { grades: DraftTeamGrade[]; userTeam: string }) {
  const mine = grades.find((team) => team.team === userTeam);
  return <section className="live-mock-results">
    <header><div><p className="eyebrow">POST-DRAFT REPORT CARD</p><h2>{mine ? `${mine.team}: ${mine.grade.toFixed(1)} / 100 · #${mine.rank} of ${grades.length}` : "Every roster graded and ranked"}</h2><p>The report uses the same full-PPR projections and replacement levels as the Monte Carlo engine. Expand any team to inspect every selection.</p></div>{mine && <div className="live-final-grade"><span>{gradeLetter(mine.grade)}</span><strong>{mine.grade.toFixed(1)}</strong><small>LEAGUE RANK #{mine.rank}</small></div>}</header>
    <div className="live-grade-key"><span><b>48%</b> optimized starters</span><span><b>17%</b> playable depth</span><span><b>22%</b> acquisition value</span><span><b>13%</b> construction</span><span><b>25%</b> league-relative curve</span></div>
    <div className="live-grade-list"><div className="live-grade-columns"><span>RK</span><span>TEAM</span><span>GRADE</span><span>START PPG</span><span>LINEUP</span><span>DEPTH</span><span>VALUE</span><span>BUILD</span></div>{grades.map((team) => <details className={team.team === userTeam ? "mine" : ""} key={team.team} open={team.team === userTeam}><summary><span>#{team.rank}</span><span><b>{team.team}</b><small>{team.manager || "Manager"}</small></span><span><strong>{gradeLetter(team.grade)} · {team.grade.toFixed(1)}</strong><i><em style={{ width: `${team.grade}%` }}/></i></span><span>{team.starterPPG.toFixed(1)}</span><span>{team.lineupScore.toFixed(0)}</span><span>{team.depthScore.toFixed(0)}</span><span>{team.valueScore.toFixed(0)}</span><span>{team.constructionScore.toFixed(0)}</span></summary><div className="live-grade-roster">{team.roster.slice().sort((a, b) => a.overall - b.overall).map(({ overall, player }) => <article key={`${team.team}-${player.id}`}><span>R{roundForPick(overall, grades.length)} · #{overall}</span><i className={`pos pos-${player.pos}`}>{player.pos}</i><div><b>{player.name}</b><small>{fmt(player.projectedPPG ?? (player.projectedPoints == null ? null : player.projectedPoints / (player.projectedGames || 17)))} PPG · model #{player.rank}</small></div></article>)}</div></details>)}</div>
  </section>;
}

function MockDraftHistory({ history, playersById, userTeam, leagueId }: { history: MockDraftHistoryEntry[]; playersById: Map<string, LiveDraftPlayer>; userTeam: string; leagueId: string }) {
  return <section className="live-mock-history">
    <header><div><p className="eyebrow">MOCK DRAFT HISTORY</p><h2>Your completed hard-mode rooms</h2><p>Each result keeps its original score and picks. Open one to inspect the complete roster and every team grade.</p></div><strong>{history.length}<small>SAVED MOCKS</small></strong></header>
    {history.length ? <div className="live-history-grid">{history.map((entry) => {
      const mine = entry.grades.find((grade) => grade.team === userTeam);
      const topPlayers = entry.topPlayerIds.flatMap((id) => {
        const player = playersById.get(id);
        return player ? [player] : [];
      });
      return <article key={entry.id}>
        <div className="live-history-grade"><span>{mine ? gradeLetter(mine.grade) : "—"}</span><strong>{mine?.grade.toFixed(1) || "—"}</strong><small>{mine ? `#${mine.rank} OF ${entry.teamCount}` : "UNRANKED"}</small></div>
        <div className="live-history-summary"><span>{new Date(entry.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span><h3>{entry.scenarioLabel}</h3><p>Top five by live league model</p><div>{topPlayers.map((player, index) => <b key={player.id}><i>{index + 1}</i>{player.name}<small>{player.pos} · model #{player.rank}</small></b>)}</div></div>
        <a href={`/mock-history/?league=${encodeURIComponent(leagueId)}&id=${encodeURIComponent(entry.id)}`}>View full draft <span>→</span></a>
      </article>;
    })}</div> : <div className="live-history-empty"><strong>No completed mocks yet.</strong><p>Finish a mock manually or use Simulate rest of draft. The report will be saved here automatically.</p></div>}
    <p className="live-history-storage-note">History is stored in this browser so your private draft practice stays on this device.</p>
  </section>;
}

type DraftBoardProps = {
  players: LiveDraftPlayer[];
  notes: Record<string, LiveDraftNote>;
  teams: LiveDraftTeam[];
  userTeam: string;
  slot: number;
  rounds: number;
  onOpen: (id: string) => void;
  leagueId?: "nyfl" | "league-b" | "league-c" | "league-d" | "league-e";
  leagueName?: string;
  lockedPicks?: LivePick[];
  starterSlots?: StarterSlots;
  positionMaximums?: PositionMaximums;
  onDraftStateChange?: (draftedPlayerIds: string[]) => void;
};

export function DemoLiveDraftBoard({ players, notes, teams, userTeam, slot, rounds, onOpen, leagueId = "league-b", leagueName = "Row Fast Eat Ass Season 10", lockedPicks = EMPTY_LOCKED_PICKS, starterSlots = DEFAULT_STARTER_SLOTS, positionMaximums = DEFAULT_POSITION_MAXIMUMS, onDraftStateChange, mode = "live" }: DraftBoardProps & { mode?: BoardMode }) {
  const [picks, setPicks] = useState<LivePick[]>([]);
  const [ready, setReady] = useState(false);
  const [draftMode, setDraftMode] = useState<"auto" | "manual">("auto");
  const [cpuAuto, setCpuAuto] = useState(true);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("ALL");
  const [flag, setFlag] = useState("ALL");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [activeScenario, setActiveScenario] = useState(DEFAULT_SCENARIO);
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [monteCarlo, setMonteCarlo] = useState<MonteCarloReport | null>(null);
  const [monteCarloRun, setMonteCarloRun] = useState(0);
  const [simulationRequested, setSimulationRequested] = useState(false);
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [mockHistory, setMockHistory] = useState<MockDraftHistoryEntry[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const initialized = useRef(false);
  const isMock = mode === "mock";
  const storageVersion = leagueId === "league-c" ? "v3" : "v1";
  const storageKey = leagueId === "league-b" ? (isMock ? MOCK_STORAGE_KEY : LIVE_STORAGE_KEY) : `${leagueId}-${isMock ? "demo-mock" : "demo-live"}-draft-${storageVersion}`;
  const historyKey = mockDraftHistoryKey(leagueId);
  const teamCount = teams.length;
  const scheduledPicks = teamCount * rounds;
  const validLockedPicks = useMemo(() => lockedPicks.filter((pick) => pick.overall >= 1 && pick.overall <= scheduledPicks && players.some((player) => player.id === pick.playerId)), [lockedPicks, players, scheduledPicks]);
  const lockedOverall = useMemo(() => new Set(validLockedPicks.map((pick) => pick.overall)), [validLockedPicks]);
  const openSchedule = useMemo(() => Array.from({ length: scheduledPicks }, (_, index) => index + 1).filter((overall) => !lockedOverall.has(overall)), [lockedOverall, scheduledPicks]);
  const totalPicks = openSchedule.length;

  useEffect(() => {
    if (initialized.current || !players.length || !teams.length) return;
    initialized.current = true;
    Promise.resolve().then(() => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as { picks?: LivePick[]; activeScenario?: string; draftMode?: "auto" | "manual" };
          const ids = new Set(players.map((player) => player.id));
          const saved = (parsed.picks || []).filter((pick) => ids.has(pick.playerId) && !validLockedPicks.some((locked) => locked.playerId === pick.playerId)).slice(0, totalPicks).flatMap((pick, index) => {
            const overall = openSchedule[index];
            const owner = overall == null ? null : teamAtPick(overall, teams);
            return owner ? [{ ...pick, overall, team: owner.team }] : [];
          });
          const scenario = SCENARIOS.find((item) => item.id === parsed.activeScenario) || SCENARIOS.find((item) => item.id === DEFAULT_SCENARIO)!;
          const savedDraftMode = parsed.draftMode === "manual" ? "manual" : "auto";
          setDraftMode(savedDraftMode);
          setCpuAuto(savedDraftMode === "auto");
          setActiveScenario(scenario.id);
          setPicks(saved.length || scenario.id === "start" ? saved : makeScenarioPicks(players, teams, userTeam, scenario, isMock, validLockedPicks, rounds, positionMaximums));
        } else setPicks(makeScenarioPicks(players, teams, userTeam, SCENARIOS.find((item) => item.id === DEFAULT_SCENARIO)!, isMock, validLockedPicks, rounds, positionMaximums));
      } catch {
        setPicks(makeScenarioPicks(players, teams, userTeam, SCENARIOS.find((item) => item.id === DEFAULT_SCENARIO)!, isMock, validLockedPicks, rounds, positionMaximums));
      }
      setReady(true);
    });
  }, [players, teams, totalPicks, userTeam, storageKey, isMock, openSchedule, validLockedPicks, rounds, positionMaximums]);

  useEffect(() => {
    if (ready) localStorage.setItem(storageKey, JSON.stringify({ picks, activeScenario, draftMode }));
  }, [picks, activeScenario, draftMode, ready, storageKey]);

  useEffect(() => {
    onDraftStateChange?.([...validLockedPicks.map((pick) => pick.playerId), ...picks.map((pick) => pick.playerId)]);
  }, [onDraftStateChange, picks, validLockedPicks]);

  useEffect(() => {
    if (!isMock) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        const parsed = JSON.parse(localStorage.getItem(historyKey) || "[]") as unknown;
        setMockHistory(Array.isArray(parsed) ? parsed.filter(isMockDraftHistoryEntry).slice(0, 24) : []);
      } catch {
        setMockHistory([]);
      }
      setHistoryReady(true);
    });
    return () => { cancelled = true; };
  }, [historyKey, isMock]);

  useEffect(() => {
    if (isMock && historyReady) localStorage.setItem(historyKey, JSON.stringify(mockHistory));
  }, [historyKey, historyReady, isMock, mockHistory]);

  const playersById = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const allPicks = useMemo(() => [...validLockedPicks, ...picks].sort((a, b) => a.overall - b.overall), [picks, validLockedPicks]);
  const draftedIds = useMemo(() => new Set(allPicks.map((pick) => pick.playerId)), [allPicks]);
  const available = useMemo(() => players.filter((player) => !draftedIds.has(player.id) && (player.availabilityMultiplier ?? 1) > .05), [players, draftedIds]);
  const actualRosterEntries = useMemo(() => allPicks.filter((pick) => pick.team === userTeam).flatMap((pick) => {
    const player = playersById.get(pick.playerId);
    return player ? [{ pick, player }] : [];
  }), [allPicks, playersById, userTeam]);
  const actualRoster = useMemo(() => actualRosterEntries.map((entry) => entry.player), [actualRosterEntries]);
  const draftComplete = picks.length >= totalPicks;
  const currentOverall = draftComplete ? scheduledPicks + 1 : openSchedule[picks.length];
  const currentTeam = !draftComplete && currentOverall != null ? teamAtPick(currentOverall, teams) : null;
  const userOnClock = currentTeam?.team === userTeam;

  useEffect(() => {
    if (!isMock || draftMode !== "auto" || !ready || !cpuAuto || !currentTeam || userOnClock || draftComplete) return;
    const timer = window.setTimeout(() => {
      setPicks((current) => {
        const overall = openSchedule[current.length];
        if (overall == null) return current;
        const owner = teamAtPick(overall, teams);
        if (!owner || owner.team === userTeam) return current;
        const combined = [...validLockedPicks, ...current];
        const used = new Set(combined.map((pick) => pick.playerId));
        const roster = combined.filter((pick) => pick.team === owner.team).flatMap((pick) => {
          const player = playersById.get(pick.playerId);
          return player ? [player] : [];
        });
        const pool = players.filter((player) => !used.has(player.id) && (player.availabilityMultiplier ?? 1) > .05);
        const selected = chooseHardCpu(pool, roster, overall, teamCount, owner.team, rounds, positionMaximums);
        return selected ? [...current, { overall, playerId: selected.id, team: owner.team }] : current;
      });
    }, 140);
    return () => window.clearTimeout(timer);
  }, [cpuAuto, currentOverall, currentTeam, draftComplete, draftMode, isMock, openSchedule, players, playersById, positionMaximums, ready, rounds, teamCount, teams, userOnClock, userTeam, validLockedPicks]);

  const decisionOverall = useMemo(() => {
    for (const overall of openSchedule.slice(picks.length)) {
      if (teamAtPick(overall, teams).team === userTeam) return overall;
    }
    return openSchedule[openSchedule.length - 1] || scheduledPicks;
  }, [openSchedule, picks.length, scheduledPicks, teams, userTeam]);
  const optionCandidates = useMemo(() => practicalCandidates(available, actualRoster, notes, decisionOverall, teamCount, rounds, positionMaximums), [actualRoster, available, decisionOverall, notes, positionMaximums, rounds, teamCount]);
  const monteCarloSeed = 20260820 + currentOverall * 1009 + monteCarloRun * 7919;

  useEffect(() => {
    if (!simulationRequested || !ready || !userOnClock || draftComplete || optionCandidates.length < 2) return;
    const timer = window.setTimeout(() => {
      const report = runMonteCarloDecision({
        players,
        candidates: optionCandidates,
        notes,
        teams,
        userTeam,
        slot,
        rounds,
        picks: allPicks,
        decisionOverall,
        positionMaximums,
        simulationsPerCandidate: 800,
        seed: monteCarloSeed,
      });
      setMonteCarlo(report);
      setSimulationRunning(false);
      setSimulationRequested(false);
    }, 40);
    return () => window.clearTimeout(timer);
  }, [allPicks, currentOverall, decisionOverall, draftComplete, monteCarloSeed, notes, optionCandidates, players, positionMaximums, ready, rounds, simulationRequested, slot, teams, userOnClock, userTeam]);

  const activeMonteCarlo = userOnClock && monteCarlo?.seed === monteCarloSeed ? monteCarlo : null;
  const monteCarloStatus: "idle" | "running" | "ready" = !userOnClock ? "idle" : simulationRunning ? "running" : activeMonteCarlo ? "ready" : "idle";
  const monteCarloById = useMemo(() => new Map((activeMonteCarlo?.results || []).map((result) => [result.candidateId, result])), [activeMonteCarlo]);
  const baselineRoutes = optionCandidates.flatMap((candidate) => {
    const route = routeFor(candidate, decisionOverall, userOnClock, players, actualRoster, draftedIds, notes, slot, teamCount, rounds, lockedOverall, starterSlots, positionMaximums);
    return route ? [route] : [];
  });
  const routes = baselineRoutes.map((route) => {
    const result = monteCarloById.get(route.candidate.id);
    if (!result) return route;
    const path = result.mostLikelyPath.flatMap((pick) => {
      const player = playersById.get(pick.playerId);
      return player ? [{ overall: pick.overall, round: pick.round, player, reason: pick.overall === decisionOverall ? "Decision fork" : `${pick.frequency.toFixed(0)}% of simulations` }] : [];
    });
    return {
      ...route,
      path,
      starterPPG: result.expectedStarterPPG,
      balance: result.expectedConstruction,
      value: result.expectedStarterVorp,
      survival: result.survivalRate,
      routeScore: result.expectedUtility,
      monteCarlo: result,
    };
  });
  const modelBest = [...routes].sort((a, b) => b.routeScore - a.routeScore)[0];
  const selectedRoute = routes.find((route) => route.candidate.id === focusId) || modelBest;
  const alternative = routes.filter((route) => route.candidate.id !== selectedRoute?.candidate.id).sort((a, b) => b.routeScore - a.routeScore)[0];
  const selectedNote = selectedRoute ? notes[selectedRoute.candidate.id] : undefined;
  const nextSamePosition = selectedRoute?.path.slice(1).find((pick) => pick.player.pos === selectedRoute.pos)?.player;
  const filtered = available.filter((player) => {
    if (position !== "ALL" && player.pos !== position) return false;
    if (flag === "LIKE" && !notes[player.id]?.liked) return false;
    if (flag === "AVOID" && !notes[player.id]?.avoid) return false;
    if (flag === "LEAGUE_WINNER" && !getLeagueWinner(player.name)) return false;
    if (flag === "DIAMOND" && !notes[player.id]?.diamond && !getPotentialDiamond(player.name)) return false;
    if (flag === "ROOKIE" && !(notes[player.id]?.rookie || player.rookieRank)) return false;
    if (search && !`${player.name} ${player.team} ${player.pos}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const sortedPlayers = [...filtered].sort((a, b) => {
    const noteA = notes[a.id];
    const noteB = notes[b.id];
    const values: Record<SortKey, [(player: LiveDraftPlayer, note?: LiveDraftNote) => string | number | null, boolean]> = {
      rank: [(player) => player.rank, true],
      name: [(player) => player.name.toLowerCase(), false],
      pos: [(player) => player.pos, false],
      adp: [(player) => player.adp, true],
      delta: [(player) => player.adp == null ? null : player.adp - player.rank, true],
      tier: [(player) => player.tier, true],
      projected: [(player) => player.projectedPoints, true],
      ppg: [(player) => playerPPG(player), true],
      expert: [(player) => player.bestRank ?? null, true],
      confidence: [(player) => confidence(player), true],
      injury: [(player) => player.injuryRiskScore ?? null, true],
      flag: [(player, note) => preferenceLabel(note, player), false],
      survival: [(player) => userOnClock ? 100 : survivalChance(player, decisionOverall), true],
    };
    const [getter, numeric] = values[sortKey];
    const aValue = getter(a, noteA);
    const bValue = getter(b, noteB);
    if (aValue == null && bValue == null) return a.rank - b.rank;
    if (aValue == null) return 1;
    if (bValue == null) return -1;
    const comparison = numeric ? Number(aValue) - Number(bValue) : String(aValue).localeCompare(String(bValue));
    return (sortDirection === "asc" ? comparison : -comparison) || a.rank - b.rank;
  });
  const currentRound = !draftComplete && currentOverall != null ? roundForPick(currentOverall, teamCount) : rounds;
  const currentPreset = SCENARIOS.find((scenario) => scenario.id === activeScenario) || SCENARIOS[1];
  const counts = rosterCounts(actualRoster);
  const remainingNeeds = Object.entries(starterSlots).map(([pos, target]) => {
    const filled = pos === "FLEX" ? Math.max(0, (counts.RB || 0) + (counts.WR || 0) + (counts.TE || 0) - 5) : Math.min(counts[String(pos)] || 0, Number(target));
    return { pos: String(pos), open: Math.max(0, Number(target) - filled) };
  });
  const radarUsed = new Set<string>();
  const radarDefinitions = [
    { label: "Diamond", reason: "Your Like list or a public-research format fit with favorable price and role evidence.", pool: available.filter((player) => notes[player.id]?.liked || isResearchTarget(player.name, "league-b")).sort((a, b) => candidateScore(b, actualRoster, notes, decisionOverall, teamCount, userOnClock) - candidateScore(a, actualRoster, notes, decisionOverall, teamCount, userOnClock)) },
    { label: "Sleeper", reason: "Late market price with projection and ECR value still intact.", pool: available.filter((player) => player.rank >= 90 && player.adp != null && player.adp - player.rank >= 5).sort((a, b) => (b.adp! - b.rank) - (a.adp! - a.rank)) },
    { label: "Rookie", reason: "Best remaining rookie by the league-adjusted live board.", pool: available.filter((player) => player.rookieRank).sort((a, b) => (a.rookieRank || 999) - (b.rookieRank || 999)) },
    { label: "Injury stash", reason: "Discounted upside with a current health flag—bench or IR only.", pool: available.filter((player) => player.injuryStatus && player.injuryStatus !== "ACTIVE" && (player.availabilityMultiplier ?? 1) > .05).sort((a, b) => a.rank - b.rank) },
  ];
  const lateRadar = radarDefinitions.flatMap((definition) => {
    const player = definition.pool.find((candidate) => !radarUsed.has(candidate.id));
    if (!player) return [];
    radarUsed.add(player.id);
    return [{ ...definition, player }];
  });

  function draft(player: LiveDraftPlayer) {
    if (draftComplete || currentOverall == null || draftedIds.has(player.id) || !currentTeam || (isMock && draftMode === "auto" && !userOnClock)) return;
    setPicks((current) => [...current, { overall: currentOverall, playerId: player.id, team: currentTeam.team }]);
    setFocusId(null);
    setMonteCarlo(null);
    setSimulationRequested(false);
    setSimulationRunning(false);
  }

  function resetDemo() {
    setPicks(makeScenarioPicks(players, teams, userTeam, currentPreset, isMock, validLockedPicks, rounds, positionMaximums));
    setFocusId(null);
    setMonteCarlo(null);
    setSimulationRequested(false);
    setSimulationRunning(false);
    if (isMock) setCpuAuto(draftMode === "auto");
  }

  function loadScenario(id: string) {
    const preset = SCENARIOS.find((scenario) => scenario.id === id);
    if (!preset) return;
    setActiveScenario(id);
    setPicks(makeScenarioPicks(players, teams, userTeam, preset, isMock, validLockedPicks, rounds, positionMaximums));
    setFocusId(null);
    setMonteCarlo(null);
    setSimulationRequested(false);
    setSimulationRunning(false);
    setSearch("");
    setPosition("ALL");
    setFlag("ALL");
    if (isMock) setCpuAuto(draftMode === "auto");
  }

  function undoLast() {
    if (isMock) setCpuAuto(false);
    setPicks((current) => current.slice(0, -1));
    setMonteCarlo(null);
    setSimulationRequested(false);
    setSimulationRunning(false);
  }

  function changeDraftMode(nextMode: "auto" | "manual") {
    setDraftMode(nextMode);
    setCpuAuto(nextMode === "auto");
    setFocusId(null);
    setMonteCarlo(null);
    setSimulationRequested(false);
    setSimulationRunning(false);
  }

  function requestMonteCarlo() {
    if (!userOnClock || draftComplete || optionCandidates.length < 2 || simulationRunning) return;
    setMonteCarlo(null);
    setSimulationRequested(true);
    setSimulationRunning(true);
    setMonteCarloRun((run) => run + 1);
  }

  function simulateRestOfDraft() {
    if (!isMock || picks.length >= totalPicks) return;
    setCpuAuto(false);
    setFocusId(null);
    setPicks((current) => {
      const simulated = [...current];
      const used = new Set([...validLockedPicks, ...current].map((pick) => pick.playerId));
      const rosters = new Map<string, LiveDraftPlayer[]>();
      [...validLockedPicks, ...current].forEach((pick) => {
        const player = playersById.get(pick.playerId);
        if (player) rosters.set(pick.team, [...(rosters.get(pick.team) || []), player]);
      });

      for (const overall of openSchedule.slice(current.length)) {
        const owner = teamAtPick(overall, teams);
        if (!owner) break;
        const roster = rosters.get(owner.team) || [];
        const pool = players.filter((player) => !used.has(player.id) && (player.availabilityMultiplier ?? 1) > .05);
        const selected = owner.team === userTeam
          ? chooseForPick(pool, roster, notes, overall, teamCount, true, undefined, rounds, positionMaximums)
          : chooseHardCpu(pool, roster, overall, teamCount, owner.team, rounds, positionMaximums);
        if (!selected) break;
        simulated.push({ overall, playerId: selected.id, team: owner.team });
        used.add(selected.id);
        rosters.set(owner.team, [...roster, selected]);
      }
      return simulated;
    });
  }

  function changeSort(key: SortKey) {
    if (sortKey === key) setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDirection(["projected", "ppg", "confidence", "delta", "survival"].includes(key) ? "desc" : "asc");
    }
  }

  function sortHeader(label: string, key: SortKey) {
    return <th><button className={sortKey === key ? "active" : ""} onClick={() => changeSort(key)}>{label}<span>{sortKey === key ? sortDirection === "asc" ? "↑" : "↓" : "↕"}</span></button></th>;
  }

  const completedGrades = useMemo(() => isMock && picks.length >= totalPicks ? gradeCompletedDraft({ players, teams, picks: allPicks }) : [], [allPicks, isMock, picks.length, players, teams, totalPicks]);

  useEffect(() => {
    if (!isMock || !historyReady || picks.length !== totalPicks || !completedGrades.length) return;
    const signature = allPicks.map((pick) => `${pick.overall}:${pick.playerId}`).join("|");
    Promise.resolve().then(() => {
      setMockHistory((current) => {
        if (current.some((entry) => entry.signature === signature)) return current;
        const mine = completedGrades.find((grade) => grade.team === userTeam);
        const topPlayerIds = (mine?.roster || []).slice().sort((a, b) => a.player.rank - b.player.rank).slice(0, 5).map(({ player }) => player.id);
        const entry: MockDraftHistoryEntry = {
          id: `mock-${Date.now().toString(36)}-${Math.abs(signature.length * 31 + picks.length).toString(36)}`,
          signature,
          createdAt: new Date().toISOString(),
          scenarioId: currentPreset.id,
          scenarioLabel: `${currentPreset.phase} · ${currentPreset.label}`,
          userTeam,
          teamCount,
          rounds,
          picks: allPicks.map((pick) => ({ ...pick })),
          grades: completedGrades.map((team) => {
            const { roster, ...grade } = team;
            void roster;
            return grade;
          }),
          topPlayerIds,
          leagueId,
          leagueName,
        };
        return [entry, ...current].slice(0, 24);
      });
    });
  }, [allPicks, completedGrades, currentPreset.id, currentPreset.label, currentPreset.phase, historyReady, isMock, leagueId, leagueName, picks, rounds, teamCount, totalPicks, userTeam]);
  const selectedMonteCarlo = selectedRoute?.monteCarlo;
  const alternativeMonteCarlo = alternative?.monteCarlo;
  const nextPickOptions = (selectedMonteCarlo?.nextPickOptions || []).flatMap((option) => {
    const player = playersById.get(option.playerId);
    return player ? [{ player, frequency: option.frequency }] : [];
  });
  const compareMessage = selectedRoute && alternative
    ? selectedMonteCarlo && alternativeMonteCarlo
      ? `${selectedRoute.candidate.name} produces ${selectedMonteCarlo.expectedStarterVorp.toFixed(1)} expected starter VORP and wins ${selectedMonteCarlo.winRate.toFixed(0)}% of the matched simulations. ${alternative.candidate.name} produces ${alternativeMonteCarlo.expectedStarterVorp.toFixed(1)} VORP with a ${alternativeMonteCarlo.winRate.toFixed(0)}% branch win rate. The gap measures the full downstream roster—not only this pick.`
      : selectedNote?.avoid
      ? `${selectedRoute.candidate.name} starts ${selectedRoute.candidate.rank - alternative.candidate.rank > 0 ? "behind" : "ahead of"} ${alternative.candidate.name} in the league model, but the shared Avoid flag applies a 38-point decision penalty. The model needs a clear weekly edge before accepting that risk.`
      : selectedRoute.pos === "RB"
        ? `${selectedRoute.candidate.name} secures an RB foundation now. The path responds by prioritizing WR at pick ${selectedRoute.path[1]?.overall || "—"}; ${alternative.candidate.name} preserves more early receiving volume.`
        : `${selectedRoute.candidate.name} gives you the stronger receiving start. ${alternative.candidate.name} is the pivot if you prefer to lock scarce RB volume and chase WR depth later.`
    : "The model will compare the strongest logical paths as the room changes.";

  return <section className="workspace live-demo-workspace">
    <section className="live-scenario-library">
      <header><div><p className="eyebrow">{isMock ? "HARD-MODE MOCK DRAFT SCENARIOS" : "DRAFT-DAY PRACTICE SCENARIOS"}</p><h2>{isMock ? "Train against nine demanding draft rooms" : "Prepare for nine different board states"}</h2></div><p>{isMock ? draftMode === "manual" ? "Manual-all-teams mode lets you make every selection. Decision simulations remain available only when your team reaches the clock." : `Automatic mode uses ${Math.max(1, teamCount - 1)} strategically sound CPUs for every opponent pick.` : "Selecting a scenario loads a realistic board and roster at that decision point. Your clicks remain editable with Undo and Reset."}</p></header>
      <div role="tablist" aria-label="Live draft practice scenarios">{SCENARIOS.map((scenario) => <button role="tab" aria-selected={scenario.id === activeScenario} className={scenario.id === activeScenario ? "active" : ""} onClick={() => loadScenario(scenario.id)} key={scenario.id}><span>{scenario.phase}</span><b>{scenario.label}</b><small>{scenario.description}</small></button>)}</div>
    </section>

    <section className="live-roster-bar">
      <header><div><p className="eyebrow">CURRENT LIVE ROSTER</p><strong>{userTeam} · {actualRoster.length}/{rounds}</strong></div><div className="live-needs"><span>OPEN STARTERS</span>{remainingNeeds.filter((need) => need.open > 0).map((need) => <b key={need.pos}>{need.pos} ×{need.open}</b>)}</div></header>
      <div className="live-roster-cells">{actualRosterEntries.length ? actualRosterEntries.map(({ pick, player }) => <article key={player.id}><span>R{roundForPick(pick.overall, teamCount)} · #{pick.overall}</span><i className={`pos pos-${player.pos}`}>{player.pos}</i><b>{player.name}</b><strong>{fmt(playerPPG(player))}<small>PPG</small></strong></article>) : <p>No players rostered yet. Your first selection is pick #{userPickNumbers(slot, teamCount, rounds)[0]}.</p>}</div>
    </section>

    <header className="live-demo-command">
      <div><p className="eyebrow">{currentPreset.phase} · {currentPreset.label}{isMock ? ` · ${draftMode === "manual" ? "MANUAL ALL TEAMS" : "HARD 90/100"}` : ""}</p><h2>{draftComplete ? "Draft complete" : userOnClock ? `You are on the clock at #${currentOverall}` : `${currentTeam?.team} is on the clock`}</h2><p>{userOnClock ? "Choose a route, compare the opportunity cost, then draft. Every remaining recommendation rebuilds immediately." : isMock ? draftMode === "manual" ? `Manual control is active. Select any available player for ${currentTeam?.team}. Your decision tools will activate at ${userTeam}'s next pick.` : `${cpuArchetype(currentTeam?.team || "CPU")} CPU is selecting automatically. Your next decision is pick #${decisionOverall}.` : `One click removes the announced player and advances the clock. Your next decision is pick #${decisionOverall}.`}</p></div>
      <div className="live-clock"><span>ROUND</span><strong>{currentRound}</strong><small>Live pick {draftComplete ? totalPicks : picks.length + 1} of {totalPicks}</small></div>
      <div className="live-demo-actions">{isMock && <div className="draft-mode-toggle" role="group" aria-label="Mock draft control mode"><span>Draft control</span><button className={draftMode === "auto" ? "active" : ""} onClick={() => changeDraftMode("auto")}>Automatic CPUs</button><button className={draftMode === "manual" ? "active" : ""} onClick={() => changeDraftMode("manual")}>Manual all teams</button></div>}{isMock && <button className="simulate-rest" onClick={simulateRestOfDraft} disabled={picks.length >= totalPicks}>Simulate rest of draft</button>}{isMock && draftMode === "auto" && <button className={cpuAuto ? "cpu-running" : ""} onClick={() => setCpuAuto((current) => !current)} disabled={picks.length >= totalPicks}>{cpuAuto ? "Pause CPUs" : "Resume CPUs"}</button>}<button onClick={undoLast} disabled={!picks.length}>↶ Undo last</button><button onClick={resetDemo}>Reset scenario</button></div>
    </header>

    <div className="live-pick-ticker"><div><span>RECENT PICKS</span><b>{picks.length} live picks recorded</b></div>{picks.slice(-6).map((pick) => { const player = playersById.get(pick.playerId); return player ? <article className={pick.team === userTeam ? "mine" : ""} key={pick.overall}><span>#{pick.overall}</span><b>{player.name}</b><small>{pick.team} · {player.pos}</small></article> : null; })}<article className="on-clock"><span>NEXT</span><b>{currentTeam?.team || "Complete"}</b><small>{!draftComplete ? `Scheduled #${currentOverall}` : "All picks recorded"}</small></article></div>

    {isMock && completedGrades.length > 0 && <MockDraftResults grades={completedGrades} userTeam={userTeam}/>}

    {isMock && historyReady && <MockDraftHistory history={mockHistory} playersById={playersById} userTeam={userTeam} leagueId={leagueId}/>}

    {!draftComplete && <div className="live-draft-layout">
      <section className="live-player-pool">
        <div className="live-section-heading"><div><p className="eyebrow">AVAILABLE PLAYER POOL</p><h3>{isMock ? draftMode === "manual" ? "You control every team. Make the current pick." : "CPUs clear the board. You make your picks." : "Announced a pick? Remove them here."}</h3></div><p>{isMock ? draftMode === "manual" ? `Every player button assigns that player to ${currentTeam?.team || "the team on the clock"}. Monte Carlo stays available at your own turns.` : "Hard-mode opponents use roster needs, scarcity, league rank, ADP, weekly projection, health, and controlled team tendencies." : "The first button is intentionally the largest target—the common draft-night action takes one click."}</p></div>
        <div className="live-player-filters"><label className="live-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search player or team…"/></label><label><span>POSITION</span><select value={position} onChange={(event) => setPosition(event.target.value)}>{FILTER_POSITIONS.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>WATCH FLAG</span><select value={flag} onChange={(event) => setFlag(event.target.value)}><option value="ALL">All players</option><option value="LIKE">Like</option><option value="AVOID">Avoid</option><option value="LEAGUE_WINNER">League winner</option><option value="DIAMOND">Potential diamond</option><option value="ROOKIE">Rookie</option></select></label></div>
        <div className="live-player-table-wrap"><table className="live-player-table"><thead><tr><th>Live action</th>{sortHeader("RK", "rank")}{sortHeader("Player", "name")}{sortHeader("Pos", "pos")}{sortHeader("ADP", "adp")}{sortHeader("Δ", "delta")}{sortHeader("Tier", "tier")}{sortHeader("Proj", "projected")}{sortHeader("PPG", "ppg")}{sortHeader("Range", "expert")}{sortHeader("Conf", "confidence")}{sortHeader("Inj", "injury")}{sortHeader("Flag", "flag")}{sortHeader(`At #${decisionOverall}`, "survival")}<th/></tr></thead><tbody>{sortedPlayers.map((player) => { const note = notes[player.id]; const delta = player.adp == null ? null : player.adp - player.rank; const survival = userOnClock ? 100 : survivalChance(player, decisionOverall); const manualOpponentPick = isMock && draftMode === "manual" && !userOnClock; const cpuPending = isMock && draftMode === "auto" && !userOnClock; return <tr className={preferenceClass(note, player)} key={player.id}><td><button disabled={cpuPending} className={`live-remove-button ${userOnClock ? "mine" : ""} ${manualOpponentPick ? "manual-pick" : ""} ${cpuPending ? "cpu-pending" : ""}`} onClick={() => draft(player)}><b>{userOnClock ? "DRAFT" : manualOpponentPick ? "PICK" : isMock ? "CPU" : "REMOVE"}</b><small>{userOnClock ? "My roster" : manualOpponentPick ? currentTeam?.team || "Current team" : isMock ? "Choosing" : `Pick #${currentOverall}`}</small></button></td><td><strong>#{player.rank}</strong></td><td><button className="live-player-name" onClick={() => onOpen(player.id)}><PlayerPhoto player={player}/><span><b>{player.name}</b><small>{player.team} · {player.posRank || player.pos}</small>{player.injuryStatus && <em>{player.injuryStatus}</em>}</span></button></td><td><i className={`pos pos-${player.pos}`}>{player.pos}</i></td><td>{fmt(player.adp)}</td><td>{delta == null ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`}</td><td>{player.tier || "—"}</td><td>{fmt(player.projectedPoints)}</td><td><b>{fmt(playerPPG(player))}</b></td><td>{player.bestRank == null ? "—" : `${player.bestRank}–${player.worstRank ?? "—"}`}</td><td>{confidence(player).toFixed(0)}%</td><td><span className={`live-injury-score ${(player.injuryRiskScore || 0) >= 75 ? "high" : ""}`} title={player.injuryRiskBand || player.injuryHeadline || "Injury risk"}>{player.injuryRiskScore ?? "—"}</span></td><td><span className={`live-flag ${preferenceLabel(note, player).toLowerCase().replaceAll(" ", "-")}`}>{preferenceLabel(note, player)}</span></td><td><span className={`survival ${survival >= 70 ? "good" : survival >= 40 ? "medium" : "low"}`}>{userOnClock ? "Now" : `${survival.toFixed(0)}%`}</span></td><td><button className="row-open" onClick={() => onOpen(player.id)}>›</button></td></tr>; })}</tbody></table></div>
      </section>

      <aside className="live-decision-rail">
        <section className="live-decision-card">
          <header><div><p className="eyebrow">{userOnClock ? "YOUR DECISION" : `PROJECTED PICK #${decisionOverall}`}</p><h3>{userOnClock ? "Monte Carlo opportunity cost" : `${decisionOverall - currentOverall} picks until you are up`}</h3></div><span className={userOnClock ? "on" : "waiting"}>{userOnClock ? monteCarloStatus === "ready" ? "MC READY" : monteCarloStatus === "running" ? "SIMULATING" : "BASELINE ONLY" : isMock ? draftMode === "manual" ? "MANUAL PICK" : cpuAuto ? "CPU DRAFTING" : "CPU PAUSED" : "AUTO-UPDATING"}</span></header>
          {userOnClock && <div className="mc-run-strip"><span><b>{activeMonteCarlo?.totalSimulations.toLocaleString() || "3,200"}</b> {activeMonteCarlo ? "complete drafts" : "drafts when run"}</span><span><b>{activeMonteCarlo?.simulationsPerCandidate || 800}</b> per choice</span><span><b>On demand</b> · no auto-run</span><button className={monteCarloStatus === "idle" ? "primary" : ""} onClick={requestMonteCarlo} disabled={monteCarloStatus === "running"}>{monteCarloStatus === "running" ? "Simulating…" : monteCarloStatus === "ready" ? "Rerun simulation" : "Simulate paths"}</button></div>}
          <div className="live-route-grid">{routes.map((route, index) => { const active = selectedRoute?.candidate.id === route.candidate.id; const note = notes[route.candidate.id]; return <button className={`${active ? "active" : ""} ${note?.avoid ? "avoid" : ""}`} onClick={() => setFocusId(route.candidate.id)} key={route.candidate.id}><span>OPTION {index + 1} · {route.pos}</span><b>{route.candidate.name}</b><small>#{route.candidate.rank} MODEL · {fmt(playerPPG(route.candidate))} PPG · ADP {fmt(route.candidate.adp)}</small><em>{route.monteCarlo ? `${route.monteCarlo.winRate.toFixed(0)}% best outcome` : monteCarloStatus === "running" ? "Simulating…" : note?.avoid ? "Avoid conflict" : note?.liked ? "Like-list boost" : `${route.survival.toFixed(0)}% available`}</em></button>; })}</div>
          {selectedRoute && <div className="live-choice-focus"><div className="live-choice-player"><PlayerPhoto player={selectedRoute.candidate}/><div><span>{selectedMonteCarlo ? "MONTE CARLO RECOMMENDATION" : "BASELINE FORECAST"} · {selectedRoute.pos}</span><h4>{selectedRoute.candidate.name}</h4><p>{selectedNote?.avoid ? "Avoid-list conflict: the full simulated roster must overcome the risk penalty." : selectedMonteCarlo ? "Highest expected full-roster utility after modeling every remaining opponent and user pick." : selectedRoute.pos === "RB" ? "Locks in scarce rushing volume; the downstream plan leans WR." : selectedRoute.pos === "WR" ? "Banks weekly receiving volume; the path searches later RB pockets." : `Fills ${selectedRoute.pos} without abandoning RB/WR guardrails.`}</p></div></div><div className="live-choice-metrics"><span><b>{fmt(playerPPG(selectedRoute.candidate))}</b><small>PLAYER PPG</small></span><span><b>{fmt(selectedRoute.starterPPG)}</b><small>STARTER PPG</small></span><span><b>{selectedMonteCarlo ? fmt(selectedMonteCarlo.expectedStarterVorp) : selectedRoute.balance.toFixed(0)}</b><small>{selectedMonteCarlo ? "STARTER VORP" : "BUILD"}</small></span><span><b>{selectedMonteCarlo ? `${selectedMonteCarlo.winRate.toFixed(0)}%` : selectedRoute.value.toFixed(0)}</b><small>{selectedMonteCarlo ? "BRANCH WIN" : "VALUE"}</small></span></div>{selectedMonteCarlo && <div className="mc-distribution"><span><small>10TH % FLOOR</small><b>{selectedMonteCarlo.floor.toFixed(1)}</b></span><span><small>MEDIAN</small><b>{selectedMonteCarlo.median.toFixed(1)}</b></span><span><small>90TH % CEILING</small><b>{selectedMonteCarlo.ceiling.toFixed(1)}</b></span><span><small>BUILD</small><b>{selectedMonteCarlo.expectedConstruction.toFixed(0)}</b></span></div>}{userOnClock ? <button className="live-draft-choice" onClick={() => draft(selectedRoute.candidate)}>Draft {selectedRoute.candidate.name} at #{currentOverall}</button> : <p className="live-wait-note">{isMock ? draftMode === "manual" ? `You are selecting for ${currentTeam?.team}. Monte Carlo remains off until ${userTeam} is on the clock and you press Simulate paths.` : `The ${cpuArchetype(currentTeam?.team || "CPU")} CPU is drafting now. Simulation remains off until you are on the clock and press Simulate paths.` : `This is a baseline forecast for pick #${decisionOverall}. Simulation remains off until you are on the clock and press Simulate paths.`}</p>}</div>}
        </section>

        {currentPreset.lateRadar && <section className="live-upside-radar"><header><div><p className="eyebrow">LATE-ROUND UPSIDE RADAR</p><h3>Bench swings worth investigating</h3></div><span>R{currentRound}</span></header><div>{lateRadar.map((item) => <article key={item.label}><PlayerPhoto player={item.player}/><div><span>{item.label}</span><b>{item.player.name}</b><small>{item.reason}</small><em>{item.player.injuryStatus && item.player.injuryStatus !== "ACTIVE" ? item.player.injuryStatus : `ADP ${fmt(item.player.adp)}`}</em></div><button onClick={() => userOnClock ? draft(item.player) : onOpen(item.player.id)}>{userOnClock ? "Draft" : "Details"}</button></article>)}</div></section>}

        {selectedRoute && alternative && <section className="live-comparison"><header><p className="eyebrow">DECISION SUPPORT</p><h3>{selectedRoute.candidate.name} vs. {alternative.candidate.name}</h3></header><div className="live-versus"><article className="selected"><span>{selectedRoute.pos} ROUTE</span><b>{selectedRoute.candidate.name}</b><small>{fmt(selectedRoute.candidate.adp)} ADP · {fmt(playerPPG(selectedRoute.candidate))} PPG</small><strong>{fmt(selectedRoute.starterPPG)}<i>expected starter PPG</i></strong></article><em>VS</em><article><span>{alternative.pos} ROUTE</span><b>{alternative.candidate.name}</b><small>{fmt(alternative.candidate.adp)} ADP · {fmt(playerPPG(alternative.candidate))} PPG</small><strong>{fmt(alternative.starterPPG)}<i>expected starter PPG</i></strong></article></div><p>{compareMessage}</p>{nextPickOptions.length > 0 ? <div className="mc-next-pick"><span>Most common players at your next pick</span><div>{nextPickOptions.map(({ player, frequency }) => <b key={player.id}>{player.name}<small>{frequency.toFixed(0)}%</small></b>)}</div></div> : nextSamePosition && <div className="live-fallback"><span>If you wait on {selectedRoute.pos}</span><b>{nextSamePosition.name}</b><small>Baseline later path · ADP {fmt(nextSamePosition.adp)}</small></div>}</section>}

        {selectedRoute && <section className="live-path"><header><div><p className="eyebrow">{selectedMonteCarlo ? "MOST LIKELY MONTE CARLO PATH" : "BASELINE TEAM PATH"}</p><h3>If you choose {selectedRoute.candidate.name}</h3></div><span>{selectedRoute.path.length} picks</span></header><div>{selectedRoute.path.map((pick, index) => <article className={index === 0 ? "fork" : ""} key={`${pick.overall}-${pick.player.id}`}><span>R{pick.round}<small>#{pick.overall}</small></span><i className={`pos pos-${pick.player.pos}`}>{pick.player.pos}</i><div><b>{pick.player.name}</b><small>{pick.reason}</small></div><strong>{fmt(playerPPG(pick.player))}<small>PPG</small></strong></article>)}</div></section>}

      </aside>
    </div>}
  </section>;
}

export function MockDraftBoard(props: DraftBoardProps) {
  return <DemoLiveDraftBoard {...props} mode="mock" />;
}
