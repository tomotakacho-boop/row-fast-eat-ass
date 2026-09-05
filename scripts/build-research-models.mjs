import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = process.env.RESEARCH_CACHE_DIR || path.join(root, "tmp", "research-cache");
const outputPath = path.join(root, "public", "data", "research-models.json");
const snapshotPaths = ["players-full-ppr.json"].map((file) => path.join(root, "public", "data", file));

const agent = "Row-Fast-Season-10-Draft-Room/1.0 (personal fantasy research board)";
const historicalSeasons = [2021, 2022, 2023, 2024];
const historicalProductionSeason = 2025;

const urls = {
  sleeper: "https://api.sleeper.app/v1/players/nfl",
  pbp: `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${historicalProductionSeason}.csv.gz`,
  weekly: `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${historicalProductionSeason}.csv`,
  injury: (season) => `https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_${season}.csv`,
};

const cacheNames = {
  [urls.sleeper]: "sleeper-players.json",
  [urls.pbp]: `play-by-play-${historicalProductionSeason}.csv.gz`,
  [urls.weekly]: `player-week-${historicalProductionSeason}.csv`,
  ...Object.fromEntries(historicalSeasons.map((season) => [urls.injury(season), `injuries-${season}.csv`])),
};

const forwardTeams = [
  ["DAL", "Dallas Cowboys", 3.12, 25.74, 17, 48], ["CIN", "Cincinnati Bengals", 2.67, 25.97, 28, 16], ["LAR", "Los Angeles Rams", 2.55, 26.49, 5, 84], ["DET", "Detroit Lions", 2.54, 26.09, 14, 56],
  ["BUF", "Buffalo Bills", 2.53, 26.06, 3, 87], ["BAL", "Baltimore Ravens", 2.26, 25.93, 24, 32], ["SF", "San Francisco 49ers", 1.58, 25.16, 7, 78], ["GB", "Green Bay Packers", 1.36, 24.93, 27, 18],
  ["CHI", "Chicago Bears", 1.30, 24.53, 6, 82], ["WAS", "Washington Commanders", 1.18, 23.38, 22, 43], ["IND", "Indianapolis Colts", .96, 23.37, 10, 60], ["SEA", "Seattle Seahawks", .79, 24.82, 9, 65],
  ["TB", "Tampa Bay Buccaneers", .72, 23.34, 4, 86], ["JAC", "Jacksonville Jaguars", .29, 23.26, 17, 51], ["NE", "New England Patriots", .23, 23.76, 15, 53], ["KC", "Kansas City Chiefs", .19, 24.03, 23, 38],
  ["LAC", "Los Angeles Chargers", .16, 23.74, 8, 73], ["PHI", "Philadelphia Eagles", .13, 23.97, 2, 91], ["NYG", "New York Giants", -.39, 22.03, 20, 46], ["MIN", "Minnesota Vikings", -.44, 22.53, 12, 57],
  ["NO", "New Orleans Saints", -.87, 21.49, 16, 52], ["ATL", "Atlanta Falcons", -.99, 21.16, 10, 64], ["HOU", "Houston Texans", -1.15, 22.74, 31, 6], ["TEN", "Tennessee Titans", -1.34, 20.65, 30, 8],
  ["DEN", "Denver Broncos", -1.38, 22.40, 1, 100], ["CAR", "Carolina Panthers", -1.73, 20.69, 12, 58], ["PIT", "Pittsburgh Steelers", -1.79, 21.43, 21, 45], ["ARI", "Arizona Cardinals", -1.93, 18.56, 26, 28],
  ["MIA", "Miami Dolphins", -2.12, 19.03, 29, 10], ["LV", "Las Vegas Raiders", -2.86, 19.13, 25, 31], ["NYJ", "New York Jets", -3.76, 18.56, 19, 47], ["CLE", "Cleveland Browns", -3.82, 18.76, 32, 5],
].map(([abbr, name, environmentScore, impliedPoints, olRank, olScore], index) => ({ abbr, name, environmentScore, impliedPoints, environmentRank: index + 1, olRank, olScore }));

