// src/modules/gameCore.js
// ゲーム中核（抽選／ピティ／スタンプ反映／通貨／ボーナス判定）

import { pickPreferClose } from "./ndc.js";

/**
 * @typedef {{x:number,y:number,z:number,code:string}} Triple
 */

/**
 * しおり券を「コイン」として消費してスピンする。
 * @param {{state:any, ticketsPerSpin:number}} params
 */
export function canSpin({ state, ticketsPerSpin = 1 }) {
  return Number(state?.bookmarkTickets ?? 0) >= ticketsPerSpin;
}

/**
 * @param {{state:any, ticketsPerSpin:number}} params
 */
export function consumeSpin({ state, ticketsPerSpin = 1 }) {
  const cost = Math.max(0, Math.trunc(Number(ticketsPerSpin ?? 1)));
  state.bookmarkTickets = Math.max(0, Number(state.bookmarkTickets ?? 0) - cost);
}

/**
 * ダブり救済（ピティ）を引くか。
 * 未取得が残っていない場合は無効。
 * @param {{state:any, ndc:any, pityTable:number[]}} params
 */
export function shouldTriggerPity({ state, ndc, pityTable }) {
  if (!ndc?.validAll?.length) return false;
  if (!hasAnyUncollected({ state, ndc })) return false;

  const i = clampInt(Number(state?.dupeStreak ?? 0), 0, 7);
  const p = Number(pityTable?.[i] ?? 0);
  if (p <= 0) return false;
  if (p >= 1) return true;
  return Math.random() < p;
}

/**
 * 通常抽選：有効コードからランダム
 * @param {any} ndc
 * @returns {Triple}
 */
export function rollRandomValid(ndc) {
  const list = ndc?.validAll ?? [];
  if (!list.length) {
    const x = randInt(0, 9), y = randInt(0, 9), z = randInt(0, 9);
    return { x, y, z, code: `${x}${y}${z}` };
  }
  return list[randInt(0, list.length - 1)];
}

/**
 * 新規確定抽選：できるだけ「自然」に見える優先順位で未取得を選ぶ。
 * 1) 同ページ（Xが同じ）
 * 2) 同10の位（Yが同じ）
 * 3) 全体
 * @param {{state:any, ndc:any}} params
 * @returns {Triple}
 */
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

  // 完全コンプ時は通常抽選へフォールバック
  return rollRandomValid(ndc);
}

/**
 * スタンプ反映 + 報酬 + ボーナス
 * @param {{state:any, ndc:any, result:Triple, rewards?:{
 *   new:number, dupe:number, pageComplete:number,
 *   triple:number, straight:number, sandwich:number, pair:number, lucky7:number
 * }}} params
 * @returns {{isNew:boolean, pageCompletedNow:boolean, ticketDelta:number, breakdown:{label:string, amount:number}[]}}
 */
export function applyStampAndRewards({ state, ndc, result, rewards }) {
  const cfg = {
    new: 8,
    dupe: 1,
    pageComplete: 50,
    triple: 1000,
    straight: 300,
    sandwich: 120,
    pair: 60,
    lucky7: 70,
    ...(rewards ?? {}),
  };

  const { x, y, z } = result;
  const valid = Boolean(ndc?.isValidCell?.(x, y, z));

  // 対象外は出さない設計だが、念のため：対象外なら報酬なし
  if (!valid) {
    return { isNew: false, pageCompletedNow: false, ticketDelta: 0, breakdown: [] };
  }

  const was = Boolean(state.stamps[x][y][z]);
  const isNew = !was;
  if (!was) state.stamps[x][y][z] = true;

  const breakdown = [];
  let delta = 0;

  // 基本報酬
  if (isNew) {
    delta += cfg.new;
    breakdown.push({ label: `新規 +${cfg.new}`, amount: cfg.new });
  } else {
    delta += cfg.dupe;
    breakdown.push({ label: `ダブり +${cfg.dupe}`, amount: cfg.dupe });
  }

  // ページコンプ（1回だけ）
  const pageCompletedNow = checkAndApplyPageComplete({ state, ndc, page: x, bonus: cfg.pageComplete, breakdown });
  if (pageCompletedNow) delta += cfg.pageComplete;

  // スペシャルボーナス
  const special = computeSpecialBonuses({ x, y, z }, cfg);
  for (const b of special) {
    delta += b.amount;
    breakdown.push({ label: b.label, amount: b.amount });
  }

  state.bookmarkTickets = Math.max(0, Number(state.bookmarkTickets ?? 0) + delta);

  return { isNew, pageCompletedNow, ticketDelta: delta, breakdown };
}

/**
 * @param {{state:any, isNew:boolean}} params
 */
export function updateDupeStreak({ state, isNew }) {
  if (isNew) {
    state.dupeStreak = 0;
  } else {
    state.dupeStreak = clampInt(Number(state.dupeStreak ?? 0) + 1, 0, 7);
  }
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

function checkAndApplyPageComplete({ state, ndc, page, bonus, breakdown }) {
  if (state.pageRewarded?.[page]) return false;

  const validCount = ndc.validByPage?.[page]?.length ?? 0;
  const invalidCount = 100 - validCount;

  let filledValid = 0;
  for (const t of ndc.validByPage[page]) if (state.stamps[t.x][t.y][t.z]) filledValid++;

  const pageDisplayFilled = invalidCount + filledValid;
  if (pageDisplayFilled >= 100) {
    state.pageRewarded[page] = true;
    breakdown.push({ label: `ページコンプ +${bonus}`, amount: bonus });
    return true;
  }
  return false;
}

function computeSpecialBonuses({ x, y, z }, cfg) {
  const out = [];

  // ゾロ目
  if (x === y && y === z) {
    out.push({ label: `ゾロ目 +${cfg.triple}`, amount: cfg.triple });
  }

  // 連番（昇順/降順） 例: 123, 234, 321, 210
  if (isStraight3(x, y, z)) {
    out.push({ label: `連番 +${cfg.straight}`, amount: cfg.straight });
  }

  // サンドイッチ（ABA） 例: 121, 707
  if (x === z && x !== y) {
    out.push({ label: `サンドイッチ +${cfg.sandwich}`, amount: cfg.sandwich });
  }

  // ペア（AAB/ABB）
  if ((x === y && y !== z) || (y === z && x !== y)) {
    out.push({ label: `ペア +${cfg.pair}`, amount: cfg.pair });
  }

  // ラッキー7（どれかに7が入っていたら）
  if (x === 7 || y === 7 || z === 7) {
    out.push({ label: `ラッキー7 +${cfg.lucky7}`, amount: cfg.lucky7 });
  }

  return out;
}

function isStraight3(a, b, c) {
  // 昇順
  if (b === a + 1 && c === b + 1) return true;
  // 降順
  if (b === a - 1 && c === b - 1) return true;
  return false;
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
