import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { NOISE_GLSL } from './noise.glsl.js';

/* =====================================================================
   CUSTOM SHADER — Phosphor "reveal ink" (the Present's core mechanic).

   Writing on the archive walls is invisible until the flashlight beam
   touches it. Each frame JavaScript passes the flashlight's world position,
   direction and on/off state as uniforms. The FRAGMENT stage computes, for
   every pixel of the decal, the angle between the light's direction and
   the vector from the light to that pixel:
       cosAngle = dot(normalize(pixel − lightPos), lightDir)
   Pixels inside the cone (cosAngle above the cone's cosine) glow; a
   smoothstep between the inner and outer cone gives a soft edge, and the
   glow fades with distance. Built-in materials can't do this — the
   visibility of a surface depends on a game object's state, per pixel.
   Uniforms: map + uColor (build); uLightPos/uLightDir/uOn ← the player's
   flashlight every frame; uTime (ink shimmer); uCosInner/uCosOuter bound
   the cone (inner/outer angle cosines).
   ===================================================================== */
export function createRevealInkMaterial(map, color = 0x7dffd0) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      uColor: { value: new THREE.Color(color) },
      uLightPos: { value: new THREE.Vector3() },
      uLightDir: { value: new THREE.Vector3(0, 0, -1) },
      uOn: { value: 0 },
      uTime: { value: 0 },
      uCosOuter: { value: Math.cos(Math.PI / 6.5) },
      uCosInner: { value: Math.cos(Math.PI / 12) },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vPosW;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vPosW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D map;
      uniform vec3 uColor;
      uniform vec3 uLightPos;
      uniform vec3 uLightDir;
      uniform float uOn;
      uniform float uTime;
      uniform float uCosOuter;
      uniform float uCosInner;
      varying vec2 vUv;
      varying vec3 vPosW;
      void main() {
        vec3 toPixel = vPosW - uLightPos;
        float dist = length(toPixel);
        float cosAngle = dot(toPixel / dist, normalize(uLightDir));
        float cone = smoothstep(uCosOuter, uCosInner, cosAngle);
        float atten = clamp(1.0 - dist / 14.0, 0.0, 1.0);
        float ink = texture2D(map, vUv).a;
        float shimmer = 0.85 + 0.15 * sin(uTime * 6.0 + vPosW.y * 20.0);
        float a = ink * cone * atten * uOn * shimmer;
        gl_FragColor = vec4(uColor * a * 2.2, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
}

/* =====================================================================
   CUSTOM SHADER — Polished floor reflection overlay (3D Effects:
   reflections). A Reflector renders the room mirrored under the floor into
   a texture; our shader projects that texture onto a plane a few mm above
   the (normally lit) tiled floor and ADDS it, scaled by Fresnel (stronger
   at grazing angles) and broken up by the tiles' own normal map, so it
   reads as wet, waxed lab flooring that still reacts to every light.
   Uniforms: textureMatrix/tDiffuse (the Reflector's), tNormal (the tile
   normal map), uStrength (overlay mix) and uTile (normal-map scale).
   ===================================================================== */
const FloorReflectShader = {
  name: 'FloorReflect',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    tNormal: { value: null },
    uStrength: { value: 0.32 },
    uTile: { value: 2.0 },
  },
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix;
    varying vec4 vUvProj;
    varying vec3 vPosW;
    void main() {
      vUvProj = textureMatrix * vec4(position, 1.0);
      vec4 w = modelMatrix * vec4(position, 1.0);
      vPosW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tNormal;
    uniform vec3 color;
    uniform float uStrength;
    uniform float uTile;
    varying vec4 vUvProj;
    varying vec3 vPosW;
    void main() {
      vec3 n = texture2D(tNormal, vPosW.xz / uTile).xyz * 2.0 - 1.0;
      vec4 proj = vUvProj;
      proj.xy += n.xy * 0.35;
      vec3 refl = texture2DProj(tDiffuse, proj).rgb;
      vec3 viewDir = normalize(cameraPosition - vPosW);
      float fresnel = 0.25 + 0.75 * pow(1.0 - max(viewDir.y, 0.0), 3.0);
      gl_FragColor = vec4(refl * color * uStrength * fresnel, 1.0);
    }
  `,
};

export function createFloorReflection(width, depth, { normalMap, quality, tile = 2 } = {}) {
  if (quality && !quality.reflections) return null;
  const geometry = new THREE.PlaneGeometry(width, depth);
  const scale = quality && quality.pixelRatio > 1 ? 0.5 : 0.33;
  const mesh = new Reflector(geometry, {
    shader: FloorReflectShader,
    textureWidth: Math.round(window.innerWidth * scale),
    textureHeight: Math.round(window.innerHeight * scale),
    color: 0xffffff,
    clipBias: 0.01,
  });
  mesh.rotation.x = -Math.PI / 2;
  mesh.material.uniforms.tNormal.value = normalMap;
  mesh.material.uniforms.uTile.value = tile;
  mesh.material.transparent = true;
  mesh.material.blending = THREE.AdditiveBlending;
  mesh.material.depthWrite = false;
  mesh.renderOrder = 1;
  return { mesh, dispose() { mesh.dispose(); } };
}

/* =====================================================================
   CUSTOM SHADER — Rain-streaked window glass + lightning.
   FRAGMENT stage: the window's UVs are split into a grid of cells; each
   cell (hash of its index) may hold a drop that slides down over time —
   fract(uv.y + time × speed) — leaving a thin trail. A second static layer
   adds beaded droplets. uFlash (driven by the lightning timer) lights the
   glass up white for a split second.
   Uniforms: uTime (drops), uFlash ← the lab's lightning timer, uTint (night
   glass colour).
   ===================================================================== */
export function createRainGlassMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFlash: { value: 0 }, uTint: { value: new THREE.Color(0x0b1a2a) } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vPosW;
      void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vPosW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uFlash;
      uniform vec3 uTint;
      varying vec2 vUv;
      varying vec3 vPosW;
      ${NOISE_GLSL}
      float drops(vec2 uv, float t, float scale) {
        vec2 g = uv * vec2(scale, scale * 0.35);
        vec2 id = floor(g);
        vec2 f = fract(g);
        float h = hash12(id);
        float speed = 0.25 + h * 0.6;
        float y = fract(h * 7.3 - t * speed);
        vec2 d = f - vec2(0.5 + (hash12(id + 3.1) - 0.5) * 0.6, y);
        float drop = smoothstep(0.08, 0.0, length(d * vec2(1.0, 2.8)));
        float trail = smoothstep(0.03, 0.0, abs(d.x)) * step(0.0, d.y) * smoothstep(0.6, 0.0, d.y) * 0.4;
        return (drop + trail) * step(0.45, h);
      }
      void main() {
        vec2 uv = vPosW.xy * 0.35 + vec2(vPosW.z * 0.35, 0.0);
        float r = drops(uv, uTime, 9.0) + drops(uv + 0.37, uTime * 1.3, 15.0) * 0.6;
        float beads = smoothstep(0.82, 0.95, noise2(uv * 60.0)) * 0.35;
        vec3 col = uTint + vec3(0.55, 0.7, 0.9) * (r + beads) * (0.35 + uFlash * 3.0) + vec3(0.7, 0.8, 1.0) * uFlash * 0.35;
        float a = 0.18 + (r + beads) * 0.4 + uFlash * 0.2;
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.9));
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/* =====================================================================
   CUSTOM SHADER — CRT / holographic screen.
   uPower (game state) switches the screen from static noise (no power) to
   its content texture with scanlines, a rolling refresh bar, flicker and
   slight barrel-shaped vignette. Used for lab monitors and Neon billboards.
   Uniforms: map (content), uPower ← game state, uTime (roll/jitter/static),
   uHolo (additive billboard mode), uColor.
   ===================================================================== */
export function createScreenMaterial(map, { color = 0x9fe8ff, power = 1, holo = false } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map }, uTime: { value: 0 }, uPower: { value: power },
      uColor: { value: new THREE.Color(color) }, uHolo: { value: holo ? 1 : 0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D map;
      uniform float uTime;
      uniform float uPower;
      uniform vec3 uColor;
      uniform float uHolo;
      varying vec2 vUv;
      ${NOISE_GLSL}
      void main() {
        vec2 uv = vUv;
        float roll = smoothstep(0.0, 0.04, abs(fract(uv.y - uTime * 0.18) - 0.5) - 0.46);
        uv.x += (hash12(vec2(floor(uv.y * 90.0), floor(uTime * 12.0))) - 0.5) * 0.004 * (1.0 + uHolo * 3.0);
        vec4 tex = texture2D(map, uv);
        float scan = 0.82 + 0.18 * sin(uv.y * 520.0);
        float flicker = 0.92 + 0.08 * sin(uTime * 37.0);
        vec3 content = tex.rgb * uColor * scan * flicker * (1.0 + roll * 0.25);
        float stat = hash12(floor(uv * vec2(160.0, 120.0)) + floor(uTime * 24.0));
        vec3 noiseCol = vec3(stat) * 0.25;
        vec3 col = mix(noiseCol, content * 1.8, uPower);
        vec2 c = vUv - 0.5;
        col *= smoothstep(0.75, 0.35, length(c * vec2(1.0, 1.3)));
        float a = mix(1.0, (tex.a * 0.85 + 0.1) * scan, uHolo);
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: holo,
    depthWrite: !holo,
    blending: holo ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: holo ? THREE.DoubleSide : THREE.FrontSide,
  });
}

/* =====================================================================
   CUSTOM SHADER — Energy barrier / containment field (vertex + fragment).
   VERTEX stage: the surface ripples — vertices are displaced along their
   normal by a travelling sine wave plus noise, scaled by uActive.
   FRAGMENT stage: a hexagon lattice, noise "energy" flowing upward, a
   bright edge glow at the top/bottom, and a DISSOLVE: pixels whose noise
   value is below uDissolve are discarded, with a hot rim at the
   dissolve boundary — so the barrier visibly burns away when it switches
   off instead of popping out of existence.
   uActive / uDissolve are driven by game state (power, timing cycles);
   uWarn is the pre-switch blink; uColor tints each barrier.
   ===================================================================== */
export function createBarrierMaterial(color = 0xff4fd8) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uColor: { value: new THREE.Color(color) },
      uActive: { value: 1 }, uDissolve: { value: 0 }, uWarn: { value: 0 },
    },
    vertexShader: /* glsl */`
      uniform float uTime;
      uniform float uActive;
      varying vec2 vUv;
      varying vec3 vPosW;
      varying vec3 vNormalW;
      ${NOISE_GLSL}
      void main() {
        vUv = uv;
        float wave = sin(uv.x * 18.0 - uTime * 4.0) * 0.5 + noise2(uv * 6.0 + uTime) * 0.5;
        vec3 p = position + normal * wave * 0.06 * uActive;
        vec4 w = modelMatrix * vec4(p, 1.0);
        vPosW = w.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uActive;
      uniform float uDissolve;
      uniform float uWarn;
      varying vec2 vUv;
      varying vec3 vPosW;
      varying vec3 vNormalW;
      ${NOISE_GLSL}
      float hexEdge(vec2 p) {
        p.x *= 1.1547;
        p.y += mod(floor(p.x), 2.0) * 0.5;
        p = abs(fract(p) - 0.5);
        return abs(max(p.x * 1.5 + p.y, p.y * 2.0) - 1.0);
      }
      void main() {
        float n = fbm2(vUv * vec2(8.0, 4.0) + vec2(0.0, -uTime * 0.6));
        if (n < uDissolve) discard;
        float burn = smoothstep(uDissolve + 0.08, uDissolve, n) * step(0.001, uDissolve);
        float hex = 1.0 - smoothstep(0.0, 0.07, hexEdge(vPosW.xy * 2.4 + vPosW.zz * 2.4));
        float edge = smoothstep(0.12, 0.0, vUv.y) + smoothstep(0.88, 1.0, vUv.y);
        vec3 viewDir = normalize(cameraPosition - vPosW);
        float fres = pow(1.0 - abs(dot(viewDir, normalize(vNormalW))), 2.0);
        float energy = 0.18 + n * 0.5 + hex * 0.55 + edge * 0.9 + fres * 0.6;
        float warn = 1.0 + uWarn * (0.5 + 0.5 * sin(uTime * 30.0));
        vec3 col = uColor * energy * (0.25 + uActive * 1.6) * warn + vec3(1.0, 0.85, 0.6) * burn * 3.0;
        float a = clamp(energy * (0.15 + uActive * 0.6) + burn, 0.0, 1.0);
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}
