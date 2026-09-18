import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const GRAVITY = 22;
const WALK_SPEED = 5.5;
const SPRINT_SPEED = 9;
const JUMP_SPEED = 8;
const EYE_HEIGHT = 1.7;
const RIG_HEIGHT = 1.8;      // third-person body height
const RIG_RADIUS = 0.35;     // capsule radius used for wall collisions
const STEP_UP = 0.45;        // ledges lower than this are climbed, not blocked
const GROUND_RAY_FAR = 1.2;  // how far below the feet we probe for ground
const KILL_Y = -12;          // falling below this triggers player.onFall
const THIRD_PERSON_DIST = 4.4;
const THIRD_PERSON_RISE = 1.0;
const THIRD_PERSON_MIN = 0.6;  // camera never pulled closer than this to the head
const THIRD_PERSON_PAD = 0.25; // gap kept between the camera and blocking geometry

// Scratch objects reused every frame — never allocate inside the loop.
const _origin = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _look = new THREE.Vector3();
const _head = new THREE.Vector3();
const _up = new THREE.Vector3(0, THIRD_PERSON_RISE, 0);
const _camForward = new THREE.Vector3(0, 0, -1); // flattened look dir (persists between frames)
const _camRight = new THREE.Vector3(1, 0, 0);
const _moveDir = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _camDir = new THREE.Vector3();

/**
 * First/third-person player controller.
 *
 * Movement is camera-relative in BOTH view modes by construction, because
 * three concerns are kept strictly separate every frame:
 *
 *   INPUT — which keys are held (this.keys). Nothing else touches it.
 *   CAMERA ORIENTATION — mouse-look only: PointerLockControls rotates the
 *     camera. The camera is never parented to the rig and the controls never
 *     move it through the world.
 *   RIG POSITION — where the player physically is (this.rig.position).
 *     Only update() moves it, using a basis derived each frame from the
 *     camera's CURRENT world orientation, flattened onto the ground plane.
 *
 * Because the basis is recomputed from camera orientation every frame,
 * toggling the view (V) changes nothing about how WASD behaves: W always
 * walks toward wherever the camera currently looks. The camera itself is
 * only ever PLACED relative to the rig's head anchor (step 8 of update):
 * at the head in first-person, or on a collision-safe orbit behind/above
 * it in third-person.
 *
 * Why getWorldDirection() instead of camera.rotation.y: the controls
 * compose the view from a YXZ-order euler, so reading .rotation (XYZ
 * order) gives a yaw skewed by pitch. The world direction is exact.
 */
