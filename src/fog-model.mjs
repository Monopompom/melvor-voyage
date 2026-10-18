// Voyages into the fog (phase 5b). Pure: no game objects, tested in
// tests/fog-model.test.mjs. The game side is src/voyage-fog.mjs, the voyage itself src/voyage-clock.mjs.
//
// The game routes only through fully surveyed hexes and runs one action at a time, so the voyage surveys the fog
// itself, a hex ahead at a time, with the game's own survey (the user, 18 Oct 2026). A fog hex takes its survey time
// on top of its sailing or walking time. A hex the character can't survey, nor will by the time the voyage reaches
// it, refuses the trip up front. An option surveys the hexes beside the route too, no farther than the survey range.

/** Cartography.SURVEY_XP_PER_LEVEL (v1.3.1): survey XP a hex needs for each level. */
export const SURVEY_XP_PER_LEVEL = [0, 24, 108, 264, 504, 864];
/** Cartography.BASE_SURVEY_XP. */
export const BASE_SURVEY_XP = 1;
/** Hexes beside the route offered at most, whatever the survey range. */
export const MAX_SIDE = 3;

// Axial coordinates, as the game's HexCoords (q, r).
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export const distance = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
const key = (h) => `${h.q},${h.r}`;

/** The hexes 1 to `d` from `c`, nearest first (ring by ring, each ring in a fixed order). */
export function around(c, d) {
  const out = [];
  for (let k = 1; k <= d; k++) {
    // A ring: start k steps in direction 4, then walk k steps along each direction.
    let q = c.q + DIRS[4][0] * k;
    let r = c.r + DIRS[4][1] * k;
    for (let side = 0; side < 6; side++) {
      for (let s = 0; s < k; s++) { out.push({ q, r }); q += DIRS[side][0]; r += DIRS[side][1]; }
    }
  }
  return out;
}

/** Survey actions a hex still needs to be fully surveyed: `xp` it has, `max` its maxSurveyLevel, `each` XP an action. */
export function actionsToFull(xp, max, each = BASE_SURVEY_XP, table = SURVEY_XP_PER_LEVEL) {
  const need = (table[max] ?? table[table.length - 1]) - (Number.isFinite(xp) ? xp : 0);
  if (!(need > 0) || !(each > 0)) return 0;
  return Math.ceil(need / each - 1e-9);
}

/**
 * The hexes to survey beside the route, per hex of the walk (start first): `out[i]` is surveyed standing on walk[i],
 * before the step to walk[i + 1]. Hexes up to `width` from walk[i], nearest first, that `open(h)` (on the map, not
 * fully surveyed, the survey allowed), never a hex of the route and never one an earlier hex took. The arrival hex
 * takes none: the voyage ends there.
 */
export function sideQueues(walk, width, open) {
  const out = (walk ?? []).slice(0, -1).map(() => []);
  if (!(width > 0) || out.length === 0) return out;
  const taken = new Set(walk.map(key));
  for (let i = 0; i < out.length; i++) {
    for (const h of around(walk[i], width)) {
      const k = key(h);
      if (taken.has(k) || !open(h)) continue;
      taken.add(k);
      out[i].push(h);
    }
  }
  return out;
}

/**
 * Can the voyage survey its fog hexes in turn? `hexes` in the order surveyed: [{ need (Cartography level the survey
 * needs, 0 none), actions, xpEach }]; `xp` the character's Cartography XP now, `levelOf(xp)` its level. The XP of each
 * survey counts toward the next (the user: "if exploring requires level we don't have or we can't reach that level on
 * the go - we can't go"). { ok, at (index of the first hex it can't reach, ok false), need, reach (the level reached
 * by then) } or, ok, { ok, need (the highest level above the start one), at (its index), by (the index of the hex
 * whose survey reaches it, -1 already there) }.
 */
export function levelCheck({ xp, levelOf, hexes }) {
  let now = xp;
  const start = levelOf(now);
  let best = { ok: true, need: 0, at: -1, by: -1 };
  // The index of the survey that first reached each level above the start, for "by hex N".
  const reachedAt = new Map();
  for (let i = 0; i < hexes.length; i++) {
    const h = hexes[i];
    const level = levelOf(now);
    if (h.need > level) return { ok: false, at: i, need: h.need, reach: level };
    if (h.need > start && h.need > best.need) best = { ok: true, need: h.need, at: i, by: reachedAt.get(h.need) ?? -1 };
    for (let a = 0; a < h.actions; a++) {
      const before = levelOf(now);
      now += h.xpEach;
      const after = levelOf(now);
      for (let l = before + 1; l <= after; l++) if (!reachedAt.has(l)) reachedAt.set(l, i);
    }
  }
  return best;
}

/** Survey ticks for `actions` actions of `intervalMs` each (whole ticks, the game's 50 ms). */
export const surveyTicks = (actions, intervalMs, tickMs = 50) => (actions > 0 ? actions * Math.max(1, Math.round(intervalMs / tickMs)) : 0);

