// Node-only adapter: actual game maths/logic; no WebGL or asset decoding.
export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: new URL('./three.mjs', import.meta.url).href, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) return { url: new URL('../../../libs/three/addons/' + specifier.slice(13), import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
