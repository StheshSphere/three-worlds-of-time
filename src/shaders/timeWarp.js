import { NOISE_GLSL } from './noise.glsl.js';

/**
 * CUSTOM SHADER — Time-warp + colour-grade post-process pass.
 *
 * This runs on the WHOLE rendered frame (a full-screen quad whose texture,
 * tDiffuse, is the image the scene just rendered). It is the game's visual
 * signature: every era change swirls and ripples the screen into white, and
 * as the timeline destabilises the picture starts to tear.
 *
 * Uniforms driven by game state every frame:
 *   uWarp    0→1 during an era transition / dash: swirl angle grows toward
 *            the centre (rotation matrix whose angle falls off with radius)
 *            plus a radial ripple sin(r*40 - t*12).
 *   uGlitch  0→1 as "timeline stability" runs out: random horizontal bands
 *            (hash of row + time) are shifted sideways.
 *   uFlash   fades the frame to bright white (era jump, win sequence).
 *   uDamage  red edge vignette when the player is hurt.
 * Per-era grading uniforms (uLift, uGain, uSaturation) give each world its
 * own colour identity — warm gold, cold cyan, neon magenta.
 *
 * Chromatic aberration: R, G and B are sampled at slightly different UVs,
 * further apart near the screen edges, like a cheap lens.
 */
export const TimeWarpShader = {
  name: 'TimeWarpShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uWarp: { value: 0 },
    uGlitch: { value: 0 },
    uFlash: { value: 0 },
    uDamage: { value: 0 },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.035 },
    uChroma: { value: 0.0025 },
    uSaturation: { value: 1.05 },
    uLift: { value: null },
    uGain: { value: null },
    uResolution: { value: null },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uWarp;
    uniform float uGlitch;
    uniform float uFlash;
    uniform float uDamage;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uChroma;
    uniform float uSaturation;
    uniform vec3 uLift;
    uniform vec3 uGain;
    uniform vec2 uResolution;
    varying vec2 vUv;
    ${NOISE_GLSL}

    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c);

      // --- time-warp swirl + ripple -------------------------------------
      float angle = uWarp * 2.4 * smoothstep(0.8, 0.0, r);
      float s = sin(angle);
      float co = cos(angle);
      c = mat2(co, -s, s, co) * c;
      c *= 1.0 + sin(r * 40.0 - uTime * 12.0) * 0.018 * uWarp;

      // --- glitch tears when the timeline is failing ---------------------
      if (uGlitch > 0.001) {
        float row = floor(vUv.y * 70.0);
        float tick = floor(uTime * 18.0);
        float tear = step(1.0 - uGlitch * 0.06, hash12(vec2(row, tick)));
        c.x += tear * (hash12(vec2(tick, row * 3.1)) - 0.5) * 0.09 * uGlitch;
      }
      vec2 uv = c + 0.5;

      // --- chromatic aberration ------------------------------------------
      vec2 dir = c / max(r, 1e-4);
      float ca = (uChroma + uWarp * 0.014 + uGlitch * 0.006) * r;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * ca).b;

      // --- per-era grade (linear HDR, before tone mapping) ---------------
      col = col * uGain + uLift;
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);

      // --- vignette, hurt flash, grain, white-out ------------------------
      col *= mix(1.0, smoothstep(0.88, 0.22, r), uVignette);
      col += vec3(0.9, 0.04, 0.03) * smoothstep(0.25, 0.75, r) * uDamage;
      float grain = hash12(vUv * uResolution + fract(uTime * 7.13) * 311.0) - 0.5;
      col += grain * uGrain * (0.35 + luma);
      col = mix(col, vec3(6.0), uFlash);

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};
