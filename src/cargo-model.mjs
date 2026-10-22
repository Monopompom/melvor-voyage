// Cargo runs (phase 4): the pure rules. Ports post requests for game goods packed in a Sack or a Crate
// (50 goods each, one hold slot each); the player takes one, loads it at the posting port and sails it to the port
// that wants it. No game objects here: the runtime (cargo.mjs) hands in plain data, the tests drive everything.

/** Goods in one sack or crate (the user, 17 Oct 2026). */
export const PER_CONTAINER = 50;
/** A request's port is at least this many hexes by sea lane from the port that posts it. */
export const FLOOR = 12;
/** Run pay a hex a container, on top of the goods (phase 4 canvas). */
export const GP_PER_HEX = 120;
export const XP_PER_HEX = 25;
/** The goods are paid at twice their sell price (the user: "so there is a profit in crafting those leather gloves"). */
export const GOODS_PAY = 2;
/** Packed cargo sold off at a harbour board fetches this share of what delivering it would pay. */
export const SALE_SHARE = 0.2;
/** Boards refresh once a Township season: 72 hours. */
export const SEASON_MS = 72 * 3600 * 1000;
export const BOARD_MIN = 4;
export const BOARD_MAX = 6;
/** A dungeon clear near a port: this chance of one more request at one of its ports. */
export const RESTOCK = 0.25;
/** A port posts cargo once any dungeon within this many hexes of it is cleared (the user, 18 Oct 2026). */
export const REGION_RADIUS = 6;
/** Cargo runs held at once. */
export const MAX_RUNS = 3;
/** Requests are at most this many times the hold's slots. */
export const MAX_LOADS = 3;

export const CONTAINERS = ['sack', 'crate'];
/** Ports that never post or take cargo: the game's Fake Port ("it definitely isn't a Port") only looks like one. */
export const NO_CARGO = ['FakePort'];

export const hexDist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
const key = (h) => `${h.q},${h.r}`;
const NEIGHBOURS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const isSea = (rec) => rec !== undefined && (rec.t === 'water' || rec.t === 'shoal');
const isPort = (rec) => rec !== undefined && rec.cloud !== true && Array.isArray(rec.f) && rec.f.includes('port');

/** The ports of the hex table: [{ poi, q, r }]. */
export const portsOf = (hexes) => hexes.filter(isPort).map((h) => ({ poi: h.poi, q: h.q, r: h.r }));

/**
 * Hexes between every two ports along the sea lanes: a breadth-first search over sea hexes and port hexes (lanes are
 * known, so cloud and hull reach don't matter, as for the game's port hops). Returns { [poi]: { [poi]: hexes } };
 * a pair with no lane is left out.
 */
export function laneDistances(hexes) {
  const byKey = new Map(hexes.map((h) => [key(h), h]));
  const ports = portsOf(hexes);
  const out = {};
  for (const p of ports) {
    const seen = new Map([[key(p), 0]]);
    const queue = [p];
    for (let i = 0; i < queue.length; i++) {
      const h = queue[i];
      const d = seen.get(key(h));
      // Only a sea hex or the starting port carries on: a port on land is an end, not a passage.
      if (i > 0 && !isSea(byKey.get(key(h)))) continue;
      for (const [dq, dr] of NEIGHBOURS) {
        const n = { q: h.q + dq, r: h.r + dr };
        const k = key(n);
        if (seen.has(k)) continue;
        const rec = byKey.get(k);
        if (!isSea(rec) && !isPort(rec)) continue;
        seen.set(k, d + 1);
        queue.push(n);
      }
    }
    out[p.poi] = {};
    for (const o of ports) if (o.poi !== p.poi && seen.has(key(o))) out[p.poi][o.poi] = seen.get(key(o));
  }
  return out;
}

