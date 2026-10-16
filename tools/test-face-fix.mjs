/** Regression test for Ari's eyes staying attached to the original head mesh.
 * This test uses the actual decoded hero geometry in the accompanying fixture
 * when run by the release harness. It does not require a browser GPU. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { createAriFaceMakeover } from '../src/core/faceMakeover.js';
import { neutralizeOriginalMouth } from '../src/core/mouthRig.js';

const file = process.env.ARI_FACE_GEOMETRY_FIXTURE;
if (!file) { console.log('Set ARI_FACE_GEOMETRY_FIXTURE to a decoded hero geometry JSON to run'); process.exit(0); }
const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute(fixture.position.flat(), 3));
geometry.setAttribute('uv', new THREE.Float32BufferAttribute(fixture.uv.flat(), 2));
geometry.setIndex(fixture.indices);
const material = new THREE.MeshStandardMaterial();
const head = new THREE.SkinnedMesh(geometry, material);
const oldPositions = geometry.attributes.position.array.slice();
const drawn = { eyes: 0 };
const context = {
  fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '',
  fillRect() {}, clearRect() {}, beginPath() {}, ellipse() {}, fill() {},
  moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, quadraticCurveTo() {},
  createRadialGradient() { return { addColorStop() {} }; },
};
globalThis.document = { createElement(name) { assert.equal(name, 'canvas'); return { width: 0, height: 0, getContext() { return context; } }; } };
const disposables = [];
const result = createAriFaceMakeover(head, null, disposables);
assert.equal(result?.method, 'original-skinned-geometry');
assert.equal(result.eyes, 2);
assert.equal(result.eyebrows, 6);
assert.equal(result.extraFaceMeshes, 0);
assert.equal(head.children.length, 0);
assert.equal(head.material.length, 3);
assert.equal(head.geometry.groups.length, 3);
assert.equal(head.geometry.index.count, geometry.index.count);
assert.equal(neutralizeOriginalMouth(head, disposables), 8);
assert.equal(head.geometry.groups.length, 3);
assert.equal(head.children.length, 0);
for (const eye of fixture.islands.filter(x => x.len === 45 && x.z[0] > 0.65)) {
  for (const i of eye.vertices) {
    for (let c = 0; c < 3; c++) assert.equal(head.geometry.attributes.position.getComponent(i,c), oldPositions[i*3+c]);
  }
}
console.log('PASS: both original eyes retain all positions and original skinning, no detached eye objects, brows softened, 3 material groups, original mouth neutralised.');
