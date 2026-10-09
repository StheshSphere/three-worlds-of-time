import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TimeWarpShader } from '../shaders/timeWarp.js';

/**
 * Post-processing chain (rendered into half-float targets so HDR values —
 * glowing cores, neon, the sun — survive until tone mapping):
 *
 *   RenderPass ─► UnrealBloomPass ─► TimeWarp (our shader) ─► OutputPass
 *   scene          bright pixels      warp / glitch /          ACES tone
 *                  bleed light        grade / grain            mapping + sRGB
 *
 * Bloom is switched off on the "low" quality preset.
 */
export const ERA_GRADES = [
  // the Past: warm, golden, gently saturated
  { lift: [0.004, 0.002, 0.0], gain: [1.06, 1.0, 0.9], saturation: 1.1, bloom: [0.45, 0.55, 0.88], exposure: 1.0 },
  // the Present: cool, desaturated, clinical
  { lift: [0.0, 0.003, 0.008], gain: [0.92, 1.0, 1.1], saturation: 0.92, bloom: [0.55, 0.45, 0.82], exposure: 1.15 },
  // the Future: punchy neon
  { lift: [0.006, 0.0, 0.012], gain: [1.05, 0.95, 1.1], saturation: 1.2, bloom: [1.05, 0.65, 0.62], exposure: 1.05 },
];

export class PostFX {
  constructor(renderer, scene, camera, { samples = 4 } = {}) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());
    // Our own render target so we can ask for MSAA (antialiasing inside the
    // composer — the canvas's own antialias flag doesn't apply to targets).
    const pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.5, 0.85);
    this.warp = new ShaderPass(TimeWarpShader);
    this.warp.uniforms.uLift.value = new THREE.Vector3();
    this.warp.uniforms.uGain.value = new THREE.Vector3(1, 1, 1);
    this.warp.uniforms.uResolution.value = new THREE.Vector2(size.x, size.y);
    this.output = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.warp);
    this.composer.addPass(this.output);
    this.u = this.warp.uniforms;
  }

  setCamera(camera) { this.renderPass.camera = camera; }

  setBloomEnabled(on) { this.bloom.enabled = on; }

  setEra(index) {
    const g = ERA_GRADES[index] || ERA_GRADES[0];
    this.u.uLift.value.set(...g.lift);
    this.u.uGain.value.set(...g.gain);
    this.u.uSaturation.value = g.saturation;
    this.bloom.strength = g.bloom[0];
    this.bloom.radius = g.bloom[1];
    this.bloom.threshold = g.bloom[2];
    this.renderer.toneMappingExposure = g.exposure;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.u.uResolution.value.set(w, h);
  }

  setPixelRatio(r) { this.composer.setPixelRatio(r); }

  setSamples(n) {
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== n) { rt.samples = n; rt.dispose(); }
    }
  }

  render(time) {
    this.u.uTime.value = time;
    this.composer.render();
  }
}
