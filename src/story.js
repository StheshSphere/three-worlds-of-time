import * as THREE from 'three';

/**
 * The story, told in four cutscenes + in-game lines (Gameplay & Experience:
 * "a coherent storyline or theme").
 *
 *   PROLOGUE   Chronos lab, 03:07 — Ari runs Field Test 7 without the
 *              professor; the hourglass drive overloads and the three cores
 *              are flung into the past, this very night, and the far future.
 *   WAKE-UP    Ari comes round in the temple (the Past) beside the machine.
 *   ARRIVALS   a few lines when Ari lands in the Present and the Future.
 *   EPILOGUE   the lab the next morning — machine whole, the professor on the
 *              intercom — then the end card and the credits roll.
 *
 * Each script returns steps for src/core/cutscene.js. `ctx` carries the
 * player, Time Machine, audio, post-fx, UI, the cutscene itself (`cs`) and
 * the mounted set (`set`, with anchors and fx from src/levels/prologue.js).
 */

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

/** Ease a value over time inside a cutscene. */
function tween(cs, dur, fn) {
  let t = 0;
  const step = (dt) => {
    t = Math.min(dur, t + dt);
    fn(t / dur);
    return t >= dur;
  };
  cs.tweens = cs.tweens || [];
  cs.tweens.push(step);
}

function placeHero(player, pos, facing) {
  player.frozen = true;
  player.mode = 'third';
  player.rig.position.copy(pos);
  player.facing = facing;
  player.rig.rotation.y = facing;
  player.rig.visible = true;
  player.hero.group.visible = true;
}

export function prologue({ player, timeMachine: tm, audio, postfx, ui, cs, set }) {
  const A = set.anchors;
  const ari = A.ariPos;
  const heart = v3(0, 2.9, 0);
  const back = v3(ari.x, 0, ari.z).normalize();          // from the machine toward Ari
  const right = v3(back.z, 0, -back.x);
  const shoulder = ari.clone().addScaledVector(back, 1.7).addScaledVector(right, 0.7).setY(2.0);
  return [
    { at: 0, run: () => {
      tm.reset();
      tm.showAllCores();
      tm.setOverload(0);
      placeHero(player, ari, A.ariFacing);
      player.hero.play('use', { loop: true, speed: 0.8 });
      postfx.u.uFlash.value = 0;
      ui.fade(true, 'black');
      setTimeout(() => ui.fade(false, 'black'), 60);
    } },
    { at: 0, cam: { pos: [10.5, 6, 10.5], look: [0, 2, 0], toPos: [7, 3.8, 8.2], toLook: [0.5, 2.2, 1], dur: 6.5 } },
    { at: 0.8, say: [null, 'Chronos Research Facility. 03:07 a.m. — the night of Field Test 7.', 5] },
    { at: 6.5, cam: { pos: shoulder.toArray(), look: heart.toArray(), toPos: shoulder.clone().addScaledVector(back, -0.5).toArray(), dur: 5 } },
    { at: 6.8, say: ['Ari', 'Professor Adeyemi said to wait for her… but the hourglass drive is stable. Just one more test.', 5] },
    { at: 11.8, cam: { pos: [-3.6, 0.55, 4.6], look: [0, 3.0, 0], toPos: [-2.6, 0.8, 3.5], toLook: [0, 2.6, 0], dur: 4.5 } },
    { at: 11.8, run: () => {
      audio.play('power-up', { volume: 1 });
      tween(cs, 4, (k) => tm.setOverload(k * 0.35));
    } },
    { at: 12.1, say: ['Ari', 'Drive at eighty percent… a hundred… all three cores holding!', 4.2] },
    { at: 16.3, cam: { pos: [6.8, 2.3, 7.6], look: [0, 2.6, 0], toPos: [5.3, 2.7, 6.1], dur: 4.4 } },
    { at: 16.3, run: () => {
      set.fx.alarm(true);
      set.fx.sparks(true);
      audio.play('glitch', { volume: 0.9 });
      audio.play('zap', { volume: 0.6, rate: 0.7 });
      cs.shake(0.5);
      tween(cs, 4.2, (k) => { tm.setOverload(0.35 + k * 0.65); postfx.u.uGlitch.value = k * 0.6; });
      player.hero.release();
    } },
    { at: 16.6, say: ['Ari', 'A hundred and twenty… a hundred and FORTY?! Shut it down — shut it DOWN!', 4.2] },
    { at: 18.8, run: () => { player.hero.play('hit', { speed: 0.8 }); cs.shake(0.9); audio.play('zap', { volume: 0.8 }); } },
    { at: 20.6, cam: { pos: [0, 3.6, 11.5], look: [0, 4, 0], toPos: [0, 4.6, 13.5], toLook: [0, 6, -2], dur: 3 } },
    { at: 20.7, critical: true, run: () => {
      const pos = tm.ejectCores();
      set.fx.eject(pos);
      tm.setOverload(0.5);
      audio.play('warp', { volume: 1 });
      audio.play('crumble', { volume: 0.8 });
      cs.shake(1.4);
      postfx.u.uGlitch.value = 0;
    } },
    { at: 21.0, say: ['Ari', 'No, no, no — the cores!', 2.6] },
    { at: 22.6, run: () => tween(cs, 1.4, (k) => { postfx.u.uWarp.value = k; postfx.u.uFlash.value = k * k; }) },
    { at: 24.3, say: [null, 'The timeline shattered. Its three cores were flung across time — into the distant past, into this very night, and into a far future.', 6.2] },
    { at: 30.6, end: true },
  ];
}

