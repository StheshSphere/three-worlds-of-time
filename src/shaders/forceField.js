import * as THREE from 'three';
import { NOISE_GLSL } from './noise.glsl.js';

/**
 * CUSTOM SHADER — Time Machine force field (vertex + fragment).
 *
 * VERTEX stage: every vertex of a sphere is pushed outward along its normal
 * by 3D noise that scrolls with uTime, so the shell "breathes" and wobbles.
 * The wobble amplitude is driven by GAME STATE: uUnstable is high while the
 * machine is broken and drops as cores are returned (uCores 0→3).
 *
 * FRAGMENT stage:
 *   - Fresnel rim: 1 - |dot(viewDir, normal)| is ~0 facing the camera and
 *     ~1 at the silhouette, so the field is see-through in the middle and
 *     glows at the edges — like a soap bubble or energy shield.
 *   - Hexagon grid in the sphere's UVs, brightened by a band that sweeps
 *     upward over time ("scan").
 *   - The colour blends from crackling red-orange (broken) to the restored
 *     gold-white as uCores rises.
 * Additive blending + no depth write keeps it a glowing overlay.
 * uIntensity scales the whole shell (fades it to nothing); uBrokenColor /
 * uFixedColor are the two ends of the uCores colour ramp.
 */
const vertexShader = /* glsl */`
  uniform float uTime;
  uniform float uUnstable;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  ${NOISE_GLSL}
  void main() {
    vUv = uv;
    float n = noise3(position * 2.2 + vec3(0.0, uTime * 0.9, uTime * 0.4));
    vec3 displaced = position + normal * (n - 0.5) * (0.06 + uUnstable * 0.22);
    vec4 world = modelMatrix * vec4(displaced, 1.0);
    vPosW = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */`
  uniform float uTime;
  uniform float uCores;
  uniform float uIntensity;
  uniform vec3 uBrokenColor;
  uniform vec3 uFixedColor;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;

  // distance to the nearest hexagon edge (0 at edge)
  float hexEdge(vec2 p) {
    p.x *= 1.1547;
    p.y += mod(floor(p.x), 2.0) * 0.5;
    p = abs(fract(p) - 0.5);
    return abs(max(p.x * 1.5 + p.y, p.y * 2.0) - 1.0);
  }

  void main() {
    vec3 viewDir = normalize(cameraPosition - vPosW);
    float fresnel = pow(1.0 - abs(dot(viewDir, normalize(vNormalW))), 2.2);
    float hex = 1.0 - smoothstep(0.0, 0.08, hexEdge(vUv * vec2(24.0, 12.0)));
    float scan = smoothstep(0.08, 0.0, abs(fract(vUv.y * 1.5 - uTime * 0.25) - 0.5) - 0.38);
    float flicker = 0.85 + 0.15 * sin(uTime * 23.0 + vUv.y * 40.0) * (1.0 - uCores / 3.0);
    vec3 color = mix(uBrokenColor, uFixedColor, clamp(uCores / 3.0, 0.0, 1.0));
    float a = (fresnel * 0.9 + hex * (0.12 + scan * 0.45) * (0.4 + fresnel)) * flicker * uIntensity;
    gl_FragColor = vec4(color * a * 2.2, a);
  }
`;

export function createForceFieldMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uCores: { value: 0 },
      uUnstable: { value: 1 },
      uIntensity: { value: 1 },
      uBrokenColor: { value: new THREE.Color(0xff5a2a) },
      uFixedColor: { value: new THREE.Color(0xffd98a) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}
