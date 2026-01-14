// src/modules/gameCore.js
// ゲーム中核（抽選／ピティ／スタンプ反映／通貨）を main.js から分離

import { pickPreferClose } from "./ndc.js";

/**
 * @param {object} params
 * @param {any} params.state
 * @param {"auto"|"ticket"} params.mode
 * @param {number} params.ticketsPerExtraSpin
 */
export function canSpin({ state, mode, ticketsPerExtraSpin }) {
  if (mode === "auto") {
    if (state.freeSpinsLeft > 0) return true;
    return state.bookmarkTickets >= ticketsPerExtraSpin;
  }
  return state.bookmarkTickets >= ticketsPerExtraSpin;
}

/**
 * @param {object} params
 * @param {any} params.state
 * @param {"auto"|"ticket"} params.mode
 * @param {number} params.ticketsPerExtraSpin
 */
export function consumeSpin({ state, mode, ticketsPerExtraSpin }) {
  if (mode === "auto") {
    if (state.freeSpinsLeft > 0) {
      state.freeSpinsLeft -= 1;
      return;
    }
    state.bookmarkTickets -= ticketsPerExtraSpin;
    return;
  }
  state.bookmarkTickets -= ticketsPerExtraSpin;
}

/**
 * ピティ判定（後半加速テーブル）
 * @param {object} params
 * @param {any} params.state
 * @param {any} params.ndc
 * @param {number[]} params.pityTable
 */
export function shouldTriggerPity({ state, ndc, pityTable }) {
  const remaining = countRemainingValidUnstamped({ state, ndc });
  if (remaining <= 0) return false;

  const ds = clampInt(state.dupeStreak, 0, 7);
  const p = pityTable[ds] ?? 0;
  if (p >= 1) return true;
  return Math.random() < p;
}

/**
 * 通常抽選：有効コードのみからランダム
 * @param {any} ndc initNdcの戻り値
 */
export function rollRandomValid(ndc) {
  const t = ndc.validAll[randInt(0, ndc.validAll.length - 1)];
  return { x: t.x, y: t.y, z: t.z, code: t.code };
}

/**
 * 新規確定抽選（優先：同ページ→同綱(行)→全体）
 * @param {object} params
 * @param {any} params.state
 * @param {any} params.ndc
 */
export function rollNewGuaranteed({ state, ndc }) {
  const base = rollRandomValid(ndc);
  const { x, y } = base;

  // 1) 同ページの未取得（有効のみ）
  const candidatesPage = [];
  for (const t of ndc.validByPage[x]) {
    if (!state.stamps[t.x][t.y][t.z]) candidatesPage.push({ x: t.x, y: t.y, z: t.z, code: t.code });
  }
  if (candidatesPage.length > 0) return pickPreferClose(candidatesPage, base);

  // 2) 同綱（同ページ内の行y）の未取得（有効のみ）
  const candidatesRow = [];
  for (const t of ndc.validByPage[x]) {
    if (t.y === y && !state.stamps[t.x][t.y][t.z]) candidatesRow.push({ x: t.x, y: t.y, z: t.z, code: t.code });
  }
  if (candidatesRow.length > 0) return pickPreferClose(candidatesRow, base);

  // 3) 全体未取得（有効のみ）
  const candidatesAll = [];
  for (const t of ndc.validAll) {
    if (!state.stamps[t.x][t.y][t.z]) candidatesAll.push({ x: t.x, y: t.y, z: t.z, code: t.code });
  }
  return pickPreferClose(candidatesAll, base);
}

/**
 * スタンプ反映＆報酬
 * 新規 +2 / ダブり +1 / ページコンプ +50（未付与のときだけ）
 * @param {object} params
 * @param {any} params.state
 * @param {any} params.ndc
 * @param {{x:number,y:number,z:number,code:string}} params.result
 */
export function applyStampAndRewards({ state, ndc, result }) {
  const { x, y, z, code } = result;

  // ここは基本通らない（スロットで対象外を出さないため）
  if (!ndc.isValidCode(code)) {
    state.bookmarkTickets += 1;
    return { isNew: false, ticketDelta: 1, pageCompletedNow: false };
  }

  const wasFilled = state.stamps[x][y][z];
  let ticketDelta = 0;

  if (!wasFilled) {
    state.stamps[x][y][z] = true;
    ticketDelta += 2;
  } else {
    ticketDelta += 1;
  }
  state.bookmarkTickets += ticketDelta;

  let pageCompletedNow = false;
  if (!state.pageRewarded[x] && isPageComplete({ state, ndc, page: x })) {
    state.pageRewarded[x] = true;
    state.bookmarkTickets += 50;
    pageCompletedNow = true;
  }

  return { isNew: !wasFilled, ticketDelta, pageCompletedNow };
}

/**
 * 連続ダブりカウント更新
 * @param {object} params
 * @param {any} params.state
 * @param {boolean} params.isNew
 */
export function updateDupeStreak({ state, isNew }) {
  if (isNew) state.dupeStreak = 0;
  else state.dupeStreak = Math.min(7, state.dupeStreak + 1);
}

/**
 * ページコンプ：有効コードが全て埋まっているか
 */
export function isPageComplete({ state, ndc, page }) {
  const list = ndc.validByPage[page];
  for (const t of list) {
    if (!state.stamps[t.x][t.y][t.z]) return false;
  }
  return true;
}

export function countRemainingValidUnstamped({ state, ndc }) {
  let filledValid = 0;
  for (const t of ndc.validAll) if (state.stamps[t.x][t.y][t.z]) filledValid++;
  return ndc.validAll.length - filledValid;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function clampInt(v, min, max) {
  v = Number.isFinite(v) ? Math.trunc(v) : min;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}
