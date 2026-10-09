import * as THREE from 'three';

// TEMPORARY STUB — replaced by the full level in the remaster.
export const meta = { name: 'The Present', numeral: 'II', title: 'The Present', subtitle: 'Chronos Research Facility', objective: 'Restore power', music: 'lab', ambience: 'lab', sky: 'lab', env: 'room', stability: 480, accent: 0x6fd3ff, surface: 'stone' };

export function build(kit, api) {
  kit.light(new THREE.HemisphereLight(0xffffff, 0x333333, 1.2));
  kit.box({ size: [40, 1, 40], pos: [0, -0.5, 0], mat: kit.basic(0x556070), solid: false });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.4), kit.basic(0xffffff, { emissive: 0xff66cc, emissiveIntensity: 3 }));
  core.position.set(0, 1.4, -10);
  kit.add(core);
  kit.interact(core, 'Take the core', () => { api.completeLevel(core.position); return 'pickup'; });
  return kit.result({ spawn: new THREE.Vector3(0, 0, 8), debug: { takeCore: () => core.userData.onInteract() } });
}