function normalizeName(value = "") {
  return String(value).normalize("NFKD").replace(/[’']/g, "").replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeTeam(value = "") {
  return ({ LA: "LAR", JAX: "JAC" })[value] || value;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { cells.push(cell); cell = ""; }
    else cell += character;
  }
  cells.push(cell.replace(/\r$/, ""));
  return cells;
}

function csvRows(text) {
  const lines = text.split(/\n/).filter(Boolean);
  const headers = parseCsvLine(lines.shift() || "");
  return lines.map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

async function readOrFetch(url) {
  await fs.mkdir(cacheDir, { recursive: true });
  const target = path.join(cacheDir, cacheNames[url] || path.basename(new URL(url).pathname));
  try { return await fs.readFile(target); } catch {}
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "user-agent": agent } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(target, buffer);
      return buffer;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 900));
    }
  }
  throw lastError;
}

function percentiles(values) {
  const ordered = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = Array(values.length).fill(0);
  ordered.forEach((entry, index) => { result[entry.index] = ordered.length <= 1 ? 50 : index / (ordered.length - 1) * 100; });
  return result;
}

function pearson(a, b) {
  if (a.length < 3 || a.length !== b.length) return 0;
  const aMean = a.reduce((sum, value) => sum + value, 0) / a.length;
  const bMean = b.reduce((sum, value) => sum + value, 0) / b.length;
  const numerator = a.reduce((sum, value, index) => sum + (value - aMean) * (b[index] - bMean), 0);
  const denominator = Math.sqrt(a.reduce((sum, value) => sum + (value - aMean) ** 2, 0) * b.reduce((sum, value) => sum + (value - bMean) ** 2, 0));
  return denominator ? numerator / denominator : 0;
}

async function buildTeamResearch() {
  const [pbpBuffer, weeklyBuffer] = await Promise.all([readOrFetch(urls.pbp), readOrFetch(urls.weekly)]);
  const pbpRows = csvRows(gunzipSync(pbpBuffer).toString("utf8"));
  const protection = new Map();
  for (const row of pbpRows) {
    if (row.qb_dropback !== "1" || !row.posteam) continue;
    const team = normalizeTeam(row.posteam);
    const current = protection.get(team) || { dropbacks: 0, sacks: 0, hits: 0 };
    current.dropbacks += 1;
    current.sacks += row.sack === "1" ? 1 : 0;
    current.hits += row.qb_hit === "1" ? 1 : 0;
    protection.set(team, current);
  }
  const qbPoints = new Map();
  for (const row of csvRows(weeklyBuffer.toString("utf8"))) {
    if (row.season_type !== "REG" || row.position !== "QB" || !row.team) continue;
    const team = normalizeTeam(row.team);
    qbPoints.set(team, (qbPoints.get(team) || 0) + numeric(row.fantasy_points));
  }
  const base = forwardTeams.map((team) => {
    const observed = protection.get(team.abbr) || { dropbacks: 0, sacks: 0, hits: 0 };
    return {
      ...team,
      historicalDropbacks: observed.dropbacks,
      sackAvoidanceRate: observed.dropbacks ? (1 - observed.sacks / observed.dropbacks) * 100 : 0,
      hitAvoidanceRate: observed.dropbacks ? (1 - observed.hits / observed.dropbacks) * 100 : 0,
      historicalTeamQbPpg: (qbPoints.get(team.abbr) || 0) / 17,
    };
  });
  const sackPercentiles = percentiles(base.map((team) => team.sackAvoidanceRate));
  const hitPercentiles = percentiles(base.map((team) => team.hitAvoidanceRate));
  const teams = base.map((team, index) => ({ ...team, historicalProtectionIndex: sackPercentiles[index] * .55 + hitPercentiles[index] * .45 }));
  const qbPpg = teams.map((team) => team.historicalTeamQbPpg);
  return {
    projectionSeason: 2026,
    historicalSeason: historicalProductionSeason,
    metricDefinition: "Historical protection index = 55% sack-avoidance percentile + 45% QB-hit-avoidance percentile; forward O-line score is the inverse-scaled 2026 Sharp rank.",
    correlations: {
      protectionIndexToTeamQbPpg: pearson(teams.map((team) => team.historicalProtectionIndex), qbPpg),
      sackAvoidanceToTeamQbPpg: pearson(teams.map((team) => team.sackAvoidanceRate), qbPpg),
      hitAvoidanceToTeamQbPpg: pearson(teams.map((team) => team.hitAvoidanceRate), qbPpg),
      sampleSize: teams.length,
    },
    teams,
  };
}

