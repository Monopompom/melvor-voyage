// Pure terrain-table helpers: no game globals, covered by tests/terrain.test.mjs.
// The table is data/hex_terrain.json, compiled from the hand-authored map.
// CLASSES and FEATURES match the table's meta; the test checks them.

export const CLASSES = [
  'water', 'shoal', 'grasslands', 'kingslands', 'beach', 'desert', 'badlands', 'wastelands', 'highlands',
  'lavalands', 'mountain', 'snowlands', 'swamplands', 'cursedlands',
];
export const SEA_CLASSES = ['water', 'shoal'];

export const FEATURES = [
  'forest', 'tree', 'river', 'lake', 'waterfall', 'swamp', 'toxic', 'sand', 'snow', 'iceberg', 'rock', 'rocky', 'cliff',
  'mountain', 'cave', 'mine', 'lava', 'hot', 'storm', 'curse', 'cursed', 'magic', 'holy', 'illness', 'cobweb', 'coral',
  'crab', 'kraken', 'noodle', 'huntress', 'pirate', 'building', 'camp', 'farm', 'market', 'port', 'lighthouse', 'bridge',
  'castle', 'temple', 'monolith', 'pyramid', 'forge', 'ruin', 'city', 'capital', 'square', 'knights', 'alleyways',
  'stoneworkers', 'labyrinth', 'wreckage', 'boat', 'ship', 'fisherman', 'combat_area', 'slayer_area', 'stronghold_area',
  'dungeon',
];

/** Display label, PIXI tint and CSS colour per class. Water is never tinted: the data package owns it. */
export const CLASS_INFO = {
  water: { label: 'Water', colour: undefined, css: '#1e90ff' },
  shoal: { label: 'Shoals', colour: 0x5fb3d9, css: '#5fb3d9' },
  grasslands: { label: 'Grasslands', colour: 0x7fff00, css: '#7fff00' },
  kingslands: { label: 'Kingslands', colour: 0x3cb371, css: '#3cb371' },
  beach: { label: 'Beach', colour: 0xfff8c0, css: '#fff8c0' },
  desert: { label: 'Desert', colour: 0xffd700, css: '#ffd700' },
  badlands: { label: 'Badlands', colour: 0xff4500, css: '#ff4500' },
  wastelands: { label: 'Wastelands', colour: 0x9a9a6a, css: '#9a9a6a' },
  highlands: { label: 'Highlands', colour: 0xcd853f, css: '#cd853f' },
  lavalands: { label: 'Lavalands', colour: 0x8b0000, css: '#8b0000' },
  mountain: { label: 'Mountain', colour: 0x9c6b3c, css: '#9c6b3c' },
  snowlands: { label: 'Snowlands', colour: 0xffffff, css: '#ffffff' },
  swamplands: { label: 'Swamplands', colour: 0x556b2f, css: '#556b2f' },
  cursedlands: { label: 'Cursedlands', colour: 0xc020ff, css: '#c020ff' },
};
/** Tint for a hex under cloud, whatever its class. */
export const CLOUD_INFO = { label: 'Cloud', colour: 0x404040, css: '#404040' };

/** Labels for features; the few the rules name get a colour for the lock modal. */
export const FEATURE_INFO = Object.fromEntries(FEATURES.map((f) => [f, { label: f.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) }]));
Object.assign(FEATURE_INFO.forest, { label: 'Forest', css: '#006400' });
Object.assign(FEATURE_INFO.tree, { label: 'Trees', css: '#2e8b57' });

export const isSea = (rec) => rec !== undefined && SEA_CLASSES.includes(rec.t);
export const isCloud = (rec) => rec !== undefined && rec.cloud === true;
export const hasFeature = (rec, f) => Array.isArray(rec?.f) && rec.f.includes(f);

/** Human name of a hand-placed area id such as StrongholdOfTheGods. */
export const areaLabel = (area) => String(area).replace(/([a-z])([A-Z])/g, '$1 $2');

/** FNV-1a 32-bit over ASCII text, lower-case hex, 8 digits. */
export function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Hash of the live map's water layout: `q,r,w` lines sorted by q then r, joined with newlines. */
export function waterHash(hexes) {
  const lines = [...hexes]
    .sort((a, b) => a.q - b.q || a.r - b.r)
    .map((h) => `${h.q},${h.r},${h.isWater ? 1 : 0}`);
  return fnv1a(lines.join('\n'));
}

