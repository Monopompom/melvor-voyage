// Events that ask (the flat mechanics, build .378): a stowaway found aboard, and what running from a band at sea costs. Each one is a
// choice with a cost either way, so a voyage asks something of the player beyond the GP. Pure: no game globals.

/**
 * Running from a band at sea throws this share of the hold's crates overboard, at least one when the hold holds any
 * (build .387). A fifth since build .403: the choice should cost either way, and at a tenth running was the cheaper
 * answer at every hold and every purse while the hull was sound.
 */
export const SEA_RUN_LOSS = 0.2;
/** Running at sea costs a stormy hex's wear (weather-model STORM_WEAR) and one more hex of sailing time. */
export const SEA_RUN_STORM = 3;

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

/** How many of `crates` in the hold go overboard on a run at sea: SEA_RUN_LOSS of them, rounded up (one of one). */
export const seaRunLoss = (crates) => (Number.isFinite(crates) && crates > 0 ? Math.ceil(crates * SEA_RUN_LOSS) : 0);

/** The hull wear of running at sea (%): a stormy deep-sea hex's (stores-model wearOf, a deep hex wearing `deepWear`). */
export const seaRunWear = (deepWear = 2) => (Number.isFinite(deepWear) && deepWear > 0 ? deepWear : 2) * SEA_RUN_STORM;

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

