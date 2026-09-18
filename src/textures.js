import * as THREE from 'three';

/* --------------------------------------------------------------------------
 * Stylised PBR textures for the three eras, with an automatic drop-in slot
 * for real texture files.
 *
 * USAGE (inside a level's build()):
 *   const tex = createLevelTextures('ancient-ruins', { anisotropy: api.getMaxAnisotropy() });
 *   const groundMat = tex.material('ground', { repeat: [12, 6], params: { roughness: 1 } });
 *   disposables.push(tex);   // disposes every material + texture it made
 *
 * PROCEDURAL SETS (the default): each slot paints a 256×256 canvas in the
 * era's palette — colour map plus normal and roughness maps derived from the
 * colour luminance (mortar/grout grooves read as grooves, rivets as bumps).
 * A seeded RNG keeps every load pixel-identical.
 *
 * DROP-IN FILES (optional, no code changes needed): if
 *   assets/textures/<level-name>/<slot>.jpg        (or .png)   — colour/albedo
 *   assets/textures/<level-name>/<slot>-normal.jpg (or .png)   — normal map
 *   assets/textures/<level-name>/<slot>-roughness.jpg (or .png)— roughness
 * exist, they are loaded with THREE.TextureLoader and hot-swap the
 * procedural set (colour maps get SRGBColorSpace; repeat wraps carry over).
 * Recommended CC0 sources: ambientCG.com, polyhaven.com/textures, kenney.nl.
 * Credit every downloaded file in #credits-list the same commit (AGENTS.md).
 * ------------------------------------------------------------------------ */

const SIZE = 256;

/* ---- seeded RNG (mulberry32) so textures are identical every load ------- */
function rngFor(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  return { canvas, ctx: canvas.getContext('2d') };
}

function fill(ctx, colour) {
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

/** Per-pixel value jitter — the "low-poly hand-made" grain. */
function speckle(ctx, rng, amount, alpha = 0.5) {
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 2 * amount * alpha;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

/* ---- the six era/slot painters ------------------------------------------- */

function paintSandyFlagstones(ctx, rng) {
  fill(ctx, '#8f7d5c'); // ~ old groundMat 0x8a7654
  const cells = 4;
  const cell = SIZE / cells;
  ctx.strokeStyle = 'rgba(52, 42, 28, 0.85)';
  ctx.lineWidth = 3;
  for (let r = 0; r <= cells; r++) {
    const jitter = (rng() - 0.5) * 4;
    ctx.beginPath();
    ctx.moveTo(0, r * cell + jitter);
    ctx.lineTo(SIZE, r * cell + jitter);
    ctx.stroke();
  }
  for (let c = 0; c <= cells; c++) {
    const jitter = (rng() - 0.5) * 4;
    ctx.beginPath();
    ctx.moveTo(c * cell + jitter, 0);
    ctx.lineTo(c * cell + jitter, SIZE);
    ctx.stroke();
  }
  // Per-flag value jitter + moss creeping along the lines.
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      const v = Math.floor((rng() - 0.5) * 26);
      ctx.fillStyle = `rgba(${140 + v}, ${124 + v}, ${92 + v}, 0.55)`;
      ctx.fillRect(c * cell + 2, r * cell + 2, cell - 4, cell - 4);
    }
  }
  for (let i = 0; i < 26; i++) {
    const onLine = rng() > 0.35;
    const x = onLine ? Math.floor(rng() * cells) * cell + (rng() - 0.5) * 6 : rng() * SIZE;
    const y = onLine ? Math.floor(rng() * cells) * cell + (rng() - 0.5) * 6 : rng() * SIZE;
    const rad = 5 + rng() * 14;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(92, 122, 74, 0.55)');
    g.addColorStop(1, 'rgba(92, 122, 74, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  speckle(ctx, rng, 14);
}

function paintSandstoneBlocks(ctx, rng) {
  fill(ctx, '#a89579'); // ~ old stoneMat
  const rows = 5;
  const rowH = SIZE / rows;
  ctx.lineWidth = 3;
  for (let r = 0; r <= rows; r++) {
    ctx.strokeStyle = 'rgba(58, 48, 34, 0.9)';
    ctx.beginPath();
    ctx.moveTo(0, r * rowH);
    ctx.lineTo(SIZE, r * rowH);
    ctx.stroke();
    // Blocks with a running offset per course.
    const offset = (r % 2) * (SIZE / 6);
    for (let x = offset; x <= SIZE; x += SIZE / 3) {
      ctx.beginPath();
      ctx.moveTo(x, r * rowH);
      ctx.lineTo(x, Math.min((r + 1) * rowH, SIZE));
      ctx.stroke();
      if (r < rows) {
        const v = Math.floor((rng() - 0.5) * 22);
        ctx.fillStyle = `rgba(${168 + v}, ${149 + v}, ${121 + v}, 0.6)`;
        ctx.fillRect(x + 2, r * rowH + 2, SIZE / 3 - 4, rowH - 4);
      }
    }
  }
  // A few hairline cracks.
  ctx.strokeStyle = 'rgba(70, 58, 40, 0.55)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    let x = rng() * SIZE;
    let y = rng() * SIZE;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += (rng() - 0.5) * 30;
      y += rng() * 18;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  speckle(ctx, rng, 12);
}

function paintLabTiles(ctx, rng) {
  fill(ctx, '#2e3340'); // ~ old floorMat 0x2b2f3a
  const n = 4;
  const cell = SIZE / n;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const alt = (r + c) % 2 === 0 ? 14 : -8;
      const v = Math.floor((rng() - 0.5) * 8) + alt;
      ctx.fillStyle = `rgb(${46 + v}, ${51 + v}, ${64 + v})`;
      ctx.fillRect(c * cell + 2, r * cell + 2, cell - 4, cell - 4);
    }
  }
  // Grout lines.
  ctx.strokeStyle = 'rgba(16, 19, 26, 0.95)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= n; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell, SIZE);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * cell);
    ctx.lineTo(SIZE, i * cell);
    ctx.stroke();
  }
  // Faint diagonal sheen streaks on random tiles.
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < 10; i++) {
    ctx.strokeStyle = '#cfe0f0';
    ctx.lineWidth = 2 + rng() * 4;
    const x = rng() * SIZE;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 30, SIZE);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  speckle(ctx, rng, 8);
}

