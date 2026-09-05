import { researchPlayerAdjustment } from "./draftResearch";

export type MonteCarloPlayer = {
  id: string;
  name: string;
  pos: string;
  rank: number;
  adp: number | null;
  tier: number | null;
  projectedPoints: number | null;
  projectedPPG: number | null;
  projectedGames: number | null;
  rankStdDev: number | null;
  availabilityMultiplier?: number | null;
};

export type MonteCarloNote = { liked?: boolean; avoid?: boolean; rookie?: boolean };
export type MonteCarloTeam = { team: string; manager?: string };
export type MonteCarloPick = { overall: number; playerId: string; team: string };

export type MonteCarloPathPick = {
  overall: number;
  round: number;
  playerId: string;
  frequency: number;
};

export type MonteCarloNextPick = { playerId: string; frequency: number };

export type MonteCarloCandidateResult = {
  candidateId: string;
  simulations: number;
  survivalRate: number;
  winRate: number;
  expectedStarterPPG: number;
  expectedStarterVorp: number;
  expectedDepthVorp: number;
  expectedConstruction: number;
  expectedDraftValue: number;
  floor: number;
  median: number;
  ceiling: number;
  expectedUtility: number;
  mostLikelyPath: MonteCarloPathPick[];
  nextPickOptions: MonteCarloNextPick[];
};

export type MonteCarloReport = {
  seed: number;
  simulationsPerCandidate: number;
  totalSimulations: number;
  results: MonteCarloCandidateResult[];
};

export type DraftTeamGrade = {
  team: string;
  manager?: string;
  rank: number;
  grade: number;
  baseScore: number;
  lineupScore: number;
  depthScore: number;
  valueScore: number;
  constructionScore: number;
  starterPPG: number;
  starterVorp: number;
  depthVorp: number;
  roster: Array<{ overall: number; player: MonteCarloPlayer }>;
};

type CpuArchetype = "Balanced" | "RB anchor" | "WR volume" | "Elite QB" | "Late QB" | "Anchor TE";
type PositionMaximums = Record<string, number>;
const DEFAULT_POSITION_MAXIMUMS: PositionMaximums = { QB: 4, RB: 8, WR: 8, TE: 3, K: 1, DST: 1 };

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}

function ppg(player: MonteCarloPlayer) {
  return Number(player.projectedPPG ?? (player.projectedPoints == null ? 0 : player.projectedPoints / (player.projectedGames || 17)));
}

function marketRank(player: MonteCarloPlayer) {
  return player.adp == null ? player.rank : player.rank * .58 + player.adp * .42;
}

