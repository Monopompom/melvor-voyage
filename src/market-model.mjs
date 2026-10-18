// Markets with prices (phase 4): the pure rules. Each trading place has a few goods it pays well for
// (140–180%) and one or two it pays little for (60–80%), by category; everything else sells at the game's price. A
// category's processed goods (cooked fish, bars, charcoal, potions, runes, crafted goods) fetch 20 points more than
// its raw goods at the same market. The lists are the same for every character: a fixed seed per market, leaning on
// what the place is (fish cheap at ports, crops cheap at farms, fish dear inland). No game objects here.

/** Item categories, in the order the journal lists them. `processed`: the category has worked goods as well. */
export const CATEGORIES = ['fish', 'ore', 'logs', 'crops', 'herbs', 'runes', 'gems', 'bones', 'stardust', 'ash'];
export const PROCESSED = ['fish', 'ore', 'logs', 'herbs', 'runes', 'gems'];
/** Percentages: dear goods 140 to 180, cheap 60 to 80, in steps of 5; processed goods +20 on either. */
export const DEAR = { min: 140, max: 180 };
export const CHEAP = { min: 60, max: 80 };
export const PROCESSED_BONUS = 20;
const STEP = 5;

/** Places that share one market: the three corners of the Capital City. The Fake Port has no market. */
const SAME_MARKET = { CapitalCitysAlleyways: 'CapitalCity', CapitalCitysKnights: 'CapitalCity', CapitalCitysSquare: 'CapitalCity' };
export const NO_MARKET = ['FakePort'];
/** Farms: crops and herbs cheap. */
const FARMS = ['FarmersMarket', 'HarvestHavenFarm'];

/** The market a trading place's POI belongs to, or undefined (no POI, or the Fake Port). */
export const marketOf = (poi) => (typeof poi !== 'string' || NO_MARKET.includes(poi) ? undefined : SAME_MARKET[poi] ?? poi);

/** The markets of the hex table: [{ id, port, q, r }], one per market (the first hex of a shared one). */
export function marketsOf(hexes, isTradePlace) {
  const out = new Map();
  for (const h of hexes) {
    if (!isTradePlace(h)) continue;
    const id = marketOf(h.poi);
    if (id === undefined || out.has(id)) continue;
    out.set(id, { id, port: Array.isArray(h.f) && h.f.includes('port'), q: h.q, r: h.r });
  }
  return [...out.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** Draws one of `weights` ({ cat: weight }) not in `taken`. */
function draw(weights, taken, r) {
  const list = CATEGORIES.filter((c) => !taken.has(c) && weights[c] > 0);
  const total = list.reduce((s, c) => s + weights[c], 0);
  let x = r() * total;
  for (const c of list) { x -= weights[c]; if (x < 0) return c; }
  return list[list.length - 1];
}
const pick = (range, r) => range.min + STEP * Math.floor(r() * ((range.max - range.min) / STEP + 1));

/**
 * A market's price list: { [category]: percent } for its 2 to 3 dear and 1 to 2 cheap categories. `m` is
 * { id, port }. The same market gives the same list for everyone.
 */
export function pricesOf(m) {
  const r = rng(hash(`voyage-market|${m.id}`));
  const dearW = Object.fromEntries(CATEGORIES.map((c) => [c, 1]));
  const cheapW = Object.fromEntries(CATEGORIES.map((c) => [c, 1]));
  if (m.port) { cheapW.fish = 5; dearW.fish = 0; } else dearW.fish = 3;
  if (FARMS.includes(m.id)) { cheapW.crops = 5; cheapW.herbs = 3; dearW.crops = 0; dearW.herbs = 0; }
  const taken = new Set();
  const out = {};
  const cheapN = 1 + Math.floor(r() * 2);
  for (let i = 0; i < cheapN; i++) { const c = draw(cheapW, taken, r); taken.add(c); out[c] = pick(CHEAP, r); }
  const dearN = 2 + Math.floor(r() * 2);
  for (let i = 0; i < dearN; i++) { const c = draw(dearW, taken, r); taken.add(c); out[c] = pick(DEAR, r); }
  return out;
}

/** The percent a market pays for goods of `cat` (raw or processed); 100 for anything it doesn't list. */
export function percentFor(prices, cat, processed) {
  const p = prices?.[cat];
  if (p === undefined) return 100;
  return p + (processed && PROCESSED.includes(cat) ? PROCESSED_BONUS : 0);
}

/** A sale price at a market: the game's price times the percent, rounded down. */
export const marketPrice = (price, percent) => Math.floor((price * percent) / 100);

/**
 * The best and the worst market known for goods of `cat`: { best: { id, percent }, worst } among `known`
 * ([{ id, prices }]); undefined when nothing known differs from 100%.
 */
export function bestAndWorst(known, cat, processed) {
  let best;
  let worst;
  for (const m of known) {
    const percent = percentFor(m.prices, cat, processed);
    if (best === undefined || percent > best.percent) best = { id: m.id, percent };
    if (worst === undefined || percent < worst.percent) worst = { id: m.id, percent };
  }
  if (best === undefined || (best.percent === 100 && worst.percent === 100)) return undefined;
  return { best, worst };
}
