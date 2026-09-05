"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import fullPprSnapshot from "../public/data/players-full-ppr.json";
import { isMockDraftHistoryEntry, mockDraftHistoryKey, type MockDraftHistoryEntry } from "./mockDraftHistory";
import type { MonteCarloPlayer } from "./monteCarloDraft";

type HistoryPlayer = MonteCarloPlayer & { team?: string };

const LEAGUE = { letter: "B", name: "ROW FAST EAT ASS SEASON 10", players: fullPprSnapshot.players } as const;

function fmt(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function gradeLetter(score: number) {
  if (score >= 93) return "A";
  if (score >= 90) return "A−";
  if (score >= 87) return "B+";
  if (score >= 83) return "B";
  if (score >= 80) return "B−";
  if (score >= 77) return "C+";
  if (score >= 73) return "C";
  if (score >= 70) return "C−";
  if (score >= 65) return "D";
  return "F";
}

function roundForPick(overall: number, teamCount: number) {
  return Math.floor((overall - 1) / teamCount) + 1;
}

export default function MockDraftHistoryDetail({ historyId }: { historyId: string }) {
  const [entry, setEntry] = useState<MockDraftHistoryEntry | null | undefined>(undefined);
  const [selectedTeam, setSelectedTeam] = useState("");
  const league = LEAGUE;
  const players = league.players as HistoryPlayer[];
  const playersById = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        const parsed = JSON.parse(localStorage.getItem(mockDraftHistoryKey("league-b")) || "[]") as unknown;
        const history = Array.isArray(parsed) ? parsed.filter(isMockDraftHistoryEntry) : [];
        const found = history.find((item) => item.id === historyId) || null;
        setEntry(found);
        if (found) setSelectedTeam(found.userTeam);
      } catch {
        setEntry(null);
      }
    });
    return () => { cancelled = true; };
  }, [historyId]);

  if (entry === undefined) return <main className="mock-history-page"><section className="mock-history-state"><strong>Loading mock draft…</strong></section></main>;
  if (!entry) return <main className="mock-history-page"><section className="mock-history-state"><p className="eyebrow">MOCK DRAFT HISTORY</p><strong>This saved draft is not on this device.</strong><p>Mock history is private to the browser where the simulation was completed.</p><Link href="/">Return to the draft room</Link></section></main>;

  const selectedGrade = entry.grades.find((grade) => grade.team === selectedTeam) || entry.grades[0];
  const mine = entry.grades.find((grade) => grade.team === entry.userTeam);
  const teamPicks = entry.picks.filter((pick) => pick.team === selectedGrade?.team).sort((a, b) => a.overall - b.overall);

  return <main className="mock-history-page">
    <header className="mock-history-topbar"><div><span>{league.letter}</span><div><p>{entry.leagueName || league.name}</p><h1>Mock Draft Report</h1></div></div><Link href="/">← Back to draft room</Link></header>
    <section className="mock-history-hero"><div><p className="eyebrow">{entry.scenarioLabel}</p><h2>{entry.userTeam} finished #{mine?.rank || "—"} of {entry.teamCount}</h2><p>{new Date(entry.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} · {entry.rounds} rounds · {entry.picks.length} picks</p></div>{mine && <div className="mock-history-hero-grade"><span>{gradeLetter(mine.grade)}</span><strong>{mine.grade.toFixed(1)}</strong><small>OVERALL SCORE</small></div>}</section>

    <section className="mock-history-leaderboard"><div className="mock-history-section-title"><div><p className="eyebrow">LEAGUE RESULTS</p><h2>Every team ranked and selectable</h2></div><p>Choose a team to inspect all 16 players and the component scores behind its grade.</p></div><div>{entry.grades.slice().sort((a, b) => a.rank - b.rank).map((grade) => <button className={`${grade.team === selectedGrade?.team ? "active" : ""} ${grade.team === entry.userTeam ? "mine" : ""}`} onClick={() => setSelectedTeam(grade.team)} key={grade.team}><span>#{grade.rank}</span><div><b>{grade.team}</b><small>{grade.manager || "Manager"}</small></div><strong>{grade.grade.toFixed(1)}<small>{gradeLetter(grade.grade)}</small></strong></button>)}</div></section>

    {selectedGrade && <section className="mock-history-roster-detail"><header><div><p className="eyebrow">FULL ROSTER</p><h2>{selectedGrade.team}</h2><p>{selectedGrade.manager || "Manager"} · league rank #{selectedGrade.rank}</p></div><div className="mock-history-component-scores"><span><b>{selectedGrade.lineupScore.toFixed(0)}</b><small>LINEUP</small></span><span><b>{selectedGrade.depthScore.toFixed(0)}</b><small>DEPTH</small></span><span><b>{selectedGrade.valueScore.toFixed(0)}</b><small>VALUE</small></span><span><b>{selectedGrade.constructionScore.toFixed(0)}</b><small>BUILD</small></span><span><b>{selectedGrade.starterPPG.toFixed(1)}</b><small>START PPG</small></span></div></header><div className="mock-history-roster-table"><div className="mock-history-roster-head"><span>PICK</span><span>PLAYER</span><span>POS</span><span>MODEL</span><span>ADP</span><span>TIER</span><span>PROJ</span><span>PPG</span><span>VALUE</span></div>{teamPicks.map((pick) => {
      const player = playersById.get(pick.playerId);
      if (!player) return null;
      const ppg = player.projectedPPG ?? (player.projectedPoints == null ? null : player.projectedPoints / (player.projectedGames || 17));
      const value = pick.overall - player.rank;
      return <article key={pick.overall}><span><b>R{roundForPick(pick.overall, entry.teamCount)}</b><small>#{pick.overall}</small></span><span><b>{player.name}</b><small>{player.team || ""}</small></span><span><i className={`pos pos-${player.pos}`}>{player.pos}</i></span><span>#{player.rank}</span><span>{fmt(player.adp)}</span><span>{player.tier || "—"}</span><span>{fmt(player.projectedPoints)}</span><span><b>{fmt(ppg)}</b></span><span className={value >= 0 ? "positive" : "negative"}>{value >= 0 ? "+" : ""}{value}</span></article>;
    })}</div></section>}
  </main>;
}
