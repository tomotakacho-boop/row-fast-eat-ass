"use client";
import { useEffect, useMemo, useState } from "react";
import leagueBConfig from "../public/data/league-b-config.json";
import { mergeSharedPreferences, migrateSharedPreferences, seedRepositoryPreferences, subscribeSharedPreferences, updateSharedPreference } from "./sharedPreferences";
import { InjuryPulse } from "./InjuryPulse";
import { InjuryResearchBoard } from "./InjuryResearchBoard";
import { TeamEnvironmentBoard } from "./TeamEnvironmentBoard";
import { BoardStatusButtons } from "./BoardStatusButtons";
import { UnifiedWatchlist } from "./UnifiedWatchlist";
import { OptimizedPlanPanel } from "./OptimizedPlanPanel";
import { getPotentialDiamond } from "./potentialDiamonds";
import { getLeagueWinner } from "./leagueWinners";
import { DraftIntelligenceMethodology } from "./DraftIntelligenceMethodology";
import { FlockPlayerContext } from "./FlockPlayerContext";
import { DemoLiveDraftBoard, MockDraftBoard } from "./DemoLiveDraftBoard";
import { DraftRoomHub } from "./DraftRoomHub";
import { getPlayerResearch } from "./draftResearch";
import { injuryRiskBand, injuryRiskScore, isHighInjuryRisk } from "./injuryRisk";
type Player = {
    id: string;
    name: string;
    team: string;
    pos: string;
    posRank: string | null;
    bye: number | null;
    rank: number;
    consensusRank?: number | null;
    consensusPosRank?: string | null;
    bestRank: number | null;
    worstRank: number | null;
    rankStdDev: number | null;
    tier: number | null;
    borisTier?: number | null;
    borisOverallTier?: number | null;
    liveTier?: number | null;
    adp: number | null;
    dynastyRank: number | null;
    rookieRank: number | null;
    projectedPoints: number | null;
    projectedPPG: number | null;
    activeGamePPG?: number | null;
    projectedGames: number | null;
    projectionSource: string | null;
    projection: Record<string, number | null | Record<string, number | null>> | null;
    availabilityMultiplier?: number | null;
    injuryStatus?: string | null;
    injuryHeadline?: string | null;
    injuryDetail?: string | null;
    injurySource?: string | null;
    injuryUpdatedAt?: string | null;
    injuryRankPenalty?: number | null;
    injuryRiskScore?: number | null;
    injuryRiskBand?: string | null;
    flockRank?: number | null;
    flockAdjustedRank?: number | null;
    flockTier?: string | null;
    flockWrRank?: number | null;
    flockWrTier?: string | null;
    flockMovement?: string | null;
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
type Snapshot = {
    season: number;
    scoring: string;
    generatedAt: string;
    sourceStatus: Array<{
        id: string;
        name: string;
        url: string;
        ok: boolean;
        optional?: boolean;
        records: number;
        message?: string;
    }>;
    sourceNotes: string[];
    referenceLinks: Array<{
        name: string;
        url: string;
    }>;
    players: Player[];
};
type Status = "available" | "mine" | "taken";
type Note = {
    liked?: boolean;
    avoid?: boolean;
    diamond?: boolean;
    rookie?: boolean;
    rookieExcluded?: boolean;
    status?: Status;
    note?: string;
    draftedAt?: number;
};
type Pick = {
    playerId: string;
    team: string;
    round: number;
    overall: number;
    source: "cpu" | "manual";
};
type Personality = {
    team: string;
    creativity: number;
    archetype: string;
};
type History = {
    id: string;
    createdAt: string;
    seed: number;
    slot: number;
    picks: Pick[];
    personalities: Personality[];
    grades: TeamGrade[];
};
type State = {
    notes: Record<string, Note>;
    plans: Record<string, string[]>;
    slot: number;
    slotConfirmed: boolean;
    history: History[];
};
type TeamGrade = {
    team: string;
    manager: string;
    grade: number;
    rank: number;
    lineup: number;
    depth: number;
    value: number;
    construction: number;
};
const USER_TEAM = leagueBConfig.team.name;
const STORAGE_KEY = "league-b-full-ppr-state-v2";
const LEGACY_STORAGE_KEY = "league-b-full-ppr-state-v1";
const OFFICIAL_SLOT = leagueBConfig.draft.officialSlot;
const scenarios = "ABCDEFGHIJ".split("");
const positions = ["ALL", "QB", "RB", "WR", "TE", "K", "DST"];
const tabs = [["board", "Draft room"], ["demo-live", "Demo live draft board"], ["rankings", "Rankings & context"], ["injuries", "Injuries & durability"], ["watchlists", "Watchlists"], ["plans", "Draft plan & roster"], ["methods", "Methods & sources"]] as const;
const teams = leagueBConfig.teams;
const archetypes = ["Balanced", "RB foundation", "WR volume", "Elite QB", "Late QB", "Hero RB", "Anchor TE"];
const defaultState: State = { notes: {}, plans: Object.fromEntries(scenarios.map((scenario) => [scenario, Array(16).fill("")])), slot: OFFICIAL_SLOT, slotConfirmed: true, history: [] };
function playerPreferenceClass(note: Note | undefined, player: Player) { if (note?.avoid || isHighInjuryRisk(player))
    return "player-flag-avoid"; if (getLeagueWinner(player.name))
    return "player-flag-league-winner"; if (note?.diamond || getPotentialDiamond(player.name))
    return "player-flag-diamond"; if (note?.liked)
    return "player-flag-like"; if (note?.rookie || !!player.rookieRank)
    return "player-flag-rookie"; if (getPlayerResearch(player.name))
    return "player-research-row"; return ""; }
function fmt(value: number | null | undefined, digits = 0) { return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits); }
function clamp(value: number, minimum = 0, maximum = 100) { return Math.max(minimum, Math.min(maximum, value)); }
function snakePick(round: number, slot: number) { return round % 2 ? (round - 1) * 12 + slot : round * 12 - slot + 1; }
function officializeNotes(notes: Record<string, Note>) {
    const mine = Object.entries(notes).filter(([, note]) => note.status === "mine").sort(([, a], [, b]) => (a.draftedAt || 0) - (b.draftedAt || 0));
    const officialPick = new Map(mine.map(([id], index) => [id, snakePick(index + 1, OFFICIAL_SLOT)]));
    return Object.fromEntries(Object.entries(notes).map(([id, note]) => [id, { ...note, draftedAt: note.status === "mine" ? officialPick.get(id) : undefined }]));
}
function ppg(player: Player) { return player.projectedPPG ?? (player.projectedPoints == null ? null : player.projectedPoints / (player.projectedGames || 17)); }
function confidence(player: Player) { return clamp(100 - (player.rankStdDev || 24) * 2); }
function valueDelta(player: Player) { return player.adp == null ? null : player.adp - player.rank; }
function percentile(player: Player, players: Player[]) { const peers = players.filter((item) => item.pos === player.pos && item.projectedPoints != null).sort((a, b) => Number(a.projectedPoints) - Number(b.projectedPoints)); const index = peers.findIndex((item) => item.id === player.id); return index < 0 ? null : index / Math.max(1, peers.length - 1) * 100; }
function signal(player: Player) { const delta = valueDelta(player); return confidence(player) < 55 ? "Volatile" : delta != null && delta >= 10 ? "Target" : delta != null && delta <= -10 ? "Pricey" : "Fair"; }
function timeLabel(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function projectionGames(player: Player) { return player.projectedGames || Number(player.projection?.games) || 17; }
function perGame(player: Player, key: string, digits = 1) { const raw = player.projection?.[key]; return typeof raw === "number" ? (raw / projectionGames(player)).toFixed(digits) : "—"; }
function statLine(player: Player) {
    if (player.pos === "QB")
        return `Pass ${perGame(player, "passYards", 0)} yd · ${perGame(player, "passTds", 2)} TD · Rush ${perGame(player, "rushYards", 0)} yd`;
    if (player.pos === "RB")
        return `${perGame(player, "rushAttempts")} att · ${perGame(player, "rushYards", 0)} rush yd · ${perGame(player, "receptions")} rec`;
    if (["WR", "TE"].includes(player.pos))
        return `${perGame(player, "targets")} tgt · ${perGame(player, "receptions")} rec · ${perGame(player, "receivingYards", 0)} yd`;
    if (player.pos === "K")
        return `${perGame(player, "patMade")} PAT · ${perGame(player, "fgMade0to39")} short FG · ${perGame(player, "fgMade50to59")} 50+ FG`;
    if (player.pos === "DST")
        return `${perGame(player, "sacks")} sacks · ${perGame(player, "interceptions", 2)} INT · ${fmt(Number(player.projection?.pointsAllowedPerGame), 1)} PA`;
    return "Projected stat line unavailable";
}
function seeded(seed: number) { let value = seed >>> 0; return () => { value += 0x6D2B79F5; let result = value; result = Math.imul(result ^ result >>> 15, result | 1); result ^= result + Math.imul(result ^ result >>> 7, result | 61); return ((result ^ result >>> 14) >>> 0) / 4294967296; }; }
function draftOrder() { return teams; }
function rosterCounts(roster: Player[]) { return roster.reduce<Record<string, number>>((counts, player) => ({ ...counts, [player.pos]: (counts[player.pos] || 0) + 1 }), {}); }
function viable(player: Player, roster: Player[], round: number) {
    const counts = rosterCounts(roster);
    const maximums: Record<string, number> = { QB: 4, RB: 8, WR: 8, TE: 3, K: 3, DST: 3 };
    if ((counts[player.pos] || 0) >= (maximums[player.pos] || 16))
        return false;
    if (["K", "DST"].includes(player.pos) && round < 13)
        return false;
    if (round <= 3 && ["RB", "WR"].includes(player.pos) && (counts[player.pos] || 0) >= 2)
        return false;
    if (round <= 5 && ["QB", "TE"].includes(player.pos) && (counts[player.pos] || 0) >= 1)
        return false;
    return true;
}
function logicalScore(player: Player, roster: Player[], round: number, archetype: string) {
    const counts = rosterCounts(roster);
    let score = 420 - player.rank;
    if (player.pos === "RB" && (counts.RB || 0) < 2)
        score += round <= 6 ? 95 : 45;
    if (player.pos === "WR" && (counts.WR || 0) < 2)
        score += round <= 6 ? 95 : 45;
    if (player.pos === "TE" && !(counts.TE || 0))
        score += round >= 5 ? 55 : 12;
    if (player.pos === "QB" && !(counts.QB || 0))
        score += round >= 8 ? 115 : 8;
    if (round >= 15 && player.pos === "DST" && !(counts.DST || 0))
        score += 220;
    if (round >= 16 && player.pos === "K" && !(counts.K || 0))
        score += 260;
    if (archetype === "RB foundation" && player.pos === "RB")
        score += round <= 6 ? 32 : 8;
    if (archetype === "WR volume" && player.pos === "WR")
        score += round <= 8 ? 30 : 8;
    if (archetype === "Elite QB" && player.pos === "QB" && round <= 5 && !(counts.QB || 0))
        score += 52;
    if (archetype === "Late QB" && player.pos === "QB" && round <= 7)
        score -= 70;
    if (archetype === "Hero RB" && player.pos === "RB" && (counts.RB || 0) === 0)
        score += 70;
    if (archetype === "Anchor TE" && player.pos === "TE" && round <= 6 && !(counts.TE || 0))
        score += 55;
    return score;
}
function chooseCpu(players: Player[], roster: Player[], round: number, personality: Personality, seed: number) {
    const pool = players.filter((player) => viable(player, roster, round)).sort((a, b) => logicalScore(b, roster, round, personality.archetype) - logicalScore(a, roster, round, personality.archetype));
    const window = pool.slice(0, Math.round(4 + personality.creativity * .14));
    const random = seeded(seed);
    let total = 0;
    const weighted = window.map((player, index) => { const weight = Math.exp(-index / (1.2 + personality.creativity / 18)) * (.8 + random() * .4); total += weight; return { player, weight }; });
    let roll = random() * total;
    for (const entry of weighted) {
        roll -= entry.weight;
        if (roll <= 0)
            return entry.player;
    }
    return pool[0];
}
function assignRoster(players: Player[]) {
    const slots = ["QB", "RB1", "RB2", "WR1", "WR2", "TE", "FLEX", "DST", "K"];
    const assigned = new Map<string, Player>();
    const used = new Set<string>();
    const take = (slot: string, eligible: string[]) => { const player = players.filter((item) => !used.has(item.id) && eligible.includes(item.pos)).sort((a, b) => Number(b.projectedPoints) - Number(a.projectedPoints))[0]; if (player) {
        assigned.set(slot, player);
        used.add(player.id);
    } };
    take("QB", ["QB"]);
    take("RB1", ["RB"]);
    take("RB2", ["RB"]);
    take("WR1", ["WR"]);
    take("WR2", ["WR"]);
    take("TE", ["TE"]);
    take("FLEX", ["RB", "WR", "TE"]);
    take("DST", ["DST"]);
    take("K", ["K"]);
    return { slots, assigned, bench: players.filter((player) => !used.has(player.id)).sort((a, b) => a.rank - b.rank) };
}
function gradeDraft(players: Player[], picks: Pick[]): TeamGrade[] {
    const order = draftOrder();
    const raw = order.map((team) => { const roster = picks.filter((pick) => pick.team === team.team).flatMap((pick) => { const player = players.find((item) => item.id === pick.playerId); return player ? [player] : []; }); const { assigned, bench } = assignRoster(roster); const starters = [...assigned.values()]; const lineup = starters.length ? starters.reduce((sum, player) => sum + clamp(102 - player.rank * .42) * .5 + (percentile(player, players) || 0) * .5, 0) / 9 : 0; const depth = bench.slice(0, 5).reduce((sum, player) => sum + clamp(102 - player.rank * .42), 0) / 5; const teamPicks = picks.filter((pick) => pick.team === team.team); const value = teamPicks.length ? teamPicks.reduce((sum, pick) => { const player = players.find((item) => item.id === pick.playerId); const market = player ? (player.rank + (player.adp || player.rank)) / 2 : pick.overall; return sum + clamp(50 + (pick.overall - market) * 1.15); }, 0) / teamPicks.length : 0; const counts = rosterCounts(roster); let construction = 100; if (!counts.QB)
        construction -= 18; if ((counts.RB || 0) < 2)
        construction -= 28; if ((counts.WR || 0) < 2)
        construction -= 28; if (!counts.TE)
        construction -= 14; if (!counts.DST)
        construction -= 6; if (!counts.K)
        construction -= 6; const base = lineup * .48 + depth * .17 + value * .22 + clamp(construction) * .13; return { ...team, grade: base, rank: 0, lineup, depth, value, construction: clamp(construction) }; }).sort((a, b) => b.grade - a.grade);
    return raw.map((team, index) => ({ ...team, rank: index + 1, grade: clamp(team.grade * .78 + (raw.length - 1 - index) / (raw.length - 1) * 22) }));
}
export default function RedraftBoard() {
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [error, setError] = useState("");
    const [state, setState] = useState<State>(defaultState);
    const [hydrated, setHydrated] = useState(false);
    const [tab, setTab] = useState<(typeof tabs)[number][0]>("board");
    const [search, setSearch] = useState("");
    const [position, setPosition] = useState("ALL");
    const [status, setStatus] = useState("available");
    const [tier, setTier] = useState("ALL");
    const [flag, setFlag] = useState("ALL");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    useEffect(() => { let cancelled = false; Promise.resolve().then(() => { try {
        const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
        if (raw && !cancelled) {
            const parsed = JSON.parse(raw);
            const localNotes = parsed.notes || {};
            migrateSharedPreferences(localNotes);
            setState({ ...defaultState, ...parsed, notes: mergeSharedPreferences(officializeNotes(localNotes)), plans: { ...defaultState.plans, ...(parsed.plans || {}) }, slot: OFFICIAL_SLOT, slotConfirmed: true });
        }
        else if (!cancelled)
            setState({ ...defaultState, notes: mergeSharedPreferences({}) });
    }
    catch { } if (!cancelled)
        setHydrated(true); }); fetch("/data/players-full-ppr.json", { cache: "no-store" }).then((response) => { if (!response.ok)
        throw new Error(`Data request failed (${response.status})`); return response.json(); }).then((data) => { if (!cancelled)
        setSnapshot(data); }).catch((caught) => { if (!cancelled)
        setError(caught.message); }); return () => { cancelled = true; }; }, []);
    useEffect(() => { if (hydrated)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }, [hydrated, state]);
    useEffect(() => subscribeSharedPreferences(() => setState((current) => ({ ...current, notes: mergeSharedPreferences(current.notes) }))), []);
    const players = useMemo(() => snapshot?.players || [], [snapshot]);
    useEffect(() => { seedRepositoryPreferences(players); }, [players]);
    const selected = players.find((player) => player.id === selectedId);
    const mine = players.filter((player) => state.notes[player.id]?.status === "mine").sort((a, b) => (state.notes[a.id]?.draftedAt || 0) - (state.notes[b.id]?.draftedAt || 0));
    const tiers = [...new Set(players.flatMap((player) => player.tier == null ? [] : [player.tier]))].sort((a, b) => a - b);
    const filtered = players.filter((player) => { const note = state.notes[player.id] || {}; if (search && !`${player.name} ${player.team} ${note.note || ""}`.toLowerCase().includes(search.toLowerCase()))
        return false; if (position !== "ALL" && player.pos !== position)
        return false; if (status !== "ALL" && (note.status || "available") !== status)
        return false; if (tier !== "ALL" && String(player.tier) !== tier)
        return false; if (flag === "LIKE" && !note.liked)
        return false; if (flag === "AVOID" && !note.avoid && !isHighInjuryRisk(player))
        return false; if (flag === "LEAGUE_WINNER" && !getLeagueWinner(player.name))
        return false; if (flag === "DIAMOND" && !note.diamond && !getPotentialDiamond(player.name))
        return false; if (flag === "ROOKIE" && !(note.rookie || player.rookieRank))
        return false; return true; });
    function update(id: string, patch: Partial<Note>) { const next = { ...patch }; if (patch.liked === true)
        next.avoid = false; if (patch.avoid === true)
        next.liked = false; if ("liked" in next || "avoid" in next || "diamond" in next)
        updateSharedPreference(id, { liked: next.liked, avoid: next.avoid, diamond: next.diamond }); setState((current) => ({ ...current, notes: { ...current.notes, [id]: { ...current.notes[id], ...next } } })); }
    function mark(id: string, next: Status) { setState((current) => { const round = Object.values(current.notes).filter((note) => note.status === "mine").length + 1; return { ...current, notes: { ...current.notes, [id]: { ...current.notes[id], status: next, draftedAt: next === "mine" ? current.notes[id]?.draftedAt || snakePick(round, current.slot) : undefined } } }; }); }
    return <main className="league-b-shell">
    <header className="topbar"><div className="brand-lockup"><div className="monogram b-monogram">B</div><div><p className="eyebrow">ROW FAST EAT ASS SEASON 10</p><h1>Redraft Room <span>’26</span></h1></div></div><div className="topbar-actions"><div className="header-status"><span className={`status-dot ${snapshot ? "live" : ""}`}/><div><strong>{snapshot ? "Full-PPR board live" : "Loading board"}</strong><small>{snapshot ? `Updated ${timeLabel(snapshot.generatedAt)}` : "Connecting to sources…"}</small></div></div></div></header>
    <section className="command-strip b-command"><div><span className="metric-label">FORMAT</span><strong>Full PPR redraft</strong></div><div><span className="metric-label">TEAMS</span><strong>12 · Snake</strong></div><div><span className="metric-label">YOUR SLOT</span><strong>#{state.slot} · Confirmed</strong></div><div><span className="metric-label">WAIVERS</span><strong>$100 FAAB</strong></div><div className="pick-run"><span className="metric-label">YOUR 16 PICKS</span><strong>{Array.from({ length: 16 }, (_, index) => snakePick(index + 1, state.slot)).join(" · ")}</strong></div></section>
    <nav className="tabs">{tabs.map(([id, label]) => <button className={tab === id ? "active" : ""} onClick={() => setTab(id)} key={id}>{label}</button>)}</nav>
    {error && <div className="notice error">Row Fast Eat Ass Season 10 data could not load: {error}</div>}{!snapshot && !error && <div className="loading-panel"><span className="spinner"/>Loading full-PPR rankings and projections…</div>}
    {snapshot && tab === "board" && <DraftRoomHub players={players} notes={state.notes} generatedAt={snapshot.generatedAt} onOpen={setSelectedId} simulator={(onDraftStateChange) => <MockDraftBoard players={players} notes={state.notes} teams={draftOrder()} userTeam={USER_TEAM} slot={state.slot} rounds={16} onOpen={setSelectedId} leagueId="league-b" leagueName="Row Fast Eat Ass Season 10" starterSlots={leagueBConfig.roster.slots} onDraftStateChange={onDraftStateChange}/>} research={(draftedPlayerIds) => <RedraftResearch players={players} state={state} filtered={filtered.filter((player) => !draftedPlayerIds.has(player.id))} search={search} setSearch={setSearch} position={position} setPosition={setPosition} status={status} setStatus={setStatus} tier={tier} setTier={setTier} tiers={tiers} flag={flag} setFlag={setFlag} slot={state.slot} open={setSelectedId} mark={mark}/>}/>}
    {snapshot && tab === "demo-live" && <DemoLiveDraftBoard players={players} notes={state.notes} teams={draftOrder()} userTeam={USER_TEAM} slot={state.slot} rounds={16} onOpen={setSelectedId} starterSlots={leagueBConfig.roster.slots}/>} 
    {snapshot && tab === "rankings" && <><RedraftRankings players={players} notes={state.notes} open={setSelectedId}/><TeamEnvironmentBoard players={players} generatedAt={snapshot.generatedAt}/></>} 
    {snapshot && tab === "injuries" && <InjuryResearchBoard players={players} generatedAt={snapshot.generatedAt} open={setSelectedId}/>} 
    {snapshot && tab === "watchlists" && <RedraftWatchlists players={players} state={state} update={update} open={setSelectedId}/>}
    {snapshot && tab === "plans" && <RedraftPlans players={players} state={state} setState={setState} roster={mine} slot={state.slot} open={setSelectedId}/>}
    {snapshot && tab === "methods" && <RedraftMethods snapshot={snapshot} state={state} setState={setState}/>}
    {selected && <div className="drawer-scrim" onMouseDown={(event) => event.target === event.currentTarget && setSelectedId(null)}><aside className="drawer"><button className="drawer-close" onClick={() => setSelectedId(null)}>×</button><p className="eyebrow">{selected.team} · {selected.posRank}</p><h2>{selected.name}</h2><div className="drawer-ranks"><div><span>LEAGUE RK</span><strong>{selected.rank}</strong></div><div><span>ADP</span><strong>{fmt(selected.adp, 1)}</strong></div><div><span>TIER</span><strong>{selected.tier || "—"}</strong></div><div><span>PROJ</span><strong>{fmt(selected.projectedPoints, 1)}</strong></div><div><span>PPG</span><strong>{fmt(ppg(selected), 1)}</strong></div></div><FlockPlayerContext player={selected}/><InjuryPulse players={[selected]} compact/><div className="b-stat-drawer"><b>Projected per-game line</b><span>{statLine(selected)}</span><small>{selected.projectionSource || "Projection source unavailable"}</small></div><div className="flag-grid"><label><input type="checkbox" checked={!!state.notes[selected.id]?.liked} onChange={(event) => update(selected.id, { liked: event.target.checked })}/><span>★ Like</span></label><label><input type="checkbox" checked={!!state.notes[selected.id]?.avoid} onChange={(event) => update(selected.id, { avoid: event.target.checked })}/><span>! Avoid</span></label><label><input type="checkbox" checked={!!state.notes[selected.id]?.rookie} onChange={(event) => update(selected.id, { rookie: event.target.checked })}/><span>R Rookie</span></label><label><input type="checkbox" checked={state.notes[selected.id]?.status === "mine"} onChange={(event) => mark(selected.id, event.target.checked ? "mine" : "available")}/><span>My roster</span></label></div><label className="note-field"><span>Draft note</span><textarea value={state.notes[selected.id]?.note || ""} onChange={(event) => update(selected.id, { note: event.target.value })}/></label><dl className="detail-list"><div><dt>Full-PPR projection</dt><dd>{fmt(selected.projectedPoints, 1)} · {fmt(ppg(selected), 1)} PPG</dd></div><div><dt>Expert range</dt><dd>{fmt(selected.bestRank)}–{fmt(selected.worstRank)}</dd></div><div><dt>Confidence</dt><dd>{confidence(selected).toFixed(0)}%</dd></div><div><dt>Market signal</dt><dd>{signal(selected)}</dd></div><div><dt>Dynasty / rookie</dt><dd>{fmt(selected.dynastyRank)} / {fmt(selected.rookieRank)}</dd></div><div><dt>Bye week</dt><dd>{selected.bye || "—"}</dd></div></dl></aside></div>}
  </main>;
}
function RedraftResearch({ players, state, filtered, search, setSearch, position, setPosition, status, setStatus, tier, setTier, tiers, flag, setFlag, slot, open, mark }: {
    players: Player[];
    state: State;
    filtered: Player[];
    search: string;
    setSearch: (value: string) => void;
    position: string;
    setPosition: (value: string) => void;
    status: string;
    setStatus: (value: string) => void;
    tier: string;
    setTier: (value: string) => void;
    tiers: number[];
    flag: string;
    setFlag: (value: string) => void;
    slot: number;
    open: (id: string) => void;
    mark: (id: string, status: Status) => void;
}) {
    return <section className="workspace board-workspace"><div className="section-heading"><div><p className="eyebrow">FULL-PPR PLAYER RESEARCH BOARD</p><h2>Every player mapped to a 12-team redraft pick</h2></div><p>Round/pick estimates follow the Flock-anchored full-PPR league model. Your confirmed draft position is #{slot}; the highlighted checkpoints are your real snake-draft selections.</p></div><div className="b-order-banner"><div><span>ORDER STATUS</span><strong>Confirmed · Meet The Robinson&apos;s at #5</strong><small>The commissioner order is loaded and used throughout mocks, pick rails, plans, and grading.</small></div><div><b>{players.length}</b><span>players</span></div><div><b>16</b><span>rounds</span></div><div><b>192</b><span>selections</span></div></div><div className="filters"><label className="search-field"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search player, team, note…"/></label><label><span>Position</span><select value={position} onChange={(event) => setPosition(event.target.value)}>{positions.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="available">Available</option><option value="ALL">All</option><option value="mine">My roster</option><option value="taken">Taken</option></select></label><label><span>Tier</span><select value={tier} onChange={(event) => setTier(event.target.value)}><option value="ALL">All tiers</option>{tiers.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label><span>Flag</span><select value={flag} onChange={(event) => setFlag(event.target.value)}><option value="ALL">All flags</option><option value="LIKE">Liked</option><option value="AVOID">Avoid</option><option value="LEAGUE_WINNER">League winners</option><option value="ROOKIE">Rookies</option></select></label></div><div className="table-wrap"><table className="b-research-table"><thead><tr><th className="live-eta-head">EST. R/P</th><th>RK</th><th>ADP</th><th>Δ</th><th>TIER</th><th className="player-col">PLAYER</th><th>POS</th><th>BYE</th><th>PPR PROJ</th><th>PPG</th><th className="stat-line-head">STAT/G</th><th>POS %</th><th>RANGE</th><th>CONF</th><th>INJURY</th><th>SIGNAL</th><th>BOARD</th><th /></tr></thead><tbody>{filtered.map((player) => { const note = state.notes[player.id] || {}; const estimated = player.rank; const round = Math.floor((estimated - 1) / 12) + 1; const pick = (estimated - 1) % 12 + 1; const isCheckpoint = pick === (round % 2 ? slot : 13 - slot); const delta = valueDelta(player); return <tr className={`${note.status === "taken" ? "is-taken" : ""} ${note.status === "mine" ? "is-mine" : ""} ${isCheckpoint ? "live-twin-row" : ""} ${playerPreferenceClass(note, player)}`} key={player.id}><td className={`live-eta-cell ${isCheckpoint ? "twin-pick" : ""}`}><strong>R{round}P{pick}</strong><small>Overall #{estimated}</small>{isCheckpoint && <em>ROBINSON&apos;S</em>}</td><td className="rank">{player.rank}</td><td>{fmt(player.adp, 1)}</td><td><span className={`delta ${delta != null && delta >= 5 ? "positive" : delta != null && delta <= -5 ? "negative" : ""}`}>{delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`}</span></td><td><span className="tier-badge">{player.tier || "—"}</span></td><td className="player-cell"><button onClick={() => open(player.id)}><strong>{player.name}</strong><small>{player.team} · {player.posRank}</small></button>{note.liked && <span>★</span>}{note.avoid && <span className="avoid-mark">!</span>}{getLeagueWinner(player.name) && <span className="league-winner-mark" title="Source-tagged mid-round League Winner">W</span>}{!note.avoid && isHighInjuryRisk(player) && <span className="injury-avoid-mark" title={`Automatic Avoid: injury-risk score ${injuryRiskScore(player)} is 75 or higher`}>INJ</span>}{(note.rookie || player.rookieRank) && <span className="rookie-mark">R</span>}</td><td><span className={`pos pos-${player.pos}`}>{player.pos}</span></td><td>{player.bye || "—"}</td><td>{fmt(player.projectedPoints, 1)}</td><td><strong className="ppg-value">{fmt(ppg(player), 1)}</strong></td><td className="stat-line-cell">{statLine(player)}</td><td>{fmt(percentile(player, players))}%</td><td>{fmt(player.bestRank)}–{fmt(player.worstRank)}</td><td>{confidence(player).toFixed(0)}%</td><td><span className={`injury-risk-score ${isHighInjuryRisk(player) ? "high" : ""}`} title={isHighInjuryRisk(player) ? "Automatic Avoid at 75+" : injuryRiskBand(player)}><b>{injuryRiskScore(player) ?? "—"}</b><small>{injuryRiskBand(player)}</small></span></td><td><span className={`signal signal-${signal(player).toLowerCase()}`}>{signal(player)}</span></td><td><BoardStatusButtons playerName={player.name} status={note.status || "available"} onChange={(next) => mark(player.id, next)}/></td><td><button className="icon-button" onClick={() => open(player.id)}>›</button></td></tr>; })}</tbody></table></div><p className="table-foot">The Flock-anchored full-PPR league model drives this order. Filters never renumber rows. The highlighted checkpoints are Meet The Robinson&apos;s confirmed fifth-slot selections.</p></section>;
}
function RedraftMock({ players, state, setState }: {
    players: Player[];
    state: State;
    setState: React.Dispatch<React.SetStateAction<State>>;
}) {
    const [seed, setSeed] = useState(2627);
    const [personalities, setPersonalities] = useState<Personality[]>(() => buildPersonalities(2627));
    const [picks, setPicks] = useState<Pick[]>([]);
    const [started, setStarted] = useState(false);
    const [auto, setAuto] = useState(true);
    const [search, setSearch] = useState("");
    const [position, setPosition] = useState("ALL");
    const [saved, setSaved] = useState(false);
    const order = useMemo(() => draftOrder(), []);
    const schedule = useMemo(() => Array.from({ length: 192 }, (_, index) => { const round = Math.floor(index / 12) + 1; const pick = index % 12; const teamIndex = round % 2 ? pick : 11 - pick; return { overall: index + 1, round, team: order[teamIndex] }; }), [order]);
    const current = started ? schedule[picks.length] : undefined;
    const used = new Set(picks.map((pick) => pick.playerId));
    const available = players.filter((player) => !used.has(player.id));
    const userTurn = current?.team.team === USER_TEAM;
    const draftComplete = started && picks.length === 192;
    const grades = useMemo(() => draftComplete ? gradeDraft(players, picks) : [], [draftComplete, picks, players]);
    useEffect(() => { if (!started || !auto || !current || userTurn)
        return; const timer = window.setTimeout(() => { setPicks((existing) => { if (existing.length !== picks.length)
        return existing; const personality = personalities.find((item) => item.team === current.team.team)!; const roster = existing.filter((pick) => pick.team === current.team.team).flatMap((pick) => { const player = players.find((item) => item.id === pick.playerId); return player ? [player] : []; }); const player = chooseCpu(players.filter((item) => !new Set(existing.map((pick) => pick.playerId)).has(item.id)), roster, current.round, personality, seed + current.overall * 7919); return player ? [...existing, { playerId: player.id, team: current.team.team, round: current.round, overall: current.overall, source: "cpu" }] : existing; }); }, 45); return () => clearTimeout(timer); }, [auto, current, personalities, picks.length, players, seed, started, userTurn]);
    useEffect(() => { if (!grades.length || saved)
        return; let cancelled = false; const history: History = { id: `b-${Date.now()}`, createdAt: new Date().toISOString(), seed, slot: state.slot, picks, personalities, grades }; Promise.resolve().then(() => { if (cancelled)
        return; setState((currentState) => ({ ...currentState, history: [history, ...currentState.history].slice(0, 24) })); setSaved(true); }); return () => { cancelled = true; }; }, [grades, personalities, picks, saved, seed, setState, state.slot]);
    function start() { const next = started ? Date.now() >>> 0 : seed; setSeed(next); setPersonalities(buildPersonalities(next)); setPicks([]); setSaved(false); setStarted(true); }
    function draft(id: string) { if (!current || (!userTurn && auto))
        return; setPicks((existing) => [...existing, { playerId: id, team: current.team.team, round: current.round, overall: current.overall, source: "manual" }]); }
    const visible = available.filter((player) => (position === "ALL" || player.pos === position) && (!search || `${player.name} ${player.team}`.toLowerCase().includes(search.toLowerCase()))).slice(0, 90);
    return <section className="workspace mock-workspace"><div className="section-heading"><div><p className="eyebrow">ROW FAST EAT ASS SEASON 10 SIMULATOR</p><h2>Practice the confirmed fifth-slot draft</h2></div><p>The commissioner order is locked into every round of the keeper-free full-PPR simulator.</p></div><div className="b-order-banner"><div><span>DRAFT ORDER</span><strong>Confirmed · Meet The Robinson&apos;s at #{state.slot}</strong><small>All 12 teams follow the exact commissioner order, reversing each even round for the snake.</small></div><div><b>{picks.length}</b><span>picks made</span></div><div><b>{192 - picks.length}</b><span>remaining</span></div><div><b>{seed}</b><span>seed</span></div></div><section className="mock-control-deck"><div className="mock-toggle-group"><label><input type="checkbox" checked={auto} onChange={(event) => setAuto(event.target.checked)}/><span>Auto-run CPU picks</span></label></div><div className="mock-control-actions"><button onClick={() => setPersonalities(buildPersonalities(Date.now()))} disabled={started && picks.length > 0}>Reroll personalities</button><button className="primary-action" onClick={start}>{started ? "New mock" : "Start mock"}</button><button onClick={() => { setAuto(false); setPicks((currentPicks) => currentPicks.slice(0, -1)); }} disabled={!picks.length}>Undo & pause</button></div><div className="mock-control-stats"><span><b>0</b> keepers</span><span><b>16</b> rounds</span><span><b>{personalities.filter((item) => item.creativity >= 65).length}</b> creative CPUs</span><span><b>Full</b> PPR</span></div></section><section className="personality-lab b-personality"><div className="mock-section-heading"><div><p className="eyebrow">CPU PERSONALITIES</p><h3>Logical construction with controlled variation</h3></div><p>K/DST stay late, early builds avoid position overload, and QB/TE urgency increases as starter deadlines approach.</p></div><div className="personality-grid">{personalities.map((personality) => <article className={personality.team === USER_TEAM ? "human" : personality.creativity >= 65 ? "creative" : ""} key={personality.team}><div><b>{personality.team}</b><small>{personality.archetype}</small></div>{personality.team === USER_TEAM ? <strong>HUMAN</strong> : <><label><span>Chalk</span><input type="range" min="1" max="100" disabled={started && picks.length > 0} value={personality.creativity} onChange={(event) => setPersonalities((currentList) => currentList.map((item) => item.team === personality.team ? { ...item, creativity: Number(event.target.value) } : item))}/><span>Creative</span></label><strong>{personality.creativity}</strong></>}</article>)}</div></section><section className="mock-draft-room"><div className="on-clock-panel"><p className="eyebrow">ON THE CLOCK</p><strong>{current?.team.team || (started ? "Draft complete" : "Start a mock")}</strong><span>{current ? `Round ${current.round} · Overall #${current.overall}` : ""}</span>{current && <em>{current.team.manager}</em>}</div><div className="mock-player-pool"><div className="mock-pool-toolbar"><label><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search available players…"/></label><select value={position} onChange={(event) => setPosition(event.target.value)}>{positions.map((item) => <option key={item}>{item}</option>)}</select><span>{available.length} available</span></div><div className="mock-player-list">{started && current ? visible.map((player) => <button disabled={!userTurn && auto} onClick={() => draft(player.id)} key={player.id}><span className={`pos pos-${player.pos}`}>{player.pos}</span><span><b>#{player.rank} {player.name}</b><small>{player.team} · ADP {fmt(player.adp, 1)} · {fmt(ppg(player), 1)} PPG<br />{statLine(player)}</small></span><strong>{userTurn || !auto ? "Draft" : "CPU"}</strong></button>) : <div className="mock-pool-empty">Start a mock to activate the player pool.</div>}</div></div></section><section className="mock-board-section"><div className="mock-section-heading"><div><p className="eyebrow">FULL DRAFT BOARD</p><h3>Sixteen rounds · twelve teams · no keepers</h3></div></div><div className="mock-board-wrap"><table className="mock-board"><thead><tr><th>Round</th>{order.map((team, index) => <th key={team.team}><b>#{index + 1} {team.team}</b><small>{team.manager}</small></th>)}</tr></thead><tbody>{Array.from({ length: 16 }, (_, roundIndex) => <tr key={roundIndex}><th><b>R{roundIndex + 1}</b></th>{order.map((team, teamIndex) => { const overall = snakePick(roundIndex + 1, teamIndex + 1); const pick = picks.find((item) => item.overall === overall); const player = pick ? players.find((item) => item.id === pick.playerId) : undefined; const onClock = current?.overall === overall; return <td className={`${pick?.source || ""} ${onClock ? "current" : ""}`} key={team.team}>{player ? <><b>{player.name}</b><small>#{overall} · {pick?.source}</small></> : <><span>{onClock ? "ON CLOCK" : `#${overall}`}</span><small>{onClock ? "Select from pool" : "Open"}</small></>}</td>; })}</tr>)}</tbody></table></div></section>{grades.length > 0 && <GradeBoard grades={grades} team={USER_TEAM}/>}{state.history.length > 0 && <HistoryBoard history={state.history}/>}</section>;
}
function buildPersonalities(seed: number) { const random = seeded(seed); const creativeA = Math.floor(random() * 11); let creativeB = Math.floor(random() * 11); if (creativeB === creativeA)
    creativeB = (creativeB + 3) % 11; return teams.map((team, index) => ({ team: team.team, creativity: team.team === USER_TEAM ? 0 : [creativeA, creativeB].includes(index) ? 68 + Math.round(random() * 18) : 10 + Math.round(random() * 36), archetype: team.team === USER_TEAM ? "Human control" : archetypes[(index + Math.floor(random() * archetypes.length)) % archetypes.length] })); }
function GradeBoard({ grades, team }: {
    grades: TeamGrade[];
    team: string;
}) { const mine = grades.find((entry) => entry.team === team)!; return <section className="mock-report-card"><div className="mock-section-heading"><div><p className="eyebrow">POST-DRAFT REPORT</p><h3>{team}: {mine.grade.toFixed(1)} / 100 · #{mine.rank} of 12</h3></div><p>Grade = 48% optimized starters + 17% depth + 22% draft value + 13% construction, with a modest league-relative curve.</p></div><div className="report-table-wrap"><table className="report-leaderboard"><thead><tr><th>RK</th><th>Team</th><th>Grade</th><th>Lineup</th><th>Depth</th><th>Value</th><th>Build</th></tr></thead><tbody>{grades.map((entry) => <tr className={entry.team === team ? "is-user" : ""} key={entry.team}><td>#{entry.rank}</td><td><b>{entry.team}</b><small>{entry.manager}</small></td><td><strong>{entry.grade.toFixed(1)}</strong></td><td>{entry.lineup.toFixed(1)}</td><td>{entry.depth.toFixed(1)}</td><td>{entry.value.toFixed(1)}</td><td>{entry.construction.toFixed(1)}</td></tr>)}</tbody></table></div></section>; }
function HistoryBoard({ history }: {
    history: History[];
}) { const [selected, setSelected] = useState(history[0]?.id); const run = history.find((item) => item.id === selected) || history[0]; return <section className="b-history"><div><p className="eyebrow">SAVED SIMULATIONS</p><h3>Compare Row Fast Eat Ass Season 10 mock results</h3></div><div className="b-history-layout"><aside>{history.map((item) => { const mine = item.grades.find((grade) => grade.team === USER_TEAM); return <button className={item.id === run.id ? "active" : ""} onClick={() => setSelected(item.id)} key={item.id}><b>{timeLabel(item.createdAt)}</b><span>Slot {item.slot} · {mine?.grade.toFixed(1)} · #{mine?.rank}</span></button>; })}</aside><div><GradeBoard grades={run.grades} team={USER_TEAM}/></div></div></section>; }
function RedraftRankings({ players, notes, open }: {
    players: Player[];
    notes: Record<string, Note>;
    open: (id: string) => void;
}) {
    const [view, setView] = useState<"tiers" | "context">("tiers");
    const [position, setPosition] = useState("ALL");
    const [sort, setSort] = useState("rank");
    const [direction, setDirection] = useState<"asc" | "desc">("asc");
    const options = ["ALL", "QB", "RB", "WR", "TE", "FLEX", "K", "DST"];
    const subset = players.filter((player) => position === "ALL" ? true : position === "FLEX" ? ["RB", "WR", "TE"].includes(player.pos) : player.pos === position).slice(0, position === "ALL" ? players.length : 72);
    const tiers = [...subset.reduce((map, player, index) => { const tier = (position === "ALL" ? ["K", "DST"].includes(player.pos) ? Math.floor((player.rank - 1) / 12) + 1 : player.borisOverallTier : position === "FLEX" ? player.borisOverallTier : player.borisTier) || player.tier || Math.floor(index / (position === "ALL" ? 16 : 10)) + 1; map.set(tier, [...(map.get(tier) || []), player]); return map; }, new Map<number, Player[]>()).entries()].sort((a, b) => a[0] - b[0]);
    const specialist = players.filter((player) => ["K", "DST"].includes(player.pos)).sort((a, b) => { const aValue = sort === "projection" ? Number(a.projectedPoints) : sort === "ppg" ? Number(ppg(a)) : sort === "confidence" ? confidence(a) : a.rank; const bValue = sort === "projection" ? Number(b.projectedPoints) : sort === "ppg" ? Number(ppg(b)) : sort === "confidence" ? confidence(b) : b.rank; return (aValue - bValue) * (direction === "asc" ? 1 : -1); });
    const environments = [...players.filter((player) => ["QB", "RB", "WR", "TE"].includes(player.pos)).reduce((map, player) => { const list = [...(map.get(player.team) || []), player].sort((a, b) => Number(ppg(b)) - Number(ppg(a))).slice(0, 5); map.set(player.team, list); return map; }, new Map<string, Player[]>()).entries()].map(([team, assets]) => ({ team, assets, score: assets.reduce((sum, player) => sum + Number(ppg(player) || 0), 0) })).sort((a, b) => b.score - a.score);
    return <><div className="workspace-hub-nav"><div><p className="eyebrow">FULL-PPR RANKINGS & CONTEXT</p><strong>Position tiers, specialist scoring, and projected team environments</strong></div><nav><button className={view === "tiers" ? "active" : ""} onClick={() => setView("tiers")}>Position tiers</button><button className={view === "context" ? "active" : ""} onClick={() => setView("context")}>Specialists & teams</button></nav></div>{view === "tiers" ? <section className="workspace tier-workspace"><div className="section-heading"><div><p className="eyebrow">ALL-POSITION TIER BOARD</p><h2>Draft tier breaks under full-PPR scoring</h2></div><p>Boris Chen tiers remain visible, while live rank layers the newer Flock order, dated movement, league settings, projections, and current availability.</p></div><div className="tier-position-tabs">{options.map((item) => <button className={position === item ? "active" : ""} onClick={() => setPosition(item)} key={item}>{item}</button>)}</div><section className={`tier-cluster-board ${position === "ALL" ? "all-tier-view" : ""}`}>{tiers.map(([tier, tierPlayers], index) => <article className={`tier-band tier-tone-${index % 6}`} key={tier}><header><span>{position === "ALL" ? "OVERALL TIER" : "BORIS TIER"}</span><strong>{tier}</strong><small>{tierPlayers.length} players</small></header><div>{tierPlayers.map((player) => <button className={playerPreferenceClass(notes[player.id], player)} title={`${player.name} · ${fmt(ppg(player), 1)} PPR PPG · ${statLine(player)}`} onClick={() => open(player.id)} key={player.id}><span className={`pos pos-${player.pos}`}>{player.pos}</span><b>{player.name}</b><small>Live #{player.rank} · Boris {position === "ALL" ? `O${tier}` : `T${player.borisTier || "—"}`} / Live T{player.liveTier || player.tier || "—"} · {fmt(ppg(player), 1)} PPG · ADP {fmt(player.adp, 1)}</small><i><em style={{ width: `${confidence(player)}%` }}/></i></button>)}</div></article>)}</section><section className="compact-range-atlas"><div className="tier-board-heading"><div><p className="eyebrow">COMPACT EXPERT RANGE</p><h3>Hover a player for weekly context</h3></div></div><div className="compact-range-grid">{["QB", "RB", "WR", "TE", "K", "DST"].map((pos) => { const entries = players.filter((player) => player.pos === pos).slice(0, 10); const minimum = Math.min(...entries.map((player) => player.bestRank || player.rank)); const maximum = Math.max(...entries.map((player) => player.worstRank || player.rank)); const scale = (rank: number) => (rank - minimum) / Math.max(1, maximum - minimum) * 100; return <article className="mini-range-card" key={pos}><header><span className={`pos pos-${pos}`}>{pos}</span><b>Top 10</b><small>#{minimum} → #{maximum}</small></header><div>{entries.map((player) => <button className={playerPreferenceClass(notes[player.id], player)} title={`${player.name} · ${fmt(ppg(player), 1)} PPG · ${statLine(player)}`} onClick={() => open(player.id)} key={player.id}><span>{player.name}</span><i><em style={{ left: `${scale(player.bestRank || player.rank)}%`, width: `${Math.max(2, scale(player.worstRank || player.rank) - scale(player.bestRank || player.rank))}%` }}/><strong style={{ left: `${scale(player.rank)}%` }}/></i><b>{fmt(ppg(player), 1)}</b></button>)}</div></article>; })}</div></section><InjuryPulse players={players} compact open={open}/></section> : <section className="workspace specialist-workspace"><div className="section-heading"><div><p className="eyebrow">SPECIALISTS & TEAM CONTEXT</p><h2>Full-PPR scoring and projected offensive concentration</h2></div><p>The team environment score sums each NFL team&apos;s top five projected weekly fantasy assets. It is a fantasy-volume proxy, not an implied Vegas total.</p></div><div className="context-sortbar"><label><span>Sort specialists</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="rank">League rank</option><option value="projection">Season projection</option><option value="ppg">PPG</option><option value="confidence">Confidence</option></select></label><button onClick={() => setDirection((current) => current === "asc" ? "desc" : "asc")}><span>Direction</span><b>{direction === "asc" ? "Ascending ↑" : "Descending ↓"}</b></button></div><div className="b-context-grid"><section className="context-panel"><div className="context-panel-heading"><div><p className="eyebrow">KICKER & D/ST BOARD</p><h3>League-specific projections</h3></div></div><div className="context-table-wrap"><table className="context-table"><thead><tr><th>RK</th><th>Player</th><th>Pos</th><th>Proj.</th><th>PPG</th><th>Stat/G</th><th>Conf.</th></tr></thead><tbody>{specialist.map((player, index) => <tr className={playerPreferenceClass(notes[player.id], player)} key={player.id}><td>#{index + 1}</td><td><button onClick={() => open(player.id)}><b>{player.name}</b><small>{player.team}</small></button></td><td>{player.pos}</td><td>{fmt(player.projectedPoints, 1)}</td><td>{fmt(ppg(player), 1)}</td><td>{statLine(player)}</td><td>{confidence(player).toFixed(0)}%</td></tr>)}</tbody></table></div></section><section className="context-panel"><div className="context-panel-heading"><div><p className="eyebrow">NFL TEAM ENVIRONMENTS</p><h3>Top-five projected PPG concentration</h3></div></div><div className="b-environment-list">{environments.map((entry, index) => <article key={entry.team}><span>#{index + 1}</span><div><b>{entry.team}</b><small>{entry.assets.map((player) => player.name).join(" · ")}</small></div><strong>{entry.score.toFixed(1)}<small>TOP-5 PPG</small></strong></article>)}</div></section></div></section>}</>;
}
function RedraftWatchlists({ players, state, update, open }: {
    players: Player[];
    state: State;
    update: (id: string, patch: Partial<Note>) => void;
    open: (id: string) => void;
}) {
    return <UnifiedWatchlist players={players} notes={state.notes} onUpdate={(id, patch) => update(id, patch as Partial<Note>)} onOpen={open} scoringLabel="full-PPR scoring"/>;
}
function RedraftPlans({ players, state, setState, roster, slot, open }: {
    players: Player[];
    state: State;
    setState: React.Dispatch<React.SetStateAction<State>>;
    roster: Player[];
    slot: number;
    open: (id: string) => void;
}) { const [view, setView] = useState<"rounds" | "value" | "roster">("rounds"); const [scenario, setScenario] = useState("A"); const valueBoard = players.filter((player) => player.adp != null && valueDelta(player)! >= 4 && ["QB", "RB", "WR", "TE"].includes(player.pos)).sort((a, b) => valueDelta(b)! - valueDelta(a)!).slice(0, 24); const { slots, assigned, bench } = assignRoster(roster); function toggleLike(id: string) { const liked = !state.notes[id]?.liked; updateSharedPreference(id, { liked, avoid: false }); setState((current) => ({ ...current, notes: { ...current.notes, [id]: { ...current.notes[id], liked, avoid: false } } })); } return <><div className="workspace-hub-nav"><div><p className="eyebrow">DRAFT PLAN & ROSTER</p><strong>Pick-five strategy, target paths, value discovery, and roster construction</strong></div><nav><button className={view === "rounds" ? "active" : ""} onClick={() => setView("rounds")}>Round plans A–J</button><button className={view === "value" ? "active" : ""} onClick={() => setView("value")}>Value lab</button><button className={view === "roster" ? "active" : ""} onClick={() => setView("roster")}>Meet The Robinson&apos;s roster</button></nav></div>{view === "rounds" ? <section className="workspace"><div className="section-heading"><div><p className="eyebrow">CONFIRMED DRAFT ORDER</p><h2>Build every scenario from the fifth pick</h2></div><div className="b-slot-control confirmed"><span>Official draft slot</span><strong>#{slot}</strong><small>Commissioner confirmed</small></div></div><div className="scenario-tabs">{scenarios.map((item) => <button className={scenario === item ? "active" : ""} onClick={() => setScenario(item)} key={item}>{item}</button>)}</div><OptimizedPlanPanel players={players} teamCount={12} rounds={16} slot={slot} starters={{ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DST: 1, K: 1 }} maximums={leagueBConfig.roster.maximums} activeKey={scenario} plans={state.plans} teams={draftOrder()} userTeam={USER_TEAM} onTargetChange={(roundIndex, playerId) => setState((current) => { const existing = current.plans[scenario] || Array.from({ length: 16 }, () => ""); return { ...current, plans: { ...current.plans, [scenario]: existing.map((id, index) => index === roundIndex ? playerId : id) } }; })} likedIds={Object.entries(state.notes).filter(([, note]) => note.liked).map(([id]) => id)} avoidIds={Object.entries(state.notes).filter(([, note]) => note.avoid).map(([id]) => id)} onApply={(models, force) => setState((current) => { const plans = { ...current.plans }; models.forEach((model) => { if (force || !plans[model.key]?.some(Boolean)) plans[model.key] = model.ids; }); return { ...current, plans }; })}/><InjuryPulse players={players} compact open={open}/></section> : view === "value" ? <section className="workspace trend-workspace"><div className="section-heading"><div><p className="eyebrow">FULL-PPR VALUE LAB</p><h2>Players ranked ahead of their current draft price</h2></div><p>Market gap is useful for timing; projection percentile and PPG keep cheap players from automatically looking like good players.</p></div><div className="trend-card-grid">{valueBoard.map((player) => <article key={player.id}><header><span className={`pos pos-${player.pos}`}>{player.pos}</span><div><b>{player.name}</b><small>{player.team} · {player.posRank}</small></div><strong>{clamp((valueDelta(player) || 0) * 2 + (percentile(player, players) || 0) * .65).toFixed(0)}<small>FIT</small></strong></header><p>League-model rank is {fmt(valueDelta(player), 1)} picks ahead of ADP. {statLine(player)}.</p><div className="trend-metrics"><span><b>#{player.rank}</b><small>MODEL</small></span><span><b>{fmt(player.adp, 1)}</b><small>ADP</small></span><span><b>{fmt(ppg(player), 1)}</b><small>PPG</small></span><span><b>{confidence(player).toFixed(0)}%</b><small>CONF</small></span></div><div className="trend-actions"><button onClick={() => open(player.id)}>Details</button><button onClick={() => toggleLike(player.id)}>Like</button></div></article>)}</div></section> : <section className="workspace"><div className="section-heading"><div><p className="eyebrow">MEET THE ROBINSON&apos;S</p><h2>Full-PPR roster construction</h2></div><p>Roster: 1 QB · 2 RB · 2 WR · 1 TE · 1 FLEX · 1 D/ST · 1 K · 7 bench · 1 IR.</p></div><div className="roster-summary"><div><span>Rostered</span><strong>{roster.length}/16</strong></div><div><span>Season projection</span><strong>{fmt(roster.reduce((sum, player) => sum + Number(player.projectedPoints || 0), 0), 1)}</strong></div><div><span>Roster PPG</span><strong>{fmt(roster.reduce((sum, player) => sum + Number(ppg(player) || 0), 0), 1)}</strong></div><div><span>Confirmed slot</span><strong>#{slot}</strong></div></div><div className="roster-layout"><div className="roster-sheet"><div className="roster-row roster-head"><span>SLOT</span><span>PLAYER · STAT/G</span><span>PICK</span><span>ADP</span><span>PROJ</span><span>PPG</span></div>{slots.map((rosterSlot) => <RedraftRosterRow slot={rosterSlot} player={assigned.get(rosterSlot)} state={state} key={rosterSlot}/>)}{Array.from({ length: 7 }, (_, index) => <RedraftRosterRow slot={`BN${index + 1}`} player={bench[index]} state={state} key={index}/>)}<RedraftRosterRow slot="IR" state={state}/></div><aside className="pick-panel"><p className="eyebrow">CONFIRMED PICK PATH</p><h3>Your 16 selections</h3>{Array.from({ length: 16 }, (_, index) => <div className="pick-row" key={index}><span>Round {index + 1}</span><strong>#{snakePick(index + 1, slot)}</strong></div>)}</aside></div></section>}</>; }
function RedraftRosterRow({ slot, player, state }: {
    slot: string;
    player?: Player;
    state: State;
}) { const pick = player ? state.notes[player.id]?.draftedAt : undefined; return <div className="roster-row"><span className="slot-label">{slot}</span>{player ? <><span className="roster-player"><i className={`pos pos-${player.pos}`}>{player.pos}</i><b>{player.name}</b><small>{player.team} · {statLine(player)}</small></span><span>{pick ? `#${pick}` : "—"}</span><span>{fmt(player.adp, 1)}</span><span>{fmt(player.projectedPoints, 1)}</span><span><strong>{fmt(ppg(player), 1)}</strong></span></> : <><span className="open-slot">Open</span><span>—</span><span>—</span><span>—</span><span>—</span></>}</div>; }
function RedraftMethods({ snapshot, state, setState }: {
    snapshot: Snapshot;
    state: State;
    setState: React.Dispatch<React.SetStateAction<State>>;
}) { const [view, setView] = useState<"methods" | "sources">("methods"); return <><div className="workspace-hub-nav"><div><p className="eyebrow">METHODS & SOURCES</p><strong>League rules, scoring conversion, mock logic, source health, and local backups</strong></div><nav><button className={view === "methods" ? "active" : ""} onClick={() => setView("methods")}>Methodology</button><button className={view === "sources" ? "active" : ""} onClick={() => setView("sources")}>Sources & controls</button></nav></div>{view === "methods" ? <section className="workspace methodology-workspace"><div className="section-heading"><div><p className="eyebrow">ROW FAST EAT ASS SEASON 10 CONFIGURATION</p><h2>Exactly what this draft room models</h2></div><p>The commissioner order is confirmed. Meet The Robinson&apos;s drafts fifth and every mock, plan, checkpoint, and grade uses that order.</p></div><section className="accuracy-verdict"><div><span>LEAGUE PROFILE</span><strong>12-team ESPN full-PPR redraft</strong><p>Snake draft · September 8, 2026 at 6:30 PM Central · 90 seconds per selection · no pick trading · 16-player roster.</p></div><dl><div><dt>$100</dt><dd>Starting FAAB</dd></div><div><dt>9</dt><dd>Starters</dd></div><div><dt>7 + IR</dt><dd>Bench structure</dd></div></dl></section><section className="method-panel nyfl-scoring-method"><div className="method-panel-heading"><div><p className="eyebrow">FULL-PPR SCORING</p><h3>Raw projections rescored for Row Fast Eat Ass Season 10</h3></div><p>External feeds supply projected football stats. The site applies the league weights below and divides by projected games for PPG.</p></div><div className="formula-line">Row Fast Eat Ass Season 10 points = raw projected stat × league weight · PPG = full-season total ÷ projected games</div><div className="scoring-rule-grid"><article><span>PASS</span><h4>Quarterbacks</h4><p>0.04 per yard · 4 per TD · −2 per interception · 2 per passing conversion.</p></article><article><span>RUSH</span><h4>Rushing</h4><p>0.1 per yard · 6 per TD · 2 per rushing conversion.</p></article><article><span>PPR</span><h4>Receiving</h4><p><b>1 point per reception</b> · 0.1 per yard · 6 per TD · 2 per conversion.</p></article><article><span>MISC</span><h4>Ball security</h4><p>−2 per fumble lost · return and recovery TDs score 6.</p></article><article><span>K</span><h4>Kicking</h4><p>PAT 1 · miss −1 · FG 0–39: 3 · 40–49: 4 · <b>50+ yards: 5</b>.</p></article><article><span>D/ST</span><h4>Defense</h4><p>Sack 1 · block/INT/FR/safety 2 · TD 6, plus points- and yards-allowed bands.</p></article></div></section><section className="method-two-column"><article className="method-panel"><p className="eyebrow">ROSTER & DRAFT</p><h3>Construction rules</h3><ol><li>1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 D/ST, and 1 K start.</li><li>Seven bench spots and one IR slot.</li><li>Position maximums: QB 4, RB 8, WR 8, TE 3, D/ST 3, K 3.</li><li>CPU mocks block K/D/ST before Round 13 and avoid early position overload.</li><li>Meet The Robinson&apos;s is confirmed at pick 5; the snake reverses the team order in every even round.</li></ol></article><article className="method-panel"><p className="eyebrow">ESPN FAAB</p><h3>Standard acquisition model</h3><ol><li>$100 starting free-agent budget.</li><li>No season acquisition limit.</li><li>Lineups lock individually at each player&apos;s scheduled game time.</li><li>ESPN&apos;s undroppable-player list is enabled.</li><li>The draft room records the setting; it does not submit waiver claims to ESPN.</li></ol></article></section><DraftIntelligenceMethodology scoringLabel="full-PPR"/><section className="method-panel"><div className="method-panel-heading"><div><p className="eyebrow">MOCK GRADE</p><h3>Transparent 0–100 process</h3></div></div><div className="formula-line">48% optimized starting lineup + 17% five-player depth + 22% acquisition value + 13% roster construction + league-relative curve</div><p className="scoring-caveat">This grade evaluates draft process and roster shape. It is not a projected final standing or championship probability.</p></section></section> : <section className="workspace"><div className="section-heading"><div><p className="eyebrow">DATA & CONTROLS</p><h2>Full-PPR sources and your local board</h2></div><p>Last snapshot: {timeLabel(snapshot.generatedAt)}</p></div><div className="source-layout"><div><h3>Automatic sources</h3><div className="source-list">{snapshot.sourceStatus.map((source) => <article key={source.id}><span className={`source-indicator ${source.ok ? "ok" : source.optional ? "optional" : "warning"}`}/><div><a href={source.url} target="_blank">{source.name} ↗</a><p>{source.ok ? `${source.records} records loaded` : source.message}</p></div></article>)}</div><h3>Reference links</h3><div className="reference-links">{snapshot.referenceLinks.map((link) => <a href={link.url} target="_blank" key={link.url}>{link.name}<span>↗</span></a>)}</div></div><aside className="data-notes"><h3>Daily refresh</h3><ul>{snapshot.sourceNotes.map((note) => <li key={note}>{note}</li>)}</ul><div className="state-actions"><h3>Row Fast Eat Ass Season 10 board</h3><p>Like/Avoid preferences are shared across all leagues. Plans, draft status, and the newest 24 confirmed-order mocks remain specific to this room and device.</p><button className="primary-action" onClick={() => { const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `league-b-board-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href); }}>Export Row Fast Eat Ass Season 10 JSON</button><button className="danger-action" onClick={() => confirm("Reset Row Fast Eat Ass Season 10 league-specific plans, draft status, and mock history on this device? Shared Like/Avoid preferences stay available in every league.") && setState({ ...defaultState, notes: mergeSharedPreferences({}) })}>Reset Row Fast Eat Ass Season 10</button></div></aside></div></section>}</>; }
