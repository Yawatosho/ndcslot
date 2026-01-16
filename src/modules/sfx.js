// src/modules/sfx.js
// 効果音の一元管理（差し替えは sfx.json 側）
// - autoplay制限対策：unlock() をユーザー操作で呼ぶ
// - 失敗してもゲームを止めない（安全に握りつぶす）

const LS_ENABLED_KEY = "ndc_slot_sfx_enabled_v1";
const LS_VOLUME_KEY = "ndc_slot_sfx_volume_v1";

export async function createSfx({
  manifestUrl,
  defaultEnabled = true,
  defaultVolume = 0.75,
} = {}) {
  const enabled = readBool(LS_ENABLED_KEY, defaultEnabled);
  const volume = clamp01(readNumber(LS_VOLUME_KEY, defaultVolume));

  const sfx = {
    enabled,
    volume,
    manifest: {},
    _audioPool: new Map(), // key -> Audio[]
    _unlocked: false,

    async load() {
      if (!manifestUrl) return;
      try {
        const res = await fetch(manifestUrl, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (json && typeof json === "object") this.manifest = json;
      } catch {
        // no-op
      }
    },

    // ユーザー操作時に呼ぶ（最初のクリックなど）
    async unlock() {
      if (this._unlocked) return;
      this._unlocked = true;

      // iOS/Safari等：一度再生できる状態にする（無音の短い play/pause）
      try {
        const url = this._resolve("spinStart");
        if (!url) return;
        const a = new Audio(url);
        a.volume = 0;
        await a.play().catch(() => {});
        a.pause();
      } catch {
        // no-op
      }
    },

    setEnabled(v) {
      this.enabled = Boolean(v);
      localStorage.setItem(LS_ENABLED_KEY, this.enabled ? "1" : "0");
    },

    setVolume(v) {
      this.volume = clamp01(Number(v));
      localStorage.setItem(LS_VOLUME_KEY, String(this.volume));
    },

    // 代表キーが無い場合は鳴らさない（静かにスルー）
    play(key, opts = {}) {
      if (!this.enabled) return;
      const url = this._resolve(key);
      if (!url) return;

      const volMul = clamp01(Number(opts.volumeMul ?? 1));
      const vol = clamp01(this.volume * volMul);

      try {
        // 同時多発に備えて pool から使い回す
        const a = this._acquire(key, url);
        a.currentTime = 0;
        a.volume = vol;
        a.play().catch(() => {});
      } catch {
        // no-op
      }
    },

    _resolve(key) {
      const raw = this.manifest?.[key];
      if (!raw) return null;
      // キャッシュ対策したい場合は json 側で ?v= を付けてもOK
      return String(raw);
    },

    _acquire(key, url) {
      const poolSize = 4;
      if (!this._audioPool.has(key)) this._audioPool.set(key, []);
      const arr = this._audioPool.get(key);

      // 再生中でないものを優先
      for (const a of arr) {
        if (a.paused || a.ended) return a;
      }
      // 無ければ追加
      if (arr.length < poolSize) {
        const a = new Audio(url);
        arr.push(a);
        return a;
      }
      // 最後のものを強制再利用
      return arr[arr.length - 1];
    },
  };

  await sfx.load();
  return sfx;
}

function readBool(key, fallback) {
  const v = localStorage.getItem(key);
  if (v === null) return fallback;
  return v === "1" || v === "true";
}
function readNumber(key, fallback) {
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) ? v : fallback;
}
function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
