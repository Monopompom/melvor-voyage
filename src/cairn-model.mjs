// Cairns (round 5): a Folk that dies on the road leaves everything it had (its load or room, its purse, its gear) on
// the hex where it died, under a pile of stones, until you come and collect it. A band's kill leaves its cairn guarded
// by that band. Worker Folks hands the goods over through its death keeper; the cairn is kept in Voyage's save
// (v34). Pure: no game globals.

/** Cairns a save keeps at most; a new one past it sends the oldest unguarded one (else the oldest) to the bank. */
export const CAIRNS_MAX = 20;
/** Item stacks one cairn keeps at most (a Folk's gear and room hold far fewer). */
export const CAIRN_ITEMS_MAX = 400;

const int = (n) => Number.isInteger(n);
const word = (x, max = 40) => typeof x === 'string' && x.length > 0 && x.length <= max && /^[\w]+$/.test(x);
const itemId = (x) => typeof x === 'string' && x.length > 0 && x.length <= 120 && /^[\w]+:[\w]+$/.test(x);

/** Stacks merged by id, positive whole quantities only, in first-seen order. */
function mergeItems(list) {
  const out = new Map();
  for (const x of Array.isArray(list) ? list : []) {
    const id = x?.id ?? x?.itemId;
    const qty = x?.qty;
    if (!itemId(id) || !int(qty) || qty <= 0) continue;
    out.set(id, Math.min((out.get(id) ?? 0) + qty, Number.MAX_SAFE_INTEGER));
  }
  return [...out.entries()].slice(0, CAIRN_ITEMS_MAX).map(([id, qty]) => ({ id, qty }));
}
/** Currencies merged by id, positive amounts only. */
function mergePurse(list) {
  const out = new Map();
  for (const x of Array.isArray(list) ? list : []) {
    const id = x?.id ?? x?.currencyId;
    const amount = x?.amount;
    if (!itemId(id) || !Number.isFinite(amount) || amount <= 0) continue;
    out.set(id, (out.get(id) ?? 0) + Math.floor(amount));
  }
  return [...out.entries()].filter(([, amount]) => amount > 0).map(([id, amount]) => ({ id, amount }));
}
const cleanGuard = (g) => (g !== null && typeof g === 'object' && word(g.band) && word(g.ground) && int(g.tier) && g.tier >= 1 && g.tier <= 4
  ? { band: g.band, ground: g.ground, tier: g.tier } : undefined);

/** A cairn as the save keeps it, or undefined for junk or an empty one. */
export function cleanCairn(c) {
  if (c === null || typeof c !== 'object' || !int(c.q) || !int(c.r)) return undefined;
  if (typeof c.folk !== 'string' || c.folk === '' || c.folk.length > 80) return undefined;
  if (!Number.isFinite(c.at) || c.at <= 0) return undefined;
  const items = mergeItems(c.items);
  const purse = mergePurse(c.purse);
  if (items.length === 0 && purse.length === 0) return undefined;
  const out = {
    id: typeof c.id === 'string' && c.id !== '' && c.id.length <= 120 ? c.id : `${c.folk}@${Math.floor(c.at)}`,
    folk: c.folk,
    name: typeof c.name === 'string' ? c.name.slice(0, 60) : '',
    q: c.q,
    r: c.r,
    at: Math.floor(c.at),
    cause: word(c.cause, 20) ? c.cause : 'other',
    items,
    purse,
  };
  const guard = cleanGuard(c.guard);
  if (guard !== undefined) out.guard = guard;
  return out;
}

/** The cairns a save keeps, oldest first: junk dropped, each id once, at most CAIRNS_MAX (the newest kept). */
export function cleanCairns(raw) {
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(raw) ? raw : []) {
    const clean = cleanCairn(c);
    if (clean === undefined || seen.has(clean.id)) continue;
    seen.add(clean.id);
    out.push(clean);
  }
  return out.slice(-CAIRNS_MAX);
}

/**
 * A new cairn from what Worker Folks' death keeper hands over: `gear` [{ slot, itemId, qty }], `room` { haul, stock,
 * town } of [{ itemId, qty }], `purse` [{ currencyId, amount }]. `guard` { band, ground, tier } for a band's kill.
 * Undefined when the Folk had nothing (no cairn: Worker Folks keeps its plain death line).
 */
export function makeCairn({ folkId, name, hex, at, cause, guard, gear, room, purse }) {
  const items = [...(gear ?? []), ...(room?.haul ?? []), ...(room?.stock ?? []), ...(room?.town ?? [])];
  return cleanCairn({ id: `${folkId}@${Math.floor(at)}`, folk: folkId, name, q: hex?.q, r: hex?.r, at, cause, guard, items, purse });
}

/**
 * Adds a cairn: `{ cairns, dropped }`, a new list (oldest first) and the cairns pushed out past CAIRNS_MAX, the oldest
 * unguarded first, then the oldest; their goods go to the bank.
 */
export function addCairn(list, cairn) {
  const cairns = [...cleanCairns(list)];
  const dropped = [];
  if (cairn === undefined) return { cairns, dropped };
  cairns.push(cairn);
  while (cairns.length > CAIRNS_MAX) {
    const i = cairns.findIndex((c) => c.guard === undefined);
    dropped.push(...cairns.splice(i >= 0 ? i : 0, 1));
  }
  return { cairns, dropped };
}

/** Every item id the cairns hold, each once (Worker Folks' Heirlooms read it, so one left in a cairn doesn't drop again). */
export function heldIds(list) {
  const out = new Set();
  for (const c of Array.isArray(list) ? list : []) for (const x of c?.items ?? []) if (itemId(x?.id)) out.add(x.id);
  return [...out];
}

/** The newest cairn a Folk left, or undefined. */
export function cairnOf(list, folkId) {
  const all = Array.isArray(list) ? list : [];
  for (let i = all.length - 1; i >= 0; i--) if (all[i]?.folk === folkId) return all[i];
  return undefined;
}

/** The cairns within `reach` hexes of `hex` (distance(a, b) the hex distance), nearest first. */
export function cairnsNear(list, hex, reach, distance) {
  return (Array.isArray(list) ? list : [])
    .map((c) => ({ c, d: distance(c, hex) }))
    .filter((x) => Number.isFinite(x.d) && x.d <= reach)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.c);
}

/**
 * Collecting a cairn: `take(id, qty)` says how many of a stack the bank took (0 to qty). The purse is always taken
 * whole. `{ taken: [{ id, qty }], purse, left }`, `left` the cairn with what the bank couldn't take, or undefined
 * when it is empty.
 */
export function collect(cairn, take) {
  const taken = [];
  const rest = [];
  for (const x of cairn?.items ?? []) {
    const got = Math.max(0, Math.min(x.qty, Math.floor(take(x.id, x.qty) || 0)));
    if (got > 0) taken.push({ id: x.id, qty: got });
    if (got < x.qty) rest.push({ id: x.id, qty: x.qty - got });
  }
  const purse = cairn?.purse ?? [];
  const left = rest.length > 0 ? { ...cairn, items: rest, purse: [] } : undefined;
  return { taken, purse, left };
}

/** The list with cairn `id` replaced by `next` (or removed when `next` is undefined); a new list. */
export function replaceCairn(list, id, next) {
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    if (c.id !== id) out.push(c);
    else if (next !== undefined) out.push(next);
  }
  return out;
}
