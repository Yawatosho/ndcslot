// src/modules/sfx.js
// 効果音の一元管理（差し替えは sfx.json 側）
// - 相対URLは sfx.json の場所を基準に解決（res.url）
// - autoplay制限対策：unlock() を「ユーザー操作の同期区間」で呼ぶ
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
    _manifestUrl: manifestUrl ? String(manifestUrl) : "",
    _audioPool: new Map(), // key -> Audio[]
    _unlocked: false,

    async load() {
      if (!manifestUrl) return;
      try {
        const res = await fetch(manifestUrl, { cache: "no-store" });
        if (!res.ok) return;
        this._manifestUrl = res.url || this._manifestUrl;
        const json = await res.json();
        if (json && typeof json === "object") this.manifest = json;
      } catch {
        // no-op
      }
    },

    // ★重要：ユーザー操作の「同期区間」で呼ぶこと
    // await を使わず、play を投げっぱなしにする（ここが一番安定）
    unlock() {
      if (this._unlocked) return;
      this._unlocked = true;

      try {
        const url = this._resolve("spinStart");
        if (!url) return;

        const a = new Audio(url);
        a.preload = "auto";
        a.volume = 0;

        const p = a.play();
        // promise は待たない（待つと gesture 文脈を失うブラウザがある）
        if (p && typeof p.catch === "function") p.catch(() => {});
        // すぐ止める（無音の解錠）
        a.pause();
        a.currentTime = 0;
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

    play(key, opts = {}) {
      if (!this.enabled) return;
      const url = this._resolve(key);
      if (!url) return;

      const volMul = clamp01(Number(opts.volumeMul ?? 1));
      const vol = clamp01(this.volume * volMul);

      try {
        const a = this._acquire(key, url);
        a.currentTime = 0;
        a.volume = vol;

        const p = a.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch {
        // no-op
      }
    },

    _resolve(key) {
      const raw = this.manifest?.[key];
      if (!raw) return null;
      try {
        const base = this._manifestUrl || document.baseURI;
        return new URL(String(raw), base).toString();
      } catch {
        return null;
      }
    },

    _acquire(key, url) {
      const poolSize = 4;
      if (!this._audioPool.has(key)) this._audioPool.set(key, []);
      const arr = this._audioPool.get(key);

      for (const a of arr) {
        if (a.paused || a.ended) return a;
      }
      if (arr.length < poolSize) {
        const a = new Audio(url);
        a.preload = "auto";
        arr.push(a);
        return a;
      }
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
