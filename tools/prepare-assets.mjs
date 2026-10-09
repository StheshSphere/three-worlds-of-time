/**
 * Asset pipeline — NOT part of the game. Downloads the CC0 source assets and
 * writes optimised, lowercase-hyphenated files into ../assets/.
 *
 *   cd tools && npm install && node prepare-assets.mjs [models|textures|hero|audio|fonts|all]
 *
 * Why a pipeline instead of committing raw downloads:
 *   - Poly Haven scans are 20k–300k triangles; the marking PCs are lab
 *     hardware, so every prop is simplified to a triangle budget here.
 *   - Textures are re-encoded to WebP (≈4–6× smaller than the source JPGs).
 *   - Geometry is meshopt-compressed (decoded in the browser by
 *     libs/three/addons/libs/meshopt_decoder.module.js).
 *   - Filenames come out lowercase-hyphenated because the LAMP server is
 *     case-sensitive (brief §6.2).
 *
 * Sources (all CC0 — see the in-game credits screen):
 *   Poly Haven (polyhaven.com) — PBR textures and props
 *   KayKit Adventurers by Kay Lousberg — hero character + animations
 *   Kenney (kenney.nl) — sound effects
 *   OpenGameArt (opengameart.org) — music loops
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup, prune, weld, simplify, textureCompress, meshopt, resample,
} from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ASSETS = path.join(ROOT, 'assets');
const CACHE = process.env.ASSET_CACHE || path.join(HERE, '.cache');
fs.mkdirSync(CACHE, { recursive: true });

const hyphen = (s) => s.toLowerCase().replace(/[_\s]+/g, '-');

async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      return dest;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    }
  }
}

async function phFiles(id) {
  const r = await fetch(`https://api.polyhaven.com/files/${id}`);
  if (!r.ok) throw new Error(`polyhaven files ${id}: ${r.status}`);
  return r.json();
}

/* ------------------------------------------------------------------ */
/* Textures: diffuse / normal (GL) / ARM (AO-rough-metal) at 1k → WebP */
/* ------------------------------------------------------------------ */
const TEXTURE_SETS = [
  // Ancient Ruins
  'forrest_ground_01', 'grassy_cobblestone', 'stone_floor', 'mossy_sandstone',
  'sandstone_blocks_08', 'rock_wall_10',
  // Modern Laboratory (metal_plate_02 is reused by the Neon Future)
  'floor_tiles_08', 'rubber_tiles', 'plastered_wall_04', 'concrete_panels',
  'metal_plate', 'metal_plate_02',
];

async function textures() {
  for (const id of TEXTURE_SETS) {
    const files = await phFiles(id);
    const outDir = path.join(ASSETS, 'textures', hyphen(id));
    fs.mkdirSync(outDir, { recursive: true });
    const maps = { color: files.Diffuse, normal: files.nor_gl, arm: files.arm };
    for (const [name, entry] of Object.entries(maps)) {
      if (!entry) { console.warn(`  ${id}: no ${name}`); continue; }
      const src = entry['1k'].jpg.url;
      const raw = await download(src, path.join(CACHE, 'tex', id, path.basename(src)));
      const quality = name === 'normal' ? 90 : 82;
      await sharp(raw).resize(1024, 1024, { fit: 'fill' }).webp({ quality }).toFile(path.join(outDir, `${name}.webp`));
    }
    console.log(`texture  ${hyphen(id)}`);
  }
}

