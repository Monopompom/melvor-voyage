// Weather (phase 5c; the canvas "Voyage 5c: Weather", settled 19 Oct 2026): the season read from
// Township, a temperature per hex, five bands that turn degrees into cost and time on land, the Fall harvest, the rare
// seasons and the winter ice round the Snowlands. Pure: no game objects, tested in tests/weather-model.test.mjs. The
// game side is src/weather.mjs.
//
// Nothing here follows the hour of the day (the fairness rule of 4.23): a Township season is 72 hours of game time,
// run offline too, the same for every playing schedule.

/**
 * Township's seasons by their `order` (melvorFull data, v1.3.1): the four of the year, then the rare ones a town's
 * worship can bring (Nightfall, Solar Eclipse, Lemon; Eternal Darkness from Into the Abyss). A character with no town
 * stays in Spring.
 */
export const SEASONS = ['spring', 'summer', 'fall', 'winter', 'nightfall', 'eclipse', 'lemon', 'darkness'];
export const SPRING = 0;
export const WINTER = 3;
export const FALL = 2;
/** The season's key ('spring' .. 'darkness'); an unknown order reads as Spring. */
export const seasonKey = (order) => SEASONS[order] ?? SEASONS[SPRING];

/** Degrees added to every hex by the season. The rare seasons keep Spring's degrees. */
export const SHIFT = { spring: 0, summer: 8, fall: -4, winter: -12 };
export const shiftOf = (order) => SHIFT[seasonKey(order)] ?? 0;

/**
 * Each ground's degrees in Spring (placeholders, the canvas's board 1). Set so the bands bite where the ground already
 * says so: Badlands stop a degree short of scorching in Summer, the Cursedlands well short of bitter in Winter.
 */
export const BASE = {
  snowlands: -8,
  mountain: -4,
  cursedlands: 4,
  highlands: 6,
  grasslands: 14,
  kingslands: 14,
  swamplands: 18,
  beach: 20,
  wastelands: 22,
  badlands: 26,
  desert: 28,
  lavalands: 32,
  water: 10,
  shoal: 12,
};
const SEA = ['water', 'shoal'];
/** A hex's degrees: its ground's base plus the season's shift. A ground the table does not know reads as grasslands. */
export const tempOf = (cls, order) => (BASE[cls] ?? BASE.grasslands) + shiftOf(order);

/**
 * The five bands (revised 19 Oct 2026 after the user's "more effects at winter and summer, some at spring and fall"):
 * the highest degree each holds, and what it does to a land hex. `fuel` multiplies the hex's fuel, `rations` adds
 * rations (20 HP each), `time` multiplies a timed hex. The bands touch land only: there is no fire aboard.
 */
export const BANDS = [
  { id: 'bitter', upTo: -15, fuel: 1.5, rations: 0, time: 1.25 },
  { id: 'cold', upTo: 0, fuel: 1.25, rations: 0, time: 1 },
  { id: 'mild', upTo: 19, fuel: 1, rations: 0, time: 1 },
  { id: 'warm', upTo: 34, fuel: 0.75, rations: 0, time: 1 },
  { id: 'scorching', upTo: Infinity, fuel: 0.75, rations: 1, time: 1.25 },
];
export const bandOf = (t) => BANDS.find((b) => t <= b.upTo) ?? BANDS[BANDS.length - 1];

/** Night all season (4.23's light and the stars' XP at any hour): Nightfall, Solar Eclipse, Eternal Darkness. */
export const ALL_NIGHT = ['nightfall', 'eclipse', 'darkness'];
export const allNight = (order) => ALL_NIGHT.includes(seasonKey(order));
/** Lemon season: rations at sea go a quarter further (lemons against scurvy). */
export const LEMON_SEA_FOOD = 0.75;

/** No weather at all: what a step carries with the setting off. */
export const NONE = Object.freeze({ t: undefined, band: 'mild', fuel: 1, rations: 0, time: 1, seaFood: 1 });

/**
 * What the weather does to one hex in `order`'s season: { t (degrees), band, fuel, rations, time, seaFood }. A sea hex
 * keeps its degrees for the panel but pays nothing for them; in Lemon season its rations go further (`seaFood`).
 */
