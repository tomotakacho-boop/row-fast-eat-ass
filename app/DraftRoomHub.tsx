"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { getPotentialDiamond } from "./potentialDiamonds";
import { getLeagueWinner } from "./leagueWinners";

type DraftRoomPlayer = {
  id: string;
  name: string;
  team: string;
  pos: string;
  posRank?: string | null;
  rank: number;
  adp?: number | null;
  tier?: number | null;
  projectedPoints?: number | null;
  projectedPPG?: number | null;
  projectedGames?: number | null;
  rankStdDev?: number | null;
  bestRank?: number | null;
  worstRank?: number | null;
  dynastyRank?: number | null;
  rookieRank?: number | null;
  injuryStatus?: string | null;
  injuryHeadline?: string | null;
  injuryUpdatedAt?: string | null;
  injuryRiskScore?: number | null;
  injuryRiskBand?: string | null;
};

type DraftRoomNote = {
  liked?: boolean;
  avoid?: boolean;
  diamond?: boolean;
  rookie?: boolean;
  status?: string;
};

type IntelPanel = "rankings" | "watchlist" | "durability";
type RoomView = "simulator" | "research";

type Props = {
  players: DraftRoomPlayer[];
  notes: Record<string, DraftRoomNote | undefined>;
  generatedAt?: string | null;
  simulator: ReactNode | ((onDraftStateChange: (draftedPlayerIds: string[]) => void) => ReactNode);
  research: ReactNode | ((draftedPlayerIds: ReadonlySet<string>) => ReactNode);
  onOpen: (playerId: string) => void;
};

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DST"];

