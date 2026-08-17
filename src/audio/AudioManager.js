/**
 * AudioManager
 *
 * Every cue is synthesised procedurally with the Web Audio API, so the game
 * ships with no audio files and still sounds like something. Each cue is also
 * registered by name, so dropping royalty-free samples into
 * `public/assets/audio/<name>.<ext>` and calling `registerFile()` transparently
 * replaces the synth version — see public/assets/README.md.
 *
 * Sounds may be positional: gain falls off with distance from the listener and
 * is panned by the listener's facing.
 */

import * as THREE from 'three';

const MAX_VOICES = 26;

export class AudioManager {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.master = null;
    this.ready = false;
    this.muted = false;
    this.buffers = new Map();     // name -> AudioBuffer (loaded samples)
    this.files = new Map();       // name -> url
    this.voices = 0;

    this.listenerPos = new THREE.Vector3();
    this.listenerRight = new THREE.Vector3(1, 0, 0);
    this.listenerFwd = new THREE.Vector3(0, 0, -1);

    this._noise = null;
    this._unlockBound = null;
  }

  /** Must be called from a user gesture (browsers block autoplay). */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      console.warn('[audio] Web Audio is unavailable; running silent');
      return;
    }
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.settings.get('volume');
    // gentle limiter so overlapping gunfire doesn't clip
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    // shared white-noise buffer
    const len = Math.floor(this.ctx.sampleRate * 1.2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noise = buf;

    this.ready = true;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.loadRegisteredFiles();
  }

  setVolume(v) {
    if (this.master) this.master.gain.value = v;
  }

  setListener(camera, position) {
    this.listenerPos.copy(position);
    this.listenerRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this.listenerFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  }

  /** Optional: point a cue name at an audio file that overrides the synth. */
  registerFile(name, url) {
    this.files.set(name, url);
    if (this.ready) this._loadFile(name, url);
  }

  loadRegisteredFiles() {
    this.files.forEach((url, name) => this._loadFile(name, url));
  }

  async _loadFile(name, url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return; // missing file: keep the synth version
      const arr = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(arr);
      this.buffers.set(name, buf);
    } catch {
      /* silently fall back to the procedural cue */
    }
  }

  /* ------------------------------------------------------------ playback -- */

  /**
   * @param {string} name
   * @param {{volume?:number, rate?:number, position?:THREE.Vector3, priority?:number}} [opts]
   */
  play(name, opts = {}) {
    if (!this.ready || this.muted) return;
    if (this.voices > MAX_VOICES && (opts.priority || 0) < 1) return;

    const vol = opts.volume != null ? opts.volume : 1;
    const rate = opts.rate != null ? opts.rate : 1;

    // spatialisation
    let gainScale = 1;
    let pan = 0;
    if (opts.position) {
      const dx = opts.position.x - this.listenerPos.x;
      const dy = opts.position.y - this.listenerPos.y;
      const dz = opts.position.z - this.listenerPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const ref = opts.refDistance || 9;
      gainScale = ref / (ref + dist * dist * 0.03 + dist * 0.6);
      if (gainScale < 0.012) return;
      if (dist > 0.01) {
        pan = Math.max(-0.92, Math.min(0.92,
          (dx * this.listenerRight.x + dz * this.listenerRight.z) / dist));
      }
    }

    const out = this.ctx.createGain();
    out.gain.value = vol * gainScale;
    if (pan !== 0 && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      out.connect(p);
      p.connect(this.master);
    } else {
      out.connect(this.master);
    }

    const sample = this.buffers.get(name);
    if (sample) {
      const src = this.ctx.createBufferSource();
      src.buffer = sample;
      src.playbackRate.value = rate;
      src.connect(out);
      src.start();
      this._trackVoice(sample.duration / rate);
      return;
    }

    const synth = SYNTHS[name];
    if (!synth) {
      // unknown cue: a soft click keeps feedback rather than silence
      this._click(out, 900, 0.03, 0.3);
      this._trackVoice(0.05);
      return;
    }
    const dur = synth(this, out, rate);
    this._trackVoice(dur || 0.3);
  }

  _trackVoice(seconds) {
    this.voices++;
    setTimeout(() => { this.voices--; }, Math.min(3000, seconds * 1000 + 40));
  }

  /* ---------------------------------------------------- synth primitives -- */

  now() { return this.ctx.currentTime; }

  /** Filtered noise burst. */
  _noiseBurst(out, { duration = 0.12, type = 'bandpass', freq = 1200, q = 1.2, gain = 1, attack = 0.001, curve = 2.6, rate = 1 }) {
    const t = this.now();
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    src.playbackRate.value = rate;
    const flt = this.ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = freq;
    flt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setTargetAtTime(0.0001, t + attack, duration / curve);
    src.connect(flt);
    flt.connect(g);
    g.connect(out);
    src.start(t);
    src.stop(t + duration + 0.08);
    return duration;
  }

  /** Pitched blip / thump. */
  _tone(out, { freq = 440, endFreq = null, duration = 0.12, type = 'sine', gain = 0.5, attack = 0.002, delay = 0 }) {
    const t = this.now() + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + duration + 0.02);
    return duration + delay;
  }

  _click(out, freq, duration, gain) {
    return this._tone(out, { freq, endFreq: freq * 0.4, duration, type: 'square', gain });
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
}

