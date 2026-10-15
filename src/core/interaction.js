import * as THREE from 'three';

// Clues are collected by ENTERING AN INVISIBLE CIRCLE around the clue, not by
// pointing the camera at a tiny mesh or finding a desk's one clear sightline.
// Ordinary puzzle controls keep their smaller, precision-based interaction.
export const INTERACT_RANGE = 3.1;
export const CLUE_ZONE_RADIUS = 6.0;        // 12 m diameter, measured on the floor
export const CLUE_ZONE_HEIGHT = 6.0;        // permits elevated tablets and raised cores
export const NEARBY_GUIDE_RANGE = 5.5;
const _ray = new THREE.Ray();
const _direction = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _wallOrigin = new THREE.Vector3();
const _wallEnd = new THREE.Vector3();

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

/** Original line-of-sight test for precise machinery/puzzle controls. */
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
    if (box.containsPoint(origin)) return false;
    if (_ray.intersectBox(box, _hit) && _hit.distanceTo(origin) < distance - 0.025) return false;
  }
  return true;
}

/** Old precise line test is ONLY for non-clue controls. */
export function interactionReachable(origin, point, obj, colliders) {
  return interactionVisible(origin, point, obj, colliders);
}

/**
 * A clue's zone is a flat, completely INVISIBLE circle centred on the object.
 * Player enters it => on-screen E prompt AND E actually works. Furniture,
 * desks, pedestals and camera orientation NEVER reduce this circle.
 *
 * Only full-height architectural walls/gates can divide the trigger area;
 * this prevents picking up clues from a neighbouring locked room. The ray
 * checks horizontal traversal at the player's chest height, NOT the tiny
 * clue mesh on top of a desk or its detailed collision proxies.
 */
export function clueInZone(playerFeet, cluePoint, obj, colliders = []) {
  const opts = obj.userData.interaction || {};
  const radius = opts.zoneRadius ?? Math.max(CLUE_ZONE_RADIUS, opts.radius ?? 0);
  if (Math.hypot(playerFeet.x - cluePoint.x, playerFeet.z - cluePoint.z) > radius) return false;
  if (Math.abs(playerFeet.y - cluePoint.y) > (opts.zoneHeight ?? CLUE_ZONE_HEIGHT)) return false;

  _wallOrigin.set(playerFeet.x, playerFeet.y + 1.2, playerFeet.z);
  _wallEnd.set(cluePoint.x, playerFeet.y + 1.2, cluePoint.z);
  _direction.subVectors(_wallEnd, _wallOrigin);
  const length = _direction.length();
  if (length < 0.001) return true;
  _ray.set(_wallOrigin, _direction.multiplyScalar(1 / length));
  for (const obstacle of colliders) {
    if (obstacle === obj.userData.proxy) continue;
    const box = obstacle.userData.solidBox;
    if (!box) continue;
    const width = box.max.x - box.min.x;
    const depth = box.max.z - box.min.z;
    const height = box.max.y - box.min.y;
    // Furniture is never a wall. Long, tall, thin obstacles are walls/doors.
    if (height < 2.15 || Math.min(width, depth) > 1.45 || Math.max(width, depth) < 1.1) continue;
    if (_ray.intersectBox(box, _hit) && _hit.distanceTo(_wallOrigin) < length - 0.07) return false;
  }
  return true;
}

/**
 * The SINGLE source of truth for both the visible E prompt and the actual
 * E-key pickup. A clue cannot be hidden behind a raycast-only interaction,
 * and the selected item is not determined by camera aiming. This function
 * is also used again on key-down, independent of the render frame.
 *
 * Pending/uncollected story clues take priority over rereadable objects.
 * Locked clues have a null prompt and are never selectable. Architectural
 * collision barriers still prevent taking an item from another room.
 */
