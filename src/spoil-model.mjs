// Spoilage (provisions, step 3; the user, 4 Nov 2026): the stores lose a share of what they hold with every game-hour,
// food faster than fuel. A share, so a full load loses the most and a near-empty one hardly anything: it never strands
// anyone by itself. Pure: the rates, the multipliers (where the stores sit, the warmth and the damp, the casks and the
// salt), a span's loss with its floor, the planner's forecast, a walk's packed extra and the save's record. The game
// side is src/stores.mjs (your stores and the tents' stores); covered by tests/spoil-model.test.mjs.

export const HOUR_MS = 60 * 60 * 1000;
/** The share lost an hour at ×1: food 1%, fuel a quarter of that (an 8-hour night: about 8% of the food, 2% of the fuel). */
export const RATE = { food: 0.01, fuel: 0.0025 };
/** Your stores on a hex that loads food (a cellar), and a tent's store wherever it stands (the rain kept off). */
export const AT_FOOD_PLACE = 0.25;
export const IN_TENT = 0.5;
/** Food by the weather band of the hex it sits on (the season is in the band); weather off reads as mild. */
export const WARMTH = { bitter: 0.25, cold: 0.5, mild: 1, warm: 1.5, scorching: 2 };
/** Fuel by the damp: at sea it goes off faster, on land at ×1. */
export const SEA_DAMP = 1.5;
/** Dry Casks (the shop, for good) and Curing Salt (Cooking, while it runs) each halve the loss. */
export const PRESERVE = 0.5;
/** One Curing Salt loaded keeps your stores cured this long on the game clock; at most CURE_MAX is banked. */
export const CURE_MS = 6 * HOUR_MS;
export const CURE_MAX = 48 * HOUR_MS;

const KINDS = ['food', 'fuel'];
const num = (n) => (Number.isFinite(n) && n > 0 ? n : 0);
/** Fuel kept to thousandths, as the stores keep it; food in whole HP. */
const unitOf = (kind) => (kind === 'food' ? 1 : 0.001);
const roundDown = (n, unit) => Math.floor(n / unit + 1e-9) * unit;
const clean3 = (n) => Math.round(n * 1000) / 1000;

/**
 * The multipliers on one store: `where` 'stores' (yours) or 'tent'; `band` the hex's weather band (undefined: mild);
 * `sea` the hex is sea; `foodPlace` your stores stand where food loads; `casks` Dry Casks bought; `cured` curing runs
 * (your stores only). Returns { food, fuel, parts }, `parts` the factors that are not ×1, in the order shown:
 * [{ id: 'place' | 'tent' | 'warmth' | 'damp' | 'casks' | 'cured', x, kinds, band? }].
 */
export function factors({ where = 'stores', band, sea = false, foodPlace = false, casks = false, cured = false } = {}) {
  const parts = [];
  if (where === 'tent') parts.push({ id: 'tent', x: IN_TENT, kinds: KINDS });
  else if (foodPlace) parts.push({ id: 'place', x: AT_FOOD_PLACE, kinds: KINDS });
  const w = WARMTH[band] ?? 1;
  if (w !== 1) parts.push({ id: 'warmth', x: w, kinds: ['food'], band });
  if (sea) parts.push({ id: 'damp', x: SEA_DAMP, kinds: ['fuel'] });
  if (casks) parts.push({ id: 'casks', x: PRESERVE, kinds: KINDS });
  if (cured && where === 'stores') parts.push({ id: 'cured', x: PRESERVE, kinds: KINDS });
  const out = { food: 1, fuel: 1, parts };
  for (const p of parts) for (const k of p.kinds) out[k] *= p.x;
  return out;
}

/** The share of `kind` still there after `ms` of game time at multiplier `x`: (1 − rate)^(hours × x). */
export const keptShare = (kind, ms, x) => (num(ms) > 0 && num(x) > 0 ? (1 - RATE[kind]) ** ((ms / HOUR_MS) * x) : 1);

/** What `amount` loses an hour at multiplier `x` (the Stores block's "an hour" line). */
export const lossPerHour = (kind, amount, x) => num(amount) * (1 - keptShare(kind, HOUR_MS, x));

/**
 * One span of `ms` with one set of multipliers `f` ({ food, fuel }) on a store `have` ({ food, fuel }). The store
 * keeps whole HP and thousandths of fuel, so the fraction lost below a unit is carried in `debt` ({ food, fuel }) to
 * the next span instead of being rounded away (a minute's loss is often under 1 HP). `floor` ({ food?, fuel? }) is
 * never spoiled below (the food to get ashore, what the rest of a leg under way costs). Returns { have, debt, lost },
 * `lost` the whole units taken off now.
 */
