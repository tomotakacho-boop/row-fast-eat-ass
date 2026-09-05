"use client";

import { getLeagueResearch, getPlayerResearch, getResearchSource, publicDraftResearch, ResearchLeagueKey } from "./draftResearch";

export function DraftResearchPanel({ leagueKey }: { leagueKey: ResearchLeagueKey }) {
  const league = getLeagueResearch(leagueKey);
  const targets = league.targetNames.flatMap((name) => {
    const player = getPlayerResearch(name);
    return player ? [player] : [];
  });
  return <section className="draft-research-panel">
    <header>
      <div><p className="eyebrow">PUBLIC RESEARCH · {publicDraftResearch.asOf}</p><h3>{league.label} strategy overlay</h3><span>{league.format}</span></div>
      <strong>{targets.length}<small>format fits</small></strong>
    </header>
    <div className="draft-research-priorities">{league.priorities.map((priority, index) => <article key={priority}><b>{index + 1}</b><p>{priority}</p></article>)}</div>
    <div className="draft-research-targets">{targets.map((player) => {
      const source = getResearchSource(player.sources[0]);
      return <article key={player.player}>
        <div><span className={`pos pos-${player.pos}`}>{player.pos}</span><b>{player.player}</b><em>{player.evidence} evidence</em></div>
        <p>{player.use}</p>
        <small>{player.action.join(" · ").replaceAll("_", " ")} · board gap {player.valueGap > 0 ? "+" : ""}{player.valueGap.toFixed(1)}</small>
        {source && <a href={source.url} target="_blank" rel="noreferrer">{source.publisher} ↗</a>}
      </article>;
    })}</div>
    <p className="draft-research-caveat">Research adjusts recommendations modestly; it never overrides health, viable draft price, roster limits, or your personal Like/Avoid tags. WATCH and AVOID HYPE players are not promoted without stronger role evidence.</p>
  </section>;
}
