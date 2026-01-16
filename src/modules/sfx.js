// src/modules/sfx.js
// WebAudio版（安定）: sfx.jsonで管理、相対パスはmanifest基準で解決
// - unlock(): AudioContextをresume（ユーザー操作内で呼ぶ）
// - play(): AudioBufferを鳴らす（HTMLAudioより安定）
// - 失敗してもゲームは止めない（console.warnのみ）

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
    _manifestBaseUrl: null,

    // WebAudio
    _ctx: null,
    _buffers: new Map(), // key -> AudioBuffer
    _loading: new Map(), // key -> Promise<AudioBuffer>
    _unlocked: false,

    async load() {
      if (!manifestUrl) return;

      try {
        const res = await fetch(manifestUrl, { cache: "no-store" });
        if (!res.ok) {
          console.warn("[sfx] manifest fetch failed", res.status);
          return;
        }
        this._manifestBaseUrl = new URL(res.url, location.href);
        const json = await res.json();
        if (json && typeof json === "object") this.manifest = json;
      } catch (e) {
        console.warn("[sfx] manifest load failed", e);
      }
    },

    // ★ユーザー操作内で呼ぶ（pointerdown/click等）
    unlock() {
      try {
        if (!this._ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) {
            console.warn("[sfx] AudioContext not supported");
            return;
          }
          this._ctx = new AC();
        }
        // resumeはPromiseだが「待たない」方がgesture文脈が切れにくい
        const p = this._ctx.resume();
        if (p && typeof p.then === "function") {
          p.then(() => { this._unlocked = true; }).catch((e) => {
            console.warn("[sfx] resume blocked", e);
            this._unlocked = false;
          });
        } else {
          this._unlocked = true;
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

    async prime(keys = []) {
      // 先読み（任意）
      await Promise.all(keys.map((k) => this._ensureBuffer(k)));
    },

    play(key, opts = {}) {
      if (!this.enabled) return;
      if (!this._ctx) return; // unlock前
      if (this._ctx.state !== "running") return; // resume前（無音のままにする）

      const volMul = clamp01(Number(opts.volumeMul ?? 1));
      const vol = clamp01(this.volume * volMul);

      this._ensureBuffer(key).then((buf) => {
        if (!buf) return;

        try {
          const src = this._ctx.createBufferSource();
          src.buffer = buf;

          const gain = this._ctx.createGain();
          gain.gain.value = vol;

          src.connect(gain);
          gain.connect(this._ctx.destination);

          src.start(0);
        } catch (e) {
          console.warn("[sfx] play error", key, e);
        }
      });
    },

    _resolveUrl(key) {
      const raw = this.manifest?.[key];
      if (!raw) return null;
      try {
        const base = this._manifestBaseUrl ?? new URL(location.href);
        return new URL(String(raw), base).toString();
      } catch {
        return null;
      }
    },

    async _ensureBuffer(key) {
      if (this._buffers.has(key)) return this._buffers.get(key);
      if (this._loading.has(key)) return this._loading.get(key);

      const url = this._resolveUrl(key);
      if (!url) {
        console.warn("[sfx] missing key in manifest:", key);
        return null;
      }
      if (!this._ctx) {
        // unlock前にprimeされた場合でも、ctxが無いとdecodeできないので作る
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this._ctx = new AC();
      }

      const task = (async () => {
        try {
          const res = await fetch(url, { cache: "force-cache" });
          if (!res.ok) {
            console.warn("[sfx] audio fetch failed", key, res.status);
            return null;
          }
          const ab = await res.arrayBuffer();
          const buf = await this._ctx.decodeAudioData(ab);
          this._buffers.set(key, buf);
          return buf;
        } catch (e) {
          console.warn("[sfx] decode failed", key, e);
          return null;
        } finally {
          this._loading.delete(key);
        }
      })();

      this._loading.set(key, task);
      return task;
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
