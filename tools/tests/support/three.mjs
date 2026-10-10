export * from '../../../libs/three/three.module.js';
import { Texture } from '../../../libs/three/three.module.js';
// Environment-map generation needs a GPU; it is explicitly excluded here.
export class PMREMGenerator {
  fromScene() { return { texture: new Texture(), dispose() { this.texture.dispose(); } }; }
}
