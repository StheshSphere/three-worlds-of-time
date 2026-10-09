import * as THREE from 'three';
import { NOISE_GLSL } from './noise.glsl.js';

/* =====================================================================
   CUSTOM SHADER — Procedural skyscrapers (instanced).
   Hundreds of towers are ONE InstancedMesh of unit boxes. The FRAGMENT
   stage invents the windows: the world position on each wall is divided
   into a grid of floors × columns; a hash of the cell index decides
   whether that window is lit, its colour (cyan / magenta / amber), and
   when it flickers. Roof edges get a neon trim band. No textures at all —
   a whole city from arithmetic. Fog makes far towers fade into the haze.
   ===================================================================== */
export function createCity({ count = 220, inner = 26, outer = 140, avoid } = {}) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0);
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec3 vPosW;
      varying vec3 vNormalW;
      varying vec3 vLocal;
      varying vec3 vScale;
      varying float vFogDepth;
      void main() {
        vLocal = position;
        vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vPosW = w.xyz;
        vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        vec4 mv = viewMatrix * w;
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 fogColor;
      uniform float fogDensity;
      varying vec3 vPosW;
      varying vec3 vNormalW;
      varying vec3 vLocal;
      varying vec3 vScale;
      varying float vFogDepth;
      ${NOISE_GLSL}
      void main() {
        vec3 n = normalize(vNormalW);
        vec3 base = vec3(0.025, 0.02, 0.045);
        vec3 col = base * (0.6 + 0.4 * n.y);
        if (abs(n.y) < 0.5) {
          // walls: window grid in metres along the facade
          float u = (abs(n.x) > 0.5 ? vPosW.z : vPosW.x);
          vec2 cell = vec2(floor(u / 1.6), floor(vPosW.y / 2.2));
          vec2 f = fract(vec2(u / 1.6, vPosW.y / 2.2));
          float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.75);
          float h = hash12(cell + floor(vPosW.x * 0.01) * 13.0 + floor(vPosW.z * 0.01) * 7.0);
          float lit = step(0.58, h) * (0.75 + 0.25 * step(0.02, fract(h * 91.0 + uTime * 0.05)));
          vec3 wc = h > 0.9 ? vec3(1.0, 0.25, 0.8) : h > 0.75 ? vec3(0.2, 0.85, 1.0) : vec3(1.0, 0.72, 0.38);
          col += wc * win * lit * 1.15;
          // neon trim near the roof
          float top = vLocal.y * vScale.y;
          float trim = smoothstep(0.35, 0.0, abs(top - (vScale.y - 1.2)));
          vec3 tc = mod(cell.x, 2.0) < 1.0 ? vec3(1.0, 0.2, 0.75) : vec3(0.2, 0.85, 1.0);
          col += tc * trim * 2.5 * step(0.5, hash12(vec2(floor(vPosW.x * 0.03), floor(vPosW.z * 0.03))));
        }
        float fog = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
        gl_FragColor = vec4(mix(col, fogColor, fog), 1.0);
      }
    `,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < count * 3 && n < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = inner + Math.pow(Math.random(), 0.7) * (outer - inner);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r - 60;
    if (avoid && avoid(x, z)) continue;
    const w = 6 + Math.random() * 10;
    const h = 30 + Math.pow(Math.random(), 1.6) * 140;
    p.set(x, -120, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.floor(Math.random() * 4) * Math.PI / 2);
    s.set(w, h, w * (0.7 + Math.random() * 0.6));
    m.compose(p, q, s);
    mesh.setMatrixAt(n++, m);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return {
    mesh,
    update(t, scene) {
      material.uniforms.uTime.value = t;
      if (scene.fog) { material.uniforms.fogColor.value.copy(scene.fog.color); material.uniforms.fogDensity.value = scene.fog.density; }
    },
    dispose() { geometry.dispose(); material.dispose(); mesh.dispose(); },
  };
}

/* =====================================================================
   CUSTOM SHADER — Synthwave grid far below the platforms.
   Grid lines come from fract() of world position (with fwidth() for
   constant-width antialiased lines at any distance); the grid scrolls
   toward the horizon over time and fades out with distance.
   ===================================================================== */
export function createGridFloor() {
  const geometry = new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xff3fc8) } },
    extensions: { derivatives: true },
    vertexShader: /* glsl */`
      varying vec3 vPosW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vPosW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uColor;
      varying vec3 vPosW;
      void main() {
        vec2 g = vPosW.xz / 8.0 + vec2(0.0, uTime * 0.6);
        vec2 w = fwidth(g) * 1.2;
        vec2 l = smoothstep(w, vec2(0.0), abs(fract(g - 0.5) - 0.5));
        float line = max(l.x, l.y);
        float dist = length(vPosW.xz - cameraPosition.xz);
        float fade = exp(-dist * 0.006);
        vec3 col = uColor * line * 2.2 * fade + vec3(0.06, 0.0, 0.08) * fade;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, update(t) { material.uniforms.uTime.value = t; }, dispose() { geometry.dispose(); material.dispose(); } };
}

