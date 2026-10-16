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
const { JourneyStore, SAVE_KEY, validateSave } = await import('../src/core/save.js');
const { Player } = await import('../src/player.js');
const { createTimeMachine } = await import('../src/timeMachine.js');
const { createLevelManager } = await import('../src/levelManager.js');
const { createKit } = await import('../src/core/kit.js');
const { UI } = await import('../src/core/ui.js');
const { Cutscene } = await import('../src/core/cutscene.js');
const { assets } = await import('../src/core/assets.js');
const { ARRIVALS, ERA_CARDS } = await import('../src/story.js');
const { summarizeJourney, scoreLevel } = await import('../src/core/stats.js');
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
  play(name) { sounds.push(name); }, stopEffects() {}, stopMusic() {}, duck() {}, playVoice() {}, stopVoice() {},
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
const continueDialogue = () => { let n=0; while (ui.dialogue.active) { assert.ok(++n<50); assert.ok(ui.dialogue.advance()); } };
const play = (seconds, physics = false) => { for (let i=0;i<Math.ceil(seconds*60);i++) { continueDialogue(); tick(1/60,physics); } continueDialogue(); };

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
  window.dispatchEvent(new Event('focus'));
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
    levels.restartRun(); continueDialogue(); player.mode=view; assert.equal(tm.getCores(),0); assert.equal(player.hasCheckpoint,false);
    const d=levels.debug; d.solveBlocks(); assert.equal(d.state.gateOpen,true); d.alignMirrors(); d.readTablets(); ui.closeAllPanels(); d.solveDrums(); play(3);
    assert.equal(d.state.crystalLit,true); assert.equal(d.state.dialsSolved,true); d.takeCore(); continueDialogue(); play(3.5); continueDialogue();
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
    play(.4); assert.equal(d.state.doorOpen,true); assert.equal(player.hasCheckpoint,true);
    const cp=player.getCheckpoint().position.clone(); player.position.set(20,-30,20); levels.registerFall(); assert.ok(player.position.equals(cp));
    d.solveGrid(); play(3); assert.equal(d.state.power,true); d.dropField(); play(2); assert.equal(d.state.fieldDown,true); d.takeCore(); continueDialogue(); play(3.5); continueDialogue();
    assert.equal(levels.index,2); assert.equal(tm.getCores(),2); assert.equal(player.flashlight,null); assert.equal(audio.music,'neon');
  });
  test(`${view}: Future hazards animate, checkpoint respawns, sequence gates core, finale reaches 3/3`, () => {
    const d=levels.debug; d.goto(3); player.frozen=true; const before=JSON.stringify(d.movers()); play(.5); assert.notEqual(JSON.stringify(d.movers()),before);
    assert.ok(d.gauntlet().barriers.length); assert.ok(d.phases().length);
    const cp=player.getCheckpoint().position.clone(); player.position.y=-40; levels.registerFall(); assert.ok(player.position.equals(cp)); player.frozen=false;
    d.takeCore(); assert.equal(d.state.coreTaken,false); assert.equal(d.solvePuzzle(),true); d.takeCore(); assert.equal(d.state.coreTaken,true);
    continueDialogue(); play(2); assert.equal(levels.state,'finale'); assert.equal(tm.getCores(),3); assert.equal(tm.userData.isRestoring,true);
    play(7); assert.equal(levels.state,'won');
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
  continueDialogue(); player._invuln=0; levels.api.hurt({respawn:true}); levels.load(2); player.position.set(4,1,4); tick(.6); assert.equal(player.position.x,4);
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
test('Every era holds its narrative card and countdown until Enter/click acknowledgement', () => {
  for (let i=0;i<3;i++) {
    levels.load(i); const runTime=levels.stats.runTime;
    assert.equal(levels.state,'arrival'); assert.equal(player.frozen,true);
    tick(30); assert.equal(levels.state,'arrival'); assert.equal(levels.stats.runTime,runTime);
    assert.equal(ui.dialogue.current.card.line,ERA_CARDS[i].line);
    continueDialogue(); assert.equal(levels.state,'playing'); assert.equal(player.frozen,false);
    levels.api.say('thought',[['Ari',`Era ${i} thought`]]); levels.api.say('thought',[['Ari','Duplicate']]);
    assert.equal(ui.dialogue.queue.length,0); tick(15);
    assert.equal(document.getElementById('caption-text').textContent,`Era ${i} thought`);
    assert.equal(player.frozen,false); continueDialogue();
  }
});
test('Core transition waits for unread lines, then Lab and Future arrivals each wait for their final line', () => {
  levels.callbacks.onEraArrive=i=>ui.say(ARRIVALS[i]);
  levels.restartRun(); continueDialogue();
  for (let i=0;i<2;i++) {
    ui.say([['Ari','Before core'],['Ari','Final thought']]); levels.api.completeLevel();
    tick(20); assert.equal(levels.index,i); assert.equal(levels.state,'transition');
    ui.dialogue.advance(); tick(10); assert.equal(levels.index,i);
    ui.dialogue.advance(); tick(3.5);
    assert.equal(levels.index,i+1); assert.equal(levels.state,'arrival');
    ui.dialogue.advance(); assert.equal(document.getElementById('caption-text').textContent,ARRIVALS[i+1][0][1]);
    ui.dialogue.advance(); tick(15); assert.equal(levels.state,'arrival');
    assert.equal(document.getElementById('caption-text').textContent,ARRIVALS[i+1][1][1]);
    ui.dialogue.advance(); assert.equal(levels.state,'playing'); assert.equal(player.frozen,false);
  }
  levels.callbacks.onEraArrive=null;
});
test('Restart or level replacement cancels pending dialogue-driven transition callbacks', () => {
  levels.restartRun(); continueDialogue(); ui.say([['Ari','Old line']]); levels.api.completeLevel();
  ui.dialogue.setPaused('game',true); levels.restartRun();
  assert.equal(ui.dialogue.queue.length,0); assert.equal(ui.dialogue.current.view,'era-card');
  assert.equal(ui.dialogue.timer,null); ui.dialogue.setPaused('game',false); continueDialogue();
  tick(3.5); assert.equal(levels.index,0); assert.equal(levels.state,'playing');
  ui.say([['Ari','Old level']]); levels.load(2); continueDialogue(); tick(3.5);
  assert.equal(levels.index,2); assert.equal(ui.dialogue.queue.length,0);
});

const storage = new Map();
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,String(v)) };
let pastSave, presentSave, futureSave;
const save = () => { const r=levels.saveGame({silent:true}); assert.equal(r.ok,true,r.reason); const data=levels.readSave().save; assert.ok(validateSave(data)); return data; };
const doorAt = z => player.colliders.some(o => { const b=o.userData.solidBox; return b && b.min.x < 0 && b.max.x > 0 && b.min.z <= z && b.max.z >= z && b.max.y > 2 && b.min.y < 1; });