/** The dungeons within REGION_RADIUS of each port: { [poi]: [dungeon name, nearest first] }. */
export function regions(hexes, radius = REGION_RADIUS) {
  const dungeons = hexes.filter((h) => typeof h.dungeon === 'string');
  const out = {};
  for (const p of portsOf(hexes)) {
    out[p.poi] = dungeons.map((d) => ({ name: d.dungeon, d: hexDist(p, d) })).filter((x) => x.d <= radius)
      .sort((a, b) => a.d - b.d || (a.name < b.name ? -1 : 1)).map((x) => x.name);
  }
  return out;
}

/** A small seeded random source (mulberry32): the same seed gives the same board. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A 32-bit hash of a string, for seeds. */
export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Picks one of `list` by its `weight`. */
export function weighted(list, r) {
  const total = list.reduce((s, x) => s + (x.weight > 0 ? x.weight : 0), 0);
  if (!(total > 0)) return undefined;
  let x = r() * total;
  for (const c of list) { if (!(c.weight > 0)) continue; x -= c.weight; if (x < 0) return c; }
  return list[list.length - 1];
}

/**
 * A request's size grows with your level in the trade that makes the goods (the user, 18 Oct 2026: "69 crates is a big
 * ask early on", "wanna add scaling?"; build .205): the ceiling is this share of MAX_LOADS times the slots, level / 60,
 * never under SIZE_MIN.
 */
export const SIZE_LEVEL = 60;
export const SIZE_MIN = 1 / 6;
export const sizeShare = (level) => Math.min(1, Math.max(SIZE_MIN, (Number.isFinite(level) ? level : SIZE_LEVEL) / SIZE_LEVEL));

/**
 * How many sacks or crates a request wants: 1 up to MAX_LOADS times the hold's slots (all your holds together) times
 * `share` (sizeShare of the trade's level), skewed small so most fit one load (the cube of a uniform draw: with 6
 * slots at full share about 7 in 10 fit).
 */
export function requestSize(slots, r, share = 1) {
  const max = Math.max(1, Math.round(MAX_LOADS * Math.max(1, slots) * share));
  return 1 + Math.floor(r() ** 3 * max);
}

/** What one delivered sack or crate pays: the goods at GOODS_PAY times their price, plus the run. */
export const payPer = (price, hexes) => ({
  gp: Math.round(PER_CONTAINER * Math.max(0, price) * GOODS_PAY + GP_PER_HEX * hexes),
  xp: XP_PER_HEX * hexes,
});

/**
 * One request posted at `from`: goods drawn from `candidates` ([{ id, weight, soft, price }]), a port at least FLOOR
 * hexes away by lane (`lanes[from]`), a size for a hold of `slots`. Undefined when nothing qualifies.
 */
export function makeRequest(from, candidates, lanes, slots, r, id) {
  if (NO_CARGO.includes(from)) return undefined;
  const far = Object.entries(lanes[from] ?? {}).filter(([poi, d]) => d >= FLOOR && !NO_CARGO.includes(poi)).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (far.length === 0) return undefined;
  const goods = weighted(candidates, r);
  if (goods === undefined) return undefined;
  const [to, hexes] = far[Math.floor(r() * far.length)];
  const pay = payPer(goods.price, hexes);
  return { id, item: goods.id, c: goods.soft ? 'sack' : 'crate', n: requestSize(slots, r, sizeShare(goods.lv)), to, hexes, gp: pay.gp, xp: pay.xp };
}

/**
 * Each request already on a board from a goods source (`g`: the skill that makes them) cuts that source's weight to REPEAT of what it was, so one trade can come again but seldom fills a
 * board (the user, 18 Oct 2026: the boards were all blacksmith's work).
 */
export const REPEAT = 0.25;
/** The group of a candidate, or of a posted request's goods among `candidates`. */
export const groupOf = (c) => c.g ?? c.id;
export const groupOfItem = (candidates, itemId) => { const c = candidates.find((x) => x.id === itemId); return c === undefined ? itemId : groupOf(c); };
/** Goods you have never had are picked this many times as often as the rest of their trade (the user, 18 Oct 2026:
 * push players to the skill products they never craft). */
