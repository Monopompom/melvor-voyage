// Adrift (phase 5b part two; the canvas "Stranded at sea"): the rules. Pure: no
// game objects, tested in tests/adrift-model.test.mjs. The game side is src/adrift.mjs.
//
// You are adrift when you are aboard on a sea hex more than one hex from a coast your hull may land on and the next
// hex can't be paid: under one ration in the stores, or not the GP for it (or the hull stands beyond its reach, where
// the homeward rule's free moves used to carry it). It is a state in the save, not only a voyage ending. Three ways
// out: the drift (free, one hex every 30 min toward the coast, never onto a place), a tow (a passing ship to the
// nearest port you know, for the way's travel cost and half again) and fishing (each catch may bring a rescue).

const MIN = 60000;
/** One ration of the stores (stores-model RATION_HP; modules here can't import each other). */
export const RATION_HP = 20;
/** The drift: one hex every 30 min toward the coast (the user, 19 Oct 2026: "okay"). */
export const DRIFT_MS = 30 * MIN;
/** A tow by a passing ship sails at a brig's pace; the Friendly Fisherman's boat is slower. */
export const TOW_MS = 3 * MIN;
export const FISHER_MS = 4 * MIN;
/** The tow's price: the way's own travel cost and half again (the user: "calculated"). */
export const TOW_MARKUP = 1.5;
/** About one rescue an hour of fishing, each catch rolled by its interval as the rumours are (the user: "okay"). */
export const RESCUE_HOURS = 1;
/** A message in a bottle: its ship's home port, any port within this many sea hexes. */
export const BOTTLE_RANGE = 20;
/** The Sea Noodle drags you to a surveyed coast within this many hexes. */
export const NOODLE_RANGE = 15;
/** Why you are adrift: the stores, the purse, or a hull standing beyond its reach. */
export const CAUSES = ['food', 'gp', 'hull'];

/**
 * The map's own cast (board 3 of the canvas; the user: "will do"): weights out of 100. `art` is the rescue card's
 * portrait in assets/ (gen_assets.py, 112 px in the popup like the trader's), `ms` the pace of a tow, `take` the Pushy
 * Sailor's half.
 */
export const RESCUES = [
  { id: 'kraken', weight: 30, art: 'rescue_kraken.webp' },
  { id: 'fisherman', weight: 25, art: 'rescue_fisherman.webp', tow: true, ms: FISHER_MS },
  { id: 'bottle', weight: 20, art: 'rescue_bottle.webp', tow: true, ms: TOW_MS },
  { id: 'noodle', weight: 15, art: 'rescue_noodle.webp' },
  { id: 'pushy', weight: 10, art: 'rescue_pushy.webp', tow: true, ms: TOW_MS, take: true },
];
/** What may tow you: a paid tow, or one of the rescues that tow. */
export const TOW_KINDS = ['pay', ...RESCUES.filter((r) => r.tow).map((r) => r.id)];

/** The rescue a roll in [0, 1) picks, by weight. */
export function pickRescue(roll) {
  const total = RESCUES.reduce((a, r) => a + r.weight, 0);
  let x = (Number.isFinite(roll) ? Math.min(Math.max(roll, 0), 0.999999) : 0) * total;
  for (const r of RESCUES) { if (x < r.weight) return r; x -= r.weight; }
  return RESCUES[RESCUES.length - 1];
}
export const rescueOf = (id) => RESCUES.find((r) => r.id === id);

/** The chance of a rescue on one catch that took `intervalMs`: interval / an hour, so fast and slow fish pay the same. */
export const rescueChance = (intervalMs) => (Number.isFinite(intervalMs) && intervalMs > 0 ? Math.min(1, intervalMs / (RESCUE_HOURS * 3600000)) : 0);

/**
 * Why you are adrift, or undefined when you are not. `applies`: aboard on a sea hex more than one hex from a coast your
 * hull may land on, with the rules and timed travel on. `beyond`: the hull stands beyond its reach. `provisions`: the
 * setting (off, food never strands you). `stepGp`: the GP of the next hex toward the coast.
 */
