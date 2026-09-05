import { researchPlayerAdjustment, type ResearchLeagueKey } from "./draftResearch";
import { headlinersStrategyAdjustment } from "./draftStrategyResearch";
import { isPotentialDiamond } from "./potentialDiamonds";

export type PlanPlayer = {
  id: string;
  name: string;
  team: string;
  pos: string;
  rank: number;
  consensusRank?: number | null;
  adp?: number | null;
  projectedPPG?: number | null;
  activeGamePPG?: number | null;
  projectedPoints?: number | null;
  borisTier?: number | null;
  tier?: number | null;
  rankStdDev?: number | null;
  availabilityMultiplier?: number | null;
  injuryStatus?: string | null;
  injuryHeadline?: string | null;
  injuryDetail?: string | null;
  injurySource?: string | null;
  injuryUpdatedAt?: string | null;
  injuryRankPenalty?: number | null;
};

export type OptimizedDraftPlan = {
  key: string;
  name: string;
  thesis: string;
  ids: string[];
  starterPPG: number;
  rosterPPG: number;
  valueScore: number;
  constructionScore: number;
  positions: Record<string, number>;
};

type PlanProfile = {
  key: string;
  name: string;
  thesis: string;
  positionBias: Record<string, number>;
  earlyBias?: Record<string, number>;
  valueWeight: number;
  ceilingWeight: number;
  volatilityWeight: number;
};

export const optimizedPlanProfiles: PlanProfile[] = [
  { key: "A", name: "Weekly Points Max", thesis: "Maximize starter PPG and value over replacement, then fill resilient depth.", positionBias: {}, valueWeight: .75, ceilingWeight: 1.35, volatilityWeight: -.1 },
  { key: "B", name: "Balanced Tier Breaks", thesis: "Take the best live tier while keeping every starting position on schedule.", positionBias: { QB: 1, RB: 2, WR: 2, TE: 1 }, valueWeight: 1, ceilingWeight: 1, volatilityWeight: -.25 },
  { key: "C", name: "Hero RB", thesis: "Secure one premium back, then attack receiver volume before returning to RB depth.", positionBias: { WR: 3 }, earlyBias: { RB: 9, WR: 4 }, valueWeight: .9, ceilingWeight: 1.1, volatilityWeight: 0 },
  { key: "D", name: "WR Avalanche", thesis: "Build a weekly reception floor and FLEX advantage before chasing backfield upside.", positionBias: { WR: 6, RB: -1 }, earlyBias: { WR: 8 }, valueWeight: .85, ceilingWeight: 1.05, volatilityWeight: .05 },
  { key: "E", name: "RB Foundation", thesis: "Leave the opening phase with two strong backs, then hammer receiver value.", positionBias: { RB: 5, WR: 1 }, earlyBias: { RB: 8 }, valueWeight: .8, ceilingWeight: 1, volatilityWeight: -.1 },
  { key: "F", name: "Elite QB Edge", thesis: "Pay for a difference-making quarterback only when the tier advantage survives the cost.", positionBias: { QB: 7 }, earlyBias: { QB: 7 }, valueWeight: .75, ceilingWeight: 1.3, volatilityWeight: 0 },
  { key: "G", name: "Elite TE Edge", thesis: "Capture a scarce tight-end tier, then optimize RB/WR points around it.", positionBias: { TE: 8 }, earlyBias: { TE: 8 }, valueWeight: .8, ceilingWeight: 1.2, volatilityWeight: -.05 },
  { key: "H", name: "Zero RB", thesis: "Prioritize WR, QB, and TE scoring, then assemble multiple viable late backs.", positionBias: { WR: 6, QB: 2, TE: 2, RB: -3 }, earlyBias: { RB: -9, WR: 8 }, valueWeight: 1.05, ceilingWeight: 1.05, volatilityWeight: .1 },
  { key: "I", name: "Late QB Value", thesis: "Delay quarterback while the RB/WR/TE board offers greater weekly scarcity.", positionBias: { RB: 2, WR: 3, TE: 1, QB: -2 }, earlyBias: { QB: -10 }, valueWeight: 1.2, ceilingWeight: .95, volatilityWeight: -.1 },
  { key: "J", name: "Upside Portfolio", thesis: "Blend market discounts, expert-backed sleepers, and high-variance bench ceilings.", positionBias: { RB: 1, WR: 2 }, valueWeight: 1.25, ceilingWeight: 1.1, volatilityWeight: .35 },
];

