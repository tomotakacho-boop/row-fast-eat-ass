"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildOptimizedDraftPlans, OptimizedDraftPlan, PlanPlayer } from "./draftIntelligence";
import { DraftResearchPanel } from "./DraftResearchPanel";
import { researchLeagueForTeam, type ResearchLeagueKey } from "./draftResearch";
import { ScenarioDraftBoard, ScenarioKeeper, ScenarioTeam } from "./ScenarioDraftBoard";

function number(value: number | undefined) { return value == null || !Number.isFinite(value) ? "—" : value.toFixed(1); }

export function OptimizedPlanPanel({ players, teamCount, rounds, slot, starters, maximums, activeKey, plans, lockedByRound = {}, unavailableIds = [], likedIds = [], avoidIds = [], diamondIds = [], teams, userTeam, researchLeagueKey, keepers = [], onTargetChange, onApply }:
{
  players: PlanPlayer[];
  teamCount: number;
  rounds: number;
  slot: number;
  starters: Record<string, number>;
  maximums?: Record<string, number>;
  activeKey: string;
  plans: Record<string, string[]>;
  lockedByRound?: Record<number, string>;
  unavailableIds?: string[];
  likedIds?: string[];
  avoidIds?: string[];
  diamondIds?: string[];
  teams?: ScenarioTeam[];
  userTeam?: string;
  researchLeagueKey?: ResearchLeagueKey;
  keepers?: ScenarioKeeper[];
  onTargetChange?: (roundIndex: number, playerId: string) => void;
  onApply: (models: OptimizedDraftPlan[], force: boolean) => void;
}) {
  const seeded = useRef(false);
  const [simulationRun, setSimulationRun] = useState(0);
  const simulationReady = simulationRun > 0;
  const researchLeague = researchLeagueKey || researchLeagueForTeam(userTeam);
  const models = useMemo(() => {
    if (!simulationReady) return [];
    void simulationRun;
    return buildOptimizedDraftPlans({ players, teamCount, rounds, slot, starters, maximums, lockedByRound, unavailableIds, likedIds, avoidIds, diamondIds, researchLeague });
  }, [players, teamCount, rounds, slot, starters, maximums, lockedByRound, unavailableIds, likedIds, avoidIds, diamondIds, researchLeague, simulationReady, simulationRun]);
  const active = models.find((model) => model.key === activeKey) || models[0];
  useEffect(() => {
    if (seeded.current || !models.length) return;
    seeded.current = true;
    onApply(models, false);
  }, [models, onApply]);
  const customized = Boolean(plans[activeKey]?.some((id, index) => id && id !== active?.ids[index]));
  if (!simulationReady) return <><section className="plan-simulation-gate">
    <div><p className="eyebrow">ON-DEMAND DRAFT PATHS</p><h2>Planning simulation is paused</h2><p>Your saved targets remain untouched. Start the model only when you want ten optimized roster paths, opponent projections, and downstream pivots.</p></div>
    <div><span><b>0</b><small>background simulations</small></span><span><b>10</b><small>plans when started</small></span><span><b>{teamCount * rounds}</b><small>picks modeled per plan</small></span></div>
    <button onClick={() => setSimulationRun(1)}>Simulate draft paths</button>
  </section><DraftResearchPanel leagueKey={researchLeague}/></>;
  return <>
    <div className="plan-model-banner"><div><span>SCENARIO {activeKey}{customized ? " · CUSTOMIZED" : ""}</span><b>{active?.name || "Optimized path"}</b><small>{active?.thesis}</small></div><div><span>Starter PPG</span><strong>{number(active?.starterPPG)}</strong></div><div><span>Roster PPG</span><strong>{number(active?.rosterPPG)}</strong></div><div><span>Value</span><strong>{active?.valueScore.toFixed(0) || "—"}</strong></div><div><span>Build</span><strong>{active?.constructionScore.toFixed(0) || "—"}</strong></div></div>
    <div className="plan-model-actions"><button className="primary-action" onClick={() => onApply(models.filter((model) => model.key === activeKey), true)}>Restore scenario {activeKey}</button><button onClick={() => { seeded.current = false; setSimulationRun((run) => run + 1); }}>Rerun simulation</button><button onClick={() => onApply(models, true)}>Rebuild all ten plans</button><span>{Object.entries(active?.positions || {}).map(([position, count]) => `${position} ${count}`).join(" · ")}</span></div>
    <DraftResearchPanel leagueKey={researchLeague}/>
    {teams && userTeam && onTargetChange && <ScenarioDraftBoard key={activeKey} players={players} teams={teams} userTeam={userTeam} slot={slot} rounds={rounds} activeKey={activeKey} activeName={active?.name || "Optimized path"} activeThesis={active?.thesis || ""} planIds={plans[activeKey] || active?.ids || []} onTargetChange={onTargetChange} starters={starters} keepers={keepers} unavailableIds={unavailableIds} likedIds={likedIds} avoidIds={avoidIds}/>} 
  </>;
}
