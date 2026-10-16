import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { NOISE_GLSL } from './noise.glsl.js';

/**
 * CUSTOM SHADER — Reflective temple pool (3D Effects: reflections).
 *
 * three.js's Reflector renders the scene from a camera mirrored below the
 * water plane into a texture each frame — the hero, temple and sky are all
 * in that mirror image, so the character's reflection moves with her. We
 * replace Reflector's built-in shader with our own:
 *   - textureMatrix projects each water pixel into that mirror texture
 *     (projective texturing: texture2DProj).
 *   - A procedural ripple normal (gradient of three scrolling fbm layers)
 *     offsets the lookup so the reflection wobbles like real water.
 *   - Depth colour: turquoise shallows at the rim blend into deeper teal
 *     mid-pool, with a caustic shimmer riding the waves.
 *   - Fresnel (biased for the raised third-person camera): looking down you
 *     see the water body; toward grazing angles the mirror takes over —
 *     Ari, the temple and the sky all move in it.
 *   - A sun glint: specular highlight from the ripple normal and uSunDir.
 *   - Scene fog is applied so the pool fades into the distance with the rest
 *     of the level.
 *
 * INTERACTIVE WATER (added): a small pool of live ripples (uRipples) is fed
 * by the player — footstep rings while she wades, a big ring + droplet burst
 * when she jumps or lands in the pool. The rings perturb the reflection
 * normal in this shader AND show as soft bright bands on a thin overlay
 * plane above the surface.
 *
 * Quality tiers: the mirror render ALWAYS runs (Ari's reflection is a core
 * feature of the pool at every tier); Low simply renders it into a smaller
 * render target than Medium/High (see setQuality).
 *
 * UNIFORMS: uDeep (water colour), uSunDir/uSunColor (kept in sync with the
 * sky), uTime (scrolls the ripple noise), uRipples/uRippleCount (the live
 * interaction rings), fogColor/fogDensity (copied from scene.fog in update)
 * — plus the Reflector's own textureMatrix/tDiffuse.
 */
const MAX_RIPPLES = 16;

const rippleUniforms = () => ({
  uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, 0, 0)) },
  uRippleCount: { value: 0 },
});

const RIPPLE_GLSL = /* glsl */`
  #define MAX_RIPPLES ${MAX_RIPPLES}
  uniform vec4 uRipples[MAX_RIPPLES];   // x, z, age (s), strength
  uniform int uRippleCount;
  vec2 rippleGrad;
  float rippleGlow;
  void accumulateRipples(vec2 p) {
    rippleGrad = vec2(0.0);
    rippleGlow = 0.0;
    for (int i = 0; i < MAX_RIPPLES; i++) {
      if (i >= uRippleCount) break;
      vec4 r = uRipples[i];
      vec2 d = p - r.xy;
      float dist = length(d);
      float radius = 0.35 + r.z * 1.15;            // the ring expands as it ages
      float band = dist - radius;
      float w = 0.18 + radius * 0.3;               // ...and widens as it grows
      float env = exp(-band * band / (w * w)) * exp(-r.z * 1.5) * r.w;
      rippleGlow += env;
      rippleGrad += (dist > 0.0001 ? d / dist : vec2(0.0)) * env * sign(band);
    }
  }
`;

