import * as THREE from 'three';
import { interactionPoint, interactionPrompt, interactionReachable, interactionVisible, NEARBY_GUIDE_RANGE } from './interaction.js';

/**
 * Close-range, world-space clue assistance shared by EVERY era. Nothing is
 * shown from afar. No compass, no HUD direction, no permanent world beacons.
 *
 *  - A pulsing stack of downward chevrons rises out of each nearby clue.
 *  - A small floor ring shows an unobstructed approach position when needed.
 *  - E is available automatically as soon as the player is close enough and
 *    the clue is physically reachable (see InteractionSelector).
 *
 * Graphics are cheap sprites and one reused ring geometry. All scene objects
 * are removed when the level switches; there are no per-frame allocations of
 * materials/geometry, and effects are excluded from the orthographic minimap.
 */
const _anchor = new THREE.Vector3();
const _heroHead = new THREE.Vector3();
const _sampleHead = new THREE.Vector3();
const _sampleFeet = new THREE.Vector3();
const _floorPos = new THREE.Vector3();
const _toFloor = new THREE.Vector3(0, -1, 0);
const _start = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _groundHits = [];
const LOOK_RADIUS = NEARBY_GUIDE_RANGE;
const SAMPLE_RADII = [1.35, 1.95, 2.65];
const SAMPLE_COUNT = 16;

function makeArrowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 160;
  const c = canvas.getContext('2d');
  c.strokeStyle = '#ffffff';
  c.lineWidth = 11;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.shadowColor = '#ffffff';
  c.shadowBlur = 15;
  // Three bright V-shaped arrows with their tips nearest the object.
  for (let n = 0; n < 3; n++) {
    const y = 24 + n * 33;
    c.beginPath();
    c.moveTo(30, y);
    c.lineTo(64, y + 24);
    c.lineTo(98, y);
    c.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class ClueGuidance {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'CloseRangeClueArrows';
    this.scene.add(this.root);
    this.texture = makeArrowTexture();
    this.ringGeo = new THREE.RingGeometry(0.44, 0.52, 32);
    this.markers = new Map();
    this.levelInteractables = null;
    this.elapsed = 0;
  }

  reset() {
    for (const m of this.markers.values()) {
      this.root.remove(m.sprite, m.ring);
      m.sprite.material.dispose();
      m.ring.material.dispose();
    }
    this.markers.clear();
  }

  _marker(obj) {
    let m = this.markers.get(obj);
    if (m) return m;
    const mat = new THREE.SpriteMaterial({
      map: this.texture, color: 0x76d9ff, transparent: true,
      depthTest: true, depthWrite: false, opacity: 0.94,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.67, 0.9, 1);
    sprite.renderOrder = 2;
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x76d9ff, transparent: true, opacity: 0.55,
      depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    ring.renderOrder = 2;
    this.root.add(sprite, ring);
    m = { sprite, ring, stand: null, retry: 0 };
    this.markers.set(obj, m);
    return m;
  }

  /** Return a real, walkable floor spot whose view of the clue is clear. */
  _approach(player, obj, anchor) {
    let best = null;
    let bestScore = Infinity;
    const head = _heroHead;
    for (const r of SAMPLE_RADII) {
      for (let n = 0; n < SAMPLE_COUNT; n++) {
        const angle = (n / SAMPLE_COUNT) * 2 * Math.PI;
        const x = anchor.x + Math.cos(angle) * r;
        const z = anchor.z + Math.sin(angle) * r;
        const distToPlayer = Math.hypot(x - player.position.x, z - player.position.z);
        if (distToPlayer > 5.5) continue;
        // Do not place the "stand here" ring inside a cabinet or wall.
        _sampleFeet.set(x, player.position.y + 0.65, z);
        if (player.colliders.some(c => c.userData.solidBox?.containsPoint(_sampleFeet))) continue;
        _sampleHead.set(x, player.position.y + player.head.position.y, z);
        if (!interactionReachable(_sampleHead, anchor, obj, player.colliders)) continue;
        // Prefer a stand point on the player's side of a wall, never a point
        // which would suggest walking through one to reach the clue.
        if (!interactionVisible(head, _sampleHead, obj, player.colliders)) continue;
        // Verify a real floor / bridge is below the ring; not mid-air.
        _start.set(x, player.position.y + 1.0, z);
        _ray.set(_start, _toFloor);
        _ray.near = 0;
        _ray.far = 2.3;
        _groundHits.length = 0;
        _ray.intersectObjects(player.walkables, false, _groundHits);
        if (!_groundHits.length) continue;
        const floorY = _groundHits[0].point.y;
        if (Math.abs(floorY - player.position.y) > 0.9) continue;
        const score = distToPlayer + r * 0.08;
        if (score < bestScore) {
          bestScore = score;
          if (!best) best = new THREE.Vector3();
          best.set(x, floorY + 0.055, z);
        }
      }
    }
    return best;
  }

  update(player, dt, elapsed, active) {
    if (this.levelInteractables !== player.interactables) {
      this.levelInteractables = player.interactables;
      this.reset();
    }
    this.root.visible = active;
    if (!active) return;
    player.head.getWorldPosition(_heroHead);
    const seen = new Set();
    for (const obj of player.interactables) {
      const opts = obj.userData.interaction;
      // Every readable/collectible clue across Past, Present and Future.
      if (opts?.kind !== 'clue' || !interactionPrompt(obj) || (opts.pending && !opts.pending())) continue;
      interactionPoint(obj, _anchor);
      const dist = Math.hypot(_anchor.x - player.position.x, _anchor.z - player.position.z);
      if (dist > LOOK_RADIUS || Math.abs(_anchor.y - _heroHead.y) > 4) continue;
      seen.add(obj);
      const m = this._marker(obj);
      m.sprite.visible = true;
      m.sprite.position.set(_anchor.x, _anchor.y + 0.68 + Math.sin(elapsed * 3.2) * 0.13, _anchor.z);
      const ready = player.nearbyInteractable === obj;
      m.sprite.material.color.setHex(ready ? 0x93ffb5 : 0x76d9ff);
      m.sprite.material.opacity = 0.74 + 0.22 * Math.sin(elapsed * 3.5) ** 2;

      // When the clue is not yet E-ready, indicate an actual clear standing
      // position on the FLOOR. Recompute infrequently to avoid heavy raycasts.
      if (ready) {
        m.ring.visible = false;
      } else {
        m.retry -= dt;
        if (m.retry <= 0) {
          m.retry = 0.55;
          m.stand = this._approach(player, obj, _anchor);
        }
        m.ring.visible = !!m.stand;
        if (m.stand) {
          m.ring.position.copy(m.stand);
          m.ring.material.opacity = 0.38 + 0.22 * (0.5 + 0.5 * Math.sin(elapsed * 4));
          const size = 1 + 0.15 * Math.sin(elapsed * 4);
          m.ring.scale.set(size, size, size);
        }
      }
    }
    for (const [obj, m] of this.markers) {
      if (!seen.has(obj)) { m.sprite.visible = false; m.ring.visible = false; }
    }
  }
}
