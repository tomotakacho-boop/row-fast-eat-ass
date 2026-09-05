import { getLeagueWinner, leagueWinnerSource } from "./leagueWinners";

type FlockPlayer = {
  name: string;
  rank: number;
  consensusRank?: number | null;
  flockRank?: number | null;
  flockAdjustedRank?: number | null;
  flockTier?: string | null;
  flockWrRank?: number | null;
  flockWrTier?: string | null;
  flockMovement?: "riser" | "faller" | string | null;
  flockMovementPoints?: number | null;
  flockHeadline?: string | null;
  flockDetail?: string | null;
  flockReportedAt?: string | null;
  flockSource?: string | null;
  flockVerification?: string | null;
  flockVerificationSource?: string | null;
  leagueModel?: string | null;
  leagueRankDelta?: number | null;
  replacementPPG?: number | null;
  valueOverReplacementPPG?: number | null;
  projectionValueRank?: number | null;
};

function rank(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : `#${Math.round(value)}`;
}

function signed(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export function FlockPlayerContext({ player }: { player: FlockPlayer }) {
  const hasFlock = player.flockRank != null || player.flockWrRank != null || player.flockHeadline;
  const leagueWinner = getLeagueWinner(player.name);
  const winnerSource = leagueWinner ? leagueWinnerSource(leagueWinner) : null;
  if (!hasFlock && !leagueWinner) return null;
  const direction = ["riser", "up"].includes(player.flockMovement || "") ? "UP" : ["faller", "down"].includes(player.flockMovement || "") ? "DOWN" : "BASELINE";
  const movementMeaning = Number(player.flockMovementPoints || 0) < 0 ? "boost" : Number(player.flockMovementPoints || 0) > 0 ? "fade" : "neutral";
  return <>{hasFlock && <section className={`flock-player-context flock-${movementMeaning}`}>
    <header>
      <div><span>FLOCK + LEAGUE MODEL</span><strong>{player.leagueModel || "League-adjusted ranking"}</strong></div>
      <em>{direction}</em>
    </header>
    <div className="flock-metrics">
      <span><b>{rank(player.flockRank)}</b><small>TOP 100</small></span>
      <span><b>{player.flockTier || "—"}</b><small>FLOCK TIER</small></span>
      <span><b>{rank(player.flockWrRank)}</b><small>NEW WR RANK</small></span>
      <span><b>{rank(player.rank)}</b><small>LEAGUE RANK</small></span>
      <span><b>{signed(player.leagueRankDelta, 0)}</b><small>VS CONSENSUS</small></span>
      <span><b>{signed(player.valueOverReplacementPPG)}</b><small>PPG OVER REPL.</small></span>
    </div>
    {player.flockHeadline && <div className="flock-thesis"><b>{player.flockHeadline}</b><p>{player.flockDetail}</p><small>Movement signal dated {player.flockReportedAt || "source publication"} · rank adjustment {signed(player.flockMovementPoints, 0)} spots</small></div>}
    {player.flockVerification && <div className="flock-verification"><span>CURRENT CHECK</span><p>{player.flockVerification}</p></div>}
    <footer>
      {player.flockSource && <a href={player.flockSource} target="_blank" rel="noreferrer">Flock source ↗</a>}
      {player.flockVerificationSource && <a href={player.flockVerificationSource} target="_blank" rel="noreferrer">Current report ↗</a>}
      <small>Opinion anchor + current consensus + league scoring, scarcity, projections, availability, and replacement value.</small>
    </footer>
  </section>}{leagueWinner && <section className="league-winner-context">
    <header><div><span>LEAGUE WINNER</span><strong>{leagueWinner.targetRounds}</strong></div><em>{leagueWinner.confidence}</em></header>
    <div><b>{leagueWinner.thesis}</b><p>{leagueWinner.evidence}</p><small><strong>Risk:</strong> {leagueWinner.risk}</small></div>
    <footer>{winnerSource && <a href={winnerSource.url} target="_blank" rel="noreferrer">{winnerSource.publisher} source ↗</a>}<small>Price-sensitive upside signal; league rank, ADP, health, keeper availability, and roster construction still control the recommendation.</small></footer>
  </section>}</>;
}
