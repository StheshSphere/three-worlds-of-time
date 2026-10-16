import * as THREE from 'three';

/**
 * Ari's facial refresh, applied DIRECTLY to the original skinned head mesh.
 *
 * IMPORTANT: The previous attempt parented replacement eyeballs to the head
 * bone using approximate bind-space coordinates. In the animated game that
 * produced visibly floating/detached eyes. This version adds NO new 3D eye,
 * brow or nose objects. It paints the original eye triangles in-place, so
 * all facial features inherit the exact existing skinning and transformations.
 *
 * A model-layout guard prevents accidental edits if the GLB is replaced.
 */
function getIslands(geometry) {
  const pos = geometry?.getAttribute('position');
  const idx = geometry?.getIndex();
  if (!pos || !idx) return null;
  const parent = Array.from({ length: pos.count }, (_, i) => i);
  const find = (n) => {
    while (parent[n] !== n) { parent[n] = parent[parent[n]]; n = parent[n]; }
    return n;
  };
  for (let i = 0; i < idx.count; i += 3) {
    const a = find(idx.getX(i));
    parent[find(idx.getX(i + 1))] = a;
    parent[find(idx.getX(i + 2))] = a;
  }
  const islands = new Map();
  for (let i = 0; i < pos.count; i++) {
    const root = find(i);
    if (!islands.has(root)) islands.set(root, []);
    islands.get(root).push(i);
  }
  const eyes = [];
  const brows = [];
  for (const verts of islands.values()) {
    const xs = verts.map(i => pos.getX(i));
    const ys = verts.map(i => pos.getY(i));
    const zs = verts.map(i => pos.getZ(i));
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const minZ = Math.min(...zs);
    if (verts.length === 45 && minZ > 0.65 && minY > -0.15 && maxY < 0.07 &&
        (minX > 0.2 || maxX < -0.2)) {
      eyes.push({ verts, minX, maxX, minY, maxY });
    } else if ([17, 18, 25].includes(verts.length) && minZ > 0.62 &&
               minY > 0.07 && maxY < 0.24 && (minX > 0.1 || maxX < -0.1)) {
      brows.push(verts);
    }
  }
  return eyes.length === 2 && brows.length === 6 ? { eyes, brows } : null;
}

/**
 * Paint eyes, eyelids and delicate eyelashes on the ORIGINAL skinned eye
 * triangles. A single animated canvas texture is shared by both eyes, so the
 * lids never detach from the head during skeletal animation or camera moves.
 * No extra face meshes, depth fighting, or independent eye transforms.
 */
