// src/modules/gameCore.js
// ゲーム中核（抽選／ピティ／スタンプ反映／通貨／ボーナス判定）

import { pickPreferClose } from "./ndc.js";

/**
 * @typedef {{x:number,y:number,z:number,code:string}} Triple
 */

export function canSpin({ state, ticketsPerSpin = 1 }) {
  return Number(state?.bookmarkTickets ?? 0) >= ticketsPerSpin;
}

export function consumeSpin({ state, ticketsPerSpin = 1 }) {
  const cost = Math.max(0, Math.trunc(Number(ticketsPerSpin ?? 1)));
  state.bookmarkTickets = Math.max(0, Number(state.bookmarkTickets ?? 0) - cost);
}

export function shouldTriggerPity({ state, ndc, pityTable }) {
  if (!ndc?.validAll?.length) return false;
  if (!hasAnyUncollected({ state, ndc })) return false;

  const i = clampInt(Number(state?.dupeStreak ?? 0), 0, 7);
  const p = Number(pityTable?.[i] ?? 0);
  if (p <= 0) return false;
  if (p >= 1) return true;
  return Math.random() < p;
}

export function rollRandomValid(ndc) {
  const list = ndc?.validAll ?? [];
  if (!list.length) {
    const x = randInt(0, 9), y = randInt(0, 9), z = randInt(0, 9);
    return { x, y, z, code: `${x}${y}${z}` };
  }
  return list[randInt(0, list.length - 1)];
}

export function rollNewGuaranteed({ state, ndc }) {
  const base = getBaseTriple(state);

  // 1) 同ページ
  const c1 = (ndc?.validByPage?.[base.x] ?? []).filter((t) => !state?.stamps?.[t.x]?.[t.y]?.[t.z]);
  if (c1.length) return pickPreferClose(c1, base);

  // 2) 同10の位（全ページから）
  const c2 = (ndc?.validAll ?? []).filter((t) => t.y === base.y && !state?.stamps?.[t.x]?.[t.y]?.[t.z]);
  if (c2.length) return pickPreferClose(c2, base);

  // 3) 全体
  const c3 = (ndc?.validAll ?? []).filter((t) => !state?.stamps?.[t.x]?.[t.y]?.[t.z]);
  if (c3.length) return pickPreferClose(c3, base);

  return rollRandomValid(ndc);
}

/**
 * スタンプ反映 + 報酬 + ボーナス
 * @param {{state:any, ndc:any, result:Triple, rewards?:{
 *   new:number, dupe:number,
 *   rowComplete:number, pageComplete:number,
 *   triple:number, straight:number, sandwich:number,
 *   n00:number, lucky7:number
 * }}} params
 */
export function applyStampAndRewards({ state, ndc, result, rewards }) {
  const cfg = {
    // 基本（ユーザー指定）
    new: 0,
    dupe: 0,

    // コンプ
    rowComplete: 30,
    pageComplete: 100,

    // 出目ボーナス
    triple: 100,      // ゾロ目
    straight: 30,     // 連番（昇順のみ）
    sandwich: 5,      // サンドイッチ（ABA）
    n00: 20,          // ★n00（x00）ボーナス：100,200,...,900,000
    lucky7: 0,        // なし（互換のため残しているだけ）

    ...(rewards ?? {}),
  };

  const { x, y, z } = result;
  const valid = Boolean(ndc?.isValidCell?.(x, y, z));
  if (!valid) {
    return { isNew: false, pageCompletedNow: false, ticketDelta: 0, breakdown: [] };
  }

  const was = Boolean(state.stamps[x][y][z]);
  const isNew = !was;
  if (!was) state.stamps[x][y][z] = true;

  const breakdown = [];
  let delta = 0;

  // 基本報酬（0は表示しない）
  if (isNew) {
    if (cfg.new > 0) {
      delta += cfg.new;
      breakdown.push({ label: `新規 +${cfg.new}`, amount: cfg.new });
    }
  } else {
    if (cfg.dupe > 0) {
      delta += cfg.dupe;
      breakdown.push({ label: `ダブり +${cfg.dupe}`, amount: cfg.dupe });
    }
  }

  // 1行コンプ（その行が埋まったら、1回だけ）
  const rowCompletedNow = checkAndApplyRowComplete({
    state, ndc, page: x, row: y, bonus: cfg.rowComplete, breakdown
  });
  if (rowCompletedNow) delta += cfg.rowComplete;

  // 1ページコンプ（1回だけ）
  const pageCompletedNow = checkAndApplyPageComplete({
    state, ndc, page: x, bonus: cfg.pageComplete, breakdown
  });
  if (pageCompletedNow) delta += cfg.pageComplete;

  // スペシャルボーナス
  const special = computeSpecialBonuses({ x, y, z }, cfg);
  for (const b of special) {
    if (b.amount > 0) {
      delta += b.amount;
      breakdown.push({ label: b.label, amount: b.amount });
    }
  }

  if (delta !== 0) {
    state.bookmarkTickets = Math.max(0, Number(state.bookmarkTickets ?? 0) + delta);
  }

  return { isNew, pageCompletedNow, ticketDelta: delta, breakdown };
}

