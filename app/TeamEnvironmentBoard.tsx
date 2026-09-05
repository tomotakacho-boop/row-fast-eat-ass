"use client";

import { useMemo, useState } from "react";
import researchModels from "../public/data/research-models.json";

type TeamPlayer = {
  id: string;
  name: string;
  team: string;
  pos: string;
  rank: number;
  projectedPoints?: number | null;
  projectedPPG?: number | null;
  projectedGames?: number | null;
};

type SortKey = "impliedPoints" | "olRank" | "qbContext" | "projectedQbPpg" | "topFivePpg" | "historicalProtection" | "historicalQbPpg";

function normalizeTeam(team: string) {
  return ({ LA: "LAR", JAX: "JAC" } as Record<string, string>)[team] || team;
}

function ppg(player: TeamPlayer) {
  return player.projectedPPG ?? (player.projectedPoints == null ? 0 : player.projectedPoints / (player.projectedGames || 17));
}

function pearson(a: number[], b: number[]) {
  if (a.length < 3 || a.length !== b.length) return 0;
  const aMean = a.reduce((sum, value) => sum + value, 0) / a.length;
  const bMean = b.reduce((sum, value) => sum + value, 0) / b.length;
  const numerator = a.reduce((sum, value, index) => sum + (value - aMean) * (b[index] - bMean), 0);
  const denominator = Math.sqrt(a.reduce((sum, value) => sum + (value - aMean) ** 2, 0) * b.reduce((sum, value) => sum + (value - bMean) ** 2, 0));
  return denominator ? numerator / denominator : 0;
}

function relationship(value: number) {
  const magnitude = Math.abs(value);
  const strength = magnitude >= .6 ? "strong" : magnitude >= .35 ? "moderate" : magnitude >= .15 ? "weak" : "minimal";
  return `${strength} ${value >= 0 ? "positive" : "negative"}`;
}

function timeLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function TeamEnvironmentBoard({ players, generatedAt, compact = false }: { players: TeamPlayer[]; generatedAt?: string; compact?: boolean }) {
  const [sortKey, setSortKey] = useState<SortKey>("impliedPoints");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [query, setQuery] = useState("");
  const baseTeams = researchModels.teamResearch.teams;
  const rows = useMemo(() => baseTeams.map((team) => {
    const assets = players.filter((player) => normalizeTeam(player.team) === team.abbr && ["QB", "RB", "WR", "TE", "K"].includes(player.pos)).sort((a, b) => ppg(b) - ppg(a));
    const quarterbacks = assets.filter((player) => player.pos === "QB");
    const projectedQbPpg = quarterbacks[0] ? ppg(quarterbacks[0]) : 0;
    const topFivePpg = assets.slice(0, 5).reduce((sum, player) => sum + ppg(player), 0);
    const pointsValues = baseTeams.map((entry) => entry.impliedPoints);
    const pointsPercentile = (team.impliedPoints - Math.min(...pointsValues)) / Math.max(.01, Math.max(...pointsValues) - Math.min(...pointsValues)) * 100;
    const qbContext = team.olScore * .45 + team.historicalProtectionIndex * .25 + pointsPercentile * .30;
    return { ...team, projectedQbPpg, topFivePpg, qbContext, assets: assets.slice(0, 5), quarterback: quarterbacks[0] };
  }), [players, baseTeams]);
  const forwardRows = rows.filter((row) => row.projectedQbPpg > 0);
  const forwardCorrelation = pearson(forwardRows.map((row) => row.olScore), forwardRows.map((row) => row.projectedQbPpg));
  const historicalCorrelation = researchModels.teamResearch.correlations.protectionIndexToTeamQbPpg;
  const sorted = rows.filter((row) => !query || `${row.name} ${row.abbr} ${row.assets.map((asset) => asset.name).join(" ")}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => {
    const value = (row: typeof a) => sortKey === "olRank" ? row.olRank : sortKey === "qbContext" ? row.qbContext : sortKey === "projectedQbPpg" ? row.projectedQbPpg : sortKey === "topFivePpg" ? row.topFivePpg : sortKey === "historicalProtection" ? row.historicalProtectionIndex : sortKey === "historicalQbPpg" ? row.historicalTeamQbPpg : row.impliedPoints;
    return (value(a) - value(b)) * (direction === "asc" ? 1 : -1);
  });
  const topOffense = [...rows].sort((a, b) => b.impliedPoints - a.impliedPoints)[0];
  const topLine = [...rows].sort((a, b) => a.olRank - b.olRank)[0];

  return <section className={`workspace team-research-workspace ${compact ? "compact" : ""}`}>
    <div className="section-heading"><div><p className="eyebrow">OFFENSIVE PRODUCTION & LINE PLAY</p><h2>Projected team scoring, protection, and QB context</h2></div><p>Team NFL PPG comes from the 2026 betting-market environment. Fantasy PPG and QB PPG are recalculated for the scoring rules in the league room you are viewing.</p></div>
    <div className="team-model-summary">
      <article><span>2025 EMPIRICAL LINK</span><strong>r = {historicalCorrelation.toFixed(2)}</strong><small>{relationship(historicalCorrelation)} · protection index vs. team QB fantasy PPG · n={researchModels.teamResearch.correlations.sampleSize}</small></article>
      <article><span>2026 FORWARD LINK</span><strong>r = {forwardCorrelation.toFixed(2)}</strong><small>{relationship(forwardCorrelation)} · Sharp O-line score vs. current projected QB PPG · n={forwardRows.length}</small></article>
      <article><span>TOP PROJECTED OFFENSE</span><strong>{topOffense.abbr} · {topOffense.impliedPoints.toFixed(2)}</strong><small>projected NFL points per game · environment rank #{topOffense.environmentRank}</small></article>
      <article><span>TOP OFFENSIVE LINE</span><strong>{topLine.abbr} · #{topLine.olRank}</strong><small>Sharp 2026 forecast · support score {topLine.olScore}/100</small></article>
    </div>
    <div className="model-callout"><strong>How to use this:</strong><span>The historical relationship is positive but only moderate, so line play is a QB/RB tiebreaker—not permission to override talent, rushing production, scheme, or draft price. Correlation does not prove causation.</span></div>
    <div className="team-research-controls"><label><span>Filter team or asset</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search team, QB, RB, WR…" /></label><label><span>Sort by</span><select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}><option value="impliedPoints">Projected NFL PPG</option><option value="olRank">2026 O-line rank</option><option value="qbContext">QB context score</option><option value="projectedQbPpg">Projected QB PPG</option><option value="topFivePpg">Top-five fantasy PPG</option><option value="historicalProtection">2025 protection index</option><option value="historicalQbPpg">2025 team QB PPG</option></select></label><button onClick={() => setDirection((current) => current === "asc" ? "desc" : "asc")}><span>Direction</span><b>{direction === "asc" ? "Ascending ↑" : "Descending ↓"}</b></button></div>
    <div className="team-research-table-wrap"><table className="team-research-table"><thead><tr><th>Team</th><th>Proj. NFL PPG</th><th>Env.</th><th>2026 OL</th><th>QB context</th><th>Proj. QB PPG</th><th>Top-5 fantasy PPG</th><th>2025 sack avoid</th><th>2025 hit avoid</th><th>2025 protect</th><th>2025 QB PPG</th><th>Key assets</th></tr></thead><tbody>{sorted.map((row) => <tr key={row.abbr}><td><strong>{row.abbr}</strong><small>{row.name}</small></td><td><b>{row.impliedPoints.toFixed(2)}</b></td><td>#{row.environmentRank}<small>{row.environmentScore > 0 ? "+" : ""}{row.environmentScore.toFixed(2)}</small></td><td><b>#{row.olRank}</b><small>{row.olScore}/100</small></td><td><div className="mini-score"><i style={{ width: `${row.qbContext}%` }}/><b>{row.qbContext.toFixed(0)}</b></div></td><td><b>{row.projectedQbPpg ? row.projectedQbPpg.toFixed(1) : "—"}</b><small>{row.quarterback?.name || "No ranked QB"}</small></td><td><b>{row.topFivePpg.toFixed(1)}</b></td><td>{row.sackAvoidanceRate.toFixed(1)}%</td><td>{row.hitAvoidanceRate.toFixed(1)}%</td><td>{row.historicalProtectionIndex.toFixed(0)}</td><td>{row.historicalTeamQbPpg.toFixed(1)}</td><td className="team-assets">{row.assets.map((asset) => `${asset.name} ${ppg(asset).toFixed(1)}`).join(" · ") || "No mapped assets"}</td></tr>)}</tbody></table></div>
    <footer className="context-sources"><span>Research refreshed {timeLabel(generatedAt || researchModels.generatedAt)}</span>{researchModels.sources.slice(0, 6).map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.name}>{source.name} ↗</a>)}</footer>
  </section>;
}
