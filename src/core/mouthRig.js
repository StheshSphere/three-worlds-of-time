import * as THREE from 'three';

/**
 * Ari's single, face-proportional talking mouth.
 *
 * The KayKit scientist model has a six-triangle, differently tinted mouth
 * patch which is PART OF the face surface (there is no second surface behind
 * it). The first mouth enhancement placed a round mouth too low, so both the
 * original painted lips and the added mouth were visible at once.
 *
 * We retint only the eight vertices of the original mouth patch to adjacent
 * skin tone, retaining its triangles to avoid a hole in the head. Then we
 * position a single broad, curved mouth on the original lip line. Original
 * nose, eyes, cheeks, hair and skeleton stay intact. No whole-head replacement
 * is necessary, which preserves Ari's recognizable style and expressions.
 */
const SEGMENTS = 36;
const REST_HALF_WIDTH = 0.282;
const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : 0));

/**
 * Blend the existing painted mouth patch into the surrounding skin WITHOUT
 * deleting triangles. The eight duplicated vertices are an independent UV
 * island on the front of the face. UV v=0.13 samples the adjacent skin-tone
 * region of the ORIGINAL KayKit texture. This retains the face topology,
 * skinning weights and shading, and leaves the nose/eyes completely untouched.
 *
 * Guard the exact eight-vertex layout to fail safely for other character GLBs.
 */
export function neutralizeOriginalMouth(headMesh, disposables = []) {
  const original = headMesh?.geometry;
  const pos = original?.getAttribute('position');
  const uv = original?.getAttribute('uv');
  const idx = original?.getIndex();
  if (!pos || !uv || !idx) return 0;

  const vertices = [];
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), z = pos.getZ(i), v = uv.getY(i);
    if (y > -0.45 && y < -0.34 && z > 0.70 && v > 0.15 && v < 0.17) {
      vertices.push(i);
    }
  }
  if (vertices.length !== 8) return 0;
  const selected = new Set(vertices);
  let mouthTriangles = 0;
  for (let i = 0; i < idx.count; i += 3) {
    if (selected.has(idx.getX(i)) && selected.has(idx.getX(i + 1)) && selected.has(idx.getX(i + 2))) {
      mouthTriangles++;
    }
  }
  if (mouthTriangles !== 6) return 0;

  const geo = original.clone();
  const cloneUV = geo.getAttribute('uv');
  for (const i of vertices) cloneUV.setY(i, 0.1305);
  cloneUV.needsUpdate = true;
  headMesh.geometry = geo;
  disposables.push(geo);
  return vertices.length;
}

// The original face is faceted. Conform the lips to the curvature of its
// mouth region instead of floating a circular skin patch in front of the chin.
function faceSurface(x, y) {
  return -0.008 - 0.90 * x * x - 3.4 * y * y;
}
function point(a, index, x, y, lift) {
  a.setXYZ(index, x, y, faceSurface(x, y) + lift);
}
function arch(u) {
  return Math.pow(Math.max(0, 1 - u * u), 0.67);
}
function cupid(u) {
  // Subtle Cupid's bow: two peaks either side of the centre, not a circle.
  const bump = Math.exp(-Math.pow((Math.abs(u) - 0.33) / 0.19, 2));
  const dip = Math.exp(-Math.pow(u / 0.16, 2));
  return (0.0033 * bump - 0.0017 * dip) * arch(u);
}

function ribbon() {
  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(new Float32Array((SEGMENTS + 1) * 6), 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr);
  const triangles = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const j = i * 2;
    triangles.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
  }
  geo.setIndex(triangles);
  return geo;
}

function refresh(geo) {
  geo.attributes.position.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
}

/**
 * A natural, horizontally elongated mouth: the corners always meet, the
 * centre opens vertically, and the upper/lower lips have different shapes.
 */
function updateMouthShape(inner, upper, lower, width, gape) {
  const a = inner.attributes.position;
  const b = upper.attributes.position;
  const c = lower.attributes.position;
  for (let i = 0; i <= SEGMENTS; i++) {
    const u = i / SEGMENTS * 2 - 1;
    const x = u * width;
    const taper = arch(u);
    const bow = cupid(u);
    const topY = (gape * 0.34) * taper + bow;
    const botY = -(gape * 0.66) * taper - 0.0015 * taper;
    const topThickness = 0.0095 * taper;
    const bottomThickness = 0.011 * taper;

    // Inside: a dark horizontal opening bounded by actual lip contours.
    point(a, i * 2, x, topY, 0.022);
    point(a, i * 2 + 1, x, botY, 0.022);
    // Upper lip, with a gentle Cupid's bow.
    point(b, i * 2, x, topY, 0.027);
    point(b, i * 2 + 1, x, topY + topThickness, 0.027);
    // Lower lip, fuller than the upper lip.
    point(c, i * 2, x, botY, 0.027);
    point(c, i * 2 + 1, x, botY - bottomThickness, 0.027);
  }
  refresh(inner);
  refresh(upper);
  refresh(lower);
}

