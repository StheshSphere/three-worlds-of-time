import { GLYPHS, NUMERALS } from './glyphs.js';

/** The same hour-to-symbol mapping drives the carvings, journal and altar. */
export function isTabletLayout(value) {
  return !!value && Array.isArray(value.code) && value.code.length === 3 &&
    value.code.every(glyph => GLYPHS.includes(glyph)) &&
    Array.isArray(value.tabletOrder) && value.tabletOrder.length === 3 &&
    value.tabletOrder.every(hour => Number.isInteger(hour) && hour >= 0 && hour < 3) &&
    new Set(value.tabletOrder).size === 3;
}

function shuffle(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Fisher-Yates gives every symbol combination and hour assignment a chance. */
export function createTabletLayout(random, previousCode = null) {
  const code = shuffle(GLYPHS, random).slice(0, 3);
  if (previousCode?.length === 3 && code.every((glyph, hour) => glyph === previousCode[hour])) {
    // A restart must visibly change the puzzle, even if the random draw repeats.
    [code[0], code[1]] = [code[1], code[0]];
  }
  return { code, tabletOrder: shuffle([0, 1, 2], random) };
}

/** Read only our own fixed-format tablet entries, including pre-fix saves. */
export function journalTablets(journal = []) {
  return journal.flatMap(entry => {
    const spot = /^tablet-([012])$/.exec(entry.key || '');
    const clue = /Tablet of the <b>(I|II|III)<\/b> hour[^]*?the <b>(Sun|Moon|Eye|Wave|Peak|Hourglass)<\/b>/.exec(entry.html || '');
    return spot && clue ? [{ spot: Number(spot[1]), hour: NUMERALS.indexOf(clue[1]), glyph: clue[2] }] : [];
  });
}

export function restoreTabletLayout(generated, saved, journal = []) {
  if (isTabletLayout(saved)) return { code: [...saved.code], tabletOrder: [...saved.tabletOrder] };
  const layout = { code: [...generated.code], tabletOrder: [...generated.tabletOrder] };
  if (!saved) return layout;

  // Old versions stored only a seed. A stale journal could describe a previous
  // rewind's puzzle. Honour every collected clue the player can actually read.
  const known = journalTablets(journal).filter(clue => saved.state?.tablets?.[clue.spot]);
  const hours = new Set(), spots = new Set();
  for (const clue of known) {
    if (hours.has(clue.hour) || spots.has(clue.spot)) continue;
    layout.code[clue.hour] = clue.glyph;
    layout.tabletOrder[clue.spot] = clue.hour;
    hours.add(clue.hour); spots.add(clue.spot);
  }
  const remaining = generated.tabletOrder.filter(hour => !hours.has(hour));
  for (let spot = 0; spot < 3; spot++) {
    if (spots.has(spot)) continue;
    const preferred = remaining.indexOf(generated.tabletOrder[spot]);
    layout.tabletOrder[spot] = remaining.splice(preferred < 0 ? 0 : preferred, 1)[0];
  }
  return layout;
}

/** Compare hours I, II, III; collection order never changes the answer. */
export function tabletCodeMatches(indices, code) {
  return indices.length === 3 && code.length === 3 &&
    indices.every((index, hour) => Number.isInteger(index) && GLYPHS[index] === code[hour]);
}
