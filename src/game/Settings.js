/**
 * Persistent user settings (localStorage). Listeners are notified whenever a
 * value changes so the renderer / camera / audio can react immediately.
 */

const KEY = 'ironstrike.settings.v1';

export const DEFAULTS = {
  sensitivity: 1.0,
  fov: 80,
  quality: 'high',
  volume: 0.7,
  invertY: false,
  cameraShake: true,
  adsToggle: false
};

export class Settings {
  constructor() {
    this.values = { ...DEFAULTS };
    this._listeners = new Set();
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const k of Object.keys(DEFAULTS)) {
          if (parsed[k] !== undefined) this.values[k] = parsed[k];
        }
      }
    } catch (err) {
      console.warn('[settings] could not read saved settings:', err);
    }
    // sanity clamps in case of hand-edited storage
    this.values.sensitivity = clamp(this.values.sensitivity, 0.2, 3);
    this.values.fov = clamp(this.values.fov, 60, 110);
    this.values.volume = clamp(this.values.volume, 0, 1);
    if (!['low', 'medium', 'high'].includes(this.values.quality)) this.values.quality = 'high';
    return this.values;
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.values));
    } catch (err) {
      console.warn('[settings] could not save settings:', err);
    }
  }

  get(key) { return this.values[key]; }

  set(key, value) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    this.save();
    this._listeners.forEach((fn) => fn(key, value, this.values));
  }

  reset() {
    this.values = { ...DEFAULTS };
    this.save();
    this._listeners.forEach((fn) => fn('*', null, this.values));
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
}

function clamp(v, a, b) {
  const n = Number(v);
  if (!Number.isFinite(n)) return a;
  return n < a ? a : n > b ? b : n;
}