function confidence(player: MonteCarloPlayer) {
  return clamp(100 - (player.rankStdDev || 24) * 2);
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomGenerator(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

function normal(random: () => number) {
  const a = Math.max(1e-9, random());
  const b = Math.max(1e-9, random());
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
}

function roundForPick(overall: number, teamCount: number) {
  return Math.floor((overall - 1) / teamCount) + 1;
}

function teamAtPick(overall: number, teams: MonteCarloTeam[]) {
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

function rosterCounts(roster: MonteCarloPlayer[]) {
  return roster.reduce<Record<string, number>>((counts, player) => {
    counts[player.pos] = (counts[player.pos] || 0) + 1;
    return counts;
  }, {});
}

function canDraft(player: MonteCarloPlayer, roster: MonteCarloPlayer[], round: number, rounds: number, maximums: PositionMaximums) {
  const counts = rosterCounts(roster);
  if ((counts[player.pos] || 0) >= (maximums[player.pos] || rounds)) return false;
  if (["K", "DST"].includes(player.pos) && round < Math.max(1, rounds - 1)) return false;
  if (round <= 3 && ["RB", "WR"].includes(player.pos) && (counts[player.pos] || 0) >= 2) return false;
  if (round <= 5 && ["QB", "TE"].includes(player.pos) && (counts[player.pos] || 0) >= 1) return false;
  return true;
}

function needScore(player: MonteCarloPlayer, roster: MonteCarloPlayer[], round: number) {
  const counts = rosterCounts(roster);
  const starters: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 };
  const missing = Math.max(0, (starters[player.pos] || 0) - (counts[player.pos] || 0));
  let score = missing * 30;
  if (["RB", "WR"].includes(player.pos) && (counts.RB || 0) + (counts.WR || 0) < 6) score += 15;
  if (player.pos === "QB" && round < 4) score -= 22;
  if (player.pos === "TE" && round < 4) score -= 14;
  if (["K", "DST"].includes(player.pos) && round < 14) score -= 200;
  return score;
}

function cpuArchetype(team: string): CpuArchetype {
  const options: CpuArchetype[] = ["Balanced", "RB anchor", "WR volume", "Elite QB", "Late QB", "Anchor TE"];
  return options[stableHash(team) % options.length];
}

function viableWindow(
  ordered: MonteCarloPlayer[],
  used: Set<string>,
  roster: MonteCarloPlayer[],
  round: number,
  rounds: number,
  maximums: PositionMaximums,
) {
  const counts = rosterCounts(roster);
  let forced: string | null = null;
  if (round >= 9 && !(counts.QB || 0)) forced = "QB";
  else if (round >= 10 && !(counts.TE || 0)) forced = "TE";
  else if (round >= rounds - 1 && !(counts.DST || 0)) forced = "DST";
  else if (round >= rounds && !(counts.K || 0)) forced = "K";
  const candidates: MonteCarloPlayer[] = [];
  for (const player of ordered) {
    if (used.has(player.id) || (player.availabilityMultiplier ?? 1) <= .05) continue;
    if (forced && player.pos !== forced) continue;
    if (!canDraft(player, roster, round, rounds, maximums)) continue;
    candidates.push(player);
    if (candidates.length >= 28) break;
  }
  return candidates;
}

function cpuScore(
  player: MonteCarloPlayer,
  roster: MonteCarloPlayer[],
  round: number,
  overall: number,
  profile: CpuArchetype,
  recentPositions: string[],
) {
  const counts = rosterCounts(roster);
  const priceValue = player.adp == null ? 0 : (player.adp - player.rank) * .35;
  const uncertainty = Math.min(20, player.rankStdDev || 10);
  const draftTiming = -Math.abs(marketRank(player) - overall) * .18;
  const health = -Math.max(0, 1 - (player.availabilityMultiplier ?? 1)) * 180;
  let score = 320 - player.rank + ppg(player) * 4.4 + needScore(player, roster, round) + priceValue + confidence(player) * .16 + draftTiming + health - uncertainty * .08;
  if (profile === "RB anchor" && player.pos === "RB" && (counts.RB || 0) < 2) score += round <= 5 ? 18 : 6;
  if (profile === "WR volume" && player.pos === "WR" && (counts.WR || 0) < 3) score += round <= 7 ? 17 : 5;
  if (profile === "Elite QB" && player.pos === "QB" && !(counts.QB || 0) && round <= 5) score += 22;
  if (profile === "Late QB" && player.pos === "QB" && round <= 7) score -= 38;
  if (profile === "Anchor TE" && player.pos === "TE" && !(counts.TE || 0) && round <= 6) score += 20;
  const runCount = recentPositions.filter((position) => position === player.pos).length;
  if (runCount >= 2 && ["RB", "WR", "QB", "TE"].includes(player.pos)) score += 3;
  return score;
}

function chooseCpu(
  ordered: MonteCarloPlayer[],
  used: Set<string>,
  roster: MonteCarloPlayer[],
  round: number,
  overall: number,
  team: string,
  recentPositions: string[],
  random: () => number,
  rounds: number,
  maximums: PositionMaximums,
) {
  const profile = cpuArchetype(team);
  const candidates = viableWindow(ordered, used, roster, round, rounds, maximums);
  return candidates.map((player) => {
    const volatility = 2.4 + Math.min(4, (player.rankStdDev || 8) * .12) + Math.min(3, round * .13);
    return { player, score: cpuScore(player, roster, round, overall, profile, recentPositions) + normal(random) * volatility };
  }).sort((a, b) => b.score - a.score || a.player.rank - b.player.rank)[0]?.player;
}

function chooseUser(
  ordered: MonteCarloPlayer[],
  used: Set<string>,
  roster: MonteCarloPlayer[],
  round: number,
  overall: number,
  notes: Record<string, MonteCarloNote>,
  random: () => number,
  rounds: number,
  maximums: PositionMaximums,
) {
  const candidates = viableWindow(ordered, used, roster, round, rounds, maximums);
  return candidates.map((player, index) => {
    const note = notes[player.id];
    const value = player.adp == null ? 0 : (player.adp - player.rank) * .55;
    const health = -Math.max(0, 1 - (player.availabilityMultiplier ?? 1)) * 220;
    const nextSamePosition = candidates.slice(index + 1).find((candidate) => candidate.pos === player.pos);
    const tierDrop = nextSamePosition && player.tier && nextSamePosition.tier && nextSamePosition.tier > player.tier ? Math.min(14, (nextSamePosition.tier - player.tier) * 5) : 0;
    const timing = -Math.max(0, marketRank(player) - overall - (round <= 3 ? 5 : 9)) * .35;
    const preference = (note?.liked ? 10 : 0) - (note?.avoid ? 34 : 0);
    const research = researchPlayerAdjustment(player.name, round, 16, "league-b");
    const score = 325 - player.rank + ppg(player) * 4.8 + needScore(player, roster, round) + value + health + tierDrop + timing + preference + research + normal(random) * 1.4;
    return { player, score };
  }).sort((a, b) => b.score - a.score || a.player.rank - b.player.rank)[0]?.player;
}

function replacementLevels(players: MonteCarloPlayer[], teamCount: number) {
  const indices: Record<string, number> = { QB: teamCount, RB: Math.round(teamCount * 2.5), WR: Math.round(teamCount * 2.5), TE: teamCount, K: teamCount, DST: teamCount };
  return Object.fromEntries(Object.entries(indices).map(([pos, index]) => {
    const peers = players.filter((player) => player.pos === pos).sort((a, b) => ppg(b) - ppg(a));
    const replacement = peers.length ? peers[Math.min(peers.length - 1, index)] : undefined;
    return [pos, replacement ? ppg(replacement) : 0];
  })) as Record<string, number>;
}

function lineupMetrics(roster: MonteCarloPlayer[], replacements: Record<string, number>) {
  const remaining = [...roster];
  const starters: MonteCarloPlayer[] = [];
  const take = (positions: string[]) => {
    const candidate = remaining.filter((player) => positions.includes(player.pos)).sort((a, b) => ppg(b) - ppg(a))[0];
    if (!candidate) return;
    starters.push(candidate);
    remaining.splice(remaining.findIndex((player) => player.id === candidate.id), 1);
  };
  take(["QB"]); take(["RB"]); take(["RB"]); take(["WR"]); take(["WR"]); take(["TE"]); take(["RB", "WR", "TE"]); take(["DST"]); take(["K"]);
  const starterPPG = starters.reduce((sum, player) => sum + ppg(player), 0);
  const starterVorp = starters.reduce((sum, player) => sum + Math.max(0, ppg(player) - (replacements[player.pos] || 0)), 0);
  const starterIds = new Set(starters.map((player) => player.id));
  const depthVorp = roster.filter((player) => !starterIds.has(player.id) && ["QB", "RB", "WR", "TE"].includes(player.pos)).map((player) => Math.max(0, ppg(player) - (replacements[player.pos] || 0))).sort((a, b) => b - a).slice(0, 4).reduce((sum, value) => sum + value, 0);
  return { starterPPG, starterVorp, depthVorp, starterCount: starters.length };
}

function constructionScore(roster: MonteCarloPlayer[], starterCount: number) {
  const counts = rosterCounts(roster);
  const starterCompletion = starterCount / 9 * 70;
  const depthTargets: Record<string, number> = { RB: 4, WR: 4, QB: 1, TE: 1 };
  const depth = Object.entries(depthTargets).reduce((sum, [pos, target]) => sum + Math.min(counts[pos] || 0, target) / target, 0) / 4 * 30;
  return clamp(starterCompletion + depth);
}

function quantile(values: number[], percentile: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const fraction = index - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * fraction;
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function runMonteCarloDecision({
  players,
  candidates,
  notes,
  teams,
  userTeam,
  slot,
  rounds,
  picks,
  decisionOverall,
  positionMaximums = DEFAULT_POSITION_MAXIMUMS,
  simulationsPerCandidate = 800,
  seed = 20260820,
}: {
  players: MonteCarloPlayer[];
  candidates: MonteCarloPlayer[];
  notes: Record<string, MonteCarloNote>;
  teams: MonteCarloTeam[];
  userTeam: string;
  slot: number;
  rounds: number;
  picks: MonteCarloPick[];
  decisionOverall: number;
  positionMaximums?: PositionMaximums;
  simulationsPerCandidate?: number;
  seed?: number;
}): MonteCarloReport {
  const teamCount = teams.length;
  const totalPicks = teamCount * rounds;
  const playersById = new Map(players.map((player) => [player.id, player]));
  const ordered = [...players].filter((player) => ppg(player) > 0 && (player.availabilityMultiplier ?? 1) > .05).sort((a, b) => marketRank(a) - marketRank(b) || a.rank - b.rank);
  const replacements = replacementLevels(players, teamCount);
  const occupiedOverall = new Set(picks.map((pick) => pick.overall));
  const firstOpenOverall = Array.from({ length: totalPicks }, (_, index) => index + 1).find((overall) => !occupiedOverall.has(overall)) || totalPicks + 1;
  const nextUserOverall = userPickNumbers(slot, teamCount, rounds).find((overall) => overall > decisionOverall && !occupiedOverall.has(overall));
  const working = candidates.map((candidate) => ({
    candidate,
    utility: [] as number[],
    starterPPG: [] as number[],
    starterVorp: [] as number[],
    depthVorp: [] as number[],
    construction: [] as number[],
    draftValue: [] as number[],
    survived: 0,
    pathCounts: new Map<string, number>(),
    nextCounts: new Map<string, number>(),
  }));

  for (const branch of working) {
    for (let simulation = 0; simulation < simulationsPerCandidate; simulation += 1) {
      const random = randomGenerator((seed + simulation * 1013904223) >>> 0);
      const used = new Set(picks.map((pick) => pick.playerId));
      const rosters = new Map<string, MonteCarloPlayer[]>();
      const acquired = new Map<string, number[]>();
      for (const pick of picks) {
        const player = playersById.get(pick.playerId);
        if (!player) continue;
        rosters.set(pick.team, [...(rosters.get(pick.team) || []), player]);
        acquired.set(pick.team, [...(acquired.get(pick.team) || []), pick.overall]);
      }
      const recentPositions = picks.filter((pick) => pick.overall < firstOpenOverall).slice(-4).flatMap((pick) => {
        const player = playersById.get(pick.playerId);
        return player ? [player.pos] : [];
      });
      for (let overall = firstOpenOverall; overall <= totalPicks; overall += 1) {
        if (occupiedOverall.has(overall)) continue;
        const owner = teamAtPick(overall, teams);
        const roster = rosters.get(owner.team) || [];
        const round = roundForPick(overall, teamCount);
        let selected: MonteCarloPlayer | undefined;
        if (owner.team === userTeam) {
          if (overall === decisionOverall && !used.has(branch.candidate.id)) {
            selected = branch.candidate;
            branch.survived += 1;
          } else selected = chooseUser(ordered, used, roster, round, overall, notes, random, rounds, positionMaximums);
        } else selected = chooseCpu(ordered, used, roster, round, overall, owner.team, recentPositions, random, rounds, positionMaximums);
        if (!selected) break;
        used.add(selected.id);
        rosters.set(owner.team, [...roster, selected]);
        acquired.set(owner.team, [...(acquired.get(owner.team) || []), overall]);
        recentPositions.push(selected.pos);
        if (recentPositions.length > 4) recentPositions.shift();
        if (owner.team === userTeam && overall >= decisionOverall) {
          const key = `${overall}:${selected.id}`;
          branch.pathCounts.set(key, (branch.pathCounts.get(key) || 0) + 1);
          if (overall === nextUserOverall) branch.nextCounts.set(selected.id, (branch.nextCounts.get(selected.id) || 0) + 1);
        }
      }
      const roster = rosters.get(userTeam) || [];
      const metrics = lineupMetrics(roster, replacements);
      const construction = constructionScore(roster, metrics.starterCount);
      const costs = acquired.get(userTeam) || [];
      const draftValue = roster.length ? roster.reduce((sum, player, index) => sum + clamp((costs[index] || player.rank) - marketRank(player), -24, 24), 0) / roster.length : 0;
      const utility = metrics.starterVorp + metrics.depthVorp * .25 + construction * .08 + draftValue * .05;
      branch.utility.push(utility);
      branch.starterPPG.push(metrics.starterPPG);
      branch.starterVorp.push(metrics.starterVorp);
      branch.depthVorp.push(metrics.depthVorp);
      branch.construction.push(construction);
      branch.draftValue.push(draftValue);
    }
  }

  const winCounts = new Map(working.map((branch) => [branch.candidate.id, 0]));
  for (let simulation = 0; simulation < simulationsPerCandidate; simulation += 1) {
    const best = working.reduce((winner, branch) => branch.utility[simulation] > winner.utility[simulation] ? branch : winner, working[0]);
    winCounts.set(best.candidate.id, (winCounts.get(best.candidate.id) || 0) + 1);
  }

  const results = working.map((branch): MonteCarloCandidateResult => {
    const pathByOverall = new Map<number, Array<{ playerId: string; count: number }>>();
    for (const [key, count] of branch.pathCounts) {
      const [overallText, playerId] = key.split(":");
      const overall = Number(overallText);
      pathByOverall.set(overall, [...(pathByOverall.get(overall) || []), { playerId, count }]);
    }
    const mostLikelyPath = [...pathByOverall.entries()].sort(([a], [b]) => a - b).map(([overall, choices]) => {
      const choice = [...choices].sort((a, b) => b.count - a.count)[0];
      return { overall, round: roundForPick(overall, teamCount), playerId: choice.playerId, frequency: choice.count / simulationsPerCandidate * 100 };
    });
    const nextPickOptions = [...branch.nextCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([playerId, count]) => ({ playerId, frequency: count / simulationsPerCandidate * 100 }));
    return {
      candidateId: branch.candidate.id,
      simulations: simulationsPerCandidate,
      survivalRate: branch.survived / simulationsPerCandidate * 100,
      winRate: (winCounts.get(branch.candidate.id) || 0) / simulationsPerCandidate * 100,
      expectedStarterPPG: mean(branch.starterPPG),
      expectedStarterVorp: mean(branch.starterVorp),
      expectedDepthVorp: mean(branch.depthVorp),
      expectedConstruction: mean(branch.construction),
      expectedDraftValue: mean(branch.draftValue),
      floor: quantile(branch.utility, .1),
      median: quantile(branch.utility, .5),
      ceiling: quantile(branch.utility, .9),
      expectedUtility: mean(branch.utility),
      mostLikelyPath,
      nextPickOptions,
    };
  }).sort((a, b) => b.expectedUtility - a.expectedUtility);

  return { seed, simulationsPerCandidate, totalSimulations: simulationsPerCandidate * candidates.length, results };
}

export function gradeCompletedDraft({
  players,
  teams,
  picks,
}: {
  players: MonteCarloPlayer[];
  teams: MonteCarloTeam[];
  picks: MonteCarloPick[];
}): DraftTeamGrade[] {
  const playersById = new Map(players.map((player) => [player.id, player]));
  const replacements = replacementLevels(players, teams.length);
  const unranked = teams.map((team) => {
    const roster = picks.filter((pick) => pick.team === team.team).flatMap((pick) => {
      const player = playersById.get(pick.playerId);
      return player ? [{ overall: pick.overall, player }] : [];
    });
    const metrics = lineupMetrics(roster.map((entry) => entry.player), replacements);
    const construction = constructionScore(roster.map((entry) => entry.player), metrics.starterCount);
    const draftValue = roster.length
      ? roster.reduce((sum, entry) => sum + clamp(entry.overall - marketRank(entry.player), -24, 24), 0) / roster.length
      : 0;
    const lineupScore = clamp(metrics.starterPPG / 135 * 100);
    const depthScore = clamp(metrics.depthVorp / 20 * 100);
    const valueScore = clamp(50 + draftValue * 2);
    const baseScore = clamp(lineupScore * .48 + depthScore * .17 + valueScore * .22 + construction * .13);
    return {
      team: team.team,
      manager: team.manager,
      rank: 0,
      grade: 0,
      baseScore,
      lineupScore,
      depthScore,
      valueScore,
      constructionScore: construction,
      starterPPG: metrics.starterPPG,
      starterVorp: metrics.starterVorp,
      depthVorp: metrics.depthVorp,
      roster,
    };
  }).sort((a, b) => b.baseScore - a.baseScore);

  return unranked.map((team, index) => {
    const leaguePercentile = unranked.length <= 1 ? 100 : 100 - index / (unranked.length - 1) * 100;
    return { ...team, rank: index + 1, grade: clamp(team.baseScore * .75 + leaguePercentile * .25) };
  });
}
