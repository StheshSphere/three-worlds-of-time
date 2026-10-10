/**
 * Execute real controller, level builders, puzzles, transitions and disposal in Node.
 * Renderer/DOM/audio are doubles; missing cached props use the game's fallback meshes.
 * This is NOT a browser playthrough, shader compilation, visual QA or FPS measurement.
 * Run from root: node tools/test-integration.mjs
 */
import { register } from 'node:module';
import assert from 'node:assert/strict';
register('./tests/support/loader.mjs', import.meta.url);
const { Element } = await import('./tests/support/dom.mjs');
const THREE = await import('three');
const { settings } = await import('../src/core/settings.js');
const { Player } = await import('../src/player.js');
const { createTimeMachine } = await import('../src/timeMachine.js');
const { createLevelManager } = await import('../src/levelManager.js');
const { createKit } = await import('../src/core/kit.js');
const { UI } = await import('../src/core/ui.js');
const { Cutscene } = await import('../src/core/cutscene.js');
const { assets } = await import('../src/core/assets.js');
settings.set('quality', 'low');
const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, status: 'PASS' }); console.log('PASS', name); }
  catch (e) { results.push({ name, status: 'FAIL', error: e.stack }); console.error('FAIL', name, e.stack); }
}
const dom = new Element();
dom.requestPointerLock = () => { document.pointerLockElement = dom; document.dispatchEvent(new Event('pointerlockchange')); };
const camera = new THREE.PerspectiveCamera(72, 16/9, 0.05, 600);
const player = new Player(camera, dom);
const scene = new THREE.Scene();
scene.add(player.object, player.worldFx, camera);
const tm = createTimeMachine(); scene.add(tm);
const sounds = [];
const positionals = new Set();
const audio = {
  play(name) { sounds.push(name); }, stopEffects() {}, stopMusic() {}, duck() {},
  playMusic(name) { this.music = name; }, setAmbience(name) { this.ambience = name; },
  positional(name, object) {
    const sound = { isPlaying: true, setVolume() {}, pause() { this.isPlaying = false; }, play() { this.isPlaying = true; } };
    const handle = { sound, dispose() { sound.isPlaying = false; positionals.delete(handle); } };
    positionals.add(handle); return handle;
  },
};
const ui = new UI(audio);
const postfx = { u: { uGlitch: { value: 0 }, uWarp: { value: 0 }, uFlash: { value: 0 } }, setEra() {} };
const minimap = { setObjective() {}, setAccent() {} };
const levels = createLevelManager({ scene, renderer: {}, camera, player, timeMachine: tm, audio, ui, postfx, minimap });
const tick = (seconds, physics = false) => { for (let i=0;i<Math.ceil(seconds*60);i++) { levels.update(1/60); tm.update(1/60); scene.updateMatrixWorld(true); if (physics) player.update(1/60); } };
const press = code => { const e = new Event('keydown', { cancelable:true }); Object.assign(e,{code,repeat:false}); window.dispatchEvent(e); };