const WaterShader = {
  name: 'TempleWater',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(0x0e5a68) },
    uShallow: { value: new THREE.Color(0x6fd6c4) },
    uZenith: { value: new THREE.Color(0x3a6db5) },
    uHorizon: { value: new THREE.Color(0xffc48a) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(0xffd7a0) },
    uUseMirror: { value: 1 },
    fogColor: { value: new THREE.Color() },
    fogDensity: { value: 0 },
    ...rippleUniforms(),
  },
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix;
    varying vec4 vUvProj;
    varying vec3 vPosW;
    varying vec2 vUv;
    varying float vFogDepth;
    void main() {
      vUvProj = textureMatrix * vec4(position, 1.0);
      vUv = uv;
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
    uniform vec3 uShallow;
    uniform vec3 uZenith;
    uniform vec3 uHorizon;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform float uUseMirror;
    uniform vec3 fogColor;
    uniform float fogDensity;
    varying vec4 vUvProj;
    varying vec3 vPosW;
    varying vec2 vUv;
    varying float vFogDepth;
    ${NOISE_GLSL}
    ${RIPPLE_GLSL}

    float height(vec2 p) {
      return fbm2(p * 1.3 + vec2(uTime * 0.25, uTime * 0.18))
           + 0.5 * fbm2(p * 2.7 - vec2(uTime * 0.31, -uTime * 0.12))
           + 0.25 * fbm2(p * 6.1 + vec2(uTime * 0.55, uTime * 0.42));
    }

    void main() {
      vec2 p = vPosW.xz;
      float e = 0.08;
      float hC = height(p);
      vec3 n = normalize(vec3(
        height(p - vec2(e, 0.0)) - height(p + vec2(e, 0.0)), 0.75,
        height(p - vec2(0.0, e)) - height(p + vec2(0.0, e))));
      accumulateRipples(p);
      n = normalize(n + vec3(rippleGrad.x, 0.0, rippleGrad.y) * 1.1);
      vec3 viewDir = normalize(cameraPosition - vPosW);

      // Depth colour: lighter turquoise at the rim, deeper teal mid-pool,
      // with a faint caustic shimmer riding the wave height.
      vec2 d = abs(vUv - 0.5) * 2.0;
      float shore = 1.0 - max(d.x, d.y);
      float deepF = smoothstep(0.08, 0.62, shore);
      vec3 water = mix(uShallow, uDeep, deepF) * (0.82 + 0.30 * hC);

      // The reflection: the Reflector's mirror at every quality tier (Low
      // only lowers its render-target resolution). The wave distortion is
      // deliberately gentle: at the third-person camera's near-horizontal
      // look the mirrored hero occupies a compressed band close to her
      // feet, and a strong offset smeared that band away.
      vec4 proj = vUvProj;
      proj.xy += n.xz * 0.10;
      vec3 mirror = texture2DProj(tDiffuse, proj).rgb * color;
      mirror = mix(mirror, water * 1.35, 0.15);   // the pool tints its own reflections
      vec3 ray = reflect(-viewDir, n);
      vec3 sky = mix(uHorizon, uZenith, clamp(ray.y * 1.6, 0.0, 1.0));
      sky += uSunColor * pow(max(dot(ray, normalize(uSunDir)), 0.0), 6.0) * 0.35;
      vec3 refl = mix(sky, mirror, uUseMirror);

      // Fresnel, biased upward so the raised third-person camera — looking
      // down at only 7-20° — still gets a strong, readable mirror image of
      // Ari; the pool keeps its turquoise body colour underneath it.
      float fresnel = 0.40 + 0.60 * pow(1.0 - max(dot(viewDir, n), 0.0), 2.4);
      vec3 col = mix(water, refl, fresnel);
      // The hero's mirror image sits mostly in the near band of the pool;
      // a mild contrast lift keeps coat, hair and face readable against
      // the bright sky reflection around them.
      col += (mirror - sky) * 0.12 * uUseMirror;

      // Soft shoreline: water lightens where it meets the stone rim.
      float rim = smoothstep(0.10, 0.0, shore);
      col += uShallow * rim * (0.35 + 0.25 * sin(uTime * 1.3 + hC * 6.0));
      col += uSunColor * rippleGlow * 0.25;      // a crest catches the light
      vec3 h = normalize(viewDir + normalize(uSunDir));
      col += uSunColor * pow(max(dot(n, h), 0.0), 180.0) * 2.4;
      float fog = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      gl_FragColor = vec4(mix(col, fogColor, fog), 1.0);
    }
  `,
};

/** The visible expanding rings — independent of the water material, so they
 *  still show at Low quality. FrontSide: the mirror camera below the surface
 *  looks at its back face and culls it, keeping rings out of the reflection. */
const RingShader = {
  name: 'TempleWaterRings',
  uniforms: {
    uTint: { value: new THREE.Color(0.75, 0.95, 1.0) },
    ...rippleUniforms(),
  },
  vertexShader: /* glsl */`
    varying vec3 vPosW;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vPosW = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: /* glsl */`
    uniform vec3 uTint;
    varying vec3 vPosW;
    ${RIPPLE_GLSL}
    void main() {
      accumulateRipples(vPosW.xz);
      float a = clamp(rippleGlow, 0.0, 1.0) * 0.5;
      if (a < 0.004) discard;
      gl_FragColor = vec4(uTint * a, a);
    }
  `,
};

