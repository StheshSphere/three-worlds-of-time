import * as THREE from 'three';
import { assets } from './assets.js';

/**
 * Level-building toolkit shared by all three eras.
 *
 * A level calls the kit to create things; the kit remembers every mesh,
 * light, material and geometry it made, so the level manager can dispose of
 * the whole era in one go (brief §6.1 "dispose of what you remove").
 *
 * Key ideas a marker may ask about:
 *  - WORLD-SCALE UVs: BoxGeometry gives every face UVs 0..1, so a texture
 *    stretches on a long wall. boxGeo() rescales each face's UVs by that
 *    face's real size ÷ `tile` metres, so stone blocks stay the same size on
 *    every wall — and one shared material/texture serves the whole level.
 *  - COLLISION PROXIES: rendering uses detailed meshes; physics uses simple
 *    axis-aligned boxes (userData.solidBox) and a short list of "walkable"
 *    meshes for the ground raycast. Cheap and predictable on lab hardware.
 *  - MINIMAP LAYER: every floor/wall also gets a flat shape on layer 2. The
 *    minimap's orthographic camera renders ONLY layer 2, so the map costs a
 *    handful of quads instead of a second full scene render.
 */
export const MAP_LAYER = 2;

const _box = new THREE.Box3();
const _v = new THREE.Vector3();

