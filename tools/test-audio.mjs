/**
 * Real AudioManager and Three.Audio nodes with a deterministic Web Audio double.
 * Checks lifecycle/volume routing only; sound quality and browser autoplay are not tested.
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./tests/support/loader.mjs', import.meta.url);
await import('./tests/support/dom.mjs');
const THREE = await import('three');
const { AudioManager } = await import('../src/core/audio.js');
const { assets } = await import('../src/core/assets.js');
const { settings } = await import('../src/core/settings.js');

class Param {
  value = 1;
  setValueAtTime(v) { this.value=v; return this; }
  setTargetAtTime(v) { this.value=v; return this; }
  linearRampToValueAtTime(v) { this.value=v; return this; }
  cancelScheduledValues() { return this; }
}
class Node {
  constructor(ctx) {
    this.ctx=ctx; this.connections=new Set();
    for(const key of ['gain','playbackRate','detune','frequency','Q']) this[key]=new Param();
  }
  connect(n) { this.connections.add(n); return n; }
  disconnect(n) { if(n) this.connections.delete(n); else this.connections.clear(); }
  start() { this.started=true; }
  stop(t=this.ctx.currentTime) { this.stopAt=t; this.ctx.pending.add(this); }
}
class Context extends EventTarget {
  state='running'; currentTime=0; sampleRate=100; pending=new Set(); listeners=new Set(); destination={};
  createGain() { return new Node(this); }
  createBufferSource() { return new Node(this); }
  createOscillator() { return new Node(this); }
  createBiquadFilter() { return new Node(this); }
  createPanner() { return new Node(this); }
  createBuffer(ch,len,rate) { return { duration:len/rate, getChannelData:()=>new Float32Array(len) }; }
  addEventListener(name,fn) { if(name==='statechange') this.listeners.add(fn); super.addEventListener(name,fn); }
  removeEventListener(name,fn) { this.listeners.delete(fn); super.removeEventListener(name,fn); }
  async resume() { this.state='running'; this.dispatchEvent(new Event('statechange')); }
  advance(t=0) {
    this.currentTime+=t;
    for(const source of [...this.pending]) if(source.stopAt<=this.currentTime) { this.pending.delete(source); source.onended?.(); }
  }
}
const ctx=new Context(); THREE.AudioContext.setContext(ctx);
const audio=new AudioManager(new THREE.PerspectiveCamera());
const original=assets.audio; assets.audio=()=>({duration:1});
const results=[];
function test(name,fn) {
  try { fn(); results.push({name,status:'PASS'}); }
  catch(e) { results.push({name,status:'FAIL',error:e.stack}); }
}
test('Rapid era music changes retain at most two tracks; ended tracks disconnect',()=>{
  audio.playMusic('ruins'); const first=audio.music;
  audio.playMusic('lab'); audio.playMusic('neon');
  assert.equal(audio.musicTracks.size,2); assert.equal(first.source.connections.size,0); assert.equal(first.gain.connections.size,0);
  ctx.advance(3); assert.equal(audio.musicTracks.size,1);
  audio.stopMusic(.1); ctx.advance(1); assert.equal(audio.musicTracks.size,0);
});
test('One-shot effects stop on unload and release their connections',()=>{
  audio.play('zap'); audio.play('step-stone-0'); const sources=[...audio.effects];
  assert.equal(sources.length,2); audio.stopEffects(); ctx.advance();
  assert.equal(audio.effects.size,0); assert.ok(sources.every(s=>s.connections.size===0));
});
test('Disposed positional audio cannot start later when the context unlocks',()=>{
  ctx.state='suspended'; const owner=new THREE.Object3D();
  const handle=audio.positional('hum',owner);
  assert.equal(ctx.listeners.size,1); assert.equal(audio.positionals.size,1);
  handle.dispose(); handle.dispose(); assert.equal(ctx.listeners.size,0);
  ctx.state='running'; ctx.dispatchEvent(new Event('statechange'));
  assert.equal(handle.sound.isPlaying,false); assert.equal(handle.sound.buffer,null);
  assert.equal(audio.positionals.size,0); assert.equal(owner.children.length,0);
});
test('Ambience reuse/crossfade is bounded and volume settings route to every bus',()=>{
  audio.setAmbience('ruins'); const first=audio.ambience; audio.setAmbience('ruins'); assert.equal(audio.ambience,first);
  audio.setAmbience('lab'); audio.setAmbience('neon');
  assert.ok(first.nodes.every(n=>n.connections.size===0));
  assert.equal(audio._ambienceTail.era,'lab'); assert.equal(audio.ambience.era,'neon');
  settings.set('masterVolume',0); assert.equal(audio.listener.gain.gain.value,0);
  settings.set('masterVolume',.6); settings.set('musicVolume',.3); settings.set('sfxVolume',.4);
  assert.equal(audio.listener.gain.gain.value,.6); assert.equal(audio.musicBus.gain.value,.3); assert.equal(audio.sfxBus.gain.value,.4); assert.ok(Math.abs(audio.ambBus.gain.value-.32)<1e-9);
});
assets.audio=original;
if(audio.ambience) audio._disposeAmbience(audio.ambience);
if(audio._ambienceTail) audio._disposeAmbience(audio._ambienceTail);
console.log(JSON.stringify({suite:'Audio lifecycle with Web Audio double',passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length,results},null,2));
process.exitCode=results.some(x=>x.status==='FAIL')?1:0;
