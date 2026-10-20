// A Folk walking alone on a travel order (phase 6d, the user, 20 Oct 2026): the road it takes, how long each hex takes,
// where it is at a moment, and the walks a save keeps. Pure: the game side says which hexes are known land, what a
// step costs from the stores, and moves the Folk (Worker Folks travel 'walking').

/** A hex on foot without a mount (clock-model LAND_MS), times the ground: x1.5 rough, x2 Snowlands and Lavalands. */
export const WALK_MS = 6 * 60 * 1000;
export const ROUGH = ['desert', 'highlands', 'mountain', 'badlands', 'wastelands', 'cursedlands'];
export const HARD = ['snowlands', 'lavalands'];
export const walkFactor = (cls) => (HARD.includes(cls) ? 2 : ROUGH.includes(cls) ? 1.5 : 1);
/** Milliseconds to walk into a hex of class `cls`. */
export const hexMs = (cls) => Math.round(WALK_MS * walkFactor(cls));

/** The six neighbours of an axial hex. */
export const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
const key = (q, r) => `${q},${r}`;

/**
 * The quickest road on foot from `from` to `to` ({ q, r }), over hexes `ground(q, r)` names: their terrain class when the
 * Folk may walk there (known land), undefined otherwise. The start needs no class; the end must have one. Returns
 * [{ q, r, cls, ms }] for each hex entered, in order (the start not included), [] when already there, or undefined
 * when no road exists. `limit` caps the hexes searched.
 */
export function findRoad(from, to, ground, { limit = 20000 } = {}) {
  if (from == null || to == null || typeof ground !== 'function') return undefined;
  if (from.q === to.q && from.r === to.r) return [];
  if (ground(to.q, to.r) === undefined) return undefined;
  const best = new Map([[key(from.q, from.r), 0]]);
  const prev = new Map();
  const cls = new Map();
  // A plain list kept sorted by time: the searches are a few hundred hexes.
  const open = [{ q: from.q, r: from.r, t: 0 }];
  let seen = 0;
  while (open.length > 0) {
    const cur = open.shift();
    const k = key(cur.q, cur.r);
    if (cur.t > best.get(k)) continue;
    if (cur.q === to.q && cur.r === to.r) {
      const road = [];
      for (let at = k; at !== key(from.q, from.r); at = prev.get(at)) {
        const [q, r] = at.split(',').map(Number);
        road.push({ q, r, cls: cls.get(at), ms: hexMs(cls.get(at)) });
      }
      return road.reverse();
    }
    if ((seen += 1) > limit) return undefined;
    for (const [dq, dr] of NEIGHBOURS) {
      const q = cur.q + dq;
      const r = cur.r + dr;
      const c = ground(q, r);
      if (c === undefined) continue;
      const nk = key(q, r);
      const t = cur.t + hexMs(c);
      if (best.has(nk) && best.get(nk) <= t) continue;
      best.set(nk, t);
      prev.set(nk, k);
      cls.set(nk, c);
      let i = open.length;
      while (i > 0 && open[i - 1].t > t) i -= 1;
      open.splice(i, 0, { q, r, t });
    }
  }
  return undefined;
}

/** The whole road's time in milliseconds. */
export const roadMs = (road) => (road ?? []).reduce((sum, s) => sum + (Number.isFinite(s.ms) ? s.ms : 0), 0);

/** What the road eats, summing `costOf(step)` ({ food, fuel }) over its hexes. */
export function roadPack(road, costOf) {
  let food = 0;
  let fuel = 0;
  for (const s of road ?? []) {
    const c = costOf(s) ?? {};
    food += Number.isFinite(c.food) ? c.food : 0;
    fuel += Number.isFinite(c.fuel) ? c.fuel : 0;
  }
  return { food: Math.round(food), fuel: Math.round(fuel * 1000) / 1000 };
}

/**
 * Where a walk is at `now`: `reached` hexes entered so far (0 to the road's length), the hex it stands on (the start
 * until it enters the first), the time left, and whether it has arrived.
 */
