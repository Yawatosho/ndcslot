// src/modules/sfx.js
// 効果音の一元管理（差し替えは sfx.json 側）
// - 相対URLは sfx.json の場所を基準に解決（res.url）
// - autoplay制限対策：unlock() を「ユーザー操作の同期区間」で呼ぶ
// - play失敗は console に出す（原因特定用）

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
    _audioPool: new Map(),
    _unlocked: false,

    async load() {
      if (!manifestUrl) return;
      try {
        const res = await fetch(manifestUrl, { cache: "no-store" });
        if (!res.ok) return;
        this._manifestUrl = res.url || this._manifestUrl;
        const json = await res.json();
        if (json && typeof json === "object") this.manifest = json;
      } catch (e) {
        console.warn("[sfx] manifest load failed", e);
      }
    },

    // ★unlockは「成功したら」unlockedにする（拒否されたのにtrueにしない）
    unlock() {
      if (this._unlocked) return;

      const url = this._resolve("spinStart");
      if (!url) {
        console.warn("[sfx] unlock skipped: spinStart not found in manifest");
        return;
      }

      try {
        const a = new Audio(url);
        a.preload = "auto";
        a.muted = true;     // ★ミュートで解錠（iOS系で安定）
        a.volume = 0;

        const p = a.play();
        if (p && typeof p.then === "function") {
          p.then(() => {
            // 再生できた＝解錠成功
            this._unlocked = true;
            a.pause();
            a.currentTime = 0;
          }).catch((err) => {
            console.warn("[sfx] unlock play blocked", err);
            // blockedならunlockedのままにしない（次のジェスチャで再挑戦できる）
            this._unlocked = false;
          });
        } else {
          // 古い環境向け：ここまで来たら成功扱い
          this._unlocked = true;
          a.pause();
          a.currentTime = 0;
        }
      } catch (e) {
        console.warn("[sfx] unlock error", e);
        this._unlocked = false;
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
      if (!url) {
        console.warn("[sfx] missing key:", key);
        return;
      }

      const volMul = clamp01(Number(opts.volumeMul ?? 1));
      const vol = clamp01(this.volume * volMul);

      try {
        const a = this._acquire(key, url);
        a.muted = false;
        a.currentTime = 0;
        a.volume = vol;

        const p = a.play();
        if (p && typeof p.catch === "function") {
          p.catch((err) => console.warn("[sfx] play blocked:", key, err));
        }
      } catch (e) {
        console.warn("[sfx] play error:", key, e);
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
