import * as THREE from 'three';
import { LIP_CODES, LIP_CALIB, LIP_LINES } from './visemes.js';
import { voiceKeyFor, isAriKey } from './voice.js';

/**
 * Ari's cinematic close-up + lip-sync (Member 4 integration).
 *
 * CAMERA — whenever an Ari line is actually speaking (and only in gameplay:
 * never during the prologue/epilogue cutscenes, which own their own shots,
 * and never during the era-arrival story beats, which src/core/storyCam.js
 * directs) the gameplay camera eases into a flattering front ¾ close-up at
 * face height, holds while she talks and consecutive Ari lines keep the view,
 * then eases back. The pose it returns to is captured once when the shot is
 * taken and is never overwritten while the shot is held; if the dialogue is
 * already advancing under player control the return instead chases the live
 * gameplay camera so it can never snap. The shot never touches the player
 * transform — it only reads the head anchor and the facing yaw. Candidate
 * angles (¾ first, then profiles) are swept against the walkable meshes and
 * camera colliders with the same technique as player._placeCamera; when
 * every candidate is blocked the shot is given up (gameplay view returns)
 * rather than clipping — a safe fallback, the lip-sync keeps running.
 *
 * LIP-SYNC — driven by the REAL audio playback clock (AudioManager.voiceTime,
 * which subtracts the output latency) against the precomputed viseme
 * timelines in src/core/visemes.js (built off the shipped mp3s by
 * tools/generate-lipsync.py; LIP_CALIB is the browser-decoder onset
 * correction measured by tools/measure-lipsync.mjs). Mouth shapes blend
 * smoothly toward each viseme and close fast when the voice stops, so she is
 * never seen "talking" after the sound ends. This module never estimates
 * timing from word length or speaking rate at runtime.
 */
const CLOSE_FOV = 42;         // close-up field of view
const CLOSE_DIST = 2.1;       // nominal camera distance from the head anchor (eye level; the chibi head itself is ~0.6 m deep)
const MIN_DIST = 1.1;         // closer shots are rejected (face clipping)
const CAM_LIFT = 0.10;        // camera sits slightly above the face target
const FACE_LIFT = -0.12;      // aim below the eye anchor so the whole face sits above the caption box
const ENGAGE_K = 5.0;         // blend rate into the shot (1/s)
const RETURN_K = 6.0;         // blend rate back to gameplay (1/s)
const TAIL = 0.8;             // keep the shot this long after the voice ends
// The weight smoother lags the target by ~1/k (≈35 ms at k=26) — feed the
// timeline this much early so the audible waveform and the visible shape
// peak together (offset measured by the test harness, see the report).
const LIP_LEAD = 0.04;
const ANGLES = [0.5, -0.5, 0, 0.95, -0.95, 1.35, -1.35];
const FACE_OFFSETS = [0, -0.22, 0.22];   // ¾ first, then profiles (rad)

// Viseme → independent replacement-mouth weights: M/B/P pressed, A/AH jaw
// open, E/EE wide, O/OO round, F/V lip-teeth, S/Z teeth close, W/U protrude.
const SHAPES = {
  rest: {},
  aa: { aa: 1.0 },
  e: { aa: 0.35, wide: 0.6 },
  ee: { aa: 0.22, wide: 1.0 },
  o: { aa: 0.7, round: 0.75 },
  oo: { aa: 0.55, round: 1.0 },
  mbp: { teeth: 0.45 },
  fv: { aa: 0.05, teeth: 0.85 },
  sz: { aa: 0.12, wide: 0.35, teeth: 0.15 },
  wu: { aa: 0.3, round: 0.8, protrude: 0.85 },
  n: { aa: 0.22, teeth: 0.15 },
};
const SHAPE_NAMES = ['aa', 'wide', 'round', 'teeth', 'protrude'];

