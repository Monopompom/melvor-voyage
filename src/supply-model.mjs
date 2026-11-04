// Local supply (step 2 of the provisions second pass): every loading place packs only so much a day. A limit, never a
// source: the food and fuel still come from the bank at the place's rate. Pure: the stock of each loading hex, its
// refill on the game clock, which places a load draws and in what order. The game side is src/stores.mjs.
//
// A stock is kept as the share of a day's worth left (`f` food, `u` fuel) at the game-clock time `at`, so it follows
// the carry limit as the Voyage level grows. A hex with no entry is full. A load may take the last item past what is
// left: the share then goes below zero and the place makes it up before it loads again, so tapping Load on a nearly
// empty place never gets more than the place refills.

/** A day on the game clock: a stock refills its day's worth over this, steadily, and never holds more. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A day's worth by place (`LOAD_PLACES` ids in stores-model.mjs), in loads of the level's own carry limit, food and
 * fuel each against their own limit. Decided 4 Nov 2026 (the user picked these over ¼ / ¾ / 1 / 2): a farm is a
 * top-up, long trips plan through towns and ports. A market's fuel follows its rate (½ of its ¾ food). [BALANCE]
 */
export const SHARES = {
  port: { food: 2, fuel: 2 },
  town: { food: 1, fuel: 1 },
  market: { food: 1 / 2, fuel: 1 / 3 },
  farm: { food: 1 / 8, fuel: 1 / 8 },
};

/** How far below empty a stock may stand after an item ran past it (a day's worth), and the most entries a save keeps. */
const DEBT_MAX = 2;
export const ENTRIES_MAX = 400;

/** A place's day's worth in stores HP and fuel for a carry limit `cap` ({ food, fuel }). */
export function dayOf(place, cap) {
  const s = SHARES[place];
  if (s === undefined) return { food: 0, fuel: 0 };
  return { food: Math.max(0, cap?.food ?? 0) * s.food, fuel: Math.max(0, cap?.fuel ?? 0) * s.fuel };
}

/** The share of a day's worth left at `now`: { food, fuel }, each at most 1 (full). No entry: full. */
export function shareAt(entry, now) {
  if (entry === undefined || entry === null) return { food: 1, fuel: 1 };
  const back = Math.max(0, (now - entry.at) / DAY_MS);
  return { food: Math.min(1, entry.f + back), fuel: Math.min(1, entry.u + back) };
}

/** What a place has to load at `now`, in stores HP and fuel (below 0 while it makes up an item that ran past it). */
export function stockOf(entry, place, cap, now) {
  const day = dayOf(place, cap);
  const s = shareAt(entry, now);
  return { food: s.food * day.food, fuel: s.fuel * day.fuel };
}

/** The entry after `taken` ({ food, fuel } in stores units) was loaded at `now`. */
export function drawn(entry, place, cap, now, taken) {
  const day = dayOf(place, cap);
  const s = shareAt(entry, now);
  const less = (share, n, d) => (d > 0 && n > 0 ? Math.max(-DEBT_MAX, share - n / d) : share);
  return { f: less(s.food, taken?.food ?? 0, day.food), u: less(s.fuel, taken?.fuel ?? 0, day.fuel), at: now };
}

/**
 * Game-clock ms from `now` until the place holds `want` of `kind` (stores units), 0 when it does already, Infinity
 * when a day's worth is less than that (it never will).
 */
export function msUntil(entry, place, cap, now, kind, want) {
  const day = dayOf(place, cap)[kind];
  if (!(day > 0)) return Infinity;
  const target = want / day;
  if (target > 1 + 1e-9) return Infinity;
  const have = shareAt(entry, now)[kind];
  return have >= target ? 0 : Math.ceil((target - have) * DAY_MS);
}

/** Game-clock ms from `now` until the place is full again (both food and fuel). */
export function msUntilFull(entry, now) {
  const s = shareAt(entry, now);
  return Math.ceil(Math.max(0, 1 - Math.min(s.food, s.fuel)) * DAY_MS);
}

/**
 * How a load of `qty` items of `unit` HP (or fuel units) of `kind` goes in with `room` left in the stores: the best
 * rate first, then the next place in reach at its own rate (the first source wins a tie: the hex you stand on comes
 * first). `sources`: [{ key, place, food, fuel, stock: { food, fuel } }], `stock` Infinity where supply is off. Each
 * part loads up to the room and the place's stock; the last item may run past either (stores-model loadCount).
 * Returns { n, added, parts: [{ key, place, rate, n, added }] }. `S`: stores-model.mjs.
 */
