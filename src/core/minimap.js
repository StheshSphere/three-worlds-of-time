import * as THREE from 'three';
import { MAP_LAYER } from './kit.js';

/**
 * Minimap (Viewing rubric: "an orthographic projection as a minimap").
 *
 * A second camera — ORTHOGRAPHIC, looking straight down — follows the
 * player. It only renders layer 2, where the level kit drew a flat shape
 * for every floor and wall, plus our markers. Orthographic projection has no
 * perspective, so distances on the map are true to scale.
 *
 * It's drawn after the main frame into a small viewport in the corner
 * (renderer.setViewport + setScissor), north-up, with a rotating arrow for
 * the player and a pulsing diamond on the current objective.
 */
export class Minimap {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.size = 196;
    this.margin = 22;
    this.range = 26;
    this.enabled = true;
    this.camera = new THREE.OrthographicCamera(-this.range, this.range, this.range, -this.range, 1, 400);
    this.camera.up.set(0, 0, -1);        // north (−Z) at the top of the map
    this.camera.layers.set(MAP_LAYER);

    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, 1.6); arrowShape.lineTo(1.1, -1.1); arrowShape.lineTo(0, -0.45); arrowShape.lineTo(-1.1, -1.1); arrowShape.closePath();
    this.arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, toneMapped: false, fog: false }));
    this.arrow.rotation.x = -Math.PI / 2;
    this.arrow.renderOrder = 100;
    this.arrow.layers.set(MAP_LAYER);
    this.arrow.frustumCulled = false;
    scene.add(this.arrow);

    const diamond = new THREE.Shape();
    diamond.moveTo(0, 1.4); diamond.lineTo(1.0, 0); diamond.lineTo(0, -1.4); diamond.lineTo(-1.0, 0); diamond.closePath();
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0xffc861, depthTest: false, toneMapped: false, transparent: true, fog: false });
    this.marker = new THREE.Mesh(new THREE.ShapeGeometry(diamond), this.markerMat);
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.renderOrder = 99;
    this.marker.layers.set(MAP_LAYER);
    this.marker.visible = false;
    this.marker.frustumCulled = false;
    scene.add(this.marker);
    this._clear = new THREE.Color();
  }

  setObjective(pos, color) {
    if (!pos) { this.marker.visible = false; this._objective = null; return; }
    this.marker.visible = true;
    this._objective = new THREE.Vector3(pos.x, 60, pos.z);
    if (color !== undefined) this.markerMat.color.setHex(color);
  }

  setAccent(hex) { this.arrow.material.color.setHex(hex); }

  render(playerPos, facing, time) {
    if (!this.enabled) return;
    const r = this.renderer;
    const w = r.domElement.clientWidth;
    this.camera.position.set(playerPos.x, playerPos.y + 120, playerPos.z);
    this.camera.lookAt(playerPos.x, playerPos.y, playerPos.z);
    this.arrow.position.set(playerPos.x, playerPos.y + 50, playerPos.z);
    // Shape points to +Y = north after lying flat; facing π means "toward −Z".
    this.arrow.rotation.z = facing - Math.PI;
    if (this.marker.visible && this._objective) {
      this.marker.scale.setScalar(1 + Math.sin(time * 5) * 0.25);
      // Clamp to the map edge so an off-screen objective still points the way.
      const dx = this._objective.x - playerPos.x;
      const dz = this._objective.z - playerPos.z;
      const m = Math.max(Math.abs(dx), Math.abs(dz));
      const lim = this.range - 2;
      const k = m > lim ? lim / m : 1;
      this.marker.position.set(playerPos.x + dx * k, 60, playerPos.z + dz * k);
    }
    const x = w - this.margin - this.size;
    const y = this.margin;
    r.getClearColor(this._clear);
    const alpha = r.getClearAlpha();
    r.setScissorTest(true);
    r.setViewport(x, y, this.size, this.size);
    r.setScissor(x, y, this.size, this.size);
    r.setClearColor(0x07090f, 1);
    r.autoClear = false;
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    r.autoClear = true;
    r.setScissorTest(false);
    r.setViewport(0, 0, w, r.domElement.clientHeight);
    r.setClearColor(this._clear, alpha);
  }
}
