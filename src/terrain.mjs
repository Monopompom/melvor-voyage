// Pure terrain-table helpers: no game globals, covered by tests/terrain.test.mjs.
// The table is data/hex_terrain.json.

export const CLASSES = ['water', 'grassland', 'forest', 'mountain', 'desert', 'beach', 'snow', 'badlands', 'cursed', 'cloud'];
export const FEATURES = ['river', 'swamp'];

/** Display label and PIXI tint per class. Water is never tinted: the data package owns it. */
export const CLASS_INFO = {
  water: { label: 'Water', colour: undefined, css: '#1e90ff' },
  grassland: { label: 'Grassland', colour: 0x7fff00, css: '#7fff00' },
  forest: { label: 'Forest', colour: 0x006400, css: '#006400' },
  mountain: { label: 'Mountain', colour: 0x9c6b3c, css: '#9c6b3c' },
  desert: { label: 'Desert', colour: 0xffd700, css: '#ffd700' },
  beach: { label: 'Beach', colour: 0xfff8c0, css: '#fff8c0' },
  snow: { label: 'Snow', colour: 0xffffff, css: '#ffffff' },
  badlands: { label: 'Badlands', colour: 0xff4500, css: '#ff4500' },
  cursed: { label: 'Cursed', colour: 0xc020ff, css: '#c020ff' },
  cloud: { label: 'Cloud', colour: 0x404040, css: '#404040' },
};
export const FEATURE_INFO = {
  river: { label: 'River' },
  swamp: { label: 'Swamp' },
};

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

/** Indexed view of the table. Unknown hexes return undefined, which every rule treats as "anywhere". */
export function createTerrain(table) {
  const byKey = new Map();
  for (const h of table.hexes) byKey.set(`${h.q},${h.r}`, h);
  return {
    meta: table.meta,
    size: byKey.size,
    get(q, r) { return byKey.get(`${q},${r}`); },
    all() { return byKey.values(); },
  };
}

/** Axial hex distance. */
export function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Nearest table hex (by hex distance) matching the predicate, excluding `from` itself. */
export function nearest(terrain, from, predicate) {
  let best;
  for (const rec of terrain.all()) {
    if (!predicate(rec)) continue;
    const d = hexDistance(from, rec);
    if (d === 0) continue;
    if (best === undefined || d < best.distance) best = { hex: rec, distance: d };
  }
  return best;
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