test('Save 1: Past light puzzle, bridge, mirrors, runes and collision restoration', () => {
  levels.restartRun(); continueDialogue();
  const d=levels.debug; d.solveBlocks(); d.alignMirrors(); d.readTablets(); d.solveDrums(); play(6);
  player.mode='first'; player.yaw=.72;
  const code=[...d.code]; pastSave=save();
  assert.equal(pastSave.eras[0].puzzle.state.bridgeBuilt,true);
  assert.ok(pastSave.journal.length===3);
  levels.load(2); assert.ok(levels.continueJourney(pastSave));
  assert.equal(levels.index,0); assert.equal(player.mode,'first');
  assert.deepEqual(levels.debug.code,code); assert.equal(levels.debug.state.crystalLit,true);
  assert.equal(levels.debug.state.dialsSolved,true); assert.equal(doorAt(-34.6),false);
  const slabs=levels.level.walkables.filter(o=>o.position.z < -56 && o.position.z > -68 && Math.abs(o.position.x)<.01);
  assert.equal(slabs.length,6); assert.ok(slabs.every(o=>Math.abs(o.position.y+.3)<1e-6));
  assert.deepEqual(levels.level.snapshot().mirrors,pastSave.eras[0].puzzle.mirrors);
  assert.deepEqual(levels.level.snapshot().drums,pastSave.eras[0].puzzle.drums);
  assert.equal(ui.journal.length,3);
});