/* =====================================================================
   CUSTOM SHADER — Flying traffic (instanced, animated on the GPU).
   Each car is an instance with an attribute aLane = (x, y, z-offset,
   speed). The VERTEX stage moves it along its lane with
   mod(time × speed + offset, length): JavaScript never updates a car.
   Head/tail lights are just emissive colour chosen by which end of the
   box a vertex is on.
   ===================================================================== */
export function createTraffic({ count = 140, length = 400, zCenter = -60 } = {}) {
  const geometry = new THREE.BoxGeometry(0.9, 0.35, 2.2);
  const lane = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    lane[i * 4] = side * (22 + Math.random() * 60);
    lane[i * 4 + 1] = -8 + Math.random() * 40;
    lane[i * 4 + 2] = Math.random() * length;
    lane[i * 4 + 3] = (8 + Math.random() * 18) * (Math.random() < 0.5 ? -1 : 1);
  }
  geometry.setAttribute('aLane', new THREE.InstancedBufferAttribute(lane, 4));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLength: { value: length }, uZ: { value: zCenter } },
    vertexShader: /* glsl */`
      attribute vec4 aLane;
      uniform float uTime;
      uniform float uLength;
      uniform float uZ;
      varying float vEnd;
      void main() {
        float dir = sign(aLane.w);
        float z = mod(aLane.z + uTime * abs(aLane.w), uLength) - uLength * 0.5;
        vec3 p = position;
        p.z *= dir;
        vEnd = position.z * dir;
        vec3 world = vec3(aLane.x, aLane.y, uZ + z * dir) + p;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying float vEnd;
      void main() {
        vec3 head = vec3(1.0, 0.95, 0.8) * 3.0;
        vec3 tail = vec3(1.0, 0.1, 0.25) * 3.0;
        vec3 body = vec3(0.04, 0.03, 0.06);
        vec3 col = vEnd > 0.9 ? head : vEnd < -0.9 ? tail : body;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  return { mesh, update(t) { material.uniforms.uTime.value = t; }, dispose() { geometry.dispose(); material.dispose(); mesh.dispose(); } };
}

/* =====================================================================
   CUSTOM SHADER INJECTION — Phase dissolve for platforms flickering in
   and out of time. We keep three.js's full PBR lighting (MeshStandard)
   and patch its GLSL with onBeforeCompile:
     vertex   → pass the world position to the fragment stage,
     fragment → noise(worldPos) > uPhase ⇒ discard (the platform has holes
                eaten out of it), and pixels just inside the dissolve edge
                get a hot neon rim added to the emissive light.
   uPhase 1 = solid, 0 = gone; the level animates it on a timer.
   ===================================================================== */
export function phaseMaterial(base, edgeColor = 0x6ff0ff) {
  const m = base.clone();
  const uniforms = { uPhase: { value: 1 }, uEdge: { value: new THREE.Color(edgeColor) } };
  m.userData.phase = uniforms;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPhase = uniforms.uPhase;
    shader.uniforms.uEdge = uniforms.uEdge;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPhasePos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvPhasePos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPhasePos;\nuniform float uPhase;\nuniform vec3 uEdge;\n${NOISE_GLSL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float phaseN = noise3(vPhasePos * 1.4) * 0.7 + noise3(vPhasePos * 4.0) * 0.3;
        if (phaseN > uPhase) discard;
        totalEmissiveRadiance += uEdge * smoothstep(uPhase - 0.09, uPhase, phaseN) * 5.0 * step(uPhase, 0.999);`);
  };
  m.customProgramCacheKey = () => 'phase-dissolve';
  return m;
}
