/* src/main.js
   MVP: そのままGitHub Pagesで動く最小構成
   - 日次無料10回
   - しおり券10枚で追加スピン
   - 新規+2 / ダブり+1 / ページコンプ+50（1回のみ）
   - 10ページ×10×10 スタンプ帳
   - localStorage保存
   ※ 後で state.js / stampLogic.js / economy.js に分割しやすいように書いています。
*/

const SAVE_KEY = "ndc_slot_save_v1";
const FREE_SPINS_PER_DAY = 10;
const TICKETS_PER_EXTRA_SPIN = 10;

// 後半加速ピティ（index = dupeStreak）
const PITY_TABLE = [0.00, 0.10, 0.20, 0.35, 0.55, 0.75, 0.90, 1.00];

// ===== DOM =====
const el = {
  freeSpinsLeft: document.getElementById("freeSpinsLeft"),
  bookmarkTickets: document.getElementById("bookmarkTickets"),
  dupeStreak: document.getElementById("dupeStreak"),

  d0: document.getElementById("d0"),
  d1: document.getElementById("d1"),
  d2: document.getElementById("d2"),
  lastCode: document.getElementById("lastCode"),

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

// ===== State =====
/**
 * @typedef {Object} GameState
 * @property {string} lastPlayDateKey
 * @property {number} freeSpinsLeft
 * @property {number} bookmarkTickets
 * @property {number} dupeStreak
 * @property {number} currentPage
 * @property {boolean[][][]} stamps  // [10][10][10]
 * @property {boolean[]} pageRewarded // [10] ページコンプ報酬(+50)付与済み
 * @property {Object} stats
 * @property {number} stats.totalSpins
 * @property {number} stats.totalNew
 * @property {number} stats.totalDupe
 */
let state = loadState();
applyDailyResetIfNeeded(state);
saveState(state);

// UI初期化
initTabs();
renderAll();

// ===== Events =====
el.spinBtn.addEventListener("click", () => onSpin({ mode: "auto" }));
el.useTicketSpinBtn.addEventListener("click", () => onSpin({ mode: "ticket" }));
el.resetBtn.addEventListener("click", () => {
  if (!confirm("保存データを初期化します。よろしいですか？")) return;
  state = createInitialState();
  saveState(state);
  renderAll();
  toast("初期化しました");
});
el.openSpecLink.addEventListener("click", (ev) => {
  ev.preventDefault();
  toast("SPEC.md / RULES.md / BACKLOG.md をプロジェクトに置いて進めましょう");
});

// ===== Core =====

/** @param {{mode: "auto"|"ticket"}} opts */
function onSpin(opts) {
  if (!canSpin(opts.mode)) {
    toast("回せません（無料回数またはしおり券が不足）");
    return;
  }

  // 消費
  consumeSpin(opts.mode);

  // ピティ判定（スピン開始時）
  const pityTriggered = shouldTriggerPity(state);
  const result = pityTriggered ? rollNewGuaranteed(state) : rollRandomXYZ();

  // 表示（スロット演出は後で。MVPは即確定）
  setSlotDigits(result.x, result.y, result.z);

  // 自動ページ移動（MVPは瞬間移動。後で“めくり”に差し替え）
  setCurrentPage(result.x);

  // スタンプ反映
  const stampOutcome = applyStampAndRewards(state, result);

  // dupeStreak 更新（結果に基づく）
  if (stampOutcome.isNew) state.dupeStreak = 0;
  else state.dupeStreak = Math.min(7, state.dupeStreak + 1);

  // stats
  state.stats.totalSpins += 1;
  if (stampOutcome.isNew) state.stats.totalNew += 1;
  else state.stats.totalDupe += 1;

  saveState(state);
  renderAll({
    highlight: { page: result.x, row: result.y, col: result.z, isNew: stampOutcome.isNew }
  });

  // トースト
  if (pityTriggered) {
    toast(stampOutcome.isNew
      ? `救済発動：新規 ${formatCode(result)}（しおり+${stampOutcome.ticketDelta}）`
      : `救済発動：ダブり ${formatCode(result)}（しおり+${stampOutcome.ticketDelta}）`
    );
  } else {
    toast(stampOutcome.isNew
      ? `新規 ${formatCode(result)}（しおり+${stampOutcome.ticketDelta}）`
      : `ダブり ${formatCode(result)}（しおり+${stampOutcome.ticketDelta}）`
    );
  }

  // ページコンプ報酬の追加トースト
  if (stampOutcome.pageCompletedNow) {
    toast(`ページ ${result.x}xx コンプリート！ しおり券+50`);
  }
}

function canSpin(mode) {
  if (mode === "auto") {
    if (state.freeSpinsLeft > 0) return true;
    return state.bookmarkTickets >= TICKETS_PER_EXTRA_SPIN;
  }
  // ticket
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

/** ピティ判定（後半加速、7で確定） */
function shouldTriggerPity(s) {
  if (countRemainingUnstamped(s) <= 0) return false;
  const ds = clampInt(s.dupeStreak, 0, 7);
  const p = PITY_TABLE[ds] ?? 0;
  if (p >= 1) return true;
  return Math.random() < p;
}

/** 通常抽選（MVPは完全ランダム） */
function rollRandomXYZ() {
  return {
    x: randInt(0, 9),
    y: randInt(0, 9),
    z: randInt(0, 9),
  };
}

/** 新規確定抽選（優先：同ページ→同綱(行)→全体） */
function rollNewGuaranteed(s) {
  const base = rollRandomXYZ(); // “自然に見える”ための基準
  const { x, y } = base;

  // 1) 同ページの未取得
  const candidatesPage = [];
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      if (!s.stamps[x][row][col]) candidatesPage.push({ x, y: row, z: col });
    }
  }
  if (candidatesPage.length > 0) {
    return pickPreferClose(candidatesPage, base);
  }

  // 2) 同綱（同ページ内の行y）未取得
  const candidatesRow = [];
  for (let col = 0; col < 10; col++) {
    if (!s.stamps[x][y][col]) candidatesRow.push({ x, y, z: col });
  }
  if (candidatesRow.length > 0) {
    return pickPreferClose(candidatesRow, base);
  }

  // 3) 全体未取得
  const candidatesAll = [];
  for (let px = 0; px < 10; px++) {
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        if (!s.stamps[px][row][col]) candidatesAll.push({ x: px, y: row, z: col });
      }
    }
  }
  // ここに来るなら未取得はあるはず
  return pickPreferClose(candidatesAll, base);
}