export class Cinematic {
  constructor({ camera, player, audio, dialogue, levels }) {
    this.camera = camera;
    this.player = player;
    this.audio = audio;
    this.dialogue = dialogue;
    this.levels = levels;

    this.f = 0;            // 0 = gameplay view … 1 = close-up
    this.angle = 0;        // sticky candidate angle index
    this.tail = 0;         // holds the shot while the caption lingers after speech
    this.levelRef = null;  // reset state when the era changes

    // Mouth: smoothed weights + per-line timeline cursor.
    this.w = { aa: 0, wide: 0, round: 0, teeth: 0, protrude: 0 };
    this.lip = null;       // the audio.voice record the cursor belongs to
    this.lipIdx = 0;

    // Scratch — the render loop must not allocate.
    this._playPos = new THREE.Vector3();      // saved gameplay pose
    this._playQuat = new THREE.Quaternion();
    this._playFov = 60;
    this._target = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._pos = new THREE.Vector3();          // current close-up pose
    this._quat = new THREE.Quaternion();
    this._havePose = false;
    this._shotDist = CLOSE_DIST;
    this._ray = new THREE.Raycaster();
    this._lookMat = new THREE.Matrix4();
    this._up = new THREE.Vector3(0, 1, 0);
    this._hits = [];
    this._box = new THREE.Box3();
    this._hit = new THREE.Vector3();
    this._faceRight = new THREE.Vector3();
    this._rayOrigin = new THREE.Vector3();
  }

  get engaged() { return this.f > 0.5; }

