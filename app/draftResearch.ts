import researchData from "../public/data/draft-research-2026.json";

export type ResearchLeagueKey = "league-b";
export type ResearchAction = "TARGET" | "TARGET_AT_COST" | "TARGET_DEEP" | "FINAL_ROUND" | "WATCH" | "HANDCUFF" | "INJURY_HOLD" | "AVOID_HYPE" | "DEEP_FLOOR";

export type PlayerResearch = {
  player: string;
  team: string;
  pos: string;
  action: ResearchAction[];
  evidence: string;
  rank: number;
  adp: number;
  valueGap: number;
  bullCase: string;
  risk: string;
  use: string;
  invalidateIf: string;
  sources: string[];
};

export type ResearchSource = {
  id: string;
  publisher: string;
  title: string;
  published: string;
  url: string;
  type: string;
};

export type LeagueResearch = {
  label: string;
  format: string;
  priorities: string[];
  targetNames: string[];
};

export function normalizeResearchName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export const publicDraftResearch = researchData;
export const playerResearch = researchData.players as PlayerResearch[];
export const researchSources = researchData.sources as ResearchSource[];

const playerMap = new Map(playerResearch.map((entry) => [normalizeResearchName(entry.player), entry]));
const sourceMap = new Map(researchSources.map((source) => [source.id, source]));

export function getPlayerResearch(name: string) {
  return playerMap.get(normalizeResearchName(name));
}

export function getResearchSource(id: string) {
  return sourceMap.get(id);
}

export function researchLeagueForTeam(team?: string): ResearchLeagueKey {
  void team;
  return "league-b";
}

export function getLeagueResearch(league: ResearchLeagueKey) {
  return researchData.leagueStrategies[league] as LeagueResearch;
}

export function isResearchTarget(name: string, league?: ResearchLeagueKey) {
  const entry = getPlayerResearch(name);
  if (!entry) return false;
  const positive = entry.action.some((action) => ["TARGET", "TARGET_AT_COST", "TARGET_DEEP", "HANDCUFF"].includes(action));
  if (!positive) return false;
  return !league || getLeagueResearch(league).targetNames.some((target) => normalizeResearchName(target) === normalizeResearchName(name));
}

export function researchPlayerAdjustment(name: string, round: number, rounds: number, league: ResearchLeagueKey = "league-b") {
  const entry = getPlayerResearch(name);
  if (!entry) return 0;
  const evidence = entry.evidence.startsWith("A") ? 1 : entry.evidence.startsWith("B+") ? .85 : entry.evidence.startsWith("B") ? .7 : entry.evidence.startsWith("C") ? .35 : .15;
  const late = round >= Math.max(10, rounds - 4);
  let adjustment = 0;
  if (entry.action.includes("TARGET")) adjustment += 7 * evidence;
  if (entry.action.includes("TARGET_AT_COST")) adjustment += entry.valueGap > 0 ? 5 * evidence : -4;
  if (entry.action.includes("TARGET_DEEP")) adjustment += late ? 5 * evidence : -3;
  if (entry.action.includes("HANDCUFF")) adjustment += late ? 4 * evidence : 1;
  if (entry.action.includes("FINAL_ROUND")) adjustment += late ? 4 * evidence : -9;
  if (entry.action.includes("WATCH")) adjustment -= late ? 1 : 5;
  if (entry.action.includes("INJURY_HOLD")) adjustment -= 18;
  if (entry.action.includes("AVOID_HYPE")) adjustment -= 16;
  if (getLeagueResearch(league).targetNames.some((target) => normalizeResearchName(target) === normalizeResearchName(name))) adjustment += late ? 4 : 2;
  return adjustment;
}
