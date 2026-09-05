import strategyData from "../public/data/flock-pick-5-strategy-2026.json";

export const pickFiveStrategy = strategyData;

type PositionCounts = Record<string, number>;

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function marketPrice(adp: number | null, rank: number) {
  return adp == null ? rank : rank * .58 + adp * .42;
}

const ROUND_EXAMPLES = new Map(strategyData.pickFiveMockExample.map((entry) => [normalize(entry.player), entry.round]));
const ROUND_ONE_PRIORS = new Map([
  [normalize("CeeDee Lamb"), 6],
  [normalize("Christian McCaffrey"), 5.5],
  [normalize("Amon-Ra St. Brown"), 5],
  [normalize("James Cook III"), 5],
  [normalize("Jaxon Smith-Njigba"), 4.5],
  [normalize("Jonathan Taylor"), 2.5],
]);

export function pickFiveStrategyAdjustment({
  playerName,
  position,
  round,
  overall,
  slot,
  teamCount,
  counts,
  openerPosition,
  adp,
  rank,
}: {
  playerName: string;
  position: string;
  round: number;
  overall: number;
  slot: number;
  teamCount: number;
  counts: PositionCounts;
  openerPosition?: string;
  adp: number | null;
  rank: number;
}) {
  if (slot !== 5 || teamCount !== 12) return 0;
  const rb = counts.RB || 0;
  const wr = counts.WR || 0;
  const fall = overall - marketPrice(adp, rank);
  let score = 0;

  if (round === 1) {
    if (["RB", "WR"].includes(position)) score += 2;
    else score -= 18;
    score += ROUND_ONE_PRIORS.get(normalize(playerName)) || 0;
  }

  if (round === 2) {
    if (openerPosition === "WR") {
      if (position === "RB") score += 12;
      if (position === "WR") score -= 7;
    } else if (openerPosition === "RB" && ["RB", "WR"].includes(position)) score += 3;
  }

  if (round <= 5 && ["RB", "WR"].includes(position)) {
    const rbAfter = rb + Number(position === "RB");
    const wrAfter = wr + Number(position === "WR");
    const remaining = 5 - round;
    if (rbAfter + remaining < 2) score -= 18;
    if (wrAfter + remaining < 2) score -= 18;
    if (position === "RB" && rb < 3) score += Math.min(7, (3 - rb) * 2.1);
    if (position === "WR" && wr < 2) score += Math.min(6, (2 - wr) * 2.2);
    if (position === "RB" && rb >= 3 && fall < 8) score -= 6;
    if (position === "WR" && wr >= 3 && fall < 8) score -= 4;
    if (round === 5 && ((rbAfter === 3 && wrAfter === 2) || (rbAfter === 2 && wrAfter === 3))) score += 10;
  }

  if (round <= 3 && position === "QB") score -= fall >= 8 ? 4 : 16;
  if (round <= 3 && position === "TE") score -= fall >= 7 ? 2 : 10;
  if (round >= 4 && round <= 5 && position === "QB") score -= fall >= 7 ? 0 : 8;
  if (round >= 4 && round <= 5 && position === "TE") score += fall >= 6 ? 5 : -4;

  if (round >= 6 && round <= 8) {
    if (position === "WR" && rb >= wr + 2) score += 4;
    if (position === "RB" && wr >= rb + 2) score += 4;
    if (["QB", "TE"].includes(position) && fall < 6) score -= 3;
  }
  if (round >= 9) {
    if (position === "QB" && !(counts.QB || 0)) score += 14;
    if (position === "TE" && !(counts.TE || 0)) score += 12;
  }

  const exampleRound = ROUND_EXAMPLES.get(normalize(playerName));
  if (exampleRound && Math.abs(exampleRound - round) <= 1) score += exampleRound <= 5 ? 3 : 2;
  return score;
}

export function pickFiveRosterUtility(roster: Array<{ name: string; pos: string }>, slot: number, teamCount: number) {
  if (slot !== 5 || teamCount !== 12 || !roster.length) return 0;
  const firstFive = roster.slice(0, 5);
  const rb = firstFive.filter((player) => player.pos === "RB").length;
  const wr = firstFive.filter((player) => player.pos === "WR").length;
  const te = firstFive.filter((player) => player.pos === "TE").length;
  const earlyQB = roster.slice(0, 3).some((player) => player.pos === "QB");
  const earlyTE = roster.slice(0, 3).some((player) => player.pos === "TE");
  let utility = (ROUND_ONE_PRIORS.get(normalize(roster[0].name)) || 0) * .18;
  if ((rb === 3 && wr === 2) || (rb === 2 && wr === 3)) utility += 2.1;
  else if (rb === 2 && wr === 2 && te === 1) utility += 1.3;
  if (rb < 2 || wr < 2) utility -= 1.8;
  if (earlyQB) utility -= 2.4;
  if (earlyTE) utility -= 1.2;
  return utility;
}

export function describePickFiveBuild(roster: Array<{ pos: string }>) {
  const firstFive = roster.slice(0, 5);
  const rb = firstFive.filter((player) => player.pos === "RB").length;
  const wr = firstFive.filter((player) => player.pos === "WR").length;
  const te = firstFive.filter((player) => player.pos === "TE").length;
  if (rb === 3 && wr === 2) return "Pick-5 full house · 3 RB / 2 WR through Round 5";
  if (rb === 2 && wr === 3) return "Pick-5 full house · 3 WR / 2 RB through Round 5";
  if (rb === 2 && wr === 2 && te === 1) return "Balanced TE-value branch · 2 RB / 2 WR / 1 TE";
  if (rb >= 3) return "RB-heavy value branch · receiver recovery required";
  if (wr >= 3) return "WR-heavy value branch · running-back recovery required";
  return "Adaptive best-value branch from pick 5";
}
