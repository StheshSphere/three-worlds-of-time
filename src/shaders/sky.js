import * as THREE from 'three';
import { NOISE_GLSL } from './noise.glsl.js';

/**
 * CUSTOM SHADER — Procedural sky dome (one shader, three moods).
 *
 * A huge inside-out sphere follows the camera. For each pixel the fragment
 * shader gets the view DIRECTION (vDir) and builds the sky from it:
 *   1. a vertical gradient horizon → zenith (dir.y),
 *   2. a sun disc + glow (dot(dir, sunDir) raised to powers),
 *   3. clouds: the direction is projected onto a flat "cloud plane"
 *      (dir.xz / dir.y), then fbm noise scrolled by uTime gives moving
 *      clouds, lit brighter on the side facing the sun,
 *   4. stars: hash noise on a quantised direction grid, twinkling over time,
 *   5. a nebula: two fbm layers mixed between two colours,
 *   6. uFlash brightens everything for lightning (game state drives it).
 *
 * The vertex shader sets gl_Position.z = gl_Position.w, which puts every sky
 * pixel exactly on the far plane — the sky can never cover level geometry.
 *
 * The same dome is also rendered once into a PMREM cube map, so the sky
 * LIGHTS the scene (image-based lighting / reflections) — what you see in
 * the sky is what metal and water reflect.
 *
 * UNIFORMS: the mood is set once from a PRESETS entry (uZenith/uHorizon/
 * uGround gradient, uSunDir/uSunColor/uSunSize, uCloudCover/uCloudColor/
 * uCloudShadow, uStars, uNebula/uNebulaA/uNebulaB, uCityGlow/uCityColor);
 * only uTime and uFlash are written per frame (sky.update and the lab's
 * lightning timer). All uniforms are used in the FRAGMENT stage — the
 * vertex stage only places the dome and passes the direction through.
 */
const vertexShader = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const fragmentShader = /* glsl */`
  varying vec3 vDir;
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunColor;
  uniform float uSunSize;
  uniform float uCloudCover;
  uniform vec3 uCloudColor;
  uniform vec3 uCloudShadow;
  uniform float uStars;
  uniform float uNebula;
  uniform vec3 uNebulaA;
  uniform vec3 uNebulaB;
  uniform float uFlash;
  uniform float uCityGlow;
  uniform vec3 uCityColor;
  ${NOISE_GLSL}

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;

    // 1. gradient
    vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.45));
    col = mix(col, uGround, smoothstep(0.0, -0.22, h));

    // 2. sun
    float sd = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSunColor * (pow(sd, 6.0) * 0.28 + pow(sd, 48.0) * 0.55);
    col += uSunColor * smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.55, sd) * 7.0;

    // 4. stars (only above the horizon)
    if (uStars > 0.0) {
      vec3 cell = floor(d * 260.0);
      float s = hash13(cell);
      float star = smoothstep(0.9965, 1.0, s);
      float twinkle = 0.55 + 0.45 * sin(uTime * (2.0 + s * 4.0) + s * 91.0);
      col += vec3(0.85, 0.9, 1.0) * star * twinkle * uStars * smoothstep(-0.02, 0.25, h) * 3.0;
    }

    // 5. nebula
    if (uNebula > 0.0) {
      float n = fbm3(d * 2.2 + vec3(0.0, uTime * 0.006, 0.0));
      float n2 = fbm3(d * 4.5 - vec3(uTime * 0.01));
      vec3 neb = mix(uNebulaA, uNebulaB, smoothstep(0.3, 0.7, n2));
      col += neb * smoothstep(0.42, 0.85, n) * uNebula * smoothstep(-0.15, 0.35, h);
    }

    // 3. clouds
    if (uCloudCover > 0.0 && h > 0.0) {
      vec2 uv = d.xz / (h + 0.12) * 1.3 + vec2(uTime * 0.006, uTime * 0.003);
      float c = fbm2(uv * 1.1);
      float cover = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.32, c);
      float lit = 0.5 + 0.5 * sd;
      vec3 cc = mix(uCloudShadow, uCloudColor, lit);
      cc += uSunColor * pow(sd, 5.0) * 0.45;        // silver lining toward the sun
      cc *= 1.0 + uFlash * 5.0;                      // lightning lights the clouds
      col = mix(col, cc, cover * smoothstep(0.0, 0.2, h));
    }

    // 6. city glow + lightning wash
    col += uCityColor * uCityGlow * exp(-abs(h) * 10.0);
    col += vec3(0.55, 0.65, 1.0) * uFlash * 0.18;

    gl_FragColor = vec4(col, 1.0);
  }
`;

const PRESETS = {
  ruins: {
    zenith: 0x3a6db5, horizon: 0xffc48a, ground: 0x5a4a3a, sunColor: 0xffcf96,
    sunDir: [-0.62, 0.2, -0.58], sunSize: 0.0016, cloudCover: 0.5,
    cloudColor: 0xfff1df, cloudShadow: 0x8a7a8e, stars: 0, nebula: 0, cityGlow: 0,
  },
  lab: {
    zenith: 0x05070e, horizon: 0x1b2536, ground: 0x040509, sunColor: 0x7d93b8,
    sunDir: [0.35, 0.55, 0.5], sunSize: 0.0008, cloudCover: 0.82,
    cloudColor: 0x3a4558, cloudShadow: 0x0b0f17, stars: 0.15, nebula: 0, cityGlow: 0.35, cityColor: 0x3a5a88,
  },
  neon: {
    zenith: 0x06021a, horizon: 0x3c0f52, ground: 0x07000f, sunColor: 0x000000,
    sunDir: [0, 1, 0], sunSize: 0.0, cloudCover: 0, cloudColor: 0, cloudShadow: 0,
    stars: 1, nebula: 1, nebulaA: 0xff2fb4, nebulaB: 0x2fd8ff, cityGlow: 1, cityColor: 0xff3aa8,
  },
};

export function createSky(presetName) {
  const p = PRESETS[presetName];
  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(...p.sunDir).normalize() },
    uZenith: { value: new THREE.Color(p.zenith) },
    uHorizon: { value: new THREE.Color(p.horizon) },
    uGround: { value: new THREE.Color(p.ground) },
    uSunColor: { value: new THREE.Color(p.sunColor) },
    uSunSize: { value: p.sunSize },
    uCloudCover: { value: p.cloudCover },
    uCloudColor: { value: new THREE.Color(p.cloudColor) },
    uCloudShadow: { value: new THREE.Color(p.cloudShadow) },
    uStars: { value: p.stars },
    uNebula: { value: p.nebula },
    uNebulaA: { value: new THREE.Color(p.nebulaA || 0) },
    uNebulaB: { value: new THREE.Color(p.nebulaB || 0) },
    uFlash: { value: 0 },
    uCityGlow: { value: p.cityGlow },
    uCityColor: { value: new THREE.Color(p.cityColor || 0) },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const geometry = new THREE.SphereGeometry(300, 48, 24);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `Sky:${presetName}`;
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return {
    mesh,
    uniforms,
    sunDir: uniforms.uSunDir.value,
    horizon: uniforms.uHorizon.value,
    /** Keep the dome centred on the camera so it never gets closer. */
    update(camera, time) {
      mesh.position.copy(camera.position);
      uniforms.uTime.value = time;
    },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}
