"use client";

import { useMemo, useState } from "react";
import expertWatchlistData from "../public/data/expert-watchlist.json";
import { getPlayerResearch, getResearchSource } from "./draftResearch";
import { getPotentialDiamond } from "./potentialDiamonds";
import { getLeagueWinner, leagueWinnerSource } from "./leagueWinners";

export type WatchlistPlayer = {
  id: string;
  name: string;
  team: string;
  pos: string;
  posRank?: string | null;
  rank: number;
  adp?: number | null;
  projectedPoints?: number | null;
  projectedPPG?: number | null;
  projectedGames?: number | null;
  rankStdDev?: number | null;
  rookieRank?: number | null;
};

export type WatchlistNote = {
  liked?: boolean;
  avoid?: boolean;
  diamond?: boolean;
  rookie?: boolean;
  rookieExcluded?: boolean;
  note?: string;
  expertSentiment?: "like" | "avoid";
  expertReason?: string;
  expertSource?: string;
};

type ExpertResearch = { player: string; reason: string; url: string };

function normalizedName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const expertLikes = new Map((expertWatchlistData.likes as ExpertResearch[]).map((entry) => [normalizedName(entry.player), entry]));
const expertAvoids = new Map((expertWatchlistData.avoids as ExpertResearch[]).map((entry) => [normalizedName(entry.player), entry]));

function researchFor(player: WatchlistPlayer, note: WatchlistNote) {
  if (note.expertReason || note.expertSource) return { reason: note.expertReason, url: note.expertSource };
  if (note.avoid) return expertAvoids.get(normalizedName(player.name));
  if (note.liked) return expertLikes.get(normalizedName(player.name));
  return undefined;
}

function number(value: number | null | undefined, digits = 0) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function playerPPG(player: WatchlistPlayer) {
  return player.projectedPPG ?? (player.projectedPoints == null ? null : player.projectedPoints / (player.projectedGames || 17));
}

function playerConfidence(player: WatchlistPlayer) {
  return Math.max(0, Math.min(100, 100 - (player.rankStdDev ?? 24) * 2));
}