function injurySeverity(row) {
  const report = String(row.report_status || "").toLowerCase();
  const practice = String(row.practice_status || "").toLowerCase();
  if (report.includes("out")) return 1;
  if (report.includes("doubt")) return .8;
  if (report.includes("question")) return .42;
  if (practice.includes("did not")) return .58;
  if (practice.includes("limited")) return .28;
  if (practice.includes("full")) return .08;
  return .2;
}

function validInjuryLabel(value) {
  const label = String(value || "").trim();
  if (!label) return null;
  const lowered = label.toLowerCase();
  if (lowered.includes("not injury related") || lowered.includes("rest") || lowered.includes("personal")) return null;
  return label;
}

async function buildDurabilityHistory() {
  const [sleeperBuffer, ...injuryBuffers] = await Promise.all([readOrFetch(urls.sleeper), ...historicalSeasons.map((season) => readOrFetch(urls.injury(season)))]);
  const sleeper = JSON.parse(sleeperBuffer.toString("utf8"));
  const sleeperByName = new Map(Object.values(sleeper).filter((player) => player?.full_name).map((player) => [normalizeName(player.full_name), player]));
  const weeks = new Map();
  for (const buffer of injuryBuffers) {
    for (const row of csvRows(buffer.toString("utf8"))) {
      if (!row.full_name || !["QB", "RB", "WR", "TE", "K"].includes(row.position)) continue;
      const injury = validInjuryLabel(row.report_primary_injury) || validInjuryLabel(row.practice_primary_injury) || validInjuryLabel(row.report_secondary_injury) || validInjuryLabel(row.practice_secondary_injury);
      if (!injury) continue;
      const key = normalizeName(row.full_name);
      const weekKey = `${row.season}-${row.week}`;
      if (!weeks.has(key)) weeks.set(key, new Map());
      const current = weeks.get(key).get(weekKey);
      const candidate = { season: numeric(row.season), week: numeric(row.week), severity: injurySeverity(row), injury, status: row.report_status || row.practice_status || "Listed" };
      if (!current || candidate.severity > current.severity) weeks.get(key).set(weekKey, candidate);
    }
  }
  const players = {};
  const allNames = new Set([...sleeperByName.keys(), ...weeks.keys()]);
  for (const key of allNames) {
    const sleeperPlayer = sleeperByName.get(key);
    const reports = [...(weeks.get(key)?.values() || [])].sort((a, b) => a.season - b.season || a.week - b.week);
    const bodyCounts = reports.reduce((map, report) => map.set(report.injury, (map.get(report.injury) || 0) + 1), new Map());
    const seasons = [...new Set(reports.map((report) => report.season))];
    const yearWeight = new Map([[2021, .4], [2022, .55], [2023, .75], [2024, 1]]);
    players[key] = {
      name: sleeperPlayer?.full_name || reports[0]?.full_name || key,
      age: numeric(sleeperPlayer?.age) || null,
      yearsExperience: numeric(sleeperPlayer?.years_exp),
      currentStatus: sleeperPlayer?.injury_status || null,
      currentBodyPart: sleeperPlayer?.injury_body_part || null,
      currentNotes: sleeperPlayer?.injury_notes || null,
      reportWeeks: reports.length,
      severeReportWeeks: reports.filter((report) => report.severity >= .78).length,
      seasonsAffected: seasons.length,
      weightedSeverity: reports.reduce((sum, report) => sum + report.severity * (yearWeight.get(report.season) || .4), 0),
      recurringBodyParts: [...bodyCounts.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([body, count]) => ({ body, count })),
      topBodyParts: [...bodyCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([body, count]) => ({ body, count })),
    };
  }
  return { seasons: historicalSeasons, players };
}

