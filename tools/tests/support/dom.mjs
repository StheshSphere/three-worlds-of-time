// Deliberately small test double. It does not test browser rendering or layout.
class Element extends EventTarget {
  constructor() {
    super(); this.style = {}; this.children = []; this.dataset = {}; this.textContent = '';
    const classes = new Set(['hidden']);
    this.classList = { add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)), contains: x => classes.has(x), toggle: (x, on = !classes.has(x)) => on ? classes.add(x) : classes.delete(x) };
    this.context = new Proxy({}, { get(target, key) {
      if (key in target) return target[key];
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (key === 'measureText') return () => ({ width: 100 });
      return () => {};
    } });
  }
  getContext() { return this.context; }
  toDataURL() { return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2iO0AAAAASUVORK5CYII='; }
  append(...items) { this.children.push(...items); }
  appendChild(item) { this.append(item); }
  querySelector() { return new Element(); }
  querySelectorAll() { return []; }
  focus() { document.activeElement = this; }
  blur() { document.activeElement = null; }
  setAttribute() {}
}
const elements = new Map();
const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
globalThis.window = new EventTarget();
globalThis.document = Object.assign(new EventTarget(), {
  body: new Element(), activeElement: null, pointerLockElement: null, hidden: false,
  createElement: () => new Element(), createElementNS: () => new Element(),
  getElementById: get, querySelector: () => null, querySelectorAll: () => [],
  exitPointerLock() { this.pointerLockElement = null; this.dispatchEvent(new Event('pointerlockchange')); },
});
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
export { Element };
