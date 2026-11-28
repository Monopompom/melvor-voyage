// Market pressure (round 6): selling a lot of one kind of goods at one market lowers its price for that kind, and the
// price comes back on the game clock. Pure: a market's depth, the pressure left at a time, the price multiplier, what
// a sale does to it, and the save's entries. The game side (the sale price patch, the Sell block line) is in
// src/market.mjs.
//
// A market keeps a pressure for each kind of goods: the ten market categories and one bucket for everything else
// (gear, drops, anything the markets don't list), so nothing sells untouched. Pressure is kept as a share of the
// market's depth (0 none, 1 full), like local supply's share of a day's worth, so a depth that grows with the Voyage
// level doesn't need the save rewritten. Selling a market's whole depth of one kind brings that kind to the floor; it
// never goes further, so a market is always back to its list price within a day (the user, 28 Nov 2026: "Half, back
// in 24 h").

/** The price never falls below this share of the market's list price (the user, 28 Nov 2026). */
export const FLOOR = 0.5;
/** Game-clock ms for a market at the floor to be back at its list price, linearly (the user, 28 Nov 2026). */
export const RECOVER_MS = 24 * 60 * 60 * 1000;
/**
 * A port's depth at Voyage level 0, in GP of base value (the game's sale price, before any percent). [BALANCE] Mine,
 * 28 Nov 2026: 24,000 GP at Voyage 1 and about 416,000 at 99 for a port, four times that at the Capital City.
 */
export const DEPTH_GP = 20000;
/** How much more a market takes than a port by its size (`sizeOf`). [BALANCE] */
export const SIZE = { port: 1, market: 1, farm: 1, city: 2, capital: 4 };
/** Voyage levels per depth's worth: depth × (1 + level / LEVEL_STEP). [BALANCE] */
export const LEVEL_STEP = 5;
/** The kinds a market keeps a pressure for: market-model.mjs CATEGORIES (kept in step by a test) and the rest. */
export const KINDS = ['fish', 'ore', 'logs', 'crops', 'herbs', 'runes', 'gems', 'bones', 'stardust', 'ash', 'other'];
export const OTHER = 'other';
/** The most entries a save keeps (as local supply): far more than markets × kinds. */
export const ENTRIES_MAX = 400;

/** The kind an item's market category falls in: the category itself, else the "other goods" bucket. */
export const kindOf = (category) => (KINDS.includes(category) && category !== OTHER ? category : OTHER);

/** A market's size from what its place is: the Capital City, a city, a farm, a market POI, else a port. */
export function sizeOf(place) {
  if (place?.capital === true) return 'capital';
  if (place?.city === true) return 'city';
  if (place?.farm === true) return 'farm';
  if (place?.port === true) return 'port';
  return 'market';
}

/** A market's depth in GP of base value: what one kind takes before its price is at the floor. */
export function depthOf(size, level) {
  const lv = Number.isFinite(level) ? Math.max(0, level) : 0;
  return DEPTH_GP * (SIZE[size] ?? SIZE.market) * (1 + lv / LEVEL_STEP);
}

/** The save key of a market's kind. */
export const keyOf = (market, kind) => `${market}|${kind}`;

/** The share of the depth still pressed at `now` (0 to 1); no entry: none. It drains linearly over RECOVER_MS. */
export function shareAt(entry, now) {
  if (entry === undefined || entry === null) return 0;
  const back = Math.max(0, (now - entry.at) / RECOVER_MS);
  return Math.max(0, Math.min(1, entry.s) - back);
}

/** The price multiplier of a pressed share: 1 at none, FLOOR at full. */
export const pressOf = (share) => 1 - (1 - FLOOR) * Math.max(0, Math.min(1, share));

/** The price multiplier at `now` for an entry (1 with no entry). */
export const pressAt = (entry, now) => pressOf(shareAt(entry, now));

/**
 * The average multiplier over a sale of `value` GP of base value starting from `share`: the stack presses the market
 * as it sells, so its last items fetch less than its first. Past the depth every item sells at the floor. A sale of
 * nothing reads the price as it stands.
 */
export function averagePress(share, value, depth) {
  const s0 = Math.max(0, Math.min(1, share));
  if (!(value > 0) || !(depth > 0)) return pressOf(s0);
  const x = value / depth;
  const s1 = Math.min(1, s0 + x);
  const a = s1 - s0;
  const sloped = a * (1 - (1 - FLOOR) * (s0 + s1) / 2);
  return (sloped + (x - a) * FLOOR) / x;
}

/** The entry after `value` GP of base value was sold at `now` against `depth`, never past full. */
export function sold(entry, value, depth, now) {
  const s = shareAt(entry, now);
  const more = value > 0 && depth > 0 ? value / depth : 0;
  return { s: Math.min(1, s + more), at: Math.floor(now) };
}

/** Game-clock ms from `now` until the kind is back at its list price (0 when it is). */
export const msUntilFull = (entry, now) => Math.ceil(shareAt(entry, now) * RECOVER_MS);

/** The entries still pressed at `now` (drained ones dropped: no entry is no pressure). */
export function pruned(entries, now) {
  const out = {};
  for (const [key, e] of Object.entries(entries ?? {})) if (shareAt(e, now) > 0) out[key] = e;
  return out;
}

const KEY = /^[\w]{1,64}\|(fish|ore|logs|crops|herbs|runes|gems|bones|stardust|ash|other)$/;
/**
 * The save's `market`: { p: { "market|kind": { s, at } } }, junk dropped, at most ENTRIES_MAX entries (the newest
 * kept: they are the ones still pressed).
 */
export function cleanPressure(raw) {
  const p = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw.p : undefined;
  const list = [];
  if (p !== null && typeof p === 'object' && !Array.isArray(p)) {
    for (const [key, e] of Object.entries(p)) {
      if (!KEY.test(key) || e === null || typeof e !== 'object' || !Number.isFinite(e.s) || !Number.isFinite(e.at) || e.at < 0) continue;
      const s = Math.max(0, Math.min(1, e.s));
      if (s > 0) list.push([key, { s, at: Math.floor(e.at) }]);
    }
  }
  list.sort((x, y) => y[1].at - x[1].at);
  return { p: Object.fromEntries(list.slice(0, ENTRIES_MAX)) };
}
