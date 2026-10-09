import * as THREE from 'three';
import { NOISE_GLSL } from './noise.glsl.js';

/**
 * CUSTOM SHADER — Interactive wind-blown grass (instanced).
 *
 * Thousands of grass blades are ONE InstancedMesh: one small blade geometry,
 * drawn N times with a different instanceMatrix (position/rotation/scale)
 * each — a single draw call.
 *
 * VERTEX stage (all the motion happens on the GPU, none in JavaScript):
 *   - bend = local height² so the root stays planted and the tip moves most,
 *   - wind: noise sampled at the blade's world position, scrolled by uTime,
 *     gives gusts that travel across the field,
 *   - player interaction: blades within ~1.3 m of uPlayer are pushed away
 *     from the player, so you visibly part the grass as you walk.
 * FRAGMENT stage: root-to-tip colour gradient, per-blade colour variation
 * (hash of world position), a simple sun term with back-lit translucency, and
 * exponential fog matching the scene.
 */
const vertexShader = /* glsl */`
  uniform float uTime;
  uniform vec3 uPlayer;
  varying float vHeight;
  varying float vVariant;
  varying float vFogDepth;
  varying vec3 vPosW;
  ${NOISE_GLSL}
  void main() {
    vHeight = position.y;
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vVariant = hash12(root.xz);
    float bend = position.y * position.y;
    float gust = noise2(root.xz * 0.15 + vec2(uTime * 0.35, uTime * 0.2));
    vec2 wind = vec2(0.55, 0.35) * (gust * 1.4 - 0.25) + 0.08 * sin(uTime * 3.0 + root.x * 1.7 + root.z);
    world.xz += wind * bend;
    vec2 away = root.xz - uPlayer.xz;
    float d = length(away);
    float push = smoothstep(1.3, 0.0, d) * step(abs(root.y - uPlayer.y), 1.5);
    world.xz += normalize(away + 1e-4) * push * bend * 0.9;
    world.y -= push * bend * 0.35;
    vPosW = world.xyz;
    vec4 mv = viewMatrix * world;
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */`
  uniform vec3 uBase;
  uniform vec3 uTip;
  uniform vec3 uDry;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uAmbient;
  uniform vec3 fogColor;
  uniform float fogDensity;
  varying float vHeight;
  varying float vVariant;
  varying float vFogDepth;
  varying vec3 vPosW;
  void main() {
    vec3 col = mix(uBase, mix(uTip, uDry, smoothstep(0.6, 1.0, vVariant)), vHeight);
    vec3 viewDir = normalize(cameraPosition - vPosW);
    float back = pow(max(dot(-viewDir, normalize(uSunDir)), 0.0), 3.0) * vHeight;
    vec3 lit = col * (uAmbient + uSunColor * (0.55 + 0.45 * vHeight)) + uSunColor * col * back * 1.5;
    float fog = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    gl_FragColor = vec4(mix(lit, fogColor, fog), 1.0);
  }
`;

function bladeGeometry() {
  // 3 segments, tapering to a point: 7 vertices, 5 triangles.
  const h = [0, 0.35, 0.7, 1];
  const w = [0.035, 0.03, 0.018, 0];
  const pos = [];
  for (let i = 0; i < 3; i++) pos.push(-w[i], h[i], 0, w[i], h[i], 0);
  pos.push(0, 1, 0);
  const idx = [0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5, 4, 5, 6];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/**
 * patches: [{ x, z, w, d, y }] rectangles to fill; count: total blades.
 * avoid(x, z) → true to skip a spot (paths, walls).
 */
export function createGrass({ patches, count, sunDir, sunColor = 0xffd7a0, avoid, heightAt }) {
  const geometry = bladeGeometry();
  const material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uPlayer: { value: new THREE.Vector3(0, -100, 0) },
      uBase: { value: new THREE.Color(0x15260c) },
      uTip: { value: new THREE.Color(0x58842a) },
      uDry: { value: new THREE.Color(0x9a8a4a) },
      uSunDir: { value: sunDir ? sunDir.clone() : new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(sunColor).multiplyScalar(0.9) },
      uAmbient: { value: new THREE.Color(0x4a5a6a) },
      fogColor: { value: new THREE.Color() },
      fogDensity: { value: 0 },
    },
    side: THREE.DoubleSide,
  });
  const totalArea = patches.reduce((a, p) => a + p.w * p.d, 0);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let n = 0;
  for (const patch of patches) {
    const share = Math.round(count * (patch.w * patch.d) / totalArea);
    for (let i = 0; i < share * 1.5 && n < count; i++) {
      const x = patch.x + (Math.random() - 0.5) * patch.w;
      const z = patch.z + (Math.random() - 0.5) * patch.d;
      if (avoid && avoid(x, z)) continue;
      const y = heightAt ? heightAt(x, z) : (patch.y || 0);
      q.setFromAxisAngle(up, Math.random() * Math.PI);
      const hgt = 0.25 + Math.random() * 0.45;
      s.set(1 + Math.random() * 0.6, hgt, 1);
      m.compose(p.set(x, y, z), q, s);
      mesh.setMatrixAt(n++, m);
    }
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return {
    mesh,
    update(t, playerPos, scene) {
      material.uniforms.uTime.value = t;
      if (playerPos) material.uniforms.uPlayer.value.copy(playerPos);
      if (scene && scene.fog) { material.uniforms.fogColor.value.copy(scene.fog.color); material.uniforms.fogDensity.value = scene.fog.density; }
    },
    dispose() { geometry.dispose(); material.dispose(); mesh.dispose(); },
  };
}