function updateDetail(geo, halfWidth, centreY, height, lift) {
  const a = geo.attributes.position;
  for (let i = 0; i <= SEGMENTS; i++) {
    const u = i / SEGMENTS * 2 - 1;
    const x = u * halfWidth;
    const taper = arch(u);
    point(a, i * 2, x, centreY + height * taper, lift);
    point(a, i * 2 + 1, x, centreY - height * taper, lift);
  }
  refresh(geo);
}

export function createAriMouth(headMesh, headBone, disposables) {
  if (!headMesh?.isSkinnedMesh || !headBone) return null;
  const boneIndex = headMesh.skeleton.bones.indexOf(headBone);
  if (boneIndex < 0) return null;

  // Never add a second mouth on top of the old painted lip patch.
  if (neutralizeOriginalMouth(headMesh, disposables) !== 8) return null;

  const mouth = new THREE.Group();
  mouth.name = 'AriSingleAnimatedMouth';
  // Mouth centre from the real KayKit face mesh: y=-0.402, z=0.848.
  // The previous enhancement placed its mouth at y=-0.545 (chin), creating
  // the double-mouth effect. Keep the lips aligned with the original line.
  mouth.position.set(0, -0.402, 0.848).applyMatrix4(headMesh.skeleton.boneInverses[boneIndex]);
  headBone.add(mouth);

  const innerMat = new THREE.MeshStandardMaterial({ color: 0x542c33, roughness: 0.95, side: THREE.DoubleSide });
  const lipMat = new THREE.MeshStandardMaterial({ color: 0xb77a70, roughness: 0.93, side: THREE.DoubleSide });
  const teethMat = new THREE.MeshStandardMaterial({ color: 0xf8e5d4, roughness: 0.85, side: THREE.DoubleSide });
  const tongueMat = new THREE.MeshStandardMaterial({ color: 0xc5787d, roughness: 0.93, side: THREE.DoubleSide });
  disposables.push(innerMat, lipMat, teethMat, tongueMat);

  const openingGeo = ribbon();
  const upperGeo = ribbon();
  const lowerGeo = ribbon();
  const teethGeo = ribbon();
  const tongueGeo = ribbon();
  disposables.push(openingGeo, upperGeo, lowerGeo, teethGeo, tongueGeo);

  function part(name, geometry, material) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mouth.add(mesh);
    return mesh;
  }
  const opening = part('AriMouthOpening', openingGeo, innerMat);
  part('AriUpperLip', upperGeo, lipMat);
  part('AriLowerLip', lowerGeo, lipMat);
  const teeth = part('AriMouthTeeth', teethGeo, teethMat);
  const tongue = part('AriMouthTongue', tongueGeo, tongueMat);

  let previous = '';
  function setMouth(weights = {}, openingAmount = 0) {
    const aa = clamp(weights.aa);
    const wide = clamp(weights.wide);
    const round = clamp(weights.round);
    const teethWeight = clamp(weights.teeth);
    const protrude = clamp(weights.protrude);
    const open = clamp(openingAmount);

    // The original painted lip line spans ~0.63 world units. Our neutral
    // expression spans 0.564, proportionate to Ari's eyes and nose. Even
    // rounded vowels are HORIZONTAL OVALS rather than circular holes.
    const width = clamp(REST_HALF_WIDTH + 0.034 * wide - 0.047 * round - 0.023 * protrude, 0.207, 0.324);
    const gape = clamp(0.0035 + 0.112 * open - 0.011 * teethWeight, 0.0035, 0.119);
    const teethShow = clamp(teethWeight * 0.78 + wide * 0.30);
    const key = [width, gape, teethShow, aa].map(x => x.toFixed(4)).join(',');
    if (key === previous) return;
    previous = key;

    updateMouthShape(openingGeo, upperGeo, lowerGeo, width, gape);
    opening.visible = gape > 0.009;
    teeth.visible = gape > 0.013 && teethShow > 0.20;
    if (teeth.visible) {
      updateDetail(teethGeo, width * 0.77, gape * 0.18, Math.min(0.0058, gape * 0.13), 0.024);
    }
    tongue.visible = gape > 0.027 && aa > 0.25;
    if (tongue.visible) {
      updateDetail(tongueGeo, width * 0.52, -gape * 0.43, Math.min(0.006, gape * 0.12), 0.024);
    }
  }
  setMouth({}, 0);
  return { setMouth, group: mouth };
}