const _candidate = new THREE.Vector3();
export function nearestAvailableClue(player) {
  if (!player?.interactables?.length) return null;
  let selected = null;
  let best = Infinity;
  for (const obj of player.interactables) {
    const opts = obj.userData.interaction;
    if (opts?.kind !== 'clue') continue;
    const prompt = interactionPrompt(obj);
    if (!prompt) continue;
    interactionPoint(obj, _candidate);
    if (!clueInZone(player.position, _candidate, obj, player.colliders)) continue;
    const distance = Math.hypot(player.position.x - _candidate.x, player.position.z - _candidate.z);
    const completedPenalty = opts.pending && !opts.pending() ? 10 : 0;
    const pickupBonus = /^(take|collect|pick up)\b/i.test(prompt) ? 2 : 0;
    const score = distance + completedPenalty - pickupBonus;
    if (score < best) { best = score; selected = obj; }
  }
  return selected;
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
    this._ray.far = player.camera.position.distanceTo(this._origin) + 5;
    this._hits.length = 0;
    this._ray.intersectObjects(player.interactables, true, this._hits);

    // Keep precision selection for adjacent machinery controls (conduit tiles,
    // dials, switches, energy nodes). This does not gate ANY clue.
    for (const hit of this._hits) {
      let obj = hit.object;
      while (obj && !obj.userData.onInteract) obj = obj.parent;
      if (!obj || !player.interactables.includes(obj) || !interactionPrompt(obj)) continue;
      const opts = obj.userData.interaction || {};
      if (opts.kind === 'clue') continue;
      interactionPoint(obj, this._point);
      if (this._point.distanceTo(this._origin) > (opts.radius ?? INTERACT_RANGE)) continue;
      if (!interactionReachable(this._origin, this._point, obj, player.colliders)) continue;
      this.target = obj;
      break;
    }

    // Clues are first-class proximity interactions, not raycast targets.
    // If a clue is in range, its E prompt overrides unrelated camera hits.
    const nearbyClue = nearestAvailableClue(player);
    if (nearbyClue) this.target = nearbyClue;

    // Non-clue controls keep the legacy easy reach as well: players should
    // still be able to operate a nearby console/pylon without pixel aiming.
    // A direct camera hit always beats this fallback, and a nearby clue takes
    // precedence unless the player deliberately aims at the other control.
    if (!this.target) {
      let fallbackScore = Infinity;
      for (const obj of player.interactables) {
        const opts = obj.userData.interaction || {};
        if (opts.kind === 'clue' || !interactionPrompt(obj)) continue;
        interactionPoint(obj, this._point);
        this._towards.subVectors(this._point, this._origin);
        const distance = this._towards.length();
        if (distance > (opts.radius ?? INTERACT_RANGE)) continue;
        const alignment = distance > 0.001 ? this._towards.dot(this._look) / distance : 1;
        if (alignment <= 0.4 || !interactionReachable(this._origin, this._point, obj, player.colliders)) continue;
        const score = distance + (1 - alignment) * 2;
        if (score < fallbackScore) { fallbackScore = score; this.target = obj; }
      }
    }

    // Keep the older contextual approach guide for non-clue controls only.
    if (!this.target) {
      let guideScore = Infinity;
      for (const obj of player.interactables) {
        const opts = obj.userData.interaction || {};
        if (opts.kind === 'clue' || !interactionPrompt(obj)) continue;
        interactionPoint(obj, this._point);
        this._towards.subVectors(this._point, this._origin);
        const distance = this._towards.length();
        if (distance > Math.min(opts.guideRadius ?? NEARBY_GUIDE_RANGE, NEARBY_GUIDE_RANGE)) continue;
        const alignment = distance > 0.001 ? this._towards.dot(this._look) / distance : 1;
        const clear = interactionReachable(this._origin, this._point, obj, player.colliders);
        const radius = opts.radius ?? INTERACT_RANGE;
        const score = distance + (1 - alignment) * 2 + (clear ? 0 : 4);
        if (score < guideScore) {
          guideScore = score;
          this.guide = obj;
          this.status = !clear ? 'blocked' : distance > radius ? 'closer' : 'turn';
        }
      }
    }
    if (this.target) { this.guide = this.target; this.status = 'ready'; }
    if (this.guide) {
      interactionPoint(this.guide, this.point);
      this.distance = this.point.distanceTo(this._origin);
    }
  }
}
