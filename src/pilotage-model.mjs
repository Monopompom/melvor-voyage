// Pilotage (4.36, round 3; the user's four choices, 10 Nov 2026): a level 1 to 99 for each sea and each land region,
// earned by the hexes you travel there, kept for good. It shows where that area's storms will drift, a band's tier before
// it stops you, and makes travel there up to 10% faster. Voyage's own levels, not the game's mastery: the Voyage skill
// stays a plain Skill, so its save region and loading without the mod are unchanged.
//
// Pure: the areas, the level curve, the unlocks, the speed and the save's record. Like every model here it imports
// nothing: the sea split (charts-model.mjs seas()) comes in.

/** Hexes travelled in one area to reach level 99. */
export const HEXES_99 = 1000;
/** The curve's power: hexes for level L = HEXES_99 × ((L − 1) / 98) ^ CURVE, at least L − 1, so early levels come a hex each. */
export const CURVE = 2;
export const MAX_LEVEL = 99;
/** A land region smaller than this joins its neighbour (the three Capital City hexes, a lone farm). */
export const MIN_REGION = 5;
/** The levels that unlock something in that area. */
export const UNLOCKS = { forecast: 20, bandTier: 40, gold: 99 };
/** Storm tracks at UNLOCKS.forecast: a storm this many hexes or fewer from an area you know shows its track (a land's shore). */
export const STORM_SHORE = 2;
/** Each of these levels makes travel in that area 2% faster: 10% at 99. */
export const SPEED_LEVELS = [60, 70, 80, 90, 99];
export const SPEED_STEP = 0.02;
/** Places that seed no area (the Fake Port, as the charts leave it out). */
export const SKIP = ['FakePort'];
/** Area keys in the save. */
export const AREA_KEY = /^(sea|land)_\w+$/;