export function UnifiedWatchlist({ players, notes, onUpdate, onOpen, scoringLabel }: {
  players: WatchlistPlayer[];
  notes: Record<string, WatchlistNote>;
  onUpdate: (id: string, patch: Partial<WatchlistNote>) => void;
  onOpen: (id: string) => void;
  scoringLabel: string;
}) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("ALL");
  const [tag, setTag] = useState("ALL");
  const [sort, setSort] = useState("rank");
  const tagged = useMemo(() => players.filter((player) => {
    const note = notes[player.id] || {};
    const rookie = Boolean(note.rookie || (player.rookieRank && !note.rookieExcluded));
    return note.liked || note.avoid || note.diamond || rookie || Boolean(getPlayerResearch(player.name)) || Boolean(getPotentialDiamond(player.name)) || Boolean(getLeagueWinner(player.name));
  }), [players, notes]);
  const visible = useMemo(() => tagged.filter((player) => {
    const note = notes[player.id] || {};
    const research = researchFor(player, note);
    const publicResearch = getPlayerResearch(player.name);
    const diamond = getPotentialDiamond(player.name);
    const leagueWinner = getLeagueWinner(player.name);
    const rookie = Boolean(note.rookie || (player.rookieRank && !note.rookieExcluded));
    if (position !== "ALL" && player.pos !== position) return false;
    if (tag === "LIKE" && !note.liked) return false;
    if (tag === "AVOID" && !note.avoid) return false;
    if (tag === "ROOKIE" && !rookie) return false;
    if (tag === "DIAMOND" && !(note.diamond || diamond)) return false;
    if (tag === "LEAGUE_WINNER" && !leagueWinner) return false;
    if (tag === "RESEARCH" && !publicResearch) return false;
    return !query || `${player.name} ${player.team} ${player.pos} ${research?.reason || ""} ${publicResearch?.bullCase || ""} ${publicResearch?.risk || ""} ${publicResearch?.action.join(" ") || ""} ${diamond?.keeperThesis || ""} ${diamond?.risk || ""} ${leagueWinner?.thesis || ""} ${leagueWinner?.evidence || ""} ${leagueWinner?.risk || ""} ${note.note || ""}`.toLowerCase().includes(query.toLowerCase());
  }).sort((a, b) => sort === "adp" ? Number(a.adp ?? 999) - Number(b.adp ?? 999) : sort === "ppg" ? Number(playerPPG(b) ?? 0) - Number(playerPPG(a) ?? 0) : a.rank - b.rank), [tagged, notes, position, tag, query, sort]);

  return <section className="workspace unified-watch-workspace">
    <div className="section-heading"><div><p className="eyebrow">LIKE · AVOID · LEAGUE WINNER · POTENTIAL DIAMOND · ROOKIE · RESEARCH</p><h2>One actionable player watchlist</h2></div><p>Personal tags and sourced League Winner signals remain synchronized across all five leagues. Potential Diamond marks NYFL future keeper-cost upside; ranks and projections use {scoringLabel}.</p></div>
    <div className="watchlist-legend"><span className="like">LIKE · your priorities</span><span className="avoid">AVOID · your passes</span><span className="league-winner">LEAGUE WINNER · sourced upside target</span><span className="diamond">◆ DIAMOND · future keeper surplus</span><span className="rookie">ROOKIE · first-year board</span><span className="research">RESEARCH · sourced signal, not your tag</span></div>
    <div className="unified-watch-filters">
      <label className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search watched players or rationale…" /></label>
      <label><span>Position</span><select value={position} onChange={(event) => setPosition(event.target.value)}>{["ALL", "QB", "RB", "WR", "TE", "K", "DST"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>Reason</span><select value={tag} onChange={(event) => setTag(event.target.value)}><option value="ALL">All reasons</option><option value="LIKE">Like</option><option value="AVOID">Avoid</option><option value="LEAGUE_WINNER">League winner</option><option value="DIAMOND">Potential diamond</option><option value="ROOKIE">Rookie</option><option value="RESEARCH">Public research</option></select></label>
      <label><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="rank">Expert rank</option><option value="adp">ADP</option><option value="ppg">Projected PPG</option></select></label>
    </div>
    <div className="unified-watch-summary"><strong>{visible.length}</strong><span>shown</span><b>{tagged.length}</b><span>tagged players</span></div>
    <div className="table-wrap unified-watch-table-wrap"><table className="unified-watch-table">
      <thead><tr><th>RK</th><th>Player</th><th>Why it is here</th><th>Tags</th><th>ADP</th><th>Δ</th><th>Proj.</th><th>PPG</th><th>Conf.</th><th>Notes</th><th /></tr></thead>
      <tbody>{visible.map((player) => {
        const note = notes[player.id] || {};
        const research = researchFor(player, note);
        const publicResearch = getPlayerResearch(player.name);
        const diamond = getPotentialDiamond(player.name);
        const leagueWinner = getLeagueWinner(player.name);
        const winnerSource = leagueWinner ? leagueWinnerSource(leagueWinner) : undefined;
        const publicSource = publicResearch ? getResearchSource(publicResearch.sources[0]) : undefined;
        const rookie = Boolean(note.rookie || (player.rookieRank && !note.rookieExcluded));
        const reasons = [note.liked && "Priority target", note.avoid && "Avoid at current price", leagueWinner && `League winner · ${leagueWinner.targetRounds} · ${leagueWinner.confidence}`, (note.diamond || diamond) && `Potential diamond${diamond ? ` · ${diamond.score}/100 · target ${diamond.targetRounds}` : ""}`, rookie && `Rookie board${player.rookieRank ? ` · rookie #${player.rookieRank}` : ""}`, publicResearch && `${publicResearch.action.join(" · ").replaceAll("_", " ")} · ${publicResearch.evidence}`].filter(Boolean);
        const rowClass = note.avoid ? "player-flag-avoid" : leagueWinner ? "player-flag-league-winner" : (note.diamond || diamond) ? "player-flag-diamond" : note.liked ? "player-flag-like" : rookie ? "player-flag-rookie" : "player-research-row";
        const delta = player.adp == null ? null : player.adp - player.rank;
        return <tr className={rowClass} key={player.id}>
          <td className="rank">{player.rank}</td>
          <td className="player-cell"><button onClick={() => onOpen(player.id)}><strong>{player.name}</strong><small>{player.team} · {player.posRank || player.pos}</small></button></td>
          <td className="watch-reason"><b>{reasons.join(" · ")}</b><span>{leagueWinner?.thesis || diamond?.keeperThesis || publicResearch?.bullCase || research?.reason || note.note || (note.avoid ? "Your shared avoid list" : note.liked ? "Your shared target list" : "Tracked as a rookie")}</span>{leagueWinner && <small><strong>Evidence:</strong> {leagueWinner.evidence}</small>}{leagueWinner && <small><strong>Risk:</strong> {leagueWinner.risk}</small>}{!leagueWinner && diamond && <small><strong>2026 path:</strong> {diamond.redraftPath}</small>}{!leagueWinner && diamond && <small><strong>Risk:</strong> {diamond.risk}</small>}{!leagueWinner && !diamond && publicResearch && <small><strong>Risk:</strong> {publicResearch.risk}</small>}{leagueWinner && winnerSource ? <a href={winnerSource.url} target="_blank" rel="noreferrer">{winnerSource.publisher} ↗</a> : diamond ? <a href={diamond.sources[0].url} target="_blank" rel="noreferrer">{diamond.sources[0].publisher} ↗</a> : publicSource ? <a href={publicSource.url} target="_blank" rel="noreferrer">{publicSource.publisher} ↗</a> : research?.url && <a href={research.url} target="_blank" rel="noreferrer">Research ↗</a>}</td>
          <td><div className="watch-tag-buttons"><button className={`like ${note.liked ? "active" : ""}`} onClick={() => onUpdate(player.id, { liked: !note.liked, avoid: note.liked ? note.avoid : false })}>Like</button><button className={`avoid ${note.avoid ? "active" : ""}`} onClick={() => onUpdate(player.id, { avoid: !note.avoid, liked: note.avoid ? note.liked : false })}>Avoid</button>{leagueWinner && <span className="league-winner active">League winner</span>}<button className={`diamond ${note.diamond ? "active" : ""}`} onClick={() => onUpdate(player.id, { diamond: !note.diamond })}>Diamond</button><button className={`rookie ${rookie ? "active" : ""}`} onClick={() => onUpdate(player.id, rookie ? { rookie: false, rookieExcluded: true } : { rookie: true, rookieExcluded: false })}>Rookie</button></div></td>
          <td>{number(player.adp, 1)}</td><td>{delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`}</td><td>{number(player.projectedPoints, 1)}</td><td><strong>{number(playerPPG(player), 1)}</strong></td><td>{playerConfidence(player).toFixed(0)}%</td>
          <td className="watch-note-cell"><input aria-label={`${player.name} watchlist note`} value={note.note || ""} onChange={(event) => onUpdate(player.id, { note: event.target.value })} placeholder="Add your reason…" /></td>
          <td><button className="icon-button" onClick={() => onOpen(player.id)}>›</button></td>
        </tr>;
      })}</tbody>
    </table>{!visible.length && <div className="empty-state">No watched players match these filters.</div>}</div>
  </section>;
}