function workload(player) {
  const stats = player.projection || {};
  if (player.pos === "QB") return numeric(stats.passAttempts) + numeric(stats.rushAttempts);
  if (player.pos === "RB") return numeric(stats.rushAttempts) + numeric(stats.targets);
  if (["WR", "TE"].includes(player.pos)) return numeric(stats.targets) + numeric(stats.rushAttempts);
  if (player.pos === "K") return numeric(stats.patMade) + numeric(stats.fgMade0to39) + numeric(stats.fgMade40to49) + numeric(stats.fgMade50to59) + numeric(stats.fgMade60plus);
  return 0;
}

function currentRisk(status = "", availability = 1) {
  const label = String(status).toUpperCase();
  if (label.includes("IR") || label.includes("PUP") || label.includes("OUT")) return 100;
  if (label.includes("DOUBT")) return 76;
  if (label.includes("QUESTION")) return 45;
  if (label.includes("LIMIT")) return 28;
  return clamp((1 - numeric(availability || 1)) * 100);
}

function ageRisk(position, age, experience) {
  const threshold = { QB: 31, RB: 26, WR: 28, TE: 29, K: 34 }[position] ?? 28;
  const slope = { QB: 6, RB: 11, WR: 8, TE: 7, K: 4 }[position] ?? 6;
  if (!age) return clamp(numeric(experience) * 2);
  return clamp(Math.max(0, age - threshold) * slope + Math.max(0, experience - 6) * 2);
}

function riskBand(score, position) {
  if (position === "DST") return "Unit N/A";
  if (score >= 80) return "Severe";
  if (score >= 65) return "High";
  if (score >= 45) return "Elevated";
  if (score >= 25) return "Moderate";
  return "Low";
}

function attachDurability(players, history) {
  const workloadPercentile = new Map();
  for (const position of ["QB", "RB", "WR", "TE", "K"]) {
    const peers = players.filter((player) => player.pos === position);
    const scores = percentiles(peers.map(workload));
    peers.forEach((player, index) => workloadPercentile.set(player.id, scores[index]));
  }
  return players.map((player) => {
    const record = history.players[normalizeName(player.name)] || {};
    const positionBaseline = ({ QB: 15, RB: 40, WR: 31, TE: 28, K: 8, DST: 0 })[player.pos] ?? 24;
    const historyScore = clamp(numeric(record.weightedSeverity) * 10 + numeric(record.severeReportWeeks) * 3 + numeric(record.recurringBodyParts?.length) * 5);
    const recurrenceScore = clamp(numeric(record.recurringBodyParts?.length) * 20 + Math.max(0, numeric(record.reportWeeks) - numeric(record.seasonsAffected) * 2) * 4);
    const currentScore = currentRisk(player.injuryStatus || record.currentStatus, player.availabilityMultiplier);
    const ageScore = ageRisk(player.pos, record.age, record.yearsExperience);
    const workloadScore = workloadPercentile.get(player.id) || 0;
    const score = player.pos === "DST" ? 0 : Math.round(clamp(historyScore * .32 + recurrenceScore * .18 + currentScore * .18 + ageScore * .12 + workloadScore * .12 + positionBaseline * .08));
    const confidence = player.pos === "DST" ? 100 : Math.round(clamp(45 + Math.min(25, numeric(record.yearsExperience) * 5) + Math.min(20, numeric(record.seasonsAffected) * 7) + (record.age ? 10 : 0)));
    return {
      ...player,
      age: record.age ?? null,
      yearsExperience: record.yearsExperience ?? null,
      injuryRiskScore: score,
      injuryRiskBand: riskBand(score, player.pos),
      injuryRiskConfidence: confidence,
      injuryRiskComponents: { history: Math.round(historyScore), recurrence: Math.round(recurrenceScore), current: Math.round(currentScore), ageExperience: Math.round(ageScore), workload: Math.round(workloadScore), positionBaseline },
      injuryHistory: { reportWeeks: record.reportWeeks || 0, severeReportWeeks: record.severeReportWeeks || 0, seasonsAffected: record.seasonsAffected || 0, topBodyParts: record.topBodyParts || [], recurringBodyParts: record.recurringBodyParts || [] },
    };
  });
}