test('Partial puzzle settings and pending instructions survive loading', () => {
  levels.restartRun(); continueDialogue();
  const turns=levels.level.interactables.filter(o=>typeof o.userData.prompt === 'function' && o.userData.prompt() === 'Turn the bronze mirror');
  turns[0].userData.onInteract();
  ui.tutorial({kicker:'Puzzle',title:'Keep this instruction',html:'Read at your own pace.'});
  const data=save(); const before=data.eras[0].puzzle;
  levels.continueJourney(data);
  assert.equal(ui.dialogue.current.card.title,'Keep this instruction');
  assert.deepEqual(levels.level.snapshot().mirrors,before.mirrors);
  const stability=levels.stability; tick(30); assert.equal(levels.stability,stability);
  continueDialogue(); play(1); assert.ok(levels.stability<stability);
  levels.continueJourney(pastSave); continueDialogue();
});

test('Save 2: Core collection commits before transition and continues into Present once', () => {
  levels.debug.takeCore();
  const milestone=levels.readSave().save;
  assert.equal(milestone.eras[0].puzzle.state.coreTaken,true);
  assert.equal(levels.saveGame({silent:true}).ok,false); // cannot capture an unsafe transition
  levels.continueJourney(milestone); continueDialogue();
  assert.equal(levels.index,1); assert.equal(tm.getCores(),1);
  assert.equal(levels.debug.state.coreTaken,false);
  assert.equal(save().eras[0].puzzle.state.crystalLit,true);
});

test('Save 3: Present archive, discovered ink, power, journal and unlocked geometry restore', () => {
  const d=levels.debug; d.readLogs(); ui.closeAllPanels(); d.takeFlashlight(); d.revealAll();
  const pad=levels.level.interactables.find(o=>String(typeof o.userData.prompt==='function'?o.userData.prompt():o.userData.prompt).includes('4-digit'));
  pad.userData.onInteract(); assert.equal(ui.onKeypadSubmit(d.code),true); ui.closeAllPanels();
  play(2); d.solveGrid(); play(5); d.dropField(); play(3);
  player.mode='third'; player.setFlashlight(false);
  const code=d.code; presentSave=save(); levels.continueJourney(presentSave); continueDialogue();
  assert.equal(levels.debug.code,code);
  assert.equal(levels.debug.state.power,true); assert.equal(levels.debug.state.fieldDown,true);
  assert.equal(levels.debug.state.vaultOpen,true); assert.equal(doorAt(-30),false);
  assert.equal(player.flashlightOwned,true); assert.equal(player.flashlightOn,false);
  assert.deepEqual(levels.debug.state.marks,[true,true,true,true]);
  assert.deepEqual(levels.level.snapshot().tiles,presentSave.eras[1].puzzle.tiles);
  const blocksVault=player.colliders.some(o=>{const b=o.userData.solidBox;return b && b.min.x<12.4&&b.max.x>12.2&&b.min.z<0&&b.max.z>0&&b.min.y<1;});
  assert.equal(blocksVault,false);
  assert.equal(ui.journal.filter(j=>j.key==='incident').length,1);
  assert.equal(ui.journal.filter(j=>j.key?.startsWith('mark-')).length,4);
  assert.equal(tm.getCores(),1);
});

test('Save 4: Future checkpoints, permanent lock and safe hazard reset restore', () => {
  levels.debug.takeCore(); continueDialogue(); play(3.6);
  assert.equal(levels.index,2); assert.equal(tm.getCores(),2);
  levels.debug.goto(4); player.onGround=true; play(.1);
  const checkpointSave=save(); levels.continueJourney(checkpointSave); continueDialogue();
  assert.ok(player.position.distanceTo(new THREE.Vector3(0,1.5,-107))<.01);
  assert.equal(levels.debug.state.reached[4],true);
  const d=levels.debug; d.solvePuzzle(); play(1.5); futureSave=save();
  levels.continueJourney(futureSave); continueDialogue();
  assert.equal(levels.debug.state.puzzleSolved,true);
  assert.deepEqual(levels.debug.puzzle().seq,futureSave.eras[2].puzzle.seq);
  assert.equal(levels.debug.collapse().riftActive,false); assert.equal(levels.debug.collapse().fallen,0);
  assert.equal(player.canDash,false); assert.equal(player.flashlight,null);
  assert.ok(player.position.z < -138); // no repeat of the already-completed collapse
  assert.equal(tm.getCores(),2);
});