export function wakeUp({ player, postfx, cs, audio }) {
  const lie = v3(1.3, 0, 6.6);
  return [
    { at: 0, run: () => {
      placeHero(player, lie, 2.3);
      player.hero.play('lie', { loop: true });
      postfx.u.uWarp.value = 0.6;
      postfx.u.uFlash.value = 1;
      tween(cs, 2.6, (k) => { postfx.u.uFlash.value = 1 - k; postfx.u.uWarp.value = 0.6 * (1 - k); });
      audio.play('warp', { volume: 0.5, rate: 0.6 });
    } },
    { at: 0, cam: { pos: [3.3, 0.85, 8.4], look: [1.3, 0.35, 6.6], toPos: [3.0, 1.1, 8.0], dur: 4.2 } },
    { at: 1.0, say: ['Ari', 'Ugh… where am I? …No — WHEN am I?', 3.2] },
    { at: 4.0, run: () => player.hero.play('getUp', { hold: true, speed: 1.1 }) },
    { at: 4.4, cam: { pos: [3.8, 2.0, 10.4], look: [0.6, 1.6, 4], toPos: [-1.6, 3.6, 13], toLook: [0, 2.6, -8], dur: 7 } },
    { at: 4.6, say: ['Ari', 'The machine came with me… but its sockets are empty.', 3.6] },
    { at: 8.4, say: ['Ari', 'If I can find all three cores, I can put time back together. That temple looks like a good place to start.', 4.6] },
    { at: 13.2, end: true },
  ];
}

export const ARRIVALS = {
  1: [
    ['Ari', 'It worked — I’m back in the lab! …No. It’s still that same night, just after the accident.', 5.2],
    ['Ari', 'The power’s out and the second core is sealed in the vault. I need answers — and some light.', 5.2],
  ],
  2: [
    ['Ari', 'Too far forward… This is still the lab — in the year 2187. The whole skyline is tearing itself apart.', 5.6],
    ['Ari', 'The last core is up on that spire. My gauntlet is humming — I think I can dash through time now.', 5.6],
  ],
};

export function epilogue({ player, timeMachine: tm, postfx, ui, cs, audio }) {
  const ari = v3(2.7, 0, 5.9);
  const facing = Math.atan2(-ari.x, -ari.z);
  const front = ari.clone().add(v3(-1.9, 1.6, -2.4));
  return [
    { at: 0, run: () => {
      tm.reset();
      tm.showAllCores();
      tm.setOverload(0);
      placeHero(player, ari, facing);
      player.hero.release();
      postfx.u.uFlash.value = 1;
      postfx.u.uWarp.value = 0;
      tween(cs, 2.6, (k) => { postfx.u.uFlash.value = 1 - k; });
    } },
    { at: 0, cam: { pos: [9.5, 4.8, 10.5], look: [0, 2.4, 0], toPos: [6.5, 3.3, 7.8], dur: 7 } },
    { at: 1.0, say: [null, 'Morning. The storm has passed.', 3.4] },
    { at: 4.6, say: ['Ari', 'All three cores, back where they belong… The hourglass is whole again.', 4.6] },
    { at: 9.4, run: () => audio.play('computer', { volume: 0.5 }) },
    { at: 9.5, say: ['Prof. Adeyemi — intercom', 'Ari? The sensors went wild last night — and then everything just… settled. What on earth happened down there?', 5.8] },
    { at: 15.4, cam: { pos: front.toArray(), look: [ari.x, 1.3, ari.z], toPos: front.clone().add(v3(-0.4, 0.2, 0.5)).toArray(), dur: 6 } },
    { at: 15.6, run: () => player.hero.play('cheer', { hold: true }) },
    { at: 15.7, say: ['Ari', 'Let’s just say Field Test 7 was… educational. Put the kettle on, Professor — it’s a long story.', 5.6] },
    { at: 21.4, cam: { pos: [0, 5.2, 6.5], look: [0, 1.2, 0], toPos: [0, 6.6, 2.2], toLook: [0, 0.6, 0], dur: 8 } },
    { at: 21.6, say: [null, 'Past, present and future hum in harmony once more. But time remembers every step you took.', 6] },
    { at: 27.8, run: () => ui.endCard(true) },
    { at: 33, end: true },
  ];
}
