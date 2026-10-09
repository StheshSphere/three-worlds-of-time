import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { NOISE_GLSL } from './noise.glsl.js';

/**
 * CUSTOM SHADER — Reflective temple pool (3D Effects: reflections).
 *
 * three.js's Reflector renders the scene from a camera mirrored below the
 * water plane into a texture each frame. We replace Reflector's built-in
 * shader with our own:
 *   - textureMatrix projects each water pixel into that mirror texture
 *     (projective texturing: texture2DProj).
 *   - A procedural ripple normal (gradient of two scrolling fbm noise layers)
 *     offsets the lookup so the reflection wobbles like real water.
 *   - Fresnel: looking straight down you see the deep water colour, at
 *     grazing angles you see mostly reflection — exactly like a real pond.
 *   - A sun glint: specular highlight from the ripple normal and uSunDir.
 *   - Scene fog is applied so the pool fades into the distance with the rest
 *     of the level.
 * Low quality preset: no mirror render; a glossy standard material is used.
 */
const WaterShader = {
  name: 'TempleWater',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(0x0d3b3a) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(0xffd7a0) },
    fogColor: { value: new THREE.Color() },
    fogDensity: { value: 0 },
  },
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix;
    varying vec4 vUvProj;
    varying vec3 vPosW;
    varying float vFogDepth;
    void main() {
      vUvProj = textureMatrix * vec4(position, 1.0);
      vec4 world = modelMatrix * vec4(position, 1.0);
      vPosW = world.xyz;
      vec4 mv = viewMatrix * world;
      vFogDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec3 color;
    uniform float uTime;
    uniform vec3 uDeep;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 fogColor;
    uniform float fogDensity;
    varying vec4 vUvProj;
    varying vec3 vPosW;
    varying float vFogDepth;
    ${NOISE_GLSL}

    float height(vec2 p) {
      return fbm2(p * 1.3 + vec2(uTime * 0.25, uTime * 0.18)) + 0.5 * fbm2(p * 2.7 - vec2(uTime * 0.31, -uTime * 0.12));
    }

    void main() {
      vec2 p = vPosW.xz;
      float e = 0.08;
      vec3 n = normalize(vec3(height(p - vec2(e, 0.0)) - height(p + vec2(e, 0.0)), 0.6, height(p - vec2(0.0, e)) - height(p + vec2(0.0, e))));
      vec4 proj = vUvProj;
      proj.xy += n.xz * 0.6;
      vec3 refl = texture2DProj(tDiffuse, proj).rgb;
      vec3 viewDir = normalize(cameraPosition - vPosW);
      float fresnel = 0.08 + 0.92 * pow(1.0 - max(dot(viewDir, n), 0.0), 4.0);
      vec3 col = mix(uDeep, refl * color, fresnel);
      vec3 h = normalize(viewDir + normalize(uSunDir));
      col += uSunColor * pow(max(dot(n, h), 0.0), 240.0) * 3.0;
      float fog = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      gl_FragColor = vec4(mix(col, fogColor, fog), 1.0);
    }
  `,
};

export function createWater(width, depth, { quality, sunDir, scene } = {}) {
  const geometry = new THREE.PlaneGeometry(width, depth);
  if (quality && !quality.reflections) {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x0e3c3a, roughness: 0.08, metalness: 0.2 }));
    mesh.rotation.x = -Math.PI / 2;
    return { mesh, update() {}, dispose() { geometry.dispose(); mesh.material.dispose(); } };
  }
  const scale = quality && quality.pixelRatio > 1 ? 0.5 : 0.35;
  const mesh = new Reflector(geometry, {
    shader: WaterShader,
    textureWidth: Math.round(window.innerWidth * scale),
    textureHeight: Math.round(window.innerHeight * scale),
    color: 0xb9c9c4,
    clipBias: 0.003,
  });
  mesh.rotation.x = -Math.PI / 2;
  const u = mesh.material.uniforms;
  if (sunDir) u.uSunDir.value.copy(sunDir);
  return {
    mesh,
    update(t) {
      u.uTime.value = t;
      if (scene && scene.fog) { u.fogColor.value.copy(scene.fog.color); u.fogDensity.value = scene.fog.density; }
    },
    dispose() { mesh.dispose(); },
  };
}
