// Slayer tasks that fit the map: the pure rules. The game picks a new Slayer task's monster from its own list
// (SlayerTask.getMonsterSelection); with "Near you" on, Voyage narrows that list to the monsters fought close to
// you. No game objects here: the runtime (gate.mjs) hands in each candidate's distance in hexes.

/** A monster counts as near when its area has a known hex at most this many hexes from you. */
export const NEAR = 8;
/** The pool never holds fewer monsters than this while the tier has more with a known place: the nearest are added. */
export const NEAR_MIN = 3;

export const hexDist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;

/** Hexes from `at` to the nearest of `places` ({ q, r }[]); Infinity for none. */
export const placeDistance = (at, places) => places.reduce((d, h) => Math.min(d, hexDist(at, h)), Infinity);

/**
 * The near pick. `entries`: [{ id, d }], d the hexes to the monster's nearest known place (0 for an area fought
 * anywhere, Infinity for one whose places you don't know yet). Returns { ids, fallback }: the ids within NEAR, widened
 * to the NEAR_MIN nearest (every entry as near as the last one taken comes too, so a whole area joins at once), in the
 * order given. `fallback` is true when no entry has a known place: the caller keeps the game's own list.
 */
export function nearbyPick(entries, near = NEAR, min = NEAR_MIN) {
  const known = entries.filter((e) => Number.isFinite(e.d));
  if (known.length === 0) return { ids: [], fallback: entries.length > 0 };
  const sorted = known.map((e) => e.d).sort((a, b) => a - b);
  const reach = Math.max(near, sorted[Math.min(min, sorted.length) - 1]);
  return { ids: known.filter((e) => e.d <= reach).map((e) => e.id), fallback: false };
}

// ---- port Slayer contracts ----------------------------------------------------------------------------------------
/** A port's contracts come from monsters fought within this many hexes of it (the cargo regions' radius). */
export const REGION = 6;

/**
 * A port's contract for one tier: the id of the lowest-scored entry among those within REGION, else the nearest known
 * ones. `entries`: [{ id, d, s }], d the hexes from the port to the monster's nearest known place (as for nearbyPick),
 * s a seeded score in [0, 1) of that port, season, tier and monster alone. Scoring each monster on its own keeps the
 * season's pick when the list grows (a Slayer level, a place found): only a newcomer that scores lower takes over,
 * never a reshuffle. Undefined when the tier has no monster with a known place.
 */
export function contractPick(entries, score = (e) => e.s) {
  const pick = new Set(nearbyPick(entries, REGION, 1).ids);
  let best;
  for (const e of entries) if (pick.has(e.id) && (best === undefined || score(e) < score(best))) best = e;
  return best?.id;
}

/** The save key of a port's contract for a tier: the port's name and the tier's local id. */
export const takenKey = (poi, tier) => `${poi}_${tier}`;
/** The monster id of the port's contract for this tier taken this season, or undefined. */
export const takenMonster = (taken, poi, tier, season) => {
  const m = taken?.[takenKey(poi, tier)];
  return m?.season === season ? m.monster : undefined;
};
/** Is the port's contract for this tier taken this season? */
export const isTaken = (taken, poi, tier, season) => takenMonster(taken, poi, tier, season) !== undefined;
/** `taken` with this port's tier marked for `season` and the monster taken; marks of other seasons are dropped. */
export function markTaken(taken, poi, tier, season, monster) {
  const out = {};
  for (const [k, m] of Object.entries(taken ?? {})) if (m?.season === season) out[k] = m;
  out[takenKey(poi, tier)] = { season, monster };
  return out;
}

/**
 * The `slayer` part of the save (v31): { near, taken }. `taken` is { "port_tier": { season, monster } } for the
 * contracts taken (takenKey), the monster's id kept so the board names the one you took.
 */
export function cleanSlayer(raw) {
  const rec = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const taken = {};
  if (rec.taken !== null && typeof rec.taken === 'object' && !Array.isArray(rec.taken)) {
    for (const [key, m] of Object.entries(rec.taken)) {
      if (!/^\w+$/.test(key) || m === null || typeof m !== 'object') continue;
      if (Number.isInteger(m.season) && m.season >= 0 && typeof m.monster === 'string' && /^[\w:]+$/.test(m.monster)) taken[key] = { season: m.season, monster: m.monster };
    }
  }
  return { near: rec.near === true, taken };
}