/** 未取得候補の中から、基準値に近いものを優先（“操作感”を薄める） */
function pickPreferClose(candidates, base) {
  if (candidates.length === 1) return candidates[0];
  const scored = candidates.map(c => ({
    c,
    score: Math.abs(c.x - base.x) * 3 + Math.abs(c.y - base.y) * 2 + Math.abs(c.z - base.z),
  }));
  scored.sort((a, b) => a.score - b.score);
  const topN = Math.min(12, scored.length); // 近いものから少数を抽出してランダム
  return scored[randInt(0, topN - 1)].c;
}

/**
 * スタンプ反映と報酬
 * @returns {{isNew:boolean, ticketDelta:number, pageCompletedNow:boolean}}
 */
function applyStampAndRewards(s, result) {
  const { x, y, z } = result;
  const wasFilled = s.stamps[x][y][z];
  let ticketDelta = 0;

  if (!wasFilled) {
    s.stamps[x][y][z] = true;
    ticketDelta += 2; // 新規
  } else {
    ticketDelta += 1; // ダブり
  }
  s.bookmarkTickets += ticketDelta;

  // ページコンプ（100/100）で+50（未付与のときだけ）
  let pageCompletedNow = false;
  if (!s.pageRewarded[x] && isPageComplete(s, x)) {
    s.pageRewarded[x] = true;
    s.bookmarkTickets += 50;
    pageCompletedNow = true;
  }

  return { isNew: !wasFilled, ticketDelta, pageCompletedNow };
}

// ===== Render =====

