import { initNdc } from "./modules/ndc.js?v=20260116e";
import { loadState, saveState, createInitialState } from "./modules/state.js?v=20260116e";
import { createView } from "./modules/view.js?v=20260116e";

import {
  canSpin,
  consumeSpin,
  shouldTriggerPity,
  rollRandomValid,
  rollNewGuaranteed,
  applyStampAndRewards,
  updateDupeStreak,
  previewBonusKeys,
} from "./modules/gameCore.js?v=20260116e";

const SAVE_KEY = "ndc_slot_save_v2";

const START_TICKETS = 30;
const TICKETS_PER_SPIN = 1;

const PITY_TABLE = [0.00, 0.10, 0.20, 0.35, 0.55, 0.75, 0.90, 1.00];

const NDC_JSON_URL = new URL("../ndc.json", import.meta.url);
const SPIN_START_SOUND_URL = new URL("../spinStart.mp3", import.meta.url);
let ndc = null;
let state = null;

const view = createView();

let isSpinning = false;
const spinStartAudio = new Audio(SPIN_START_SOUND_URL);
spinStartAudio.preload = "auto";
spinStartAudio.volume = 0.9;

boot().catch((e) => {
  console.error(e);
  view.toast("起動に失敗しました（コンソールをご確認ください）");
  view.setSubjectText("NDCデータ読み込み失敗");
  view.setButtonsEnabled(false);
});

async function boot() {
  view.setButtonsEnabled(false);
  view.setSubjectText("NDCデータ読み込み中…");

  ndc = await initNdc({ jsonUrl: NDC_JSON_URL });

  state = loadState({ saveKey: SAVE_KEY, startTickets: START_TICKETS });
  syncHistory();
  saveState({ saveKey: SAVE_KEY }, state);

  view.initTabs({
    onSelectPage: (p) => {
      state.currentPage = p;
      saveState({ saveKey: SAVE_KEY }, state);
      rerender();
    },
  });

  view.setSlotDigits(0, 0, 0);
  view.setResultText({ ndc, code: "000" });

  view.el.spinBtn.addEventListener("click", () => onSpin());
  view.el.resetBtn.addEventListener("click", () => {
    if (!confirm("保存データを初期化します。よろしいですか？")) return;
    state = createInitialState({ startTickets: START_TICKETS });
    syncHistory({ force: true });
    saveState({ saveKey: SAVE_KEY }, state);
    rerender();
    view.toast("初期化しました");
  });

  view.el.openSpecLink.addEventListener("click", (ev) => {
    ev.preventDefault();
    view.toast("SPEC.md / RULES.md / BACKLOG.md をプロジェクトに固定して進めましょう");
  });

  view.setButtonsEnabled(true);
  rerender();
  view.toast(`NDCデータ読み込み完了（有効: ${ndc.validAll.length} / 1000）`);
}

async function onSpin() {
  if (isSpinning) return;

  const ok = canSpin({ state, ticketsPerSpin: TICKETS_PER_SPIN });
  if (!ok) {
    view.toast("回せません（しおり券が不足）");
    return;
  }

  playSpinStartSound();

  // ★開始：unlockは同期（念のため毎回呼んでも軽い）
  consumeSpin({ state, ticketsPerSpin: TICKETS_PER_SPIN });

  const pity = shouldTriggerPity({ state, ndc, pityTable: PITY_TABLE });
  const result = pity ? rollNewGuaranteed({ state, ndc }) : rollRandomValid(ndc);

  // ★内部確定
  const bonusKeys = previewBonusKeys({ state, ndc, result });
  isSpinning = true;
  rerender();

  await view.playSpinAnimation({
    ndc,
    finalResult: result,
    durationMs: 420,
    tickMs: 55,
    stopGapMs: 500,
    postResultPauseMs: 650,
  });

  view.setResultText({ ndc, code: result.code });

  state.currentPage = result.x;
  state.lastResultCode = result.code;

  const outcome = applyStampAndRewards({ state, ndc, result });

  state.lastOutcome = {
    isNew: outcome.isNew,
    ticketDelta: outcome.ticketDelta,
    breakdown: outcome.breakdown,
  };

  updateDupeStreak({ state, isNew: outcome.isNew });

  state.stats.totalSpins += 1;
  if (outcome.isNew) state.stats.totalNew += 1;
  else state.stats.totalDupe += 1;

  syncHistory();
  saveState({ saveKey: SAVE_KEY }, state);

  isSpinning = false;

  rerender({ highlight: { page: result.x, row: result.y, col: result.z, pop: outcome.isNew } });

  const subj = ndc.getSubject(result.code) ?? "";
  view.toast(`${pity ? "救済" : "結果"}: ${result.code}${subj ? ` / ${subj}` : ""}`);

}

function playSpinStartSound() {
  try {
    spinStartAudio.currentTime = 0;
    const playPromise = spinStartAudio.play();
    if (playPromise?.catch) {
      playPromise.catch(() => {});
    }
  } catch {}
}

function rerender(opts = {}) {
  view.updateButtons({
    canSpin: canSpin({ state, ticketsPerSpin: TICKETS_PER_SPIN }),
    forceDisabled: isSpinning,
  });
  view.render({ state, ndc, highlight: opts.highlight });
}

function syncHistory({ force = false } = {}) {
  if (!state || !ndc) return;
  if (!Array.isArray(state.history)) state.history = [];

  const stamps = countCollectedStamps({ state, ndc });
  const point = {
    spins: Number(state.stats?.totalSpins ?? 0),
    tickets: Number(state.bookmarkTickets ?? 0),
    stamps,
  };

  const last = state.history[state.history.length - 1];
  const sameSpins = last && Number(last.spins) === point.spins;
  if (sameSpins && !force) {
    state.history[state.history.length - 1] = point;
    return;
  }

  state.history.push(point);
}

function countCollectedStamps({ state, ndc }) {
  if (!state || !ndc) return 0;
  let count = 0;
  for (const t of ndc.validAll) {
    if (state.stamps?.[t.x]?.[t.y]?.[t.z]) count += 1;
  }
  return count;
}
