import test from 'node:test';
import assert from 'node:assert/strict';
import { makeLevel, makeManager, permutations, THREE, makeUI } from './support.mjs';
import { GLYPHS } from '../src/levels/glyphs.js';
import { createTabletLayout, restoreTabletLayout, tabletCodeMatches, journalTablets } from '../src/levels/tabletPuzzle.js';
import { createRandom, JourneyStore, SAVE_KEY, validateSave } from '../src/core/save.js';

const assignments = permutations([0, 1, 2]);
const distinctCodes = GLYPHS.flatMap(a => GLYPHS.filter(b => b !== a).flatMap(b =>
  GLYPHS.filter(c => c !== a && c !== b).map(c => [a, b, c])));

function tabletObjects(level) { return level.interactables.filter(o => o.userData.interaction?.label === 'Carved tablet'); }
function drumObjects(level) { return level.interactables.filter(o => o.geometry?.type === 'CylinderGeometry' && o.position.y === 3.15); }
function turnToCode(level, drums, code) {
  for (let hour = 0; hour < 3; hour++) {
    let turns = 0;
    while (level.snapshot().drums[hour] !== GLYPHS.indexOf(code[hour])) {
      assert.ok(turns++ < 6, 'Every glyph must be reachable through normal drum turns');
      drums[hour].userData.onInteract();
    }
  }
}

test('All 216 possible glyph triples match only their own I/II/III positions', () => {
  let count = 0;
  for (const a of GLYPHS) for (const b of GLYPHS) for (const c of GLYPHS) {
    const code = [a, b, c], indices = code.map(glyph => GLYPHS.indexOf(glyph));
    assert.equal(tabletCodeMatches(indices, code), true);
    for (let i = 0; i < 3; i++) {
      const wrong = [...indices]; wrong[i] = (wrong[i] + 1) % 6;
      assert.equal(tabletCodeMatches(wrong, code), false);
    }
    count++;
  }
  assert.equal(count, 216);
});

test('Every generated combination is reachable, and a repeat draw changes on restart', () => {
  const codes = new Set(), orders = new Set();
  for (let seed = 0; seed < 6000; seed++) {
    const first = createTabletLayout(createRandom(seed));
    const restarted = createTabletLayout(createRandom(seed), first.code);
    assert.notDeepEqual(restarted.code, first.code);
    codes.add(first.code.join(',')); orders.add(first.tabletOrder.join(','));
  }
  assert.equal(codes.size, 120); assert.equal(orders.size, 6);
});

test('4,320 real level interactions: every distinct code, tablet assignment and collection order unlocks the core', { timeout: 240000 }, () => {
  let solved = 0;
  for (const code of distinctCodes) for (const tabletOrder of assignments) {
    const fixture = makeLevel({ save: { seed: 123456, code, tabletOrder } });
    try {
      const { level, ui, api } = fixture;
      const base = level.snapshot();
      base.drums = code.map(glyph => (GLYPHS.indexOf(glyph) + 1) % 6);
      const tablets = tabletObjects(level), drums = drumObjects(level);
      assert.equal(tablets.length, 3); assert.equal(drums.length, 3);
      for (const discovery of assignments) {
        ui.resetJournal();
        level.restore(structuredClone(base));
        for (const spot of discovery) tablets[spot].userData.onInteract();
        const clues = journalTablets(ui.journal);
        assert.equal(clues.length, 3);
        for (const clue of clues) {
          assert.equal(clue.hour, tabletOrder[clue.spot]);
          assert.equal(clue.glyph, code[clue.hour]);
        }
        assert.equal(level.snapshot().state.dialsSolved, false, 'Wrong drums must remain unsolved');
        turnToCode(level, drums, code);
        assert.equal(level.snapshot().state.dialsSolved, true, `${code}, ${tabletOrder}, ${discovery}`);
        level.update(3, 3);
        const core = level.interactables.find(o => o.userData.interaction?.label === 'Ancient Core');
        assert.equal(core.visible, true);
        assert.equal(core.userData.prompt(), 'Take the Ancient Core');
        const completed = api.completed;
        core.userData.onInteract();
        assert.equal(api.completed, completed + 1);
        assert.equal(level.snapshot().state.coreTaken, true);
        solved++;
      }
    } finally { fixture.dispose(); }
  }
  assert.equal(solved, 4320);
});