function renderAll(opts = {}) {
  // stats
  el.freeSpinsLeft.textContent = String(state.freeSpinsLeft);
  el.bookmarkTickets.textContent = String(state.bookmarkTickets);
  el.dupeStreak.textContent = String(state.dupeStreak);

  // buttons enable/disable
  el.spinBtn.disabled = !canSpin("auto");
  el.useTicketSpinBtn.disabled = !(state.bookmarkTickets >= TICKETS_PER_EXTRA_SPIN);

  // heading
  el.albumHeading.textContent = `ページ ${state.currentPage}xx`;

  // progress
  const pageCount = countPageFilled(state, state.currentPage);
  el.pageProgress.textContent = String(pageCount);
  el.totalProgress.textContent = String(countTotalFilled(state));

  // tabs
  updateTabsActive();

  // grid
  renderGrid(opts.highlight);
}

/** @param {{page:number,row:number,col:number,isNew:boolean}|undefined} highlight */
function renderGrid(highlight) {
  const page = state.currentPage;

  // grid構築（MVPは毎回作り直しでOK）
  el.grid.innerHTML = "";

  // 1行目ヘッダ（左上空白 + 列0..9）
  el.grid.appendChild(makeHeaderCell(""));
  for (let col = 0; col < 10; col++) {
    el.grid.appendChild(makeHeaderCell(String(col)));
  }

  for (let row = 0; row < 10; row++) {
    el.grid.appendChild(makeHeaderCell(String(row), { vertical: true }));

    for (let col = 0; col < 10; col++) {
      const filled = state.stamps[page][row][col] === true;
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.filled = String(filled);

      const isHL = Boolean(highlight)
        && highlight.page === page
        && highlight.row === row
        && highlight.col === col;

      if (isHL) cell.dataset.highlight = "true";

      // 表示はスタンプ記号（必要なら後で数字表示に変更）
      cell.innerHTML = filled
        ? `<span class="stamp">●</span>`
        : `<span class="mini">${row}${col}</span>`;

      cell.title = `${page}${row}${col}`;

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
      saveState(state);
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

function setCurrentPage(page) {
  state.currentPage = clampInt(page, 0, 9);
}

function setSlotDigits(x, y, z) {
  el.d0.textContent = String(x);
  el.d1.textContent = String(y);
  el.d2.textContent = String(z);
  el.lastCode.textContent = `${x}${y}${z}`;
}

// ===== Helpers =====

function createInitialState() {
  const stamps = Array.from({ length: 10 }, () =>
    Array.from({ length: 10 }, () =>
      Array.from({ length: 10 }, () => false)
    )
  );

  return {
    lastPlayDateKey: getTodayKey(),
    freeSpinsLeft: FREE_SPINS_PER_DAY,
    bookmarkTickets: 0,
    dupeStreak: 0,
    currentPage: 0,
    stamps,
    pageRewarded: Array.from({ length: 10 }, () => false),
    stats: { totalSpins: 0, totalNew: 0, totalDupe: 0 },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw);

    // 最低限のバリデーション（壊れていたら初期化）
    if (!parsed || typeof parsed !== "object") return createInitialState();
    if (!parsed.stamps) return createInitialState();

    return {
      ...createInitialState(),
      ...parsed,
    };
  } catch (e) {
    console.warn("Failed to load state. Resetting.", e);
    return createInitialState();
  }
}

function saveState(s) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch (e) {
    console.warn("Failed to save state.", e);
    toast("保存に失敗しました（容量制限の可能性）");
  }
}

function applyDailyResetIfNeeded(s) {
  const today = getTodayKey();
  if (s.lastPlayDateKey !== today) {
    s.lastPlayDateKey = today;
    s.freeSpinsLeft = FREE_SPINS_PER_DAY;
    // dupeStreakは現時点では維持（SPECで後で決める余地）
  }
}

function getTodayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isPageComplete(s, page) {
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      if (!s.stamps[page][row][col]) return false;
    }
  }
  return true;
}

function countPageFilled(s, page) {
  let n = 0;
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      if (s.stamps[page][row][col]) n++;
    }
  }
  return n;
}

function countTotalFilled(s) {
  let n = 0;
  for (let p = 0; p < 10; p++) n += countPageFilled(s, p);
  return n;
}

function countRemainingUnstamped(s) {
  return 1000 - countTotalFilled(s);
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

function formatCode({ x, y, z }) {
  return `${x}${y}${z}`;
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
  }, 1600);
}