function paintMetalPanels(ctx, rng) {
  fill(ctx, '#565e6b'); // ~ old wallMat 0x39404d, one step brighter for texture
  // Brushed horizontal streaks.
  for (let y = 0; y < SIZE; y += 2) {
    const v = Math.floor((rng() - 0.5) * 18);
    ctx.strokeStyle = `rgba(${86 + v}, ${94 + v}, ${107 + v}, 0.5)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + rng());
    ctx.lineTo(SIZE, y + rng());
    ctx.stroke();
  }
  // 2×2 panel seams + rivets.
  ctx.strokeStyle = 'rgba(22, 26, 34, 0.95)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * SIZE / 2, 0);
    ctx.lineTo(i * SIZE / 2, SIZE);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * SIZE / 2);
    ctx.lineTo(SIZE, i * SIZE / 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(140, 150, 164, 0.9)';
  for (let px = 0; px <= 2; px++) {
    for (let py = 0; py <= 2; py++) {
      for (const [ox, oy] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) {
        ctx.beginPath();
        ctx.arc(px * SIZE / 2 + ox, py * SIZE / 2 + oy, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  speckle(ctx, rng, 7);
}

function paintBrushedSteel(ctx, rng) {
  fill(ctx, '#8b95a3'); // ~ old steelMat
  for (let y = 0; y < SIZE; y++) {
    const v = Math.floor((rng() - 0.5) * 30);
    ctx.strokeStyle = `rgb(${139 + v}, ${149 + v}, ${163 + v})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(SIZE, y);
    ctx.stroke();
  }
  // Occasional brighter scratch flecks.
  ctx.fillStyle = 'rgba(210, 220, 232, 0.35)';
  for (let i = 0; i < 30; i++) {
    ctx.fillRect(rng() * SIZE, rng() * SIZE, 2 + rng() * 5, 1);
  }
  // One faint vertical seam so tiling has a panel rhythm.
  ctx.fillStyle = 'rgba(40, 46, 56, 0.5)';
  ctx.fillRect(SIZE / 2 - 1, 0, 2, SIZE);
}

