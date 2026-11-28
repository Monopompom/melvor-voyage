// Port happenings (round 6): shortages, festivals and blockades that come and go on the game clock. Pure: which
// happening a stretch of game time rolls, how long it holds, a shortage filled, a blockade lifted, a festival's
// market and goods, and when the news of one reaches a port. The game side (prices, the boards, the bands) reads it.
//
// Time is cut in slots of SLOT_MS game ms. Each slot rolls at most one shortage or blockade from the character's seed,
// the slot's number and what the game side passes in (the markets, the items you have owned, the seas you sail). A
// roll is kept in the save once made, so what you have owned later never rewrites a happening already under way, and
// a long time away rolls the slots it missed at once on the next read (only those whose happening could still be
// live). Festivals follow the Township season instead: one market a season, the first FESTIVAL_MS of it.

/** Game ms a slot lasts: each one rolls at most one shortage or blockade. [BALANCE] */
export const SLOT_MS = 12 * 60 * 60 * 1000;
/** The chance a slot rolls anything, and the weights of what it rolls. [BALANCE] */
export const SLOT_CHANCE = 0.75;
export const WEIGHTS = { shortage: 3, blockade: 1 };
/** A shortage: this percent of the item's usual price, for this long, until goods worth WANT × the market's depth are sold. */
export const SHORTAGE_PCT = 250;
export const SHORTAGE_MS = 48 * 60 * 60 * 1000;
export const SHORTAGE_WANT = 2;
/** A shortage never wants more than this many items, so a cheap good asks for a stack you could sell (the user, 28 Nov 2026). */
export const SHORTAGE_MAX_ITEMS = 5000;
/** A shortage's want in GP of base value: WANT × the market's depth, at most SHORTAGE_MAX_ITEMS of an item worth `value` each. */
export const shortageWant = (depth, value) => {
  const want = Math.round(depth * SHORTAGE_WANT);
  return value > 0 ? Math.min(want, Math.round(value * SHORTAGE_MAX_ITEMS)) : want;
};
export const MAX_SHORTAGES = 3;
/** A blockade: a band holds one sea of these tiers this long, one tier worse, until BLOCKADE_WINS fights there are won. */
export const BLOCKADE_MS = 72 * 60 * 60 * 1000;
export const BLOCKADE_WINS = 3;
export const BLOCKADE_TIERS = [1, 2, 3];
export const MAX_BLOCKADES = 1;
/** A lifted blockade's bounty: the sea's band purse × this. [BALANCE] */
export const BOUNTY_PURSES = 10;
/** A cargo run to or from a blockaded sea's port pays this much more while it holds. [BALANCE] */
export const CARGO_BONUS = 0.25;
/** A festival: the first FESTIVAL_MS of a season, its goods ×FESTIVAL_MULT, and the market takes FESTIVAL_DEPTH × its depth of them. */
export const FESTIVAL_MS = 24 * 60 * 60 * 1000;
export const FESTIVAL_MULT = 1.5;
export const FESTIVAL_DEPTH = 2;
/** A season without the Township's clock (the Weather setting off, or no town): the game clock in these steps. */
export const OWN_SEASON_MS = 72 * 60 * 60 * 1000;
export const OWN_SEASONS = ['spring', 'summer', 'fall', 'winter'];
/**
 * Each season's festival and its goods: [kind, worked] pairs, `worked` true for the kind's worked goods only, false for
 * its raw goods only, undefined for both. The game's odd seasons hold none.
 */
export const FESTIVALS = {
  spring: { id: 'planting', goods: [['crops'], ['herbs']] },
  summer: { id: 'regatta', goods: [['fish']] },
  fall: { id: 'harvest', goods: [['crops'], ['fish', true]] },
  winter: { id: 'midwinter', goods: [['gems', true], ['logs', false]] },
};
/** The seasons festivals may follow (the game's eight; only four hold one). */
export const FESTIVAL_SEASONS = ['spring', 'summer', 'fall', 'winter', 'nightfall', 'eclipse', 'lemon', 'darkness'];
/** A Township season's length (game ms), to tell when one began from the hours it has left. */
export const SEASON_MS = 72 * 60 * 60 * 1000;
/**
 * The Township season as festivals follow it: the one kept when it is the same season, else this one begun
 * SEASON_MS − `msLeft` ago (now, with no time left told). Returns { key, start }.
 */
