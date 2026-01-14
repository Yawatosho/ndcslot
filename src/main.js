/* src/main.js
   モジュール分割版（ndc.js + state.js）
*/

import { initNdc, pickPreferClose } from "./modules/ndc.js";
import { createInitialState, loadState, saveState, applyDailyResetIfNeeded } from "./modules/state.js";

const SAVE_KEY = "ndc_slot_save_v1";
const FREE_SPINS_PER_DAY = 10;
const TICKETS_PER_EXTRA_SPIN = 10;

// 後半加速ピティ（index = dupeStreak）
const PITY_TABLE = [0.00, 0.10, 0.20, 0.35, 0.55, 0.75, 0.90, 1.00];

// ndc.json は「公開フォルダ直下」に置く（src/ の1つ上）
const NDC_JSON_URL = new URL("../ndc.json", import.meta.url);

// ===== DOM =====
const el = {
  freeSpinsLeft: document.getElementById("freeSpinsLeft"),
  bookmarkTickets: document.getElementById("bookmarkTickets"),
  dupeStreak: document.getElementById("dupeStreak"),

  d0: document.getElementById("d0"),
  d1: document.getElementById("d1"),
  d2: document.getElementById("d2"),
  lastCode: document.getElementById("lastCode"),
  lastSubject: document.getElementById("lastSubject"),

  spinBtn: document.getElementById("spinBtn"),
  useTicketSpinBtn: document.getElementById("useTicketSpinBtn"),
  resetBtn: document.getElementById("resetBtn"),

  tabs: document.getElementById("tabs"),
  grid: document.getElementById("grid"),
  albumHeading: document.getElementById("albumHeading"),
  pageProgress: document.getElementById("pageProgress"),
  totalProgress: document.getElementById("totalProgress"),

  toast: document.getElementById("toast"),
  openSpecLink: document.getElementById("openSpecLink"),
};

// ===== Runtime =====
let ndc = null;   // initNdcの返り値
let state = null; // state.jsのGameState

boot().catch((e) => {
  console.error(e);
  toast("起動に失敗しました（コンソールをご確認ください）");
  if (el.lastSubject) el.lastSubject.textContent = "NDCデータ読み込み失敗";
  setButtonsEnabled(false);
});

async function boot() {
  setButtonsEnabled(false);
  if (el.lastSubject) el.lastSubject.textContent = "NDCデータ読み込み中…";

  ndc = await initNdc({ jsonUrl: NDC_JSON_URL });

  state = loadState({ saveKey: SAVE_KEY, freeSpinsPerDay: FREE_SPINS_PER_DAY });
  applyDailyResetIfNeeded({ state, freeSpinsPerDay: FREE_SPINS_PER_DAY });
  saveState({ saveKey: SAVE_KEY }, state);

  initTabs();
  setSlotDigits(0, 0, 0);
  setResultText("000");

  // Events
  el.spinBtn.addEventListener("click", () => onSpin({ mode: "auto" }));
  el.useTicketSpinBtn.addEventListener("click", () => onSpin({ mode: "ticket" }));
  el.resetBtn.addEventListener("click", () => {
    if (!confirm("保存データを初期化します。よろしいですか？")) return;
    state = createInitialState({ freeSpinsPerDay: FREE_SPINS_PER_DAY });
    saveState({ saveKey: SAVE_KEY }, state);
    renderAll();
    toast("初期化しました");
  });
  el.openSpecLink.addEventListener("click", (ev) => {
    ev.preventDefault();
    toast("SPEC.md / RULES.md / BACKLOG.md をプロジェクトに固定して進めましょう");
  });

  setButtonsEnabled(true);
  renderAll();
  toast(`NDCデータ読み込み完了（有効: ${ndc.validAll.length} / 1000）`);
}

// ===== Core =====
function onSpin(opts) {
  if (!canSpin(opts.mode)) {
    toast("回せません（無料回数またはしおり券が不足）");
    return;
  }

  consumeSpin(opts.mode);

  const pityTriggered = shouldTriggerPity();
  const result = pityTriggered ? rollNewGuaranteed() : rollRandomValid();

  setSlotDigits(result.x, result.y, result.z);
  setResultText(result.code);

  setCurrentPage(result.x);

  const stampOutcome = applyStampAndRewards(result);

  // dupeStreak
  if (stampOutcome.isNew) state.dupeStreak = 0;
  else state.dupeStreak = Math.min(7, state.dupeStreak + 1);

  // stats
  state.stats.totalSpins += 1;
  if (stampOutcome.isNew) state.stats.totalNew += 1;
  else state.stats.totalDupe += 1;

  saveState({ saveKey: SAVE_KEY }, state);

  renderAll({ highlight: { page: result.x, row: result.y, col: result.z } });

  const head = pityTriggered ? "救済" : "結果";
  const subj = ndc.getSubject(result.code) ?? "";
  toast(`${head}: ${result.code}${subj ? ` / ${subj}` : ""}`);

  if (stampOutcome.pageCompletedNow) toast(`ページ ${result.x}xx コンプリート！ しおり券+50`);
}

