import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pprOutputPath = path.join(root, "public", "data", "players-full-ppr.json");
const injuryOverridePath = path.join(root, "public", "data", "injury-overrides.json");
const flockRankingPath = path.join(root, "public", "data", "flock-rankings-2026.json");
const season = Number(process.env.NFL_SEASON || new Date().getFullYear());
const fpKey = process.env.FANTASYPROS_API_KEY?.trim();
const agent = "Row-Fast-Season-10-Draft-Room/1.0 (personal fantasy draft board)";

const sourceStatus = [];
const espnTeamIdByAbbr = {
  ATL: 1, BUF: 2, CHI: 3, CIN: 4, CLE: 5, DAL: 6, DEN: 7, DET: 8, GB: 9, TEN: 10, IND: 11, KC: 12, LV: 13, LAR: 14, MIA: 15, MIN: 16,
  NE: 17, NO: 18, NYG: 19, NYJ: 20, PHI: 21, ARI: 22, PIT: 23, LAC: 24, SF: 25, SEA: 26, TB: 27, WAS: 28, CAR: 29, JAX: 30, BAL: 33, HOU: 34,
};

const urls = {
  rankings: "https://www.fantasypros.com/nfl/rankings/half-point-ppr-cheatsheets.php",
  rankingsPpr: "https://www.fantasypros.com/nfl/rankings/ppr-cheatsheets.php",
  dynasty: "https://www.fantasypros.com/nfl/rankings/dynasty-overall.php",
  rookies: "https://www.fantasypros.com/nfl/rankings/dynasty-rookies-overall.php",
  adp: "https://www.fantasypros.com/nfl/adp/half-point-ppr-overall.php",
  adpPpr: "https://www.fantasypros.com/nfl/adp/ppr-overall.php",
  boris: "https://www.borischen.co/p/half-ppr-draft-tiers.html",
  borisPpr: "https://www.borischen.co/p/ppr-draft-tiers.html",
  borisExports: "https://s3-us-west-1.amazonaws.com/fftiers/out",
  espn: `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/1?view=kona_player_info`,
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [headers = [], ...records] = rows.filter((entry) => entry.some(Boolean));
  return records.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

async function borisChenTiers(scoring) {
  const isPpr = scoring === "ppr";
  const files = [
    ["QB", "weekly-QB.csv"],
    ["RB", `weekly-RB-${isPpr ? "PPR" : "HALF"}.csv`],
    ["WR", `weekly-WR-${isPpr ? "PPR" : "HALF"}.csv`],
    ["TE", `weekly-TE-${isPpr ? "PPR" : "HALF"}.csv`],
    ["K", "weekly-K.csv"],
    ["DST", "weekly-DST.csv"],
    ["ALL", `weekly-ALL-${isPpr ? "PPR" : "HALF-PPR"}.csv`],
  ];
  const byName = new Map();
  const overallByName = new Map();
  const results = await Promise.all(files.map(async ([position, file]) => {
    const url = `${urls.borisExports}/${file}`;
    try {
      const rows = parseCsv(await fetchText(url, { headers: { accept: "text/csv" } }));
      return { position, file, url, rows, ok: true };
    } catch (error) {
      return { position, file, url, rows: [], ok: false, message: error.message };
    }
  }));
  for (const result of results) {
    sourceStatus.push({
      id: `boris-${scoring}-${result.position.toLowerCase()}`,
      name: `Boris Chen ${isPpr ? "PPR" : "half-PPR"} ${result.position} tiers`,
      url: result.url,
      ok: result.ok,
      records: result.rows.length,
      message: result.message,
    });
    for (const row of result.rows) {
      const target = result.position === "ALL" ? overallByName : byName;
      target.set(normalizeName(row["Player.Name"]), {
        position: result.position,
        rank: numeric(row.Rank),
        tier: numeric(row.Tier),
        bestRank: numeric(row["Best.Rank"]),
        worstRank: numeric(row["Worst.Rank"]),
        averageRank: numeric(row["Avg.Rank"]),
        rankStdDev: numeric(row["Std.Dev"]),
      });
    }
  }
  return { byName, overallByName };
}

function normalizeName(value = "") {
  return value
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildFlockModel(data = {}) {
  const top100 = (data.top100 || []).map(([rank, player, pos, tier]) => ({ rank, player, pos, tier, key: normalizeName(player) }));
  const wrTop50 = (data.wrTop50 || []).map(([rank, player, tier]) => ({ rank, player, tier, key: normalizeName(player) }));
  const topMap = new Map(top100.map((entry) => [entry.key, entry]));
  const wrMap = new Map(wrTop50.map((entry) => [entry.key, entry]));
  const signalMap = new Map((data.movementSignals || []).map((entry) => [normalizeName(entry.player), entry]));

  // The newer WR video supersedes the older relative WR order. Reusing the WR
  // slots from the Top 100 preserves Flock's cross-position construction while
  // changing only which receiver owns each of those slots.
  const originalWrSlots = top100.filter((entry) => entry.pos === "WR").map((entry) => entry.rank).sort((a, b) => a - b);
  const originalWrKeys = new Set(top100.filter((entry) => entry.pos === "WR").map((entry) => entry.key));
  const adjustedWrRank = new Map();
  wrTop50.filter((entry) => originalWrKeys.has(entry.key)).forEach((entry, index) => adjustedWrRank.set(entry.key, originalWrSlots[index]));
  for (const entry of top100.filter((candidate) => candidate.pos === "WR")) {
    if (!adjustedWrRank.has(entry.key)) adjustedWrRank.set(entry.key, entry.rank);
  }
  return { data, topMap, wrMap, signalMap, adjustedWrRank };
}

const leagueRankProfiles = {
  ppr: { id: "league-b", label: "Row Fast Eat Ass Season 10 12-team full PPR", teams: 12, receptions: 1, bench: 7, starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 } },
};

function rankPlayersForLeague(players, flockModel, profile) {
  const flexShares = profile.receptions >= 1 ? { RB: .42, WR: .49, TE: .09 } : { RB: .48, WR: .44, TE: .08 };
  const benchShares = { QB: .08, RB: .36, WR: .39, TE: .09, K: .04, DST: .04 };
  const positions = ["QB", "RB", "WR", "TE", "K", "DST"];
  const pools = Object.fromEntries(positions.map((position) => [position, players.filter((player) => player.pos === position).sort((a, b) => Number(b.projectedPPG || 0) - Number(a.projectedPPG || 0))]));
  const replacementPPG = Object.fromEntries(positions.map((position) => {
    const demand = Math.max(1, Math.round(profile.teams * ((profile.starters[position] || 0) + (profile.starters.FLEX || 0) * (flexShares[position] || 0) + profile.bench * (benchShares[position] || 0))));
    const replacement = pools[position][Math.min(pools[position].length - 1, demand - 1)];
    return [position, Number(replacement?.projectedPPG || 0)];
  }));

  const enriched = players.map((player) => {
    const key = normalizeName(player.name);
    const top = flockModel.topMap.get(key);
    const wr = flockModel.wrMap.get(key);
    const movement = flockModel.signalMap.get(key);
    const consensus = Number(player.consensusRank || player.rank || 400);
    let flockAdjustedRank = top ? (player.pos === "WR" ? flockModel.adjustedWrRank.get(key) ?? top.rank : top.rank) : null;
    if (!flockAdjustedRank && wr) flockAdjustedRank = Math.min(consensus, 100 + Math.max(1, wr.rank - flockModel.adjustedWrRank.size) * 2.4);
    const baseline = flockAdjustedRank == null ? consensus : flockAdjustedRank * .78 + consensus * .22;
    const receptionPenalty = profile.receptions < 1 && ["RB", "WR", "TE"].includes(player.pos)
      ? Math.max(0, Number(player.projection?.receptions || 0)) * (1 - profile.receptions) * .055
      : 0;
    const positionalRank = Number(String(player.consensusPosRank || player.posRank || "").replace(/\D/g, "")) || 99;
    let structureAdjustment = 0;
    if (profile.teams <= 10) {
      if (player.pos === "QB") structureAdjustment -= positionalRank <= 5 ? 4 : positionalRank <= 12 ? 2 : 0;
      if (player.pos === "TE") structureAdjustment -= positionalRank <= 3 ? 4 : positionalRank <= 8 ? 2 : 0;
      if (["RB", "WR", "TE"].includes(player.pos) && consensus > 110) structureAdjustment += profile.bench <= 5 ? 2 : 1;
    } else if (profile.teams >= 14) {
      if (player.pos === "QB" && positionalRank <= 14) structureAdjustment -= 2;
      if (player.pos === "TE" && positionalRank <= 14) structureAdjustment -= 1;
      if (["RB", "WR"].includes(player.pos) && consensus <= 120) structureAdjustment -= .75;
    }
    if ((profile.starters.FLEX || 0) >= 2 && ["RB", "WR"].includes(player.pos)) structureAdjustment -= 1;
    const movementPoints = Number(movement?.rankPoints || 0);
    const injuryPoints = Number(player.injuryRankPenalty || 0);
    const marketScore = baseline + movementPoints + injuryPoints + receptionPenalty + structureAdjustment;
    const vor = Number(player.projectedPPG || 0) - Number(replacementPPG[player.pos] || 0);
    return {
      ...player,
      flockRank: top?.rank ?? null,
      flockAdjustedRank: flockAdjustedRank == null ? null : Number(flockAdjustedRank.toFixed(1)),
      flockTier: top?.tier ?? null,
      flockWrRank: wr?.rank ?? null,
      flockWrTier: wr?.tier ?? null,
      flockMovement: movement?.direction ?? null,
      flockMovementPoints: movementPoints,
      flockHeadline: movement?.headline ?? null,
      flockDetail: movement?.detail ?? null,
      flockReportedAt: movement?.reportedAt ?? null,
      flockSource: movement
        ? flockModel.data.sources?.find((source) => source.id === movement.source)?.url || null
        : wr
          ? "https://www.youtube.com/watch/X1lFeeBDPCk"
          : top
            ? "https://www.youtube.com/watch/73nq-Q6bRyw"
            : null,
      flockVerification: movement?.verification ?? null,
      flockVerificationSource: movement?.verificationSource ?? null,
      leagueModel: profile.label,
      leagueMarketScore: Number(marketScore.toFixed(2)),
      replacementPPG: Number(replacementPPG[player.pos]?.toFixed(2) || 0),
      valueOverReplacementPPG: Number(vor.toFixed(2)),
    };
  });

  const vorOrder = [...enriched].filter((player) => !["K", "DST"].includes(player.pos)).sort((a, b) => b.valueOverReplacementPPG - a.valueOverReplacementPPG);
  const vorRank = new Map(vorOrder.map((player, index) => [player.id, index + 1]));
  const ranked = enriched.map((player) => {
    const projectionRank = vorRank.get(player.id) || Number(player.consensusRank || player.rank || 400);
    let leagueRankScore = player.leagueMarketScore * .82 + projectionRank * .18;
    if (["K", "DST"].includes(player.pos)) leagueRankScore = Math.max(145, player.leagueMarketScore);
    return { ...player, projectionValueRank: projectionRank, liveRankScore: Number(leagueRankScore.toFixed(2)) };
  }).sort((a, b) => a.liveRankScore - b.liveRankScore);

  const positionCounters = new Map();
  ranked.forEach((player, index) => {
    const positionRank = (positionCounters.get(player.pos) || 0) + 1;
    positionCounters.set(player.pos, positionRank);
    player.rank = index + 1;
    player.posRank = `${player.pos}${positionRank}`;
    player.leagueRankDelta = Number(player.consensusRank || player.rank) - player.rank;
    player.liveTier = player.availabilityMultiplier <= .05 ? 99 : Math.max(1, (player.borisTier || player.tier || 1) + Math.ceil(Number(player.injuryRankPenalty || 0) / 12));
    player.tier = player.liveTier;
  });
  return ranked;
}

async function fetchText(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(url, {
        ...options,
        headers: { "user-agent": agent, accept: "text/html,application/json", ...(options.headers || {}) },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 800));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function extractAssignedJson(html, marker) {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Could not find ${marker.trim()}`);
  const start = html.indexOf("{", markerIndex + marker.length);
  if (start < 0) throw new Error(`Could not find JSON after ${marker.trim()}`);

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(html.slice(start, index + 1));
    }
  }
  throw new Error(`Unterminated JSON after ${marker.trim()}`);
}

async function fantasyProsRankings(id, url) {
  try {
    const html = await fetchText(url);
    const data = extractAssignedJson(html, "var ecrData = ");
    const players = Array.isArray(data.players) ? data.players : [];
    sourceStatus.push({ id, name: `FantasyPros ${id}`, url, ok: true, records: players.length, updated: data.last_updated || null });
    return players;
  } catch (error) {
    sourceStatus.push({ id, name: `FantasyPros ${id}`, url, ok: false, records: 0, message: error.message });
    return [];
  }
}

async function fantasyProsAdp(id, url) {
  try {
    const html = await fetchText(url);
    const data = extractAssignedJson(html, "window.FP.reportConfig = ");
    const rows = data.table?.rows || [];
    sourceStatus.push({ id, name: `FantasyPros ${id}`, url, ok: true, records: rows.length });
    return rows;
  } catch (error) {
    sourceStatus.push({ id, name: `FantasyPros ${id}`, url, ok: false, records: 0, message: error.message });
    return [];
  }
}

async function espnPlayers() {
  const filter = {
    players: {
      limit: 600,
      sortDraftRanks: { sortPriority: 100, sortAsc: true, value: "PPR" },
    },
  };
  try {
    const text = await fetchText(urls.espn, { headers: { "x-fantasy-filter": JSON.stringify(filter) } });
    const data = JSON.parse(text);
    const players = Array.isArray(data.players) ? data.players : [];
    sourceStatus.push({ id: "espn", name: "ESPN live draft data", url: "https://fantasy.espn.com/football/livedraftresults", ok: true, records: players.length });
    return players;
  } catch (error) {
    sourceStatus.push({ id: "espn", name: "ESPN live draft data", url: "https://fantasy.espn.com/football/livedraftresults", ok: false, records: 0, message: error.message });
    return [];
  }
}

async function fantasyProsProjections() {
  if (!fpKey) {
    sourceStatus.push({
      id: "fp-projections",
      name: "FantasyPros projections API",
      url: "https://www.fantasypros.com/api-data/",
      ok: false,
      optional: true,
      records: 0,
      message: "Add FANTASYPROS_API_KEY for exact half-PPR consensus projections.",
    });
    return [];
  }
  const url = `https://api.fantasypros.com/public/v2/json/nfl/${season}/projections?week=0&positions=QB:RB:WR:TE:DST:K&scoring=HALF`;
  try {
    const data = JSON.parse(await fetchText(url, { headers: { "x-api-key": fpKey, accept: "application/json" } }));
    const players = data.players || data.data?.players || [];
    sourceStatus.push({ id: "fp-projections", name: "FantasyPros projections API", url: "https://www.fantasypros.com/api-data/", ok: true, records: players.length });
    return players;
  } catch (error) {
    sourceStatus.push({ id: "fp-projections", name: "FantasyPros projections API", url: "https://www.fantasypros.com/api-data/", ok: false, optional: true, records: 0, message: error.message });
    return [];
  }
}

function espnProjection(player) {
  const fullSeason = player?.stats?.find(
    (stat) => stat.seasonId === season && stat.scoringPeriodId === 0 && stat.statSourceId === 1 && stat.statSplitTypeId === 0,
  );
  return {
    points: numeric(fullSeason?.appliedTotal),
    details: fullSeason?.stats || null,
  };
}

function fantasyProsProjectionStats(record) {
  const stats = record?.stats || {};
  return {
    games: numeric(stats.games) ?? 17,
    providerPoints: numeric(stats.points_half ?? stats.points),
    passAttempts: numeric(stats.pass_att),
    completions: numeric(stats.pass_cmp),
    passYards: numeric(stats.pass_yds),
    passTds: numeric(stats.pass_tds),
    interceptions: numeric(stats.pass_ints),
    rushAttempts: numeric(stats.rush_att),
    rushYards: numeric(stats.rush_yds),
    rushTds: numeric(stats.rush_tds),
    targets: numeric(stats.rec_tgts ?? stats.targets),
    receptions: numeric(stats.rec_rec),
    receivingYards: numeric(stats.rec_yds),
    receivingTds: numeric(stats.rec_tds),
    fumblesLost: numeric(stats.fumbles_lost ?? stats.fumbles),
  };
}

function espnProjectionStats(details, position) {
  if (!details) return null;
  const stat = (id) => numeric(details[id]);
  const games = stat(210) ?? 17;
  if (position === "K") return {
    games,
    patMade: stat(86),
    fgMissed: stat(85),
    fgMade0to39: stat(80),
    fgMade40to49: stat(77),
    fgMade50to59: stat(198),
    fgMade60plus: stat(201),
  };
  if (position === "DST") return {
    games,
    interceptions: stat(95),
    fumbleRecoveries: stat(96),
    blockedKicks: stat(97),
    safeties: stat(98),
    sacks: stat(99),
    returnTds: [93, 101, 102, 103, 104].reduce((sum, id) => sum + (stat(id) ?? 0), 0),
    twoPointReturns: stat(206),
    onePointSafeties: stat(209),
    pointsAllowedPerGame: stat(126),
    yardsAllowedPerGame: stat(137),
    pointsAllowedBins: { pa0: stat(89), pa1to6: stat(90), pa7to13: stat(91), pa14to17: stat(92), pa28to34: stat(123), pa35to45: stat(124), pa46plus: stat(125) },
    yardsAllowedBins: { yaUnder100: stat(128), ya100to199: stat(129), ya200to299: stat(130), ya350to399: stat(132), ya400to449: stat(133), ya450to499: stat(134), ya500to549: stat(135), ya550plus: stat(136) },
  };
  return {
    games,
    passAttempts: stat(0),
    completions: stat(1),
    passYards: stat(3),
    passTds: stat(4),
    interceptions: stat(20),
    rushAttempts: stat(23),
    rushYards: stat(24),
    rushTds: stat(25),
    receptions: stat(53),
    targets: stat(58),
    receivingYards: stat(42),
    receivingTds: stat(43),
    fumblesLost: stat(72),
    passTwoPoint: stat(19),
    rushTwoPoint: stat(26),
    receivingTwoPoint: stat(44),
    miscTds: stat(63),
  };
}

function nyflProjectedPoints(stats, position, fallback = null) {
  if (!stats) return fallback;
  const value = (key) => numeric(stats[key]) ?? 0;
  if (position === "K") return value("patMade") - value("fgMissed") + value("fgMade0to39") * 3 + value("fgMade40to49") * 4 + value("fgMade50to59") * 5 + value("fgMade60plus") * 6;
  if (position === "DST") {
    const pa = stats.pointsAllowedBins || {};
    const ya = stats.yardsAllowedBins || {};
    return value("sacks") + value("blockedKicks") * 2 + value("interceptions") * 2 + value("fumbleRecoveries") * 2 + value("safeties") * 2 + value("returnTds") * 6 + value("twoPointReturns") * 2 + value("onePointSafeties")
      + (numeric(pa.pa0) ?? 0) * 5 + (numeric(pa.pa1to6) ?? 0) * 4 + (numeric(pa.pa7to13) ?? 0) * 3 + (numeric(pa.pa14to17) ?? 0) - (numeric(pa.pa28to34) ?? 0) - (numeric(pa.pa35to45) ?? 0) * 3 - (numeric(pa.pa46plus) ?? 0) * 5
      + (numeric(ya.yaUnder100) ?? 0) * 5 + (numeric(ya.ya100to199) ?? 0) * 3 + (numeric(ya.ya200to299) ?? 0) * 2 - (numeric(ya.ya350to399) ?? 0) - (numeric(ya.ya400to449) ?? 0) * 3 - (numeric(ya.ya450to499) ?? 0) * 5 - (numeric(ya.ya500to549) ?? 0) * 6 - (numeric(ya.ya550plus) ?? 0) * 7;
  }
  const hasSkillStats = ["passYards", "rushYards", "receivingYards", "receptions"].some((key) => numeric(stats[key]) != null);
  if (!hasSkillStats) return fallback;
  return value("passYards") * .04 + value("passTds") * 4 - value("interceptions") * 2 + value("passTwoPoint") * 2
    + value("rushYards") * .1 + value("rushTds") * 6 + value("rushTwoPoint") * 2
    + value("receivingYards") * .1 + value("receptions") * .5 + value("receivingTds") * 6 + value("receivingTwoPoint") * 2
    - value("fumblesLost") * 2 + value("miscTds") * 6;
}

function fullPprProjectedPoints(stats, position, fallback = null) {
  if (!stats) return fallback;
  const value = (key) => numeric(stats[key]) ?? 0;
  if (position === "K") return value("patMade") - value("fgMissed") + value("fgMade0to39") * 3 + value("fgMade40to49") * 4 + value("fgMade50to59") * 5 + value("fgMade60plus") * 5;
  if (position === "DST") return nyflProjectedPoints(stats, position, fallback);
  const base = nyflProjectedPoints(stats, position, fallback);
  return base == null ? null : base + value("receptions") * .5;
}

function leagueCProjectedPoints(stats, position, fallback = null) {
  if (!stats) return fallback;
  const value = (key) => numeric(stats[key]) ?? 0;
  if (position === "K") {
    return value("patMade") - value("patMissed") - value("fgMissed0to39") + value("fgMade0to39") * 3 + value("fgMade40to49") * 4 + value("fgMade50to59") * 5 + value("fgMade60plus") * 6;
  }
  if (position === "DST") {
    const pa = stats.pointsAllowedBins || {};
    const ya = stats.yardsAllowedBins || {};
    return value("sacks") + value("blockedKicks") * 2 + value("interceptions") * 2 + value("fumbleRecoveries") * 2 + value("fumbleForced") * 2 + value("safeties") * 2 + value("returnTds") * 6
      + (numeric(pa.pa0) ?? 0) * 5 + (numeric(pa.pa1to6) ?? 0) * 4 + (numeric(pa.pa7to13) ?? 0) * 3 + (numeric(pa.pa14to17) ?? 0) - (numeric(pa.pa28to34) ?? 0) - (numeric(pa.pa35to45) ?? 0) * 3 - (numeric(pa.pa46plus) ?? 0) * 5
      + (numeric(ya.yaUnder100) ?? 0) * 5 + (numeric(ya.ya100to199) ?? 0) * 3 + (numeric(ya.ya200to299) ?? 0) * 2 - (numeric(ya.ya350to399) ?? 0) - (numeric(ya.ya400to449) ?? 0) * 2 - (numeric(ya.ya450to499) ?? 0) * 3 - (numeric(ya.ya500to549) ?? 0) * 4 - (numeric(ya.ya550plus) ?? 0) * 5;
  }
  const hasSkillStats = ["passYards", "rushYards", "receivingYards", "receptions"].some((key) => numeric(stats[key]) != null);
  if (!hasSkillStats) return fallback;
  return value("passYards") * .04 + value("passTds") * 4 - value("interceptions") + value("passTwoPoint") * 2
    + value("rushYards") * .1 + value("rushTds") * 6 + value("rushTwoPoint") * 2
    + value("receivingYards") * .1 + value("receptions") * .5 + value("receivingTds") * 6 + value("receivingTwoPoint") * 2
    - (numeric(stats.fumbles) ?? value("fumblesLost")) + value("miscTds") * 6;
}

function leagueDProjectedPoints(stats, position, fallback = null) {
  if (!stats) return fallback;
  const value = (key) => numeric(stats[key]) ?? 0;
  if (position === "K") {
    return value("patMade") - value("patMissed") - value("fgMissed")
      + value("fgMade0to39") * 3 + value("fgMade40to49") * 4 + value("fgMade50to59") * 5 + value("fgMade60plus") * 6;
  }
  if (position === "DST") {
    const pa = stats.pointsAllowedBins || {};
    return value("sacks") + value("blockedKicks") * 2 + value("interceptions") * 2 + value("fumbleRecoveries") * 2
      + value("fumbleForced") + value("safeties") * 2 + value("returnTds") * 6
      + (numeric(pa.pa0) ?? 0) * 10 + (numeric(pa.pa1to6) ?? 0) * 7 + (numeric(pa.pa7to13) ?? 0) * 4
      + (numeric(pa.pa14to17) ?? 0) - (numeric(pa.pa28to34) ?? 0)
      - ((numeric(pa.pa35to45) ?? 0) + (numeric(pa.pa46plus) ?? 0)) * 4;
  }
  const hasSkillStats = ["passYards", "rushYards", "receivingYards", "receptions"].some((key) => numeric(stats[key]) != null);
  if (!hasSkillStats) return fallback;
  return value("passYards") * .04 + value("passTds") * 4 - value("interceptions") + value("passTwoPoint") * 2
    + value("rushYards") * .1 + value("rushTds") * 6 + value("rushTwoPoint") * 2
    + value("receivingYards") * .1 + value("receptions") + value("receivingTds") * 6 + value("receivingTwoPoint") * 2
    - value("fumblesLost") * 2 + value("miscTds") * 6;
}

function buildPlayers({ baseRankings, adpRows, dynastyMap, rookieMap, espnMap, espnDefenseMap, projectionMap, boris, injuryOverrides, flockModel, scoring }) {
  const adpMap = new Map(adpRows.map((row) => [normalizeName(row.player?.name), row]));
  const rankedSources = [...baseRankings];
  const rankedNames = new Set(rankedSources.map((source) => normalizeName(source.player_name || source.name)));
  for (const [key, override] of injuryOverrides) {
    if (rankedNames.has(key)) continue;
    const espnPlayer = espnMap.get(key);
    rankedSources.push({
      player_id: espnPlayer?.id || key,
      player_name: override.player,
      player_team_id: override.team || "FA",
      player_position_id: override.pos || "NA",
      rank_ecr: rankedSources.length + 1,
      rank_min: null,
      rank_max: null,
      rank_ave: null,
      rank_std: null,
      tier: null,
      pos_rank: null,
      player_bye_week: null,
    });
  }
  const built = rankedSources
    .map((source, index) => {
      if (source.name && !source.player_name) {
        const curatedNews = injuryOverrides.get(normalizeName(source.name));
        if (!curatedNews) return source;
        const priorAvailability = numeric(source.availabilityMultiplier) || 1;
        const baseProjectedPoints = numeric(source.baseProjectedPoints) ?? (numeric(source.projectedPoints) == null ? null : numeric(source.projectedPoints) / priorAvailability);
        const availabilityMultiplier = numeric(curatedNews.availabilityMultiplier) ?? priorAvailability;
        const projectedPoints = availabilityMultiplier <= .05 ? 0 : baseProjectedPoints == null ? source.projectedPoints : baseProjectedPoints * availabilityMultiplier;
        return {
          ...source,
          projectedPoints,
          projectedPPG: projectedPoints == null ? source.projectedPPG : projectedPoints / 17,
          availableGames: Math.round(17 * availabilityMultiplier),
          availabilityMultiplier,
          injuryStatus: curatedNews.status || source.injuryStatus || "ACTIVE",
          injuryHeadline: curatedNews.headline || source.injuryHeadline || null,
          injuryDetail: curatedNews.detail || source.injuryDetail || null,
          injurySource: curatedNews.source || source.injurySource || null,
          injuryUpdatedAt: curatedNews.updatedAt || source.injuryUpdatedAt || null,
          injuryRankPenalty: numeric(curatedNews.rankPenalty) ?? numeric(source.injuryRankPenalty) ?? 0,
        };
      }
      const key = normalizeName(source.player_name);
      const sourceTeam = source.player_team_id || "FA";
      const sourcePosition = source.player_position_id || String(source.pos_rank || "").replace(/\d+/g, "") || "NA";
      const espnPlayer = sourcePosition === "DST" ? espnDefenseMap.get(espnTeamIdByAbbr[sourceTeam]) : espnMap.get(key);
      const composite = adpMap.get(key);
      const fpProjection = projectionMap.get(key);
      const espnProjected = espnProjection(espnPlayer);
      const borisPosition = boris?.byName.get(key);
      const borisOverall = boris?.overallByName.get(key);
      const curatedNews = injuryOverrides.get(key);
      const providerStatus = String(espnPlayer?.injuryStatus || "ACTIVE").toUpperCase();
      const providerInjured = Boolean(espnPlayer?.injured) || !["ACTIVE", "NORMAL", ""].includes(providerStatus);
      const genericPenalty = providerInjured ? providerStatus.includes("OUT") || providerStatus.includes("IR") ? 10 : providerStatus.includes("DOUBT") ? 8 : 3 : 0;
      const injuryRankPenalty = numeric(curatedNews?.rankPenalty) ?? genericPenalty;
      const availabilityMultiplier = numeric(curatedNews?.availabilityMultiplier) ?? (providerInjured ? providerStatus.includes("OUT") || providerStatus.includes("IR") ? .90 : providerStatus.includes("DOUBT") ? .94 : .98 : 1);
      const fpStats = fpProjection ? fantasyProsProjectionStats(fpProjection) : null;
      const projection = espnProjectionStats(espnProjected.details, sourcePosition) || fpStats;
      const fallbackPoints = fpStats?.providerPoints ?? espnProjected.points;
      const baseProjectedPoints = scoring === "ppr" ? fullPprProjectedPoints(projection, sourcePosition, fallbackPoints) : scoring === "league-c" ? leagueCProjectedPoints(projection, sourcePosition, fallbackPoints) : scoring === "league-d" || scoring === "league-e" ? leagueDProjectedPoints(projection, sourcePosition, fallbackPoints) : nyflProjectedPoints(projection, sourcePosition, fallbackPoints);
      const projectedPoints = availabilityMultiplier <= .05 ? 0 : baseProjectedPoints == null ? null : baseProjectedPoints * availabilityMultiplier;
      const projectedGames = numeric(projection?.games) ?? 17;
      const scoringLabel = scoring === "ppr" ? "Row Fast Eat Ass Season 10 full-PPR scoring" : scoring === "league-c" ? "my wet fantasy half-PPR scoring" : scoring === "league-d" ? "League D Sleeper full-PPR scoring" : scoring === "league-e" ? "League E Sleeper full-PPR scoring" : "NYFL custom scoring";
      return {
        id: String(source.player_id || espnPlayer?.id || key),
        name: source.player_name,
        team: sourceTeam || composite?.player?.team?.split(" ")[0] || "FA",
        pos: sourcePosition,
        posRank: source.pos_rank || null,
        bye: numeric(source.player_bye_week),
        rank: numeric(source.rank_ecr) ?? index + 1,
        consensusRank: numeric(source.rank_ecr) ?? index + 1,
        consensusPosRank: source.pos_rank || null,
        bestRank: numeric(source.rank_min),
        worstRank: numeric(source.rank_max),
        averageRank: numeric(source.rank_ave),
        rankStdDev: numeric(source.rank_std),
        tier: borisPosition?.tier ?? numeric(source.tier),
        borisTier: borisPosition?.tier ?? numeric(source.tier),
        borisOverallTier: borisOverall?.tier ?? null,
        borisRank: borisPosition?.rank ?? null,
        borisBestRank: borisPosition?.bestRank ?? null,
        borisWorstRank: borisPosition?.worstRank ?? null,
        borisAverageRank: borisPosition?.averageRank ?? null,
        borisRankStdDev: borisPosition?.rankStdDev ?? null,
        adp: numeric(espnPlayer?.ownership?.averageDraftPosition ?? composite?.avg),
        espnRank: numeric(espnPlayer?.draftRanksByRankType?.PPR?.rank),
        yahooAdp: numeric(composite?.src_236),
        sleeperAdp: numeric(composite?.src_4350),
        rtSportsAdp: numeric(composite?.src_439),
        dynastyRank: dynastyMap.get(key) ?? null,
        rookieRank: rookieMap.get(key) ?? null,
        projectedPoints,
        projectedPPG: projectedPoints != null ? projectedPoints / 17 : null,
        activeGamePPG: baseProjectedPoints != null ? baseProjectedPoints / projectedGames : null,
        baseProjectedPoints,
        projectedGames,
        availableGames: Math.round(17 * availabilityMultiplier),
        availabilityMultiplier,
        injuryStatus: curatedNews?.status || (providerInjured ? providerStatus : "ACTIVE"),
        injuryHeadline: curatedNews?.headline || (providerInjured ? `ESPN status: ${providerStatus}` : null),
        injuryDetail: curatedNews?.detail || null,
        injurySource: curatedNews?.source || null,
        injuryUpdatedAt: curatedNews?.updatedAt || null,
        injuryRankPenalty,
        liveRankScore: (numeric(source.rank_ecr) ?? index + 1) + injuryRankPenalty,
        projectionSource: espnProjected.details ? `ESPN raw stats · ${scoringLabel}` : projection ? `FantasyPros raw stats · ${scoringLabel}` : fallbackPoints != null ? fpStats?.providerPoints != null ? "FantasyPros provider total" : "ESPN provider total" : null,
        projection,
      };
    })
    .filter((player) => player.name && (Number(player.rank) <= 400 || injuryOverrides.has(normalizeName(player.name))));

  return rankPlayersForLeague(built, flockModel, leagueRankProfiles[scoring]);
}

async function main() {
  let previousPpr = null;
  try {
    previousPpr = JSON.parse(await fs.readFile(pprOutputPath, "utf8"));
  } catch {}

  let injuryOverrideData = { asOf: null, entries: [] };
  try { injuryOverrideData = JSON.parse(await fs.readFile(injuryOverridePath, "utf8")); } catch {}
  const injuryOverrides = new Map((injuryOverrideData.entries || []).map((entry) => [normalizeName(entry.player), entry]));
  let flockRankingData = { asOf: null, sources: [], top100: [], wrTop50: [], movementSignals: [] };
  try { flockRankingData = JSON.parse(await fs.readFile(flockRankingPath, "utf8")); } catch {}
  const flockModel = buildFlockModel(flockRankingData);
  sourceStatus.push({ id: "flock-model", name: "Flock Fantasy transcript model", url: "https://www.youtube.com/@FlockFantasy", ok: flockModel.topMap.size > 0, records: flockModel.topMap.size, updated: flockRankingData.asOf || null });

  const [rankingsPpr, dynasty, rookies, compositeAdpPpr, espn, projections, borisPpr] = await Promise.all([
    fantasyProsRankings("full-PPR rankings", urls.rankingsPpr),
    fantasyProsRankings("dynasty rankings", urls.dynasty),
    fantasyProsRankings("rookie rankings", urls.rookies),
    fantasyProsAdp("full-PPR composite ADP", urls.adpPpr),
    espnPlayers(),
    fantasyProsProjections(),
    borisChenTiers("ppr"),
  ]);

  const baseRankingsPpr = rankingsPpr.length ? rankingsPpr : previousPpr?.players || [];
  if (!baseRankingsPpr.length) throw new Error("No full-PPR rankings were available and no previous League B snapshot exists.");

  const dynastyMap = new Map(dynasty.map((player) => [normalizeName(player.player_name), numeric(player.rank_ecr)]));
  const rookieMap = new Map(rookies.map((player) => [normalizeName(player.player_name), numeric(player.rank_ecr)]));
  const espnMap = new Map(espn.map((entry) => [normalizeName(entry.player?.fullName), entry.player]));
  const espnDefenseMap = new Map(espn.filter((entry) => entry.player?.defaultPositionId === 16).map((entry) => [entry.player.proTeamId, entry.player]));
  const projectionMap = new Map(projections.map((player) => [normalizeName(player.name || player.player_name), player]));
  const sharedBuildInputs = { dynastyMap, rookieMap, espnMap, espnDefenseMap, projectionMap, injuryOverrides, flockModel };
  const pprPlayers = buildPlayers({ ...sharedBuildInputs, boris: borisPpr, baseRankings: baseRankingsPpr, adpRows: compositeAdpPpr, scoring: "ppr" });

  const pprSnapshot = {
    season,
    scoring: "Row Fast Eat Ass Season 10 full PPR",
    generatedAt: new Date().toISOString(),
    sourceStatus,
    sourceNotes: [
      `Flock Fantasy's Top 100 is the cross-position anchor; its August 24 WR Top 50 and verified movement signals are layered before this league's scoring model (${flockRankingData.asOf || "no Flock model date"}).`,
      "The final League B rank is recalculated for 12 teams, full PPR, one FLEX and seven bench spots using league-specific value over replacement.",
      "Row Fast Eat Ass Season 10 uses full-PPR expert consensus and ESPN live draft data with raw stat projections rescored for this league.",
      "Official Boris Chen PPR tiers are imported from his published CSV exports; a separate live tier applies newer injury adjustments.",
      `Injury context is merged from ESPN status data and dated repository overrides (${injuryOverrideData.asOf || "no override date"}).`,
      "Scoring is one point per reception, four points per passing touchdown, minus two per interception and fumble lost, and five points for all made field goals of 50 or more yards.",
      "D/ST uses the league's points-allowed and yards-allowed bands in addition to sacks, takeaways, safeties, blocks, and return touchdowns.",
      "Personal flags, draft status, mock history, roster decisions, and round plans are stored separately in this browser and are never overwritten by refreshes.",
    ],
    referenceLinks: [
      { name: "Flock Fantasy Top 100", url: "https://www.youtube.com/watch/73nq-Q6bRyw" },
      { name: "Flock Fantasy Top 50 WR", url: "https://www.youtube.com/watch/X1lFeeBDPCk" },
      { name: "Boris Chen PPR tiers", url: urls.borisPpr },
      { name: "FantasyPros full-PPR rankings", url: urls.rankingsPpr },
      { name: "ESPN live draft trends", url: "https://fantasy.espn.com/football/livedraftresults" },
      { name: "ESPN depth charts", url: "https://www.espn.com/nfl/depth/_/team/ari" },
    ],
    players: pprPlayers,
  };

  await fs.mkdir(path.dirname(pprOutputPath), { recursive: true });
  await fs.writeFile(pprOutputPath, `${JSON.stringify(pprSnapshot, null, 2)}\n`);
  console.log(`Wrote ${pprPlayers.length} players to ${path.relative(root, pprOutputPath)}.`);
  for (const source of sourceStatus) {
    console.log(`${source.ok ? "OK" : source.optional ? "OPTIONAL" : "WARN"} ${source.name}: ${source.records} records${source.message ? ` — ${source.message}` : ""}`);
  }
}

await main();