export function updateDupeStreak({ state, isNew }) {
  if (isNew) state.dupeStreak = 0;
  else state.dupeStreak = clampInt(Number(state.dupeStreak ?? 0) + 1, 0, 7);
}

// ----------------
// internal helpers
// ----------------

function hasAnyUncollected({ state, ndc }) {
  for (const t of ndc.validAll) {
    if (!state?.stamps?.[t.x]?.[t.y]?.[t.z]) return true;
  }
  return false;
}

function getBaseTriple(state) {
  const s = String(state?.lastResultCode ?? "");
  if (s.length === 3 && /^[0-9]{3}$/.test(s)) {
    return { x: Number(s[0]), y: Number(s[1]), z: Number(s[2]) };
  }
  const x = clampInt(Number(state?.currentPage ?? 0), 0, 9);
  return { x, y: randInt(0, 9), z: randInt(0, 9) };
}

function checkAndApplyRowComplete({ state, ndc, page, row, bonus, breakdown }) {
  if (!Number.isFinite(bonus) || bonus <= 0) return false;

  if (!state.rowRewarded) {
    state.rowRewarded = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => false));
  }
  if (!state.rowRewarded[page]) {
    state.rowRewarded[page] = Array.from({ length: 10 }, () => false);
  }
  if (state.rowRewarded[page][row]) return false;

  // 10列ぶん確認：対象外は最初から埋まり扱い
  for (let col = 0; col < 10; col++) {
    const valid = ndc.isValidCell(page, row, col);
    if (!valid) continue;
    if (!state.stamps[page][row][col]) return false;
  }

  state.rowRewarded[page][row] = true;
  breakdown.push({ label: `1行コンプ +${bonus}`, amount: bonus });
  return true;
}

function checkAndApplyPageComplete({ state, ndc, page, bonus, breakdown }) {
  if (!Number.isFinite(bonus) || bonus <= 0) return false;
  if (state.pageRewarded?.[page]) return false;

  const validCount = ndc.validByPage?.[page]?.length ?? 0;
  const invalidCount = 100 - validCount;

  let filledValid = 0;
  for (const t of ndc.validByPage[page]) if (state.stamps[t.x][t.y][t.z]) filledValid++;

  const pageDisplayFilled = invalidCount + filledValid;
  if (pageDisplayFilled >= 100) {
    state.pageRewarded[page] = true;
    breakdown.push({ label: `1ページコンプ +${bonus}`, amount: bonus });
    return true;
  }
  return false;
}

function computeSpecialBonuses({ x, y, z }, cfg) {
  const out = [];

  // ★n00（x00）ボーナス：y=0,z=0
  // 000 も該当します（ゾロ目と重複で当たる設計）
  if (y === 0 && z === 0) {
    out.push({ label: `x00 +${cfg.n00}`, amount: cfg.n00 });
  }

  // ゾロ目
  if (x === y && y === z) {
    out.push({ label: `ゾロ目 +${cfg.triple}`, amount: cfg.triple });
  }

  // 3桁連番（昇順のみ） 例: 123, 234
  if (isStraightAsc3(x, y, z)) {
    out.push({ label: `連番 +${cfg.straight}`, amount: cfg.straight });
  }

  // サンドイッチ（ABA） 例: 121
  if (x === z && x !== y) {
    out.push({ label: `サンドイッチ +${cfg.sandwich}`, amount: cfg.sandwich });
  }

  // ペア：廃止

  return out;
}

function isStraightAsc3(a, b, c) {
  return (b === a + 1 && c === b + 1);
}

function clampInt(v, min, max) {
  v = Number.isFinite(v) ? Math.trunc(v) : min;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