export function planLoad(S, unit, qty, room, sources, kind) {
  const order = (sources ?? []).map((s, i) => ({ s, i })).filter(({ s }) => s[kind] > 0)
    .sort((a, b) => b.s[kind] - a.s[kind] || a.i - b.i).map(({ s }) => s);
  let left = Math.max(0, Math.floor(qty));
  let space = room;
  let n = 0;
  let added = 0;
  const parts = [];
  for (const s of order) {
    if (left <= 0 || !(space > 0)) break;
    const lim = Math.min(space, s.stock?.[kind] ?? Infinity);
    const k = S.loadCount(unit, s[kind], left, lim);
    if (k <= 0) continue;
    const a = S.loadAmount(unit, k, s[kind]);
    parts.push({ key: s.key, place: s.place, rate: s[kind], n: k, added: a });
    left -= k;
    space -= a;
    n += k;
    added += a;
  }
  return { n, added, parts };
}

/** What the sources hold of `kind` in all, counting only places that load it (stock below 0 counts as none). */
export function totalStock(sources, kind) {
  return (sources ?? []).reduce((sum, s) => sum + (s[kind] > 0 ? Math.max(0, s.stock?.[kind] ?? Infinity) : 0), 0);
}

/** The save's supply with the places full again at `now` dropped (a hex with no entry is full). */
export function pruned(supply, now) {
  const out = {};
  for (const [key, e] of Object.entries(supply ?? {})) {
    const s = shareAt(e, now);
    if (s.food < 1 || s.fuel < 1) out[key] = e;
  }
  return out;
}

/**
 * The hexes ("q,r") of every land mass with no easy ground (the user, 4 Nov 2026: "patch up those two places only"):
 * there a loading place is the only ground that is safe on empty stores, so its stock never runs out, and a player
 * who knows the rules never has to wait. Land is every hex of the table that is not sea or cloud, joined through
 * land alone, read from the table itself: the Winter ice never joins an island to the mainland for this. On the map
 * of 1.3.1 that is the Snowlands island (Snow-Covered Pier, Glacia Dungeon Ruins, Frost Drift Port) and the
 * Cursedlands one (Aeris Dungeon Ruins, Castle Ruins). `isEasy(cls)`: stores-model.mjs isEasy.
 */
export function islandKeys(hexes, isEasy, sea = ['water', 'shoal']) {
  const key = (q, r) => `${q},${r}`;
  const land = new Map();
  for (const h of hexes ?? []) if (h && h.cloud !== true && !sea.includes(h.t) && Number.isInteger(h.q) && Number.isInteger(h.r)) land.set(key(h.q, h.r), h);
  const out = new Set();
  const seen = new Set();
  const steps = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  for (const [k, h] of land) {
    if (seen.has(k)) continue;
    const mass = [];
    let easy = false;
    const stack = [h];
    seen.add(k);
    while (stack.length > 0) {
      const cur = stack.pop();
      mass.push(key(cur.q, cur.r));
      if (isEasy(cur.t)) easy = true;
      for (const [dq, dr] of steps) {
        const nk = key(cur.q + dq, cur.r + dr);
        if (!land.has(nk) || seen.has(nk)) continue;
        seen.add(nk);
        stack.push(land.get(nk));
      }
    }
    if (!easy) for (const m of mass) out.add(m);
  }
  return out;
}

const KEY = /^-?\d{1,3},-?\d{1,3}$/;
const share = (n) => (Number.isFinite(n) ? Math.max(-DEBT_MAX, Math.min(1, n)) : 1);
/** The save's `supply`: { "q,r": { f, u, at } }, junk dropped, at most ENTRIES_MAX entries. */
export function cleanSupply(raw) {
  const out = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, e] of Object.entries(raw)) {
    if (Object.keys(out).length >= ENTRIES_MAX) break;
    if (!KEY.test(key) || e === null || typeof e !== 'object' || !Number.isFinite(e.at) || e.at < 0) continue;
    out[key] = { f: share(e.f), u: share(e.u), at: Math.floor(e.at) };
  }
  return out;
}
