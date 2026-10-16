/**
 * Journey statistics — recorded silently during play, shown only after the
 * ending story (see ui.showJourneyStats). Everything here is MEASURED:
 * each counter is incremented at the exact game event that causes it, and
 * nothing is ever invented, averaged or double-counted. Clue discovery is
 * de-duplicated per level mount, so re-reading the same tablet never counts
 * twice, and the counters survive save/resume through the journey save.
 */

export const PAR_TIMES = [420, 420, 315];     // generous targets (stability ÷ ~1.15)
export const PUZZLE_TOTALS = [4, 3, 1];

/** How many puzzle milestones a level's snapshot proves solved. */
export function countPuzzles(era, s) {
  if (!s) return 0;
  if (era === 0) return ['gateOpen', 'crystalLit', 'bridgeBuilt', 'dialsSolved'].filter((k) => s[k]).length;
  if (era === 1) return ['power', 'vaultOpen', 'fieldDown'].filter((k) => s[k]).length;
  return s.puzzleSolved ? 1 : 0;
}

const emptyLevel = () => ({
  time: 0, clues: 0, cluesTotal: 0, puzzles: 0, puzzlesTotal: 0,
  falls: 0, shocks: 0, rewinds: 0, checkpoints: 0, distance: 0,
  extras: null,              // level-specific flavour (e.g. Future sections)
});

export function createRunStats() {
  const levels = [emptyLevel(), emptyLevel(), emptyLevel()];
  let era = -1;
  let attemptClues = new Set();          // unique clue objects this level mount
  return {
    levels,
    get era() { return era; },

    reset() {
      for (const l of levels) Object.assign(l, emptyLevel());
      era = -1;
      attemptClues = new Set();
    },

    beginEra(i) { era = i; attemptClues = new Set(); },

    /** One playing second in the current era. */
    tick(dt) { if (era >= 0) levels[era].time += dt; },
    /** Horizontal distance walked (teleports are ignored by the caller). */
    walk(d) { if (era >= 0) levels[era].distance += d; },

    clue(obj) {
      if (era < 0) return;
      attemptClues.add(obj);
      levels[era].clues = Math.max(levels[era].clues, attemptClues.size);
    },
    fall() { if (era >= 0) levels[era].falls++; },
    shock() { if (era >= 0) levels[era].shocks++; },
    rewind() { if (era >= 0) levels[era].rewinds++; },
    checkpoint() { if (era >= 0) levels[era].checkpoints++; },

    /** Called when the level's core is taken: commit the final proof. */
    complete(i, { puzzles, cluesTotal, puzzlesTotal = PUZZLE_TOTALS[i], extras = null } = {}) {
      const l = levels[i];
      l.puzzles = puzzles;
      l.puzzlesTotal = puzzlesTotal;
      l.cluesTotal = Math.max(l.cluesTotal, cluesTotal || 0);
      l.extras = extras || l.extras;
    },

    snapshot() { return { era, levels: levels.map((l) => ({ ...l })) }; },

    restore(data) {
      this.reset();
      if (!data || typeof data !== 'object') return;
      if (Number.isInteger(data.era) && data.era >= 0 && data.era <= 2) era = data.era;
      if (Array.isArray(data.levels)) {
        data.levels.slice(0, 3).forEach((src, i) => {
          if (!src || typeof src !== 'object') return;
          const l = levels[i];
          for (const k of ['time', 'clues', 'cluesTotal', 'puzzles', 'puzzlesTotal', 'falls', 'shocks', 'rewinds', 'checkpoints', 'distance']) {
            const v = Number(src[k]);
            if (Number.isFinite(v) && v >= 0 && v <= 1e9) l[k] = v;
          }
          if (src.extras && typeof src.extras === 'object') l.extras = { ...src.extras };
        });
      }
    },
  };
}

/* ----------------------------- scoring ------------------------------ */

