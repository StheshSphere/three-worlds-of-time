import * as THREE from 'three';
import { assets } from './assets.js';
import { settings } from './settings.js';

/**
 * Audio (Gameplay & Experience rubric: "sound and music to enhance immersion").
 *
 *   music bus ─┐
 *   sfx bus  ──┼─► THREE.AudioListener (on the camera) ─► speakers
 *   ambience ──┘        └─ master volume
 *
 * - Music crossfades between eras (two buffer sources, gain ramps).
 * - 2D effects are fire-and-forget buffer sources with slight random pitch
 *   so repeated footsteps don't sound mechanical.
 * - 3D effects use THREE.PositionalAudio attached to world objects (energy
 *   barriers hum, braziers crackle) — rerouted through the sfx bus so the
 *   effects slider still applies.
 * - Ambience is synthesised here (filtered noise + oscillators) rather than
 *   loaded: wind for the Past, mains hum for the Present, a city drone for
 *   the Future. Our own sound design, zero download cost.
 */
export class AudioManager {
  constructor(camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.ctx = this.listener.context;

    this.musicBus = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.ambBus = this.ctx.createGain();
    for (const bus of [this.musicBus, this.sfxBus, this.ambBus]) bus.connect(this.listener.getInput());

    this.music = null;          // { source, gain, name }
    this.ambience = null;       // { nodes[], gain }
    this._noise = null;
    this.applyVolumes();
    settings.onChange((k) => { if (/Volume$/.test(k)) this.applyVolumes(); });
  }

  /** Browsers start AudioContexts suspended until a user gesture. */
  unlock() { if (this.ctx.state !== 'running') this.ctx.resume(); }

  applyVolumes() {
    this.listener.setMasterVolume(settings.get('masterVolume'));
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(settings.get('musicVolume'), t, 0.05);
    this.sfxBus.gain.setTargetAtTime(settings.get('sfxVolume'), t, 0.05);
    this.ambBus.gain.setTargetAtTime(settings.get('sfxVolume') * 0.8, t, 0.05);
  }