  /**
   * Called every frame from the render loop, after the player/cutscene/level
   * camera updates. `mode` is the game state (playing | cutscene | title | …).
   */
  update(dt, mode) {
    this._driveFace(dt);

    // The era-arrival story beats are directed by src/core/storyCam.js — the
    // gameplay close-up yields so the two camera systems never fight.
    if (mode !== 'playing' || this.levels.state === 'arrival') { this._clear(); return; }
    if (this.levelRef !== this.levels.level) { this.levelRef = this.levels.level; this._clear(); }

    const key = voiceKeyFor(this.dialogue.current);
    const spoken = isAriKey(key) && this.audio.voice?.name === key;
    if (spoken) this.tail = TAIL;
    else this.tail = Math.max(0, this.tail - dt);
    // The finale drives its own camera — never take it over.
    const want = isAriKey(key) && this.levels.state !== 'finale' && (spoken || this.tail > 0);

    // Where her face is right now (the rig never moves while a shot is held;
    // the anchor follows the idle animation, which reads as subtle life).
    // Aim at the face surface (in front of the head axis) so it centres in
    // frame even from the ¾ angles.
    this.player.head.getWorldPosition(this._target);
    this._target.x += Math.sin(this.player.facing) * 0.28;
    this._target.z += Math.cos(this.player.facing) * 0.28;
    this._target.y += FACE_LIFT;

    if (this.f === 0 && want) {
      // Take the shot: freeze the gameplay pose to return to (never written
      // again while held) and pick the least-cluttered candidate angle.
      this._playPos.copy(this.camera.position);
      this._playQuat.copy(this.camera.quaternion);
      this._playFov = this.camera.fov;
      this.angle = this._pickAngle();
      this._havePose = false;
    }

    if (want) this._solvePose();
    const desired = want && this._havePose ? 1 : 0;
    const k = desired > this.f ? ENGAGE_K : RETURN_K;
    this.f += (desired - this.f) * (1 - Math.exp(-k * dt));
    if (this.f > 0.999) this.f = 1;
    if (this.f < 0.004) {
      this.f = 0;
      if (desired === 0) this._havePose = false;
      if (!want) return;
    }
    if (this.f === 0 || !this._havePose) return;

    // Player control is back while the shot still eases out: chase the live
    // gameplay camera so the return cannot snap if the player already moved.
    if (!want && !this.dialogue.active) {
      this._playPos.copy(this.camera.position);
      this._playQuat.copy(this.camera.quaternion);
      this._playFov = this.camera.fov;
    }

    const e = this.f * this.f * (3 - 2 * this.f);   // smoothstep both ways
    if (want) {
      // A close-up must show Ari: first-person hides the rig, a jammed
      // third-person camera fades the body — both are overridden while held.
      this.player.rig.visible = true;
      this.player.hero.group.visible = true;
    }
    this.camera.position.lerpVectors(this._playPos, this._pos, e);
    this.camera.quaternion.slerpQuaternions(this._playQuat, this._quat, e);
    // Increase FOV if a nearby wall forced a tighter camera placement, so
    // the nose is not cropped by the camera while the wall stays outside it.
    const safeFov = Math.min(64, Math.max(CLOSE_FOV, CLOSE_FOV * 1.65 / this._shotDist));
    const fov = this._playFov + (safeFov - this._playFov) * e;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  _clear() { this.f = 0; this.tail = 0; this.angle = 0; this._havePose = false; }

  /* --------------------------- close-up pose --------------------------- */

  /** Pick the candidate angle with the most clearance at engagement. */
  _pickAngle() {
    let best = 0;
    let bestD = -1;
    for (let i = 0; i < ANGLES.length; i++) {
      const d = this._clearance(i);
      if (d > bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /** Fill this._pos/_quat for the current frame; true once a pose is valid. */
  _solvePose() {
    for (let attempt = 0; attempt < ANGLES.length; attempt++) {
      const idx = attempt === 0 ? this.angle : (this.angle + attempt) % ANGLES.length;
      const d = this._clearance(idx);
      if (d >= MIN_DIST) {
        this.angle = idx;
        this._compose(d);
        return true;
      }
    }
    // Never reuse a now-obstructed close-up pose; it can put a wall between
    // Ari and the camera if the level's geometry changes during speech.
    this._havePose = false;
    return false;
  }

  _compose(dist) {
    this._pos.copy(this._target).addScaledVector(this._dir, dist);
    this._shotDist = dist;
    this._lookMat.lookAt(this._pos, this._target, this._up);
    this._quat.setFromRotationMatrix(this._lookMat);
    this._havePose = true;
  }

  /** Sweep a *thick* face-to-camera corridor, not just one centre ray.
   * A centre-only test can pass a camera whose frame is partly behind a wall.
   * Sample the central ray and both sides of the visible face. Candidate
   * angles that cannot frame an unobstructed face are rejected. */
  _clearance(idx) {
    const a = ANGLES[idx];
    const fx = Math.sin(this.player.facing);
    const fz = Math.cos(this.player.facing);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const dx = fx * ca + fz * sa;
    const dz = -fx * sa + fz * ca;
    this._dir.set(dx * CLOSE_DIST, CAM_LIFT, dz * CLOSE_DIST);
    const full = this._dir.length();
    this._dir.divideScalar(full);
    this._faceRight.set(-this._dir.z, 0, this._dir.x).normalize();
    let clearance = full;
    // Side samples ensure an architectural edge does not cover the mouth,
    // cheek or one half of Ari's face even if the centre ray is clear.
    for (const offset of FACE_OFFSETS) {
      this._rayOrigin.copy(this._target).addScaledVector(this._faceRight, offset);
      clearance = Math.min(clearance, this._sweepFrom(this._rayOrigin, full));
      if (clearance < MIN_DIST) break;
    }
    return clearance;
  }

  _sweepFrom(origin, full) {
    this._ray.set(origin, this._dir);
    this._ray.far = full;
    let safe = full;
    this._hits.length = 0;
    const h = this._ray.intersectObjects(this.player.walkables, false, this._hits)[0];
    if (h) safe = Math.min(safe, Math.max(0.05, h.distance - 0.24));
    for (const obj of this.player.cameraColliders) {
      const box = obj.userData.solidBox;
      if (!box) continue;
      this._box.copy(box).expandByScalar(0.22);
      // A broad gameplay AABB can enclose the face. If it does, use its
      // unexpanded extent; the camera must remain before the exit face.
      if (this._box.containsPoint(origin)) this._box.copy(box);
      if (this._ray.ray.intersectBox(this._box, this._hit)) {
        safe = Math.min(safe, Math.max(0.05, this._hit.distanceTo(origin) - 0.12));
      }
    }
    return safe;
  }

  /* ------------------------------ lip-sync ------------------------------ */

  _driveFace(dt) {
    const face = this.player.hero.face;
    if (!face) return;
    const v = this.audio.voice;
    let code = null;
    let amp = 1;
    if (v && isAriKey(v.name)) {
      const line = LIP_LINES[v.name];
      if (line) {
        const ms = (this.audio.voiceTime() - LIP_CALIB + LIP_LEAD) * 1000;
        if (ms >= 0) {
          const t = line.t;
          if (this.lip !== v) { this.lip = v; this.lipIdx = 0; }
          let i = this.lipIdx;
          while (i + 3 < t.length && t[i + 3] <= ms) i += 3;
          this.lipIdx = i;
          if (t[i] <= ms) { code = LIP_CODES[t[i + 1]]; amp = t[i + 2]; }
        }
      }
    }
    const shape = (code && SHAPES[code]) || SHAPES.rest;
    const k = 1 - Math.exp(-(code ? 26 : 34) * dt);
    const w = this.w;
    for (let i = 0; i < SHAPE_NAMES.length; i++) {
      const name = SHAPE_NAMES[i];
      const to = (shape[name] || 0) * amp;
      w[name] += (to - w[name]) * k;
    }
    const open = Math.max(0, Math.min(1,
      w.aa + 0.4 * w.round + 0.3 * w.wide - 0.85 * w.teeth + 0.35 * w.protrude));
    face.setMouth(w, open);
  }
}