test('Each of the six visible drum faces agrees with its logical glyph index', () => {
  const fixture = makeLevel();
  try {
    const level = fixture.level, drum = drumObjects(level)[0], saved = level.snapshot();
    for (let index = 0; index < 6; index++) {
      saved.drums[0] = index; level.restore(saved); drum.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(drum.position.clone().add(new THREE.Vector3(0, 0, 3)), new THREE.Vector3(0, 0, -1));
      const hit = ray.intersectObject(drum)[0];
      assert.equal(Math.floor(hit.uv.x * 6), index);
      assert.ok(drum.userData.prompt().endsWith(`showing ${GLYPHS[index]}`));
    }
  } finally { fixture.dispose(); }
});

test('A matching starting or resumed combination unlocks when the final tablet is read', () => {
  const fixture = makeLevel();
  try {
    const saved = fixture.level.snapshot();
    saved.drums = saved.code.map(glyph => GLYPHS.indexOf(glyph));
    fixture.level.restore(saved);
    const tablets = tabletObjects(fixture.level);
    tablets[2].userData.onInteract(); tablets[0].userData.onInteract();
    assert.equal(fixture.level.snapshot().state.dialsSolved, false);
    tablets[1].userData.onInteract();
    assert.equal(fixture.level.snapshot().state.dialsSolved, true);
  } finally { fixture.dispose(); }
});

test('The screenshot order Moon I, Peak III, Hourglass II restores and solves', () => {
  const code = ['Moon', 'Hourglass', 'Peak'], tabletOrder = [1, 2, 0];
  const fixture = makeLevel({ save: { seed: 17, code, tabletOrder } });
  try {
    const { level, ui } = fixture;
    const tablets = tabletObjects(level);
    [2, 1, 0].forEach(spot => tablets[spot].userData.onInteract());
    assert.deepEqual(journalTablets(ui.journal).map(clue => [clue.hour, clue.glyph]), [[0, 'Moon'], [2, 'Peak'], [1, 'Hourglass']]);
    assert.deepEqual(document.getElementById('journal-list').children.map(entry => journalTablets([{ key: 'tablet-0', html: entry.innerHTML }])[0].hour), [0, 1, 2]);
    const save = JSON.parse(JSON.stringify(level.snapshot()));
    const next = makeLevel({ save, journal: ui.journal });
    try {
      next.level.restore(save);
      assert.deepEqual(next.level.snapshot().code, code);
      turnToCode(next.level, drumObjects(next.level), code);
      assert.equal(next.level.snapshot().state.dialsSolved, true);
    } finally { next.dispose(); }
  } finally { fixture.dispose(); }
});

test('Continue preserves exact tablets, collected flags, drum settings and journal over repeated reloads', () => {
  const first = makeManager();
  first.levels.beginNewJourney(); first.levels.restartRun();
  const tablets = tabletObjects(first.levels.level);
  tablets[2].userData.onInteract(); tablets[0].userData.onInteract();
  drumObjects(first.levels.level)[1].userData.onInteract();
  assert.equal(first.levels.saveGame().ok, true);
  let saved = first.levels.readSave().save;
  const original = structuredClone(saved.eras[0].puzzle), journal = structuredClone(saved.journal);
  for (let reload = 0; reload < 3; reload++) {
    const next = makeManager();
    assert.ok(next.levels.continueJourney(saved));
    assert.deepEqual(next.levels.level.snapshot().code, original.code);
    assert.deepEqual(next.levels.level.snapshot().tabletOrder, original.tabletOrder);
    assert.deepEqual(next.levels.level.snapshot().state.tablets, original.state.tablets);
    assert.deepEqual(next.levels.level.snapshot().drums, original.drums);
    assert.deepEqual(next.ui.journal, journal);
    assert.equal(next.levels.saveGame().ok, true);
    saved = next.levels.readSave().save;
  }
});