function eyeTexture(disposables) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  disposables.push(texture);

  // Skin tones match the KayKit scientist's warm peach face. Dark-brown
  // eyelashes are deliberately short and fine (not exaggerated doll lashes).
  const skin = '#e8ae83';
  const lidEdge = '#8a5945';
  const lash = '#49342e';

  function draw(closed = 0) {
    const c = Math.max(0, Math.min(1, closed));
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = '#563a32';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#fff8ee';
    ctx.beginPath();
    ctx.ellipse(128, 128, 120, 120, 0, 0, Math.PI * 2);
    ctx.fill();

    const iris = ctx.createRadialGradient(123, 116, 7, 128, 128, 64);
    iris.addColorStop(0, '#b98147');
    iris.addColorStop(0.40, '#a46a37');
    iris.addColorStop(0.72, '#78472b');
    iris.addColorStop(0.92, '#4a3028');
    iris.addColorStop(1, '#352620');
    ctx.fillStyle = iris;
    ctx.beginPath();
    ctx.ellipse(128, 128, 62, 65, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#221918';
    ctx.beginPath();
    ctx.ellipse(128, 128, 26, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.ellipse(107, 105, 13, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,243,213,0.7)';
    ctx.beginPath();
    ctx.ellipse(147, 149, 5, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Both lids curve around the iris. The top lid closes slightly faster,
    // and the bottom lid rises a little, meeting at the eye's centre.
    const upper = (x) => {
      const edge = Math.pow(Math.abs((x - 128) / 128), 1.65);
      return (30 + 48 * edge) * (1 - c) + 130 * c;
    };
    const lower = (x) => {
      const edge = Math.pow(Math.abs((x - 128) / 128), 1.55);
      return (225 - 40 * edge) * (1 - c) + 130 * c;
    };

    // Upper eyelid, with a softly curved border following the eye surface.
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(256, 0);
    for (let x = 256; x >= 0; x -= 4) ctx.lineTo(x, upper(x));
    ctx.closePath();
    ctx.fill();

    // Lower eyelid closes against the upper lid without leaving a black gap.
    ctx.beginPath();
    ctx.moveTo(0, 256);
    ctx.lineTo(256, 256);
    for (let x = 256; x >= 0; x -= 4) ctx.lineTo(x, lower(x));
    ctx.closePath();
    ctx.fill();

    // Subtle eyelid contours (not heavy eyeliner).
    ctx.strokeStyle = lidEdge;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let x = 7; x <= 249; x += 4) {
      if (x === 7) ctx.moveTo(x, upper(x)); else ctx.lineTo(x, upper(x));
    }
    ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let x = 12; x <= 244; x += 4) {
      if (x === 12) ctx.moveTo(x, lower(x)); else ctx.lineTo(x, lower(x));
    }
    ctx.stroke();

    // A delicate upper crease is only visible while the eye is open.
    if (c < 0.65) {
      ctx.strokeStyle = `rgba(131,78,59,${(0.19 * (1 - c)).toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 36; x <= 220; x += 4) {
        const y = upper(x) - 14 * (1 - c);
        if (x === 36) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Short, outward-angled eyelashes sit ON the eyelid's leading edge.
    // As the lid moves, their roots move with it; they are never free meshes.
    ctx.strokeStyle = lash;
    ctx.lineCap = 'round';
    for (const x of [20, 38, 57, 76, 180, 199, 218, 236]) {
      const outward = x < 128 ? -1 : 1;
      const y = upper(x);
      const length = 7.5 + 3 * (Math.abs(x - 128) / 128);
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(x, y + 1);
      ctx.quadraticCurveTo(x + outward * 3, y - length * 0.5,
                           x + outward * 6, y - length);
      ctx.stroke();
    }
    texture.needsUpdate = true;
  }

  draw(0);
  return { texture, draw };
}

/** Approx. four seconds between natural quick blinks, with gentle variation. */
export function createBlinkController(draw, random = Math.random) {
  const smooth = (x) => x * x * (3 - 2 * x);
  let elapsed = 0;
  let nextBlink = 3.65 + random() * 0.7;
  let blinkTime = -1;
  let previous = 0;
  let followUp = false;
  const duration = 0.19;
  return {
    update(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      if (blinkTime < 0) {
        elapsed += dt;
        if (elapsed < nextBlink) return;
        elapsed = 0;
        blinkTime = 0;
        if (followUp) {
          followUp = false;
          nextBlink = 3.65 + random() * 0.7;
        } else {
          followUp = random() < 0.12;
          nextBlink = followUp ? 0.27 : 3.65 + random() * 0.7;
        }
      }
      blinkTime += dt;
      const t = Math.min(1, blinkTime / duration);
      const amount = t < 0.42 ? smooth(t / 0.42) : smooth((1 - t) / 0.58);
      if (Math.abs(amount - previous) > 0.015 || t >= 1) {
        draw(amount);
        previous = amount;
      }
      if (t >= 1) blinkTime = -1;
    },
    reset() {
      elapsed = 0;
      blinkTime = -1;
      followUp = false;
      previous = 0;
      nextBlink = 3.65 + random() * 0.7;
      draw(0);
    },
  };
}

export function createAriFaceMakeover(headMesh, _headBone, disposables) {
  if (!headMesh?.isSkinnedMesh) return null;
  const source = headMesh.geometry;
  const islands = getIslands(source);
  if (!islands) return null;
  const eyeArt = eyeTexture(disposables);
  if (!eyeArt) return null;
  const { texture } = eyeArt;
  const blink = createBlinkController(eyeArt.draw);

  // Eye and brow islands have their own vertices. Their UVs can therefore be
  // changed without affecting the adjacent face texture or other geometry.
  const geometry = source.clone();
  const pos = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const idx = geometry.getIndex();
  const eyeVerts = new Set();
  const browVerts = new Set();

  for (const eye of islands.eyes) {
    for (const i of eye.verts) {
      eyeVerts.add(i);
      // Reuse the model's existing curved eye surface; map iris in its own
      // local eye bounds. Both eyes have the same centred, symmetric texture.
      const u = (pos.getX(i) - eye.minX) / (eye.maxX - eye.minX);
      const v = (pos.getY(i) - eye.minY) / (eye.maxY - eye.minY);
      uv.setXY(i, 0.04 + 0.92 * u, 0.04 + 0.92 * v);
    }
  }
  for (const brow of islands.brows) {
    for (const i of brow) {
      browVerts.add(i);
      // Slim the original blocky eyebrows in place, retaining their natural
      // contour and skinning; no floating brow curves are introduced.
      pos.setY(i, 0.15 + (pos.getY(i) - 0.15) * 0.72);
    }
  }
  pos.needsUpdate = true;
  uv.needsUpdate = true;

  // One SkinnedMesh, three material groups. The original head, eyes and
  // eyebrows share exactly the same skeleton and bind matrices.
  const base = [], eyeTriangles = [], browTriangles = [];
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    const dst = eyeVerts.has(a) && eyeVerts.has(b) && eyeVerts.has(c)
      ? eyeTriangles : browVerts.has(a) && browVerts.has(b) && browVerts.has(c)
        ? browTriangles : base;
    dst.push(a, b, c);
  }
  if (eyeTriangles.length < 100 || browTriangles.length < 50) {
    texture.dispose();
    return null;
  }
  geometry.setIndex([...base, ...eyeTriangles, ...browTriangles]);
  geometry.clearGroups();
  geometry.addGroup(0, base.length, 0);
  geometry.addGroup(base.length, eyeTriangles.length, 1);
  geometry.addGroup(base.length + eyeTriangles.length, browTriangles.length, 2);
  geometry.computeBoundingSphere();

  const eyeMat = new THREE.MeshStandardMaterial({
    map: texture, roughness: 0.87, metalness: 0, side: THREE.DoubleSide,
  });
  const browMat = new THREE.MeshStandardMaterial({
    color: 0x50352d, roughness: 0.95, metalness: 0, side: THREE.DoubleSide,
  });
  disposables.push(geometry, eyeMat, browMat);
  headMesh.geometry = geometry;
  headMesh.material = [headMesh.material, eyeMat, browMat];

  return {
    method: 'original-skinned-geometry',
    eyes: islands.eyes.length,
    eyebrows: islands.brows.length,
    extraFaceMeshes: 0,
    update(dt) { blink.update(dt); },
    reset() { blink.reset(); },
  };
}