function clamp(value: number, low = 0, high = 100) { return Math.max(low, Math.min(high, value)); }
function ppg(player: PlanPlayer) { return Number(player.projectedPPG ?? (player.projectedPoints == null ? 0 : player.projectedPoints / 17)); }
function marketRank(player: PlanPlayer) {
  const values = [player.rank, player.adp].filter((value): value is number => value != null && Number.isFinite(value));
  return values.length === 2 ? values[0] * .58 + values[1] * .42 : values[0] || player.rank;
}
function counts(roster: PlanPlayer[]) { return roster.reduce<Record<string, number>>((map, player) => ({ ...map, [player.pos]: (map[player.pos] || 0) + 1 }), {}); }

function startingLineup(roster: PlanPlayer[], starters: Record<string, number>) {
  const remaining = roster.slice();
  const selected: PlanPlayer[] = [];
  for (const position of ["QB", "RB", "WR", "TE", "K", "DST"]) {
    const candidates = remaining.filter((player) => player.pos === position).sort((a, b) => ppg(b) - ppg(a));
    const take = candidates.slice(0, starters[position] || 0);
    selected.push(...take);
    for (const player of take) remaining.splice(remaining.findIndex((entry) => entry.id === player.id), 1);
  }
  const flex = remaining.filter((player) => ["RB", "WR", "TE"].includes(player.pos)).sort((a, b) => ppg(b) - ppg(a)).slice(0, starters.FLEX || 0);
  selected.push(...flex);
  return selected;
}

function requiredPosition(roster: PlanPlayer[], starters: Record<string, number>, round: number, rounds: number) {
  const rosterCounts = counts(roster);
  const deadlines: Record<string, number> = { QB: Math.min(10, rounds - 4), TE: Math.min(11, rounds - 3), K: rounds, DST: rounds - 1 };
  for (const position of ["QB", "TE", "DST", "K"]) if ((rosterCounts[position] || 0) < (starters[position] || 0) && round >= deadlines[position]) return position;
  const missingCore = ["RB", "WR"].filter((position) => (rosterCounts[position] || 0) < (starters[position] || 0));
  if (missingCore.length && round >= Math.max(7, rounds - 7)) return missingCore.sort((a, b) => (rosterCounts[a] || 0) - (rosterCounts[b] || 0))[0];
  return null;
}