export function effectsOf(cls, order) {
  const t = tempOf(cls, order);
  if (SEA.includes(cls)) return { t, band: bandOf(t).id, fuel: 1, rations: 0, time: 1, seaFood: seasonKey(order) === 'lemon' ? LEMON_SEA_FOOD : 1 };
  const b = bandOf(t);
  return { t, band: b.id, fuel: b.fuel, rations: b.rations, time: b.time, seaFood: 1 };
}
/** True when `wx` changes nothing (a mild hex outside Lemon season), so a step need not carry it. */
export const isPlain = (wx) => wx == null || (wx.fuel === 1 && wx.rations === 0 && wx.time === 1 && wx.seaFood === 1);

/** The Fall harvest: food loads a quarter better wherever food loads at all (50% -> 75%, 75% -> 100%). */
export const HARVEST = 0.25;
export function harvestRates(rates, order) {
  if (rates === undefined || seasonKey(order) !== 'fall' || !(rates.food > 0)) return rates;
  return { ...rates, food: Math.min(1, rates.food + HARVEST), harvest: rates.food < 1 };
}

/**
 * The season after `order` as Township turns it when no rare season comes (Township.tickSeason, v1.3.1): the year goes
 * on, and a rare season gives way to the one after the season it interrupted (`prevOrder`).
 */
export function nextOrder(order, prevOrder) {
  let i = Number.isInteger(order) ? order : SPRING;
  if (i > WINTER) i = Number.isInteger(prevOrder) && prevOrder <= WINTER ? prevOrder : SPRING;
  return i < WINTER ? i + 1 : SPRING;
}

// ---- the winter ice ------------------------------------------------------------------------------------------------

/** The ice reaches this many hexes out from the Snowlands (the user: "two hexes, whole Winter"). */
export const ICE_REACH = 2;
export const iceOn = (order) => seasonKey(order) === 'winter';

/**
 * The sea hexes that freeze in Winter: every sea hex within ICE_REACH of the Snowlands, cloud included (a cloud hex
 * stays cloud: the record keeps its flag). `hexes`: every record; `neighbours(rec)`: its neighbouring records.
 * Returns the records, in table order. On the real map: 62 hexes, and the two between the mainland and Frost Island.
 */
export function iceHexes(hexes, neighbours) {
  const list = [...hexes];
  let ring = new Set(list.filter((h) => h.t === 'snowlands'));
  const seen = new Set(ring);
  const ice = new Set();
  for (let d = 0; d < ICE_REACH; d++) {
    const next = new Set();
    for (const h of ring) for (const n of neighbours(h)) {
      if (seen.has(n) || !SEA.includes(n.t)) continue;
      seen.add(n);
      ice.add(n);
      next.add(n);
    }
    ring = next;
  }
  return list.filter((h) => ice.has(h));
}

/**
 * A sea record frozen over: ground like the Snowlands (its cost, its time, its degrees, walked on foot, no ship
 * enters), marked `ice` with the sea class it had in `was`. Place, features and coordinates are kept.
 */
export const icedRecord = (rec) => ({ ...rec, t: 'snowlands', ice: true, was: rec.t });

/**
 * The thaw under someone on foot (Spring after Winter): the shortest way ashore from `start` over the sea, to the
 * nearest hex that is neither sea nor cloud. `recOf(q, r)` gives the record (the thawed one), `neighbours(rec)` its
 * neighbours. Returns the records from the start to the shore, or undefined when `start` is not on the sea or no
 * shore is found within `limit` steps.
 */
export function wayAshore(start, neighbours, limit = 6) {
  if (start === undefined || !SEA.includes(start.t)) return undefined;
  const prev = new Map([[start, null]]);
  let ring = [start];
  for (let d = 0; d < limit && ring.length > 0; d++) {
    const next = [];
    for (const h of ring) for (const n of neighbours(h)) {
      if (prev.has(n) || n.cloud === true) continue;
      prev.set(n, h);
      if (!SEA.includes(n.t)) {
        const path = [n];
        for (let p = h; p !== null; p = prev.get(p)) path.unshift(p);
        return path;
      }
      next.push(n);
    }
    ring = next;
  }
  return undefined;
}

