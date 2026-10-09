import * as THREE from 'three';
import { NOISE_GLSL } from './noise.glsl.js';

/* =====================================================================
   CUSTOM SHADER — Flame (braziers in the Past, sparks in the Lab).

   A single quad that always faces the camera: in the VERTEX stage the
   quad's corners are added in VIEW space (after modelViewMatrix), so no
   matter where the camera is, the flame is seen face-on (a "billboard").
   FRAGMENT stage: a teardrop mask (narrower at the top), fbm noise
   scrolling UPWARD (uv.y - time) eats into the mask so tongues of flame
   lick and flicker, and the colour ramps white → yellow → orange → red by
   intensity. Additive blending + bloom makes it glow.
   ===================================================================== */
const flameVertex = /* glsl */`
  uniform float uSize;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    center.xy += position.xy * uSize;
    gl_Position = projectionMatrix * center;
  }
`;
const flameFragment = /* glsl */`
  uniform float uTime;
  uniform float uSeed;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying vec2 vUv;
  ${NOISE_GLSL}
  void main() {
    vec2 p = vUv - vec2(0.5, 0.0);
    float width = mix(0.5, 0.06, pow(vUv.y, 0.8));
    float mask = smoothstep(width, width * 0.2, abs(p.x)) * smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
    float n = fbm2(vec2(p.x * 3.0 + uSeed, vUv.y * 2.5 - uTime * 2.2));
    float f = clamp(mask * (n * 1.6 - vUv.y * 0.6), 0.0, 1.0);
    vec3 col = mix(uColorB, uColorA, f) * f * 2.4 + vec3(1.0, 0.85, 0.55) * pow(f, 4.0) * 1.2;
    gl_FragColor = vec4(col, f);
  }
`;

export function createFlame({ size = 0.9, colorA = 0xffa83a, colorB = 0xff2a06, seed = Math.random() * 10 } = {}) {
  const geometry = new THREE.PlaneGeometry(0.8, 1.6).translate(0, 0.8, 0);
  const material = new THREE.ShaderMaterial({
    vertexShader: flameVertex, fragmentShader: flameFragment,
    uniforms: {
      uTime: { value: 0 }, uSize: { value: size }, uSeed: { value: seed },
      uColorA: { value: new THREE.Color(colorA) }, uColorB: { value: new THREE.Color(colorB) },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return { mesh, material, update(t) { material.uniforms.uTime.value = t; }, dispose() { geometry.dispose(); material.dispose(); } };
}

/* =====================================================================
   CUSTOM SHADER — Floating particles (fireflies, dust motes, embers,
   neon data-sparks). One THREE.Points object; each particle has a random
   seed attribute. The VERTEX stage moves every particle on its own
   looping Lissajous path (sin/cos of time × seed) inside a box, so the
   CPU never touches them after creation. Point size shrinks with distance
   (perspective). The FRAGMENT stage turns each square point into a soft
   round glow (gl_PointCoord distance) that blinks on its own rhythm.
   ===================================================================== */
const particleVertex = /* glsl */`
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uSize;
  uniform vec3 uBox;
  uniform float uRise;
  varying float vBlink;
  void main() {
    vec3 p = position;
    float t = uTime * (0.3 + aSeed.x * 0.5);
    p.x += sin(t + aSeed.y * 6.28) * uBox.x * 0.15;
    p.z += cos(t * 0.8 + aSeed.z * 6.28) * uBox.z * 0.15;
    p.y += sin(t * 1.3 + aSeed.w * 6.28) * 0.4 + mod(uTime * uRise * (0.5 + aSeed.x), uBox.y);
    vBlink = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (1.5 + aSeed.w * 3.0) + aSeed.y * 40.0), 3.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * (0.6 + aSeed.z) * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const particleFragment = /* glsl */`
  uniform vec3 uColor;
  varying float vBlink;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    a = a * a * vBlink;
    gl_FragColor = vec4(uColor * a * 2.5, a);
  }
`;

export function createParticles({ count = 120, center = [0, 1, 0], box = [20, 3, 20], color = 0xfff0a0, size = 0.12, rise = 0 } = {}) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = center[0] + (Math.random() - 0.5) * box[0];
    pos[i * 3 + 1] = center[1] + (Math.random() - 0.5) * (rise ? 0 : box[1]) - (rise ? box[1] * 0.5 : 0);
    pos[i * 3 + 2] = center[2] + (Math.random() - 0.5) * box[2];
    for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const material = new THREE.ShaderMaterial({
    vertexShader: particleVertex, fragmentShader: particleFragment,
    uniforms: {
      uTime: { value: 0 }, uSize: { value: size }, uColor: { value: new THREE.Color(color) },
      uBox: { value: new THREE.Vector3(...box) }, uRise: { value: rise },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return { mesh: points, material, update(t) { material.uniforms.uTime.value = t; }, dispose() { geometry.dispose(); material.dispose(); } };
}

/* =====================================================================
   CUSTOM SHADER — Light beam (the Past's sun-mirror puzzle, lab lasers).

   An open cylinder stretched between two points. FRAGMENT stage:
     core = |dot(viewDir, normal)|^k — bright along the middle of the
     cylinder as seen from ANY angle, fading to nothing at its edges, so a
     plain cylinder reads as a soft volumetric shaft of light;
     motes = noise scrolling along the beam's length (uv.y × length − time)
     so energy visibly flows from the source toward the target.
   uIntensity is game state: beams fade in when a mirror is aligned.
   ===================================================================== */
const beamVertex = /* glsl */`
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vPosW = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const beamFragment = /* glsl */`
  uniform float uTime;
  uniform float uLength;
  uniform float uIntensity;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  ${NOISE_GLSL}
  void main() {
    vec3 viewDir = normalize(cameraPosition - vPosW);
    float core = pow(abs(dot(viewDir, normalize(vNormalW))), 2.5);
    float motes = noise2(vec2(vUv.x * 6.0, vUv.y * uLength * 1.5 - uTime * 4.0));
    float a = core * (0.55 + 0.45 * motes) * uIntensity;
    gl_FragColor = vec4(uColor * a * 3.0, a);
  }
`;

export function createBeam({ radius = 0.12, color = 0xffe2a0 } = {}) {
  const geometry = new THREE.CylinderGeometry(radius, radius, 1, 16, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    vertexShader: beamVertex, fragmentShader: beamFragment,
    uniforms: { uTime: { value: 0 }, uLength: { value: 1 }, uIntensity: { value: 1 }, uColor: { value: new THREE.Color(color) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const a = new THREE.Vector3();
  return {
    mesh, material,
    /** Stretch the beam from `from` to `to` (world positions). */
    set(from, to) {
      a.subVectors(to, from);
      const len = a.length();
      mesh.position.copy(from);
      mesh.scale.set(1, 1, Math.max(len, 0.001));
      mesh.lookAt(to);
      material.uniforms.uLength.value = len;
    },
    update(t) { material.uniforms.uTime.value = t; },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}