export function createKit(ctx) {
  const objects = [];
  const lights = [];
  const disposables = [];
  const colliders = [];
  const walkables = [];
  const interactables = [];
  const updaters = [];
  const materialCache = new Map();

  const track = (...items) => { items.forEach((i) => i && disposables.push(i)); return items[0]; };

  /* ---------------------------- materials ---------------------------- */
  /**
   * PBR material from a Poly Haven set. ARM texture = AO in red,
   * roughness in green, metalness in blue — three.js reads exactly those
   * channels for aoMap / roughnessMap / metalnessMap, so one image feeds all three.
   */
  function material(set, opts = {}) {
    const key = set + JSON.stringify(opts);
    if (materialCache.has(key)) return materialCache.get(key);
    const t = assets.texSet(set) || {};
    const m = new THREE.MeshStandardMaterial({
      map: t.color || null,
      normalMap: t.normal || null,
      aoMap: t.arm || null,
      roughnessMap: t.arm || null,
      metalnessMap: opts.metal ? t.arm : null,
      color: opts.tint !== undefined ? opts.tint : 0xffffff,
      roughness: opts.roughness ?? 1,
      metalness: opts.metalness ?? (opts.metal ? 1 : 0),
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      envMapIntensity: opts.envMapIntensity ?? 1,
      side: opts.side ?? THREE.FrontSide,
    });
    if (opts.normalScale) m.normalScale.set(opts.normalScale, opts.normalScale);
    m.aoMapIntensity = opts.ao ?? 1;
    materialCache.set(key, m);
    track(m);
    return m;
  }

  function basic(color, opts = {}) {
    return track(new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...opts }));
  }

  /* ---------------------------- geometry ----------------------------- */
  function boxGeo(w, h, d, tile = 2) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    // Face order in BoxGeometry: +x, -x, +y, -y, +z, -z (4 verts each).
    const faceSize = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      for (let i = 0; i < 4; i++) {
        const idx = f * 4 + i;
        uv.setXY(idx, uv.getX(idx) * faceSize[f][0] / tile, uv.getY(idx) * faceSize[f][1] / tile);
      }
    }
    return track(g);
  }

  function cylGeo(rt, rb, h, seg = 24, tile = 2, open = false) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
    const uv = g.attributes.uv;
    const circ = Math.PI * (rt + rb);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ / tile, uv.getY(i) * h / tile);
    return track(g);
  }

  function planeGeo(w, d, tile = 2) {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * d / tile);
    return track(g);
  }

  /* ---------------------------- placement ---------------------------- */
  function place(obj, { pos = [0, 0, 0], rot = 0, scale = 1 } = {}) {
    obj.position.set(pos[0], pos[1], pos[2]);
    if (Array.isArray(rot)) obj.rotation.set(rot[0], rot[1], rot[2]);
    else obj.rotation.y = rot;
    if (Array.isArray(scale)) obj.scale.set(scale[0], scale[1], scale[2]);
    else obj.scale.setScalar(scale);
    obj.updateMatrixWorld(true);
    return obj;
  }

  function add(obj) { objects.push(obj); return obj; }

  function solidFrom(obj, pad = 0) {
    obj.updateMatrixWorld(true);
    obj.userData.solidBox = new THREE.Box3().setFromObject(obj);
    if (pad) obj.userData.solidBox.expandByScalar(pad);
    colliders.push(obj);
    return obj;
  }

  function refreshSolid(obj) {
    obj.updateMatrixWorld(true);
    if (obj.userData.solidBox) obj.userData.solidBox.setFromObject(obj);
  }

  function removeCollider(obj) {
    const i = colliders.indexOf(obj);
    if (i >= 0) colliders.splice(i, 1);
  }
  function addCollider(obj) { if (!colliders.includes(obj)) { refreshSolid(obj); if (!obj.userData.solidBox) solidFrom(obj); else colliders.push(obj); } }

  /** Flat minimap shape on layer 2. */
  function mapShape(w, d, x, y, z, color, rotY = 0) {
    const geo = track(new THREE.PlaneGeometry(w, d));
    const mat = track(new THREE.MeshBasicMaterial({ color, toneMapped: false, depthWrite: true, fog: false }));
    const m = new THREE.Mesh(geo, mat);
    m.rotation.set(-Math.PI / 2, 0, 0);
    m.rotation.z = -rotY;
    m.position.set(x, y + 0.02, z);
    m.layers.set(MAP_LAYER);
    m.frustumCulled = false;
    objects.push(m);
    return m;
  }

  /**
   * The workhorse: a textured box that can be solid (blocks walking),
   * walkable (you can stand on it) and drawn on the minimap.
   */
  function box({
    size, pos = [0, 0, 0], rot = 0, mat, tile = 2, solid = true, walk = true,
    cast = true, receive = true, map = 'auto', parent = null, surface = null,
  }) {
    const [w, h, d] = size;
    const mesh = new THREE.Mesh(boxGeo(w, h, d, tile), mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    if (surface) mesh.userData.surface = surface;   // footstep sound: grass | stone | metal
    place(mesh, { pos, rot });
    if (parent) parent.add(mesh); else objects.push(mesh);
    mesh.updateMatrixWorld(true);
    if (solid) solidFrom(mesh);
    if (walk) walkables.push(mesh);
    if (map === 'auto' || map === true) {
      const top = mesh.position.y + h / 2;
      const isWall = h > 1.2 && solid;
      const rotY = Array.isArray(rot) ? rot[1] : rot;
      mapShape(w, d, mesh.position.x, top, mesh.position.z, isWall ? 0xd8cfb8 : 0x4b4f5c, rotY);
    }
    return mesh;
  }

  /** Invisible physics-only box. */
  function proxy({ size, pos, rot = 0, solid = true, walk = false }) {
    const geo = boxGeo(size[0], size[1], size[2]);
    const mesh = new THREE.Mesh(geo, invisible());
    mesh.visible = false;
    place(mesh, { pos, rot });
    objects.push(mesh);
    mesh.updateMatrixWorld(true);
    if (solid) solidFrom(mesh);
    if (walk) walkables.push(mesh);
    return mesh;
  }

  let _invisible = null;
  function invisible() {
    if (!_invisible) _invisible = track(new THREE.MeshBasicMaterial({ visible: false }));
    return _invisible;
  }

  /**
   * Place a loaded prop. `solid`: true → collision box from the prop's
   * bounds (optionally shrunk by `inset`), false → decoration only.
   * `height` rescales the prop to a target height in metres.
   */
  function prop(name, { pos = [0, 0, 0], rot = 0, scale = 1, height, solid = true, inset = 0, walk = false, cast = true, receive = true, parent = null } = {}) {
    const obj = assets.prop(name);
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } });
    if (height) {
      _box.setFromObject(obj);
      const hgt = _box.max.y - _box.min.y;
      if (hgt > 0) scale = (height / hgt) * (typeof scale === 'number' ? scale : 1);
    }
    place(obj, { pos, rot, scale });
    if (parent) parent.add(obj); else objects.push(obj);
    if (solid) {
      _box.setFromObject(obj);
      const size = _box.getSize(new THREE.Vector3());
      const center = _box.getCenter(new THREE.Vector3());
      const p = proxy({
        size: [Math.max(0.1, size.x - inset * 2), size.y, Math.max(0.1, size.z - inset * 2)],
        pos: [center.x, center.y, center.z], solid: true, walk,
      });
      obj.userData.proxy = p;
    }
    return obj;
  }

  /**
   * Many copies of one prop as InstancedMesh (one draw call per sub-mesh
   * instead of one per copy) — ferns, rocks, debris.
   */
  function scatter(name, items, { cast = true, receive = true } = {}) {
    const src = assets.gltf(name);
    if (!src) return null;
    const group = new THREE.Group();
    src.scene.updateMatrixWorld(true);
    const inst = new THREE.Matrix4();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    src.scene.traverse((o) => {
      if (!o.isMesh) return;
      const im = new THREE.InstancedMesh(o.geometry, o.material, items.length);
      im.castShadow = cast;
      im.receiveShadow = receive;
      items.forEach((it, i) => {
        e.set(0, it.rot || 0, 0);
        q.setFromEuler(e);
        s.setScalar(it.scale || 1);
        inst.compose(_v.set(it.pos[0], it.pos[1], it.pos[2]), q, s);
        m.multiplyMatrices(inst, o.matrixWorld);
        im.setMatrixAt(i, m);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      group.add(im);
    });
    objects.push(group);
    return group;
  }

  /* ---------------------------- lights ------------------------------- */
  function light(l) { lights.push(l); return l; }

  function pointLight(color, intensity, distance, pos, { decay = 2, shadow = false } = {}) {
    const l = new THREE.PointLight(color, intensity, distance, decay);
    l.position.set(pos[0], pos[1], pos[2]);
    l.castShadow = shadow;
    lights.push(l);
    return l;
  }

  /* ---------------------------- interaction -------------------------- */
  /**
   * Make something interactable. prompt may be a string or a function
   * returning a string (or null to hide the prompt).
   */
  function interact(obj, prompt, onInteract) {
    obj.userData.prompt = prompt;
    obj.userData.onInteract = onInteract;
    if (!interactables.includes(obj)) interactables.push(obj);
    return obj;
  }

  function removeInteract(obj) {
    const i = interactables.indexOf(obj);
    if (i >= 0) interactables.splice(i, 1);
  }

  /* ---------------------------- misc --------------------------------- */
  function update(fn) { updaters.push(fn); }

  /** CanvasTexture helper for signs, notes, screens, rune tablets. */
  function canvasTexture(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    draw(g, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    track(t);
    return t;
  }

  function result(extra = {}) {
    return {
      objects, lights, disposables, colliders, walkables, interactables,
      update: (dt, t) => { for (const fn of updaters) fn(dt, t); },
      ...extra,
    };
  }

  return {
    ctx, track, material, basic, boxGeo, cylGeo, planeGeo, place, add, solidFrom,
    refreshSolid, removeCollider, addCollider, mapShape, box, proxy, invisible, prop,
    scatter, light, pointLight, interact, removeInteract, update, canvasTexture, result,
    colliders, walkables, interactables, objects, lights,
  };
}
