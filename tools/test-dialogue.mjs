/** Focused executable logic tests. DOM/render doubles: not browser visual QA. */
import { register } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
register('./tests/support/loader.mjs', import.meta.url);
await import('./tests/support/dom.mjs');
const THREE = await import('three');
const { UI } = await import('../src/core/ui.js');
const { Cutscene } = await import('../src/core/cutscene.js');
const story = await import('../src/story.js');

class Clock {
  time = 0; next = 0; tasks = new Map();
  now = () => this.time;
  set = (fn, ms) => { const id = ++this.next; this.tasks.set(id, { at: this.time + ms, fn }); return id; };
  clear = id => this.tasks.delete(id);
  tick(ms) {
    const end = this.time + ms;
    for (;;) {
      const next = [...this.tasks].filter(([,v]) => v.at <= end).sort((a,b) => a[1].at-b[1].at)[0];
      if (!next) break;
      this.time = next[1].at; this.tasks.delete(next[0]); next[1].fn();
    }
    this.time = end;
  }
}
const clock = new Clock();
const ui = new UI({ play() {}, playVoice() {}, stopVoice() {} }, { dialogueClock: clock });
const d = ui.dialogue;
const el = id => document.getElementById(id);
const hidden = id => el(id).classList.contains('hidden');
const line = () => el('caption-text').textContent;
const key = (type, code = 'Enter', repeat = false) => {
  const e = new Event(type, { cancelable: true }); Object.assign(e, { code, repeat }); window.dispatchEvent(e); return e;
};
const enter = (code = 'Enter') => { key('keydown', code); key('keyup', code); };
const mouse = (type, target = el('caption'), detail = 1) => {
  const e = new Event(type, { cancelable: true });
  Object.defineProperties(e, { target: { value: target }, button: { value: 0 }, detail: { value: detail } });
  window.dispatchEvent(e); return e;
};
const click = target => { mouse('mousedown', target); mouse('click', target); };
const reset = () => {
  ui.resetTransient(); d.heldEnter.clear();
  for (const reason of [...d.pauses]) d.setPaused(reason, false);
  document.pointerLockElement = null; document.hidden = false;
};
const results = [];
async function test(name, fn) {
  reset();
  try { await fn(); results.push({ name, status: 'PASS' }); console.log('PASS', name); }
  catch (e) { results.push({ name, status: 'FAIL', error: e.stack }); console.error('FAIL', name, e.stack); }
}

