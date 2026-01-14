/* src/main.js
   MVP（ndc.json参照版）
   - ndc.json を fetch して「有効な3桁コード」だけをスロット抽選に使う
   - スロット確定後、対応する subject を表示
   - 分類がない（対象外）マスはスタンプ帳で灰色表示＆最初から埋まり扱い
   - 日次無料10回、しおり券10枚で追加1回
   - 新規+2 / ダブり+1 / ページコンプ+50（1回のみ）
   - ピティ：後半加速、7連続で確定新規（未取得が残っている場合）
*/

const SAVE_KEY = "ndc_slot_save_v1";
const FREE_SPINS_PER_DAY = 10;
const TICKETS_PER_EXTRA_SPIN = 10;

const NDC_JSON_PATH = "./ndc.json";

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

// ===== NDC data =====
/** @type {Map<string,string>} code(3桁文字列) -> subject */
let ndcIndex = new Map();

/** @type {{x:number,y:number,z:number,code:string}[]} 有効コードのみ */
let validTriplesAll = [];

/** @type {{x:number,y:number,z:number,code:string}[][]} page別 */
let validTriplesByPage = Array.from({ length: 10 }, () => []);

// ===== State =====
/**
 * @typedef {Object} GameState
 * @property {string} lastPlayDateKey
 * @property {number} freeSpinsLeft
 * @property {number} bookmarkTickets
 * @property {number} dupeStreak
 * @property {number} currentPage
 * @property {boolean[][][]} stamps  // [10][10][10]（有効コードのみtrueになっていく。対象外は常にfalseでもOK）
 * @property {boolean[]} pageRewarded // [10] ページコンプ報酬(+50)付与済み
 * @property {Object} stats
 * @property {number} stats.totalSpins
 * @property {number} stats.totalNew
 * @property {number} stats.totalDupe
 */
let state = null;

// ===== Boot =====
boot().catch((e) => {
  console.error(e);
  toast("起動に失敗しました（コンソールをご確認ください）");
  if (el.lastSubject) el.lastSubject.textContent = "NDCデータ読み込み失敗";
  setButtonsEnabled(false);
});

async function boot() {
  setButtonsEnabled(false);
  if (el.lastSubject) el.lastSubject.textContent = "NDCデータ読み込み中…";

  await loadNdcIndex();
  buildValidCaches();

  state = loadState();
  applyDailyResetIfNeeded(state);
  saveState(state);

  initTabs();
  renderAll();

  // events（state準備後に付ける）
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
    toast("SPEC.md / RULES.md / BACKLOG.md をプロジェクトに固定して進めましょう");
  });

  // 初期表示の分類
  setSlotDigits(0, 0, 0);
  setResultText("000");

  setButtonsEnabled(true);
  renderAll();
  toast(`NDCデータ読み込み完了（有効: ${validTriplesAll.length} / 1000）`);
}

