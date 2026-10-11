import * as THREE from 'three';

/**
 * Timed camera/action beats with player-acknowledged dialogue gates.
 *
 *   { at: 4,  cam: { pos:[x,y,z], look:[x,y,z], toPos?, toLook?, dur? } }  camera shot (eased dolly)
 *   { at: 4,  say: ['Ari', 'Line of dialogue', 4.5] }                        caption (legacy duration ignored)
 *   { at: 9,  run: (ctx) => { … } }                                          any game event
 *   { at: 30, end: true }                                                    finish
 *
 * Camera positions may also be functions returning a Vector3 (to follow a
 * moving actor). The shared dialogue controller owns Enter/click; Esc pauses.
 */
const _p = new THREE.Vector3();
const _l = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

const ease = (k) => k * k * (3 - 2 * k);
const vec = (v, out) => (typeof v === 'function' ? out.copy(v()) : out.set(v[0], v[1], v[2]));

export class Cutscene {
  constructor({ camera, ui }) {
    this.camera = camera;
    this.ui = ui;
    this.active = false;
    this.shakeAmount = 0;
  }

  play(steps, { onDone = null, letterbox = true, ctx = {} } = {}) {
    this.ui.stopSay();
    this.steps = steps.map((s) => ({ ...s, fired: false })).sort((a, b) => a.at - b.at);
    this.t = 0;
    this.shot = null;
    this.onDone = onDone;
    this.ctx = ctx;
    this.active = true;
    this.waiting = false;
    this.shakeAmount = 0;
    this.tweens = [];
    this.end = Math.max(...this.steps.map((s) => s.at + (s.cam?.dur || 0)));
    const endStep = this.steps.find((s) => s.end);
    if (endStep) this.end = endStep.at;
    this.ui.cinema(true, letterbox);
  }

  shake(amount) { this.shakeAmount = Math.max(this.shakeAmount, amount); }

  skip() {
    if (!this.active) return;
    // Fire every remaining event so the world ends in the right state.
    for (const s of this.steps) if (!s.fired && s.run && s.critical) { s.fired = true; s.run(this.ctx); }
    this.finish();
  }

  finish() {
    // Run any unfinished tweens to their end state.
    if (this.tweens) { for (const tw of this.tweens) tw(999); this.tweens = []; }
    this.active = false;
    this.waiting = false;
    this.ui.cinema(false);
    this.ui.caption(null);
    const cb = this.onDone;
    this.onDone = null;
    this.steps = [];
    this.shot = null;
    this.ctx = null;
    if (cb) cb();
  }

  cancel() {
    this.active = false;
    this.waiting = false;
    this.steps = [];
    this.tweens = [];
    this.shot = null;
    this.ctx = null;
    this.onDone = null;
    this.ui.cinema(false);
    this.ui.endCard(false);
    this.ui.caption(null);
  }

  update(dt) {
    if (!this.active) return;
    if (!this.waiting) this.t += dt;
    if (this.tweens && this.tweens.length) this.tweens = this.tweens.filter((tw) => !tw(dt));
    for (const s of this.steps) {
      if (this.waiting) break;
      if (s.fired || s.at > this.t) continue;
      s.fired = true;
      if (s.cam) this.shot = { ...s.cam, elapsed: 0 };
      if (s.run) s.run(this.ctx);
      if (s.say) {
        this.t = s.at;
        this.waiting = true;
        this.ui.caption(s.say[0], s.say[1], s.say[2], { onDone: () => {
          this.waiting = false;
          // The old subtitle reading delay is now supplied by the player.
          // Resume at the next beat, without an extra automatic reading wait.
          const next = this.steps.find(step => !step.fired);
          if (next) this.t = next.at;
        } });
      }
    }
    if (this.shot) {
      const sh = this.shot;
      sh.elapsed += dt;
      const k = sh.dur ? ease(Math.min(1, sh.elapsed / sh.dur)) : 1;
      vec(sh.pos, _a);
      vec(sh.toPos || sh.pos, _b);
      _p.lerpVectors(_a, _b, k);
      vec(sh.look, _a);
      vec(sh.toLook || sh.look, _b);
      _l.lerpVectors(_a, _b, k);
      this.camera.position.copy(_p);
      if (this.shakeAmount > 0) {
        this.shakeAmount = Math.max(0, this.shakeAmount - dt * 0.5);
        const s = this.shakeAmount * 0.25;
        this.camera.position.x += (Math.random() - 0.5) * s;
        this.camera.position.y += (Math.random() - 0.5) * s;
      }
      this.camera.lookAt(_l);
      if (sh.fov && Math.abs(this.camera.fov - sh.fov) > 0.01) { this.camera.fov = sh.fov; this.camera.updateProjectionMatrix(); }
    }
    if (!this.waiting && this.t >= this.end) this.finish();
  }
}