export function seasonFrom(kept, key, msLeft, now) {
  if (kept !== undefined && kept.key === key && kept.start <= now && now - kept.start < SEASON_MS + 60 * 60 * 1000) return kept;
  const gone = Number.isFinite(msLeft) ? Math.max(0, SEASON_MS - msLeft) : 0;
  return { key, start: Math.max(0, Math.floor((now - gone) / 60000) * 60000) };
}
/** News of a happening reaches a port this many game ms a hex after it starts (a festival is cried everywhere). [BALANCE] */
export const NEWS_HEX_MS = 30 * 60 * 1000;
/** Slots rolled at most on one read: older ones could hold nothing still live. */
export const ROLL_BACK = Math.ceil(Math.max(SHORTAGE_MS, BLOCKADE_MS) / SLOT_MS);
/** Happenings kept at most in the save (live or ended but not yet dropped). */
export const LIVE_MAX = 12;

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
export function hash(s) {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const pickOne = (list, r) => list[Math.min(list.length - 1, Math.floor(r() * list.length))];
function pickWeighted(list, weightOf, r) {
  const total = list.reduce((s, x) => s + Math.max(0, weightOf(x)), 0);
  if (!(total > 0)) return undefined;
  let x = r() * total;
  for (const it of list) { x -= Math.max(0, weightOf(it)); if (x < 0) return it; }
  return list[list.length - 1];
}

/** The slot a game-clock time falls in. */
export const slotOf = (ms) => Math.floor(Math.max(0, ms) / SLOT_MS);

/** A happening is live at `now` while it has started, not ended and not been filled or lifted. */
export const isLive = (h, now) => h !== undefined && h.done === undefined && h.start <= now && now < h.end;

/**
 * What slot `slot` rolls, or undefined. `ctx`:
 * - `seed`: the character's seed (any string or number);
 * - `live`: the happenings live at the slot's start (for the limits and so one market or sea is never doubled);
 * - `markets`: [{ id, depth, cheap: [kinds it pays little for] }];
 * - `items`: [{ id, kind, value }], the goods you have owned that a market could want (sold for GP, not the mod's own),
 *   `value` the GP one sells for (caps the want);
 * - `seas`: [{ id, tier, weight }], weight your hexes sailed there (0: never sailed, never blockaded);
 * - `bands`: the sea bands a blockade can be.
 */
export function rollSlot(slot, ctx) {
  ctx = ctx ?? {};
  const r = rng(hash(`voyage-happen|${ctx.seed ?? ''}|${slot}`));
  if (r() >= SLOT_CHANCE) return undefined;
  const live = ctx.live ?? [];
  const start = slot * SLOT_MS;
  const shortages = live.filter((h) => h.kind === 'shortage');
  const blockades = live.filter((h) => h.kind === 'blockade');
  // What each kind could pick, so a kind with nothing to pick (no seas sailed, nothing owned) never takes the slot.
  const taken = new Set(shortages.map((h) => h.market));
  const short = new Set(shortages.map((h) => h.item));
  const items = (ctx.items ?? []).filter((it) => !short.has(it.id));
  const markets = shortages.length >= MAX_SHORTAGES ? [] : (ctx.markets ?? []).filter((m) => !taken.has(m.id) && m.depth > 0 && items.some((it) => !(m.cheap ?? []).includes(it.kind)));
  const held = new Set(blockades.map((h) => h.sea));
  const bands = ctx.bands ?? [];
  const seas = blockades.length >= MAX_BLOCKADES || bands.length === 0 ? [] : (ctx.seas ?? []).filter((s) => BLOCKADE_TIERS.includes(s.tier) && s.weight > 0 && !held.has(s.id));
  const kinds = Object.keys(WEIGHTS).filter((k) => (k === 'shortage' ? markets.length > 0 : seas.length > 0));
  const kind = pickWeighted(kinds, (k) => WEIGHTS[k], r);
  if (kind === 'shortage') {
    const m = pickOne(markets, r);
    const it = pickOne(items.filter((x) => !(m.cheap ?? []).includes(x.kind)), r);
    return { id: `${slot}:shortage`, kind, slot, start, end: start + SHORTAGE_MS, market: m.id, item: it.id, want: shortageWant(m.depth, it.value), sold: 0 };
  }
  if (kind === 'blockade') {
    const sea = pickWeighted(seas, (x) => x.weight, r);
    return { id: `${slot}:blockade`, kind, slot, start, end: start + BLOCKADE_MS, sea: sea.id, tier: sea.tier, band: pickOne(bands, r), wins: 0 };
  }
  return undefined;
}

/**
 * The happenings after rolling every slot from the one after `state.at` up to `now`'s, at most ROLL_BACK of them, and
 * dropping those that ended. A first read (no `at`) rolls only the current slot, so a new save never starts with a
 * burst. A slot whose happening ended before `now` (a long time away) keeps nothing.
 */
export function advance(state, now, ctx) {
  const cur = slotOf(now);
  const s = cleanHappen(state);
  let live = s.live.filter((h) => h.end > now);
  const from = s.at < 0 ? cur : Math.max(s.at + 1, cur - ROLL_BACK + 1);
  for (let slot = from; slot <= cur; slot++) {
    const at = slot * SLOT_MS;
    const h = rollSlot(slot, { ...ctx, live: live.filter((x) => isLive(x, at)) });
    if (h !== undefined && h.end > now) live.push(h);
  }
  if (live.length > LIVE_MAX) live = live.sort((a, b) => b.start - a.start).slice(0, LIVE_MAX);
  return { ...s, at: Math.max(s.at, cur), live };
}

/** The happenings live at `now`. */
export const liveAt = (state, now) => (state?.live ?? []).filter((h) => isLive(h, now));

/** The live shortage of an item at a market, or undefined. */
export const shortageOf = (state, market, item, now) => liveAt(state, now).find((h) => h.kind === 'shortage' && h.market === market && h.item === item);

/** What a shortage still wants, in GP of base value. */
export const wantLeft = (h) => Math.max(0, (h?.want ?? 0) - (h?.sold ?? 0));

/**
 * A sale of `value` GP of base value into a shortage: { state, into, over, filled }. `into` is the value the shortage
 * took at its price, `over` what was left over (it sells as usual), `filled` whether it is now over.
 */
export function fill(state, id, value, now) {
  const s = cleanHappen(state);
  const h = s.live.find((x) => x.id === id);
  if (!isLive(h, now) || !(value > 0)) return { state: s, into: 0, over: Math.max(0, value || 0), filled: false };
  const into = Math.min(value, wantLeft(h));
  const next = { ...h, sold: h.sold + into };
  const filled = wantLeft(next) <= 0;
  if (filled) next.done = 'filled';
  return { state: { ...s, live: s.live.map((x) => (x.id === id ? next : x)) }, into, over: value - into, filled };
}

/**
 * The average percent of the usual price a sale of `value` GP of base value fetches against a shortage: SHORTAGE_PCT
 * for the part it still wants, `rest` (the market's own percent, pressure and all) for the part over it.
 */
export function shortageMix(h, value, rest) {
  if (!(value > 0)) return wantLeft(h) > 0 ? SHORTAGE_PCT : rest;
  const into = Math.min(value, wantLeft(h));
  return (into * SHORTAGE_PCT + (value - into) * rest) / value;
}

/** The live blockade of a sea, or undefined. */
export const blockadeOf = (state, sea, now) => liveAt(state, now).find((h) => h.kind === 'blockade' && h.sea === sea);

/** A fight won on a sea: { state, lifted, blockade } (lifted: the win that lifts it). */
export function win(state, sea, now) {
  const s = cleanHappen(state);
  const h = blockadeOf(s, sea, now);
  if (h === undefined) return { state: s, lifted: false, blockade: undefined };
  const next = { ...h, wins: h.wins + 1 };
  const lifted = next.wins >= BLOCKADE_WINS;
  if (lifted) next.done = 'lifted';
  return { state: { ...s, live: s.live.map((x) => (x.id === h.id ? next : x)) }, lifted, blockade: next };
}

/** A lifted blockade's bounty, from the sea band's purse at its tier. */
export const bountyOf = (purse) => Math.max(0, Math.round((purse || 0) * BOUNTY_PURSES));

/**
 * The season festivals follow: the Township's ({ key, start } from the game side) when it has one, else the mod's own
 * from the game clock.
 */
export function ownSeason(now) {
  const n = Math.floor(Math.max(0, now) / OWN_SEASON_MS);
  return { key: OWN_SEASONS[n % OWN_SEASONS.length], start: n * OWN_SEASON_MS };
}

/**
 * The festival of a season, or undefined (an odd season, no city): { id: festival id, kind: 'festival', market,
 * start, end, season, goods }. `cities`: the market ids of cities and the capital, in a fixed order. The same season
 * gives the same market for the same seed.
 */
export function festivalFor(season, seed, cities) {
  const f = FESTIVALS[season?.key];
  if (f === undefined || !Array.isArray(cities) || cities.length === 0 || !Number.isFinite(season.start)) return undefined;
  const r = rng(hash(`voyage-festival|${seed ?? ''}|${season.key}|${Math.floor(season.start / (60 * 60 * 1000))}`));
  const start = Math.floor(season.start);
  return { id: `fest:${season.key}:${start}`, kind: 'festival', festival: f.id, season: season.key, market: pickOne(cities, r), start, end: start + FESTIVAL_MS, goods: f.goods };
}

/** Whether a festival wants goods of `kind` (worked or raw). */
export const festivalWants = (fest, kind, worked) => (fest?.goods ?? []).some(([k, w]) => k === kind && (w === undefined || w === (worked === true)));

/** Game ms when the news of a happening reaches a place `hexes` away: at once for a festival. */
export const newsAt = (h, hexes) => (h?.kind === 'festival' ? h.start : (h?.start ?? 0) + Math.max(0, hexes || 0) * NEWS_HEX_MS);
export const heard = (h, hexes, now) => newsAt(h, hexes) <= now;

const ID = /^(\d{1,9}:(shortage|blockade))$/;
const WORD = /^[\w:]{1,80}$/;
const whole = (n) => (Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);
function cleanOne(h) {
  if (h === null || typeof h !== 'object' || !ID.test(h.id ?? '')) return undefined;
  const base = { id: h.id, kind: h.kind, slot: whole(h.slot), start: whole(h.start), end: whole(h.end) };
  if (!(base.end > base.start) || h.id !== `${base.slot}:${base.kind}`) return undefined;
  if (h.done === 'filled' || h.done === 'lifted') base.done = h.done;
  if (h.kind === 'shortage') {
    if (!WORD.test(h.market ?? '') || !WORD.test(h.item ?? '')) return undefined;
    return { ...base, market: h.market, item: h.item, want: whole(h.want), sold: Math.min(whole(h.sold), whole(h.want)) };
  }
  if (!WORD.test(h.sea ?? '') || !WORD.test(h.band ?? '') || !BLOCKADE_TIERS.includes(h.tier)) return undefined;
  return { ...base, sea: h.sea, tier: h.tier, band: h.band, wins: Math.min(whole(h.wins), BLOCKADE_WINS) };
}
/**
 * The save's `happen`: { at: the last slot rolled (-1: none yet), live: [happenings], told: { [id]: true } the
 * happenings and festivals whose news was told (at most 64), season: { key, start } the Township season festivals last
 * followed and the game ms it began (kept, as the game tells only the hours left) }. Junk dropped, at most LIVE_MAX kept.
 */
export function cleanHappen(raw) {
  const o = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const live = [];
  const seen = new Set();
  for (const h of Array.isArray(o.live) ? o.live : []) {
    const c = cleanOne(h);
    if (c === undefined || seen.has(c.id)) continue;
    seen.add(c.id);
    live.push(c);
  }
  const flags = (x) => Object.fromEntries(Object.entries(x !== null && typeof x === 'object' && !Array.isArray(x) ? x : {}).filter(([k, v]) => v === true && k.length <= 80).slice(0, 64));
  return {
    at: Number.isInteger(o.at) && o.at >= 0 ? o.at : -1,
    live: live.sort((a, b) => b.start - a.start).slice(0, LIVE_MAX),
    told: flags(o.told),
    ...(o.season !== null && typeof o.season === 'object' && FESTIVAL_SEASONS.includes(o.season.key) && Number.isFinite(o.season.start) && o.season.start >= 0
      ? { season: { key: o.season.key, start: Math.floor(o.season.start) } } : {}),
  };
}
