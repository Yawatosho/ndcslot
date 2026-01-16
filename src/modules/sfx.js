// src/modules/sfx.js
// WebAudio版（安定）: sfx.jsonで管理、相対パスはmanifest基準で解決
// - unlock(): AudioContextを作ってresume（ユーザー操作内で呼ぶ）
// - play(): resume完了を待ってから再生（クリック直後の1発目が無音になる問題を潰す）

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

    _ctx: null,
    _resumePromise: null,
    _buffers: new Map(),   // key -> AudioBuffer
    _loading: new Map(),   // key -> Promise<AudioBuffer>

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

    // ユーザー操作の同期区間で呼ぶ（pointerdown/click等）
    unlock() {
      this._ensureContext();
      this._resume(); // waitしない
    },

    setEnabled(v) {
      this.enabled = Boolean(v);
      localStorage.setItem(LS_ENABLED_KEY, this.enabled ? "1" : "0");
    },

    setVolume(v) {
      this.volume = clamp01(Number(v));
      localStorage.setItem(LS_VOLUME_KEY, String(this.volume));
    },

    // 先読み（任意）
    async prime(keys = []) {
      this._ensureContext();
      await this._resume();
      await Promise.all(keys.map((k) => this._ensureBuffer(k)));
    },

    // ★重要：runningを待ってから鳴らす
    play(key, opts = {}) {
      if (!this.enabled) return;

      this._ensureContext();

      const volMul = clamp01(Number(opts.volumeMul ?? 1));
      const vol = clamp01(this.volume * volMul);

      // resume完了→buffer準備→再生 の順で必ずつなぐ
      Promise.resolve(this._resume())
        .then(() => this._ensureBuffer(key))
        .then((buf) => {
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
        })
        .catch((e) => {
          console.warn("[sfx] play chain failed", key, e);
        });
    },

    _ensureContext() {
      if (this._ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        console.warn("[sfx] AudioContext not supported");
        return;
      }
      this._ctx = new AC();
      this._resumePromise = null;
    },

    _resume() {
      if (!this._ctx) return Promise.resolve();
      if (this._ctx.state === "running") return Promise.resolve();

      if (this._resumePromise) return this._resumePromise;

      // resumeは1回だけ走らせ、共有する
      const p = this._ctx.resume();
      this._resumePromise =
        (p && typeof p.then === "function")
          ? p.catch((e) => {
              // 失敗したら次回再挑戦できるようにクリア
              this._resumePromise = null;
              throw e;
            })
          : Promise.resolve();

      return this._resumePromise;
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