// ---- the wind (phase 5c-2) ------------------------------------------------------------------------------------------
// One wind over the whole sea, from one of the six hex sides, turning every 6 hours of game time by at most one side
// (the canvas's board 3, settled 19 Oct 2026). It changes only how long a sea hex takes, never what it costs. The roll
// is seeded per character and follows game time, so online and offline meet the same winds and the Set off popup knows
// the winds ahead: its time is exact.

/** The six sides of a flat-top hex, clockwise from the north (the side a wind comes from, or a step heads to). */
export const WIND_SIDES = ['N', 'NE', 'SE', 'S', 'SW', 'NW'];
/** The wind holds for 6 hours of game time, then turns a side either way or holds again. */
export const WIND_TURN_MS = 6 * 3600000;
/** Where the turns are counted from (any fixed moment; 1 Jan 2026 UTC). */
export const WIND_ORIGIN = Date.UTC(2026, 0, 1);
/** A sea hex's time by how its heading meets the wind: with it, broad (60° off), close (120°), against it. */
export const WIND_GAPS = ['with', 'broad', 'close', 'against'];
export const WIND_FACTORS = [0.7, 0.85, 1.15, 1.4];
/** Small boats (the dinghy and the longboat, rowed or with a short mast) feel half of it (the user: "half for small boats"). */
export const SMALL_WIND = 0.5;

/** A seed for a new character: a whole number from 1 to 2^31 - 1 (`rand`: a function giving [0, 1)). */
export const newWindSeed = (rand = Math.random) => 1 + Math.floor(rand() * 0x7ffffffe);
/** A deterministic number in [0, 1) for a seed and a turn (a 32-bit integer hash). */
export function windRoll(seed, k) {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(k | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}
/** The turn a moment falls in (0 at WIND_ORIGIN; moments before it count as turn 0). */
export const windTurn = (ms) => Math.max(0, Math.floor((ms - WIND_ORIGIN) / WIND_TURN_MS));
/** When the turn after the one `ms` falls in begins. */
export const nextWindTurnAt = (ms) => WIND_ORIGIN + (windTurn(ms) + 1) * WIND_TURN_MS;

/**
 * A character's winds: `at(ms)` the side (index into WIND_SIDES) the wind blows from at that moment. Turn 0 rolls a
 * side; each turn after holds, or turns one side either way, a third each. Memoised: the last turn asked is kept, and
 * a later one walks on from it.
 */
export function createWind(seed) {
  let k0 = 0;
  let side0 = Math.floor(windRoll(seed, 0) * 6) % 6;
  const first = side0;
  const at = (ms) => {
    const k = windTurn(ms);
    if (k < k0) { k0 = 0; side0 = first; }
    while (k0 < k) {
      k0 += 1;
      const r = windRoll(seed, k0);
      side0 = (side0 + (r < 1 / 3 ? 5 : r < 2 / 3 ? 0 : 1)) % 6;
    }
    return side0;
  };
  return { seed, at };
}

/**
 * The side a step heads to, from its axial offset (dq, dr) in the flat-top layout (terrain.mjs NEIGHBOURS: (0,-1) is
 * N, (1,-1) NE, (1,0) SE, (0,1) S, (-1,1) SW, (-1,0) NW). A longer offset (a fast-travel hop) takes the nearest side.
 * Undefined for no offset.
 */
export function headingOf(dq, dr) {
  const x = 1.5 * dq;
  const y = (Math.sqrt(3) / 2) * dq + Math.sqrt(3) * dr; // screen y grows downwards
  if (x === 0 && y === 0) return undefined;
  const angle = (Math.atan2(-y, x) * 180) / Math.PI; // 0 = E, 90 = N
  return (((Math.round((90 - angle) / 60) % 6) + 6) % 6);
}
/** How a heading meets the wind from `from`: 0 with it (heading downwind) to 3 against it. */
export function windGap(from, heading) {
  const d = Math.abs((((heading - (from + 3)) % 6) + 6) % 6);
  return Math.min(d, 6 - d);
}
/** The time factor of a sea step heading `heading` in the wind from `from`; `small` boats feel half of it. */
export function windFactor(from, heading, small = false) {
  if (!Number.isInteger(from) || !Number.isInteger(heading)) return 1;
  const f = WIND_FACTORS[windGap(from, heading)];
  return small ? 1 + (f - 1) * SMALL_WIND : f;
}
