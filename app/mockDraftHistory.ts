import type { DraftTeamGrade } from "./monteCarloDraft";

export const MOCK_DRAFT_HISTORY_KEY = "league-b-hard-mock-history-v1";

export function mockDraftHistoryKey(leagueId: string) {
  return leagueId === "league-b" ? MOCK_DRAFT_HISTORY_KEY : `${leagueId}-hard-mock-history-v1`;
}

export type MockDraftHistoryPick = {
  overall: number;
  playerId: string;
  team: string;
};

export type MockDraftGradeSnapshot = Omit<DraftTeamGrade, "roster">;

export type MockDraftHistoryEntry = {
  id: string;
  signature: string;
  createdAt: string;
  scenarioId: string;
  scenarioLabel: string;
  userTeam: string;
  teamCount: number;
  rounds: number;
  picks: MockDraftHistoryPick[];
  grades: MockDraftGradeSnapshot[];
  topPlayerIds: string[];
  leagueId?: string;
  leagueName?: string;
};

export function isMockDraftHistoryEntry(value: unknown): value is MockDraftHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<MockDraftHistoryEntry>;
  return typeof entry.id === "string"
    && typeof entry.createdAt === "string"
    && typeof entry.userTeam === "string"
    && Array.isArray(entry.picks)
    && Array.isArray(entry.grades);
}
