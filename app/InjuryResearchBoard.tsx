"use client";

import { useMemo, useState } from "react";
import researchModels from "../public/data/research-models.json";
import { InjuryPulse } from "./InjuryPulse";

export type InjuryResearchPlayer = {
  id: string;
  name: string;
  team: string;
  pos: string;
  rank: number;
  consensusRank?: number | null;
  projectedPPG?: number | null;
  activeGamePPG?: number | null;
  injuryStatus?: string | null;
  injuryHeadline?: string | null;
  injuryDetail?: string | null;
  injurySource?: string | null;
  injuryUpdatedAt?: string | null;
  injuryRankPenalty?: number | null;
  injuryRiskScore?: number | null;
  injuryRiskBand?: string | null;
  injuryRiskConfidence?: number | null;
  age?: number | null;
  yearsExperience?: number | null;
  injuryRiskComponents?: { history?: number; recurrence?: number; current?: number; ageExperience?: number; workload?: number; positionBaseline?: number } | null;
  injuryHistory?: { reportWeeks?: number; severeReportWeeks?: number; seasonsAffected?: number; topBodyParts?: Array<{ body: string; count: number }>; recurringBodyParts?: Array<{ body: string; count: number }> } | null;
};

type SortKey = "risk" | "rank" | "history" | "current" | "age" | "confidence";

const riskOrder: Record<string, number> = { Severe: 5, High: 4, Elevated: 3, Moderate: 2, Low: 1, "Unit N/A": 0 };

function currentSeverity(player: InjuryResearchPlayer) {
  const label = String(player.injuryStatus || "ACTIVE").toUpperCase();
  if (label.includes("IR") || label.includes("PUP") || label.includes("OUT")) return 100;
  if (label.includes("DOUBT")) return 76;
  if (label.includes("QUESTION")) return 45;
  if (label.includes("LIMIT")) return 28;
  return 0;
}

function topDrivers(player: InjuryResearchPlayer) {
  const labels: Record<string, string> = { history: "prior reports", recurrence: "recurrence", current: "current status", ageExperience: "age/experience", workload: "projected workload", positionBaseline: "position exposure" };
  const entries = Object.entries(player.injuryRiskComponents || {}).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 2);
  return entries.length ? entries.map(([key]) => labels[key] || key).join(" + ") : "limited history signal";
}

function bodyLabel(player: InjuryResearchPlayer) {
  const parts = player.injuryHistory?.topBodyParts || [];
  return parts.length ? parts.slice(0, 2).map((entry) => `${entry.body} ×${entry.count}`).join(" · ") : "No qualifying 2021–24 reports";
}

