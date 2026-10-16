import * as THREE from 'three';
import { createHero } from './character.js';
import { settings } from './core/settings.js';
import { InteractionSelector, interactionPoint, interactionReachable, clueInZone, nearestAvailableClue } from './core/interaction.js';

const GRAVITY = 24;
const WALK_SPEED = 4.6;
const SPRINT_SPEED = 8.2;
const JUMP_SPEED = 8.7;
// The Future has exactly two forward jumps: W/up + Space = normal,
// Shift + W/up + Space = a much longer leap. No dash is required.
// All other eras retain their original movement physics.
const FUTURE_LEAP_JUMP_SPEED = 11.1;
const FUTURE_LEAP_FORWARD_SPEED = 13.0;
const FUTURE_NORMAL_JUMP_FORWARD_SPEED = 6.4;
const FUTURE_LEAP_AIR_STEER = 2.5;
const ACCEL_GROUND = 16;
const ACCEL_AIR = 5;
const EYE_HEIGHT = 1.58;
const RIG_HEIGHT = 1.75;
const RIG_RADIUS = 0.34;
const STEP_UP = 0.5;          // ledges lower than this are climbed, not blocked
const COYOTE_TIME = 0.12;     // you may still jump this long after walking off a ledge
const JUMP_BUFFER = 0.12;     // standard jump buffer
const FUTURE_JUMP_BUFFER = 0.24; // catch a single Space tap on a slow frame
const FUTURE_COYOTE_TIME = 0.38; // jump just after walking off a platform edge
const DASH_SPEED = 19;
const DASH_TIME = 0.2;
const DASH_COOLDOWN = 1.0;
const TP_DISTANCE = 4.4;
const TP_HEIGHT = 0.55;
const TP_SHOULDER = 0.6;
const KEYBOARD_TURN_SPEED = 1.9;  // Arrow keys rotate while flashlight is owned; A/D still strafe
const MOVEMENT_CODES = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
const KEY_FALLBACKS = {
  w: 'KeyW', W: 'KeyW', s: 'KeyS', S: 'KeyS', a: 'KeyA', A: 'KeyA', d: 'KeyD', D: 'KeyD',
  ' ': 'Space', Spacebar: 'Space', Shift: 'ShiftLeft',
  Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight',
};
const LEGACY_KEY_CODES = { 16: 'ShiftLeft', 32: 'Space', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown', 65: 'KeyA', 68: 'KeyD', 83: 'KeyS', 87: 'KeyW' };

// Scratch objects reused every frame — never allocate inside the loop (brief §6.1).
const _origin = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _look = new THREE.Vector3();
const _head = new THREE.Vector3();
const _target = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _prev = new THREE.Vector3();
const _cameraBox = new THREE.Box3();
const _cameraHit = new THREE.Vector3();
const _cameraPath = new THREE.Vector3();

/**
 * Player controller: mouse-look, movement physics, collisions, camera rig,
 * interaction raycast, abilities. Everything is camera-relative: W walks
 * toward where the camera looks, in either view mode.
 *
 * Physics model (simple, predictable, cheap):
 *  - gravity + jump on the Y axis, with coyote time and jump buffering so
 *    jumps feel fair,
 *  - horizontal velocity eases toward the input direction (acceleration),
 *    so starts/stops feel weighty rather than robotic,
 *  - the ground is found by a short raycast straight down against the
 *    level's walkable meshes; small steps are climbed automatically,
 *  - walls are axis-aligned boxes: the body is a circle in XZ that is
 *    pushed out of the nearest face (circle-vs-box).
 *  - moving platforms publish userData.carryDelta; standing on one adds it.
 */
export class Player extends THREE.EventDispatcher {
  constructor(camera, domElement) {
    super();
    this.camera = camera;
    this.dom = domElement;
    this.mode = settings.get('thirdPerson') ? 'third' : 'first';
    this.isLocked = false;
    this.inputEnabled = true;
    this.frozen = false;

    this.rig = new THREE.Group();
    this.rig.name = 'PlayerRig';
    this.hero = createHero();
    this.rig.add(this.hero.group);
    this.head = new THREE.Object3D();
    this.head.position.y = EYE_HEIGHT;
    this.rig.add(this.head);

    // World-space effects owned by the player (flashlight) — added to the scene by main.js.
    this.worldFx = new THREE.Group();
    this.worldFx.name = 'PlayerFx';

    this.yaw = 0;
    this.pitch = -0.12;
    this.facing = 0;
    this.spawn = new THREE.Vector3(0, 0, 12);
    this.spawnYaw = 0;
    // Reusable checkpoint (see the checkpoint API block below setCheckpoint).
    this.checkpoint = new THREE.Vector3();
    this.checkpointYaw = 0;
    this.hasCheckpoint = false;
    this.velocity = new THREE.Vector3();
    this.onGround = false;
    this.groundObject = null;
    this.colliders = [];
    this.cameraColliders = [];
    this.walkables = [];
    this.interactables = [];
    this.nearbyInteractable = null;
    this.interaction = new InteractionSelector();
    this.bounds = 120;
    this.killY = -14;
    this.defaultSurface = 'stone';

    this.keys = { forward: false, back: false, left: false, right: false, turnLeft: false, turnRight: false, sprint: false, jump: false };
    this._heldMovementCodes = new Set(); // each physical alias has its own held state
    this._coyote = 0;
    this._jumpBuffer = 0;
    this._queuedFutureJump = null; // snapshot combo at Space KEYDOWN, not at a later physics frame
    this._stepDist = 0;
    this._fallSpeed = 0;
    this._fell = false;
    this._pushTimer = 0;
    this._pushCooldown = 0;
    this._pushTarget = null;
    this._invuln = 0;
    this.canDash = false;
    this.canSprintLeap = false;
    this._sprintLeap = false;
    this._forwardJump = false;
    this._sprintLeapDir = new THREE.Vector3();
    this._dashTime = 0;
    this._dashCooldown = 0;
    this._airDashUsed = false;
    this._dashDir = new THREE.Vector3();
    this._camDist = TP_DISTANCE;
    this._shake = 0;
    this._fovKick = 0;
    this._bob = 0;
    this.speed = 0;

    this.flashlight = null;
    this.flashlightOn = false;

    this._groundRay = new THREE.Raycaster();
    this._camRay = new THREE.Raycaster();
    this._groundHits = [];
    this._cameraHits = [];

    this._bindInput();
  }

  get object() { return this.rig; }
  get position() { return this.rig.position; }
  get dashReady() { return this.canDash ? 1 - this._dashCooldown / DASH_COOLDOWN : 0; }
  get isDashing() { return this._dashTime > 0; }

  /* ----------------------------- input ------------------------------ */
  lock() {
    if (this.isLocked) return;
    try {
      const request = this.dom.requestPointerLock();
      request?.catch(() => this.dispatchEvent({ type: 'lockerror' }));
    } catch { this.dispatchEvent({ type: 'lockerror' }); }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  _bindInput() {
    document.addEventListener('pointerlockerror', () => this.dispatchEvent({ type: 'lockerror' }));
    window.addEventListener('blur', () => this._clearKeys());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this._clearKeys(); });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.dom;
      if (locked === this.isLocked) return;
      this.isLocked = locked;
      if (!locked) this._clearKeys();
      this.dispatchEvent({ type: locked ? 'lock' : 'unlock' });
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked || !this.inputEnabled || this.frozen) return;
      const s = 0.0022 * settings.get('sensitivity');
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s * (settings.get('invertY') ? -1 : 1);
      const lo = this.mode === 'third' ? -0.95 : -1.45;
      const hi = this.mode === 'third' ? 0.9 : 1.45;
      this.pitch = THREE.MathUtils.clamp(this.pitch, lo, hi);
    });
    this.dom.addEventListener('mousedown', (e) => {
      if (!this.isLocked || !this.inputEnabled || this.frozen) return;
      if (e.button === 0) this.tryInteract();
      // Right click is no longer a required gameplay action.
    });
    this.dom.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    // Compatibility path for a Space press reported without a usable
    // keydown. The held-state guard still allows only one launch per tap.
    window.addEventListener('keypress', (e) => {
      if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar' || e.keyCode === 32) this._key(e, true);
    });
  }

  _clearKeys() {
    for (const k in this.keys) this.keys[k] = false;
    this._heldMovementCodes.clear();
    this._jumpBuffer = 0;
    this._queuedFutureJump = null;
    this._pushTimer = 0;
    this._pushTarget = null;
  }

  _key(e, down) {
    if (!this.isLocked || !this.inputEnabled || this.frozen) { this._clearKeys(); return; }
    // Normalize before suppressing browser scrolling. Some keyboard/browser
    // events provide only key or the legacy keyCode, including Shift+Up+Space.
    const code = e.code && e.code !== 'Unidentified' ? e.code
      : KEY_FALLBACKS[e.key] || LEGACY_KEY_CODES[e.keyCode || e.which] || e.key;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) e.preventDefault();
    this._key2(code, down, e.repeat, e.shiftKey);
  }

  _key2(code, down, repeat = false, shiftHeld = false) {
    if (MOVEMENT_CODES.has(code)) {
      const held = this._heldMovementCodes;
      if (down) held.add(code); else held.delete(code);
      // Releasing W must not cancel Up (nor one Shift cancel the other).
      this.keys.forward = held.has('KeyW') || held.has('ArrowUp');
      this.keys.back = held.has('KeyS') || held.has('ArrowDown');
      this.keys.left = held.has('KeyA') || (!this.flashlightOwned && held.has('ArrowLeft'));
      this.keys.right = held.has('KeyD') || (!this.flashlightOwned && held.has('ArrowRight'));
      this.keys.turnLeft = !!this.flashlightOwned && held.has('ArrowLeft');
      this.keys.turnRight = !!this.flashlightOwned && held.has('ArrowRight');
      this.keys.sprint = held.has('ShiftLeft') || held.has('ShiftRight');
      return;
    }
    switch (code) {
      case 'Space': {
        const wasDown = this.keys.jump;
        this.keys.jump = down;
        // Hold Shift + W/Up and TAP Space. Normally launch on keydown;
        // releasing Space immediately must not cancel or shorten the leap.
        // If only Space's keyup arrives, recover that tap while BOTH other
        // keys are STILL held. Never infer either key from a recent release,
        // and never use this recovery to queue another jump in mid-air.
        const recoverTap = !down && !wasDown && this.canSprintLeap
          && this.keys.forward && !this.keys.back && (this.keys.sprint || shiftHeld)
          && (this.onGround || this._coyote > 0) && this._jumpBuffer <= 0;
        // The first delivered DOWN may be labelled repeat after a missed
        // event. Launch once per press, never on subsequent auto-repeats.
        if ((down && !wasDown) || recoverTap) {
          const forward = this.keys.forward && !this.keys.back;
          const shift = this.keys.sprint || shiftHeld;
          this._jumpBuffer = this.canSprintLeap ? FUTURE_JUMP_BUFFER : JUMP_BUFFER;
          this._queuedFutureJump = this.canSprintLeap ? {
            forward, big: forward && shift,
          } : null;
          this._attemptBufferedJump();
        }
        // Both Future jump types have full height on a single Space tap;
        // other eras keep the original variable-height jump.
        if (!down && wasDown && this.velocity.y > 3 && !this._forwardJump) this.velocity.y *= 0.55;
        break;
      }
      case 'KeyE': if (down && !repeat) this.tryInteract(); break;
      case 'KeyQ': break; // No Q control: Future movement uses only forward + Space (+ Shift).
      case 'KeyV': case 'KeyC':
        if (down && !repeat) {
          this.mode = this.mode === 'first' ? 'third' : 'first';
          this.pitch = THREE.MathUtils.clamp(this.pitch, this.mode === 'third' ? -0.95 : -1.45, this.mode === 'third' ? 0.9 : 1.45);
          this.dispatchEvent({ type: 'view', mode: this.mode });
        }
        break;
      case 'KeyF': if (down && !repeat && this.flashlightOwned) this.setFlashlight(!this.flashlightOn); break;
      default: break;
    }
  }

  /* ----------------------------- actions ---------------------------- */
  tryInteract() {
    if (this.frozen || !this.inputEnabled) return;
    // Revalidate at key-down: an item may have moved, vanished, or become
    // unavailable since the last rendered prompt.
    this._updateFlashlight();
    this._updateInteraction();
    // Redundant pickup path on purpose: E uses the physical clue circle
    // DIRECTLY, even if a raycast/control or a skipped frame changed the
    // selector. This is the same resolver used by the visible prompt.
    const obj = nearestAvailableClue(this) || this.nearbyInteractable;
    if (!obj || !obj.userData.onInteract) return;
    const r = obj.userData.onInteract(obj);
    this.hero.play(r === 'pickup' ? 'pickup' : 'interact', { speed: 1.7 });
    this.dispatchEvent({ type: 'interact', object: obj, result: r });
    this._updateInteraction();
  }

  tryDash() {
    if (!this.canDash || this._dashCooldown > 0 || this.frozen) return;
    if (!this.onGround && this._airDashUsed) return;
    if (!this.onGround) this._airDashUsed = true;
    this._dashFromInput();
    this._dashTime = DASH_TIME;
    this._dashCooldown = DASH_COOLDOWN;
    this._fovKick = 12;
    this.hero.play('dash', { speed: 2.2 });
    this.hero.setDashGlow();
    this.dispatchEvent({ type: 'dash' });
  }

  _dashFromInput() {
    this._basis();
    const z = Number(this.keys.forward) - Number(this.keys.back);
    const x = Number(this.keys.right) - Number(this.keys.left);
    this._dashDir.set(0, 0, 0).addScaledVector(_fwd, z || (x ? 0 : 1)).addScaledVector(_right, x).normalize();
  }

  /** Knock the player back; respawn=true sends them to the last checkpoint. */
  hurt({ from = null, power = 9, respawn = false, reason = '' } = {}) {
    if (this._invuln > 0 || this.frozen) return false;
    this._invuln = 1.1;
    if (from) {
      _move.subVectors(this.rig.position, from).setY(0);
      if (_move.lengthSq() < 1e-4) _move.set(Math.sin(this.facing), 0, Math.cos(this.facing)).negate();
      _move.normalize();
      this.velocity.x = _move.x * power;
      this.velocity.z = _move.z * power;
      this.velocity.y = 5;
      this.onGround = false;
    }
    this._shake = 0.35;
    this.hero.play('hit', { speed: 1.4 });
    this.dispatchEvent({ type: 'hurt', respawn, reason });
    return true;
  }

  /* ----------------------------- level hooks ------------------------ */
  setLevel({ colliders = [], cameraColliders = colliders, walkables = [], interactables = [], spawn, spawnYaw = 0, bounds = 120, killY = -14, surface = 'stone' }) {
    this.colliders = colliders;
    this.cameraColliders = cameraColliders;
    this.walkables = walkables;
    this.interactables = interactables;
    if (spawn) this.spawn.copy(spawn);
    this.spawnYaw = spawnYaw;
    this.bounds = bounds;
    this.killY = killY;
    this.defaultSurface = surface;
    this.canDash = false;
    this.canSprintLeap = false;
    this._sprintLeap = false;
    this._forwardJump = false;
    this.clearCheckpoint();       // each era starts from its own spawn
    this.clearAttachments();
    this.reset();
  }

  /* --------------------------- checkpoints ---------------------------
   * REUSABLE CHECKPOINT API (Member 2) — shared by every era. Levels and
   * tests use these three methods (or the api.checkpoint(pos, yaw, label?)
   * wrapper in levelManager, which adds a HUD message + sound) without
   * needing to modify this file:
   *
   *   setCheckpoint(position, yaw?)   remember a respawn point (a
   *                                   THREE.Vector3 and a facing yaw;
   *                                   yaw defaults to the current facing)
   *   getCheckpoint()                 → { position, yaw } or null
   *                                   (position is the live vector —
   *                                   copy it if you need to keep it)
   *   clearCheckpoint()               forget it — respawn falls back to
   *                                   the current level's spawn
   *
   * Behaviour (identical to pre-API play when no checkpoint is set):
   *  - reset() — used by fall respawn and hurt respawn — returns to the
   *    checkpoint when one is set, otherwise to the level's spawn,
   *    exactly as before this API existed;
   *  - loading ANY level (new era, "Restart this era", "Restart journey",
   *    title screen) clears the checkpoint, so a full Restart always
   *    respawns at the original Ancient spawn;
   *  - checkpoints therefore never survive a level change — each era
   *    arms its own as the player reaches it.
   * ------------------------------------------------------------------- */
  setCheckpoint(pos, yaw) {
    this.checkpoint.copy(pos);
    this.checkpointYaw = yaw !== undefined ? yaw : this.yaw;
    this.hasCheckpoint = true;
  }

  getCheckpoint() {
    return this.hasCheckpoint ? { position: this.checkpoint, yaw: this.checkpointYaw } : null;
  }

  clearCheckpoint() {
    this.hasCheckpoint = false;
  }

  reset() {
    this._clearKeys();
    this._coyote = 0;
    this._dashCooldown = 0;
    this._airDashUsed = false;
    this._sprintLeap = false;
    this._forwardJump = false;
    this._sprintLeapDir.set(0, 0, 0);
    this._pushCooldown = 0;
    this._stepDist = 0;
    this._fallSpeed = 0;
    this._shake = 0;
    this._fovKick = 0;
    this._camDist = TP_DISTANCE;
    this.speed = 0;
    this.nearbyInteractable = null;
    this.interaction.clear();
    if (this.hasCheckpoint) {
      this.rig.position.copy(this.checkpoint);
      this.yaw = this.checkpointYaw;
    } else {
      this.rig.position.copy(this.spawn);
      this.yaw = this.spawnYaw;
    }
    this.facing = this.yaw + Math.PI;
    this.pitch = -0.12;
    this.velocity.set(0, 0, 0);
    this.onGround = false;
    this.groundObject = null;
    this._fell = false;
    this._dashTime = 0;
    this._invuln = 0.5;
    this.hero.reset();
  }

  /** Lab grants a flashlight: a shadow-casting spotlight that follows the look direction. */
  prepareFlashlight() {
    if (this.flashlight) return;
    const spot = new THREE.SpotLight(0xfff1d6, 0, 28, Math.PI / 6.5, 0.45, 1.4);
    spot.castShadow = settings.quality().shadows;
    spot.shadow.mapSize.set(512, 512);
    spot.shadow.camera.near = 0.3;
    spot.shadow.bias = -0.0015;
    this.worldFx.add(spot, spot.target);
    this.flashlight = spot;
    this.flashlightOwned = false;
  }

  addFlashlight() {
    this.prepareFlashlight();
    this._clearKeys(); // arrows change from movement to aiming once the tool is owned
    this.flashlightOwned = true;
    this.setFlashlight(true);
  }

  setFlashlight(on) {
    if (!this.flashlight || !this.flashlightOwned) return;
    this.flashlightOn = on;
    this.flashlight.intensity = on ? 70 : 0;
    this.dispatchEvent({ type: 'flashlight', on });
  }

  clearAttachments() {
    if (this.flashlight) {
      this.worldFx.remove(this.flashlight, this.flashlight.target);
      this.flashlight.dispose();
      this.flashlight = null;
      this.flashlightOwned = false;
      this.flashlightOn = false;
    }
  }

  shake(amount) { this._shake = Math.max(this._shake, amount); }

  /* ----------------------------- physics ---------------------------- */
  _basis() {
    _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(-_fwd.z, 0, _fwd.x);
  }

  _resolveCollisions(dt) {
    const p = this.rig.position;
    let pushed = null;
    let pushNX = 0, pushNZ = 0;
    for (const obj of this.colliders) {
      const box = obj.userData.solidBox;
      if (!box) continue;
      if (p.y + RIG_HEIGHT <= box.min.y || p.y + STEP_UP >= box.max.y) continue;
      const cx = THREE.MathUtils.clamp(p.x, box.min.x, box.max.x);
      const cz = THREE.MathUtils.clamp(p.z, box.min.z, box.max.z);
      const dx = p.x - cx;
      const dz = p.z - cz;
      const distSq = dx * dx + dz * dz;
      if (distSq >= RIG_RADIUS * RIG_RADIUS) continue;
      let nx;
      let nz;
      if (distSq > 1e-6) {
        const dist = Math.sqrt(distSq);
        nx = dx / dist; nz = dz / dist;
        p.x += nx * (RIG_RADIUS - dist);
        p.z += nz * (RIG_RADIUS - dist);
      } else {
        const l = p.x - box.min.x, r = box.max.x - p.x, b = p.z - box.min.z, f = box.max.z - p.z;
        const m = Math.min(l, r, b, f);
        if (m === l) { p.x = box.min.x - RIG_RADIUS; nx = -1; nz = 0; }
        else if (m === r) { p.x = box.max.x + RIG_RADIUS; nx = 1; nz = 0; }
        else if (m === b) { p.z = box.min.z - RIG_RADIUS; nx = 0; nz = -1; }
        else { p.z = box.max.z + RIG_RADIUS; nx = 0; nz = 1; }
      }
      // Kill velocity into the wall so we slide along it instead of sticking.
      const into = this.velocity.x * nx + this.velocity.z * nz;
      if (into < 0) { this.velocity.x -= into * nx; this.velocity.z -= into * nz; }
      // Pushing: keep walking into a pushable for a moment → it moves one tile.
      if (obj.userData.onPush && _move.lengthSq() > 0.25 && (-nx * _move.x - nz * _move.z) > 0.7) { pushed = obj; pushNX = nx; pushNZ = nz; }
      if (obj.userData.onTouch) obj.userData.onTouch(this);
    }
    if (pushed && this._pushCooldown <= 0) {
      if (this._pushTarget !== pushed) { this._pushTarget = pushed; this._pushTimer = 0; }
      this._pushTimer += dt;
      if (this._pushTimer > 0.22) {
        const ax = Math.abs(pushNX) > Math.abs(pushNZ) ? -Math.sign(pushNX) : 0;
        const az = ax === 0 ? -Math.sign(pushNZ) : 0;
        pushed.userData.onPush(ax, az, this);
        this.hero.play('use', { speed: 1.8 });
        this._pushTimer = 0;
        this._pushCooldown = 0.5;
      }
    } else if (!pushed) {
      this._pushTimer = 0;
      this._pushTarget = null;
    }
  }

  /** Launch the jump immediately on Space keydown when grounded.
   *  The exact keys held AT THE TAP decide its type, not the state a
   *  later physics frame happens to observe. Also called from update()
   *  to honour the coyote-time / early-landing jump buffer.
   */
  _attemptBufferedJump() {
    if (this.frozen || !this.inputEnabled || this._jumpBuffer <= 0) return false;
    if (!this.onGround && this._coyote <= 0) return false;
    this._basis();
    const queued = this._queuedFutureJump;
    const heldForward = this.keys.forward && !this.keys.back;
    this._forwardJump = this.canSprintLeap && (queued ? queued.forward : heldForward) && this._dashTime <= 0;
    this._sprintLeap = !!(this._forwardJump && (queued ? queued.big : this.keys.sprint));
    this.velocity.y = this._sprintLeap ? FUTURE_LEAP_JUMP_SPEED : JUMP_SPEED;
    if (this._forwardJump) {
      this._sprintLeapDir.copy(_fwd);
      const speed = this._sprintLeap ? FUTURE_LEAP_FORWARD_SPEED : FUTURE_NORMAL_JUMP_FORWARD_SPEED;
      this.velocity.x = this._sprintLeapDir.x * speed;
      this.velocity.z = this._sprintLeapDir.z * speed;
    }
    this._jumpBuffer = 0;
    this._queuedFutureJump = null;
    this._coyote = 0;
    this.onGround = false;
    this.hero.play('jumpStart', { speed: 2.5 });
    this.dispatchEvent({ type: 'jump', kind: this.canSprintLeap ? (this._sprintLeap ? 'big' : 'normal') : 'standard' });
    return true;
  }

  update(dt) {
    const p = this.rig.position;
    this._dashCooldown = Math.max(0, this._dashCooldown - dt);
    this._pushCooldown = Math.max(0, this._pushCooldown - dt);
    this._invuln = Math.max(0, this._invuln - dt);
    this._jumpBuffer = Math.max(0, this._jumpBuffer - dt);
    if (this._jumpBuffer <= 0) this._queuedFutureJump = null;
    this._coyote = Math.max(0, this._coyote - dt);

    if (!this.frozen) {
      if (this.keys.turnLeft !== this.keys.turnRight) {
        this.yaw += KEYBOARD_TURN_SPEED * dt * (this.keys.turnLeft ? 1 : -1);
      }
      // 1. moving-platform carry
      if (this.groundObject && this.groundObject.userData.carryDelta) p.add(this.groundObject.userData.carryDelta);

      // 2. desired horizontal velocity from input (camera-relative)
      this._basis();
      const iz = Number(this.keys.forward) - Number(this.keys.back);
      const ix = Number(this.keys.right) - Number(this.keys.left);
      _move.set(0, 0, 0).addScaledVector(_fwd, iz).addScaledVector(_right, ix);
      if (_move.lengthSq() > 1) _move.normalize();
      const speed = this.keys.sprint ? SPRINT_SPEED : WALK_SPEED;
      const accel = this.onGround ? ACCEL_GROUND : ACCEL_AIR;
      const k = 1 - Math.exp(-accel * dt);
      if (this._dashTime > 0) {
        this._dashTime -= dt;
        this.velocity.x = this._dashDir.x * DASH_SPEED;
        this.velocity.z = this._dashDir.z * DASH_SPEED;
        this.velocity.y = Math.max(this.velocity.y, 0);
      } else if (this._sprintLeap && !this.onGround) {
        // Only a long jump locks its takeoff direction and speed. Neither
        // WASD/arrows, mouse-look nor releasing Shift can steer this leap.
        const steer = 1 - Math.exp(-FUTURE_LEAP_AIR_STEER * dt);
        this.velocity.x += (this._sprintLeapDir.x * FUTURE_LEAP_FORWARD_SPEED - this.velocity.x) * steer;
        this.velocity.z += (this._sprintLeapDir.z * FUTURE_LEAP_FORWARD_SPEED - this.velocity.z) * steer;
      } else if (this._forwardJump && !this.onGround) {
        // Normal jumps accept camera-relative WASD/arrow steering. Keep the
        // existing hop speed, and coast if the player releases all movement.
        // Pressing Shift in the air cannot upgrade this into a long jump.
        if (_move.lengthSq() > 0) {
          this.velocity.x += (_move.x * FUTURE_NORMAL_JUMP_FORWARD_SPEED - this.velocity.x) * k;
          this.velocity.z += (_move.z * FUTURE_NORMAL_JUMP_FORWARD_SPEED - this.velocity.z) * k;
        }
      } else {
        this.velocity.x += (_move.x * speed - this.velocity.x) * k;
        this.velocity.z += (_move.z * speed - this.velocity.z) * k;
      }

      // 3. Jump if Space was buffered while briefly airborne. Regular
      // grounded jumps have ALREADY launched directly on keydown.
      this._attemptBufferedJump();
      if (this._dashTime <= 0) this.velocity.y = Math.max(this.velocity.y - GRAVITY * dt, -28); // terminal velocity

      // 4. integrate
      _prev.copy(p);
      p.y += this.velocity.y * dt;

      // Short horizontal sweeps prevent a dash tunnelling through thin doors.
      const steps = Math.max(1, Math.ceil(Math.hypot(this.velocity.x, this.velocity.z) * dt / 0.2));
      for (let step = 0; step < steps; step++) {
        p.x += this.velocity.x * dt / steps;
        p.z += this.velocity.z * dt / steps;
        this._resolveCollisions(dt / steps);
      }
      p.x = THREE.MathUtils.clamp(p.x, -this.bounds, this.bounds);
      p.z = THREE.MathUtils.clamp(p.z, -this.bounds, this.bounds);

      // 6. ground
      const wasGrounded = this.onGround;
      // The probe starts above BOTH last frame's and this frame's feet, so a
      // fast fall can never tunnel through a thin floor between frames.
      const originY = Math.max(p.y, _prev.y) + STEP_UP;
      _origin.set(p.x, originY, p.z);
      this._groundRay.set(_origin, _down);
      this._groundRay.far = originY - p.y + (wasGrounded ? 0.35 : 0.05);
      this._groundHits.length = 0;
      const hit = this._groundRay.intersectObjects(this.walkables, false, this._groundHits)[0];
      if (hit && this.velocity.y <= 0.01) {
        if (!wasGrounded) {
          this._fallSpeed = -this.velocity.y;
          if (this._fallSpeed > 4) this.dispatchEvent({ type: 'land', speed: this._fallSpeed });
        }
        p.y = hit.point.y;
        this.velocity.y = 0;
        this.onGround = true;
        this._airDashUsed = false;
        this._sprintLeap = false;
        this._forwardJump = false;
        this.groundObject = hit.object;
        this._coyote = this.canSprintLeap ? FUTURE_COYOTE_TIME : COYOTE_TIME;
      } else {
        this.onGround = false;
        this.groundObject = null;
      }

      // 7. footsteps
      this.speed = Math.hypot(p.x - _prev.x, p.z - _prev.z) / Math.max(dt, 1e-4);
      if (this.onGround && this.speed > 0.6) {
        this._stepDist += this.speed * dt;
        const stride = this.speed > 6 ? 2.1 : 1.45;
        if (this._stepDist > stride) {
          this._stepDist = 0;
          const surface = (this.groundObject && this.groundObject.userData.surface) || this.defaultSurface;
          this.dispatchEvent({ type: 'step', surface, sprint: this.speed > 6 });
        }
      }

      // 8. fell out of the world
      if (!this._fell && p.y < this.killY) {
        this._fell = true;
        this.dispatchEvent({ type: 'fall' });
      }

      // 9. facing: third-person turns toward travel direction, first-person toward the camera
      let targetFacing = this.facing;
      if (this.mode === 'first' || (this.keys.turnLeft !== this.keys.turnRight && this.speed < 0.4)) targetFacing = this.yaw + Math.PI;
      else if (Math.hypot(this.velocity.x, this.velocity.z) > 0.4) targetFacing = Math.atan2(this.velocity.x, this.velocity.z);
      let dA = targetFacing - this.facing;
      dA = Math.atan2(Math.sin(dA), Math.cos(dA));
      this.facing += dA * (1 - Math.exp(-14 * dt));
    }
    this.rig.rotation.y = this.facing;

    this.hero.update(dt, { speed: this.frozen ? 0 : this.speed, grounded: this.onGround || this.frozen, fallSpeed: this._fallSpeed });
    this._placeCamera(dt);
    // The prompt and E resolver must see the same up-to-date beam angle.
    this._updateFlashlight();
    this._updateInteraction();
  }

  _placeCamera(dt) {
    _euler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(_euler);
    this.camera.getWorldDirection(_look);
    this.head.getWorldPosition(_head);

    const baseFov = settings.get('fov');
    const sprintKick = this.keys.sprint && this.speed > 6 ? 5 : 0;
    this._fovKick = Math.max(0, this._fovKick - dt * 30);
    const fov = baseFov + sprintKick + this._fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-8 * dt));
      this.camera.updateProjectionMatrix();
    }

    if (this.mode === 'first') {
      this.rig.visible = false;
      this._bob += this.onGround ? this.speed * dt * 1.6 : 0;
      this.camera.position.copy(_head);
      this.camera.position.y += Math.sin(this._bob) * 0.035 * Math.min(1, this.speed / 5);
    } else {
      this.rig.visible = true;
      // Orbit target: above the head, shifted over the right shoulder.
      _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      _target.copy(_head).addScaledVector(_right, TP_SHOULDER);
      _target.y += TP_HEIGHT;
      _camDir.copy(_look).negate();
      // Sweep from inside the room, including shoulder/height offset. Expanded
      // AABBs protect the near plane, even for invisible proxies and ceilings.
      this.camera.position.copy(_target).addScaledVector(_camDir, TP_DISTANCE);
      _cameraPath.subVectors(this.camera.position, _head);
      const fullDistance = _cameraPath.length();
      _cameraPath.normalize();
      this._camRay.set(_head, _cameraPath);
      this._camRay.far = fullDistance;
      let want = fullDistance;
      this._cameraHits.length = 0;
      const h = this._camRay.intersectObjects(this.walkables, false, this._cameraHits)[0];
      if (h) want = Math.max(.05, h.distance - .22);
      for (const obj of this.cameraColliders) {
        if (!obj.userData.solidBox) continue;
        _cameraBox.copy(obj.userData.solidBox).expandByScalar(.22);
        // If expansion contains the anchor, use the unexpanded boundary.
        if (_cameraBox.containsPoint(_head)) _cameraBox.copy(obj.userData.solidBox);
        if (this._camRay.ray.intersectBox(_cameraBox, _cameraHit))
          want = Math.min(want, Math.max(.05, _cameraHit.distanceTo(_head) - .04));
      }
      this._camDist = want < this._camDist ? want : this._camDist + (want - this._camDist) * (1 - Math.exp(-4 * dt));
      const distance = this._camDist;
      this.camera.position.copy(_head).addScaledVector(_cameraPath, distance);
      // Fade the hero out if the camera is jammed against them.
      this.hero.group.visible = this.frozen || distance > 0.9;
    }

    if (this._shake > 0) {
      this._shake = Math.max(0, this._shake - dt * 1.2);
      const s = this._shake * this._shake * 0.6;
      this.camera.rotateX((Math.random() - .5) * s * .1);
      this.camera.rotateY((Math.random() - .5) * s * .1);
    }
  }

  _updateInteraction() {
    this.interaction.update(this);
    this.nearbyInteractable = this.interaction.target;
  }

  hasInteractionLineOfSight(obj) {
    this.head.getWorldPosition(_head);
    interactionPoint(obj, _target);
    return obj.userData.interaction?.kind === 'clue'
      ? clueInZone(this.position, _target, obj, this.colliders)
      : interactionReachable(_head, _target, obj, this.colliders);
  }

  _updateFlashlight() {
    if (!this.flashlight) return;
    this.head.getWorldPosition(_head);
    this.flashlight.position.copy(_head).addScaledVector(_right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), 0.25);
    this.flashlight.position.y -= 0.25;
    this.flashlight.target.position.copy(this.flashlight.position).addScaledVector(_look, 8);
    this.flashlight.target.updateMatrixWorld();
  }

  /** Reject unsafe mid-air/dynamic-platform positions; fall back to a stable checkpoint. */
  savePose(checkpointOnly = false) {
    const cp = this.getCheckpoint();
    const stable = !checkpointOnly && this.onGround && !this._fell && !this.isDashing &&
      !this.groundObject?.userData.carryDelta && this.groundObject?.userData.tileIndex === undefined;
    return { position: (stable ? this.position : cp?.position || this.spawn).toArray(),
      yaw: stable ? this.yaw : cp?.yaw ?? this.spawnYaw, pitch: this.pitch, mode: this.mode,
      flashlightOn: !!this.flashlightOn };
  }

  restorePose(pose) {
    this.reset(); this.mode = pose.mode;
    _origin.fromArray(pose.position); _origin.y += .5;
    this._groundRay.set(_origin, _down); this._groundRay.far = 1.5;
    this._groundHits.length = 0;
    const hit = this._groundRay.intersectObjects(this.walkables, false, this._groundHits)[0];
    if (hit && Math.abs(hit.point.y - pose.position[1]) < .6) {
      this.position.fromArray(pose.position); this.position.y = hit.point.y;
      let blocked = false;
      for (const o of this.colliders) {
        const b = o.userData.solidBox;
        if (b && this.position.y + RIG_HEIGHT > b.min.y && this.position.y + STEP_UP < b.max.y &&
            this.position.x > b.min.x - RIG_RADIUS && this.position.x < b.max.x + RIG_RADIUS &&
            this.position.z > b.min.z - RIG_RADIUS && this.position.z < b.max.z + RIG_RADIUS) { blocked = true; break; }
      }
      if (blocked) this.reset(); else { this.onGround = true; this.groundObject = hit.object; }
    }
    this.yaw = pose.yaw; this.pitch = pose.pitch; this.facing = this.yaw + Math.PI;
    if (this.flashlightOwned) this.setFlashlight(pose.flashlightOn);
    this._camDist = .05; this._placeCamera(0);
  }

  /** Flashlight state for the reveal-ink shader (the Present). */
  getFlashlightState(out) {
    out.on = !!(this.flashlight && this.flashlightOn);
    if (this.flashlight) {
      out.pos.copy(this.flashlight.position);
      out.dir.copy(this.flashlight.target.position).sub(this.flashlight.position).normalize();
    }
    return out;
  }
}
