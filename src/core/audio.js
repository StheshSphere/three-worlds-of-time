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
    this.voiceBus = this.ctx.createGain();
    for (const bus of [this.musicBus, this.sfxBus, this.ambBus, this.voiceBus]) bus.connect(this.listener.getInput());
    this.voice = null;          // { source, gain } — the one line currently speaking

    this.music = null;          // { source, gain, name }
    this.ambience = null;       // { nodes[], gain }
    this.musicTracks = new Set();
    this.effects = new Set();
    this.positionals = new Set();
    this._ambienceTail = null;
    this._noise = null;
    this.applyVolumes();
    settings.onChange((k) => { if (/Volume$/.test(k)) this.applyVolumes(); });
  }

  /** Browsers start AudioContexts suspended until a user gesture. */
  unlock() { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }

  applyVolumes() {
    this.listener.setMasterVolume(settings.get('masterVolume'));
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(settings.get('musicVolume'), t, 0.05);
    this.sfxBus.gain.setTargetAtTime(settings.get('sfxVolume'), t, 0.05);
    this.ambBus.gain.setTargetAtTime(settings.get('sfxVolume') * 0.8, t, 0.05);
    this.voiceBus.gain.setTargetAtTime(settings.get('sfxVolume'), t, 0.05);
  }

  /* ------------------------------ music ------------------------------ */
  playMusic(name, fade = 2.5) {
    if (this.music && this.music.name === name) return;
    // Rapid restarts may interrupt a crossfade. Keep only its current track.
    for (const track of this.musicTracks) if (track !== this.music) this._disposeTrack(track);
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
    const track = { source, gain, name };
    this.musicTracks.add(track);
    source.onended = () => this._disposeTrack(track);
    this.music = track;
  }

  _disposeTrack(track) {
    if (!this.musicTracks.delete(track)) return;
    track.source.onended = null;
    try { track.source.stop(); } catch { /* already ended */ }
    track.source.disconnect();
    track.gain.disconnect();
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
    this.effects.add(source);
    source.start();
    source.onended = () => { this.effects.delete(source); source.disconnect(); gain.disconnect(); };
  }

  stopEffects() { for (const source of this.effects) { try { source.stop(); } catch { /* ended */ } } }

  /* ------------------------------ voice acting ----------------------- */
  /**
   * Spoken dialogue (src/core/voice.js). One line at a time: starting a new
   * line or advancing the dialogue stops the previous one — voices never
   * overlap. The music ducks under speech so the line stays intelligible.
   */
  playVoice(name) {
    this.stopVoice();
    const buffer = assets.audio(`voice:${name}`);
    if (!buffer || this.ctx.state !== 'running') return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = 1.25;      // speech sits just above the mix, like a lead vocal
    source.connect(gain).connect(this.voiceBus);
    const startedAt = this.ctx.currentTime;
    source.start();
    this.voice = { source, gain, name, startedAt, duration: buffer.duration };
    this.duck(0.4, buffer.duration + 1.2);
    source.onended = () => {
      if (this.voice?.source === source) this.voice = null;
      source.disconnect(); gain.disconnect();
    };
  }

  /**
   * Position inside the line the listener is HEARING right now (seconds), or
   * null when nothing is speaking. Subtracts the output device latency, so
   * lip-sync driven by this stays in step with the actual sound.
   */
  voiceTime() {
    if (!this.voice) return null;
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    return this.ctx.currentTime - this.voice.startedAt - latency;
  }

  stopVoice() {
    const v = this.voice;
    if (!v) return;
    this.voice = null;
    v.source.onended = null;
    try { v.source.stop(); } catch { /* already ended */ }
    v.source.disconnect(); v.gain.disconnect();
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
    let disposed = false;
    const start = () => { if (!disposed && this.ctx.state === 'running' && sound.buffer && !sound.isPlaying && sound.parent) sound.play(); };
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
      else this.ctx.addEventListener('statechange', start);
    }
    object.add(sound);
    const manager = this;
    this.positionals.add(sound);
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
        manager.ctx.removeEventListener('statechange', start);
        manager.positionals.delete(sound);
        try { if (sound.isPlaying) sound.stop(); } catch { /* already stopped */ }
        try { sound.disconnect(); } catch { /* audio graph already torn down */ }
        sound.gain.disconnect();
        sound.buffer = null;
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
    // Soft environmental noise. A one-pole low-pass with a sample-rate-derived
    // pole replaces the earlier third-party coefficient table.
    const alpha = 1 - Math.exp(-2 * Math.PI * 750 / this.ctx.sampleRate);
    let low = 0;
    for (let i = 0; i < d.length; i++) {
      const white = Math.random() * 2 - 1;
      low += alpha * (white - low);
      d[i] = .85 * low + .035 * white;
    }
    this._noise = buf;
    return buf;
  }

  /** era: 'ruins' | 'lab' | 'neon' | null */
  setAmbience(era) {
    if (this.ambience?.era === era) return;
    const t = this.ctx.currentTime;
    if (this._ambienceTail) this._disposeAmbience(this._ambienceTail);
    if (this.ambience) {
      const old = this.ambience;
      old.gain.gain.setTargetAtTime(0, t, 0.6);
      old.timer = setTimeout(() => this._disposeAmbience(old), 3000);
      this._ambienceTail = old;
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
    this.ambience = { nodes, gain, era };
  }

  _disposeAmbience(ambience) {
    clearTimeout(ambience.timer);
    for (const node of ambience.nodes) {
      try { node.stop?.(); } catch { /* already stopped */ }
      node.disconnect();
    }
    if (this._ambienceTail === ambience) this._ambienceTail = null;
  }
}