test('Restart Journey clears saved progress immediately, changes the tablets and starts with an empty journal', () => {
  const { levels, ui } = makeManager();
  levels.beginNewJourney(); levels.restartRun(); levels.debug.readTablets();
  assert.equal(levels.saveGame().ok, true);
  const previous = levels.level.snapshot().code;
  levels.beginNewJourney();
  assert.equal(levels.readSave().status, 'missing', 'Closing during the intro cannot restore the old journey');
  assert.equal(ui.journal.length, 0);
  assert.equal(levels.saveGame({ silent: true }).ok, false, 'pagehide cannot resave the previous era');
  levels.restartRun({ cutscene: true });
  assert.notDeepEqual(levels.level.snapshot().code, previous);
  assert.deepEqual(levels.level.snapshot().state.tablets, [false, false, false]);
  assert.equal(ui.journal.length, 0);
  levels.startPlay(); assert.equal(levels.saveGame().ok, true);
  assert.equal(levels.readSave().save.journal.length, 0);
});

test('Rewinding Level 1 clears the whole journal, saves the reset and keeps it empty on Continue', () => {
  const { levels, ui } = makeManager();
  levels.beginNewJourney(); levels.restartRun(); levels.debug.readTablets();
  levels.debug.solveBlocks(); levels.debug.alignMirrors(); levels.debug.solveDrums();
  levels.level.update(8, 8);
  for (const key of ['gateOpen', 'crystalLit', 'bridgeBuilt', 'dialsSolved']) {
    assert.equal(levels.level.snapshot().state[key], true);
  }
  // Include legacy/nonstandard entries so a fixed list of three IDs cannot
  // accidentally leave the old journal behind when the new tablets spawn.
  ui.addJournal('Old tablet clue without a key');
  ui.addJournal('Old imported carving', 'old-tablet-clue');
  assert.equal(levels.saveGame().ok, true);
  const previous = [...levels.debug.code];
  levels.retryEra();
  assert.equal(ui.journal.length, 0);
  assert.equal(document.getElementById('journal-list').children.length, 1);
  assert.match(document.getElementById('journal-list').children[0].textContent, /No clues yet/);
  assert.notDeepEqual(levels.debug.code, previous);
  assert.deepEqual(levels.level.snapshot().state.tablets, [false, false, false]);
  assert.deepEqual(levels.level.snapshot().state.plates, [false, false]);
  for (const key of ['gateOpen', 'crystalLit', 'bridgeBuilt', 'dialsSolved', 'coreTaken']) {
    assert.equal(levels.level.snapshot().state[key], false);
  }
  const saved = levels.readSave().save;
  assert.deepEqual(saved.journal, []);
  assert.deepEqual(saved.eras[0].puzzle.state.tablets, [false, false, false]);
  assert.deepEqual(saved.eras[0].puzzle.code, levels.debug.code);
  const continued = makeManager();
  assert.ok(continued.levels.continueJourney(saved));
  assert.equal(continued.ui.journal.length, 0);
  assert.deepEqual(continued.levels.level.snapshot().state.tablets, [false, false, false]);
  levels.debug.readTablets();
  assert.equal(ui.journal.length, 3);
  for (const clue of journalTablets(ui.journal)) assert.equal(clue.glyph, levels.debug.code[clue.hour]);
  turnToCode(levels.level, drumObjects(levels.level), levels.debug.code);
  assert.equal(levels.level.snapshot().state.dialsSolved, true);
  assert.equal(levels.saveGame().ok, true);
});