export const NEW_LEAN = 3;
/**
 * Each trade weighs as a whole (the user, 18 Oct 2026: "as a whole would be preferred"): its weight is shared among its
 * goods by their `lean` (1 when absent), so a skill with many products is no likelier to post than one with few, and
 * within it the goods you have never had come up more. Candidates give their trade's weight.
 */
export function byTrade(candidates) {
  const n = new Map();
  const goods = new Map();
  const lean = (c) => (c.lean > 0 ? c.lean : 1);
  candidates.forEach((c) => { n.set(groupOf(c), (n.get(groupOf(c)) ?? 0) + lean(c)); goods.set(groupOf(c), (goods.get(groupOf(c)) ?? 0) + 1); });
  return candidates.map((c) => ({ ...c, weight: (c.weight * lean(c) * thinShare(goods.get(groupOf(c)))) / n.get(groupOf(c)) }));
}

// ---- spreading the requests (the user, 18 Oct 2026: Leather Gloves filled the boards; "combine them") ---------------
// Four cuts multiply onto a good's weight, each acting at a different time: a thin trade counts for less (from day
// one), a trade already on this board (REPEAT, within a board), the same good on any port's board this season (GLUT,
// across boards) and a good you delivered lately (RECENT, after your first runs). None takes a good below FLOOR_SHARE of
// its weight: damped hard, it is rare, never gone.

/** A trade with fewer goods than this counts for that share of its weight: one good a third, two goods two thirds. */
export const THIN = 3;
export const thinShare = (goods) => Math.min(1, Math.max(1, goods) / THIN);
/** Each request for the same good on any port's board this season. */
export const GLUT = 0.5;
/** A good you delivered in the last RECENT_SEASONS seasons. */
export const RECENT = 0.5;
export const RECENT_SEASONS = 2;
/** The least share of its weight the cuts leave a good. */
export const FLOOR_SHARE = 0.05;

/** The goods delivered lately, from the record's `sent` ({ item: season last delivered }), at `season`. */
export const recentGoods = (sent, season) => Object.keys(sent ?? {}).filter((id) => season - sent[id] <= RECENT_SEASONS);

/**
 * `candidates` with their weights cut: `board` a group per request already on this board, `season` an item per request
 * on any port's board this season (this one's included), `recent` the goods delivered lately.
 */
export function weigh(candidates, { board = [], season = [], recent = [] } = {}) {
  if (board.length === 0 && season.length === 0 && recent.length === 0) return candidates;
  const count = (list) => { const m = new Map(); list.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1)); return m; };
  const onBoard = count(board);
  const asked = count(season);
  const lately = new Set(recent);
  return candidates.map((c) => {
    const cut = REPEAT ** (onBoard.get(groupOf(c)) ?? 0) * GLUT ** (asked.get(c.id) ?? 0) * (lately.has(c.id) ? RECENT : 1);
    return cut === 1 ? c : { ...c, weight: c.weight * Math.max(FLOOR_SHARE, cut) };
  });
}
/** `candidates` with their weights cut for the groups already posted (`posted`: a group per request on the board). */
export const damped = (candidates, posted) => weigh(candidates, { board: posted });

/**
 * A port's board for a season: BOARD_MIN to BOARD_MAX requests, the same for the same seed and the same `earlier`:
 * `season`, the goods already on other ports' boards this season, and `recent`, the goods delivered lately (weigh).
 */
export function makeBoard(from, season, candidates, lanes, slots, seed, earlier = {}) {
  const r = rng(hash(`${seed}|${from}|${season}`));
  const count = BOARD_MIN + Math.floor(r() * (BOARD_MAX - BOARD_MIN + 1));
  const out = [];
  const posted = [];
  const asked = [...(earlier.season ?? [])];
  for (let i = 0; i < count; i++) {
    const req = makeRequest(from, weigh(candidates, { board: posted, season: asked, recent: earlier.recent }), lanes, slots, r, `${from}.${season}.${i}`);
    if (req === undefined) continue;
    out.push(req);
    posted.push(groupOfItem(candidates, req.item));
    asked.push(req.item);
  }
  return out;
}

