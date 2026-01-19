// src/modules/state.js
// localStorage 保存・復元、初期化

/**
 * @typedef {Object} GameState
 * @property {number} bookmarkTickets
 * @property {number} dupeStreak
 * @property {number} currentPage
 * @property {boolean[][][]} stamps
 * @property {boolean[]} pageRewarded
 * @property {boolean[][]} rowRewarded
 * @property {string=} lastResultCode
 * @property {{isNew:(boolean|null),ticketDelta:number,breakdown:{label:string,amount:number}[]}} lastOutcome
 * @property {{totalSpins:number,totalNew:number,totalDupe:number}} stats
 * @property {{spins:number,tickets:number,stamps:number}[]} history
 */

export function createInitialState({ startTickets = 30 } = {}) {
  const stamps = Array.from({ length: 10 }, () =>
    Array.from({ length: 10 }, () =>
      Array.from({ length: 10 }, () => false)
    )
  );

  const rowRewarded = Array.from({ length: 10 }, () =>
    Array.from({ length: 10 }, () => false)
  );

  return {
    schemaVersion: 4,
    bookmarkTickets: Math.max(0, Math.trunc(Number(startTickets ?? 30))),
    dupeStreak: 0,
    currentPage: 0,
    stamps,
    pageRewarded: Array.from({ length: 10 }, () => false),
    rowRewarded,
    lastResultCode: "000",
    lastOutcome: { isNew: null, ticketDelta: 0, breakdown: [] },
    stats: { totalSpins: 0, totalNew: 0, totalDupe: 0 },
    history: [],
  };
}

export function loadState({ saveKey, startTickets = 30 }) {
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

    if (!isRowRewardedShapeOk(merged.rowRewarded)) {
      merged.rowRewarded = Array.from({ length: 10 }, () =>
        Array.from({ length: 10 }, () => false)
      );
    }

    if (!merged.stats || typeof merged.stats !== "object") {
      merged.stats = { totalSpins: 0, totalNew: 0, totalDupe: 0 };
    } else {
      merged.stats.totalSpins = Number(merged.stats.totalSpins ?? 0);
      merged.stats.totalNew = Number(merged.stats.totalNew ?? 0);
      merged.stats.totalDupe = Number(merged.stats.totalDupe ?? 0);
    }

    if (!Array.isArray(merged.history)) {
      merged.history = [];
    }

    // 旧セーブへの軽い移行
    const v = Number(merged.schemaVersion ?? 1);
    if (!Number.isFinite(v) || v < 4) {
      merged.schemaVersion = 4;

      // rowRewarded が無い旧データを救済
      if (!isRowRewardedShapeOk(merged.rowRewarded)) {
        merged.rowRewarded = Array.from({ length: 10 }, () =>
          Array.from({ length: 10 }, () => false)
        );
      }

      // ここでは所持しおり券を強制的に変更しない（既存プレイは尊重）
      if (!merged.lastResultCode || !/^[0-9]{3}$/.test(merged.lastResultCode)) merged.lastResultCode = "000";
    }

    if (!isLastOutcomeShapeOk(merged.lastOutcome)) {
      merged.lastOutcome = { isNew: null, ticketDelta: 0, breakdown: [] };
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

function isRowRewardedShapeOk(rr) {
  if (!Array.isArray(rr) || rr.length !== 10) return false;
  for (let p = 0; p < 10; p++) {
    if (!Array.isArray(rr[p]) || rr[p].length !== 10) return false;
  }
  return true;
}

function isLastOutcomeShapeOk(outcome) {
  if (!outcome || typeof outcome !== "object") return false;
  const isNewOk = outcome.isNew === null || typeof outcome.isNew === "boolean";
  if (!isNewOk) return false;
  if (!Number.isFinite(Number(outcome.ticketDelta ?? 0))) return false;
  if (!Array.isArray(outcome.breakdown)) return false;
  return true;
}

function clampInt(v, min, max) {
  v = Number.isFinite(v) ? Math.trunc(v) : min;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}