await test('Initial instruction appears once; full text stays until acknowledgement', () => {
  ui.say([['Ari','First'],['Ari','Second']]);
  assert.equal(hidden('caption-instruction'), false); assert.equal(line(), 'First');
  clock.tick(60000); assert.equal(line(), 'First'); assert.equal(d.queue.length, 1);
  enter(); assert.equal(line(), 'Second'); assert.equal(hidden('caption-instruction'), true);
  enter(); ui.say([['Ari','Later conversation']]); assert.equal(hidden('caption-instruction'), true);
});
await test('Enter and NumpadEnter each advance exactly one line, held/repeated keys do not', () => {
  ui.say([['Ari','A'],['Ari','B'],['Ari','C']]);
  assert.equal(key('keydown').defaultPrevented, true); assert.equal(line(), 'B');
  for (let i=0;i<20;i++) key('keydown','Enter',true);
  key('keydown'); assert.equal(line(),'B');
  key('keyup'); enter('NumpadEnter'); assert.equal(line(),'C'); enter(); assert.equal(d.active,false);
});
await test('A held final Enter cannot activate unrelated controls or a new sequence', () => {
  let leaked=0; const listener=()=>leaked++; window.addEventListener('keydown',listener);
  ui.say([['Ari','Last']]); key('keydown'); assert.equal(d.active,false);
  ui.say([['Ari','Next scene']]); key('keydown','Enter',true); assert.equal(line(),'Next scene');
  assert.equal(leaked,0); key('keyup'); enter(); window.removeEventListener('keydown',listener);
});
await test('Caption click and accessible Continue activation advance once', () => {
  ui.say([['Ari','A'],['Ari','B'],['Ari','C']]); click(); assert.equal(line(),'B');
  mouse('click',el('caption'),0); assert.equal(line(),'C'); click(); assert.equal(d.active,false);
});
await test('Locked-pointer clicks advance and are consumed before game actions', () => {
  document.pointerLockElement=el('game-canvas'); let actions=0;
  const listener=()=>actions++; window.addEventListener('mousedown',listener); window.addEventListener('click',listener);
  ui.say([['Ari','A'],['Ari','B']]); click(el('game-canvas')); assert.equal(line(),'B'); assert.equal(actions,0);
  window.removeEventListener('mousedown',listener); window.removeEventListener('click',listener);
});
await test('The gameplay click opening dialogue cannot also advance its first line', () => {
  document.pointerLockElement=el('game-canvas'); mouse('mousedown',el('game-canvas'));
  ui.say([['Ari','Newly opened'],['Ari','Next']]); mouse('click',el('game-canvas'));
  assert.equal(line(),'Newly opened'); click(el('game-canvas')); assert.equal(line(),'Next');
});
await test('Reminder appears at 10 seconds once, never dismisses or advances text', () => {
  ui.say([['Ari','Wait here']]); clock.tick(9999); assert.equal(hidden('caption-reminder'),true);
  clock.tick(1); assert.equal(hidden('caption-reminder'),false); assert.equal(clock.tasks.size,0);
  clock.tick(60000); assert.equal(line(),'Wait here'); assert.equal(d.active,true); assert.equal(clock.tasks.size,0);
});
await test('Advancing hides reminder immediately and starts a fresh 10-second timer', () => {
  ui.say([['Ari','A'],['Ari','B']]); clock.tick(10000); enter();
  assert.equal(hidden('caption-reminder'),true); assert.equal(clock.tasks.size,1);
  clock.tick(9999); assert.equal(hidden('caption-reminder'),true);
  clock.tick(1); assert.equal(hidden('caption-reminder'),false); enter(); assert.equal(clock.tasks.size,0);
});
await test('Pause/resume preserves remaining reminder time and blocks dialogue input', () => {
  ui.say([['Ari','A'],['Ari','B']]); clock.tick(6000); d.setPaused('game',true);
  clock.tick(30000); enter(); click(); assert.equal(line(),'A'); assert.equal(clock.tasks.size,0);
  assert.equal(hidden('caption'),true); d.setPaused('game',false);
  clock.tick(3999); assert.equal(hidden('caption-reminder'),true); clock.tick(1); assert.equal(hidden('caption-reminder'),false);
});
await test('Reader/keypad overlays suspend captions, leave Enter for the keypad, then restore', () => {
  ui.say([['Ari','Unfinished thought']]); let submitted=0; ui.openKeypad(()=>{submitted++; return false;});
  enter(); assert.equal(submitted,1); assert.equal(line(),'Unfinished thought'); assert.equal(hidden('caption'),true);
  ui.closeAllPanels(); assert.equal(hidden('caption'),false); assert.equal(d.active,true); enter(); assert.equal(d.active,false);
});
await test('Tab visibility and focus each suspend timing without dismissing text', () => {
  ui.say([['Ari','A']]); clock.tick(2000); document.hidden=true; document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('blur')); clock.tick(30000);
  document.hidden=false; document.dispatchEvent(new Event('visibilitychange')); assert.equal(clock.tasks.size,0);
  window.dispatchEvent(new Event('focus')); clock.tick(7999); assert.equal(hidden('caption-reminder'),true);
  clock.tick(1); assert.equal(hidden('caption-reminder'),false);
});
await test('Overlapping gameplay thoughts append in order instead of replacing unread lines', () => {
  ui.say([['Ari','First'],['Ari','Second']]); ui.say([['Ari','Third']]); assert.equal(line(),'First');
  enter(); assert.equal(line(),'Second'); enter(); assert.equal(line(),'Third'); enter(); assert.equal(d.active,false);
});
await test('Clearing/restarting drops queued text, reminders and stale completion callbacks', () => {
  let done=0; ui.say([['Ari','Old'],['Ari','Old second']]); ui.afterDialogue(()=>done++); clock.tick(10000);
  ui.resetTransient(); clock.tick(60000); assert.equal(done,0); assert.equal(d.queue.length,0); assert.equal(clock.tasks.size,0);
  assert.equal(hidden('caption-reminder'),true); assert.equal(hidden('caption'),true);
  ui.say([['Ari','Fresh']]); enter(); assert.equal(done,0);
});
await test('Era narrative cards use the same instruction, reminder and click progression', () => {
  ui.eraCard({ numeral:'III',title:'The Future',sub:'2187',tag:'The Future',...story.ERA_CARDS[2] });
  ui.say(story.ARRIVALS[2]); clock.tick(10000); assert.equal(hidden('era-card'),false); assert.equal(hidden('era-card-reminder'),false);
  click(el('era-card')); assert.equal(hidden('era-card'),true); assert.equal(line(),story.ARRIVALS[2][0][1]);
  enter(); assert.equal(line(),story.ARRIVALS[2][1][1]); enter(); assert.equal(d.active,false);
});
await test('Normal HUD notifications expire independently without advancing or blocking dialogue', async () => {
  ui.say([['Ari','Keep reading']]); ui.message('Checkpoint',5);
  assert.equal(el('message-banner').classList.contains('active'),true);
  await wait(25); assert.equal(el('message-banner').classList.contains('active'),false); assert.equal(line(),'Keep reading');
});