function paintNeonDeck(ctx, rng) {
  fill(ctx, '#14151f'); // ~ old deckMat
  // Carbon-ish micro grid.
  ctx.strokeStyle = 'rgba(52, 60, 84, 0.8)';
  ctx.lineWidth = 1;
  const step = 32;
  for (let i = 0; i <= SIZE; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, SIZE);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(SIZE, i);
    ctx.stroke();
  }
  // Panel cross seams, heavier.
  ctx.strokeStyle = 'rgba(24, 28, 44, 1)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1, 1, SIZE - 2, SIZE - 2);
  ctx.beginPath();
  ctx.moveTo(SIZE / 2, 0);
  ctx.lineTo(SIZE / 2, SIZE);
  ctx.moveTo(0, SIZE / 2);
  ctx.lineTo(SIZE, SIZE / 2);
  ctx.stroke();
  // Sparse pin-lights — tiny, dim; the neon rims stay the star.
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = 'rgba(90, 160, 200, 0.8)';
    ctx.fillRect(rng() * SIZE, rng() * SIZE, 2, 2);
  }
  speckle(ctx, rng, 6);
}

const SLOT_PAINTERS = {
  'ancient-ruins/ground': paintSandyFlagstones,
  'ancient-ruins/stone': paintSandstoneBlocks,
  'modern-lab/floor': paintLabTiles,
  'modern-lab/wall': paintMetalPanels,
  'modern-lab/metal': paintBrushedSteel,
  'neon-future/deck': paintNeonDeck,
};

/* ---- luminance → normal / roughness maps --------------------------------- */

function luminance(ctx) {
  const d = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const out = new Float32Array(SIZE * SIZE);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    out[p] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
  }
  return out;
}

