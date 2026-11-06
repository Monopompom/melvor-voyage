// Folks hold what they make (the haul, with Worker Folks' room): a Folk away from a bank place keeps its output and its
// purse in its own room and works from the inputs in it, stopping "Haul full" or "Out of inputs" while its wages run.
// You collect when you stand within a hex of it, and restock it by hand. Worker Folks owns the room; Voyage only says
// where the bank is at hand and when to collect, restock or empty it. Pure: the access rule, who to collect from, what a
// Folk's move means for its room, and the collection's summary. The game side is src/haul.mjs. Like every module here
// it imports nothing: the trade-place rule and the hex distance come in.

/** The Worker Folks API version that has the room's hooks (bank access, room, collect, restock, empty, the events). */
export const HAUL_API = 10;

/** How far you can be from a Folk to collect its haul or restock it: on its hex or the next one. */
export const REACH = 1;

/**
 * A bank place: a hex that trades (a city, capital, port or market), or one next to it, as the trade rule has it. A
 * Folk there works with your bank, as it does without Voyage. `rec` is the Folk's record, `neighbours` the records
 * around it (every one: a Folk's hex is ground it stands on, not a place you have to know), `isTradePlace` the rule.
 */
export function isBankPlace(rec, neighbours, isTradePlace) {
  if (rec === undefined || typeof isTradePlace !== 'function') return true;
  if (isTradePlace(rec)) return true;
  return Array.isArray(neighbours) && neighbours.some((n) => isTradePlace(n));
}

/**
 * What a Folk uses: 'bank' or 'room'. `on` is the haul turned on (the setting, the rules, Voyage's map trusted).
 * A Folk with you, walking, or with no place uses the bank's rule (it works nowhere meanwhile); a Folk on a hex the map
 * doesn't know uses the bank too (it fails open). `recordAt(place)` gives the record, `neighboursOf(rec)` the records
 * around it.
 */
export function accessFor(folk, { on, recordAt, neighboursOf, isTradePlace }) {
  if (on !== true || folk == null || folk.travel !== 'idle' || folk.place == null) return 'bank';
  const rec = recordAt?.(folk.place);
  if (rec === undefined) return 'bank';
  return isBankPlace(rec, neighboursOf?.(rec) ?? [], isTradePlace) ? 'bank' : 'room';
}

/** True when a room view holds anything to collect: items in the haul or a purse. */
export function hasHaul(room) {
  if (room == null) return false;
  const items = Array.isArray(room.haul) ? room.haul.some((s) => (s?.qty ?? 0) > 0) : false;
  const purse = Array.isArray(room.purse) ? room.purse.some((p) => (p?.amount ?? 0) > 0) : false;
  return items || purse;
}

/**
 * The Folks to collect from where you stand: idle on a hex within REACH of `pos`, nearest first, then by slot. `rooms`
 * maps a Folk id to its room view (undefined: no room to read). Folks with nothing to collect are left out.
 */
export function collectFrom(folks, pos, { distance, rooms }) {
  if (pos == null || !Array.isArray(folks) || typeof distance !== 'function') return [];
  return folks
    .filter((f) => f?.travel === 'idle' && f.place != null && distance(pos, f.place) <= REACH && hasHaul(rooms?.(f.id)))
    .sort((a, b) => distance(pos, a.place) - distance(pos, b.place) || (a.slot ?? 0) - (b.slot ?? 0));
}

/**
 * What a Folk's change means for its room. `before` and `after` are { travel, access } (access from accessFor).
 * - 'empty': it came aboard with you (you are there), or it reached a bank place: everything to the bank but the stock
 *   of a Folk on its own stock (Worker Folks keeps that by the inputs flag).
 * - undefined: nothing to do (a walk takes its room along, a Folk that stays in the wild keeps it).
 */
export function lifeStep(before, after) {
  if (after == null) return undefined;
  if (after.travel === 'with' && before?.travel !== 'with') return 'empty';
  if (after.travel === 'idle' && after.access === 'bank' && before?.access === 'room') return 'empty';
  return undefined;
}

/**
 * One summary of several collections: { items: [{ itemId, qty }], left: [{ itemId, qty }], purse: [{ currencyId,
 * amount }], folks: n }, each kind once, the biggest first. `results` are collect() answers ({ items, left, purse }).
 */
export function mergeCollected(results) {
  const add = (map, key, n) => { if (typeof key === 'string' && n > 0) map.set(key, (map.get(key) ?? 0) + n); };
  const items = new Map();
  const left = new Map();
  const purse = new Map();
  let folks = 0;
  for (const r of results ?? []) {
    if (r == null) continue;
    let any = false;
    for (const s of r.items ?? []) { add(items, s?.itemId, s?.qty ?? 0); any = any || (s?.qty ?? 0) > 0; }
    for (const s of r.left ?? []) add(left, s?.itemId, s?.qty ?? 0);
    for (const p of r.purse ?? []) { add(purse, p?.currencyId, p?.amount ?? 0); any = any || (p?.amount ?? 0) > 0; }
    if (any) folks += 1;
  }
  const list = (map, k, v) => [...map.entries()].sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ [k]: key, [v]: n }));
  return { items: list(items, 'itemId', 'qty'), left: list(left, 'itemId', 'qty'), purse: list(purse, 'currencyId', 'amount'), folks };
}

/** True when a merged summary brought nothing in and left nothing behind. */
export const emptySummary = (m) => m == null || (m.items.length === 0 && m.left.length === 0 && m.purse.length === 0);

/**
 * The marker a Folk's room puts on the map: 'full' (stopped, the haul has no room for the next action), 'dry' (out of
 * inputs) or undefined. Only a room that works from the room, not one at a bank place.
 */
export function roomMark(room) {
  if (room == null || room.access !== 'room') return undefined;
  return room.state === 'full' || room.state === 'dry' ? room.state : undefined;
}

/** How full a room is, 0 to 1, from its view ({ sizeMs, usedMs }); 0 for a room of no size. */
export function fillShare(room) {
  const size = Number(room?.sizeMs) || 0;
  if (size <= 0) return 0;
  return Math.max(0, Math.min(1, (Number(room?.usedMs) || 0) / size));
}