test('Save 5: Repeated loads preserve object/collider/audio counts and do not duplicate rewards', () => {
  const counts=[];
  for(let i=0;i<4;i++) {
    levels.continueJourney(futureSave); continueDialogue();
    counts.push([levels.level.objects.length,player.colliders.length,player.cameraColliders.length,player.walkables.length,positionals.size,ui.journal.length]);
    assert.equal(tm.getCores(),2); assert.equal(levels.debug.state.coreTaken,false);
  }
  assert.ok(counts.every(c=>JSON.stringify(c)===JSON.stringify(counts[0])));
  levels.debug.takeCore(); continueDialogue(); play(9);
  assert.equal(levels.state,'won'); assert.equal(tm.getCores(),3);
  const done=levels.readSave().save; assert.equal(done.status,'complete');
  const loaded=levels.continueJourney(done); assert.equal(loaded.completed,true); assert.equal(tm.getCores(),3);
});

test('Save 6: Measured journey stats persist through save/resume and score without double counting', () => {
  levels.continueJourney(futureSave); continueDialogue();
  const rs=levels.runStats;
  rs.restore({ era: 2, levels: [
    { time:385, clues:8, cluesTotal:9, puzzles:4, puzzlesTotal:4, falls:1, shocks:2, rewinds:0, checkpoints:3, distance:412 },
    { time:460, clues:7, cluesTotal:8, puzzles:3, puzzlesTotal:3, falls:0, shocks:1, rewinds:1, checkpoints:2, distance:350 },
    { time:290, clues:5, cluesTotal:6, puzzles:1, puzzlesTotal:1, falls:1, shocks:0, rewinds:0, checkpoints:4, distance:620 } ] });
  const t0=rs.levels[2].time; play(1);
  assert.ok(rs.levels[2].time>t0);            // live ticking only touches the current era
  assert.equal(rs.levels[0].time,385); assert.equal(rs.levels[1].time,460);
  const data=save();                          // runStats snapshot passes validateSave
  assert.equal(data.runStats.era,2);
  assert.equal(data.runStats.levels[0].clues,8); assert.equal(data.runStats.levels[1].rewinds,1);
  levels.continueJourney(data); continueDialogue();
  const r2=levels.runStats;
  assert.equal(r2.levels[0].clues,8); assert.equal(r2.levels[0].distance,412);
  assert.equal(r2.levels[1].cluesTotal,8); assert.ok(r2.levels[2].time>=290);
  const sum=summarizeJourney(r2);
  assert.deepEqual(sum.scores,[scoreLevel(r2.levels[0],420),scoreLevel(r2.levels[1],420),scoreLevel(r2.levels[2],315)]);
  assert.equal(sum.overall,78);
  assert.equal(sum.totals.clues,20); assert.equal(sum.totals.distance,1382);
  const names=sum.achievements.map(a=>a.name);
  assert.ok(names.includes('Guardian of the Three Worlds'));
  assert.ok(names.includes('Swift Chrononaut')); assert.ok(names.includes('Trailblazer'));
  assert.ok(!names.includes('Fearless Adventurer'));   // 2 falls disqualify it
  assert.ok(!names.includes('Legendary Explorer'));    // 20 of 23 clues
});

test('Save 7: Missing, malformed, future-version and inconsistent saves disable Continue safely', () => {
  const mem=new Map(); const store=new JourneyStore(()=>({getItem:k=>mem.get(k),setItem:(k,v)=>mem.set(k,v)}));
  assert.equal(store.read().status,'missing');
  mem.set(SAVE_KEY,'{'); assert.equal(store.read().status,'corrupt');
  for(const mutate of [s=>s.version++,s=>s.player.position[0]=null,s=>s.eras[1].puzzle.tiles=[],s=>s.eras[1].puzzle.state.power=false,s=>s.cores=3]) {
    const broken=JSON.parse(JSON.stringify(presentSave)); mutate(broken); mem.set(SAVE_KEY,JSON.stringify(broken));
    assert.equal(store.read().status,'corrupt'); assert.equal(store.write(broken).ok,false);
  }
  const blocked=new JourneyStore(()=>{throw Error('denied');}); assert.equal(blocked.read().status,'unavailable'); assert.equal(blocked.write(pastSave).ok,false);
  let old=JSON.stringify(pastSave); const full=new JourneyStore(()=>({getItem:()=>old,setItem:()=>{throw Error('quota');}}));
  assert.equal(full.write(presentSave).ok,false); assert.equal(full.read().save.era,0);
});

