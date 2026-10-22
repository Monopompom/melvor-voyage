// Events that ask (the flat mechanics, build .378): pirates on the open sea, and a stowaway found aboard. Each one is a
// choice with a cost either way, so a voyage asks something of the player beyond the GP. Pure: no game globals.

/** Pirates meet the big ship on a deep-sea hex it sails into on a timed voyage: one hex in PIRATE_CHANCE. */
export const PIRATE_CHANCE = 1 / 120;
/** Paying them off: this share of the hold's worth in GP… */
export const PIRATE_SHARE = 0.25;
/** …but never less than the GP of this many hexes as the game charges them (an empty hold is no way out)… */
export const PIRATE_FLOOR_HEXES = 3;
/** …nor less than this share of the GP you carry (build .387, the user: at a 5 billion purse the toll was 1,419 GP, a non-event). */
export const PIRATE_COIN_SHARE = 0.005;
/** Running throws this share of the hold's crates overboard, at least one when the hold holds any (build .387). */
export const PIRATE_RUN_LOSS = 0.1;
/** Running before the wind costs a stormy hex's wear (weather-model STORM_WEAR) and one more hex of sailing time. */
export const PIRATE_RUN_STORM = 3;
/** Offline the choice is made for you: run while the hull stays at least this sound after the run's wear (ship-model WORN_COND). */
export const PIRATE_SOUND = 50;

/** A stowaway climbs out on one voyage in STOWAWAY_CHANCE, with Worker Folks, at sea, in a vessel with a berth free. */
export const STOWAWAY_CHANCE = 1 / 8;
/** Only on a voyage with at least this many sea hexes: it hid aboard for a long crossing. */
export const STOWAWAY_MIN_SEA = 6;
/** It joins as the lowest rank… */
export const STOWAWAY_TIER = 'Newbie';
/**
 * …for this share of the Shop's price: a bargain only while it is aboard, and it still counts as a hire (the Shop's
 * next one costs more). It eats from the stores until hired or put ashore.
 */
export const STOWAWAY_PRICE_SHARE = 0.5;
/** Names a stowaway may give (a Folk keeps it when hired). */
export const STOWAWAY_NAMES = ['Pip', 'Bram', 'Wren', 'Tam', 'Moss', 'Nell', 'Fen', 'Kit', 'Rook', 'Dot'];

/** Whether pirates meet a step: the big ship, sailing (not towed, not free) into a deep-sea hex, and the roll under the chance. */
export function piratesMeet(step, roll) {
  if (step == null || step.vessel !== 'ship' || step.sea !== true || step.deep !== true || step.free === true || step.fastTravel === true) return false;
  return Number.isFinite(roll) && roll >= 0 && roll < PIRATE_CHANCE;
}

/** What paying them off costs: the most of PIRATE_SHARE of the hold's worth, PIRATE_FLOOR_HEXES hexes' GP and PIRATE_COIN_SHARE of `gp` carried; whole GP. */
export function pirateToll(holdWorth, hexGp, gp = 0) {
  const worth = Number.isFinite(holdWorth) && holdWorth > 0 ? holdWorth : 0;
  const hex = Number.isFinite(hexGp) && hexGp > 0 ? hexGp : 0;
  const coin = Number.isFinite(gp) && gp > 0 ? gp : 0;
  return Math.max(1, Math.round(Math.max(worth * PIRATE_SHARE, hex * PIRATE_FLOOR_HEXES, coin * PIRATE_COIN_SHARE)));
}
/** How many of `crates` in the hold go overboard on a run: PIRATE_RUN_LOSS of them, rounded up (one of one). */
export const pirateRunLoss = (crates) => (Number.isFinite(crates) && crates > 0 ? Math.ceil(crates * PIRATE_RUN_LOSS) : 0);

/** The hull wear of running (%): a stormy deep-sea hex's (stores-model wearOf, a deep hex wearing `deepWear`). */
export const pirateRunWear = (deepWear = 2) => (Number.isFinite(deepWear) && deepWear > 0 ? deepWear : 2) * PIRATE_RUN_STORM;

/**
 * The choice made for you offline: 'run' while the hull stays at least PIRATE_SOUND after the run's wear, else 'pay'
 * when the GP covers the toll, else 'run' all the same.
 */
export function pirateChoice({ cond, wear, gp, toll }) {
  const c = Number.isFinite(cond) ? cond : 0;
  if (c - (Number.isFinite(wear) ? wear : 0) >= PIRATE_SOUND) return 'run';
  return Number.isFinite(gp) && Number.isFinite(toll) && gp >= toll ? 'pay' : 'run';
}

/** The hull after running: never below 0. */
export const condAfterRun = (cond, wear) => Math.max(0, (Number.isFinite(cond) ? cond : 0) - (Number.isFinite(wear) ? wear : 0));

/**
 * Where a stowaway climbs out on a voyage, or -1 for none: `sea` lists the walk indexes of its sea hexes (in order),
 * `rolls` two numbers in [0, 1): whether one hid aboard, then which hex. It is found within the first half of the sea
 * hexes, never on the first two (you would have seen it at the quay).
 */
export function stowawayAt(sea, rolls) {
  const list = Array.isArray(sea) ? sea.filter((i) => Number.isInteger(i) && i > 0) : [];
  const [a, b] = Array.isArray(rolls) ? rolls : [];
  if (list.length < STOWAWAY_MIN_SEA || !(Number.isFinite(a) && a >= 0 && a < STOWAWAY_CHANCE)) return -1;
  const from = 2;
  const to = Math.max(from + 1, Math.floor(list.length / 2));
  const k = from + Math.floor((Number.isFinite(b) && b >= 0 && b < 1 ? b : 0) * (to - from));
  return list[Math.min(k, list.length - 1)];
}

/** What hiring it costs when the Shop asks `full` GP: STOWAWAY_PRICE_SHARE of it, rounded up; undefined without a price. */
export const stowawayPrice = (full) => (Number.isFinite(full) && full >= 0 ? Math.ceil(full * STOWAWAY_PRICE_SHARE) : undefined);

/** A stowaway's name from a roll in [0, 1), not one already taken by a Folk. */
export function stowawayName(roll, taken = []) {
  const free = STOWAWAY_NAMES.filter((n) => !taken.includes(n));
  const names = free.length > 0 ? free : STOWAWAY_NAMES;
  const r = Number.isFinite(roll) && roll >= 0 && roll < 1 ? roll : 0;
  return names[Math.floor(r * names.length)];
}

/**
 * The Voyage save's `events` (save v23): the stowaway aboard ({ name, v?: the vessel it hides in, ask?: true while it
 * was found offline and has not asked yet; build .386 }) or null.
 */
export function cleanEvents(raw) {
  const src = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const s = src.stow;
  const stow = s !== null && typeof s === 'object' && typeof s.name === 'string' && s.name !== '' ? { name: s.name.slice(0, 40) } : null;
  if (stow !== null) {
    if (s.v === 'boat' || s.v === 'ship') stow.v = s.v;
    if (s.ask === true) stow.ask = true;
  }
  return { stow };
}