for (const name of ['prologue','wakeUp','epilogue']) {
  await test(`${name}: every original line stays in order; later events and ending wait for acknowledgement`, () => {
    const camera=new THREE.PerspectiveCamera(); const cs=new Cutscene({camera,ui}); let completed=0;
    const group=new THREE.Group(); const events=[];
    const ctx={
      cs,ui,player:{rig:new THREE.Group(),hero:{group,play(){},release(){}}},
      timeMachine:{reset(){},showAllCores(){},setOverload(){},ejectCores(){events.push('eject'); return [new THREE.Vector3()];}},
      audio:{play(){}},postfx:{u:{uFlash:{value:0},uWarp:{value:0},uGlitch:{value:0}}},
      set:{anchors:{ariPos:new THREE.Vector3(2,0,5),ariFacing:0},fx:{alarm(){},sparks(){},eject(){}}},
    };
    const script=story[name](ctx); const expected=script.filter(s=>s.say).map(s=>s.say[1]); const observed=[];
    cs.play(script,{onDone:()=>completed++});
    for(let frame=0;cs.active && frame<2000;frame++) {
      cs.update(.05);
      if(!cs.waiting) continue;
      observed.push(line()); const time=cs.t, fired=cs.steps.filter(s=>s.fired).length;
      for(let i=0;i<40;i++) cs.update(1);
      clock.tick(12000); assert.equal(line(),observed.at(-1)); assert.equal(cs.t,time);
      assert.equal(cs.steps.filter(s=>s.fired).length,fired); assert.equal(completed,0);
      enter();
    }
    assert.deepEqual(observed,expected); assert.equal(completed,1); assert.equal(cs.active,false);
    assert.equal(d.active,false); assert.equal(clock.tasks.size,0);
    if(name==='prologue') assert.deepEqual(events,['eject']);
  });
}
await test('Cancelling a waiting cinematic never runs its completion or later actions', () => {
  const cs=new Cutscene({camera:new THREE.PerspectiveCamera(),ui}); let done=0;
  cs.play([{at:0,say:['Ari','Wait']},{at:1,run:()=>done++},{at:2,end:true}],{onDone:()=>done++});
  cs.update(.1); cs.cancel(); clock.tick(20000); enter(); cs.update(20);
  assert.equal(done,0); assert.equal(d.active,false); assert.equal(clock.tasks.size,0);
});

await test('Tutorial remains until Enter/click, never auto-dismisses, and restores after a save', () => {
  d.resetJourney(); ui.tutorial({kicker:'Help',title:'Persistent help',html:'Important instruction'});
  clock.tick(60000); assert.equal(d.current.view,'tutorial-card'); assert.equal(hidden('tutorial-card'),false);
  const state=d.snapshot(); d.clear(); d.restore(state); assert.equal(d.current.card.title,'Persistent help');
  click(el('tutorial-card')); assert.equal(d.active,false);
  d.resetJourney(); ui.say([['Ari','A fresh journey']]); assert.equal(hidden('caption-instruction'),false);
});
await test('Skip runs critical events once and cannot finish the following cinematic', () => {
  const cs=new Cutscene({camera:new THREE.PerspectiveCamera(),ui}); let critical=0,finished=0;
  cs.play([{at:0,say:['Ari','Read']},{at:4,critical:true,run:()=>critical++},{at:8,end:true}],{
    onDone:()=>{finished++;cs.play([{at:0,say:['Ari','Next scene']},{at:4,end:true}]);}
  });
  cs.update(.1); cs.skip(); assert.equal(critical,1); assert.equal(finished,1); assert.equal(cs.active,true);
  cs.update(.1); assert.equal(line(),'Next scene'); cs.cancel();
});
reset(); d.dispose();
const result={suite:'Focused dialogue logic (DOM/render doubles; fake reminder clock)',passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length,results};
if(process.argv[2]) fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:result.passed,failed:result.failed}));
process.exitCode=result.failed?1:0;
