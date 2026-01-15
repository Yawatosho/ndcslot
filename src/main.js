/* src/main.js
   次の分割：
   - ndc.js（読み込み・有効コード生成）✅
   - state.js（保存・日替わり）✅
   - view.js（描画）✅
   - gameCore.js（中核ロジック）✅
*/

import { initNdc } from "./modules/ndc.js";
import { loadState, saveState, applyDailyResetIfNeeded, createInitialState } from "./modules/state.js";
import { createView } from "./modules/view.js";
import {
  canSpin,
  consumeSpin,
  shouldTriggerPity,
  rollRandomValid,
  rollNewGuaranteed,
  applyStampAndRewards,
  updateDupeStreak,
} from "./modules/gameCore.js";

const SAVE_KEY = "ndc_slot_save_v1";
const FREE_SPINS_PER_DAY = 10;
const TICKETS_PER_EXTRA_SPIN = 10;

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

  state = loadState({ saveKey: SAVE_KEY, freeSpinsPerDay: FREE_SPINS_PER_DAY });
  applyDailyResetIfNeeded({ state, freeSpinsPerDay: FREE_SPINS_PER_DAY });
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
  view.el.spinBtn.addEventListener("click", () => onSpin({ mode: "auto" }));
  view.el.useTicketSpinBtn.addEventListener("click", () => onSpin({ mode: "ticket" }));
  view.el.resetBtn.addEventListener("click", () => {
    if (!confirm("保存データを初期化します。よろしいですか？")) return;
    state = createInitialState({ freeSpinsPerDay: FREE_SPINS_PER_DAY });
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

async function onSpin({ mode }) {
  if (isSpinning) return;

  const ok = canSpin({ state, mode, ticketsPerExtraSpin: TICKETS_PER_EXTRA_SPIN });
  if (!ok) {
    view.toast("回せません（無料回数またはしおり券が不足）");
    return;
  }

  consumeSpin({ state, mode, ticketsPerExtraSpin: TICKETS_PER_EXTRA_SPIN });

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

  const outcome = applyStampAndRewards({ state, ndc, result });
  updateDupeStreak({ state, isNew: outcome.isNew });

  state.stats.totalSpins += 1;
  if (outcome.isNew) state.stats.totalNew += 1;
  else state.stats.totalDupe += 1;

  saveState({ saveKey: SAVE_KEY }, state);

  isSpinning = false;

rerender({ highlight: { page: result.x, row: result.y, col: result.z, pop: outcome.isNew } });


  const subj = ndc.getSubject(result.code) ?? "";
  view.toast(`${pity ? "救済" : "結果"}: ${result.code}${subj ? ` / ${subj}` : ""}`);
  if (outcome.pageCompletedNow) view.toast(`ページ ${result.x}xx コンプリート！ しおり券+50`);
}

function rerender(opts = {}) {
view.updateButtons({
  canSpinAuto: canSpin({ state, mode: "auto", ticketsPerExtraSpin: TICKETS_PER_EXTRA_SPIN }),
  canSpinTicket: canSpin({ state, mode: "ticket", ticketsPerExtraSpin: TICKETS_PER_EXTRA_SPIN }),
  forceDisabled: isSpinning,
});
  view.render({ state, ndc, highlight: opts.highlight });
}

