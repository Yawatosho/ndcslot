// src/modules/state.js
// localStorage 保存・復元、初期化

/**
 * @typedef {Object} GameState
 * @property {number} bookmarkTickets
 * @property {number} dupeStreak
 * @property {number} currentPage
 * @property {boolean[][][]} stamps
 * @property {boolean[]} pageRewarded
 * @property {string=} lastResultCode
 * @property {{totalSpins:number,totalNew:number,totalDupe:number}} stats
 */

export function createInitialState({ startTickets = 300 } = {}) {
  const stamps = Array.from({ length: 10 }, () =>
    Array.from({ length: 10 }, () =>
      Array.from({ length: 10 }, () => false)
    )
  );

  return {
    schemaVersion: 2,
    bookmarkTickets: Math.max(0, Math.trunc(Number(startTickets ?? 300))),
    dupeStreak: 0,
    currentPage: 0,
    stamps,
    pageRewarded: Array.from({ length: 10 }, () => false),
    lastResultCode: "000",
    stats: { totalSpins: 0, totalNew: 0, totalDupe: 0 },
  };
}

export function loadState({ saveKey, startTickets = 300 }) {
  const base = createInitialState({ startTickets });

  try {
    const raw = localStorage.getItem(saveKey);
    if (!raw) return base;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return base;
    if (!isStampsShapeOk(parsed.stamps)) return base;

    const merged = { ...base, ...parsed };

    // 形の補正
    merged.bookmarkTickets = Math.max(0, Number(merged.bookmarkTickets ?? 0));
    merged.dupeStreak = clampInt(merged.dupeStreak, 0, 7);
    merged.currentPage = clampInt(merged.currentPage, 0, 9);
    merged.lastResultCode = String(merged.lastResultCode ?? "000");

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

    // 旧セーブ（schemaVersionが無い/古い）への軽い移行
    const v = Number(merged.schemaVersion ?? 1);
    if (!Number.isFinite(v) || v < 2) {
      merged.schemaVersion = 2;
      // 無料スピン制から「しおり券のみ」へ切替：最低所持を付与（既に多いなら維持）
      merged.bookmarkTickets = Math.max(merged.bookmarkTickets, Math.max(0, Math.trunc(Number(startTickets ?? 300))));
      if (!merged.lastResultCode || !/^[0-9]{3}$/.test(merged.lastResultCode)) merged.lastResultCode = "000";
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