/* ------------------------------------------------------------------ */
/* Props: Poly Haven glTF (1k) → simplified, WebP, meshopt .glb        */
/*   [id, era folder, max triangles, texture size]                     */
/* ------------------------------------------------------------------ */
const MODELS = [
  // Ancient Ruins
  ['rock_moss_set_01', 'ruins', 9000, 1024],
  ['rock_moss_set_02', 'ruins', 8000, 1024],
  ['fern_02', 'ruins', 6300, 1024],
  ['shrub_02', 'ruins', 9000, 1024],
  ['stone_fire_pit', 'ruins', 4000, 1024],
  ['gothic_statue', 'ruins', 9000, 1024],
  ['lion_head', 'ruins', 5000, 512],
  ['antique_ceramic_vase_01', 'ruins', 4000, 512],
  ['large_iron_gate', 'ruins', 9000, 1024],
  ['tree_stump_01', 'ruins', 5000, 512],
  ['dead_tree_trunk', 'ruins', 7000, 1024],
  // Modern Laboratory
  ['metal_office_desk', 'lab', 7000, 1024],
  ['steel_frame_shelves_01', 'lab', 4400, 1024],
  ['chemistry_set', 'lab', 9000, 1024],
  ['industrial_microscope', 'lab', 6000, 512],
  ['bunsen_burner', 'lab', 3000, 512],
  ['circuit_board', 'lab', 4000, 512],
  ['classic_laptop', 'lab', 6000, 512],
  ['security_camera_01', 'lab', 4000, 512],
  ['mounted_fluorescent_lights', 'lab', 6000, 512],
  ['hanging_industrial_lamp', 'lab', 5000, 512],
  ['portable_generator', 'lab', 9000, 1024],
  ['power_box_01', 'lab', 7000, 1024],
  ['drawer_cabinet', 'lab', 7000, 1024],
  ['metal_tool_chest', 'lab', 6000, 512],
  ['standing_chalkboard_01', 'lab', 2400, 1024],
  ['korean_fire_extinguisher_01', 'lab', 4000, 512],
  ['clipboard', 'lab', 2000, 512],
  ['cardboard_box_01', 'lab', 3000, 512],
  ['WetFloorSign_01', 'lab', 300, 512],
  ['vintage_grandfather_clock_01', 'lab', 8000, 1024],
  ['SchoolChair_01', 'lab', 5100, 512],
  ['utility_box_01', 'lab', 4400, 512],
  ['modular_pipes', 'lab', 12000, 1024],
  ['Television_01', 'lab', 2000, 512],
];

function triangleCount(doc) {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      tris += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  }
  return Math.round(tris);
}

async function makeIO() {
  await MeshoptSimplifier.ready;
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
}

