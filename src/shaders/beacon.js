import * as THREE from 'three';

/**
 * CUSTOM SHADER — Holographic checkpoint beacon (Member 3, the Future).
 *
 * A small holographic pillar that marks each checkpoint on the skyline:
 * two crossed additive quads sharing one material, a soft vertical body,
 * bright rims, drifting scan lines and one slow idle sweep. uPulse (0..1) is
 * fired by the level the moment a checkpoint is earned — the pillar flares
 * and a bright ring races up it, so "the timeline remembers this moment" is
 * readable in the world, not only in the HUD.
 *
 * Additive + depthWrite:false (no sorting artefacts), uniforms only — no
 * per-frame allocations. 5 beacons = 10 extra draw calls for the level.
 */
export function createBeaconMaterial(color = 0xff5be0) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uPulse: { value: 0 },
    },
    vertexShader: `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        // Gentle holographic sway, strongest at the tip of the pillar.
        vec3 p = position;
        p.x += sin(uTime * 1.6 + uv.y * 3.0) * 0.03 * uv.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uPulse;
      varying vec2 vUv;

      // Soft band of light centred on pos (0..1); w = half-width.
      float band(float y, float pos, float w) {
        return smoothstep(w, 0.0, abs(y - pos));
      }

      void main() {
        // Fade toward both ends so the pillar melts into the air.
        float vert = smoothstep(0.0, 0.16, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
        // Bright rims, dimmer core — reads as a glass column from every angle.
        float rim = pow(abs(vUv.x - 0.5) * 2.0, 3.0);
        // Drifting scan lines.
        float scan = 0.5 + 0.5 * sin(vUv.y * 48.0 - uTime * 6.0);
        // Idle sweep: one soft band rising slowly, forever.
        float sweep = band(vUv.y, fract(uTime * 0.22), 0.07) * 0.45;
        // Earned-checkpoint flare: whole-pillar flash + a fast rising ring.
        float pulse = uPulse * (0.7 + band(vUv.y, fract((1.0 - uPulse) * 2.2), 0.1) * 1.5);
        float glow = (0.14 + 0.5 * rim + 0.22 * scan + sweep + pulse) * vert;
        // Subtle hologram flicker.
        glow *= 0.9 + 0.1 * sin(uTime * 31.0 + vUv.y * 9.0);
        gl_FragColor = vec4(uColor * glow, glow);
      }
    `,
  });
}