function fmt(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function ppg(player: DraftRoomPlayer) {
  return player.projectedPPG ?? (player.projectedPoints == null ? null : player.projectedPoints / (player.projectedGames || 17));
}

function confidence(player: DraftRoomPlayer) {
  return Math.max(0, Math.min(100, 100 - (player.rankStdDev || 24) * 2));
}

function watchLabels(player: DraftRoomPlayer, note?: DraftRoomNote) {
  const labels: { id: string; label: string }[] = [];
  if (note?.liked) labels.push({ id: "like", label: "Like" });
  if (note?.avoid || (player.injuryRiskScore || 0) >= 75) labels.push({ id: "avoid", label: "Avoid" });
  if (getLeagueWinner(player.name)) labels.push({ id: "league-winner", label: "League winner" });
  if (note?.diamond || getPotentialDiamond(player.name)) labels.push({ id: "diamond", label: "Diamond" });
  if (note?.rookie || player.rookieRank) labels.push({ id: "rookie", label: "Rookie" });
  return labels;
}

function watchRowClass(labels: ReturnType<typeof watchLabels>) {
  if (labels.some((tag) => tag.id === "avoid")) return "avoid";
  if (labels.some((tag) => tag.id === "league-winner")) return "league-winner";
  if (labels.some((tag) => tag.id === "diamond")) return "diamond";
  if (labels.some((tag) => tag.id === "like")) return "like";
  if (labels.some((tag) => tag.id === "rookie")) return "rookie";
  return "";
}

export function DraftRoomHub({ players, notes, generatedAt, simulator, research, onOpen }: Props) {
  const [roomView, setRoomView] = useState<RoomView>("simulator");
  const [intelPanel, setIntelPanel] = useState<IntelPanel | null>(null);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("ALL");
  const [watchFilter, setWatchFilter] = useState("ALL");
  const [draftedPlayerIds, setDraftedPlayerIds] = useState<string[]>([]);

  const handleDraftStateChange = useCallback((nextIds: string[]) => {
    setDraftedPlayerIds((current) => current.length === nextIds.length && current.every((id, index) => id === nextIds[index]) ? current : nextIds);
  }, []);

  const draftedPlayerIdSet = useMemo(() => new Set(draftedPlayerIds), [draftedPlayerIds]);

  useEffect(() => {
    if (!intelPanel) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setIntelPanel(null);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [intelPanel]);

  useEffect(() => {
    setSearch("");
    setPosition("ALL");
    setWatchFilter("ALL");
  }, [intelPanel]);

  const availablePlayers = useMemo(
    () => players.filter((player) => notes[player.id]?.status !== "taken" && !draftedPlayerIdSet.has(player.id)).sort((a, b) => a.rank - b.rank),
    [draftedPlayerIdSet, notes, players],
  );
  const watchPlayers = useMemo(
    () => availablePlayers.filter((player) => watchLabels(player, notes[player.id]).length > 0),
    [availablePlayers, notes],
  );
  const durabilityPlayers = useMemo(
    () => availablePlayers
      .filter((player) => (player.injuryRiskScore || 0) >= 45 || (player.injuryStatus && player.injuryStatus !== "ACTIVE"))
      .sort((a, b) => (b.injuryRiskScore || 0) - (a.injuryRiskScore || 0) || a.rank - b.rank),
    [availablePlayers],
  );

  const baseIntelPlayers = intelPanel === "watchlist" ? watchPlayers : intelPanel === "durability" ? durabilityPlayers : availablePlayers;
  const intelPlayers = baseIntelPlayers.filter((player) => {
    if (position !== "ALL" && player.pos !== position) return false;
    if (search && !`${player.name} ${player.team} ${player.pos}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (intelPanel === "watchlist" && watchFilter !== "ALL" && !watchLabels(player, notes[player.id]).some((tag) => tag.id === watchFilter.toLowerCase())) return false;
    return true;
  });

  const panelCopy = intelPanel === "rankings"
    ? { eyebrow: "RANKINGS & CONTEXT", title: "Best available by tier", description: "League-adjusted rank, market price, weekly projection, range, and confidence—without leaving the draft clock." }
    : intelPanel === "watchlist"
      ? { eyebrow: "WATCHLIST", title: "Your decision flags", description: "Likes, avoids, league winners, potential diamonds, and rookies remain shared across every league." }
      : { eyebrow: "INJURIES & DURABILITY", title: "Health risk at a glance", description: "Current availability and the 0–100 durability model. Scores of 75+ automatically carry an Avoid signal." };

  function openPlayer(playerId: string) {
    setIntelPanel(null);
    onOpen(playerId);
  }

  const simulatorNode = typeof simulator === "function" ? simulator(handleDraftStateChange) : simulator;
  const researchNode = typeof research === "function" ? research(draftedPlayerIdSet) : research;

  return <section className="draft-room-hub">
    <header className="draft-room-hubbar">
      <div className="draft-room-hub-title">
        <p className="eyebrow">ONE DRAFT-NIGHT WORKSPACE</p>
        <h2>Simulator, research, and instant player intelligence</h2>
        <span>Your draft state stays mounted while you change views or inspect supporting boards.</span>
      </div>
      <div className="draft-room-view-switch" role="tablist" aria-label="Draft room view">
        <button role="tab" aria-selected={roomView === "simulator"} className={roomView === "simulator" ? "active" : ""} onClick={() => setRoomView("simulator")}><b>Draft simulator</b><small>CPUs · scenarios · Monte Carlo</small></button>
        <button role="tab" aria-selected={roomView === "research"} className={roomView === "research" ? "active" : ""} onClick={() => setRoomView("research")}><b>Full research board</b><small>Every stat · filters · board status</small></button>
      </div>
      <nav className="draft-intel-launcher" aria-label="Draft-day intelligence">
        <span>QUICK INTEL</span>
        <button onClick={() => setIntelPanel("rankings")}><b>Rankings</b><small>{availablePlayers.length} available</small></button>
        <button onClick={() => setIntelPanel("watchlist")}><b>Watchlist</b><small>{watchPlayers.length} flagged</small></button>
        <button onClick={() => setIntelPanel("durability")}><b>Durability</b><small>{durabilityPlayers.length} risks</small></button>
      </nav>
    </header>

    <div className="draft-room-view" hidden={roomView !== "simulator"}>{simulatorNode}</div>
    <div className="draft-room-view" hidden={roomView !== "research"}>{researchNode}</div>

    {intelPanel && <div className="draft-intel-scrim" onMouseDown={(event) => event.target === event.currentTarget && setIntelPanel(null)}>
      <aside className="draft-intel-drawer" role="dialog" aria-modal="true" aria-label={panelCopy.title}>
        <header>
          <div><p className="eyebrow">{panelCopy.eyebrow}</p><h2>{panelCopy.title}</h2><p>{panelCopy.description}</p></div>
          <button className="draft-intel-close" onClick={() => setIntelPanel(null)} aria-label="Close quick intelligence">×</button>
        </header>
        <div className="draft-intel-summary">
          <span><b>{intelPlayers.length}</b><small>shown</small></span>
          <span><b>{watchPlayers.filter((player) => notes[player.id]?.liked).length}</b><small>likes</small></span>
          <span><b>{watchPlayers.filter((player) => notes[player.id]?.avoid || (player.injuryRiskScore || 0) >= 75).length}</b><small>avoids</small></span>
          <span><b>{durabilityPlayers.filter((player) => (player.injuryRiskScore || 0) >= 75).length}</b><small>high risk</small></span>
        </div>
        <div className="draft-intel-filters">
          <label><span>SEARCH</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Player, team, position…" /></label>
          <label><span>POSITION</span><select value={position} onChange={(event) => setPosition(event.target.value)}>{POSITIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
          {intelPanel === "watchlist" && <label><span>FLAG</span><select value={watchFilter} onChange={(event) => setWatchFilter(event.target.value)}><option value="ALL">All flags</option><option value="LIKE">Like</option><option value="AVOID">Avoid</option><option value="LEAGUE-WINNER">League winner</option><option value="DIAMOND">Diamond</option><option value="ROOKIE">Rookie</option></select></label>}
        </div>
        <div className="draft-intel-list">
          {intelPlayers.map((player) => {
            const tags = watchLabels(player, notes[player.id]);
            return <button onClick={() => openPlayer(player.id)} key={player.id} className={watchRowClass(tags)}>
              <span className="draft-intel-rank">#{player.rank}</span>
              <i className={`pos pos-${player.pos}`}>{player.pos}</i>
              <span className="draft-intel-player"><b>{player.name}</b><small>{player.team} · {player.posRank || player.pos}</small>{intelPanel === "durability" && player.injuryHeadline && <em>{player.injuryHeadline}</em>}</span>
              <span className="draft-intel-market"><b>{fmt(player.adp)}</b><small>ADP</small></span>
              <span className="draft-intel-market"><b>{fmt(ppg(player))}</b><small>PPG</small></span>
              {intelPanel === "rankings" && <><span className="draft-intel-market"><b>T{player.tier || "—"}</b><small>TIER</small></span><span className="draft-intel-market"><b>{player.bestRank == null ? "—" : `${player.bestRank}–${player.worstRank ?? "—"}`}</b><small>RANGE</small></span><span className="draft-intel-market"><b>{confidence(player).toFixed(0)}%</b><small>CONF</small></span></>}
              {intelPanel === "watchlist" && <span className="draft-intel-tags">{tags.map((tag) => <em className={tag.id} key={tag.id}>{tag.label}</em>)}</span>}
              {intelPanel === "durability" && <span className={`draft-intel-risk ${(player.injuryRiskScore || 0) >= 75 ? "high" : ""}`}><b>{player.injuryRiskScore ?? "—"}</b><small>{player.injuryRiskBand || player.injuryStatus || "Risk"}</small></span>}
              <strong className="draft-intel-open">›</strong>
            </button>;
          })}
          {!intelPlayers.length && <p className="draft-intel-empty">No players match these quick filters.</p>}
        </div>
        <footer><span>Updated {generatedAt ? new Date(generatedAt).toLocaleString() : "with the active board snapshot"}</span><b>Click any player for the full profile.</b></footer>
      </aside>
    </div>}
  </section>;
}
