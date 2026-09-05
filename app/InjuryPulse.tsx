"use client";

type InjuryPlayer = {
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
};

function dateLabel(value?: string | null) {
  if (!value) return "Live provider status";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function InjuryPulse({ players, compact = false, open }: { players: InjuryPlayer[]; compact?: boolean; open?: (id: string) => void }) {
  const allAffected = players.filter((player) => player.injuryHeadline && player.injuryStatus !== "ACTIVE").sort((a, b) => Number(b.injuryRankPenalty || 0) - Number(a.injuryRankPenalty || 0));
  const affected = allAffected.slice(0, compact ? 6 : 12);
  if (!allAffected.length) return null;
  return <section className={`injury-pulse ${compact ? "compact" : ""}`}>
    <header><div><span>INJURY-AWARE LIVE BOARD</span><strong>{allAffected.length} current health flags in this view</strong></div><p>Highest-impact updates are shown first. Official Boris tier stays visible; live rank, live tier, and weekly expectation apply the newer availability adjustment.</p></header>
    <div>{affected.map((player) => <article key={player.id}>
      <button onClick={() => open?.(player.id)} disabled={!open}><span className="injury-status">{player.injuryStatus}</span><b>{player.name}</b><small>{player.team} · {player.pos}</small></button>
      <p>{player.injuryHeadline}</p>
      <dl><div><dt>Live / consensus</dt><dd>#{player.rank} / #{player.consensusRank || "—"}</dd></div><div><dt>Expected / active PPG</dt><dd>{player.projectedPPG?.toFixed(1) ?? "—"} / {player.activeGamePPG?.toFixed(1) ?? "—"}</dd></div></dl>
      <footer><span>{dateLabel(player.injuryUpdatedAt)}</span>{player.injurySource && <a href={player.injurySource} target="_blank" rel="noreferrer">Report ↗</a>}</footer>
    </article>)}</div>
    {allAffected.length > affected.length && <p className="injury-more-note">Showing {affected.length} highest-impact updates; {allAffected.length - affected.length} additional provider flags remain applied in player rows and details.</p>}
  </section>;
}