/** Wrap-safe normal map from a height (luminance) field. */
function normalCanvas(lum, strength) {
  const { canvas, ctx } = makeCanvas();
  const img = ctx.createImageData(SIZE, SIZE);
  const d = img.data;
  const at = (x, y) => lum[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const p = (y * SIZE + x) * 4;
      d[p] = ((-dx * inv) * 0.5 + 0.5) * 255;
      d[p + 1] = ((-dy * inv) * 0.5 + 0.5) * 255;
      d[p + 2] = (inv * 0.5 + 0.5) * 255;
      d[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Roughness map: darker colour (grooves/mortar) → rougher. */
function roughnessCanvas(lum, base) {
  const { canvas, ctx } = makeCanvas();
  const img = ctx.createImageData(SIZE, SIZE);
  const d = img.data;
  for (let p = 0; p < SIZE * SIZE; p++) {
    let r = base + (0.5 - lum[p]) * 0.35;
    r = Math.max(0.05, Math.min(1, r));
    const v = r * 255;
    const q = p * 4;
    d[q] = d[q + 1] = d[q + 2] = v;
    d[q + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/* ---- the per-level library ------------------------------------------------ */

/**
 * @param {string} levelName 'ancient-ruins' | 'modern-lab' | 'neon-future'
 * @param {{ anisotropy?: number }} opts  renderer's max anisotropy (api.getMaxAnisotropy())
 */
export function createLevelTextures(levelName, { anisotropy = 4 } = {}) {
  const loader = new THREE.TextureLoader();
  // slot → { variants: Map<repeatKey, {...}>, probed: bool, loadedBase: {} }
  const slots = new Map();
  const allMaterials = [];

  function configure(tex, colour) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = anisotropy;
    if (colour) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function proceduralSet(slot) {
    const painter = SLOT_PAINTERS[`${levelName}/${slot}`];
    if (!painter) return null;
    const { canvas, ctx } = makeCanvas();
    painter(ctx, rngFor(`${levelName}/${slot}`));
    const lum = luminance(ctx);
    return {
      diffuse: canvas,
      normal: normalCanvas(lum, 1.6),
      roughness: roughnessCanvas(lum, 0.55),
    };
  }

  /* Drop-in probe: assets/textures/<level>/<slot>[.jpg|.png], then the
   * -normal / -roughness companions only once a diffuse file exists. */
  function tryLoad(slot, kind, exts, onFail) {
    if (exts.length === 0) { onFail(); return; }
    const [ext, ...rest] = exts;
    const suffix = kind === 'diffuse' ? '' : `-${kind}`;
    const url = `assets/textures/${levelName}/${slot}${suffix}.${ext}`;
    loader.load(
      url,
      (texture) => applyLoaded(slot, kind, texture),
      undefined,
      () => tryLoad(slot, kind, rest, onFail),
    );
  }

  function applyLoaded(slot, kind, texture) {
    const s = slots.get(slot);
    if (!s) return;
    configure(texture, kind === 'diffuse');
    if (s.loadedBase[kind]) return; // first successful load wins
    s.loadedBase[kind] = texture;
    for (const variant of s.variants.values()) {
      const t = texture.clone();
      t.needsUpdate = true;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = anisotropy;
      if (kind === 'diffuse') t.colorSpace = THREE.SRGBColorSpace;
      t.repeat.set(variant.repeat[0], variant.repeat[1]);
      const key = kind === 'diffuse' ? 'map'
        : kind === 'normal' ? 'normalMap' : 'roughnessMap';
      const old = variant.maps[key];
      if (old) old.dispose();
      variant.maps[key] = t;
      variant.materials.forEach((m) => { m[key] = t; m.needsUpdate = true; });
    }
    if (kind === 'diffuse') {
      tryLoad(slot, 'normal', ['jpg', 'png'], () => {});
      tryLoad(slot, 'roughness', ['jpg', 'png'], () => {});
    }
  }

  function ensureSlot(slot) {
    let s = slots.get(slot);
    if (s) return s;
    s = { variants: new Map(), probed: false, loadedBase: {} };
    slots.set(slot, s);
    return s;
  }

  /**
   * Creates a MeshStandardMaterial for a slot with procedural PBR maps
   * (hot-swapped by drop-in files if they exist).
   * @param {string} slot painter/drop-in name, e.g. 'ground'
   * @param {{ repeat?: number|[number, number], params?: object }} opts
   */
  function material(slot, opts = {}) {
    const repeat = typeof opts.repeat === 'number' ? [opts.repeat, opts.repeat]
      : (opts.repeat || [1, 1]);
    const key = `${repeat[0]}x${repeat[1]}`;
    const s = ensureSlot(slot);
    let variant = s.variants.get(key);
    if (!variant) {
      const set = proceduralSet(slot);
      if (!set) throw new Error(`textures.js: no painter for ${levelName}/${slot}`);
      const mk = (canvas, colour) => {
        const t = configure(new THREE.CanvasTexture(canvas), colour);
        t.repeat.set(repeat[0], repeat[1]);
        return t;
      };
      variant = {
        repeat,
        materials: [],
        maps: {
          map: mk(set.diffuse, true),
          normalMap: mk(set.normal, false),
          roughnessMap: mk(set.roughness, false),
        },
      };
      s.variants.set(key, variant);
    }
    const mat = new THREE.MeshStandardMaterial({
      ...(opts.params || {}),
      map: variant.maps.map,
      normalMap: variant.maps.normalMap,
      roughnessMap: variant.maps.roughnessMap,
    });
    variant.materials.push(mat);
    allMaterials.push(mat);

    if (!s.probed) {
      s.probed = true;
      tryLoad(slot, 'diffuse', ['jpg', 'png'], () => {
        console.info(
          `[textures] No drop-in files under assets/textures/${levelName}/ — `
          + 'using the procedural set (see src/textures.js for the file naming).',
        );
      });
    }
    return mat;
  }

  /** Disposes every material and every texture this library created. */
  function dispose() {
    for (const s of slots.values()) {
      for (const variant of s.variants.values()) {
        for (const t of Object.values(variant.maps)) t.dispose();
      }
      for (const t of Object.values(s.loadedBase)) if (t) t.dispose();
    }
    slots.clear();
    allMaterials.forEach((m) => m.dispose());
    allMaterials.length = 0;
  }

  return { material, dispose };
}
