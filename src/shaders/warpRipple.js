import * as THREE from 'three';

/**
 * CUSTOM SHADER — Time Machine warp ripple (transition / restoration).
 *
 * A flat ring lying on the ground around the dais that turns the machine's
 * state into a visible shockwave: while the machine charges an era jump (the
 * level manager ramps it during the warp out/in) and while it restores itself
 * in the finale, concentric bands of energy race outward across the floor.
 * The rest of the time only a faint idle pulse remains, so the machine always
 * reads as alive without shouting over gameplay.
 *
 * GAME-STATE UNIFORMS (written by timeMachine.update every frame, no allocations):
 *   uCharge 0..1 — era-transition warp strength, restoration progress or the
 *                  prologue's overload, whichever is loudest. Scales the ring
 *                  speed, ring count, brightness AND the vertex displacement.
 *   uCores  0..3 — cores seated in the sockets; colour shifts crackling
 *                  red-orange → restored gold, same language as the force field.
 *   uTime        — the running clock; keeps the rings flowing.
 *
 * VERTEX stage: a travelling swell `sin(r·k − t·s)` displaces the ring along
 * its normal (up); the amplitude grows with uCharge, so the surge visibly
 * lifts off the ground instead of being painted on it.
 * FRAGMENT stage: `fract(r·k − t·s)` sawtooth bands (sharp front, soft trail)
 * expand outward, shaped by a radial envelope and a slow angular wobble so
 * the rings are never perfect circles.
 *
 * Cheap by design: one draw call, ~400 triangles, no textures and no noise
 * lookups — just sin/smoothstep — additive + depthWrite:false like the force
 * field and the beacons.
 */
const vertexShader = /* glsl */`
  uniform float uTime;
  uniform float uCharge;
  varying float vR;     // distance from the machine's axis, world units
  varying float vAng;   // polar angle, for the slow wobble
  void main() {
    vR = length(position.xy);
    vAng = atan(position.y, position.x);
    // Travelling swell along the radius; the crest lifts as the charge rises.
    vec3 p = position;
    p.z += sin(vR * 3.4 - uTime * (2.0 + uCharge * 7.0)) * (0.02 + uCharge * 0.16);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  uniform float uTime;
  uniform float uCharge;
  uniform float uCores;
  uniform vec3 uBrokenColor;
  uniform vec3 uFixedColor;
  varying float vR;
  varying float vAng;

  // Ring extents — must match the RingGeometry built in timeMachine.js.
  const float INNER = 3.55;
  const float OUTER = 7.2;

  void main() {
    float r = clamp((vR - INNER) / (OUTER - INNER), 0.0, 1.0);  // 0 at the dais edge → 1 at the rim
    // Radial envelope: fade in past the dais, melt away at the rim.
    float env = smoothstep(0.0, 0.16, r) * (1.0 - smoothstep(0.55, 0.98, r));
    // Expanding bands: sharp front with a decaying trail; more of them and
    // faster as the machine charges. The front sits at phase = whole numbers,
    // which move outward as uTime advances.
    float phase = r * (4.0 + uCharge * 3.0) - uTime * (1.2 + uCharge * 3.5);
    float band = pow(fract(phase), 3.0);
    // Slow angular wobble — the timeline is organic, the machine is not.
    float wobble = 0.85 + 0.15 * sin(vAng * 5.0 + uTime * 0.8 + r * 3.0);
    // The machine always hums faintly; a charge makes it shout. (Additive
    // blending squares the energy, so 0.15 here lands at ~2-5% brightness.)
    float idle = 0.15 * (0.6 + 0.4 * sin(uTime * 1.3 - r * 6.0));
    float energy = (idle + uCharge * band * 1.15) * env * wobble;
    vec3 color = mix(uBrokenColor, uFixedColor, clamp(uCores / 3.0, 0.0, 1.0));
    gl_FragColor = vec4(color * energy * 2.2, energy);
  }
`;

export function createWarpRippleMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uCharge: { value: 0 },
      uCores: { value: 0 },
      uBrokenColor: { value: new THREE.Color(0xff5a2a) },
      uFixedColor: { value: new THREE.Color(0xffd98a) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}
