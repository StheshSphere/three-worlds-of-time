// Load the shipped GLB geometry in Node for reach/collision checks. Only image
// decoding is replaced: textures and WebGL rendering are not tested here.
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { assets, MANIFEST } from '../../../src/core/assets.js';

export async function loadModelGeometry() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  loader.register(() => ({ name: 'NODE_GEOMETRY_TEST', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const models = new Map(), shared = new Set();
  for (const [name, path] of Object.entries(MANIFEST.models)) {
    if (name === 'hero') continue; // controller's animation double/fallback remains
    const bytes = await fs.readFile(new URL('../../../assets/' + path, import.meta.url));
    const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      shared.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        shared.add(m); for (const value of Object.values(m)) if (value?.isTexture) shared.add(value);
      }
    });
    models.set(name, gltf);
  }
  const originalProp = assets.prop, originalShared = assets.isShared;
  assets.gltf = name => models.get(name);
  assets.prop = name => models.has(name) ? SkeletonUtils.clone(models.get(name).scene) : originalProp(name);
  assets.isShared = value => shared.has(value) || originalShared(value);
  console.log(`Loaded ${models.size} shipped GLBs for geometry checks (texture decoding skipped).`);
}