export class Player {
  constructor(camera, domElement, interactables) {
    this.camera = camera;
    this.interactables = interactables;
    this.mode = 'first';          // 'first' | 'third' — V toggles (C also works)
    this.onFall = null;           // wired by main.js

    this.controls = new PointerLockControls(camera, domElement);
    // Releasing the pointer (Esc → pause) must not leave keys stuck down.
    this.controls.addEventListener('unlock', () => this._clearKeys());

    // --- third-person rig: a simple explorer body, hidden in first-person ---
    this.rig = new THREE.Group();
    this.rig.name = 'PlayerRig';
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc9b48a, roughness: 0.7 });
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x14333d, emissive: 0x4fd0e8, emissiveIntensity: 1.4,
    });
    this._body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.85, 6, 12), bodyMat);
    this._body.position.y = 0.95;
    this._body.castShadow = true;
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), bodyMat);
    headMesh.position.y = 1.55;
    headMesh.castShadow = true;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.06), visorMat);
    visor.position.set(0, 1.56, 0.2);
    this.rig.add(this._body, headMesh, visor);

    // Camera anchor: the first-person eye and the third-person orbit target.
    this.head = new THREE.Object3D();
    this.head.position.y = EYE_HEIGHT;
    this.rig.add(this.head);
    this.rig.visible = false;

    this.spawn = new THREE.Vector3(0, EYE_HEIGHT, 12);
    this.velocity = new THREE.Vector3();
    this.onGround = false;
    this.keys = { forward: false, back: false, left: false, right: false, sprint: false };
    this.nearbyInteractable = null;
    this.colliders = [];   // solid meshes carrying userData.solidBox (THREE.Box3)
    this.walkables = [];   // meshes the down-ray can land on
    this.flashlight = null;
    this.flashlightOn = false;
    this._groundObject = null;
    this._walkPhase = 0;
    this._fell = false;

    this._bindKeys();
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 3.5;
    this._groundRay = new THREE.Raycaster();
    this._groundRay.far = GROUND_RAY_FAR;
    this._occluderRay = new THREE.Raycaster(); // third-person camera pull-in
  }

  get object() { return this.rig; }

  _bindKeys() {
    window.addEventListener('keydown', (e) => this._setKey(e.code, true));
    window.addEventListener('keyup', (e) => this._setKey(e.code, false));
  }

  _clearKeys() {
    this.keys.forward = false;
    this.keys.back = false;
    this.keys.left = false;
    this.keys.right = false;
    this.keys.sprint = false;
  }

  _setKey(code, pressed) {
    switch (code) {
      case 'KeyW': case 'ArrowUp': this.keys.forward = pressed; break;
      case 'KeyS': case 'ArrowDown': this.keys.back = pressed; break;
      case 'KeyA': case 'ArrowLeft': this.keys.left = pressed; break;
      case 'KeyD': case 'ArrowRight': this.keys.right = pressed; break;
      case 'ShiftLeft': case 'ShiftRight': this.keys.sprint = pressed; break;
      case 'Space':
        if (pressed && this.onGround && this.controls.isLocked) {
          this.velocity.y = JUMP_SPEED;
          this.onGround = false;
        }
        break;
      case 'KeyE':
        if (pressed && this.controls.isLocked) this.tryInteract();
        break;
      case 'KeyV': case 'KeyC':
        if (pressed && this.controls.isLocked) {
          this.mode = this.mode === 'first' ? 'third' : 'first';
        }
        break;
      case 'KeyF':
        if (pressed && this.flashlight) {
          this.flashlightOn = !this.flashlightOn;
          this.flashlight.intensity = this.flashlightOn ? 90 : 0;
        }
        break;
    }
  }

  tryInteract() {
    if (this.nearbyInteractable && this.nearbyInteractable.userData.onInteract) {
      return this.nearbyInteractable.userData.onInteract();
    }
    return null;
  }

  /** Climb from a raycast hit mesh up to the ancestor holding userData. */
  _findInteractable(object) {
    let o = object;
    for (let i = 0; i < 4 && o; i++) {
      if (o.userData && o.userData.onInteract) return o;
      o = o.parent;
    }
    return null;
  }

  /** Level 2 hands the player a flashlight; F toggles it from then on. */
  addFlashlight() {
    if (this.flashlight) return;
    const spot = new THREE.SpotLight(0xfff2cf, 90, 24, Math.PI / 5.2, 0.45, 1.3);
    spot.position.set(0.14, 1.5, 0.3);   // forward of the chest, slightly right
    const target = new THREE.Object3D();
    target.position.set(0, 1.45, 6);     // ahead of the rig (+Z = look direction)
    this.rig.add(spot, target);
    spot.target = target;
    this.flashlight = spot;
    this.flashlightOn = true;
  }

  /** Called by the level manager on every level switch. */
  clearLevelAttachments() {
    if (this.flashlight) {
      this.rig.remove(this.flashlight);
      this.rig.remove(this.flashlight.target);
      this.flashlight.dispose();
      this.flashlight = null;
      this.flashlightOn = false;
    }
  }

  setColliders(list) { this.colliders = list || []; }
  setWalkables(list) { this.walkables = list || []; }

  /** Full position reset — also used as the fall-out-of-world respawn. */
  reset() {
    this.rig.position.copy(this.spawn);
    this.velocity.set(0, 0, 0);
    this.onGround = false;
    this._groundObject = null;
    this._walkPhase = 0;
    this._fell = false;
  }

  _resolveCollisions() {
    const p = this.rig.position;
    for (const mesh of this.colliders) {
      const box = mesh.userData.solidBox;
      if (!box) continue;
      // Vertical overlap: skip boxes we can simply step onto (low tops),
      // and boxes entirely above/below the body.
      if (p.y + RIG_HEIGHT <= box.min.y || p.y + STEP_UP >= box.max.y) continue;

      const cx = THREE.MathUtils.clamp(p.x, box.min.x, box.max.x);
      const cz = THREE.MathUtils.clamp(p.z, box.min.z, box.max.z);
      const dx = p.x - cx;
      const dz = p.z - cz;
      const distSq = dx * dx + dz * dz;
      if (distSq >= RIG_RADIUS * RIG_RADIUS) continue;

      if (distSq > 1e-6) {
        // Circle-vs-box: push straight out of the nearest face.
        const dist = Math.sqrt(distSq);
        const push = RIG_RADIUS - dist;
        p.x += (dx / dist) * push;
        p.z += (dz / dist) * push;
      } else {
        // Dead centre inside the box: eject along the shallowest axis.
        const left = p.x - box.min.x, right = box.max.x - p.x;
        const back = p.z - box.min.z, front = box.max.z - p.z;
        const m = Math.min(left, right, back, front);
        if (m === left) p.x = box.min.x - RIG_RADIUS;
        else if (m === right) p.x = box.max.x + RIG_RADIUS;
        else if (m === back) p.z = box.min.z - RIG_RADIUS;
        else p.z = box.max.z + RIG_RADIUS;
      }
    }
  }

  update(delta) {
    // 1. Moving-platform carry — platforms already moved in levelManager.update
    //    this frame; their userData.carryDelta says by how much. Riding one
    //    applies that displacement to us before physics runs.
    if (this._groundObject && this._groundObject.userData.carryDelta) {
      this.rig.position.add(this._groundObject.userData.carryDelta);
    }

    // 2. Gravity + vertical motion
    this.velocity.y -= GRAVITY * delta;
    this.rig.position.y += this.velocity.y * delta;

    // 3. Ground probe: ray straight down from just above the feet. Hits up to
    //    ~0.5 above the feet snap us UP (free step-climb), hits below catch
    //    landings and hold us on platforms.
    _origin.set(this.rig.position.x, this.rig.position.y + 0.5, this.rig.position.z);
    this._groundRay.set(_origin, _down);
    const hit = this._groundRay.intersectObjects(this.walkables, true)[0];
    if (hit && this.velocity.y <= 0 && this.rig.position.y <= hit.point.y + 0.02) {
      this.rig.position.y = hit.point.y;
      this.velocity.y = 0;
      this.onGround = true;
      this._groundObject = hit.object;
    } else {
      this.onGround = false;
      this._groundObject = null;
    }

    // 4. Horizontal movement — always camera-relative.
    //    The basis comes from the camera's CURRENT world orientation (which
    //    already reflects this frame's mouse input), flattened onto the
    //    ground plane so looking up/down never flies you or slows you down.
    //    The RIG is the thing that moves through the world; the camera only
    //    gets PLACED relative to the rig (step 8).
    this.camera.getWorldDirection(_look);
    _camForward.copy(_look);
    _camForward.y = 0;
    if (_camForward.lengthSq() > 1e-8) {
      _camForward.normalize();
      _camRight.set(-_camForward.z, 0, _camForward.x); // camera-space right, on the ground plane
    }
    // else: looking ~straight up/down — keep last frame's heading.

    const inputZ = Number(this.keys.forward) - Number(this.keys.back); // W/S
    const inputX = Number(this.keys.right) - Number(this.keys.left);   // A/D
    _moveDir.set(0, 0, 0)
      .addScaledVector(_camForward, inputZ)
      .addScaledVector(_camRight, inputX);
    const moving = _moveDir.lengthSq() > 1e-8;
    if (moving) _moveDir.normalize();
    const speed = this.keys.sprint ? SPRINT_SPEED : WALK_SPEED;
    this.rig.position.addScaledVector(_moveDir, speed * delta);
    if (moving) this._walkPhase += speed * delta * 2.2;
    this._body.position.y = 0.95 + (moving ? Math.sin(this._walkPhase) * 0.045 : 0);

    // 5. Wall collisions + world bounds
    this._resolveCollisions();
    this.rig.position.x = THREE.MathUtils.clamp(this.rig.position.x, -55, 55);
    this.rig.position.z = THREE.MathUtils.clamp(this.rig.position.z, -55, 55);

    // 6. Fell out of the world (Level 3 void, Level 1 chasm)?
    if (!this._fell && this.rig.position.y < KILL_Y) {
      this._fell = true;
      if (this.onFall) this.onFall();
    }

    // 7. Interact raycast: from the head along the current look direction
    //    (works in both camera modes; in first-person the head IS the camera).
    this.head.getWorldPosition(_head);
    this.raycaster.set(_head, _look);
    const hits = this.raycaster.intersectObjects(this.interactables, true);
    this.nearbyInteractable = hits.length > 0 ? this._findInteractable(hits[0].object) : null;

    // 8. Rig facing + camera placement.
    //    The model's +Z is rotated onto the flattened look direction, so in
    //    third-person the character visibly faces where you look and walk.
    //    Facing is tracked even in first-person (rig hidden) so toggling the
    //    view never back-flips the model.
    this.rig.rotation.y = Math.atan2(_camForward.x, _camForward.z);
    if (this.flashlight) {
      // Pitch from the look direction itself (asin of its y) — reading
      // camera.rotation.x directly is skewed once yaw and pitch combine.
      const pitch = Math.asin(THREE.MathUtils.clamp(_look.y, -1, 1));
      this.flashlight.target.position.set(0, 1.45 + pitch * 4, 6);
    }
    if (this.mode === 'first') {
      this.rig.visible = false;
      this.camera.position.copy(_head);
    } else {
      this.rig.visible = true;
      // Desired orbit point: behind the head along the look direction, raised.
      _camPos.copy(_head).addScaledVector(_look, -THIRD_PERSON_DIST).add(_up);
      _camDir.subVectors(_camPos, _head);
      const desired = _camDir.length();
      // Collision-safe distance: ray from the head toward the desired camera
      // position; if level geometry blocks the orbit, pull the camera in.
      this._occluderRay.set(_head, _camDir.normalize());
      this._occluderRay.far = desired;
      let dist = desired - THIRD_PERSON_PAD;
      const hitA = this._occluderRay.intersectObjects(this.colliders, true)[0];
      const hitB = this._occluderRay.intersectObjects(this.walkables, true)[0];
      const block = hitA && hitB ? (hitA.distance < hitB.distance ? hitA : hitB) : (hitA || hitB);
      if (block) dist = Math.min(dist, block.distance - THIRD_PERSON_PAD);
      this.camera.position.copy(_head).addScaledVector(_camDir, Math.max(dist, THIRD_PERSON_MIN));
    }
  }
}