export function InjuryResearchBoard({ players, generatedAt, open }: { players: InjuryResearchPlayer[]; generatedAt?: string; open?: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("ALL");
  const [band, setBand] = useState("ALL");
  const [currentOnly, setCurrentOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("risk");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const current = players.filter((player) => player.injuryHeadline && String(player.injuryStatus || "ACTIVE").toUpperCase() !== "ACTIVE");
  const modeled = players.filter((player) => player.pos !== "DST" && player.injuryRiskScore != null);
  const highRisk = modeled.filter((player) => Number(player.injuryRiskScore) >= 65);
  const averageRisk = modeled.reduce((sum, player) => sum + Number(player.injuryRiskScore || 0), 0) / Math.max(1, modeled.length);
  const highest = [...modeled].sort((a, b) => Number(b.injuryRiskScore) - Number(a.injuryRiskScore)).slice(0, 5);
  const filtered = useMemo(() => players.filter((player) => {
    if (query && !`${player.name} ${player.team} ${player.pos} ${player.injuryHeadline || ""} ${bodyLabel(player)}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (position !== "ALL" && player.pos !== position) return false;
    if (band !== "ALL" && player.injuryRiskBand !== band) return false;
    if (currentOnly && currentSeverity(player) === 0) return false;
    return true;
  }).sort((a, b) => {
    const value = (player: InjuryResearchPlayer) => sortKey === "rank" ? player.rank : sortKey === "history" ? Number(player.injuryHistory?.reportWeeks || 0) : sortKey === "current" ? currentSeverity(player) : sortKey === "age" ? Number(player.age || 0) : sortKey === "confidence" ? Number(player.injuryRiskConfidence || 0) : Number(player.injuryRiskScore || 0);
    const delta = value(a) - value(b);
    return (delta || riskOrder[a.injuryRiskBand || ""] - riskOrder[b.injuryRiskBand || ""] || a.name.localeCompare(b.name)) * (direction === "asc" ? 1 : -1);
  }), [players, query, position, band, currentOnly, sortKey, direction]);

  return <section className="workspace injury-research-workspace">
    <div className="section-heading"><div><p className="eyebrow">INJURY UPDATES & DURABILITY</p><h2>Current availability plus a transparent 0–100 risk index</h2></div><p>This is a draft-management signal, not medical advice. A 100 means the model sees the strongest combined risk evidence—not that injury is certain.</p></div>
    <div className="injury-model-summary"><article><span>CURRENT FLAGS</span><strong>{current.length}</strong><small>provider or curated updates affecting this board</small></article><article><span>HIGH / SEVERE</span><strong>{highRisk.length}</strong><small>players at 65+ on the relative durability index</small></article><article><span>POOL AVERAGE</span><strong>{averageRisk.toFixed(0)}</strong><small>among {modeled.length} individual players</small></article><article><span>HISTORY WINDOW</span><strong>{researchModels.durability.seasons[0]}–{researchModels.durability.seasons.at(-1)}</strong><small>weekly nflverse injury reports</small></article></div>
    {current.length > 0 && <InjuryPulse players={players} open={open}/>} 
    <section className="risk-leaders"><div><p className="eyebrow">HIGHEST CURRENT MODEL SIGNALS</p><h3>Review price and replacement plan before drafting</h3></div><div>{highest.map((player) => <button onClick={() => open?.(player.id)} key={player.id}><span className={`risk-badge risk-${String(player.injuryRiskBand).toLowerCase()}`}>{player.injuryRiskScore}</span><b>{player.name}</b><small>{player.team} · {player.pos} · {player.injuryRiskBand}</small><em>{topDrivers(player)}</em></button>)}</div></section>
    <div className="injury-controls"><label><span>Search player or injury</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search player, team, body part…" /></label><label><span>Position</span><select value={position} onChange={(event) => setPosition(event.target.value)}>{["ALL", "QB", "RB", "WR", "TE", "K", "DST"].map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Risk band</span><select value={band} onChange={(event) => setBand(event.target.value)}>{["ALL", "Severe", "High", "Elevated", "Moderate", "Low", "Unit N/A"].map((item) => <option key={item}>{item}</option>)}</select></label><label className="current-only"><input type="checkbox" checked={currentOnly} onChange={(event) => setCurrentOnly(event.target.checked)} /><span>Current flags only</span></label><label><span>Sort by</span><select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}><option value="risk">Risk index</option><option value="rank">Live rank</option><option value="history">Historical report weeks</option><option value="current">Current severity</option><option value="age">Age</option><option value="confidence">Model confidence</option></select></label><button onClick={() => setDirection((value) => value === "asc" ? "desc" : "asc")}><span>Direction</span><b>{direction === "asc" ? "Ascending ↑" : "Descending ↓"}</b></button></div>
    <div className="injury-table-wrap"><table className="injury-research-table"><thead><tr><th>Player</th><th>Risk</th><th>Band</th><th>Current</th><th>2021–24 history</th><th>Common listings</th><th>Age / exp.</th><th>Top drivers</th><th>Confidence</th><th>Live RK</th></tr></thead><tbody>{filtered.map((player) => <tr key={player.id}><td><button onClick={() => open?.(player.id)} disabled={!open}><b>{player.name}</b><small>{player.team} · {player.pos}</small></button></td><td>{player.pos === "DST" ? <strong>—</strong> : <div className="risk-score-cell"><strong>{player.injuryRiskScore ?? "—"}</strong><i><em style={{ width: `${player.injuryRiskScore || 0}%` }}/></i></div>}</td><td><span className={`risk-band risk-${String(player.injuryRiskBand).toLowerCase()}`}>{player.injuryRiskBand || "—"}</span></td><td><b>{player.injuryStatus || "ACTIVE"}</b><small>{player.injuryHeadline || "No current provider flag"}</small></td><td><b>{player.injuryHistory?.reportWeeks || 0} weeks</b><small>{player.injuryHistory?.severeReportWeeks || 0} severe · {player.injuryHistory?.seasonsAffected || 0} seasons</small></td><td>{bodyLabel(player)}</td><td>{player.age || "—"} / {player.yearsExperience ?? "—"}<small>years old / NFL experience</small></td><td>{player.pos === "DST" ? "Team unit—not individually modeled" : topDrivers(player)}</td><td>{player.injuryRiskConfidence ?? "—"}%</td><td>#{player.rank}</td></tr>)}</tbody></table></div>
    <section className="injury-methodology"><div><p className="eyebrow">MODEL METHODOLOGY</p><h3>Weighted evidence, with uncertainty left visible</h3><p>{researchModels.durability.disclaimer}</p></div><dl>{Object.entries(researchModels.durability.weights).map(([key, weight]) => <div key={key}><dt>{weight}%</dt><dd>{({ historicalBurden: "Historical report burden", recurrence: "Repeated listings / recurrence", currentStatus: "Current availability status", ageExperience: "Age and NFL experience", projectedWorkload: "Projected workload exposure", positionBaseline: "Position baseline" } as Record<string, string>)[key]}</dd></div>)}</dl><p>Historical burden uses severity-weighted report weeks with more weight on recent seasons. Recurrence emphasizes repeated body-part listings. Workload is a within-position percentile. Rookies and players with sparse records receive lower confidence rather than being treated as perfectly healthy.</p></section>
    <footer className="context-sources"><span>Model {researchModels.durability.modelVersion} · data assembled {new Date(generatedAt || researchModels.generatedAt).toLocaleString()}</span>{researchModels.sources.filter((source) => source.name.includes("injury") || source.name.includes("Sleeper") || source.name.includes("hamstring")).map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.name}>{source.name} ↗</a>)}</footer>
  </section>;
}
