// src/modules/state.js
// localStorage 保存・復元、日替わり処理、初期化

/**
 * @typedef {Object} GameState
 * @property {string} lastPlayDateKey
 * @property {number} freeSpinsLeft
 * @property {number} bookmarkTickets
 * @property {number} dupeStreak
 * @property {number} currentPage
 * @property {boolean[][][]} stamps
 * @property {boolean[]} pageRewarded
 * @property {{totalSpins:number,totalNew:number,totalDupe:number}} stats
 */

export function createInitialState({ freeSpinsPerDay }) {
  const stamps = Array.from({ length: 10 }, () =>
    Array.from({ length: 10 }, () =>
      Array.from({ length: 10 }, () => false)
    )
  );

  return {
    lastPlayDateKey: getTodayKey(),
    freeSpinsLeft: freeSpinsPerDay,
    bookmarkTickets: 0,
    dupeStreak: 0,
    currentPage: 0,
    stamps,
    pageRewarded: Array.from({ length: 10 }, () => false),
    stats: { totalSpins: 0, totalNew: 0, totalDupe: 0 },
  };
}

export function loadState({ saveKey, freeSpinsPerDay }) {
  const base = createInitialState({ freeSpinsPerDay });

  try {
    const raw = localStorage.getItem(saveKey);
    if (!raw) return base;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return base;
    if (!isStampsShapeOk(parsed.stamps)) return base;

    const merged = { ...base, ...parsed };

    // 形の補正
    merged.freeSpinsLeft = clampInt(merged.freeSpinsLeft, 0, freeSpinsPerDay);
    merged.bookmarkTickets = Math.max(0, Number(merged.bookmarkTickets ?? 0));
    merged.dupeStreak = clampInt(merged.dupeStreak, 0, 7);
    merged.currentPage = clampInt(merged.currentPage, 0, 9);
    merged.lastPlayDateKey = String(merged.lastPlayDateKey ?? getTodayKey());

    if (!Array.isArray(merged.pageRewarded) || merged.pageRewarded.length !== 10) {
      merged.pageRewarded = Array.from({ length: 10 }, () => false);
    }
    if (!merged.stats || typeof merged.stats !== "object") {
      merged.stats = { totalSpins: 0, totalNew: 0, totalDupe: 0 };
    } else {
      merged.stats.totalSpins = Number(merged.stats.totalSpins ?? 0);
      merged.stats.totalNew = Number(merged.stats.totalNew ?? 0);
      merged.stats.totalDupe = Number(merged.stats.totalDupe ?? 0);
    }

    return merged;
  } catch (e) {
    console.warn("Failed to load state. Resetting.", e);
    return base;
  }
}

export function saveState({ saveKey }, state) {
  try {
    localStorage.setItem(saveKey, JSON.stringify(state));
  } catch (e) {
    console.warn("Failed to save state.", e);
    throw e;
  }
}

/**
 * 日付が変わっていたら無料回数を復活
 * dupeStreakは現仕様では維持（後で調整しやすい）
 */
export function applyDailyResetIfNeeded({ state, freeSpinsPerDay }) {
  const today = getTodayKey();
  if (state.lastPlayDateKey !== today) {
    state.lastPlayDateKey = today;
    state.freeSpinsLeft = freeSpinsPerDay;
  }
}

export function getTodayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isStampsShapeOk(stamps) {
  if (!Array.isArray(stamps) || stamps.length !== 10) return false;
  for (let p = 0; p < 10; p++) {
    if (!Array.isArray(stamps[p]) || stamps[p].length !== 10) return false;
    for (let r = 0; r < 10; r++) {
      if (!Array.isArray(stamps[p][r]) || stamps[p][r].length !== 10) return false;
    }
  }
  return true;
}

function clampInt(v, min, max) {
  v = Number.isFinite(v) ? Math.trunc(v) : min;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}
