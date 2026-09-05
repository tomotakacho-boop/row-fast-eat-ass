import diamondData from "../public/data/potential-diamonds.json";

export type PotentialDiamond = {
  player: string;
  score: number;
  targetRounds: string;
  confidence: string;
  keeperThesis: string;
  redraftPath: string;
  risk: string;
  sources: Array<{ publisher: string; title: string; url: string }>;
};

export function normalizeDiamondName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const diamondMap = new Map((diamondData.candidates as PotentialDiamond[]).map((entry) => [normalizeDiamondName(entry.player), entry]));

export const potentialDiamondResearch = diamondData;
export const potentialDiamonds = diamondData.candidates as PotentialDiamond[];

export function getPotentialDiamond(name: string) {
  return diamondMap.get(normalizeDiamondName(name));
}

export function isPotentialDiamond(name: string) {
  return diamondMap.has(normalizeDiamondName(name));
}