export function walkAt(walk, now) {
  const road = walk?.road ?? [];
  const elapsed = Math.max(0, (Number.isFinite(now) ? now : 0) - (Number.isFinite(walk?.start) ? walk.start : 0));
  let t = 0;
  let reached = 0;
  for (const s of road) {
    if (t + s.ms > elapsed) break;
    t += s.ms;
    reached += 1;
  }
  const total = roadMs(road);
  const at = reached === 0 ? walk?.from : road[reached - 1];
  return { reached, at: at === undefined ? undefined : { q: at.q, r: at.r }, left: Math.max(0, total - elapsed), done: reached >= road.length };
}

/** The moment the walk enters its next hex (ms since the epoch), or undefined once it has arrived. */
export function nextAt(walk, now) {
  const { reached, done } = walkAt(walk, now);
  if (done) return undefined;
  let t = walk.start;
  for (let i = 0; i <= reached; i++) t += walk.road[i].ms;
  return t;
}

/**
 * What a Folk eats on a hex walked alone (6d): your cost for the hex (stores-model stepCost, no crew) with the food
 * by its rank's share (crew-model foodShare); the fuel as yours.
 */
export const folkStepCost = (yours, share) => ({
  food: Math.round((Number.isFinite(yours?.food) ? yours.food : 0) * (Number.isFinite(share) && share > 0 ? share : 1)),
  fuel: Number.isFinite(yours?.fuel) ? yours.fuel : 0,
});

/**
 * The places a Folk may be sent, in the order the dialog lists them: the ones it can reach first, quickest first;
 * then the ones across water, nearest first. Each place is { road (undefined: no road), distance }.
 */
export function sortPlaces(places) {
  const key = (p) => (p.road === undefined ? [1, p.distance] : [0, roadMs(p.road), p.distance]);
  return [...(places ?? [])].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) if ((ka[i] ?? 0) !== (kb[i] ?? 0)) return (ka[i] ?? 0) - (kb[i] ?? 0);
    return 0;
  });
}

/** Walks a save keeps at most: one per Folk, and Worker Folks never hires more than there are skills to hold. */
export const WALKS_MAX = 64;
/** Hexes a saved road keeps at most. */
export const ROAD_MAX = 400;

const int = (n) => Number.isInteger(n);
const cleanHex = (h) => (h !== null && typeof h === 'object' && int(h.q) && int(h.r) ? { q: h.q, r: h.r } : undefined);
const cleanStep = (s) => {
  const h = cleanHex(s);
  if (h === undefined || typeof s.cls !== 'string' || s.cls === '' || !Number.isFinite(s.ms) || s.ms <= 0) return undefined;
  return { ...h, cls: s.cls, ms: Math.round(s.ms) };
};

/**
 * One walk as a save keeps it: { from, road, start, skillId, actionId?, holder? }. `from` the hex it set off from,
 * `start` the moment (ms since the epoch), `skillId` the work it starts on arrival (null: none), `actionId` the resource
 * picked from the Journal, `holder` the Folk that held that skill when it was sent (it takes the skill over from that
 * one, and only that one). Undefined when it can't be read.
 */
export function cleanWalk(w) {
  if (w === null || typeof w !== 'object') return undefined;
  const from = cleanHex(w.from);
  if (from === undefined || !Number.isFinite(w.start) || w.start < 0 || !Array.isArray(w.road)) return undefined;
  const road = [];
  for (const s of w.road.slice(0, ROAD_MAX)) {
    const c = cleanStep(s);
    if (c === undefined) return undefined;
    road.push(c);
  }
  if (road.length === 0) return undefined;
  const out = { from, road, start: Math.round(w.start), skillId: typeof w.skillId === 'string' && w.skillId !== '' ? w.skillId : null };
  if (typeof w.actionId === 'string' && w.actionId !== '') out.actionId = w.actionId;
  if (typeof w.holder === 'string' && w.holder !== '') out.holder = w.holder;
  return out;
}

/** The walks a save keeps: { folkId: walk }, junk dropped. */
export function cleanWalks(walks) {
  if (walks === null || typeof walks !== 'object' || Array.isArray(walks)) return {};
  const out = {};
  for (const [id, w] of Object.entries(walks).slice(0, WALKS_MAX)) {
    if (typeof id !== 'string' || id === '') continue;
    const c = cleanWalk(w);
    if (c !== undefined) out[id] = c;
  }
  return out;
}
