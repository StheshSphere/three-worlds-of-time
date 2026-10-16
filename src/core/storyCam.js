import * as THREE from 'three';

/**
 * Camera director for the era-arrival story beats: the two lines in
 * story.ARRIVALS that play before Levels 2 and 3 start (run by levelManager
 * in state 'arrival'). It owns the gameplay camera for the length of the
 * dialogue — cinematic.js yields to it for that window — and hands the view
 * back to the live gameplay camera when the lines are done.
 *
 * Shot grammar (the same every era, computed from the live pose when each
 * line starts, so nothing here depends on level geometry):
 *   line 1  wide ¾ front dollying in from the environment to a medium shot
 *   line 2  front ¾ close-up; after a beat a hard cut to a look at the
 *           landmark she just named (story.ARRIVAL_AIM — the vault, the
 *           spire), held while the voice finishes; without an aim the look
 *           follows her gaze.
 * Shots follow the captions (the era card and each line are dialogue
 * entries); the dialogue, voice and their timing are never touched.
 */

const UP = new THREE.Vector3(0, 1, 0);
const FACE_Y = 1.46;        // face aim height (head anchor 1.58 − 0.12, as cinematic.js)
const WIDE_D = 4.4;         // line 1: establishing distance
const MED_D = 2.75;         // line 1: dollying in to here
const WIDE_LIFT = 0.45;     // wide shots sit a little above the face …
const MED_LIFT = 0.14;      // … and settle to eye level
const LINE1_DUR = 3.4;      // the dolly-in
const LINE1_ANG = -0.55;    // radians off her gaze (¾ views)
const CLOSE_D = 2.15;       // line 2: close-up distance
const CLOSE_LIFT = 0.12;
const LINE2_ANG = 0.5;
const LINE2_DUR = 3.0;
const CUT_AFTER = 2.4;      // seconds into line 2 before the reveal cut
const OUTRO = 0.9;          // seconds to hand the view back
const MIN_D = 1.45;         // the camera never comes closer than this
const PAD = 0.2;            // clearance kept from walls and props

const ease = (k) => k * k * (3 - 2 * k);

export class StoryCam {
  constructor({ camera, player, levels, ui }) {
    this.camera = camera;
    this.player = player;
    this.levels = levels;
    this.ui = ui;

    this.active = false;
    this.phase = 'shots';      // shots | outro
    this.entry = null;         // dialogue entry the current shot belongs to
    this.line = -1;            // 0 = first caption of this arrival, 1 = second
    this.shot = null;
    this.cut = null;           // { left } — pending mid-line reveal cut
    this.aim = null;           // world point the reveal beat looks at
    this.o = 0;                // outro blend 0 → 1

    // Scratch — the render loop must not allocate.
    this._head = new THREE.Vector3();
    this._gaze = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._face = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._hit = new THREE.Vector3();
    this._box = new THREE.Box3();
    this._hits = [];
    this._ray = new THREE.Raycaster();
    this._lookMat = new THREE.Matrix4();
    this._shotPos = new THREE.Vector3();       // last directed pose (outro origin)
    this._shotQuat = new THREE.Quaternion();
    this._livePos = new THREE.Vector3();
    this._liveQuat = new THREE.Quaternion();
  }

  /** Begin directing the arrival beats (called together with the ARRIVALS
   *  lines). `aim` is an optional [x, y, z] world point the reveal looks at. */
  play(aim = null) {
    this.active = true;
    this.phase = 'shots';
    this.entry = null;
    this.line = -1;
    this.shot = null;
    this.cut = null;
    this.aim = aim ? [aim[0], aim[1], aim[2]] : null;
    this.o = 0;
  }

  /** Drop any direction immediately (restarts, title…); the camera stays put. */
  cancel() {
    this.active = false;
    this.phase = 'shots';
    this.entry = null;
    this.line = -1;
    this.shot = null;
    this.cut = null;
    this.aim = null;
  }

  /** Called every frame after cinematic.update; last writer owns the camera. */
  update(dt) {
    if (!this.active) return;

    if (this.phase === 'shots') {
      const dialogue = this.ui.dialogue;
      const cur = dialogue.current;
      // Seize each caption as it comes up — the era card is left to the game view.
      if (cur && cur.view === 'caption' && cur !== this.entry) {
        this.entry = cur;
        this.line += 1;
        this.shot = this.line === 0 ? this._line1() : this._line2();
        this.cut = this.line === 1 ? { left: CUT_AFTER } : null;
      }
      if (this.line < 0) return;   // still on the era card — nothing to do yet
      if (this.levels.state !== 'arrival' || !dialogue.active) { this._beginOutro(); return; }
      if (this.cut) {
        this.cut.left -= dt;
        if (this.cut.left <= 0) { this.cut = null; this.shot = this._reveal(); }
      }
      this._writeShot(dt);
      return;
    }

    // Outro: blend the directed view back onto the live gameplay camera.
    this.o = Math.min(1, this.o + dt / OUTRO);
    const e = ease(this.o);
    this._livePos.copy(this.camera.position);
    this._liveQuat.copy(this.camera.quaternion);
    this.camera.position.lerpVectors(this._shotPos, this._livePos, e);
    this.camera.quaternion.slerpQuaternions(this._shotQuat, this._liveQuat, e);
    if (this.o >= 1) this.active = false;
  }