export function scoreLevel(rec, par) {
  const clues = rec.cluesTotal > 0 ? Math.min(1, rec.clues / rec.cluesTotal) : 1;
  const time = Math.min(1, par / Math.max(1, rec.time));
  const deaths = (rec.falls || 0) + (rec.shocks || 0);
  const score = 100 * (0.45 * clues + 0.35 * time + 0.2) - 6 * deaths - 14 * (rec.rewinds || 0);
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function rankFor(score) {
  if (score >= 90) return 'S';
  if (score >= 78) return 'A';
  if (score >= 60) return 'B';
  return 'C';
}

/** The whole-adventure summary the final screen builds on. */
export function summarizeJourney(runStats) {
  const L = runStats.levels;
  const scores = L.map((l, i) => scoreLevel(l, PAR_TIMES[i]));
  const overall = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const clues = L.reduce((a, l) => a + l.clues, 0);
  const cluesTotal = L.reduce((a, l) => a + Math.max(l.clues, l.cluesTotal), 0);
  const puzzles = L.reduce((a, l) => a + l.puzzles, 0);
  const puzzlesTotal = L.reduce((a, l) => a + l.puzzlesTotal, 0);
  const falls = L.reduce((a, l) => a + l.falls, 0);
  const shocks = L.reduce((a, l) => a + l.shocks, 0);
  const rewinds = L.reduce((a, l) => a + l.rewinds, 0);
  const checkpoints = L.reduce((a, l) => a + l.checkpoints, 0);
  const distance = L.reduce((a, l) => a + l.distance, 0);
  const time = L.reduce((a, l) => a + l.time, 0);
  const parTotal = PAR_TIMES.reduce((a, b) => a + b, 0);

  // Every award below is tied to a measurable event — never assigned randomly.
  const achievements = [{ name: 'Guardian of the Three Worlds', detail: 'Restored all three cores and healed the timeline', tier: 'gold' }];
  if (cluesTotal > 0 && clues >= cluesTotal) achievements.push({ name: 'Legendary Explorer', detail: `Discovered every clue — ${clues} of ${cluesTotal}`, tier: 'gold' });
  if (falls === 0) achievements.push({ name: 'Fearless Adventurer', detail: 'Never slipped out of time', tier: 'gold' });
  if (rewinds === 0) achievements.push({ name: 'Master of Time', detail: 'Completed every era without a rewind', tier: 'silver' });
  if (shocks === 0) achievements.push({ name: 'Untouchable', detail: 'Never took a single shock', tier: 'silver' });
  if (time <= parTotal) achievements.push({ name: 'Swift Chrononaut', detail: `Beat the combined target time of ${Math.round(parTotal / 60)} minutes`, tier: 'silver' });
  if (distance >= 500) achievements.push({ name: 'Trailblazer', detail: `Walked over ${Math.round(distance)} m across three eras`, tier: 'bronze' });

  const medal = overall >= 85 ? 'gold' : overall >= 70 ? 'silver' : 'bronze';
  return {
    levels: L, scores, overall, medal,
    totals: { time, clues, cluesTotal, puzzles, puzzlesTotal, falls, shocks, rewinds, checkpoints, distance, parTotal },
    achievements,
  };
}

/** Creative per-level achievement titles, keyed by rank. */
export const LEVEL_TITLES = [
  { S: 'Keeper of the First Hour', A: 'Sun Court Adept', B: 'Temple Apprentice', C: 'Wanderer of the Ruins' },
  { S: 'Blackout Specialist', A: 'Lab Investigator', B: 'Junior Researcher', C: 'Fumbler in the Dark' },
  { S: 'Spire Runner', A: 'Skyline Survivor', B: 'Neon Climber', C: 'Lost in 2187' },
];

export const OVERALL_TITLES = { S: 'Ultimate Time Traveller', A: 'Chrono Guardian', B: 'Time Voyager', C: 'Apprentice of Hours' };
