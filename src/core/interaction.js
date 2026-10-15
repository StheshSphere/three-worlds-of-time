import * as THREE from 'three';

// Interaction uses the character's reach, not the third-person camera's distance.
// Exact aiming wins for adjacent puzzle controls; nearby clues need no pixel hunting.
export const INTERACT_RANGE = 3.1;
const _ray = new THREE.Ray();
const _direction = new THREE.Vector3();
const _hit = new THREE.Vector3();

export function interactionPrompt(obj) {
  if (!obj?.userData.onInteract) return null;
  for (let parent = obj; parent; parent = parent.parent) if (!parent.visible) return null;
  const prompt = obj.userData.prompt;
  return typeof prompt === 'function' ? prompt() : prompt;
}

export function interactionPoint(obj, out) {
  obj.updateWorldMatrix(true, false);
  const point = obj.userData.interaction?.point;
  return point ? out.copy(point).applyMatrix4(obj.matrixWorld) : obj.getWorldPosition(out);
}

/** Invisible physics proxies count too. Only the target's own body is ignored. */
export function interactionVisible(origin, point, obj, colliders) {
  _direction.subVectors(point, origin);
  const distance = _direction.length();
  if (distance < 0.001) return true;
  _ray.set(origin, _direction.multiplyScalar(1 / distance));
  for (const obstacle of colliders) {
    const box = obstacle.userData.solidBox;
    if (!box || obstacle === obj.userData.proxy) continue;
    let ownBody = false;
    for (let parent = obstacle; parent; parent = parent.parent) {
      if (parent === obj) { ownBody = true; break; }
    }
    if (ownBody) continue;
    // A wall-mounted clue's anchor sits just in front of its wall. Do not
    // ignore boxes merely because they contain the target (locked fields!).
    if (box.containsPoint(origin)) return false;
    if (_ray.intersectBox(box, _hit) && _hit.distanceTo(origin) < distance - 0.025) return false;
  }
  return true;
}

export class InteractionSelector {
  constructor() {
    this.target = null;
    this.guide = null;
    this.point = new THREE.Vector3();
    this.distance = 0;
    this.status = '';
    this._origin = new THREE.Vector3();
    this._point = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._towards = new THREE.Vector3();
    this._ray = new THREE.Raycaster();
    this._hits = [];
  }

  clear() { this.target = this.guide = null; this.status = ''; }

  update(player) {
    this.clear();
    if (player.frozen || !player.interactables.length) return;
    player.head.getWorldPosition(this._origin);
    player.camera.updateMatrixWorld(true);
    player.camera.getWorldDirection(this._look);
    this._ray.set(player.camera.position, this._look);
    this._ray.far = player.camera.position.distanceTo(this._origin) + 4;
    this._hits.length = 0;
    this._ray.intersectObjects(player.interactables, true, this._hits);
    for (const hit of this._hits) {
      let obj = hit.object;
      while (obj && !obj.userData.onInteract) obj = obj.parent;
      if (!obj || !player.interactables.includes(obj) || !interactionPrompt(obj)) continue;
      interactionPoint(obj, this._point);
      const radius = obj.userData.interaction?.radius ?? INTERACT_RANGE;
      if (this._point.distanceTo(this._origin) > radius) continue;
      if (!interactionVisible(this._origin, this._point, obj, player.colliders)) continue;
      this.target = obj;
      break;
    }

    let best = Infinity, guideScore = Infinity;
    const exact = this.target;
    for (const obj of player.interactables) {
      if (!interactionPrompt(obj)) continue;
      const opts = obj.userData.interaction || {};
      interactionPoint(obj, this._point);
      this._towards.subVectors(this._point, this._origin);
      const distance = this._towards.length();
      const radius = opts.radius ?? INTERACT_RANGE;
      if (distance > (opts.guideRadius ?? 7)) continue;
      const alignment = distance > 0.001 ? this._towards.dot(this._look) / distance : 1;
      const clear = interactionVisible(this._origin, this._point, obj, player.colliders);
      const pending = !opts.pending || opts.pending();
      const easyReach = opts.kind === 'clue' || alignment > 0.4;
      const ready = clear && distance <= radius && (easyReach || exact === obj);
      // Read clues remain available but do not crowd out the next unread clue.
      const score = distance + (1 - alignment) * (opts.kind === 'clue' ? 0.3 : 2) + (pending ? 0 : 3);
      if (!exact && ready && score < best) { best = score; this.target = obj; }
      if (pending && score + (clear ? 0 : 4) < guideScore) {
        guideScore = score + (clear ? 0 : 4);
        this.guide = obj;
        this.status = !clear ? 'blocked' : distance > radius ? 'closer' : 'turn';
      }
    }
    if (this.target) { this.guide = this.target; this.status = 'ready'; }
    if (this.guide) {
      interactionPoint(this.guide, this.point);
      this.distance = this.point.distanceTo(this._origin);
    }
  }
}