const NEIGHBOURS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const key = (h) => `${h.q},${h.r}`;
const near = (h) => NEIGHBOURS.map(([dq, dr]) => ({ q: h.q + dq, r: h.r + dr }));
const hexDist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
const isSea = (rec) => rec !== undefined && rec.cloud !== true && (rec.t === 'water' || rec.t === 'shoal');
const SEED_FEATURES = ['city', 'capital', 'port'];
const isSeed = (rec) => rec !== undefined && rec.cloud !== true && typeof rec.poi === 'string' && !SKIP.includes(rec.poi)
  && Array.isArray(rec.f) && rec.f.some((f) => SEED_FEATURES.includes(f));
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Every hex's area: Map "q,r" → 'sea_<port>' or 'land_<place>'. A sea hex goes to its port's sea (`seaMap`, the
 * charts' split: { [poi]: [{ q, r }] }, of which only the sea hexes count here). Every other hex that isn't cloud
 * (land, and water no port's sea reaches, such as a lake) goes to its nearest city, capital or port in steps over such
 * hexes, a tie to the first by name; one no step reaches goes to the nearest by straight distance. A region under
 * MIN_REGION hexes then joins the neighbour it shares most edges with (a tie: by name), smallest first.
 */
export function areas(hexes, seaMap) {
  const byKey = new Map(hexes.map((h) => [key(h), h]));
  const out = new Map();
  for (const [poi, list] of Object.entries(seaMap ?? {})) {
    if (SKIP.includes(poi)) continue;
    for (const h of list) if (isSea(byKey.get(key(h)))) out.set(key(h), `sea_${poi}`);
  }
  const isLand = (rec) => rec !== undefined && rec.cloud !== true && !out.has(key(rec));
  const seeds = hexes.filter(isSeed).sort((a, b) => byName(a.poi, b.poi));
  // The capital's hexes (Square, Knights, Alleyways) are one city: one region, named by the first.
  const capital = seeds.find((s) => s.f.includes('capital'))?.poi;
  const regionOf = (s) => `land_${s.f.includes('capital') && capital !== undefined ? capital : s.poi}`;
  let frontier = [];
  for (const s of seeds) {
    if (out.has(key(s))) continue; // a port drawn on the water is in its sea; its land is reached from its shore below
    out.set(key(s), regionOf(s));
    frontier.push({ q: s.q, r: s.r, a: regionOf(s) });
  }
  // Ports drawn on the water reach the land next to them, after the land seeds' own first step.
  const waterSeeds = seeds.filter((s) => out.get(key(s))?.startsWith('sea_'));
  for (const s of waterSeeds) frontier.push({ q: s.q, r: s.r, a: regionOf(s) });
  while (frontier.length > 0) {
    const next = [];
    for (const h of frontier) {
      for (const n of near(h)) {
        const k = key(n);
        const rec = byKey.get(k);
        if (out.has(k) || !isLand(rec)) continue;
        out.set(k, h.a);
        next.push({ q: n.q, r: n.r, a: h.a });
      }
    }
    frontier = next;
  }
  // Land no step reached (an island with no place): the nearest seed by straight distance.
  for (const h of hexes) {
    if (out.has(key(h)) || h.cloud === true) continue;
    let best;
    for (const s of seeds) {
      const d = hexDist(h, s);
      if (best === undefined || d < best.d) best = { d, a: regionOf(s) };
    }
    if (best !== undefined) out.set(key(h), best.a);
  }
  mergeSmall(out, byKey);
  return out;
}

/** Joins land regions under MIN_REGION hexes into a neighbour, smallest first (in place); one with no land neighbour stays. */
function mergeSmall(out, byKey) {
  const kept = new Set();
  for (;;) {
    const size = new Map();
    for (const a of out.values()) if (a.startsWith('land_')) size.set(a, (size.get(a) ?? 0) + 1);
    const small = [...size].filter(([a, n]) => n < MIN_REGION && !kept.has(a)).sort((x, y) => x[1] - y[1] || byName(x[0], y[0]))[0];
    if (small === undefined) return;
    const [name] = small;
    const edges = new Map();
    for (const [k, a] of out) {
      if (a !== name) continue;
      const [q, r] = k.split(',').map(Number);
      for (const n of near({ q, r })) {
        const b = out.get(key(n));
        if (b !== undefined && b !== name && b.startsWith('land_') && byKey.has(key(n))) edges.set(b, (edges.get(b) ?? 0) + 1);
      }
    }
    const into = [...edges].sort((x, y) => y[1] - x[1] || byName(x[0], y[0]))[0]?.[0];
    if (into === undefined) { kept.add(name); continue; }
    for (const [k, a] of out) if (a === name) out.set(k, into);
  }
}

/** { [area]: hex count } of an areas() map. */
export function areaSizes(map) {
  const out = {};
  for (const a of map.values()) out[a] = (out[a] ?? 0) + 1;
  return out;
}

// ---- the curve ---------------------------------------------------------------------------------------------------
/** Hexes travelled in an area to reach `level` (level 1: none). */
export function hexesFor(level) {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  return l <= 1 ? 0 : Math.max(l - 1, Math.ceil(HEXES_99 * ((l - 1) / (MAX_LEVEL - 1)) ** CURVE));
}
/** The level `hexes` travelled give (1 to 99). */
export function levelOf(hexes) {
  const n = Number.isFinite(hexes) && hexes > 0 ? Math.floor(hexes) : 0;
  let l = 1;
  while (l < MAX_LEVEL && hexesFor(l + 1) <= n) l++;
  return l;
}
/** { level, into, need } for the bar: hexes past this level and hexes this level spans (0 at 99). */
export function progress(hexes) {
  const level = levelOf(hexes);
  if (level >= MAX_LEVEL) return { level, into: 0, need: 0 };
  const from = hexesFor(level);
  return { level, into: Math.max(0, Math.floor(hexes) - from), need: hexesFor(level + 1) - from };
}

// ---- what a level gives ------------------------------------------------------------------------------------------
/** The share of a hex's time left at `level`: 1 below 60, 0.9 at 99. */
export const speedFactor = (level) => 1 - SPEED_STEP * SPEED_LEVELS.filter((l) => level >= l).length;
export const seesForecast = (level) => level >= UNLOCKS.forecast;
export const seesBandTier = (level) => level >= UNLOCKS.bandTier;
export const isGold = (level) => level >= UNLOCKS.gold;
/** The next level that unlocks something, or undefined at the top. */
export const nextUnlock = (level) => [UNLOCKS.forecast, UNLOCKS.bandTier, ...SPEED_LEVELS].filter((l) => l > level).sort((a, b) => a - b)[0];
/** Every level that unlocks something, lowest first: { level, hexes, kind ('forecast', 'bandTier' or 'speed'), pct, gold }. */
export const unlockTable = () => [UNLOCKS.forecast, UNLOCKS.bandTier, ...SPEED_LEVELS].map((level) => ({
  level,
  hexes: hexesFor(level),
  kind: level === UNLOCKS.forecast ? 'forecast' : level === UNLOCKS.bandTier ? 'bandTier' : 'speed',
  pct: Math.round((1 - speedFactor(level)) * 100),
  gold: isGold(level),
}));
/** Levels between `before` (exclusive) and `after` (inclusive) worth a notice: every unlock and every tenth level. */
export function noticeLevels(before, after) {
  const out = [];
  const unlock = new Set([UNLOCKS.forecast, UNLOCKS.bandTier, ...SPEED_LEVELS]);
  for (let l = before + 1; l <= after; l++) if (unlock.has(l) || l % 10 === 0) out.push(l);
  return out;
}

// ---- the save (v32): { [area]: hexes } ------------------------------------------------------------------------------
/** A clean record: area keys only, whole hex counts of 0 or more (others dropped). */
export function cleanPilotage(raw) {
  const out = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) if (AREA_KEY.test(k) && Number.isInteger(v) && v >= 0) out[k] = v;
  return out;
}
/** Adds `n` hexes in `area` to the record in place: { before, after } levels (undefined for an unknown area). */
export function addHexes(rec, area, n = 1) {
  if (rec === null || typeof rec !== 'object' || typeof area !== 'string' || !AREA_KEY.test(area) || !(n > 0)) return undefined;
  const was = Number.isInteger(rec[area]) ? rec[area] : 0;
  const now = was + Math.floor(n);
  rec[area] = now;
  return { before: levelOf(was), after: levelOf(now) };
}
