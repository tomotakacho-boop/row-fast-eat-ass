export type StrategyPositionCounts = Record<string, number>;

export function headlinersStrategyAdjustment({ position, round, rounds, slot, teamCount, counts }: {
  position: string; round: number; rounds: number; slot: number; teamCount: number; counts: StrategyPositionCounts;
}) {
  let score = 0;
  const rb = counts.RB || 0;
  const wr = counts.WR || 0;
  const normalizedSlot = slot / Math.max(1, teamCount);
  if (round === 1) {
    if (normalizedSlot <= .18 && position === "RB") score += 7;
    else if (normalizedSlot <= .43 && position === "WR") score += 7;
    else if (normalizedSlot <= .69 && position === "RB") score += 5;
    else if (normalizedSlot <= .86 && position === "WR") score += 5;
    else if (position === "RB" || position === "WR") score += 3;
  }
  if (round <= 5) {
    const roundsLeft = 6 - round;
    const rbDeficit = Math.max(0, 3 - rb);
    const wrDeficit = Math.max(0, 2 - wr);
    if (position === "RB") score += Math.min(8, rbDeficit * 2.1 + (rbDeficit >= roundsLeft ? 3 : 0));
    if (position === "WR") score += Math.min(7, wrDeficit * 2.2 + (wrDeficit >= roundsLeft ? 3 : 0));
    if (position === "RB" && rb >= 3) score -= 5;
    if (position === "WR" && wr >= 2) score -= 2;
  }
  if (round >= 6 && round <= Math.min(10, rounds - 3)) {
    if (position === "QB" && !(counts.QB || 0)) score += 4;
    if (position === "TE" && !(counts.TE || 0)) score += 3;
  }
  if (rounds >= 14) {
    if (round === rounds - 2 && position === "DST") score += 7;
    if (round === rounds - 1 && position === "K") score += 7;
    if (round === rounds && ["RB", "WR", "TE"].includes(position)) score += 6;
  }
  return score;
}
