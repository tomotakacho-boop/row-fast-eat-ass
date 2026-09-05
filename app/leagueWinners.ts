import leagueWinnerData from "../public/data/league-winners.json";

export type LeagueWinner = {
  player: string;
  targetRounds: string;
  confidence: string;
  thesis: string;
  evidence: string;
  risk: string;
  source?: {
    publisher: string;
    title: string;
    url: string;
  };
};

export function normalizeLeagueWinnerName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const leagueWinnerMap = new Map((leagueWinnerData.candidates as LeagueWinner[]).map((entry) => [normalizeLeagueWinnerName(entry.player), entry]));

export const leagueWinnerResearch = leagueWinnerData;
export const leagueWinners = leagueWinnerData.candidates as LeagueWinner[];

export function getLeagueWinner(name: string) {
  return leagueWinnerMap.get(normalizeLeagueWinnerName(name));
}

export function isLeagueWinner(name: string) {
  return leagueWinnerMap.has(normalizeLeagueWinnerName(name));
}

export function leagueWinnerSource(candidate: LeagueWinner) {
  return candidate.source || leagueWinnerData.source;
}