export function buildOptimizedDraftPlans({
  players, teamCount, rounds, slot, starters, maximums = {}, lockedByRound = {}, unavailableIds = [], likedIds = [], avoidIds = [], diamondIds = [], researchLeague = "league-b",
}: {
  players: PlanPlayer[];
  teamCount: number;
  rounds: number;
  slot: number;
  starters: Record<string, number>;
  maximums?: Record<string, number>;
  lockedByRound?: Record<number, string>;
  unavailableIds?: string[];
  likedIds?: string[];
  avoidIds?: string[];
  diamondIds?: string[];
  researchLeague?: ResearchLeagueKey;
}) {
  const unavailable = new Set(unavailableIds);
  const liked = new Set(likedIds);
  const avoided = new Set(avoidIds);
  const diamonds = new Set(diamondIds);
  const byId = new Map(players.map((player) => [player.id, player]));
  const unavailableMarketRanks = players.filter((player) => unavailable.has(player.id)).map(marketRank).sort((a, b) => a - b);
  const keeperAdjustedMarketRank = (player: PlanPlayer) => {
    const market = marketRank(player);
    return market - unavailableMarketRanks.filter((rank) => rank < market).length;
  };
  const flexShares = { RB: .46, WR: .46, TE: .08 };
  const replacementPPG = Object.fromEntries(["QB", "RB", "WR", "TE", "K", "DST"].map((position) => {
    const demand = Math.max(1, Math.round(teamCount * ((starters[position] || 0) + (starters.FLEX || 0) * (flexShares[position as keyof typeof flexShares] || 0))));
    const pool = players.filter((player) => player.pos === position).sort((a, b) => ppg(b) - ppg(a));
    const replacement = pool[Math.min(pool.length - 1, demand - 1)];
    return [position, replacement ? ppg(replacement) : 0];
  }));

  return optimizedPlanProfiles.map((profile) => {
    const roster: PlanPlayer[] = [];
    const ids = Array(rounds).fill("");
    const used = new Set<string>();
    for (let round = 1; round <= rounds; round += 1) {
      const lockedId = lockedByRound[round];
      if (lockedId) {
        const player = byId.get(lockedId);
        ids[round - 1] = lockedId;
        used.add(lockedId);
        if (player) roster.push(player);
        continue;
      }
      const pick = round % 2 ? (round - 1) * teamCount + slot : round * teamCount - slot + 1;
      const rosterCounts = counts(roster);
      // Treat later-round keepers as already reserved when making earlier picks. This
      // prevents a plan from buying a second early TE when, for example, Bowers is
      // already locked into a future round.
      const futureLockedPlayers = Object.entries(lockedByRound)
        .filter(([lockedRound, id]) => Number(lockedRound) > round && !used.has(id))
        .map(([, id]) => byId.get(id))
        .filter((player): player is PlanPlayer => Boolean(player));
      const strategicRoster = [...roster, ...futureLockedPlayers];
      const strategicCounts = counts(strategicRoster);
      const forced = requiredPosition(strategicRoster, starters, round, rounds);
      const availabilityTolerance = round <= 3 ? 2 : Math.max(4, Math.round(teamCount * .4));
      const marketFloor = Math.max(1, pick - availabilityTolerance);
      const candidates = players.filter((player) => {
        if (used.has(player.id) || unavailable.has(player.id) || avoided.has(player.id)) return false;
        if ((player.availabilityMultiplier ?? 1) <= .05 || ppg(player) <= 0) return false;
        const suppliedMaximum = maximums[player.pos] || (player.pos === "QB" || player.pos === "TE" ? 3 : player.pos === "K" || player.pos === "DST" ? 1 : 8);
        const strategicMaximum = player.pos === "QB" || player.pos === "TE" ? Math.min(2, suppliedMaximum) : player.pos === "K" || player.pos === "DST" ? 1 : suppliedMaximum;
        if ((strategicCounts[player.pos] || 0) >= strategicMaximum) return false;
        if (forced && player.pos !== forced) return false;
        if (["K", "DST"].includes(player.pos) && round < Math.max(10, rounds - 2)) return false;
        if (profile.key === "I" && player.pos === "QB" && round < Math.min(8, rounds - 4)) return false;
        if (round <= 3 && ["RB", "WR"].includes(player.pos) && (rosterCounts[player.pos] || 0) >= 2) return false;
        if (round <= 5 && ["QB", "TE"].includes(player.pos) && (strategicCounts[player.pos] || 0) >= 1) return false;
        if (round < Math.max(9, rounds - 6) && ["QB", "TE"].includes(player.pos) && (strategicCounts[player.pos] || 0) >= (starters[player.pos] || 0)) return false;
        return keeperAdjustedMarketRank(player) >= marketFloor;
      });
      const phase = round <= 4 ? "early" : round >= rounds - 4 ? "late" : "middle";
      const scored = candidates.map((player) => {
        const healthyPPG = Number(player.activeGamePPG ?? ppg(player));
        const vorp = ppg(player) - Number(replacementPPG[player.pos] || 0);
        const adpValue = player.adp == null ? 0 : clamp(player.adp - (player.consensusRank || player.rank), -25, 40);
        const tierQuality = 18 / Math.max(1, player.borisTier || player.tier || 10);
        const uncertainty = Math.min(20, player.rankStdDev || 10);
        const need = Math.max(0, (starters[player.pos] || 0) - (strategicCounts[player.pos] || 0)) * 4;
        const earlyBias = phase === "early" ? profile.earlyBias?.[player.pos] || 0 : 0;
        const lateUpside = phase === "late" && ["RB", "WR", "TE"].includes(player.pos) ? healthyPPG * .5 : 0;
        const timing = -Math.abs(keeperAdjustedMarketRank(player) - pick) * .09;
        const expert = researchPlayerAdjustment(player.name, round, rounds, researchLeague);
        const personal = liked.has(player.id) ? 8 : 0;
        const diamondCandidate = diamonds.has(player.id) || isPotentialDiamond(player.name);
        const keeperDiamond = diamondCandidate && phase === "late" ? 2 : 0;
        const slotStrategy = headlinersStrategyAdjustment({ position: player.pos, round, rounds, slot, teamCount, counts: strategicCounts });
        const surplusAtPosition = Math.max(0, (strategicCounts[player.pos] || 0) - (starters[player.pos] || 0));
        const benchPenalty = surplusAtPosition * (player.pos === "QB" ? 14 : player.pos === "TE" ? 11 : 1.5);
        const score = ppg(player) * 3.2 * profile.ceilingWeight + vorp * 7.5 + adpValue * profile.valueWeight + tierQuality + need
          + (profile.positionBias[player.pos] || 0) + earlyBias + lateUpside + timing + expert + personal + keeperDiamond + slotStrategy + uncertainty * profile.volatilityWeight - benchPenalty;
        return { player, score };
      }).sort((a, b) => b.score - a.score);
      const selected = scored[0]?.player || players.find((player) => {
        if (used.has(player.id) || unavailable.has(player.id) || avoided.has(player.id) || (player.availabilityMultiplier ?? 1) <= .05 || ppg(player) <= 0) return false;
        const suppliedMaximum = maximums[player.pos] || (player.pos === "QB" || player.pos === "TE" ? 3 : player.pos === "K" || player.pos === "DST" ? 1 : 8);
        const strategicMaximum = player.pos === "QB" || player.pos === "TE" ? Math.min(2, suppliedMaximum) : player.pos === "K" || player.pos === "DST" ? 1 : suppliedMaximum;
        if ((strategicCounts[player.pos] || 0) >= strategicMaximum) return false;
        if (forced && player.pos !== forced) return false;
        if (["K", "DST"].includes(player.pos) && round < Math.max(10, rounds - 2)) return false;
        return keeperAdjustedMarketRank(player) >= Math.max(1, pick - teamCount);
      });
      if (!selected) continue;
      ids[round - 1] = selected.id;
      used.add(selected.id);
      roster.push(selected);
    }
    const lineup = startingLineup(roster, starters);
    const rosterCounts = counts(roster);
    const required = Object.entries(starters).filter(([position]) => position !== "FLEX").reduce((sum, [position, count]) => sum + Math.min(count, rosterCounts[position] || 0), 0);
    const requiredTotal = Object.entries(starters).filter(([position]) => position !== "FLEX").reduce((sum, [, count]) => sum + count, 0);
    const flexReady = Math.min(starters.FLEX || 0, Math.max(0, roster.filter((player) => ["RB", "WR", "TE"].includes(player.pos)).length - (starters.RB || 0) - (starters.WR || 0) - (starters.TE || 0)));
    const constructionScore = clamp((required + flexReady) / Math.max(1, requiredTotal + (starters.FLEX || 0)) * 100);
    const valueScore = clamp(55 + roster.reduce((sum, player) => sum + clamp((player.adp || player.rank) - (player.consensusRank || player.rank), -20, 30), 0) / Math.max(1, roster.length) * 2);
    return {
      key: profile.key,
      name: profile.name,
      thesis: profile.thesis,
      ids,
      starterPPG: lineup.reduce((sum, player) => sum + ppg(player), 0),
      rosterPPG: roster.reduce((sum, player) => sum + ppg(player), 0),
      valueScore,
      constructionScore,
      positions: rosterCounts,
    } satisfies OptimizedDraftPlan;
  });
}