/**
 * Every open port's board for a season, posted together in a fixed order (by port name) so the season's glut is the
 * same whichever harbour you look at first. `ports`: the open ports; `boards`: those already posted this season (kept,
 * and their goods count). Returns { [poi]: reqs } for the ports newly posted (a port with nothing to post is left out).
 */
export function postSeason(ports, season, candidates, lanes, slots, seed, { boards = {}, recent = [] } = {}) {
  const asked = Object.values(boards).flatMap((reqs) => reqs.map((q) => q.item));
  const out = {};
  for (const poi of [...ports].sort()) {
    if (boards[poi] !== undefined) continue;
    const reqs = makeBoard(poi, season, candidates, lanes, slots, seed, { season: asked, recent });
    if (reqs.length === 0) continue;
    out[poi] = reqs;
    reqs.forEach((q) => asked.push(q.item));
  }
  return out;
}

export const seasonOf = (now) => Math.floor(now / SEASON_MS);

/** A port posts cargo once any dungeon of its region has been cleared (`cleared(name)` is the clear count). */
export const portOpen = (poi, regionMap, cleared) => (regionMap[poi] ?? []).some((name) => cleared(name) > 0);

/** The ports whose region holds this dungeon. */
export const portsNear = (dungeon, regionMap) => Object.keys(regionMap).filter((poi) => regionMap[poi].includes(dungeon)).sort();

// ---- a taken request: a run ---------------------------------------------------------------------------------------

/** `sent` after delivering `item` at `season`: the season noted, goods past RECENT_SEASONS forgotten. */
export function noteSent(sent, item, season) {
  const out = {};
  for (const [id, s] of Object.entries(sent ?? {})) if (season - s <= RECENT_SEASONS) out[id] = s;
  out[item] = season;
  return out;
}

/** A request taken from `from`'s board becomes a run; `packed` counts the sacks or crates loaded so far, `due` when it
 * must be delivered by (0: no deadline). */
export const takeRun = (req, from, due = 0) => ({ id: req.id, from, to: req.to, item: req.item, c: req.c, n: req.n, hexes: req.hexes, gp: req.gp, xp: req.xp, packed: 0, done: 0, due });

// ---- the deadline (the user, 21 Oct 2026: stakes for the flat mechanics) -----------------------------------------
// A run is due DUE_SHARE times its plain trip after it is taken, online or offline. Late, a sack or crate pays its
// goods once at their price: no run pay, no XP. Pay on time is as before.
export const DUE_SHARE = 1.5;
/** A run's plain trip when one crossing of its lane takes `crossMs`: every load over and, all but the last, back for the next. */
export function plainTripMsOf(req, slots, crossMs) {
  const loads = Math.ceil(Math.max(1, req.n) / Math.max(1, slots));
  return (2 * loads - 1) * Math.max(0, crossMs);
}
/** A run's plain trip at `hexMs` a sea hex over the lane's straight length (the fallback when no road is known). */
export const plainTripMs = (req, slots, hexMs) => plainTripMsOf(req, slots, Math.max(1, req.hexes) * hexMs);
/**
 * When a run taken at `now` is due; 0 (no deadline) without a pace (timed travel off). With `crossMs` (build .387, the
 * user: a dinghy run across open sea was late with perfect play) the crossing is the real road between the ports with
 * the vessels owned, else the lane's straight length at `hexMs`.
 */
export const dueAt = (req, slots, hexMs, now, crossMs) => (!(Number.isFinite(hexMs) && hexMs > 0) ? 0
  : now + Math.round(DUE_SHARE * (Number.isFinite(crossMs) && crossMs > 0 ? plainTripMsOf(req, slots, crossMs) : plainTripMs(req, slots, hexMs))));
