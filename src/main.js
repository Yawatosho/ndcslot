import { initNdc } from "./modules/ndc.js?v=20260116d";
import { loadState, saveState, createInitialState } from "./modules/state.js?v=20260116d";
import { createView } from "./modules/view.js?v=20260116d";
import { createSfx } from "./modules/sfx.js?v=20260116d";

import {
  canSpin,
  consumeSpin,
  shouldTriggerPity,
  rollRandomValid,
  rollNewGuaranteed,
  applyStampAndRewards,
  updateDupeStreak,
  previewBonusKeys, // ★追加（内部確定）
} from "./modules/gameCore.js?v=20260116d";

const SAVE_KEY = "ndc_slot_save_v2";

const START_TICKETS = 30;
const TICKETS_PER_SPIN = 1;

// 後半加速ピティ
const PITY_TABLE = [0.00, 0.10, 0.20, 0.35, 0.55, 0.75, 0.90, 1.00];

const NDC_JSON_URL = new URL("../ndc.json", import.meta.url);
const SFX_JSON_URL = new URL("../sfx.json", import.meta.url);

let ndc = null;
let state = null;

const view = createView();
let sfx = null;

let isSpinning = false;

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

  // ★SFX
  sfx = await createSfx({ manifestUrl: SFX_JSON_URL, defaultEnabled: true, defaultVolume: 0.75 });
  view.setSfx(sfx);

  // ユーザー操作でunlock（autoplay対策）
  const unlockOnce = () => sfx.unlock();
  window.addEventListener("pointerdown", unlockOnce, { once: true });
  window.addEventListener("touchstart", unlockOnce, { once: true });
  window.addEventListener("mousedown", unlockOnce, { once: true });
  window.addEventListener("keydown", unlockOnce, { once: true });

  state = loadState({ saveKey: SAVE_KEY, startTickets: START_TICKETS });
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

  // ★開始ボタン時
  await sfx?.unlock?.();
  sfx?.play?.("spinStart");

  consumeSpin({ state, ticketsPerSpin: TICKETS_PER_SPIN });

  const pity = shouldTriggerPity({ state, ndc, pityTable: PITY_TABLE });
  const result = pity
    ? rollNewGuaranteed({ state, ndc })
    : rollRandomValid(ndc);

  // ★内部抽選で各ボーナスが確定した時（確定音を鳴らす）
  const bonusKeys = previewBonusKeys({ state, ndc, result });
  if (bonusKeys.length) {
    sfx?.play?.("bonus_confirm", { volumeMul: 0.8 });
  }

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

  const outcome = applyStampAndRewards({
    state,
    ndc,
    result,
    // ※あなたの報酬設定をここに（省略可：gameCore側デフォルトでもOK）
  });

  state.lastOutcome = {
    isNew: outcome.isNew,
    ticketDelta: outcome.ticketDelta,
    breakdown: outcome.breakdown,
  };

  // ★ダブり時
  if (!outcome.isNew) sfx?.play?.("dupe");

  updateDupeStreak({ state, isNew: outcome.isNew });

  state.stats.totalSpins += 1;
  if (outcome.isNew) state.stats.totalNew += 1;
  else state.stats.totalDupe += 1;

  saveState({ saveKey: SAVE_KEY }, state);

  isSpinning = false;

  rerender({ highlight: { page: result.x, row: result.y, col: result.z, pop: outcome.isNew } });

  const subj = ndc.getSubject(result.code) ?? "";
  view.toast(`${pity ? "救済" : "結果"}: ${result.code}${subj ? ` / ${subj}` : ""}`);

  // ★各ボーナスが出た時（見せるタイミングで鳴らす）
  // outcome.breakdown に label がある前提。ここでは label からキー推定せず、
  // “内部確定で拾った bonusKeys” を鳴らすのが一番管理しやすいです。
  // （ボーナスの種類が増えてもここを触らなくて済む）
  if (bonusKeys.length) {
    // 少し間を置いて“出た感”
    let d = 0;
    for (const k of bonusKeys) {
      setTimeout(() => sfx?.play?.(k), 120 + d);
      d += 120;
    }
  }
}

function rerender(opts = {}) {
  view.updateButtons({
    canSpin: canSpin({ state, ticketsPerSpin: TICKETS_PER_SPIN }),
    forceDisabled: isSpinning,
  });
  view.render({ state, ndc, highlight: opts.highlight });
}