  /* ------------------------------ music ------------------------------ */
  playMusic(name, fade = 2.5) {
    if (this.music && this.music.name === name) return;
    const buffer = assets.audio(`music:${name}`);
    const t = this.ctx.currentTime;
    if (this.music) {
      const old = this.music;
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0, t + fade);
      old.source.stop(t + fade + 0.05);
      this.music = null;
    }
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + fade);
    source.connect(gain).connect(this.musicBus);
    source.start(t + 0.05);
    this.music = { source, gain, name };
  }

  stopMusic(fade = 1.5) {
    if (!this.music) return;
    const t = this.ctx.currentTime;
    this.music.gain.gain.cancelScheduledValues(t);
    this.music.gain.gain.setValueAtTime(this.music.gain.gain.value, t);
    this.music.gain.gain.linearRampToValueAtTime(0, t + fade);
    this.music.source.stop(t + fade + 0.05);
    this.music = null;
  }

  /** Duck the music under a story beat / stinger. */
  duck(amount = 0.35, seconds = 2) {
    if (!this.music) return;
    const g = this.music.gain.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(amount, t + 0.2);
    g.linearRampToValueAtTime(1, t + seconds);
  }

  /* ------------------------------ effects ---------------------------- */
  /** Fire-and-forget 2D effect. opts: { volume, rate, jitter } */
  play(name, opts = {}) {
    const buffer = assets.audio(name);
    if (!buffer || this.ctx.state !== 'running') return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const jitter = opts.jitter ?? 0.06;
    source.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * jitter);
    const gain = this.ctx.createGain();
    gain.gain.value = opts.volume ?? 1;
    source.connect(gain).connect(this.sfxBus);
    source.start();
    source.onended = () => { source.disconnect(); gain.disconnect(); };
  }

  /** Random variant: playVariant('step-grass', 4) → step-grass-0..3 */
  playVariant(prefix, count, opts) {
    this.play(`${prefix}-${Math.floor(Math.random() * count)}`, opts);
  }

  /**
   * Looping 3D sound attached to an object. Returns a handle with dispose()
   * — levels push it into their disposables so it stops on unload.
   */
  positional(name, object, { volume = 1, refDistance = 3, rolloff = 1.6, loop = true, rate = 1 } = {}) {
    const buffer = assets.audio(name);
    const sound = new THREE.PositionalAudio(this.listener);
    sound.gain.disconnect();
    sound.gain.connect(this.sfxBus);
    if (buffer) {
      sound.setBuffer(buffer);
      sound.setLoop(loop);
      sound.setRefDistance(refDistance);
      sound.setRolloffFactor(rolloff);
      sound.setVolume(volume);
      sound.setPlaybackRate(rate);
      if (this.ctx.state === 'running') sound.play();
      else this.ctx.addEventListener('statechange', () => { if (this.ctx.state === 'running' && sound.buffer && !sound.isPlaying && sound.parent) sound.play(); }, { once: true });
    }
    object.add(sound);
    let disposed = false;
    return {
      sound,
      dispose() {
        // Idempotent: levels may wind a positional sound down early (e.g. the
        // lab's generators stop when mains returns) and the manager disposes
        // every handle again on unload. A second disconnect would throw from
        // THREE.PositionalAudio.disconnect() (destination already detached)
        // and abort the rest of the unload disposal loop.
        if (disposed) return;
        disposed = true;
        try { if (sound.isPlaying) sound.stop(); } catch { /* already stopped */ }
        try { sound.disconnect(); } catch { /* audio graph already torn down */ }
        if (sound.parent) sound.parent.remove(sound);
      },
    };
  }

  /* ------------------------------ ambience --------------------------- */
  _noiseBuffer() {
    if (this._noise) return this._noise;
    const len = this.ctx.sampleRate * 4;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Pink-ish noise (Paul Kellet's economy filter) — softer than white noise.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
    }
    this._noise = buf;
    return buf;
  }

  /** era: 'ruins' | 'lab' | 'neon' | null */
  setAmbience(era) {
    const t = this.ctx.currentTime;
    if (this.ambience) {
      const old = this.ambience;
      old.gain.gain.setTargetAtTime(0, t, 0.6);
      setTimeout(() => old.nodes.forEach((n) => { try { n.stop && n.stop(); } catch { /* */ } n.disconnect(); }), 3000);
      this.ambience = null;
    }
    if (!era) return;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, t, 1.2);
    gain.connect(this.ambBus);
    const nodes = [gain];

    const noise = () => {
      const s = this.ctx.createBufferSource();
      s.buffer = this._noiseBuffer();
      s.loop = true;
      s.start();
      nodes.push(s);
      return s;
    };
    const lfo = (freq, depth, target) => {
      const o = this.ctx.createOscillator();
      o.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.value = depth;
      o.connect(g).connect(target);
      o.start();
      nodes.push(o, g);
    };

    if (era === 'ruins') {
      // Wind: band-passed noise whose centre frequency and level slowly sway.
      const src = noise();
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.7;
      const g = this.ctx.createGain(); g.gain.value = 0.55;
      src.connect(bp).connect(g).connect(gain);
      lfo(0.07, 260, bp.frequency);
      lfo(0.11, 0.25, g.gain);
      nodes.push(bp, g);
    } else if (era === 'lab') {
      // Mains hum (50 Hz + harmonics) under a faint air-conditioning hiss.
      for (const [f, a] of [[50, 0.05], [100, 0.03], [150, 0.012]]) {
        const o = this.ctx.createOscillator(); o.frequency.value = f;
        const g = this.ctx.createGain(); g.gain.value = a;
        o.connect(g).connect(gain); o.start(); nodes.push(o, g);
      }
      const src = noise();
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const g = this.ctx.createGain(); g.gain.value = 0.18;
      src.connect(lp).connect(g).connect(gain); nodes.push(lp, g);
    } else if (era === 'neon') {
      // City drone: detuned low saws through a slow-sweeping lowpass + wind.
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 3;
      const g = this.ctx.createGain(); g.gain.value = 0.05;
      for (const f of [55, 55.4, 82.4]) {
        const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
        o.connect(lp); o.start(); nodes.push(o);
      }
      lp.connect(g).connect(gain);
      lfo(0.05, 180, lp.frequency);
      const src = noise();
      const hp = this.ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 900; hp.Q.value = 0.5;
      const g2 = this.ctx.createGain(); g2.gain.value = 0.22;
      src.connect(hp).connect(g2).connect(gain);
      nodes.push(lp, g, hp, g2);
      // The void under the skyline: a near-sub drone (two sines 0.6 Hz
      // apart, beating slowly) plus a dark howl that rises and falls far
      // below the deck — the bottomless city should sound bottomless too.
      for (const f of [36, 36.6]) {
        const o = this.ctx.createOscillator(); o.frequency.value = f;
        const g3 = this.ctx.createGain(); g3.gain.value = 0.028;
        o.connect(g3).connect(gain); o.start(); nodes.push(o, g3);
      }
      const voidSrc = noise();
      const vp = this.ctx.createBiquadFilter(); vp.type = 'bandpass'; vp.frequency.value = 260; vp.Q.value = 1.4;
      const g4 = this.ctx.createGain(); g4.gain.value = 0.09;
      voidSrc.connect(vp).connect(g4).connect(gain);
      lfo(0.045, 150, vp.frequency);
      lfo(0.031, 0.05, g4.gain);
      nodes.push(vp, g4);
    }
    this.ambience = { nodes, gain };
  }
}
