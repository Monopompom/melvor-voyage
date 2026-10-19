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
