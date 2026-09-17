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

// Scratch objects reused every frame — never allocate inside the loop.
const _origin = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _look = new THREE.Vector3();
const _head = new THREE.Vector3();
const _up = new THREE.Vector3(0, THIRD_PERSON_RISE, 0);

/**
 * First/third-person player controller.
 *
 * PointerLockControls only owns mouse-look (it rotates the camera); this
 * class owns everything else: the movement rig, gravity + a downward ground
 * raycast (so we can stand on platforms and terrain, not just y = EYE_HEIGHT),
 * circle-vs-AABB wall collision, moving-platform carry, the interact raycast
 * and the optional flashlight (Level 2 picks it up, any level could reuse it).
 *
 * Camera placement happens at the END of update(): in first-person the camera
 * sits at the head anchor, in third-person it orbits behind the rig along the
 * look direction. The rig mesh is only visible in third-person.
 */
export class Player {
  constructor(camera, domElement, interactables) {
    this.camera = camera;
    this.interactables = interactables;
    this.mode = 'first';          // 'first' | 'third' — C toggles
    this.onFall = null;           // wired by main.js

    this.controls = new PointerLockControls(camera, domElement);

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
  }

  get object() { return this.rig; }

  _bindKeys() {
    window.addEventListener('keydown', (e) => this._setKey(e.code, true));
    window.addEventListener('keyup', (e) => this._setKey(e.code, false));
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
      case 'KeyC':
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
    spot.position.set(0.14, 1.5, 0.1);
    const target = new THREE.Object3D();
    target.position.set(0, 1.4, -6);
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

    // 4. Horizontal movement relative to look direction
    const yaw = this.camera.rotation.y;
    const f = Number(this.keys.forward) - Number(this.keys.back);
    const r = Number(this.keys.right) - Number(this.keys.left);
    let dx = -Math.sin(yaw) * f + Math.cos(yaw) * r;
    let dz = -Math.cos(yaw) * f - Math.sin(yaw) * r;
    const len = Math.hypot(dx, dz);
    if (len > 1e-4) { dx /= len; dz /= len; }
    const speed = this.keys.sprint ? SPRINT_SPEED : WALK_SPEED;
    this.rig.position.x += dx * speed * delta;
    this.rig.position.z += dz * speed * delta;
    if (len > 1e-4) this._walkPhase += speed * delta * 2.2;
    this._body.position.y = 0.95 + (len > 1e-4 ? Math.sin(this._walkPhase) * 0.045 : 0);

    // 5. Wall collisions + world bounds
    this._resolveCollisions();
    this.rig.position.x = THREE.MathUtils.clamp(this.rig.position.x, -55, 55);
    this.rig.position.z = THREE.MathUtils.clamp(this.rig.position.z, -55, 55);

    // 6. Fell out of the world (Level 3 void, Level 1 chasm)?
    if (!this._fell && this.rig.position.y < KILL_Y) {
      this._fell = true;
      if (this.onFall) this.onFall();
    }

    // 7. Interact raycast: from the head along the look direction (works in
    //    both camera modes; in first-person the head IS the camera).
    this.head.getWorldPosition(_head);
    this.camera.getWorldDirection(_look);
    this.raycaster.set(_head, _look);
    const hits = this.raycaster.intersectObjects(this.interactables, true);
    this.nearbyInteractable = hits.length > 0 ? this._findInteractable(hits[0].object) : null;

    // 8. Camera placement + rig facing
    this.rig.rotation.y = yaw;
    if (this.flashlight) {
      const pitch = this.camera.rotation.x;
      this.flashlight.target.position.set(0, 1.45 - pitch * 4, -6);
    }
    if (this.mode === 'first') {
      this.rig.visible = false;
      this.camera.position.copy(_head);
    } else {
      this.rig.visible = true;
      this.camera.position.copy(_head).addScaledVector(_look, -THIRD_PERSON_DIST).add(_up);
      if (this.camera.position.y < 0.55) this.camera.position.y = 0.55;
    }
  }
}
