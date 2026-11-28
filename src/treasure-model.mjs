// Treasure maps (round 6): the clue a map is read as. Pure: the hex the treasure lies on, and the facts about it that
// fit that hex and no other on the whole map. The words of each fact come from the language files on the game side;
// here a fact is data ({ k: 'class', t: 'snowlands' }, { k: 'near', kind: 'temple', d: 3 }, …), so a clue's text
// survives a change of wording, and `fits` says whether a hex answers it.
//
// A map's grade sets where its treasure may lie (grade 1 on a hex you know, grade 2 within KNOWN_REACH[2] of one,
// grade 3 anywhere, fog included) and how the clue speaks: grade 1 names a place and a direction from it, grade 2
// names kinds of landmark ("three hexes from a temple") and never one by name, grade 3 gives ranges ("two to four
// hexes from a ruin"), never a name. The generator adds facts until one hex is left; a target it can't single out
// within the grade's facts is rolled again, and after TRIES the map reads as the grade below.

/** Grades of map: a Torn Map, a Weathered Chart, a Captain's Map. */
export const GRADES = [1, 2, 3];
/** How far (hexes) a grade's treasure may lie from a hex you know. */
export const KNOWN_REACH = { 1: 0, 2: 2, 3: Infinity };
/** The most facts a grade's clue holds. */
export const MAX_FACTS = { 1: 4, 2: 4, 3: 5 };
/** Targets tried at a grade before the map reads as the grade below. */
export const TRIES = 20;
/** A landmark a clue counts hexes from: a feature of the table, nearest of its kind. */
export const LANDMARKS = ['temple', 'ruin', 'lighthouse', 'cave', 'dungeon', 'wreckage', 'bridge', 'farm', 'port', 'city', 'waterfall', 'mine', 'castle', 'camp', 'monolith', 'pyramid'];
/** The features a clue may name of the hex itself. */
export const LOOKS = ['river', 'lake', 'forest', 'tree', 'cliff', 'mountain', 'rock', 'rocky', 'sand', 'snow', 'swamp', 'lava', 'toxic', 'iceberg', 'coral', 'waterfall'];
/** How far (hexes) a landmark or a named place may be to be worth a fact. */
export const NEAR_MAX = 6;
/** A grade 3 range spans this many hexes ("two to four" spans 2). */
export const RANGE_SPAN = 2;
/** The ground a treasure can lie in (water has none). */
export const DIG_CLASSES = ['shoal', 'beach', 'grasslands', 'badlands', 'wastelands', 'highlands', 'snowlands', 'desert', 'swamplands', 'cursedlands', 'mountain', 'kingslands', 'lavalands'];
/** The eight directions a place's bearing is told in (terrain.mjs directionLabel's). */
export const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash(s) {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const keyOf = (h) => `${h.q},${h.r}`;
export const hexDist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
/** The bearing of `to` from `from` in eight directions (the same sums as terrain.mjs directionLabel). */
export function bearing(from, to) {
  const dq = to.q - from.q;
  const dr = to.r - from.r;
  const x = 1.5 * dq;
  const y = (Math.sqrt(3) / 2) * dq + Math.sqrt(3) * dr;
  if (x === 0 && y === 0) return '';
  const angle = ((Math.atan2(-y, x) * 180) / Math.PI + 360) % 360;
  return ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'][Math.round(angle / 45) % 8];
}
const hasF = (h, f) => Array.isArray(h.f) && h.f.includes(f);

/** A hex a treasure may lie on: diggable ground, no cloud, no place (port, town, area, dungeon) on it. */
export const diggable = (h) => h != null && DIG_CLASSES.includes(h.t) && h.cloud !== true && typeof h.poi !== 'string' && h.area === undefined && h.dungeon === undefined;

const prepared = new WeakMap();
/**
 * The table read once: { hexes, byKey, dig: diggable hexes, places: Map poi -> hex, nearest: Map kind -> Map key ->
 * hexes to the nearest of that kind (within NEAR_MAX + RANGE_SPAN), regions }. `regions`: Map key -> Pilotage area.
 */
export function prepare(hexes, regions = new Map()) {
  const memo = prepared.get(hexes);
  if (memo !== undefined && memo.regions === regions) return memo;
  const byKey = new Map(hexes.map((h) => [keyOf(h), h]));
  const places = new Map(hexes.filter((h) => typeof h.poi === 'string').map((h) => [h.poi, h]));
  const nearest = new Map();
  const reach = NEAR_MAX + RANGE_SPAN;
  for (const kind of LANDMARKS) {
    const marks = hexes.filter((h) => hasF(h, kind));
    const m = new Map();
    for (const h of hexes) {
      let best = Infinity;
      for (const x of marks) { const d = hexDist(h, x); if (d < best) best = d; }
      if (best <= reach) m.set(keyOf(h), best);
    }
    nearest.set(kind, m);
  }
  const out = { hexes, byKey, dig: hexes.filter(diggable), places, nearest, regions };
  prepared.set(hexes, out);
  return out;
}

/** Whether hex `h` answers fact `x` (`P` from prepare). */
export function fits(h, x, P) {
  switch (x?.k) {
    case 'class': return h.t === x.t;
    case 'look': return hasF(h, x.f);
    case 'coast': return h.coast === true;
    case 'region': return P.regions.get(keyOf(h)) === x.area;
    case 'near': return P.nearest.get(x.kind)?.get(keyOf(h)) === x.d;
    case 'range': { const d = P.nearest.get(x.kind)?.get(keyOf(h)); return d !== undefined && d >= x.lo && d <= x.hi; }
    case 'from': { const p = P.places.get(x.place); return p !== undefined && hexDist(p, h) === x.d; }
    case 'dir': { const p = P.places.get(x.place); return p !== undefined && bearing(p, h) === x.dir; }
    default: return false;
  }
}
/** The hexes on the whole map that answer every fact. */
export const answers = (facts, P) => P.hexes.filter((h) => facts.every((x) => fits(h, x, P)));

/** The facts that could be told of `target` at `grade`, class first, then in a seeded order. */
function poolOf(target, grade, P, r, named) {
  const shuffle = (list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const k = keyOf(target);
  const more = [];
  for (const f of LOOKS) if (hasF(target, f)) more.push({ k: 'look', f });
  if (target.coast === true) more.push({ k: 'coast' });
  const area = P.regions.get(k);
  if (area !== undefined) more.push({ k: 'region', area });
  if (grade === 1) {
    // The named places near it that you know (or any, with none given), the nearest first.
    const near = [...P.places.values()].filter((p) => (named === undefined || named.has(p.poi)) && p.cloud !== true)
      .map((p) => ({ p, d: hexDist(p, target) })).filter((x) => x.d > 0 && x.d <= NEAR_MAX).sort((a, b) => a.d - b.d || (a.p.poi < b.p.poi ? -1 : 1));
    const by = near.slice(0, 3).flatMap(({ p, d }) => [{ k: 'dir', place: p.poi, dir: bearing(p, target) }, { k: 'from', place: p.poi, d }]);
    return [{ k: 'class', t: target.t }, ...by, ...shuffle(more)];
  }
  const marks = [];
  for (const kind of LANDMARKS) {
    const d = P.nearest.get(kind).get(k);
    if (d === undefined || d < 1 || d > NEAR_MAX) continue;
    if (grade === 2) marks.push({ k: 'near', kind, d });
    else { const lo = Math.max(1, d - Math.floor(r() * (RANGE_SPAN + 1))); marks.push({ k: 'range', kind, lo, hi: lo + RANGE_SPAN }); }
  }
  return [{ k: 'class', t: target.t }, ...shuffle([...marks, ...more])];
}

/**
 * The fewest facts (greedy: each the one that leaves fewest hexes) from the pool that single `target` out, or
 * undefined when the grade's MAX_FACTS can't.
 */
export function clueFor(target, grade, P, r = Math.random, named) {
  const pool = poolOf(target, grade, P, r, named);
  const facts = [pool.shift()];
  let left = answers(facts, P);
  while (left.length > 1) {
    if (facts.length >= MAX_FACTS[grade] || pool.length === 0) return undefined;
    let best;
    let bestLeft;
    for (let i = 0; i < pool.length; i++) {
      const l = left.filter((h) => fits(h, pool[i], P));
      if (bestLeft === undefined || l.length < bestLeft.length) { best = i; bestLeft = l; }
    }
    if (bestLeft.length === left.length) return undefined;
    facts.push(pool.splice(best, 1)[0]);
    left = bestLeft;
  }
  return left.length === 1 && left[0] === target ? facts : undefined;
}

/** The hexes a grade's treasure may lie on: diggable, within KNOWN_REACH of a hex you know (`known`: Set of "q,r"). */
export function targetsOf(grade, P, known) {
  const reach = KNOWN_REACH[grade] ?? 0;
  if (reach === Infinity) return P.dig;
  const knownHexes = known === undefined ? [] : [...known].map((k) => P.byKey.get(k)).filter(Boolean);
  if (reach === 0) return P.dig.filter((h) => known?.has(keyOf(h)));
  return P.dig.filter((h) => knownHexes.some((x) => hexDist(x, h) <= reach));
}

/**
 * A map read: { grade (the one it reads as), q, r, facts } or undefined when nothing at any grade fits (nothing
 * known for grade 1). The same id gives the same map. `known`: the hexes you know; `named`: the places you know (a Set
 * of POI ids; undefined: any).
 */
export function readMap(id, grade, P, known, named) {
  const r = rng(hash(`voyage-map|${id}`));
  for (let g = Math.min(3, Math.max(1, Math.floor(grade) || 1)); g >= 1; g--) {
    const targets = targetsOf(g, P, known);
    if (targets.length === 0) continue;
    for (let i = 0; i < TRIES; i++) {
      const target = targets[Math.floor(r() * targets.length)];
      const facts = clueFor(target, g, P, r, g === 1 ? named : undefined);
      if (facts !== undefined) return { grade: g, q: target.q, r: target.r, facts };
    }
  }
  return undefined;
}

const FACT_KEYS = { class: ['t'], look: ['f'], coast: [], region: ['area'], near: ['kind', 'd'], range: ['kind', 'lo', 'hi'], from: ['place', 'd'], dir: ['place', 'dir'] };
const WORD = /^[\w:]{1,80}$/;
/** A fact from the save, or undefined: its kind's fields only, each a word or a whole number. */
export function cleanFact(x) {
  if (x === null || typeof x !== 'object' || FACT_KEYS[x.k] === undefined) return undefined;
  const out = { k: x.k };
  for (const f of FACT_KEYS[x.k]) {
    const v = x[f];
    if (typeof v === 'number' ? !(Number.isInteger(v) && v >= 0 && v < 1000) : !(typeof v === 'string' && WORD.test(v))) return undefined;
    out[f] = v;
  }
  if (x.k === 'dir' && !DIRS.includes(out.dir)) return undefined;
  return out;
}

// ---- maps held, digging and prizes (round 6, the game side reads these) -------------------------------------------
/** The map items by grade (voyage: ids). */
export const MAP_ITEMS = { 1: 'Torn_Map', 2: 'Weathered_Chart', 3: 'Captains_Map' };
/** The Cartography level a grade needs to be read. */
export const READ_LEVEL = { 1: 1, 2: 40, 3: 80 };
/** The most maps held at once: a sixth waits in the bank until one is dug or thrown away. */
export const MAX_HELD = 5;
/** Wrong digs a map stands; the next one it falls apart. */
export const MAX_WRONG = 3;
/** A cargo delivered at a port whose sea has a wreck gives a map this often. */
export const WRECK_CHANCE = 1 / 50;
/** Game time a dig takes, by grade. */
export const DIG_MS = { 1: 30 * 60000, 2: 60 * 60000, 3: 120 * 60000 };
/** A grade 3 treasure is guarded this often. */
export const GUARD_CHANCE = 0.25;
/** Guarded prizes left after a Run, at most. */
export const LEFT_MAX = 5;
/** The prize by grade: GP as purses of the ground's tier, Pitch, and the extra rolls (each on its own). */
export const PRIZES = {
  1: { purses: 3, pitch: [10, 30], extra: [['bankslot', 1 / 20]] },
  2: { purses: 6, pitch: [30, 80], extra: [['card', 1 / 6], ['token', 1 / 3]] },
  3: { purses: 12, pitch: [80, 200], extra: [['card', 1 / 3], ['signet', 1 / 12], ['relic', 1]] },
};

/** The grade a map item id is (with or without the namespace), or undefined. */
export const gradeOfItem = (id) => { const bare = String(id ?? '').replace(/^voyage:/, ''); const g = Object.keys(MAP_ITEMS).find((k) => MAP_ITEMS[k] === bare); return g === undefined ? undefined : Number(g); };

/**
 * A prize: { gp, pitch, extra: ['bankslot' | 'card' | 'token' | 'signet' | 'relic', …] }. `purse`: a band purse of the
 * ground's tier; `r` a random source.
 */
export function prizeOf(grade, purse, r = Math.random) {
  const p = PRIZES[grade] ?? PRIZES[1];
  const [lo, hi] = p.pitch;
  const extra = p.extra.filter(([, chance]) => r() < chance).map(([k]) => k);
  return { gp: Math.max(0, Math.round(p.purses * (Number.isFinite(purse) ? purse : 0))), pitch: lo + Math.floor(r() * (hi - lo + 1)), extra };
}

/** A dig on `at` ({ q, r }) with map `m`: 'found', 'nothing', or 'apart' (the wrong dig that ends the map). */
export function digOutcome(m, at) {
  if (m.q === at.q && m.r === at.r) return 'found';
  const wrong = (m.dug ?? []).filter(([q, r]) => !(q === at.q && r === at.r)).length + 1;
  return wrong >= MAX_WRONG ? 'apart' : 'nothing';
}

const int = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
const coord = (x) => int(x, -512, 511);
/**
 * `record.maps` from the save: { n (maps read), held: [{ id, grade, q, r, facts, dug, at }], left: [{ q, r, grade, band }],
 * found, lost (counts for the Journal), dig?: { id, q, r, start, end } (the one dig running) }.
 */
export function cleanMaps(raw) {
  const src = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const held = [];
  const ids = new Set();
  for (const m of Array.isArray(src.held) ? src.held : []) {
    if (m === null || typeof m !== 'object' || typeof m.id !== 'string' || !WORD.test(m.id) || ids.has(m.id)) continue;
    if (!GRADES.includes(m.grade) || !coord(m.q) || !coord(m.r) || !Array.isArray(m.facts)) continue;
    const facts = m.facts.map(cleanFact);
    if (facts.length === 0 || facts.some((x) => x === undefined)) continue;
    const dug = [];
    for (const d of Array.isArray(m.dug) ? m.dug : []) if (Array.isArray(d) && coord(d[0]) && coord(d[1]) && !dug.some(([q, r]) => q === d[0] && r === d[1])) dug.push([d[0], d[1]]);
    ids.add(m.id);
    held.push({ id: m.id, grade: m.grade, q: m.q, r: m.r, facts, dug: dug.slice(0, MAX_WRONG), at: Number.isFinite(m.at) ? m.at : 0 });
    if (held.length >= MAX_HELD) break;
  }
  const left = [];
  for (const x of Array.isArray(src.left) ? src.left : []) {
    if (x === null || typeof x !== 'object' || !coord(x.q) || !coord(x.r) || !GRADES.includes(x.grade) || typeof x.band !== 'string' || !WORD.test(x.band)) continue;
    if (left.some((y) => y.q === x.q && y.r === x.r)) continue;
    left.push({ q: x.q, r: x.r, grade: x.grade, band: x.band });
    if (left.length >= LEFT_MAX) break;
  }
  const d = src.dig;
  const dig = d !== null && typeof d === 'object' && typeof d.id === 'string' && held.some((m) => m.id === d.id) && coord(d.q) && coord(d.r) && Number.isFinite(d.start) && Number.isFinite(d.end) && d.end >= d.start
    ? { id: d.id, q: d.q, r: d.r, start: d.start, end: d.end } : undefined;
  const out = { n: int(src.n, 0, 1e9) ? src.n : 0, held, left, found: int(src.found, 0, 1e9) ? src.found : 0, lost: int(src.lost, 0, 1e9) ? src.lost : 0 };
  if (dig !== undefined) out.dig = dig;
  return out;
}

/** The grade of map a danger tier gives (a band's loot, a wreck's sea): 1 at tiers 1-2, 2 at tier 3, 3 at tier 4. */
export const gradeOfTier = (tier) => (tier >= 4 ? 3 : tier === 3 ? 2 : 1);