function canSpin(mode) {
  if (!state) return false;
  if (mode === "auto") {
    if (state.freeSpinsLeft > 0) return true;
    return state.bookmarkTickets >= TICKETS_PER_EXTRA_SPIN;
  }
  return state.bookmarkTickets >= TICKETS_PER_EXTRA_SPIN;
}

function consumeSpin(mode) {
  if (mode === "auto") {
    if (state.freeSpinsLeft > 0) {
      state.freeSpinsLeft -= 1;
      return;
    }
    state.bookmarkTickets -= TICKETS_PER_EXTRA_SPIN;
    return;
  }
  state.bookmarkTickets -= TICKETS_PER_EXTRA_SPIN;
}

function shouldTriggerPity() {
  const remaining = countRemainingValidUnstamped();
  if (remaining <= 0) return false;

  const ds = clampInt(state.dupeStreak, 0, 7);
  const p = PITY_TABLE[ds] ?? 0;
  if (p >= 1) return true;
  return Math.random() < p;
}

// ===== Rolls (valid only) =====
function rollRandomValid() {
  const t = ndc.validAll[randInt(0, ndc.validAll.length - 1)];
  return { x: t.x, y: t.y, z: t.z, code: t.code };
}

function rollNewGuaranteed() {
  const base = rollRandomValid();
  const { x, y } = base;

  // 1) same page
  const candidatesPage = [];
  for (const t of ndc.validByPage[x]) {
    if (!state.stamps[t.x][t.y][t.z]) candidatesPage.push({ x: t.x, y: t.y, z: t.z, code: t.code });
  }
  if (candidatesPage.length > 0) return pickPreferClose(candidatesPage, base);

  // 2) same row (same 綱=XY を「行Y」として扱う)
  const candidatesRow = [];
  for (const t of ndc.validByPage[x]) {
    if (t.y === y && !state.stamps[t.x][t.y][t.z]) candidatesRow.push({ x: t.x, y: t.y, z: t.z, code: t.code });
  }
  if (candidatesRow.length > 0) return pickPreferClose(candidatesRow, base);

  // 3) all
  const candidatesAll = [];
  for (const t of ndc.validAll) {
    if (!state.stamps[t.x][t.y][t.z]) candidatesAll.push({ x: t.x, y: t.y, z: t.z, code: t.code });
  }
  return pickPreferClose(candidatesAll, base);
}

function applyStampAndRewards(result) {
  const { x, y, z, code } = result;

  // 念のため（通常ここは通りません：スロットは有効コードのみ）
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
  if (!state.pageRewarded[x] && isPageComplete(x)) {
    state.pageRewarded[x] = true;
    state.bookmarkTickets += 50;
    pageCompletedNow = true;
  }

  return { isNew: !wasFilled, ticketDelta, pageCompletedNow };
}

// ===== Render =====
function renderAll(opts = {}) {
  if (!state || !ndc) return;

  el.freeSpinsLeft.textContent = String(state.freeSpinsLeft);
  el.bookmarkTickets.textContent = String(state.bookmarkTickets);
  el.dupeStreak.textContent = String(state.dupeStreak);

  el.spinBtn.disabled = !canSpin("auto");
  el.useTicketSpinBtn.disabled = !(state.bookmarkTickets >= TICKETS_PER_EXTRA_SPIN);

  el.albumHeading.textContent = `ページ ${state.currentPage}xx`;

  el.pageProgress.textContent = String(countPageDisplayFilled(state.currentPage));
  el.totalProgress.textContent = String(countTotalDisplayFilled());

  updateTabsActive();
  renderGrid(opts.highlight);
}