test('Legacy saves recover the collected clues from the journal, even after a full page reload', () => {
  const current = makeManager(); current.levels.beginNewJourney(); current.levels.restartRun();
  current.levels.debug.readTablets(); assert.equal(current.levels.saveGame().ok, true);
  const legacy = current.levels.readSave().save;
  delete legacy.eras[0].puzzle.code; delete legacy.eras[0].puzzle.tabletOrder;
  legacy.eras[0].puzzle.state.dialsSolved = false;
  legacy.journal = [
    { key: 'tablet-2', html: 'Tablet of the <b>I</b> hour — the <b>Moon</b>.' },
    { key: 'tablet-1', html: 'Tablet of the <b>III</b> hour — the <b>Peak</b>.' },
    { key: 'tablet-0', html: 'Tablet of the <b>II</b> hour — the <b>Hourglass</b>.' },
  ];
  assert.equal(validateSave(legacy), true);
  const freshPage = makeManager(); assert.equal(freshPage.ui.journal.length, 0);
  assert.ok(freshPage.levels.continueJourney(legacy));
  assert.deepEqual(freshPage.levels.debug.code, ['Moon', 'Hourglass', 'Peak']);
  assert.deepEqual(freshPage.levels.level.snapshot().tabletOrder, [1, 2, 0]);
  assert.deepEqual(freshPage.ui.journal, legacy.journal);
  turnToCode(freshPage.levels.level, drumObjects(freshPage.levels.level), ['Moon', 'Hourglass', 'Peak']);
  assert.equal(freshPage.levels.level.snapshot().state.dialsSolved, true);
  assert.equal(freshPage.levels.saveGame().ok, true);
});

test('Partial legacy journals preserve their clues without duplicating an hour assignment', () => {
  const generated = { code: ['Sun', 'Eye', 'Peak'], tabletOrder: [0, 1, 2] };
  for (const spot of [0, 1, 2]) for (const hour of [0, 1, 2]) {
    const flags = [false, false, false]; flags[spot] = true;
    const journal = [{ key: `tablet-${spot}`, html: `Tablet of the <b>${['I', 'II', 'III'][hour]}</b> hour — the <b>Moon</b>.` }];
    const layout = restoreTabletLayout(generated, { state: { tablets: flags } }, journal);
    assert.equal(layout.code[hour], 'Moon'); assert.equal(layout.tabletOrder[spot], hour);
    assert.equal(new Set(layout.tabletOrder).size, 3);
  }
});

test('Journal rereads update a stale clue once, and storage still validates old and new saves', () => {
  const ui = makeUI();
  ui.addJournal('old carving', 'tablet-0'); ui.addJournal('new carving', 'tablet-0'); ui.addJournal('new carving', 'tablet-0');
  assert.deepEqual(ui.journal, [{ key: 'tablet-0', html: 'new carving' }]);
  const { levels } = makeManager(); levels.beginNewJourney(); levels.restartRun(); levels.saveGame();
  const saved = levels.readSave().save;
  assert.equal(validateSave(saved), true);
  const bad = structuredClone(saved); bad.eras[0].puzzle.tabletOrder = [0, 0, 1];
  assert.equal(validateSave(bad), false);
  const store = new JourneyStore(); assert.equal(store.write(saved).ok, true);
  assert.equal(store.read().status, 'valid'); assert.equal(store.clear().ok, true);
  assert.equal(localStorage.getItem(SAVE_KEY), null);
});

test('Collecting the Ancient Core advances the real level manager into Level 2', () => {
  const { levels } = makeManager(); levels.beginNewJourney(); levels.restartRun();
  levels.debug.solveBlocks(); levels.debug.alignMirrors(); levels.debug.readTablets();
  turnToCode(levels.level, drumObjects(levels.level), levels.debug.code);
  levels.level.update(3, 3);
  levels.level.interactables.find(o => o.userData.interaction?.label === 'Ancient Core').userData.onInteract();
  assert.equal(levels.state, 'transition');
  levels.update(1.6); assert.equal(levels.index, 1);
  levels.update(1.7); assert.equal(levels.state, 'playing');
  assert.equal(levels.saveGame().ok, true);
  assert.equal(levels.readSave().save.era, 1);
});