async function models(only) {
  const io = await makeIO();
  for (const [id, era, maxTris, texSize] of MODELS) {
    if (only && !only.includes(id)) continue;
    const files = await phFiles(id);
    const g = files.gltf['1k'].gltf;
    const dir = path.join(CACHE, 'models', id);
    const gltfPath = await download(g.url, path.join(dir, path.basename(g.url)));
    for (const [rel, inc] of Object.entries(g.include || {})) {
      await download(inc.url, path.join(dir, rel));
    }
    const doc = await io.read(gltfPath);
    const before = triangleCount(doc);
    const ratio = Math.min(1, maxTris / before);
    const steps = [dedup(), prune(), weld()];
    if (ratio < 0.98) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01 }));
    steps.push(
      prune(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texSize, texSize], quality: 82 }),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    await doc.transform(...steps);
    const out = path.join(ASSETS, 'models', era, `${hyphen(id)}.glb`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await io.write(out, doc);
    console.log(`model    ${era}/${hyphen(id)}.glb  ${before} → ${triangleCount(doc)} tris  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
  }
}

/* ------------------------------------------------------------------ */
/* Hero: KayKit Rogue (hooded) — keep only the clips the game plays     */
/* ------------------------------------------------------------------ */
const HERO_CLIPS = [
  'Idle', 'Walking_A', 'Running_A', 'Jump_Start', 'Jump_Idle', 'Jump_Land',
  'Interact', 'PickUp', 'Hit_A', 'Death_A', 'Cheer', 'Dodge_Forward', 'Use_Item',
];
const KAYKIT_URL = 'https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/archive/672074b73ba276876a19e8816ecdc5241817ab47.zip';

async function hero() {
  const io = await makeIO();
  const zip = await download(KAYKIT_URL, path.join(CACHE, 'kaykit-adventurers.zip'));
  const unz = path.join(CACHE, 'kaykit');
  if (!fs.existsSync(unz)) execFileSync('unzip', ['-q', '-o', zip, '-d', unz]);
  const src = execFileSync('find', [unz, '-name', 'Rogue_Hooded.glb']).toString().trim().split('\n')[0];
  const doc = await io.read(src);
  for (const anim of doc.getRoot().listAnimations()) {
    if (!HERO_CLIPS.includes(anim.getName())) anim.dispose();
  }
  // A time traveller carries no crossbow or knives: drop the weapon props
  // parented to the hand slots (our own hourglass gear is added in code).
  const WEAPONS = ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable'];
  for (const node of doc.getRoot().listNodes()) {
    if (WEAPONS.includes(node.getName())) node.dispose();
  }
  // Recolour: the rogue's forest-green hood/cape/tunic becomes a midnight
  // "time-mage" blue. The texture is a gradient palette atlas, so shifting the
  // hue of every green texel recolours exactly those garments.
  for (const tex of doc.getRoot().listTextures()) {
    const img = sharp(Buffer.from(tex.getImage()));
    const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      if (d < 0.12 || max !== g) continue;                 // only saturated greens
      let h = 60 * (((b - r) / d) + 2);                     // hue in degrees (green-dominant)
      if (h < 95 || h > 175) continue;
      h = h + 88;                                           // ~150° green → ~238° midnight indigo
      const s = (d / max) * 0.6, v = max * 0.8; // deeper, less garish
      const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
      const [rr, gg, bb] = h < 240 ? [0, x, c] : [x, 0, c];
      data[i] = Math.round((rr + m) * 255);
      data[i + 1] = Math.round((gg + m) * 255);
      data[i + 2] = Math.round((bb + m) * 255);
    }
    const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    tex.setImage(new Uint8Array(png)).setMimeType('image/png');
  }
  await doc.transform(
    prune(), dedup(), resample(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 92 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const out = path.join(ASSETS, 'models', 'hero', 'time-traveller.glb');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await io.write(out, doc);
  console.log(`hero     ${(fs.statSync(out).size / 1024).toFixed(0)} KB, clips: ${doc.getRoot().listAnimations().map((a) => a.getName()).join(', ')}`);
}

/* ------------------------------------------------------------------ */
/* Audio: music loops (OpenGameArt, CC0) + Kenney SFX → Ogg Opus      */
/* ------------------------------------------------------------------ */
const MUSIC = [
  ['title', 'https://opengameart.org/sites/default/files/song21_0.mp3'],
  ['ruins', 'https://opengameart.org/sites/default/files/zeal-soul.ogg'],
  ['lab', 'https://opengameart.org/sites/default/files/elevator_to_reactor_0.mp3'],
  ['neon', "https://opengameart.org/sites/default/files/Cool%2080%27s%20Synth%20Wave.wav"],
];
const KENNEY = {
  impact: 'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip',
  ui: 'https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip',
  scifi: 'https://kenney.nl/media/pages/assets/sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds.zip',
  rpg: 'https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip',
  jingles: 'https://kenney.nl/media/pages/assets/music-jingles/f37e530b9e-1677590399/kenney_music-jingles.zip',
};
// [output name, pack, source file]
const SFX = [
  ['step-grass-0', 'impact', 'footstep_grass_000.ogg'], ['step-grass-1', 'impact', 'footstep_grass_001.ogg'],
  ['step-grass-2', 'impact', 'footstep_grass_002.ogg'], ['step-grass-3', 'impact', 'footstep_grass_003.ogg'],
  ['step-stone-0', 'impact', 'footstep_concrete_000.ogg'], ['step-stone-1', 'impact', 'footstep_concrete_001.ogg'],
  ['step-stone-2', 'impact', 'footstep_concrete_002.ogg'], ['step-stone-3', 'impact', 'footstep_concrete_003.ogg'],
  ['step-metal-0', 'impact', 'impactMetal_light_000.ogg'], ['step-metal-1', 'impact', 'impactMetal_light_001.ogg'],
  ['step-metal-2', 'impact', 'impactMetal_light_002.ogg'], ['step-metal-3', 'impact', 'impactMetal_light_003.ogg'],
  ['land', 'impact', 'impactGeneric_light_002.ogg'],
  ['stone-slide', 'impact', 'impactPlank_medium_000.ogg'],
  ['stone-thud', 'impact', 'impactPunch_heavy_000.ogg'],
  ['bell', 'impact', 'impactBell_heavy_001.ogg'],
  ['glass', 'impact', 'impactGlass_medium_001.ogg'],
  ['metal-clank', 'impact', 'impactMetal_heavy_002.ogg'],
  ['ui-hover', 'ui', 'select_001.ogg'], ['ui-click', 'ui', 'click_002.ogg'],
  ['ui-open', 'ui', 'maximize_003.ogg'], ['ui-close', 'ui', 'minimize_003.ogg'],
  ['ui-error', 'ui', 'error_004.ogg'], ['ui-confirm', 'ui', 'confirmation_002.ogg'],
  ['keypad', 'ui', 'click_004.ogg'], ['glitch', 'ui', 'glitch_002.ogg'],
  ['pickup', 'ui', 'confirmation_004.ogg'], ['rune', 'ui', 'pluck_002.ogg'],
  ['door-open', 'scifi', 'doorOpen_001.ogg'], ['door-close', 'scifi', 'doorClose_001.ogg'],
  ['force-field', 'scifi', 'forceField_001.ogg'], ['zap', 'scifi', 'laserLarge_002.ogg'],
  ['dash', 'scifi', 'laserRetro_003.ogg'], ['power-up', 'scifi', 'spaceEngineLow_002.ogg'],
  ['computer', 'scifi', 'computerNoise_001.ogg'], ['warp', 'scifi', 'lowFrequency_explosion_001.ogg'],
  ['crumble', 'scifi', 'explosionCrunch_002.ogg'], ['hum', 'scifi', 'engineCircular_001.ogg'],
  ['gate', 'rpg', 'doorOpen_2.ogg'], ['creak', 'rpg', 'creak1.ogg'], ['lever', 'rpg', 'metalLatch.ogg'],
  ['page', 'rpg', 'bookFlip2.ogg'], ['switch', 'rpg', 'metalClick.ogg'],
  ['core-get', 'jingles', 'jingles_STEEL04.ogg'], ['fail', 'jingles', 'jingles_NES09.ogg'],
  ['win', 'jingles', 'jingles_STEEL16.ogg'], ['checkpoint', 'jingles', 'jingles_PIZZI03.ogg'],
];

function ffmpeg(args) { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]); }

async function audio() {
  const musicDir = path.join(ASSETS, 'audio', 'music');
  const sfxDir = path.join(ASSETS, 'audio', 'sfx');
  fs.mkdirSync(musicDir, { recursive: true });
  fs.mkdirSync(sfxDir, { recursive: true });
  for (const [name, url] of MUSIC) {
    const raw = await download(url, path.join(CACHE, 'music', `${name}${path.extname(decodeURIComponent(url))}`));
    // Loudness-normalise so era changes don't jump in volume, 96 kbps Opus (Chrome decodes Opus-in-Ogg natively).
    ffmpeg(['-i', raw, '-vn', '-af', 'loudnorm=I=-20:TP=-2:LRA=11', '-ar', '48000', '-c:a', 'libopus', '-b:a', '96k', path.join(musicDir, `${name}.ogg`)]);
    console.log(`music    ${name}.ogg  ${(fs.statSync(path.join(musicDir, `${name}.ogg`)).size / 1024).toFixed(0)} KB`);
  }
  const packs = {};
  for (const [key, url] of Object.entries(KENNEY)) {
    const zip = await download(url, path.join(CACHE, 'kenney', `${key}.zip`));
    const dir = path.join(CACHE, 'kenney', key);
    if (!fs.existsSync(dir)) execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
    packs[key] = dir;
  }
  for (const [name, pack, file] of SFX) {
    const found = execFileSync('find', [packs[pack], '-name', file]).toString().trim().split('\n')[0];
    if (!found) { console.warn(`  missing ${pack}/${file}`); continue; }
    ffmpeg(['-i', found, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '64k', path.join(sfxDir, `${name}.ogg`)]);
  }
  console.log(`sfx      ${SFX.length} files`);
}

/* ------------------------------------------------------------------ */
/* Fonts: Cinzel (titles) + Rajdhani (UI), both SIL Open Font Licence   */
/* ------------------------------------------------------------------ */
async function fonts() {
  const dir = path.join(ASSETS, 'fonts');
  fs.mkdirSync(dir, { recursive: true });
  const families = [['cinzel', 'Cinzel:wght@500;700'], ['rajdhani', 'Rajdhani:wght@500;700']];
  for (const [name, q] of families) {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${q}&display=swap`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36' },
    })).text();
    // Keep the latin subset only: one woff2 per weight.
    const blocks = css.split('@font-face').filter((b) => b.includes('U+0000-00FF'));
    for (const b of blocks) {
      const weight = b.match(/font-weight:\s*(\d+)/)[1];
      const url = b.match(/url\((https:[^)]+\.woff2)\)/)[1];
      await download(url, path.join(dir, `${name}-${weight}.woff2`));
    }
    console.log(`font     ${name}`);
  }
}

const what = process.argv[2] || 'all';
const only = process.argv.slice(3);
if (what === 'textures' || what === 'all') await textures();
if (what === 'models' || what === 'all') await models(only.length ? only : null);
if (what === 'hero' || what === 'all') await hero();
if (what === 'audio' || what === 'all') await audio();
if (what === 'fonts' || what === 'all') await fonts();