function renderGrid(highlight) {
  const page = state.currentPage;
  el.grid.innerHTML = "";

  el.grid.appendChild(makeHeaderCell(""));
  for (let col = 0; col < 10; col++) el.grid.appendChild(makeHeaderCell(String(col)));

  for (let row = 0; row < 10; row++) {
    el.grid.appendChild(makeHeaderCell(String(row), { vertical: true }));

    for (let col = 0; col < 10; col++) {
      const valid = ndc.isValidCell(page, row, col);
      const filled = valid ? (state.stamps[page][row][col] === true) : true; // 対象外は埋まり扱い

      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.filled = String(filled);
      if (!valid) cell.dataset.invalid = "true";

      const isHL = Boolean(highlight)
        && highlight.page === page
        && highlight.row === row
        && highlight.col === col;

      if (isHL) cell.dataset.highlight = "true";

      const code = `${page}${row}${col}`;
      const subj = valid ? (ndc.getSubject(code) ?? "") : "";

      if (!valid) {
        cell.innerHTML = `<span class="mini">—</span>`;
        cell.title = `${code}（対象外）`;
      } else if (filled) {
        cell.innerHTML = `<span class="stamp">●</span>`;
        cell.title = `${code}${subj ? ` / ${subj}` : ""}`;
      } else {
        cell.innerHTML = `<span class="mini">${row}${col}</span>`;
        cell.title = `${code}${subj ? ` / ${subj}` : ""}`;
      }

      el.grid.appendChild(cell);
    }
  }
}

function initTabs() {
  el.tabs.innerHTML = "";
  for (let p = 0; p < 10; p++) {
    const btn = document.createElement("div");
    btn.className = "tab";
    btn.textContent = `${p}xx`;
    btn.dataset.page = String(p);
    btn.dataset.active = "false";
    btn.addEventListener("click", () => {
      setCurrentPage(p);
      saveState({ saveKey: SAVE_KEY }, state);
      renderAll();
    });
    el.tabs.appendChild(btn);
  }
  updateTabsActive();
}

function updateTabsActive() {
  [...el.tabs.children].forEach((node) => {
    const p = Number(node.dataset.page);
    node.dataset.active = String(p === state.currentPage);
  });
}

// ===== UI helpers =====
function setCurrentPage(page) {
  state.currentPage = clampInt(page, 0, 9);
}

function setSlotDigits(x, y, z) {
  el.d0.textContent = String(x);
  el.d1.textContent = String(y);
  el.d2.textContent = String(z);
  const code = `${x}${y}${z}`;
  el.lastCode.textContent = code;
}

function setResultText(code) {
  const subj = ndc?.getSubject(code);
  if (el.lastSubject) el.lastSubject.textContent = subj ? subj : "（分類なし）";
}

// ===== Completion / Progress =====
function isPageComplete(page) {
  const list = ndc.validByPage[page];
  for (const t of list) {
    if (!state.stamps[t.x][t.y][t.z]) return false;
  }
  return true;
}

function countPageDisplayFilled(page) {
  const validCount = ndc.validByPage[page].length;
  const invalidCount = 100 - validCount;

  let filledValid = 0;
  for (const t of ndc.validByPage[page]) if (state.stamps[t.x][t.y][t.z]) filledValid++;
  return invalidCount + filledValid;
}

function countTotalDisplayFilled() {
  const validCountTotal = ndc.validAll.length;
  const invalidCountTotal = 1000 - validCountTotal;

  let filledValid = 0;
  for (const t of ndc.validAll) if (state.stamps[t.x][t.y][t.z]) filledValid++;
  return invalidCountTotal + filledValid;
}

function countRemainingValidUnstamped() {
  const validCountTotal = ndc.validAll.length;
  let filledValid = 0;
  for (const t of ndc.validAll) if (state.stamps[t.x][t.y][t.z]) filledValid++;
  return validCountTotal - filledValid;
}

// ===== Utils =====
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function clampInt(v, min, max) {
  v = Number.isFinite(v) ? Math.trunc(v) : min;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}
function makeHeaderCell(text, opts = {}) {
  const div = document.createElement("div");
  div.className = opts.vertical ? "vcell" : "hcell";
  div.textContent = text;
  return div;
}

let toastTimer = null;
function toast(message) {
  if (!message) return;
  el.toast.textContent = message;
  el.toast.dataset.show = "true";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.dataset.show = "false";
  }, 1700);
}

function setButtonsEnabled(enabled) {
  el.spinBtn.disabled = !enabled;
  el.useTicketSpinBtn.disabled = !enabled;
}