// ===== NDC Load =====
async function loadNdcIndex() {
  const res = await fetch(NDC_JSON_PATH, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ndc.json: ${res.status}`);
  /** @type {{ndc:string, subject:string}[]} */
  const list = await res.json();

  ndcIndex = new Map(
    list.map((x) => [String(x.ndc).padStart(3, "0"), String(x.subject ?? "")])
  );
}

function buildValidCaches() {
  validTriplesAll = [];
  validTriplesByPage = Array.from({ length: 10 }, () => []);

  for (const code of ndcIndex.keys()) {
    const x = Number(code[0]);
    const y = Number(code[1]);
    const z = Number(code[2]);
    const t = { x, y, z, code };
    validTriplesAll.push(t);
    validTriplesByPage[x].push(t);
  }
}

function getSubject(code3) {
  return ndcIndex.get(code3) ?? null;
}

function isValidCode(code3) {
  return ndcIndex.has(code3);
}

function tripleToCode(x, y, z) {
  return `${x}${y}${z}`;
}

function isValidCell(x, y, z) {
  return isValidCode(tripleToCode(x, y, z));
}

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

  // 通常も救済も「有効コードのみ」から出す
  const result = pityTriggered ? rollNewGuaranteed(state) : rollRandomValid();

  // 表示（MVPは即確定）
  setSlotDigits(result.x, result.y, result.z);

  const code = result.code ?? tripleToCode(result.x, result.y, result.z);
  setResultText(code);

  // 自動ページ移動（MVPは瞬間移動。後で“めくり”に差し替え）
  setCurrentPage(result.x);

  // スタンプ反映（有効コードのみが来る前提）
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
    highlight: { page: result.x, row: result.y, col: result.z }
  });

  // トースト
  const head = pityTriggered ? "救済" : "結果";
  const subj = getSubject(code) ?? "";
  toast(`${head}: ${code}${subj ? ` / ${subj}` : ""}`);

  // ページコンプ報酬の追加トースト
  if (stampOutcome.pageCompletedNow) {
    toast(`ページ ${result.x}xx コンプリート！ しおり券+50`);
  }
}

function canSpin(mode) {
  if (!state) return false;
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
  const remaining = countRemainingValidUnstamped(s);
  if (remaining <= 0) return false;

  const ds = clampInt(s.dupeStreak, 0, 7);
  const p = PITY_TABLE[ds] ?? 0;
  if (p >= 1) return true;
  return Math.random() < p;
}

/** 通常抽選：有効コードのみから完全ランダム */
function rollRandomValid() {
  const t = validTriplesAll[randInt(0, validTriplesAll.length - 1)];
  // 返り値は stampLogic 都合で {x,y,z,code} を持つ
  return { x: t.x, y: t.y, z: t.z, code: t.code };
}

/** 新規確定抽選（優先：同ページ→同綱(行)→全体） */
function rollNewGuaranteed(s) {
  const base = rollRandomValid(); // “自然に見える”ための基準（必ず有効）
  const { x, y } = base;

  // 1) 同ページの未取得（有効のみ）
  const candidatesPage = [];
  for (const t of validTriplesByPage[x]) {
    if (!s.stamps[t.x][t.y][t.z]) candidatesPage.push({ x: t.x, y: t.y, z: t.z, code: t.code });
  }
  if (candidatesPage.length > 0) return pickPreferClose(candidatesPage, base);

  // 2) 同綱（同ページ内の行y）の未取得（有効のみ）
  const candidatesRow = [];
  for (const t of validTriplesByPage[x]) {
    if (t.y === y && !s.stamps[t.x][t.y][t.z]) candidatesRow.push({ x: t.x, y: t.y, z: t.z, code: t.code });
  }
  if (candidatesRow.length > 0) return pickPreferClose(candidatesRow, base);

  // 3) 全体未取得（有効のみ）
  const candidatesAll = [];
  for (const t of validTriplesAll) {
    if (!s.stamps[t.x][t.y][t.z]) candidatesAll.push({ x: t.x, y: t.y, z: t.z, code: t.code });
  }
  return pickPreferClose(candidatesAll, base);
}

/** 未取得候補の中から、基準値に近いものを優先（“操作感”を薄める） */
function pickPreferClose(candidates, base) {
  if (candidates.length === 1) return candidates[0];

  const scored = candidates.map((c) => ({
    c,
    score: Math.abs(c.x - base.x) * 3 + Math.abs(c.y - base.y) * 2 + Math.abs(c.z - base.z),
  }));
  scored.sort((a, b) => a.score - b.score);

  const topN = Math.min(12, scored.length); // 近いものから少数抽出→ランダム
  return scored[randInt(0, topN - 1)].c;
}

/**
 * スタンプ反映と報酬
 * @param {GameState} s
 * @param {{x:number,y:number,z:number,code?:string}} result
 * @returns {{isNew:boolean, ticketDelta:number, pageCompletedNow:boolean}}
 */
function applyStampAndRewards(s, result) {
  const { x, y, z } = result;
  const code = result.code ?? tripleToCode(x, y, z);

  // 念のためガード（通常は起きない）
  if (!isValidCode(code)) {
    // 対象外が来た場合はダブり扱い（ただし今回の仕様ではスロットで出ない）
    s.bookmarkTickets += 1;
    return { isNew: false, ticketDelta: 1, pageCompletedNow: false };
  }

  const wasFilled = s.stamps[x][y][z];
  let ticketDelta = 0;

  if (!wasFilled) {
    s.stamps[x][y][z] = true;
    ticketDelta += 2; // 新規
  } else {
    ticketDelta += 1; // ダブり
  }
  s.bookmarkTickets += ticketDelta;

  // ページコンプ（有効コードが全部埋まったら）で+50（未付与のときだけ）
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
  if (!state) return;

  // stats
  el.freeSpinsLeft.textContent = String(state.freeSpinsLeft);
  el.bookmarkTickets.textContent = String(state.bookmarkTickets);
  el.dupeStreak.textContent = String(state.dupeStreak);

  // buttons enable/disable
  el.spinBtn.disabled = !canSpin("auto");
  el.useTicketSpinBtn.disabled = !(state.bookmarkTickets >= TICKETS_PER_EXTRA_SPIN);

  // heading
  el.albumHeading.textContent = `ページ ${state.currentPage}xx`;

  // progress（対象外は埋まり扱い）
  const pageFilledDisplay = countPageDisplayFilled(state, state.currentPage);
  el.pageProgress.textContent = String(pageFilledDisplay);

  const totalFilledDisplay = countTotalDisplayFilled(state);
  el.totalProgress.textContent = String(totalFilledDisplay);

  // tabs
  updateTabsActive();

  // grid
  renderGrid(opts.highlight);
}

/** @param {{page:number,row:number,col:number}|undefined} highlight */
function renderGrid(highlight) {
  const page = state.currentPage;

  el.grid.innerHTML = "";

  // 1行目ヘッダ（左上空白 + 列0..9）
  el.grid.appendChild(makeHeaderCell(""));
  for (let col = 0; col < 10; col++) el.grid.appendChild(makeHeaderCell(String(col)));

  for (let row = 0; row < 10; row++) {
    el.grid.appendChild(makeHeaderCell(String(row), { vertical: true }));

    for (let col = 0; col < 10; col++) {
      const valid = isValidCell(page, row, col);
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
      const subj = valid ? (getSubject(code) ?? "") : "";

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
  const code = `${x}${y}${z}`;
  el.lastCode.textContent = code;
}

function setResultText(code) {
  const subj = getSubject(code);
  if (el.lastSubject) el.lastSubject.textContent = subj ? subj : "（分類なし）";
}

// ===== State helpers =====
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

    if (!parsed || typeof parsed !== "object") return createInitialState();
    if (!isStampsShapeOk(parsed.stamps)) return createInitialState();

    const base = createInitialState();
    const merged = { ...base, ...parsed };

    // pageRewarded shape
    if (!Array.isArray(merged.pageRewarded) || merged.pageRewarded.length !== 10) {
      merged.pageRewarded = Array.from({ length: 10 }, () => false);
    }
    // stats
    if (!merged.stats || typeof merged.stats !== "object") {
      merged.stats = { totalSpins: 0, totalNew: 0, totalDupe: 0 };
    } else {
      merged.stats.totalSpins = Number(merged.stats.totalSpins ?? 0);
      merged.stats.totalNew = Number(merged.stats.totalNew ?? 0);
      merged.stats.totalDupe = Number(merged.stats.totalDupe ?? 0);
    }

    merged.freeSpinsLeft = clampInt(merged.freeSpinsLeft, 0, FREE_SPINS_PER_DAY);
    merged.bookmarkTickets = Math.max(0, Number(merged.bookmarkTickets ?? 0));
    merged.dupeStreak = clampInt(merged.dupeStreak, 0, 7);
    merged.currentPage = clampInt(merged.currentPage, 0, 9);
    merged.lastPlayDateKey = String(merged.lastPlayDateKey ?? getTodayKey());

    return merged;
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
    // dupeStreakは維持（後で調整可）
  }
}

function getTodayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ===== Progress / Completion =====
function isPageComplete(s, page) {
  const list = validTriplesByPage[page];
  for (const t of list) {
    if (!s.stamps[t.x][t.y][t.z]) return false;
  }
  return true;
}

// 表示用：対象外も「埋まり扱い」
function countPageDisplayFilled(s, page) {
  const validCount = validTriplesByPage[page].length;
  const invalidCount = 100 - validCount;

  let filledValid = 0;
  for (const t of validTriplesByPage[page]) {
    if (s.stamps[t.x][t.y][t.z]) filledValid++;
  }
  return invalidCount + filledValid;
}

function countTotalDisplayFilled(s) {
  const validCountTotal = validTriplesAll.length;
  const invalidCountTotal = 1000 - validCountTotal;

  let filledValid = 0;
  for (const t of validTriplesAll) {
    if (s.stamps[t.x][t.y][t.z]) filledValid++;
  }
  return invalidCountTotal + filledValid;
}

function countRemainingValidUnstamped(s) {
  const validCountTotal = validTriplesAll.length;
  let filledValid = 0;
  for (const t of validTriplesAll) {
    if (s.stamps[t.x][t.y][t.z]) filledValid++;
  }
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
