// Resource zones: each ore, tree, fish, crop and thieving target has its own places on the map, on
// top of the skill's own rule (rules.mjs). An action works on a hex when the skill works there AND the action's zone
// takes the hex. Actions without a zone (abyssal ones, actions the table does not list) follow the skill rule alone.
// Pure: the table is data/zones.json; covered by tests/zones.test.mjs.
//
// A zone is a list of terms; it takes a hex when any term matches. A term matches when every key it has holds:
//   t: [classes]      the hex's class is one of them
//   f: [features]     the hex has one of them
//   coast: true       the hex is a coast hex (land next to the sea)
//   shore: [min, max] a sea hex this many steps from land (max optional)
//   area / poi: [...] the hex carries one of these hand-placed areas or POIs
//   near: { t, f, area, poi, r }   some hex within r steps (the hex itself included) matches t/f/area/poi
//   lat: [min, max]   the hex's map row (the game's (col, row), 0 at the top) is in this range (max optional)
//   not: [{ t, f, area, poi, r }]  no hex within r steps (default 0: the hex itself) matches any of these
// Cloud hexes never match (nothing is known about them).
// Grace (rules.mjs): a hex that a skill works on only because it is next to a full-rate hex takes the zones of those
// neighbours too (zoneAllowsWithGrace), so a thief next to the town finds the town's targets.

/** Hexes within `r` steps of `rec` (rec included), through `neighbours(rec)`. */
function within(rec, r, neighbours) {
  const seen = new Set([rec]);
  let frontier = [rec];
  for (let d = 0; d < r; d++) {
    const next = [];
    for (const h of frontier) for (const n of neighbours(h)) if (!seen.has(n)) { seen.add(n); next.push(n); }
    frontier = next;
  }
  return seen;
}

/** The game's map row of an axial hex (odd-q offset, as HexCoords.to_oddq). */
export const rowOf = (rec) => rec.r + (rec.q - (rec.q & 1)) / 2;

const hasAny = (list, values) => Array.isArray(list) && list.some((v) => values.includes(v));

/** Does the plain part of a term (t, f, area, poi) hold for `rec`? Keys a term lacks always hold. */
function plainMatch(term, rec) {
  if (term.t !== undefined && !term.t.includes(rec.t)) return false;
  if (term.f !== undefined && !hasAny(rec.f, term.f)) return false;
  if (term.area !== undefined && !term.area.includes(rec.area) && !term.area.includes(rec.dungeon)) return false;
  if (term.poi !== undefined && !term.poi.includes(rec.poi)) return false;
  return true;
}

export function termMatches(term, rec, neighbours) {
  if (rec === undefined || rec.cloud === true) return false;
  if (!plainMatch(term, rec)) return false;
  if (term.coast === true && rec.coast !== true) return false;
  if (term.shore !== undefined) {
    const s = rec.shore;
    if (!Number.isInteger(s) || s < term.shore[0] || (term.shore[1] !== undefined && s > term.shore[1])) return false;
  }
  if (term.lat !== undefined) {
    const row = rowOf(rec);
    if (row < term.lat[0] || (term.lat[1] !== undefined && row > term.lat[1])) return false;
  }
  if (term.near !== undefined) {
    if (typeof neighbours !== 'function') return false;
    let ok = false;
    for (const h of within(rec, term.near.r ?? 1, neighbours)) if (h.cloud !== true && plainMatch(term.near, h)) { ok = true; break; }
    if (!ok) return false;
  }
  for (const no of term.not ?? []) {
    const r = no.r ?? 0;
    if (r > 0 && typeof neighbours !== 'function') return false;
    const hexes = r > 0 ? within(rec, r, neighbours) : [rec];
    for (const h of hexes) if (h.cloud !== true && plainMatch(no, h)) return false;
  }
  return true;
}

/** True when the zone takes the hex. A missing zone takes every hex (the skill rule alone decides). */
export function zoneAllows(zone, rec, neighbours) {
  if (zone === undefined) return true;
  return zone.terms.some((term) => termMatches(term, rec, neighbours));
}

/** zoneAllows, or the zone takes one of `graceFrom` (rules.graceFrom: the full-rate neighbours that lift a grace hex). */
export function zoneAllowsWithGrace(zone, rec, neighbours, graceFrom = []) {
  return zoneAllows(zone, rec, neighbours) || graceFrom.some((n) => zoneAllows(zone, n, neighbours));
}

/** The zone of an action id ('melvorD:Copper_Ore'), or undefined. `table` is data/zones.json. */
export function zoneFor(table, actionId) {
  for (const skill of Object.values(table?.skills ?? {})) {
    const z = skill.actions?.[actionId];
    if (z !== undefined) return z;
  }
  return undefined;
}

/**
 * The terms a zone names, for display: classes, features, areas and POIs in first-seen order; `lat` (the first row
 * range named) and `away` (the features of every `not`).
 */
export function zoneTerms(zone) {
  const out = { classes: [], features: [], places: [], lat: undefined, away: [] };
  const add = (list, values) => { for (const v of values ?? []) if (!list.includes(v)) list.push(v); };
  for (const term of zone?.terms ?? []) {
    add(out.classes, term.t);
    add(out.features, term.f);
    add(out.places, term.area);
    add(out.places, term.poi);
    if (term.near !== undefined) { add(out.classes, term.near.t); add(out.features, term.near.f); add(out.places, term.near.area); add(out.places, term.near.poi); }
    if (term.lat !== undefined && out.lat === undefined) out.lat = term.lat;
    for (const no of term.not ?? []) add(out.away, no.f);
  }
  return out;
}