export function spoil(have, debt, ms, f, floor = {}) {
  const out = { have: { ...have }, debt: { food: num(debt?.food), fuel: num(debt?.fuel) }, lost: { food: 0, fuel: 0 } };
  for (const k of KINDS) {
    const held = num(have?.[k]);
    const exact = Math.max(0, held - out.debt[k]);
    let loss = exact * (1 - keptShare(k, ms, f?.[k] ?? 1));
    // Never below the floor: what is at or under it keeps, and the loss stops where it begins.
    const room = Math.max(0, exact - num(floor[k]));
    loss = Math.min(loss, room);
    const d = out.debt[k] + loss;
    const whole = Math.min(held, roundDown(d, unitOf(k)));
    out.have[k] = k === 'fuel' ? clean3(held - whole) : held - whole;
    out.lost[k] = k === 'fuel' ? clean3(whole) : whole;
    out.debt[k] = Math.max(0, d - whole);
    if (out.have[k] <= 0) { out.have[k] = 0; out.debt[k] = 0; }
  }
  return out;
}

/**
 * Your stores over `ms` with curing: `cure` the curing time left (ms); `fWith` and `fWithout` the multipliers while
 * it runs and after. Splits the span where the curing ends. Returns spoil()'s { have, debt, lost } plus `cure` left.
 */
export function settle(have, debt, ms, { fWith, fWithout, cure = 0, floor } = {}) {
  const span = num(ms);
  const c = Math.min(num(cure), span);
  let r = { have: { ...have }, debt: { food: num(debt?.food), fuel: num(debt?.fuel) }, lost: { food: 0, fuel: 0 } };
  const add = (x) => { r = { have: x.have, debt: x.debt, lost: { food: r.lost.food + x.lost.food, fuel: clean3(r.lost.fuel + x.lost.fuel) } }; };
  if (c > 0) add(spoil(r.have, r.debt, c, fWith ?? fWithout, floor));
  if (span - c > 0) add(spoil(r.have, r.debt, span - c, fWithout, floor));
  return { ...r, cure: Math.max(0, num(cure) - span) };
}

/**
 * The planner's and Set off's forecast: what `have` ({ food, fuel }) loses over the legs ahead, each { ms, f, cost,
 * set? } (`cost` { food, fuel } paid at the leg's end, `f` the leg's multipliers, `set` the stores as a planned stop
 * loads them before the leg), as { food, fuel } lost on the way. The stores shrink by each cost as they go, so later
 * legs lose less; nothing is floored (a forecast, not the rule).
 */
export function forecast(have, legs) {
  let cur = { food: num(have?.food), fuel: num(have?.fuel) };
  const lost = { food: 0, fuel: 0 };
  for (const leg of legs ?? []) {
    if (leg.set !== undefined) cur = { food: num(leg.set.food), fuel: num(leg.set.fuel) };
    for (const k of KINDS) {
      const l = cur[k] * (1 - keptShare(k, leg.ms, leg.f?.[k] ?? 1));
      lost[k] += l;
      cur[k] = Math.max(0, cur[k] - l - num(leg.cost?.[k]));
    }
  }
  return { food: Math.round(lost.food), fuel: clean3(lost.fuel) };
}

/**
 * A walking Folk's pack (the user: "yes, at the same rate"): packed with the extra it will lose on the road, so the
 * walk arrives as it would without spoilage. `steps` in road order, each { food, fuel, ms, f }: the hex's cost, paid on
 * entering it after `ms` of walking at multipliers `f`. Worked backwards: before each step the pack must hold that
 * step's cost and everything after, grossed up by what the walk to it spoils. Returns { food, fuel } to pack, at least
 * the costs' sum.
 */
export function packWith(steps) {
  const need = { food: 0, fuel: 0 };
  for (let i = (steps?.length ?? 0) - 1; i >= 0; i--) {
    const s = steps[i];
    for (const k of KINDS) {
      need[k] = (need[k] + num(s[k])) / keptShare(k, s.ms, s.f?.[k] ?? 1);
    }
  }
  return { food: Math.ceil(need.food - 1e-9), fuel: Math.ceil(need.fuel * 1000 - 1e-6) / 1000 };
}

/** Curing time after loading `n` Curing Salts on top of `cure` left: CURE_MS each, never above CURE_MAX. */
export const cureAfter = (cure, n) => Math.min(CURE_MAX, num(cure) + CURE_MS * Math.max(0, Math.floor(num(n))));
/** How many salts fit before the curing is banked full (0 when it is). */
export const curesRoom = (cure) => Math.max(0, Math.floor((CURE_MAX - num(cure)) / CURE_MS + 1e-9));

/**
 * The save's record (v27): `at` the game-clock time the stores were last settled (0: not yet, the first settle only
 * stamps), `cure` the curing time left (ms), `debt` your stores' carried fractions, `tents` each tent's own debt by
 * hex key.
 */
export function cleanSpoil(raw) {
  const r = raw !== null && typeof raw === 'object' ? raw : {};
  const pair = (p) => ({ food: Math.min(1, num(p?.food)), fuel: Math.min(0.001, num(p?.fuel)) });
  const tents = {};
  if (r.tents !== null && typeof r.tents === 'object') {
    for (const [k, v] of Object.entries(r.tents)) if (/^-?\d+,-?\d+$/.test(k)) tents[k] = pair(v);
  }
  return {
    at: num(r.at),
    cure: Math.min(CURE_MAX, num(r.cure)),
    debt: pair(r.debt),
    tents,
  };
}