// Shared cached assets have no public mutation API. Exercise the ownership decision
// using the real predicate for normal resources and a tagged sentinel for cache-owned ones.
test('Era game-time delay waits, fires once and stays paused without updates', () => {
  const kit=createKit({}); let n=0; kit.after(()=>n++,500); const l=kit.result(); l.update(.2,0); assert.equal(n,0); l.update(.3,0); l.update(1,0); assert.equal(n,1);
});
test('Read panel opening is guarded from the same E event and duplicate stack entries', () => {
  ui.openReader({title:'Clue',body:'A clue'}); assert.equal(ui.justOpened,true); ui.openPanel('reader-screen'); assert.equal(ui.stack.length,1); ui.closeAllPanels();
});
test('Closing all panels drops a stale keypad submission callback', () => {
  ui.openKeypad(()=>true); ui.closeAllPanels(); assert.equal(ui.onKeypadSubmit,null);
});
test('Input clears on blur, freeze and full reset (including buffered jump and dash)', () => {
  player.lock(); press('KeyW'); press('Space'); assert.equal(player.keys.forward,true);
  window.dispatchEvent(new Event('blur')); assert.equal(player.keys.forward,false); assert.equal(player._jumpBuffer,0);
  player.frozen=true; press('KeyW'); const before=player.mode; press('KeyV'); assert.equal(player.keys.forward,false); assert.equal(player.mode,before);
  player.frozen=false; player._dashCooldown=.8; player._airDashUsed=true; player.keys.forward=true; player.reset();
  assert.equal(player._dashCooldown,0); assert.equal(player._airDashUsed,false); assert.equal(player.keys.forward,false);
});
test('Dash cannot tunnel through a 0.02 m wall at the maximum 50 ms frame step', () => {
  const wall=new THREE.Object3D(); wall.userData.solidBox=new THREE.Box3(new THREE.Vector3(-5,0,-.01),new THREE.Vector3(5,4,.01));
  player.setLevel({colliders:[wall],spawn:new THREE.Vector3(0,0,.6)}); player.canDash=true; player.onGround=true; player.tryDash(); player.update(.05);
  assert.ok(player.position.z>=.35-1e-6, `z=${player.position.z}`);
});
test('Third-person camera respects physics-only wall and switches view without changing yaw', () => {
  const wall=new THREE.Object3D(); wall.userData.solidBox=new THREE.Box3(new THREE.Vector3(-5,0,1),new THREE.Vector3(5,5,1.02));
  player.setLevel({colliders:[wall],spawn:new THREE.Vector3()}); player.mode='third'; player._placeCamera(.016);
  assert.ok(camera.position.z<1, `camera z=${camera.position.z}`);
  const yaw=player.yaw; press('KeyV'); assert.equal(player.mode,'first'); press('KeyV'); assert.equal(player.mode,'third'); assert.equal(player.yaw,yaw);
});
test('Jump lands on a thin floor and moving-platform carry changes player position', () => {
  const floor=new THREE.Mesh(new THREE.BoxGeometry(20,.1,20),new THREE.MeshBasicMaterial()); floor.position.y=-.05; floor.updateMatrixWorld(true);
  player.setLevel({walkables:[floor],spawn:new THREE.Vector3(0,0,0)}); player.update(.016); assert.equal(player.onGround,true);
  press('Space'); player.update(.016); assert.ok(player.position.y>0);
  for(let i=0;i<90;i++) player.update(1/60);
  assert.equal(player.onGround,true); assert.ok(Math.abs(player.position.y)<1e-6);
  floor.userData.carryDelta=new THREE.Vector3(.2,0,0); const x=player.position.x; player.update(.016); assert.ok(player.position.x>x+.19);
});
for (const view of ['first','third']) {
  test(`${view}: Ancient plates, mirrors, tablets and drums unlock core; progress 1/3`, () => {
    settings.set('thirdPerson', view === 'third');
    levels.restartRun(); player.mode=view; assert.equal(tm.getCores(),0); assert.equal(player.hasCheckpoint,false);
    const d=levels.debug; d.solveBlocks(); assert.equal(d.state.gateOpen,true); d.alignMirrors(); d.readTablets(); ui.closeAllPanels(); d.solveDrums(); tick(3);
    assert.equal(d.state.crystalLit,true); assert.equal(d.state.dialsSolved,true); d.takeCore(); tick(3.5);
    assert.equal(levels.index,1); assert.equal(levels.state,'playing'); assert.equal(tm.getCores(),1);
    assert.equal(audio.music,'lab'); assert.equal(audio.ambience,'lab'); assert.equal(player.hasCheckpoint,false);
    assert.equal(document.getElementById('core-count').textContent,'Cores 1 / 3');
  });
  test(`${view}: Lab investigation, wrong/right keypad, conduit power, field and core; progress 2/3`, () => {
    const d=levels.debug; d.readLogs(); assert.equal(d.state.readIncident,true); ui.closeAllPanels(); d.takeFlashlight(); assert.equal(player.flashlightOn,true);
    player.setFlashlight(false); assert.equal(player.flashlightOn,false); player.setFlashlight(true);
    d.revealAll();
    const pad=levels.level.interactables.find(o=>String(typeof o.userData.prompt==='function'?o.userData.prompt():o.userData.prompt).includes('4-digit'));
    assert.ok(pad); pad.userData.onInteract(); assert.equal(ui.onKeypadSubmit('xxxx'),false); assert.equal(ui.onKeypadSubmit(d.code),true); ui.closeAllPanels();
    tick(.4); assert.equal(d.state.doorOpen,true); assert.equal(player.hasCheckpoint,true);
    const cp=player.getCheckpoint().position.clone(); player.position.set(20,-30,20); levels.registerFall(); assert.ok(player.position.equals(cp));
    d.solveGrid(); tick(3); assert.equal(d.state.power,true); d.dropField(); tick(2); assert.equal(d.state.fieldDown,true); d.takeCore(); tick(3.5);
    assert.equal(levels.index,2); assert.equal(tm.getCores(),2); assert.equal(player.flashlight,null); assert.equal(audio.music,'neon');
  });
  test(`${view}: Future hazards animate, checkpoint respawns, sequence gates core, finale reaches 3/3`, () => {
    const d=levels.debug; d.goto(3); player.frozen=true; const before=JSON.stringify(d.movers()); tick(.5); assert.notEqual(JSON.stringify(d.movers()),before);
    assert.ok(d.gauntlet().barriers.length); assert.ok(d.phases().length);
    const cp=player.getCheckpoint().position.clone(); player.position.y=-40; levels.registerFall(); assert.ok(player.position.equals(cp)); player.frozen=false;
    d.takeCore(); assert.equal(d.state.coreTaken,false); assert.equal(d.solvePuzzle(),true); d.takeCore(); assert.equal(d.state.coreTaken,true);
    tick(2); assert.equal(levels.state,'finale'); assert.equal(tm.getCores(),3); assert.equal(tm.userData.isRestoring,true);
    tick(7); assert.equal(levels.state,'won');
    assert.equal(document.getElementById('core-count').textContent,'Cores 3 / 3');
  });
  test(`${view}: Restart clears all core/puzzle/checkpoint/flashlight/dash state`, () => {
    levels.restartRun(); assert.equal(levels.index,0); assert.equal(tm.getCores(),0); assert.equal(player.hasCheckpoint,false); assert.equal(player.canDash,false); assert.equal(player.flashlight,null);
    assert.equal(levels.debug.state.gateOpen,false); assert.equal(levels.debug.state.coreTaken,false); assert.equal(levels.stats.runTime,0); assert.ok(player.position.equals(player.spawn));
    assert.equal(player.mode, view);
  });
}
test('Retry keeps previous cores and resets the current era', () => {
  tm.lightSocket(0); levels.load(1); levels.debug.solveGrid(); levels.retryEra(); assert.equal(tm.getCores(),1); assert.equal(levels.debug.state.power,false); assert.equal(player.hasCheckpoint,false);
});
test('Old hurt-respawn cannot move a player in a newly loaded era', () => {
  player._invuln=0; levels.api.hurt({respawn:true}); levels.load(2); player.position.set(4,1,4); tick(.6); assert.equal(player.position.x,4);
});
test('Repeated level swaps dispose owned resources and retain shared sentinels', () => {
  const sharedGeo=new THREE.BoxGeometry(), sharedMat=new THREE.MeshBasicMaterial(), sharedTex=new THREE.Texture(); sharedMat.map=sharedTex;
  const oldPredicate=assets.isShared; const shared=new Set([sharedGeo,sharedMat,sharedTex]); assets.isShared=r=>shared.has(r)||oldPredicate(r);
  let sharedDisposed=0, ownedDisposed=0;
  for(const r of shared) r.addEventListener('dispose',()=>sharedDisposed++);
  const counts=[];
  for(let round=0;round<3;round++) {
    levels.load(0); const owned=new THREE.BoxGeometry(); owned.addEventListener('dispose',()=>ownedDisposed++);
    const root=scene.getObjectByName('Level'); const mesh=new THREE.Mesh(sharedGeo,sharedMat); const own=new THREE.Mesh(owned,new THREE.MeshBasicMaterial()); root.add(mesh,own); levels.level.objects.push(mesh,own);
    levels.load(1); levels.load(2); levels.load(0); counts.push(positionals.size);
  }
  assert.equal(sharedDisposed,0); assert.equal(ownedDisposed,3); assert.ok(counts.every(n=>n===counts[0])); assets.isShared=oldPredicate;
});
test('Cutscene finish releases old set closures and cancellation does not run completion', () => {
  const cs=new Cutscene({camera,ui}); let completed=0; cs.play([{at:1,run(){},end:true}],{onDone:()=>completed++}); cs.finish(); assert.equal(completed,1); assert.equal(cs.steps.length,0); assert.equal(cs.ctx,null);
  cs.play([{at:1,end:true}],{onDone:()=>completed++}); cs.cancel(); assert.equal(completed,1); assert.equal(cs.active,false);
});
ui.resetTransient();
console.log(JSON.stringify({suite:'Node logic integration (renderer, DOM and audio doubles)',passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length,results},null,2));
process.exit(results.some(x=>x.status==='FAIL')?1:0);
