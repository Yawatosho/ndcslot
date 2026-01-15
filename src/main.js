/* src/main.js
   次の分割：
   - ndc.js（読み込み・有効コード生成）✅
   - state.js（保存・日替わり）✅
   - view.js（描画）✅
   - gameCore.js（中核ロジック）✅
*/

import { initNdc } from "./modules/ndc.js?v=20260116a";
import { loadState, saveState, createInitialState } from "./modules/state.js?v=20260116a";
import { createView } from "./modules/view.js?v=20260116a";
import {
  canSpin,
  consumeSpin,
  shouldTriggerPity,
  rollRandomValid,
  rollNewGuaranteed,
  applyStampAndRewards,
  updateDupeStreak,
} from "./modules/gameCore.js?v=20260116a";

const SAVE_KEY = "ndc_slot_save_v1";
const START_TICKETS = 300;
const TICKETS_PER_SPIN = 1;

// 報酬（しおり券）
const REWARD_NEW = 8;
const REWARD_DUPE = 1;
const REWARD_PAGE_COMPLETE = 50;

// ボーナス
const BONUS_TRIPLE = 1000; // ゾロ目
const BONUS_STRAIGHT = 300; // 連番
// 追加の“ほどよい”おまけ（不要なら 0 にしてOK）
const BONUS_SANDWICH = 120; // 121 / 707 など
const BONUS_PAIR = 60;      // 112 / 455 など
const BONUS_LUCKY7 = 70;    // 7が入っていたら

// 後半加速ピティ（index = dupeStreak）
const PITY_TABLE = [0.00, 0.10, 0.20, 0.35, 0.55, 0.75, 0.90, 1.00];

// ndc.json は「公開フォルダ直下」に置く（src/ の1つ上）
const NDC_JSON_URL = new URL("../ndc.json", import.meta.url);

let ndc = null;
let state = null;
const view = createView();
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

  state = loadState({ saveKey: SAVE_KEY, startTickets: START_TICKETS });
  saveState({ saveKey: SAVE_KEY }, state);

  // tabs
  view.initTabs({
    onSelectPage: (p) => {
      state.currentPage = p;
      saveState({ saveKey: SAVE_KEY }, state);
      rerender();
    },
  });

  // initial slot display
  view.setSlotDigits(0, 0, 0);
  view.setResultText({ ndc, code: "000" });

  // events
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

  consumeSpin({ state, ticketsPerSpin: TICKETS_PER_SPIN });

  const pity = shouldTriggerPity({ state, ndc, pityTable: PITY_TABLE });
  const result = pity
    ? rollNewGuaranteed({ state, ndc })
    : rollRandomValid(ndc);

  // ここから演出（ボタン無効化）
  isSpinning = true;
  rerender(); // forceDisabledが効く

  await view.playSpinAnimation({
    ndc,
    finalResult: result,
    durationMs: 420, // ここを 300〜500 の好みで調整OK
    tickMs: 55,
  });

  // 最終結果の分類名を表示
  view.setResultText({ ndc, code: result.code });

  // 状態反映（止まってからコミット）
  state.currentPage = result.x;
  state.lastResultCode = result.code;

  const outcome = applyStampAndRewards({
    state,
    ndc,
    result,
    rewards: {
      new: REWARD_NEW,
      dupe: REWARD_DUPE,
      pageComplete: REWARD_PAGE_COMPLETE,
      triple: BONUS_TRIPLE,
      straight: BONUS_STRAIGHT,
      sandwich: BONUS_SANDWICH,
      pair: BONUS_PAIR,
      lucky7: BONUS_LUCKY7,
    },
  });
  updateDupeStreak({ state, isNew: outcome.isNew });

  state.stats.totalSpins += 1;
  if (outcome.isNew) state.stats.totalNew += 1;
  else state.stats.totalDupe += 1;

  saveState({ saveKey: SAVE_KEY }, state);

  isSpinning = false;

  rerender({ highlight: { page: result.x, row: result.y, col: result.z, pop: outcome.isNew } });

  const subj = ndc.getSubject(result.code) ?? "";
  view.toast(`${pity ? "救済" : "結果"}: ${result.code}${subj ? ` / ${subj}` : ""}`);

  // 獲得内訳（トーストはキューで順番に出る）
  for (const b of outcome.breakdown) {
    view.toast(b.label);
  }
}

function rerender(opts = {}) {
  view.updateButtons({
    canSpin: canSpin({ state, ticketsPerSpin: TICKETS_PER_SPIN }),
    forceDisabled: isSpinning,
  });
  view.render({ state, ndc, highlight: opts.highlight });
}
