// Real Three.js geometry/materials; replace only the GPU environment bake.
// These state/interaction tests run without WebGL or external dependencies.
export * from '../libs/three/three.module.js';
import { Texture } from '../libs/three/three.module.js';
export class PMREMGenerator {
  fromScene() { return { texture: new Texture(), dispose() {} }; }
}