export function causeOf({ applies, beyond = false, provisions = true, food = 0, gp = 0, stepGp = 0 }) {
  if (!applies) return undefined;
  if (beyond) return 'hull';
  if (provisions && !(food >= RATION_HP)) return 'food';
  if (Number.isFinite(stepGp) && gp < stepGp) return 'gp';
  return undefined;
}

/**
 * The drift's own map: hexes to drift from each sea hex to one next to the coast (0 there). The drift never ends on a
 * place (as the homeward rule), so places are walls, and a few hexes behind them (3,8 by the Deep Sea Ship) go the long
 * way round. `seas`: the sea hexes, cloud included; `home(rec)`: sea steps to a coast the hull may land on (seaIndex).
 * A place you stand on gets one more than its best neighbour, so you always drift off it. Returns rec -> hexes
 * (Infinity: no way, never on the real map).
 */
export function driftIndex(seas, { neighbours, home, isPlace = () => false, key }) {
  const dist = new Map();
  let frontier = [];
  for (const rec of seas) if (home(rec) === 1 && !isPlace(rec)) { dist.set(key(rec), 0); frontier.push(rec); }
  const sea = new Set(seas.map(key));
  for (let d = 1; frontier.length > 0; d++) {
    const next = [];
    for (const rec of frontier) {
      for (const n of neighbours(rec)) {
        const k = key(n);
        if (dist.has(k) || !sea.has(k) || isPlace(n) || !Number.isFinite(home(n))) continue;
        dist.set(k, d);
        next.push(n);
      }
    }
    frontier = next;
  }
  for (const rec of seas) {
    if (!isPlace(rec) || dist.has(key(rec))) continue;
    let b = Infinity;
    for (const n of neighbours(rec)) { const d = isPlace(n) ? undefined : dist.get(key(n)); if (d !== undefined && d + 1 < b) b = d + 1; }
    if (Number.isFinite(b)) dist.set(key(rec), b);
  }
  return (rec) => (rec == null ? Infinity : dist.get(key(rec)) ?? Infinity);
}

/**
 * The next hex of the drift from `here`: the neighbour with the fewest hexes left to drift (`left`, from driftIndex),
 * never a place; on a tie the lowest q, then r, so it is always the same. Undefined next to the coast (0 left) or when
 * no neighbour is nearer.
 */
export function driftTarget(here, neighbours, left, isPlace = () => false) {
  const h = left(here);
  if (!(h > 0)) return undefined;
  let best;
  for (const n of neighbours) {
    if (n == null || isPlace(n)) continue;
    const d = left(n);
    if (!(d < h) || !Number.isFinite(d)) continue;
    if (best === undefined || d < best.d || (d === best.d && (n.q < best.n.q || (n.q === best.n.q && n.r < best.n.r)))) best = { n, d };
  }
  return best?.n;
}

/** The tow's price for a way the game prices at `wayGp`: half again, rounded up. */
export const towPrice = (wayGp) => Math.ceil(Math.max(0, Number.isFinite(wayGp) ? wayGp : 0) * TOW_MARKUP);

/**
 * The sea way from `start` to the nearest of `goals` (a Map of key -> goal) over sea hexes, cloud and places
 * included (a passing ship goes where it likes): breadth first, so the fewest hexes. { path (start first), goal } or
 * undefined. `limit` stops the search beyond that many hexes. With `all`, every goal reached within `limit` instead:
 * [{ path, goal }] nearest first.
 */
export function seaWay(start, goals, { neighbours, isSea, key, limit = Infinity, all = false }) {
  const from = new Map([[key(start), null]]);
  let frontier = [start];
  const found = [];
  const pathTo = (rec) => { const p = []; let k = key(rec); let cur = rec; while (cur != null) { p.push(cur); cur = from.get(k); k = cur == null ? undefined : key(cur); } return p.reverse(); };
  const hit = (rec) => { const g = goals.get(key(rec)); if (g === undefined) return false; found.push({ path: pathTo(rec), goal: g }); return !all; };
  if (hit(start)) return found[0];
  for (let d = 1; frontier.length > 0 && d <= limit; d++) {
    const next = [];
    for (const rec of frontier) {
      for (const n of neighbours(rec)) {
        const k = key(n);
        if (from.has(k) || !isSea(n)) continue;
        from.set(k, rec);
        if (hit(n)) return found[0];
        next.push(n);
      }
    }
    frontier = next;
  }
  return all ? found : undefined;
}