  /* ------------------------------- shots ------------------------------- */

  /** Read the live frame: head anchor, gaze and right on the ground plane. */
  _frame() {
    this.player.head.getWorldPosition(this._head);
    this._gaze.set(Math.sin(this.player.facing), 0, Math.cos(this.player.facing));
    this._right.set(-this._gaze.z, 0, this._gaze.x);
    this._face.copy(this._head).addScaledVector(this._gaze, 0.28).setY(FACE_Y);
  }

  /** Wide ¾ front, dollying in to a medium shot as she speaks. */
  _line1() {
    this._frame();
    return {
      pos: this._place(LINE1_ANG, WIDE_D, WIDE_LIFT),
      toPos: this._place(LINE1_ANG, MED_D, MED_LIFT),
      look: [this._face.x, FACE_Y, this._face.z],
      dur: LINE1_DUR,
    };
  }

  /** Front ¾ close-up with a slow push. */
  _line2() {
    this._frame();
    return {
      pos: this._place(LINE2_ANG, CLOSE_D, CLOSE_LIFT),
      toPos: this._place(LINE2_ANG, CLOSE_D - 0.12, CLOSE_LIFT),
      look: [this._face.x, FACE_Y, this._face.z],
      dur: LINE2_DUR,
    };
  }

  /** Reveal beat: from over her shoulder, the landmark she names (or, with no
   *  aim, wherever her gaze points), holding while the voice continues. */
  _reveal() {
    this._frame();
    this._a.set(
      -this._gaze.x * 2.1 + this._right.x * 0.95,
      1.5,
      -this._gaze.z * 2.1 + this._right.z * 0.95,
    );
    const full = this._a.length();
    this._b.copy(this._a).divideScalar(full);
    const want = Math.max(1.2, this._sweep(this._head, this._b, full));
    this._pos.copy(this._head).addScaledVector(this._b, want);
    return {
      pos: [this._pos.x, this._pos.y, this._pos.z],
      toPos: [this._pos.x, this._pos.y + 0.22, this._pos.z],   // gentle crane
      look: this.aim ? [...this.aim]
        : [this._head.x + this._gaze.x * 12, this._head.y - 0.5, this._head.z + this._gaze.z * 12],
      dur: 3.2,
    };
  }

  /** Camera spot at `ang` off her gaze, `dist` out and `lift` up — swept
   *  against the walkable meshes and camera colliders (as cinematic.js does),
   *  so an intro shot never sits in a wall. Returns a [x, y, z] array. */
  _place(ang, dist, lift) {
    this._dir.copy(this._gaze).applyAxisAngle(UP, ang);
    this._a.copy(this._dir).multiplyScalar(dist).setY(lift);
    const full = this._a.length();
    this._b.copy(this._a).divideScalar(full);
    const want = Math.max(MIN_D, this._sweep(this._face, this._b, full));
    this._pos.copy(this._face).addScaledVector(this._b, want);
    return [this._pos.x, this._pos.y, this._pos.z];
  }

  /** How far along `unit` (from `origin`) the camera can sit before hitting
   *  geometry: the same walkables + AABB sweep the cinematic close-up uses. */
  _sweep(origin, unit, full) {
    this._ray.set(origin, unit);
    this._ray.far = full;
    let want = full;
    this._hits.length = 0;
    const h = this._ray.intersectObjects(this.player.walkables, false, this._hits)[0];
    if (h) want = Math.min(want, Math.max(0.05, h.distance - PAD));
    for (const obj of this.player.cameraColliders) {
      const box = obj.userData.solidBox;
      if (!box) continue;
      this._box.copy(box).expandByScalar(PAD);
      if (this._box.containsPoint(origin)) this._box.copy(box);
      if (this._ray.ray.intersectBox(this._box, this._hit)) {
        want = Math.min(want, Math.max(0.05, this._hit.distanceTo(origin) - 0.05));
      }
    }
    return Math.min(want, full);
  }

  _writeShot(dt) {
    const sh = this.shot;
    sh.elapsed = (sh.elapsed || 0) + dt;
    const k = sh.dur ? ease(Math.min(1, sh.elapsed / sh.dur)) : 1;
    this._a.set(sh.pos[0], sh.pos[1], sh.pos[2]);
    this._b.set(sh.toPos[0], sh.toPos[1], sh.toPos[2]);
    this._pos.lerpVectors(this._a, this._b, k);
    this._look.set(sh.look[0], sh.look[1], sh.look[2]);
    this._lookMat.lookAt(this._pos, this._look, UP);
    this.camera.position.copy(this._pos);
    this.camera.quaternion.setFromRotationMatrix(this._lookMat);
    this._shotPos.copy(this._pos);
    this._shotQuat.copy(this.camera.quaternion);
  }

  _beginOutro() {
    this.phase = 'outro';
    this.o = 0;
    // _shotPos/_shotQuat hold the last directed frame; the live gameplay
    // camera for this frame was already written by the player/level updates.
  }
}
