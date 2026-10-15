/**
 * Beam/mark agreement for the Present archive puzzle.
 * The very same check gates the E prompt, E action and shader-side clues.
 * No raycast aiming at tiny ink meshes: beam alignment + nearby clue zone.
 */
export const INK_MAX_BEAM_DISTANCE = 9;
export const INK_MIN_BEAM_DOT = 0.94; // Inside the visible cone, near its bright centre

export function flashlightHitsInk(flash, target) {
  if (!flash?.on || !target) return false;
  const x = target.x - flash.pos.x;
  const y = target.y - flash.pos.y;
  const z = target.z - flash.pos.z;
  const sq = x * x + y * y + z * z;
  if (sq < 0.0001 || sq > INK_MAX_BEAM_DISTANCE ** 2) return false;
  const dot = (x * flash.dir.x + y * flash.dir.y + z * flash.dir.z) / Math.sqrt(sq);
  return dot >= INK_MIN_BEAM_DOT;
}
