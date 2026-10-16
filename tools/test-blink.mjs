import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { createAriFaceMakeover, createBlinkController } from '../src/core/faceMakeover.js';
const fixturePath = process.env.ARI_FACE_GEOMETRY_FIXTURE;
assert(fixturePath, 'Set ARI_FACE_GEOMETRY_FIXTURE to decoded hero geometry fixture');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute(fixture.position.flat(), 3));
geometry.setAttribute('uv', new THREE.Float32BufferAttribute(fixture.uv.flat(), 2));
geometry.setIndex(fixture.indices);
const head = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
const drawn = { strokes: 0, fills: 0, lines: 0 };
const ctx = {
  fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '',
  clearRect() {}, fillRect() {}, beginPath() {}, ellipse() {},
  fill() { drawn.fills++; }, moveTo() {}, lineTo() { drawn.lines++; },
  closePath() {}, stroke() { drawn.strokes++; }, quadraticCurveTo() {},
  createRadialGradient() { return { addColorStop() {} }; },
};
globalThis.document = { createElement(name) { assert.equal(name, 'canvas'); return { width: 0, height: 0, getContext() { return ctx; } }; } };
const disposables = [];
const face = createAriFaceMakeover(head, null, disposables);
assert.equal(face.method, 'original-skinned-geometry');
assert.equal(face.eyes, 2);
assert.equal(face.extraFaceMeshes, 0);
assert.equal(head.children.length, 0);
assert.equal(head.material.length, 3);
const initial = drawn.strokes;
for (let i = 0; i < 360; i++) face.update(1/60);
assert(drawn.strokes > initial, 'Blink animation must redraw eyelids and eyelashes');
assert.equal(head.children.length, 0, 'Blink must never add detached eye meshes');
face.reset();
const sequence = [];
const controller = createBlinkController(v => sequence.push(v), () => 0.5);
for (let i = 0; i < 260; i++) controller.update(1/60);
assert(sequence.some(x => x > 0.95), 'Blink must fully close');
assert.equal(sequence.at(-1), 0, 'Eye must reopen completely');
assert.equal(sequence.filter(x => x > 0.95).length > 0, true);
assert.equal(head.geometry.index.count, geometry.index.count);
console.log('PASS: original skinned eyes, eyelid/eyelash drawing, ~4s blink, full closure/reopen, no detached meshes');