/** The Pushy Sailor's share: half (rounded up) of each fish caught while adrift, never more than the bank holds. */
export function pushyTake(caught, bankQty = () => Infinity) {
  const out = {};
  for (const [id, n] of Object.entries(caught ?? {})) {
    const want = Math.ceil(Math.max(0, n) / 2);
    const take = Math.min(want, Math.max(0, Math.floor(bankQty(id))));
    if (take > 0) out[id] = take;
  }
  return out;
}

/** The surveyed coasts within reach of the Sea Noodle: sea hexes next to the coast, no places, `range` hexes at most. */
export function noodleSpots(here, candidates, { home, dist, isPlace = () => false, surveyed = () => true, range = NOODLE_RANGE }) {
  return candidates.filter((c) => c != null && !(c.q === here.q && c.r === here.r) && home(c) === 1 && !isPlace(c) && surveyed(c) && dist(here, c) <= range);
}

// ---- the state in the save (v16 `adrift`) ------------------------------------------------------------------------------
const isInt = (n) => Number.isInteger(n);
/**
 * The adrift state, or null: { q, r (where it began), why (CAUSES), since (ms), left (ticks to the next drift hex), of
 * (ticks of a drift hex), drifted (hexes drifted), fishMs (time spent fishing while adrift), caught ({ item id: count },
 * the fish caught while adrift, for the Pushy Sailor), name (the voyage it ended, '' none), pending (a rescue rolled on
 * a catch and not yet played, '' none) }.
 */
export function cleanAdrift(a) {
  if (a == null || typeof a !== 'object' || !isInt(a.q) || !isInt(a.r)) return null;
  const caught = {};
  if (a.caught != null && typeof a.caught === 'object') {
    for (const [id, n] of Object.entries(a.caught).slice(0, 200)) if (typeof id === 'string' && id.length < 200 && isInt(n) && n > 0) caught[id] = n;
  }
  return {
    q: a.q,
    r: a.r,
    why: CAUSES.includes(a.why) ? a.why : 'food',
    since: Number.isFinite(a.since) ? a.since : 0,
    left: isInt(a.left) && a.left > 0 ? a.left : 1,
    of: isInt(a.of) && a.of > 0 ? a.of : 1,
    drifted: isInt(a.drifted) && a.drifted >= 0 ? a.drifted : 0,
    fishMs: Number.isFinite(a.fishMs) && a.fishMs >= 0 ? a.fishMs : 0,
    caught,
    name: typeof a.name === 'string' ? a.name.slice(0, 200) : '',
    pending: RESCUES.some((r) => r.id === a.pending) ? a.pending : '',
  };
}

/**
 * How the last spell adrift ended, for the page's note until closed: { how: 'ashore' (the drift or the Sea Noodle put
 * you next to the coast) | 'clear' (you can pay your way again, or a setting lifted it), by (a rescue id, '' none), at
 * (ms), drifted (hexes), where (the hex's words), closed }.
 */
export function cleanAdriftEnd(e) {
  if (e == null || typeof e !== 'object') return null;
  const str = (s) => (typeof s === 'string' ? s.slice(0, 200) : '');
  return {
    how: ['ashore', 'clear'].includes(e.how) ? e.how : 'ashore',
    by: RESCUES.some((r) => r.id === e.by) ? e.by : '',
    at: Number.isFinite(e.at) ? e.at : 0,
    drifted: isInt(e.drifted) && e.drifted >= 0 ? e.drifted : 0,
    where: str(e.where),
    closed: e.closed === true,
  };
}