/** Past its deadline at `now`. */
export const isLate = (run, now) => Number.isFinite(run?.due) && run.due > 0 && now > run.due;
/** What a sack or crate delivered late pays: its goods once (the run pay and the doubling taken off). */
export const latePer = (run) => Math.max(0, Math.round((run.gp - GP_PER_HEX * run.hexes) / GOODS_PAY));

/** Sacks or crates of a run in a hold. */
export const inHold = (hold, runId) => hold.filter((e) => e.cargo === runId).length;

/** How many more containers can be loaded now: limited by what is left, the goods, the empty containers and free slots. */
export function loadable(run, goods, empties, freeSlots) {
  return Math.max(0, Math.min(run.n - run.packed, Math.floor(goods / PER_CONTAINER), empties, freeSlots));
}

/** The hold after loading `k` containers of a run (each a slot of its own). */
export const load = (hold, run, k) => [...hold, ...Array.from({ length: k }, () => ({ id: run.item, qty: PER_CONTAINER, cargo: run.id, c: run.c }))];

/** Delivers every container of a run in a hold at `now`: { hold, k, gp, xp, late }. */
export function deliver(hold, run, now) {
  const k = inHold(hold, run.id);
  const late = isLate(run, now);
  return { hold: hold.filter((e) => e.cargo !== run.id), k, gp: k * (late ? latePer(run) : run.gp), xp: late ? 0 : k * run.xp, late };
}

/** Sells a run's packed cargo off at a harbour board: { hold, k, gp } at SALE_SHARE of the pay. */
export function sellOff(hold, run) {
  const k = inHold(hold, run.id);
  return { hold: hold.filter((e) => e.cargo !== run.id), k, gp: Math.round(k * run.gp * SALE_SHARE) };
}

export const finished = (run) => run.done >= run.n;

// ---- the save --------------------------------------------------------------------------------------------------------

const whole = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const str = (v) => typeof v === 'string' && v !== '';
function cleanRequest(q) {
  if (q === null || typeof q !== 'object' || !str(q.id) || !str(q.item) || !str(q.to) || !CONTAINERS.includes(q.c)) return undefined;
  const n = whole(q.n);
  if (n <= 0) return undefined;
  return { id: q.id, item: q.item, c: q.c, n, to: q.to, hexes: whole(q.hexes), gp: whole(q.gp), xp: whole(q.xp) };
}
function cleanRun(x) {
  const q = cleanRequest(x);
  if (q === undefined || !str(x.from)) return undefined;
  const packed = Math.min(q.n, whole(x.packed));
  return { ...q, from: x.from, packed, done: Math.min(packed, whole(x.done)), due: whole(x.due) };
}
/**
 * The cargo part of the Voyage save: { boards: { [poi]: { s, reqs } }, runs: [], posted: the season all open boards
 * were posted (-1 none), sent: { item: season last delivered } (build .205). }
 */
export function cleanCargo(c) {
  const out = { boards: {}, runs: [], posted: -1, sent: {} };
  if (c === null || typeof c !== 'object') return out;
  if (Number.isInteger(c.posted)) out.posted = c.posted;
  if (c.sent !== null && typeof c.sent === 'object') for (const [id, s] of Object.entries(c.sent)) if (str(id) && Number.isInteger(s)) out.sent[id] = s;
  if (c.boards !== null && typeof c.boards === 'object') {
    for (const [poi, b] of Object.entries(c.boards)) {
      if (b === null || typeof b !== 'object' || !Number.isInteger(b.s) || !Array.isArray(b.reqs)) continue;
      out.boards[poi] = { s: b.s, reqs: b.reqs.map(cleanRequest).filter((q) => q !== undefined) };
    }
  }
  if (Array.isArray(c.runs)) out.runs = c.runs.map(cleanRun).filter((r) => r !== undefined && !finished(r)).slice(0, MAX_RUNS);
  return out;
}
/** A hold entry that is packed cargo: one container of a run. */
export const isCargo = (e) => e !== null && typeof e === 'object' && str(e.cargo) && CONTAINERS.includes(e.c);