/** Compares the shipped table with the live map. Any failure means the mod runs in Relaxed mode. */
export function checkTable(table, live) {
  const reasons = [];
  const meta = table?.meta;
  if (!meta || !Array.isArray(table.hexes)) return { ok: false, reasons: ['table malformed'] };
  if (live.mapId !== meta.mapId) reasons.push(`map id ${live.mapId} differs from ${meta.mapId}`);
  if (live.hexes.length !== meta.hexCount) reasons.push(`hex count ${live.hexes.length} differs from ${meta.hexCount}`);
  const hash = waterHash(live.hexes);
  if (hash !== meta.waterHash) reasons.push(`water hash ${hash} differs from ${meta.waterHash}`);
  const known = new Set(table.hexes.map((h) => `${h.q},${h.r}`));
  const missing = live.hexes.filter((h) => !known.has(`${h.q},${h.r}`)).length;
  if (missing > 0) reasons.push(`${missing} live hexes missing from the table`);
  return { ok: reasons.length === 0, reasons };
}

/** Axial neighbour offsets (flat-top layout). */
export const NEIGHBOURS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

/** Numeric key for a hex: q in 0..1023, r in -512..511 (the AoD map is 32 x 45). */
export const hexKey = (q, r) => q * 1024 + (r + 512);

/**
 * Indexed view of the table, built once at load (about 0.2 ms for 944 hexes). Unknown hexes return undefined,
 * which every rule treats as "anywhere". Besides the coordinate map it keeps reverse indexes so phase 2 can
 * answer "hexes with feature X", "where is area Y" and "nearest hex for rule Z" without scanning the table.
 */
export function createTerrain(table) {
  const byKey = new Map();
  const byClass = new Map();
  const byFeature = new Map();
  const byPoi = new Map();
  const byArea = new Map();
  const byDungeon = new Map();
  const push = (map, k, rec) => { const list = map.get(k); if (list === undefined) map.set(k, [rec]); else list.push(rec); };
  for (const h of table.hexes) {
    byKey.set(hexKey(h.q, h.r), h);
    push(byClass, h.t, h);
    if (Array.isArray(h.f)) for (const f of h.f) push(byFeature, f, h);
    if (h.poi !== undefined) byPoi.set(h.poi, h);
    if (h.area !== undefined) push(byArea, h.area, h);
    if (h.dungeon !== undefined) byDungeon.set(h.dungeon, h);
  }
  // Places: game area id (combat area, slayer area, dungeon, stronghold) -> tagged hexes, via meta.areas (hand-placed
  // `area` names), meta.dungeons (`dungeon` names) and meta.poiAreas (POIs the game names areas after). A value
  // ending in ':*' (Into the Abyss) matches every id of that namespace.
  const byPlace = new Map();
  const wildcards = [];
  const place = (id, rec) => {
    if (id === undefined) return;
    if (id.endsWith(':*')) {
      let w = wildcards.find((x) => x.prefix === id.slice(0, -1));
      if (w === undefined) { w = { prefix: id.slice(0, -1), hexes: [] }; wildcards.push(w); }
      w.hexes.push(rec);
    } else push(byPlace, id, rec);
  };
  const meta = table.meta ?? {};
  for (const [, list] of byArea) for (const h of list) place(meta.areas?.[h.area], h);
  for (const [, h] of byDungeon) place(meta.dungeons?.[h.dungeon], h);
  if (meta.poiAreas !== undefined) for (const [poiName, id] of Object.entries(meta.poiAreas)) { const h = byPoi.get(poiName); if (h !== undefined) place(id, h); }

  // Landmasses: connected land (everything but water and shoal), numbered lazily on first use. The compass prefers
  // a target on the player's own landmass.
  let landmassOf;
  const landmasses = () => {
    if (landmassOf !== undefined) return landmassOf;
    landmassOf = new Map();
    let next = 0;
    for (const h of byKey.values()) {
      if (SEA_CLASSES.includes(h.t) || landmassOf.has(hexKey(h.q, h.r))) continue;
      const id = next++;
      const stack = [h];
      landmassOf.set(hexKey(h.q, h.r), id);
      while (stack.length > 0) {
        const cur = stack.pop();
        for (const [dq, dr] of NEIGHBOURS) {
          const n = byKey.get(hexKey(cur.q + dq, cur.r + dr));
          if (n === undefined || SEA_CLASSES.includes(n.t) || landmassOf.has(hexKey(n.q, n.r))) continue;
          landmassOf.set(hexKey(n.q, n.r), id);
          stack.push(n);
        }
      }
    }
    return landmassOf;
  };

  const none = [];
  return {
    meta: table.meta,
    size: byKey.size,
    get(q, r) { return byKey.get(hexKey(q, r)); },
    /** The six neighbouring records (fewer at the map edge). */
    neighbours(q, r) {
      const out = [];
      for (const [dq, dr] of NEIGHBOURS) { const n = byKey.get(hexKey(q + dq, r + dr)); if (n !== undefined) out.push(n); }
      return out;
    },
    /** Tagged hexes for a game area id; empty when the area is not on the map. */
    placesFor(areaId) {
      const direct = byPlace.get(areaId);
      if (direct !== undefined) return direct;
      const w = wildcards.find((x) => areaId.startsWith(x.prefix));
      return w === undefined ? none : w.hexes;
    },
    /** Landmass number of a land hex, undefined for sea. */
    landmass(q, r) { return landmasses().get(hexKey(q, r)); },
    all() { return byKey.values(); },
    withClass(cls) { return byClass.get(cls) ?? none; },
    withFeature(f) { return byFeature.get(f) ?? none; },
    poi(name) { return byPoi.get(name); },
    area(name) { return byArea.get(name) ?? none; },
    dungeon(name) { return byDungeon.get(name); },
  };
}