async function main() {
  const [teamResearch, durability] = await Promise.all([buildTeamResearch(), buildDurabilityHistory()]);
  const generatedAt = new Date().toISOString();
  const model = {
    generatedAt,
    teamResearch,
    durability: {
      seasons: durability.seasons,
      modelVersion: "2026.08-v1",
      weights: { historicalBurden: 32, recurrence: 18, currentStatus: 18, ageExperience: 12, projectedWorkload: 12, positionBaseline: 8 },
      disclaimer: "A relative durability-risk index, not an injury probability or medical diagnosis. A score of 100 means the strongest combined risk signal in this model—not certainty that a player will be injured.",
      sourcePlayerCount: Object.keys(durability.players).length,
    },
    sources: [
      { name: "nflverse 2021–2024 weekly injury reports", url: "https://nflreadr.nflverse.com/reference/load_injuries.html" },
      { name: "nflverse 2025 play-by-play", url: "https://github.com/nflverse/nflverse-data/releases/tag/pbp" },
      { name: "nflverse 2025 weekly player stats", url: "https://github.com/nflverse/nflverse-data/releases/tag/stats_player" },
      { name: "Sleeper public NFL player directory", url: urls.sleeper },
      { name: "2026 Sharp offensive-line rankings", url: "https://www.sharpfootballanalysis.com/analysis/best-nfl-offensive-line-rankings/" },
      { name: "2026 DraftSharks Fantasy Environment Score", url: "https://www.draftsharks.com/article/fantasy-environment-score" },
      { name: "NFL hamstring recurrence study", url: "https://pubmed.ncbi.nlm.nih.gov/34878369/" },
    ],
  };
  await fs.writeFile(outputPath, `${JSON.stringify(model, null, 2)}\n`);
  for (const snapshotPath of snapshotPaths) {
    const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
    snapshot.players = attachDurability(snapshot.players || [], durability);
    snapshot.sourceNotes = [...new Set([...(snapshot.sourceNotes || []), "Durability risk is a relative 0–100 index using 2021–2024 nflverse injury-report burden and recurrence, current status, age/experience, projected workload, and position baseline. It is not a probability or medical diagnosis.", "The shared team model combines 2026 Sharp O-line projections, DraftSharks implied offense, and 2025 nflverse sack/QB-hit avoidance; historical Pearson correlations are recalculated from the underlying 32-team sample."])];
    snapshot.referenceLinks = [...(snapshot.referenceLinks || []).filter((link) => !["nflverse injury reports", "Sharp O-line rankings", "DraftSharks environment"].includes(link.name)), { name: "nflverse injury reports", url: "https://nflreadr.nflverse.com/reference/load_injuries.html" }, { name: "Sharp O-line rankings", url: "https://www.sharpfootballanalysis.com/analysis/best-nfl-offensive-line-rankings/" }, { name: "DraftSharks environment", url: "https://www.draftsharks.com/article/fantasy-environment-score" }];
    await fs.writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  }
  console.log(`Wrote ${path.relative(root, outputPath)} and attached durability scores to ${snapshotPaths.length} league snapshots.`);
  console.log(`Historical protection/QB PPG r = ${teamResearch.correlations.protectionIndexToTeamQbPpg.toFixed(3)} (n=${teamResearch.correlations.sampleSize}).`);
}

await main();