test('Camera stays inside the laboratory ceiling for extreme third-person pitch', () => {
  levels.continueJourney(presentSave); continueDialogue();
  player.position.set(0,0,-20); player.mode='third'; player.yaw=0; player.pitch=.9;
  scene.updateMatrixWorld(true);
  for(let i=0;i<30;i++) player._placeCamera(.05);
  assert.ok(camera.position.y<3.6-.1,`ceiling clip: ${camera.position.y}`);
  assert.ok(player.cameraColliders.length>player.colliders.length);
});

test('Archive entrance has no panelling across its opening; locked security door blocks passage', () => {
  levels.load(1); continueDialogue(); scene.updateMatrixWorld(true);
  const ray=new THREE.Raycaster(new THREE.Vector3(0,.65,-11),new THREE.Vector3(0,0,-1),0,2);
  const meshes=[]; scene.traverse(o=>{if(o.isMesh && o.layers.test(camera.layers) && o.visible) meshes.push(o);});
  const hits=ray.intersectObjects(meshes,false).filter(h=>h.object.material?.visible!==false && !h.object.material?.transparent);
  assert.equal(hits.length,0);
  assert.equal(doorAt(-30),true);
});

test('Power restoration and flashlight keep a constant light signature; quality switches apply live', () => {
  const signature=()=>{const lights=[];scene.traverseVisible(o=>{if(o.isLight)lights.push(o.type);});return lights.sort().join(',');};
  const before=signature(); levels.debug.takeFlashlight(); levels.debug.openDoor(); levels.debug.solveGrid();
  for(let i=0;i<80;i++){play(.05);assert.equal(signature(),before);}
  const refl=levels.level.objects.find(o=>o.isReflector); assert.ok(refl);
  settings.set('quality','high'); levels.applyQuality(); assert.equal(refl.visible,true); assert.equal(player.flashlight.castShadow,true);
  settings.set('quality','low'); levels.applyQuality(); assert.equal(refl.visible,false); assert.equal(player.flashlight.castShadow,false);
});

test('Required reading freezes Future hazards and stability until advancement', () => {
  levels.continueJourney(futureSave); continueDialogue();
  ui.tutorial({kicker:'Future',title:'Wait safely',html:'Read this first.'});
  const before=JSON.stringify(levels.debug.movers()); const st=levels.stability;
  tick(30); assert.equal(JSON.stringify(levels.debug.movers()),before); assert.equal(levels.stability,st);
  continueDialogue(); play(.5); assert.notEqual(JSON.stringify(levels.debug.movers()),before);
});

test('New Journey confirmation leaves progress intact on cancel and replaces it only on acceptance', () => {
  storage.set(SAVE_KEY,JSON.stringify(pastSave)); const old=storage.get(SAVE_KEY); let replaced=0;
  ui.confirm('New Journey?', 'Replace progress?', () => { replaced++; levels.restartRun(); });
  ui.closeTopPanel(); assert.equal(replaced,0); assert.equal(storage.get(SAVE_KEY),old);
  assert.equal(document.getElementById('confirm-yes').onclick,null);
  ui.confirm('New Journey?', 'Replace progress?', () => { replaced++; levels.restartRun(); });
  document.getElementById('confirm-yes').onclick(); continueDialogue(); play(1);
  assert.equal(replaced,1); assert.equal(levels.debug.state.crystalLit,false);
  assert.equal(levels.readSave().save.eras[0].puzzle.state.crystalLit,false);
});

test('Completion cinema can be skipped once and completed saves cannot give a fourth core', () => {
  levels.continueJourney(futureSave); continueDialogue(); levels.debug.takeCore(); continueDialogue(); play(2);
  assert.equal(levels.state,'finale'); let endings=0; levels.callbacks.onFinale=()=>endings++;
  levels.skipFinale(); levels.skipFinale(); assert.equal(endings,1); assert.equal(tm.getCores(),3);
  levels.continueJourney(levels.readSave().save); assert.equal(tm.getCores(),3); assert.equal(levels.state,'won');
  levels.callbacks.onFinale=null;
});

ui.resetTransient();
console.log(JSON.stringify({suite:'Node logic integration (renderer, DOM and audio doubles)',passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length,results},null,2));
process.exit(results.some(x=>x.status==='FAIL')?1:0);
