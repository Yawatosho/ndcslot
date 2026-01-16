// src/modules/view.js
// 画面描画（タブ／グリッド／進捗／スロット表示／トースト）＋ スロット演出 ＋ ページ切替 ＋ 新規スタンプPop

export function createView() {
  const el = {
    bookmarkTickets: document.getElementById("bookmarkTickets"),
    dupeStreak: document.getElementById("dupeStreak"),
    totalSpins: document.getElementById("totalSpins"),

    d0: document.getElementById("d0"),
    d1: document.getElementById("d1"),
    d2: document.getElementById("d2"),
    lastCode: document.getElementById("lastCode"),
    lastSubject: document.getElementById("lastSubject"),

    spinBtn: document.getElementById("spinBtn"),
    resetBtn: document.getElementById("resetBtn"),

    tabs: document.getElementById("tabs"),
    grid: document.getElementById("grid"),
    albumHeading: document.getElementById("albumHeading"),
    pageProgress: document.getElementById("pageProgress"),
    totalProgress: document.getElementById("totalProgress"),

    toast: document.getElementById("toast"),
    openSpecLink: document.getElementById("openSpecLink"),
  };

  const PAGE_TRANSITION_MS = 220;
  const STAMP_POP_AFTER_PAGE_MS = 220;

  let toastTimer = null;
  let lastRenderedPage = null;
  let pageAnim = null;

  // 「ポン開始まで数字表示」用
  let popTimers = [];

  // ★SFX（外から注入）
  let sfx = null;
  function setSfx(v) { sfx = v; }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

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
  }

  function updateButtons({ canSpin, forceDisabled = false }) {
    if (forceDisabled) {
      el.spinBtn.disabled = true;
      return;
    }
    el.spinBtn.disabled = !canSpin;
  }

  function setSubjectText(text) {
    if (el.lastSubject) el.lastSubject.textContent = text;
  }

  function setSlotDigits(x, y, z) {
    el.d0.textContent = String(x);
    el.d1.textContent = String(y);
    el.d2.textContent = String(z);
    const code = `${x}${y}${z}`;
    el.lastCode.textContent = code;
  }

  function setResultText({ ndc, code }) {
    const subj = ndc?.getSubject(code);
    if (el.lastSubject) el.lastSubject.textContent = subj ? subj : "（分類なし）";
  }

  function pulseDigit(node) {
    if (!node) return;
    if (prefersReducedMotion()) return;
    try {
      node.animate(
        [
          { transform: "scale(1)" },
          { transform: "scale(1.18)" },
          { transform: "scale(1)" },
        ],
        { duration: 170, easing: "cubic-bezier(0.2, 0.9, 0.2, 1)", fill: "both" }
      );
    } catch {}
  }

  // ★左→中→右で段階停止（停止音：reelStop0/1/2）
  async function playSpinAnimation({
    ndc,
    finalResult,
    durationMs = 420,
    tickMs = 55,
    stopGapMs = 500,
    postResultPauseMs = 650,
  }) {
    setSubjectText("回転中…");

    if (prefersReducedMotion()) {
      setSlotDigits(finalResult.x, finalResult.y, finalResult.z);
      if (postResultPauseMs > 0) await sleep(postResultPauseMs);
      return;
    }

    const stopAt0 = durationMs;
    const stopAt1 = durationMs + stopGapMs;
    const stopAt2 = durationMs + stopGapMs * 2;
    const endAt = stopAt2 + Math.max(60, tickMs);

    let stopped0 = false;
    let stopped1 = false;
    let stopped2 = false;

    const start = performance.now();

    while (true) {
      const elapsed = performance.now() - start;

      if (!stopped0 && elapsed >= stopAt0) {
        stopped0 = true;
        pulseDigit(el.d0);
        sfx?.play?.("reelStop0");
      }
      if (!stopped1 && elapsed >= stopAt1) {
        stopped1 = true;
        pulseDigit(el.d1);
        sfx?.play?.("reelStop1");
      }
      if (!stopped2 && elapsed >= stopAt2) {
        stopped2 = true;
        pulseDigit(el.d2);
        sfx?.play?.("reelStop2");
      }

      if (elapsed >= endAt) break;

      const t = (ndc?.validAll?.length)
        ? ndc.validAll[randInt(0, ndc.validAll.length - 1)]
        : { x: randInt(0, 9), y: randInt(0, 9), z: randInt(0, 9) };

      const x = (elapsed >= stopAt0) ? finalResult.x : t.x;
      const y = (elapsed >= stopAt1) ? finalResult.y : t.y;
      const z = (elapsed >= stopAt2) ? finalResult.z : t.z;

      setSlotDigits(x, y, z);
      await sleep(tickMs);
    }

    setSlotDigits(finalResult.x, finalResult.y, finalResult.z);

    if (postResultPauseMs > 0) await sleep(postResultPauseMs);
  }

  function initTabs({ onSelectPage }) {
    el.tabs.innerHTML = "";
    for (let p = 0; p < 10; p++) {
      const btn = document.createElement("div");
      btn.className = "tab";
      btn.textContent = `${p}xx`;
      btn.dataset.page = String(p);
      btn.dataset.active = "false";
      btn.addEventListener("click", () => onSelectPage(p));
      el.tabs.appendChild(btn);
    }
  }

  function updateTabsActive(currentPage) {
    [...el.tabs.children].forEach((node) => {
      const p = Number(node.dataset.page);
      node.dataset.active = String(p === currentPage);
    });
  }

  function render({ state, ndc, highlight }) {
    if (el.bookmarkTickets) el.bookmarkTickets.textContent = String(state.bookmarkTickets);
    if (el.dupeStreak) el.dupeStreak.textContent = String(state.dupeStreak);
    if (el.totalSpins) el.totalSpins.textContent = String(state.stats?.totalSpins ?? 0);

    el.albumHeading.textContent = `ページ ${state.currentPage}xx`;

    el.pageProgress.textContent = String(countPageDisplayFilled({ state, ndc, page: state.currentPage }));
    el.totalProgress.textContent = String(countTotalDisplayFilled({ state, ndc }));

    updateTabsActive(state.currentPage);

    const pageChanged = (lastRenderedPage !== null && lastRenderedPage !== state.currentPage);

    let dir = 1;
    if (pageChanged) {
      const from = lastRenderedPage;
      const to = state.currentPage;
      const forwardSteps = (to - from + 10) % 10;
      const backwardSteps = (from - to + 10) % 10;
      const forward = forwardSteps <= backwardSteps;
      dir = forward ? 1 : -1;
    }

    const popDelayMs =
      (pageChanged && !prefersReducedMotion())
        ? (PAGE_TRANSITION_MS + STAMP_POP_AFTER_PAGE_MS)
        : 0;

    renderGrid({ state, ndc, highlight, popDelayMs });

    if (pageChanged && !prefersReducedMotion()) {
      animateGridIn(dir);
      animateHeadingIn();
    }

    lastRenderedPage = state.currentPage;
  }

  function animateGridIn(dir) {
    try {
      if (pageAnim) pageAnim.cancel();
      const dx = 14 * dir;
      pageAnim = el.grid.animate(
        [
          { opacity: 0.0, transform: `translateX(${dx}px) scale(0.995)` },
          { opacity: 1.0, transform: "translateX(0px) scale(1)" },
        ],
        { duration: PAGE_TRANSITION_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "both" }
      );
    } catch {}
  }

  function animateHeadingIn() {
    try {
      el.albumHeading.animate(
        [
          { opacity: 0.4, transform: "translateY(2px)" },
          { opacity: 1.0, transform: "translateY(0px)" },
        ],
        { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "both" }
      );
    } catch {}
  }

  function renderGrid({ state, ndc, highlight, popDelayMs = 0 }) {
    const page = state.currentPage;
    el.grid.innerHTML = "";

    for (const id of popTimers) clearTimeout(id);
    popTimers = [];

    el.grid.appendChild(makeHeaderCell(""));
    for (let col = 0; col < 10; col++) el.grid.appendChild(makeHeaderCell(String(col)));

    for (let row = 0; row < 10; row++) {
      el.grid.appendChild(makeHeaderCell(String(row), { vertical: true }));

      for (let col = 0; col < 10; col++) {
        const valid = ndc.isValidCell(page, row, col);
        const filled = valid ? (state.stamps[page][row][col] === true) : true;

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
          const doPop = isHL && Boolean(highlight?.pop) && !prefersReducedMotion();

          // ★ポン演出（スタンプ音は「●が出た瞬間」に鳴らす）
          if (doPop && popDelayMs > 0) {
            cell.innerHTML = `<span class="mini">${code}</span>`;
            cell.title = `${code}${subj ? ` / ${subj}` : ""}`;

            const tid = setTimeout(() => {
              cell.innerHTML = `<span class="stamp pop">●</span>`;
              sfx?.play?.("stamp");
            }, popDelayMs);

            popTimers.push(tid);
          } else {
            cell.innerHTML = `<span class="stamp${doPop ? " pop" : ""}">●</span>`;
            cell.title = `${code}${subj ? ` / ${subj}` : ""}`;
            if (doPop) sfx?.play?.("stamp");
          }

        } else {
          cell.innerHTML = `<span class="mini">${code}</span>`;
          cell.title = `${code}${subj ? ` / ${subj}` : ""}`;
        }

        el.grid.appendChild(cell);
      }
    }
  }

  function countPageDisplayFilled({ state, ndc, page }) {
    const validCount = ndc.validByPage[page].length;
    const invalidCount = 100 - validCount;
    let filledValid = 0;
    for (const t of ndc.validByPage[page]) if (state.stamps[t.x][t.y][t.z]) filledValid++;
    return invalidCount + filledValid;
  }

  function countTotalDisplayFilled({ state, ndc }) {
    const validCountTotal = ndc.validAll.length;
    const invalidCountTotal = 1000 - validCountTotal;
    let filledValid = 0;
    for (const t of ndc.validAll) if (state.stamps[t.x][t.y][t.z]) filledValid++;
    return invalidCountTotal + filledValid;
  }

  function makeHeaderCell(text, opts = {}) {
    const div = document.createElement("div");
    div.className = opts.vertical ? "vcell" : "hcell";
    div.textContent = text;
    return div;
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  return {
    el,
    toast,
    setButtonsEnabled,
    updateButtons,
    setSubjectText,
    setSlotDigits,
    setResultText,
    playSpinAnimation,
    initTabs,
    render,
    setSfx, // ★追加
  };
}