/** Droplet burst for jumps and landings — one pooled THREE.Points cloud.
 *  Positions are LOCAL to the cloud's parent group (parked on the pool). */
function createSplashPool(count) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const life = new Float32Array(count);
  const maxLife = new Float32Array(count);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.075, sizeAttenuation: true, vertexColors: true, transparent: true,
    opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  let cursor = 0;
  for (let i = 0; i < count; i++) positions[i * 3 + 1] = -100;   // parked

  return {
    points,
    emit(x, z, power) {
      const n = Math.round(10 + power * 34);
      for (let k = 0; k < n; k++) {
        const i = cursor;
        cursor = (cursor + 1) % count;
        positions[i * 3] = x + (Math.random() - 0.5) * 0.3;
        positions[i * 3 + 1] = 0.03;
        positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3;
        const ang = Math.random() * Math.PI * 2;
        const out = (0.35 + Math.random() * 1.0) * (0.6 + power);
        vel[i * 3] = Math.cos(ang) * out;
        vel[i * 3 + 1] = (1.6 + Math.random() * 2.2) * (0.55 + power * 0.9);
        vel[i * 3 + 2] = Math.sin(ang) * out;
        life[i] = maxLife[i] = 0.55 + Math.random() * 0.4;
      }
    },
    update(dt) {
      let alive = false;
      for (let i = 0; i < count; i++) {
        if (life[i] <= 0) continue;
        alive = true;
        life[i] -= dt;
        vel[i * 3 + 1] -= 9.8 * dt;
        positions[i * 3] += vel[i * 3] * dt;
        positions[i * 3 + 1] += vel[i * 3 + 1] * dt;
        positions[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (life[i] <= 0 || positions[i * 3 + 1] < -0.12) {   // back below the surface
          life[i] = 0;
          positions[i * 3 + 1] = -100;
          colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = 0;
          continue;
        }
        const fade = life[i] / maxLife[i];
        colors[i * 3] = 0.55 * fade;
        colors[i * 3 + 1] = 0.8 * fade;
        colors[i * 3 + 2] = 0.95 * fade;
      }
      if (alive) {
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
      }
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

export function createWater(width, depth, { quality, sunDir, scene } = {}) {
  const geometry = new THREE.PlaneGeometry(width, depth);
  // Mirror resolution must be high enough that Ari's mirrored face, coat and
  // hands stay readable at the third-person camera's compressed view angle.
  const scale = quality && quality.pixelRatio > 1 ? 0.7 : 0.5;
  const mesh = new Reflector(geometry, {
    shader: WaterShader,
    textureWidth: Math.round((window.innerWidth || 1280) * scale),
    textureHeight: Math.round((window.innerHeight || 720) * scale),
    color: 0xe9f4f0,
    clipBias: 0.003,
  });
  mesh.rotation.x = -Math.PI / 2;
  const reflectedMaterial = mesh.material;
  const renderReflection = mesh.onBeforeRender;
  const u = reflectedMaterial.uniforms;
  if (sunDir) u.uSunDir.value.copy(sunDir);
  const mirrorTexture = u.tDiffuse.value;
  function setQuality(q) {
    // The mirror always runs — Low renders it into a smaller target rather
    // than dropping Ari's reflection entirely (a saved 'low' preset must
    // never make the pool look like it has no reflection).
    mesh.material = reflectedMaterial;
    mesh.onBeforeRender = renderReflection;
    u.uUseMirror.value = 1;
    u.tDiffuse.value = mirrorTexture;
    const scale = q.pixelRatio > 1 ? 0.7 : q.pixelRatio >= 1 ? 0.5 : 0.4;
    mesh.getRenderTarget().setSize(Math.max(1, Math.round((window.innerWidth || 1280) * scale)), Math.max(1, Math.round((window.innerHeight || 720) * scale)));
  }

  /* ---- interactive layer: rings overlay + splash droplets ---- */
  const ringMat = new THREE.ShaderMaterial({
    ...RingShader,
    uniforms: RingShader.uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
  const rings = new THREE.Mesh(geometry, ringMat);
  rings.rotation.x = -Math.PI / 2;
  rings.position.y = 0.02;              // set above the surface once placed
  rings.renderOrder = 2;
  const droplets = createSplashPool(96);

  const ripples = [];                   // { x, z, age, strength }
  const _lastPos = new THREE.Vector3();
  let wakeDist = 0, idleClock = 0, placed = false;

  function inWater(pos) {
    const p = mesh.position;
    const dx = Math.abs(pos.x - p.x), dz = Math.abs(pos.z - p.z);
    return dx <= width / 2 + 0.25 && dz <= depth / 2 + 0.25 && pos.y <= p.y + 0.12;
  }

  function ripple(x, z, strength) {
    if (ripples.length < MAX_RIPPLES) ripples.push({ x, z, age: 0, strength });
    else {                              // reuse the oldest slot
      let oldest = 0;
      for (let i = 1; i < ripples.length; i++) if (ripples[i].age > ripples[oldest].age) oldest = i;
      const r = ripples[oldest];
      r.x = x; r.z = z; r.age = 0; r.strength = strength;
    }
  }

  function syncUniforms(dt) {
    for (let i = ripples.length - 1; i >= 0; i--) {
      ripples[i].age += dt;
      if (ripples[i].age > 3.2) ripples.splice(i, 1);
    }
    const arr = u.uRipples.value;
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const r = ripples[i];
      if (r) arr[i].set(r.x, r.z, r.age, r.strength);
      else arr[i].set(0, 0, 0, 0);
    }
    const count = ripples.length;
    u.uRippleCount.value = count;
    ringMat.uniforms.uRipples.value = arr;
    ringMat.uniforms.uRippleCount.value = count;
  }

  const result = {
    mesh, rings, droplets: droplets.points, setQuality,
    /** Footstep while wading — a small ring at her feet. */
    footstep(pos) { if (inWater(pos)) ripple(pos.x, pos.z, 0.5); },
    /** Jump or landing — ring burst plus droplets; power 0..1. */
    splash(pos, power = 0.6) {
      if (!inWater(pos)) return;
      ripple(pos.x, pos.z, 0.7 + power * 0.8);
      ripple(pos.x, pos.z, 0.35 + power * 0.4);   // a second, tighter ring
      droplets.emit(pos.x - mesh.position.x, pos.z - mesh.position.z, power);
    },
    update(t, dt = 0, player = null) {
      // The level places the surface mesh right after createWater; on the
      // first update, park the ring overlay and droplet cloud on top of it.
      if (!placed && mesh.position.y) {
        placed = true;
        rings.position.set(mesh.position.x, mesh.position.y + 0.02, mesh.position.z);
        droplets.points.position.set(mesh.position.x, mesh.position.y, mesh.position.z);
      }
      u.uTime.value = t;
      if (scene && scene.fog) { u.fogColor.value.copy(scene.fog.color); u.fogDensity.value = scene.fog.density; }
      // Wake: rings trail her path through the pool; still water breathes.
      if (player && placed && dt > 0) {
        if (inWater(player)) {
          wakeDist += Math.hypot(player.x - _lastPos.x, player.z - _lastPos.z);
          if (wakeDist > 1.1) { wakeDist = 0; ripple(player.x, player.z, 0.32); }
          idleClock += dt;
          if (idleClock > 1.6) { idleClock = 0; ripple(player.x, player.z, 0.18); }
        } else { wakeDist = 0; idleClock = 1.2; }
        _lastPos.copy(player);
      }
      syncUniforms(dt);
      droplets.update(dt);
    },
    dispose() { mesh.dispose(); geometry.dispose(); reflectedMaterial.dispose(); ringMat.dispose(); droplets.dispose(); },
  };
  if (quality) setQuality(quality);          // apply the tier the level booted with
  return result;
}