/** Axial hex distance. */
export function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Nearest hex (by hex distance) in `candidates` matching the predicate, excluding `from` itself. */
export function nearestIn(candidates, from, predicate = () => true) {
  let best;
  for (const rec of candidates) {
    if (!predicate(rec)) continue;
    const d = hexDistance(from, rec);
    if (d === 0) continue;
    if (best === undefined || d < best.distance) best = { hex: rec, distance: d };
  }
  return best;
}

/** Nearest table hex matching the predicate, scanning the whole table. Prefer nearestIn with an index. */
export function nearest(terrain, from, predicate) {
  return nearestIn(terrain.all(), from, predicate);
}

/**
 * Nearest KNOWN hex where `skillId` may start, using the class and feature indexes (a few hundred candidates
 * instead of 944) and a memo keyed by skill, hex and knowledge version. `knowledge` is { isKnown(rec), version }:
 * the version moves whenever the player learns a hex (survey, rumour, chart), which invalidates the memo.
 * Without a knowledge object every hex counts as known (tests, dev tools).
 */
export function candidatesFor(terrain, rules, skillId) {
  const terms = rules.ruleTerms(skillId);
  const seen = new Set();
  const out = [];
  const add = (rec) => { if (!seen.has(rec)) { seen.add(rec); out.push(rec); } };
  if (terms.land) { for (const rec of terrain.all()) if (!SEA_CLASSES.includes(rec.t)) add(rec); return out; }
  for (const cls of terms.classes) terrain.withClass(cls).forEach(add);
  for (const f of terms.features) terrain.withFeature(f).forEach(add);
  for (const p of terms.pois) { const rec = terrain.poi(p); if (rec !== undefined) add(rec); }
  for (const a of terms.areas) terrain.area(a).forEach(add);
  // grace: a hex next to a full-rate hex also works, so neighbours are candidates too
  if (rules.SKILL_RULES?.[skillId]?.grace !== undefined) for (const rec of [...out]) terrain.neighbours(rec.q, rec.r).forEach(add);
  return out;
}

/**
 * `opts` (strictness, neighbours) are passed to rules.allowedAt; `optsOf` lets the caller supply them live.
 */
export function createNearestFinder(terrain, rules, knowledge = { isKnown: () => true, version: 0 }, optsOf = () => undefined) {
  const memo = new Map();
  let memoVersion = knowledge.version;
  let memoOpts;
  return (skillId, from) => {
    const opts = optsOf();
    const optsKey = opts === undefined ? '' : String(opts.strictness);
    if (knowledge.version !== memoVersion || optsKey !== memoOpts) { memo.clear(); memoVersion = knowledge.version; memoOpts = optsKey; }
    const key = `${skillId}@${hexKey(from.q, from.r)}`;
    if (memo.has(key)) return memo.get(key);
    const found = nearestIn(candidatesFor(terrain, rules, skillId), from, (rec) => knowledge.isKnown(rec) && rules.allowedAt(skillId, rec, opts));
    memo.set(key, found);
    return found;
  };
}

/** Compass label from one hex to another, using the flat-top layout the AoD map uses. */
export function directionLabel(from, to) {
  const dq = to.q - from.q;
  const dr = to.r - from.r;
  const x = 1.5 * dq;
  const y = (Math.sqrt(3) / 2) * dq + Math.sqrt(3) * dr; // screen y grows downwards
  if (x === 0 && y === 0) return '';
  const angle = ((Math.atan2(-y, x) * 180) / Math.PI + 360) % 360; // 0 = E, 90 = N
  const labels = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
  return labels[Math.round(angle / 45) % 8];
}
