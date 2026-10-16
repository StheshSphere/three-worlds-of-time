/** Browser-local journey storage. Settings have a separate key. No server needed. */
export const SAVE_KEY = 'three-worlds-journey-v1';
export const SAVE_VERSION = 1;
const record = x => !!x && typeof x === 'object' && !Array.isArray(x);
const number = (x, lo, hi) => Number.isFinite(x) && x >= lo && x <= hi;
const integer = (x, lo, hi) => Number.isInteger(x) && number(x, lo, hi);
const text = (x, max = 3000) => typeof x === 'string' && x.length <= max;
const list = (x, n, test) => Array.isArray(x) && x.length === n && x.every(test);
const bool = x => typeof x === 'boolean';
const vector = x => list(x, 3, v => number(v, -600, 600));
const flags = (s, keys) => record(s) && keys.every(k => bool(s[k]));
const names = x => Array.isArray(x) && x.length <= 100 && x.every(v => text(v, 100));

/** Stable layout seed: regenerated clue textures and geometry match the save. */
export function createRandom(seed = Math.floor(Math.random() * 4294967296)) {
  let value = seed >>> 0;
  const random = () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
  random.seed = seed >>> 0;
  return random;
}

function puzzleValid(p, era) {
  if (!record(p) || !integer(p.seed, 0, 4294967295) || !record(p.state)) return false;
  const s = p.state;
  if (era === 0) return flags(s, ['gateOpen', 'crystalLit', 'bridgeBuilt', 'dialsSolved', 'coreTaken']) &&
    list(s.plates, 2, bool) && list(s.tablets, 3, bool) &&
    list(p.blocks, 2, b => list(b, 2, v => integer(v, 0, 7)) && b[1] < 7) &&
    list(p.mirrors, 4, v => integer(v, 0, 3)) && list(p.drums, 3, v => integer(v, 0, 5)) &&
    flags(p, ['enteredCourt', 'inSunCourt', 'checkpointBridge']) &&
    (!s.crystalLit || s.gateOpen) && (!s.bridgeBuilt || s.crystalLit) && (!s.coreTaken || s.dialsSolved);
  if (era === 1) return flags(s, ['readIncident', 'inOffice', 'flashlight', 'doorOpen', 'inPower', 'power', 'vaultOpen', 'fieldDown', 'coreTaken']) &&
    list(s.marks, 4, bool) && integer(s.wrongCodes, 0, 1000000) && bool(p.cpDone) &&
    list(p.tiles, 9, v => integer(v, 0, 3)) && (!s.fieldDown || s.power) && (!s.coreTaken || s.fieldDown);
  return flags(s, ['coreTaken', 'puzzleSolved', 'collapseComplete']) &&
    integer(s.section, 0, 4) && integer(s.puzzleStep, 0, 3) && list(s.reached, 5, bool) &&
    list(p.seq, 3, v => integer(v, 0, 2)) && new Set(p.seq).size === 3 &&
    (!s.coreTaken || s.puzzleSolved) && (!s.puzzleSolved || s.puzzleStep === 3);
}

function dialogueValid(d) {
  return record(d) && bool(d.instructed) && Array.isArray(d.entries) && d.entries.length <= 80 && d.entries.every(e => {
    if (!record(e)) return false;
    if (e.view === 'caption') return text(e.text) && (e.speaker == null || text(e.speaker, 100));
    if (e.view === 'tutorial-card') return record(e.card) && text(e.card.title, 200) && text(e.card.html, 6000) && text(e.card.kicker, 200);
    return false; // cinematics/era transitions restore at a stable playable boundary
  });
}

/** Journey statistics (src/core/stats.js). Optional: older saves predate it. */
function runStatsValid(r) {
  if (r == null) return true;
  if (!record(r) || !integer(r.era, 0, 2) || !Array.isArray(r.levels) || r.levels.length !== 3) return false;
  return r.levels.every(l => l == null || (record(l) &&
    ['time', 'clues', 'cluesTotal', 'puzzles', 'puzzlesTotal', 'falls', 'shocks', 'rewinds', 'checkpoints', 'distance']
      .every(k => number(l[k], 0, 1e9)) && (l.extras == null || record(l.extras))));
}

export function validateSave(s) {
  if (!record(s) || s.version !== SAVE_VERSION || !integer(s.savedAt, 1, 1e16) ||
      !['active', 'complete'].includes(s.status) || !integer(s.era, 0, 2) || !integer(s.cores, 0, 3) ||
      !list(s.eras, 3, x => x === null || record(x)) || !record(s.player) || !record(s.stats)) return false;
  if (s.cores !== (s.status === 'complete' ? 3 : s.era)) return false;
  for (let i = 0; i < 3; i++) {
    const e = s.eras[i];
    if (i <= s.era && !e) return false;
    if (!e) continue;
    if (!puzzleValid(e.puzzle, i) || !number(e.stability, 0, 3600) || !text(e.objective, 300) ||
        !text(e.label, 150) || !names(e.tutorials) || !names(e.spoken) || !record(e.checkpoint) ||
        !vector(e.checkpoint.position) || !number(e.checkpoint.yaw, -1e6, 1e6) || !bool(e.checkpoint.active)) return false;
    if (i < s.era && !e.puzzle.state.coreTaken) return false;
  }
  return vector(s.player.position) && number(s.player.yaw, -1e6, 1e6) && number(s.player.pitch, -1.5, 1.5) &&
    ['first', 'third'].includes(s.player.mode) && bool(s.player.flashlightOn) &&
    ['runTime', 'falls', 'rewinds', 'shocks'].every(k => number(s.stats[k], 0, 1e9)) &&
    Array.isArray(s.journal) && s.journal.length <= 100 && s.journal.every(j => record(j) && text(j.html, 100000) && (j.key == null || text(j.key, 100))) &&
    dialogueValid(s.dialogue) && runStatsValid(s.runStats);
}

export class JourneyStore {
  constructor(storage = () => globalThis.localStorage) { this.storage = storage; }
  read() {
    try {
      const raw = this.storage().getItem(SAVE_KEY);
      if (!raw) return { status: 'missing', save: null };
      if (raw.length > 2000000) return { status: 'corrupt', save: null };
      const save = JSON.parse(raw);
      return validateSave(save) ? { status: 'valid', save } : { status: 'corrupt', save: null };
    } catch (e) { return { status: e instanceof SyntaxError ? 'corrupt' : 'unavailable', save: null }; }
  }
  write(save) {
    if (!validateSave(save)) return { ok: false, reason: 'The timeline is not at a valid save point yet.' };
    try {
      // One atomic setItem: a failed quota write leaves the old journey intact.
      this.storage().setItem(SAVE_KEY, JSON.stringify(save));
      return { ok: true };
    } catch { return { ok: false, reason: 'Browser storage is unavailable or full. Your previous save has been kept.' }; }
  }
}
