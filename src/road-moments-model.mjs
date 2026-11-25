// Road moments (round 5): now and then a courier or a Folk walking alone brings you a small question from the road,
// through Worker Folks' moments (API v13 registerMoment), which keep the pace, the one open moment per Folk and the
// save. Pure: where on its road a Folk stands, and what each answer does to the road ahead. The game side
// (road-moments.mjs) reads the courier or the walk and writes the changed road back.

/** Each road moment's weight against every other moment (Worker Folks' own weigh 1): a third. [BALANCE] */
export const WEIGHT = 1 / 3;
/** The short cut: how many hexes it skips, the chance it works, and the hour lost when it doesn't. [BALANCE] */
export const SHORT_HEXES = 4;
export const SHORT_ODDS = 2 / 3;
export const LOST_MS = 3600 * 1000;
/** A skipped hex still takes this long, so it is entered (its food and its bands) like any other. */
export const QUICK_MS = 1000;
/** The farmhouse: offered below this share of max HP; a night's rest gives back this share and takes this long. [BALANCE] */
export const INN_BELOW = 0.75;
export const INN_HEAL = 0.3;
export const INN_MS = 3600 * 1000;
/** The lost traveller: walking them there costs this long and they pay this much. [BALANCE] */
export const GUIDE_MS = 3600 * 1000;
export const GUIDE_GP = 2500;
/**
 * Left unanswered (Worker Folks takes the cautious answer when a moment runs out), a moment costs a little: the short
 * cut and the lost traveller an hour lost waiting; the farmhouse a share of a courier's packed food spoiled, or one more
 * hex walked hungry by a Folk walking alone (an hour lost waiting with Provisions off). Never a load or a life. [BALANCE]
 */
export const IGNORED_MS = 3600 * 1000;
export const SPOIL_SHARE = 0.1;
export const SPOIL_HEXES = 1;
/** A courier's pack `{ food, fuel }` with SPOIL_SHARE of its food spoiled (whole food, fuel kept). */
export function spoil(pack) {
  if (pack == null || !Number.isFinite(pack.food)) return pack;
  return { ...pack, food: Math.max(0, Math.floor(pack.food * (1 - SPOIL_SHARE))) };
}

/** A hex never takes longer than this, whatever is added to it. */
const HEX_MAX_MS = 24 * 3600 * 1000;

/**
 * Where a courier stands on its road, `{ road, at }` with `at` the index of the hex it is walking into, or undefined
 * when it is not on a land leg it walks now: on a packet, held by a band, waiting for food at a bank stop or on the
 * way, retired, or at its leg's end.
 */
export function courierSpot(c) {
  if (c == null || !Array.isArray(c.road)) return undefined;
  if (c.crossing !== undefined || c.held !== undefined || c.packing === true || c.topping === true || c.retired === true) return undefined;
  if (!(Number.isInteger(c.reached) && c.reached >= 0 && c.reached < c.road.length)) return undefined;
  return { road: c.road, at: c.reached };
}

/** Where a walk stands at `now` (`walkAt` from walk-model), `{ road, at }`, or undefined when held or arrived. */
export function walkSpot(w, now, walkAt) {
  if (w == null || !Array.isArray(w.road) || Number.isFinite(w.held)) return undefined;
  const { reached, done } = walkAt(w, now);
  if (done || !(reached < w.road.length)) return undefined;
  return { road: w.road, at: reached };
}

/** Hexes on the road after the one being walked into. */
export const hexesAhead = (spot) => (spot === undefined ? 0 : Math.max(0, spot.road.length - spot.at - 1));

/** The road with the `k` hexes after the one being walked into taking QUICK_MS each (never longer than they took). */
export function quicken(road, at, k = SHORT_HEXES) {
  return road.map((s, i) => (i > at && i <= at + k ? { ...s, ms: Math.min(s.ms, QUICK_MS) } : s));
}

/** The road with `ms` more on the hex being walked into (at most HEX_MAX_MS for the hex). */
export function slow(road, at, ms) {
  const more = Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0;
  return road.map((s, i) => (i === at ? { ...s, ms: Math.min(HEX_MAX_MS, s.ms + more) } : s));
}

/** The short cut taken: `{ road, won }`, `rand()` in [0, 1). Won: the next hexes skipped; lost: an hour more. */
export function shortCut(spot, rand = Math.random) {
  const won = rand() < SHORT_ODDS;
  return { road: won ? quicken(spot.road, spot.at) : slow(spot.road, spot.at, LOST_MS), won };
}

/** Whether a Folk at `hp` of `maxHp` is hurt enough for the farmhouse's offer. */
export const hurt = (hp, maxHp) => maxHp > 0 && Number.isFinite(hp) && hp < maxHp * INN_BELOW;
/** The HP a night at the farmhouse gives back: whole HP, never past max. */
export function innHeal(hp, maxHp) {
  if (!(maxHp > 0)) return 0;
  const now = Number.isFinite(hp) ? Math.max(0, Math.min(hp, maxHp)) : maxHp;
  return Math.max(0, Math.min(maxHp - now, Math.max(1, Math.round(maxHp * INN_HEAL))));
}
