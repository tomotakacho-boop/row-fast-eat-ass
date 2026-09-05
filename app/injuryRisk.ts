export const HIGH_INJURY_RISK_AVOID_THRESHOLD = 75;

export type InjuryRiskPlayer = {
  injuryRiskScore?: number | null;
  injuryRiskBand?: string | null;
};

export function injuryRiskScore(player: InjuryRiskPlayer) {
  return player.injuryRiskScore == null || !Number.isFinite(Number(player.injuryRiskScore))
    ? null
    : Math.max(0, Math.min(100, Number(player.injuryRiskScore)));
}

export function isHighInjuryRisk(player: InjuryRiskPlayer) {
  const score = injuryRiskScore(player);
  return score != null && score >= HIGH_INJURY_RISK_AVOID_THRESHOLD;
}

export function injuryRiskBand(player: InjuryRiskPlayer) {
  const score = injuryRiskScore(player);
  if (score == null) return "Not modeled";
  if (score >= HIGH_INJURY_RISK_AVOID_THRESHOLD) return "Auto avoid";
  if (score >= 60) return "High";
  if (score >= 40) return "Elevated";
  if (score >= 20) return "Moderate";
  return "Low";
}
