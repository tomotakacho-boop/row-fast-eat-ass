import sharedWatchlistData from "../public/data/shared-watchlist.json";

export type SharedPreference = { liked: boolean; avoid: boolean; diamond: boolean };
export type PreferenceMap = Record<string, SharedPreference>;

const STORAGE_KEY = "fantasy-command-center-shared-preferences-v1";
const SEED_VERSION_KEY = "fantasy-command-center-shared-preferences-seed-version";
const CHANGE_EVENT = "fantasy-shared-preferences-change";

function normalizedName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function loadSharedPreferences(): PreferenceMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function mergeSharedPreferences<T extends { liked?: boolean; avoid?: boolean; diamond?: boolean }>(record: Record<string, T>): Record<string, T> {
  const shared = loadSharedPreferences();
  const merged = { ...record };
  Object.entries(shared).forEach(([id, preference]) => {
    merged[id] = { ...(merged[id] || {}), liked: !!preference.liked, avoid: !!preference.avoid, diamond: !!preference.diamond } as T;
  });
  return merged;
}

export function migrateSharedPreferences(record: Record<string, { liked?: boolean; avoid?: boolean; diamond?: boolean }>) {
  if (typeof window === "undefined") return;
  const shared = loadSharedPreferences();
  let changed = false;
  Object.entries(record).forEach(([id, preference]) => {
    if (id in shared || (!preference.liked && !preference.avoid && !preference.diamond)) return;
    shared[id] = { liked: !!preference.liked, avoid: !!preference.avoid, diamond: !!preference.diamond };
    changed = true;
  });
  if (changed) publish(shared);
}

export function seedRepositoryPreferences(players: Array<{ id: string; name: string }>) {
  if (typeof window === "undefined" || !players.length) return false;
  if (localStorage.getItem(SEED_VERSION_KEY) === sharedWatchlistData.version) return false;

  const playerByName = new Map(players.map((player) => [normalizedName(player.name), player]));
  const shared = loadSharedPreferences();
  sharedWatchlistData.likes.forEach((name) => {
    const player = playerByName.get(normalizedName(name));
    if (player) shared[player.id] = { ...(shared[player.id] || { liked: false, avoid: false, diamond: false }), liked: true, avoid: false };
  });
  sharedWatchlistData.avoids.forEach((name) => {
    const player = playerByName.get(normalizedName(name));
    if (player) shared[player.id] = { ...(shared[player.id] || { liked: false, avoid: false, diamond: false }), liked: false, avoid: true };
  });
  sharedWatchlistData.diamonds.forEach((name) => {
    const player = playerByName.get(normalizedName(name));
    if (player) shared[player.id] = { ...(shared[player.id] || { liked: false, avoid: false, diamond: false }), diamond: true };
  });

  localStorage.setItem(SEED_VERSION_KEY, sharedWatchlistData.version);
  publish(shared);
  return true;
}

export function updateSharedPreference(id: string, patch: Partial<SharedPreference>) {
  if (typeof window === "undefined") return;
  const shared = loadSharedPreferences();
  const current = shared[id] || { liked: false, avoid: false, diamond: false };
  const next = { ...current, ...patch };
  if (patch.liked === true) next.avoid = false;
  if (patch.avoid === true) next.liked = false;
  shared[id] = next;
  publish(shared);
}

export function subscribeSharedPreferences(listener: (preferences: PreferenceMap) => void) {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => listener((event as CustomEvent<PreferenceMap>).detail || loadSharedPreferences());
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

function publish(preferences: PreferenceMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  window.dispatchEvent(new CustomEvent<PreferenceMap>(CHANGE_EVENT, { detail: preferences }));
}
