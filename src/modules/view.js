// src/modules/view.js
// 画面描画（タブ／グリッド／進捗／スロット表示／トースト）＋ スロット簡易演出 ＋ ページめくり

export function createView() {
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

    gridStage: document.getElementById("gridStage"), // index.htmlで追加したラッパー
  };

  let toastTimer = null;

  // ページめくり用
  let lastRenderedPage = null;
  let activeOverlay = null;
  let activeAnims = [];

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

  function updateButtons({ canSpinAuto, canSpinTicket, forceDisabled = false }) {
    if (forceDisabled) {
      el.spinBtn.disabled = true;
      el.useTicketSpinBtn.disabled = true;
      return;
    }
    el.spinBtn.disabled = !canSpinAuto;
    el.useTicketSpinBtn.disabled = !canSpinTicket;
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

  /**
   * スロット簡易演出：有効コードのみを高速で表示 → 最後に finalResult へ
   */
  async function playSpinAnimation({ ndc, finalResult, durationMs = 420, tickMs = 55 }) {
    setSubjectText("回転中…");

    const start = performance.now();
    while (performance.now() - start < durationMs) {
      const t = ndc.validAll[randInt(0, ndc.validAll.length - 1)];
      setSlotDigits(t.x, t.y, t.z);
      await sleep(tickMs);
    }

    setSlotDigits(finalResult.x, finalResult.y, finalResult.z);
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
    // stats
    el.freeSpinsLeft.textContent = String(state.freeSpinsLeft);
    el.bookmarkTickets.textContent = String(state.bookmarkTickets);
    el.dupeStreak.textContent = String(state.dupeStreak);

    // album header
    el.albumHeading.textContent = `ページ ${state.currentPage}xx`;

    // progress（対象外は埋まり扱い）
    el.pageProgress.textContent = String(countPageDisplayFilled({ state, ndc, page: state.currentPage }));
    el.totalProgress.textContent = String(countTotalDisplayFilled({ state, ndc }));

    updateTabsActive(state.currentPage);

    // ---- ページめくり判定 ----
    const pageChanged = (lastRenderedPage !== null && lastRenderedPage !== state.currentPage);
    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // もしアニメ途中で次の描画が来たら、前の残骸を片付ける
    cleanupOverlay();

    // 旧ページをオーバーレイとして確保（“描き換える前”にクローン）
    let overlay = null;
    if (pageChanged && !reduceMotion) {
      overlay = cloneCurrentGridAsOverlay();
    }

    // 新ページを描画
    renderGrid({ state, ndc, highlight });

    // めくり演出
    if (overlay && !reduceMotion) {
      animatePageTurn({
        from: lastRenderedPage,
        to: state.currentPage,
        overlay,
        incoming: el.grid,
      });
    }

    lastRenderedPage = state.currentPage;
  }

  function renderGrid({ state, ndc, highlight }) {
    const page = state.currentPage;
    el.grid.innerHTML = "";

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

  // ===== Page flip helpers =====
  function cloneCurrentGridAsOverlay() {
    const stage = el.gridStage || el.grid.parentElement;
    if (!stage) return null;

    const clone = el.grid.cloneNode(true);
    clone.classList.add("grid-overlay");
    clone.removeAttribute("id");

    stage.appendChild(clone);
    activeOverlay = clone;
    return clone;
  }

  function animatePageTurn({ from, to, overlay, incoming }) {
    // “最短方向”っぽくめくる（0..9の循環を想定）
    const forwardSteps = (to - from + 10) % 10;   // 0..9
    const backwardSteps = (from - to + 10) % 10;  // 0..9
    const forward = forwardSteps <= backwardSteps; // forwardが短いなら前へ

    const duration = 520;
    const easing = "cubic-bezier(0.2, 0.8, 0.2, 1)";

    // 前へ：旧ページが左へ倒れ、新ページが右から入る
    // 戻る：旧ページが右へ倒れ、新ページが左から入る
    const outAngle = forward ? -88 : 88;
    const inAngle = forward ? 88 : -88;

    overlay.style.transformOrigin = forward ? "left center" : "right center";
    incoming.style.transformOrigin = forward ? "right center" : "left center";

    // 既存のアニメが走っていたら終了
    activeAnims.forEach((a) => { try { a.cancel(); } catch {} });
    activeAnims = [];

    const outAnim = overlay.animate(
      [
        { transform: "rotateY(0deg)", opacity: 1, filter: "brightness(1)" },
        { transform: `rotateY(${outAngle}deg)`, opacity: 0.05, filter: "brightness(0.86)" },
      ],
      { duration, easing, fill: "forwards" }
    );

    const inAnim = incoming.animate(
      [
        { transform: `rotateY(${inAngle}deg)`, opacity: 0.05, filter: "brightness(0.86)" },
        { transform: "rotateY(0deg)", opacity: 1, filter: "brightness(1)" },
      ],
      { duration, easing, fill: "forwards" }
    );

    activeAnims.push(outAnim, inAnim);

    Promise.allSettled([outAnim.finished, inAnim.finished]).finally(() => {
      cleanupOverlay();
      // 念のためtransformをクリア
      try { incoming.style.transform = ""; } catch {}
      try { incoming.style.filter = ""; } catch {}
    });
  }

  function cleanupOverlay() {
    // 走っているアニメを止める
    activeAnims.forEach((a) => { try { a.cancel(); } catch {} });
    activeAnims = [];

    if (activeOverlay && activeOverlay.parentElement) {
      activeOverlay.parentElement.removeChild(activeOverlay);
    }
    activeOverlay = null;
  }

  // ===== Progress =====
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

  // ===== Utils =====
  function makeHeaderCell(text, opts = {}) {
    const div = document.createElement("div");
    div.className = opts.vertical ? "vcell" : "hcell";
    div.textContent = text;
    return div;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

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
  };
}