/* ============================================================== cues ===== */

const SYNTHS = {
  /* -------------------------------------------------------------- weapon -- */
  rifleFire(a, out, rate) {
    a._noiseBurst(out, { duration: 0.11, type: 'highpass', freq: 1500, q: 0.7, gain: 0.85, rate: 1.1 * rate });
    a._noiseBurst(out, { duration: 0.2, type: 'bandpass', freq: 420, q: 0.9, gain: 0.7, curve: 3.4, rate });
    a._tone(out, { freq: 190 * rate, endFreq: 55, duration: 0.13, type: 'triangle', gain: 0.55 });
    a._tone(out, { freq: 1400 * rate, endFreq: 500, duration: 0.045, type: 'square', gain: 0.16 });
    return 0.24;
  },
  enemyFire(a, out, rate) {
    a._noiseBurst(out, { duration: 0.1, type: 'bandpass', freq: 900, q: 0.8, gain: 0.8, rate });
    a._tone(out, { freq: 160 * rate, endFreq: 60, duration: 0.11, type: 'triangle', gain: 0.4 });
    return 0.2;
  },
  dryFire(a, out) {
    a._click(out, 1500, 0.035, 0.28);
    a._noiseBurst(out, { duration: 0.04, type: 'highpass', freq: 3000, gain: 0.25 });
    return 0.08;
  },
  impact(a, out) {
    a._noiseBurst(out, { duration: 0.07, type: 'bandpass', freq: 2400, q: 1.6, gain: 0.5 });
    a._tone(out, { freq: 300, endFreq: 120, duration: 0.05, type: 'triangle', gain: 0.2 });
    return 0.1;
  },
  ricochet(a, out) {
    a._tone(out, { freq: 2600, endFreq: 700, duration: 0.16, type: 'sine', gain: 0.16 });
    return 0.18;
  },

  /* -------------------------------------------------------------- reload -- */
  reloadStart(a, out) {
    a._click(out, 700, 0.045, 0.24);
    a._noiseBurst(out, { duration: 0.06, type: 'bandpass', freq: 1800, q: 2, gain: 0.3 });
    return 0.1;
  },
  magOut(a, out) {
    a._click(out, 420, 0.06, 0.3);
    a._noiseBurst(out, { duration: 0.1, type: 'bandpass', freq: 900, q: 1.4, gain: 0.32 });
    return 0.14;
  },
  magIn(a, out) {
    a._click(out, 320, 0.07, 0.4);
    a._tone(out, { freq: 900, endFreq: 240, duration: 0.06, type: 'square', gain: 0.2, delay: 0.02 });
    a._noiseBurst(out, { duration: 0.09, type: 'bandpass', freq: 1300, q: 1.6, gain: 0.35 });
    return 0.16;
  },
  boltRelease(a, out) {
    a._noiseBurst(out, { duration: 0.075, type: 'bandpass', freq: 2600, q: 1.1, gain: 0.42 });
    a._click(out, 1100, 0.05, 0.28);
    a._tone(out, { freq: 2200, endFreq: 900, duration: 0.05, type: 'square', gain: 0.12, delay: 0.05 });
    return 0.14;
  },

  /* ------------------------------------------------------------ movement -- */
  footstep(a, out, rate) {
    a._noiseBurst(out, { duration: 0.075, type: 'lowpass', freq: 900 * rate, q: 0.6, gain: 0.6, curve: 3.2 });
    a._tone(out, { freq: 110 * rate, endFreq: 60, duration: 0.055, type: 'sine', gain: 0.22 });
    return 0.1;
  },
  jump(a, out) {
    a._noiseBurst(out, { duration: 0.06, type: 'lowpass', freq: 700, gain: 0.35 });
    a._tone(out, { freq: 210, endFreq: 320, duration: 0.09, type: 'sine', gain: 0.14 });
    return 0.12;
  },
  land(a, out) {
    a._noiseBurst(out, { duration: 0.12, type: 'lowpass', freq: 520, gain: 0.7, curve: 3 });
    a._tone(out, { freq: 90, endFreq: 45, duration: 0.13, type: 'sine', gain: 0.4 });
    return 0.16;
  },

  /* -------------------------------------------------------------- combat -- */
  hitmarker(a, out) {
    a._tone(out, { freq: 1750, endFreq: 1500, duration: 0.05, type: 'square', gain: 0.16 });
    return 0.06;
  },
  hitmarkerHead(a, out) {
    a._tone(out, { freq: 2100, duration: 0.04, type: 'square', gain: 0.17 });
    a._tone(out, { freq: 2800, duration: 0.06, type: 'square', gain: 0.14, delay: 0.045 });
    return 0.12;
  },
  playerHurt(a, out) {
    a._noiseBurst(out, { duration: 0.16, type: 'lowpass', freq: 420, gain: 0.55, curve: 3 });
    a._tone(out, { freq: 140, endFreq: 70, duration: 0.16, type: 'triangle', gain: 0.3 });
    return 0.2;
  },
  enemyDeath(a, out) {
    a._tone(out, { freq: 260, endFreq: 90, duration: 0.34, type: 'sawtooth', gain: 0.14 });
    a._noiseBurst(out, { duration: 0.3, type: 'lowpass', freq: 700, gain: 0.34, curve: 3.4 });
    return 0.36;
  },
  bodyFall(a, out) {
    a._noiseBurst(out, { duration: 0.2, type: 'lowpass', freq: 320, gain: 0.5, curve: 3 });
    a._tone(out, { freq: 80, endFreq: 40, duration: 0.2, type: 'sine', gain: 0.36 });
    return 0.24;
  },
  playerDeath(a, out) {
    a._tone(out, { freq: 320, endFreq: 60, duration: 0.7, type: 'sine', gain: 0.3 });
    a._noiseBurst(out, { duration: 0.6, type: 'lowpass', freq: 400, gain: 0.4, curve: 4 });
    return 0.8;
  },
  spawn(a, out) {
    a._tone(out, { freq: 420, endFreq: 640, duration: 0.16, type: 'sine', gain: 0.16 });
    a._tone(out, { freq: 640, endFreq: 900, duration: 0.14, type: 'sine', gain: 0.12, delay: 0.1 });
    return 0.3;
  },
  whizz(a, out) {
    a._tone(out, { freq: 2400, endFreq: 700, duration: 0.1, type: 'sine', gain: 0.1 });
    a._noiseBurst(out, { duration: 0.09, type: 'bandpass', freq: 2200, q: 3, gain: 0.16 });
    return 0.12;
  },

  /* ------------------------------------------------------------------ UI -- */
  uiClick(a, out) {
    a._tone(out, { freq: 900, endFreq: 1250, duration: 0.05, type: 'square', gain: 0.1 });
    return 0.06;
  },
  uiHover(a, out) {
    a._tone(out, { freq: 620, duration: 0.03, type: 'sine', gain: 0.06 });
    return 0.04;
  },
  uiBack(a, out) {
    a._tone(out, { freq: 700, endFreq: 420, duration: 0.07, type: 'square', gain: 0.09 });
    return 0.08;
  },
  matchStart(a, out) {
    [330, 440, 554].forEach((f, i) => {
      a._tone(out, { freq: f, duration: 0.22, type: 'triangle', gain: 0.14, delay: i * 0.11 });
    });
    a._noiseBurst(out, { duration: 0.4, type: 'lowpass', freq: 300, gain: 0.2, curve: 4 });
    return 0.7;
  },
  victory(a, out) {
    [523, 659, 784, 1046].forEach((f, i) => {
      a._tone(out, { freq: f, duration: 0.42, type: 'triangle', gain: 0.15, delay: i * 0.14 });
    });
    return 1.1;
  },
  defeat(a, out) {
    [440, 392, 330, 262].forEach((f, i) => {
      a._tone(out, { freq: f, duration: 0.5, type: 'sine', gain: 0.15, delay: i * 0.18 });
    });
    return 1.3;
  },
  countdown(a, out) {
    a._tone(out, { freq: 1200, duration: 0.09, type: 'square', gain: 0.1 });
    return 0.1;
  }
};

export const CUE_NAMES = Object.keys(SYNTHS);
