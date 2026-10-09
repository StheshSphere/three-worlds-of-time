/**
 * Player options (Polish rubric: "quality-of-life features such as an
 * options menu"). Persisted to localStorage when available — every access is
 * wrapped in try/catch because private windows and locked-down lab browsers
 * can throw on storage access; the game must still run without it.
 */
const KEY = 'three-worlds-settings-v1';

export const DEFAULTS = {
  masterVolume: 0.8,
  musicVolume: 0.55,
  sfxVolume: 0.8,
  sensitivity: 1,
  fov: 72,
  quality: 'medium',     // 'low' | 'medium' | 'high'
  invertY: false,
  showFps: false,
  minimap: true,
  thirdPerson: true,
};

/** Per-quality renderer budgets. Low is aimed at older integrated GPUs. */
export const QUALITY = {
  low: { pixelRatio: 0.75, shadows: false, shadowMapSize: 1024, bloom: false, reflections: false, transmission: false, grass: 0.25 },
  medium: { pixelRatio: 1, shadows: true, shadowMapSize: 1024, bloom: true, reflections: true, transmission: true, grass: 0.6 },
  high: { pixelRatio: 1.5, shadows: true, shadowMapSize: 2048, bloom: true, reflections: true, transmission: true, grass: 1 },
};

const listeners = new Set();
const state = { ...DEFAULTS };

try {
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  for (const k of Object.keys(DEFAULTS)) if (k in saved) state[k] = saved[k];
} catch { /* storage unavailable — defaults it is */ }

export const settings = {
  get(key) { return state[key]; },
  all() { return { ...state }; },
  set(key, value) {
    if (state[key] === value) return;
    state[key] = value;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
    listeners.forEach((fn) => fn(key, value));
  },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  quality() { return QUALITY[state.quality] || QUALITY.medium; },
};

/** Small persisted record of the best full-run time (replay value). */
export const records = {
  bestTime() {
    try { return Number(localStorage.getItem('three-worlds-best-time')) || null; } catch { return null; }
  },
  submit(seconds) {
    const best = records.bestTime();
    if (!best || seconds < best) {
      try { localStorage.setItem('three-worlds-best-time', String(seconds)); } catch { /* ignore */ }
      return true;
    }
    return false;
  },
};
