// Encounters (design 4.33): where bands are met and what is at stake. Danger tiers (the seas by hand, land by its
// ground), the odds a hex, the breather after a band, the toll and the band's purse, the graded loss and draw,
// Battered, and how your levels reach the fight (a card's skill tilt, the loot grade), and the save's record. Pure: no
// game globals.

/** The danger tier of each chart sea (charts-model seas(), keyed by its port), 1 near home to 4 far out. [BALANCE] */
export const SEA_TIER = {
  BeginningPort: 1, SnowCoveredPier: 1, ShadowedPort: 1,
  BeaconPort: 2, BustlingPort: 2, FrostDriftPort: 2, WhisperingPort: 2,
  MistyPort: 3, PortOfNations: 3, VibrantPort: 3,
  FriendlyPort: 4, MulticulturalPort: 4, OminousPort: 4,
};
/** A sea hex next to the cloud is the cloud's edge: always tier 4. */
export const CLOUD_EDGE_TIER = 4;
/** The danger tier of land by its ground (terrain class); water and unknown ground are 0. */
export const GROUND_TIER = {
  grasslands: 0, kingslands: 0, beach: 0,
  highlands: 1, mountain: 1, desert: 1, swamplands: 1,
  badlands: 2, snowlands: 2,
  wastelands: 3, lavalands: 3, cursedlands: 3,
};
/** Within this many hexes of Bandit Hideout, land is one tier worse (at most 4). */
export const HIDEOUT_REACH = 2;
/** Bandit Hideout's hex (the map's point of interest). */
export const HIDEOUT_HEX = { q: 25, r: 5 };
export const MAX_TIER = 4;

/** A sea hex's tier: its chart sea's, 4 at the cloud's edge, 0 for no sea. */
export function seaTier(sea, cloudEdge = false) {
  if (cloudEdge) return CLOUD_EDGE_TIER;
  return SEA_TIER[sea] ?? 0;
}
/** A land hex's tier: its ground's, +1 near Bandit Hideout (dist in hexes; ground 0 stays safe only away from it). */
export function landTier(ground, hideoutDist = Infinity) {
  const base = GROUND_TIER[ground] ?? 0;
  return Math.min(MAX_TIER, base + (hideoutDist <= HIDEOUT_REACH ? 1 : 0));
}

/** The odds a hex entered meets a band, by tier. */
export const ODDS = [0, 1 / 300, 1 / 150, 1 / 100, 1 / 60];
/** Whether a hex of this tier meets a band at `roll` (0 to 1); a debt to its band doubles the odds. */
export function meets(tier, roll, debt = false) {
  const p = (ODDS[tier] ?? 0) * (debt ? 2 : 1);
  return Number.isFinite(roll) && roll >= 0 && roll < p;
}
/** After a band, no band for this many hexes (any ground), so one long trip can't stack tolls. */
export const BREATHER = 20;

/** A band for a tier's ground: one of `bands` (encounter-model bandsOf), picked by `roll`. */
export const pickBand = (bands, roll) => bands[Math.min(bands.length - 1, Math.max(0, Math.floor(roll * bands.length)))];
/** The band's strength: your calibrated strength × a random 0.8 to 1.2 a band. */
export const bandRoll = (roll) => 0.8 + 0.4 * roll;

/** The toll's share of the GP you carry, by tier: deeper ground, dearer peace. */
export const TOLL_PCT = [0, 5, 7, 10, 14];
/** A toll is never under this many hexes of the ground's fare (the GP the game charges a hex). */
export const FARE_HEXES = 3;
/** At sea the toll is at least this share of the hold's worth. */
export const HOLD_SHARE = 0.25;
/** A won purse is the band's own, by tier: it doesn't grow with what you carry, so wins can't print GP. */
export const PURSE = { land: [0, 2000, 5000, 12000, 30000], sea: [0, 3000, 7500, 18000, 45000] };
export const purseOf = (where, tier) => PURSE[where === 'sea' ? 'sea' : 'land'][tier] ?? 0;
/** A loss puts the toll and this share of what you carry at stake. */
export const LOSS_SHARE = 0.1;

const num = (x) => (Number.isFinite(x) && x > 0 ? x : 0);
/** A band you owe claims this many points more of the GP you carry (a tier 1 toll of 5% becomes 15%). */
export const DEBT_PCT = 10;
/**
 * The toll and the rule that set it: `{ toll, rule }`, rule 'gp' (the tier's share of the GP you carry), 'fare' (the
 * floor of a few hexes' fare) or 'hold' (at sea, a quarter of the hold's worth). Whole GP, at least 1.
 */
export function tollOf({ where, tier, gp, hexGp, holdWorth = 0, debt = false }) {
  const byGp = ((TOLL_PCT[tier] ?? 0) + (debt ? DEBT_PCT : 0)) / 100 * num(gp);
  const fare = FARE_HEXES * num(hexGp);
  const hold = where === 'sea' ? HOLD_SHARE * num(holdWorth) : 0;
  const rule = hold > 0 && hold >= byGp && hold >= fare ? 'hold' : byGp >= fare ? 'gp' : 'fare';
  return { toll: Math.max(1, Math.round(Math.max(byGp, fare, hold))), rule };
}
/** What a loss puts at stake: the toll and a tenth of what you carry. */
export const stakeOf = (toll, gp) => Math.round(num(toll) + num(gp) * LOSS_SHARE);
/** The share of their Nerve still standing (0 to 1). */
export const nerveLeft = (nerve, max) => (max > 0 ? Math.min(1, Math.max(0, nerve / max)) : 0);

/**
 * A fight's settling in GP, against the GP you carried when it began (`gp`): `{ now, purse, take, stake, battered }`.
 * now: the GP change at once (Coin spent and grabs, then what a draw or loss takes, or half the purse a fleeing band
 * drops); purse: what a win banks (before Press on), with what they grabbed and the Cut the Purse Strings bonus;
 * short: what a draw or loss claims beyond the GP you carry (it becomes a debt); battered: whether you leave Battered.
 * f: the fight's end (encounter-model state: over, spent, grabbed, bonusPct,
 * band nerve and max, def.keepGrabs).
 */
export function settle(f, { toll, purse: base, gp }) {
  const spent = num(f.spent);
  const grabbed = num(f.grabbed);
  const left = nerveLeft(f.band?.nerve ?? 0, f.band?.max ?? 0);
  const carried = Math.max(0, num(gp) - spent - grabbed);
  const out = { now: -spent - grabbed, purse: 0, take: 0, short: 0, stake: 0, left, battered: false };
  if (f.over === 'win') {
    out.purse = Math.round(base * (1 + num(f.bonusPct) / 100)) + grabbed;
  } else if (f.over === 'fled') {
    const keeps = f.def?.keepGrabs === true;
    out.now += Math.round(base / 2) + (keeps ? 0 : grabbed);
  } else if (f.over === 'draw') {
    const want = Math.round(num(toll) * left);
    out.take = Math.min(carried, want);
    out.short = want - out.take;
    out.now -= out.take;
  } else if (f.over === 'lose') {
    out.stake = stakeOf(toll, carried);
    const want = Math.round(out.stake * left);
    out.take = Math.min(carried, want);
    out.short = want - out.take;
    out.now -= out.take;
    out.battered = true;
  }
  return out;
}
/** After Press on: a broken captain doubles the purse; one that holds leaves you half of it, and Battered. */
export const pressPurse = (purse, won) => Math.round(num(purse) * (won ? 2 : 0.5));

/** Battered: each loss takes BATTER Resolve from your next fights, up to this many losses. */
export const BATTERED_MAX = 3;
/** It heals with a night's rest (this long in a town or port) or by eating this much food from the stores. */
export const REST_MS = 8 * 3600 * 1000;
export const PATCH_FOOD = 200;
export const batteredAfterLoss = (b) => Math.min(BATTERED_MAX, Math.max(0, Math.floor(num(b))) + 1);

// ---- offline and debt -------------------------------------------------------------------------------------------------
/**
 * Offline nobody stops: each band met is kept (band, tier, where, ground, toll, purse) and on your return they fold
 * into one encounter, led by the strongest (the highest tier, then the dearest toll). Its toll and its purse are the
 * sums of the AWAY_CAP biggest, so a long absence costs at most three encounters' worth.
 */
export const AWAY_CAP = 3;
/** The save keeps at most this many (the weakest go first; only the three biggest count anyway). */
export const AWAY_MAX = 30;
const stronger = (a, b) => b.tier - a.tier || b.toll - a.toll;
const topSum = (list, key) => list.map((x) => num(x[key])).sort((a, b) => b - a).slice(0, AWAY_CAP).reduce((a, b) => a + b, 0);
/** Adds a band met while away to the list (a new list), dropping the weakest past AWAY_MAX. */
export const awayAdd = (list, met) => [...(list ?? []), met].sort(stronger).slice(0, AWAY_MAX);
/** The waiting encounter: `{ lead, toll, purse, n }`, or undefined when nobody was met. */
export function foldAway(list) {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  const sorted = list.slice().sort(stronger);
  return { lead: sorted[0], toll: Math.max(1, Math.round(topSum(list, 'toll'))), purse: Math.round(topSum(list, 'purse')), n: list.length };
}
/**
 * Debts: what your GP couldn't cover, owed to that band on that ground (the bandits of a ground, the pirates of a
 * sea), `{ '<band>:<ground>': GP }`. While you owe a band there, a hex of that ground meets a band twice as often (the
 * extra half meets a band you owe) and the band you owe claims DEBT_PCT points more. A debt never grows; it is paid
 * off, whole or in part, wherever you can trade.
 */
export const debtKey = (band, ground) => `${band}:${ground}`;
export const debtOf = (debts, band, ground) => num(debts?.[debtKey(band, ground)]);
/** The bands of `bands` you owe on this ground. */
export const creditors = (debts, bands, ground) => bands.filter((b) => debtOf(debts, b, ground) > 0);
/**
 * Whether a hex of this tier meets a band at `roll` (0 to 1) when you owe `owed` there: undefined for nobody,
 * `{ band: undefined }` for any band of the ground, `{ band }` for one you owe (the doubled odds' extra half).
 */
export function meetOn(tier, roll, owed = []) {
  const p = ODDS[tier] ?? 0;
  if (!(p > 0) || !Number.isFinite(roll) || roll < 0) return undefined;
  if (roll < p) return { band: undefined };
  if (owed.length > 0 && roll < 2 * p) return { band: owed[Math.min(owed.length - 1, Math.floor(((roll - p) / p) * owed.length))] };
  return undefined;
}
/**
 * What a folded encounter couldn't take, shared by its bands as their tolls stand (`parts` [{ band, ground, toll }]):
 * `{ key: GP }`, the whole GP, the rounding on the biggest share.
 */
export function shareDebt(parts, gp) {
  const amount = Math.round(num(gp));
  const out = {};
  if (amount === 0 || !Array.isArray(parts) || parts.length === 0) return out;
  const total = parts.reduce((a, x) => a + num(x.toll), 0);
  let given = 0;
  let big;
  for (const x of parts) {
    const key = debtKey(x.band, x.ground);
    const share = total > 0 ? Math.floor((amount * num(x.toll)) / total) : 0;
    out[key] = (out[key] ?? 0) + share;
    given += share;
    if (big === undefined || num(x.toll) > big.toll) big = { key, toll: num(x.toll) };
  }
  out[big.key] += amount - given;
  for (const key of Object.keys(out)) if (out[key] <= 0) delete out[key];
  return out;
}
/** Debts after adding `add` ({ key: GP }); a new object. */
export const owe = (debts, add) => {
  const out = { ...(debts ?? {}) };
  for (const [key, gp] of Object.entries(add ?? {})) if (num(gp) > 0) out[key] = Math.round(num(out[key]) + num(gp));
  return out;
};
/**
 * Paying off debts with `gp`: the biggest first, each whole or in part. `{ debts, paid }`, the debts left (a new object,
 * settled ones gone) and the GP paid.
 */
export function payDebts(debts, gp) {
  let left = Math.floor(num(gp));
  const out = { ...(debts ?? {}) };
  let paid = 0;
  for (const [key, owed] of Object.entries(out).sort((a, b) => b[1] - a[1])) {
    if (left <= 0) break;
    const p = Math.min(left, num(owed));
    out[key] = num(owed) - p;
    if (out[key] <= 0) delete out[key];
    left -= p;
    paid += p;
  }
  return { debts: out, paid };
}

/** Running on land: the next hex's time again, and this share of your food and fuel dropped. */
export const RUN_LAND_DROP = 0.15;

/**
 * How your levels tilt the cards: a card's skill reads +1 when it is TILT_GAP or more levels above your average
 * level, −1 when as far below. `levels`: { skill name: level } (encounter-model's names: Attack, Voyage, …).
 */
export const TILT_GAP = 10;
export function tiltOf(levels) {
  const vals = Object.values(levels ?? {}).filter((x) => Number.isFinite(x));
  if (vals.length === 0) return {};
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const out = {};
  for (const [k, v] of Object.entries(levels)) {
    if (!Number.isFinite(v)) continue;
    if (v - avg >= TILT_GAP) out[k] = 1;
    else if (avg - v >= TILT_GAP) out[k] = -1;
  }
  return out;
}
/** The loot grade, 1 to 5, from the mean of your five best skill levels: under 30, 30+, 60+, 90+, past 99. */
export const GRADE_STEPS = [30, 60, 90, 100];
export function gradeOf(allLevels) {
  const best = (allLevels ?? []).filter((x) => Number.isFinite(x)).sort((a, b) => b - a).slice(0, 5);
  if (best.length === 0) return 1;
  const mean = best.reduce((a, b) => a + b, 0) / best.length;
  return 1 + GRADE_STEPS.filter((x) => mean >= x).length;
}

// ---- the save --------------------------------------------------------------------------------------------------------
// `E` is encounter-model.mjs (the cards, tricks, bands and charms the record may name), handed in: the game loads each
// module on its own, so one can't import another.
const isInt = (x) => Number.isInteger(x);
const plain = (o) => (o !== null && typeof o === 'object' && !Array.isArray(o) ? o : undefined);
const intIn = (x, lo, hi, d = lo) => (isInt(x) && x >= lo && x <= hi ? x : d);
/** A deck you may carry: card ids of the cards a deck can hold (not the ship's, a Folk's or Dread), 15 to 25 of them. */
export const deckCard = (id, E) => typeof id === 'string' && E.CARDS[id] !== undefined && !['ship', 'folk', 'curse'].includes(E.CARDS[id].src);
export function cleanDeck(raw, E) {
  if (!Array.isArray(raw)) return E.STARTER.slice();
  const deck = raw.filter((id) => deckCard(id, E));
  return deck.length === raw.length && deck.length >= E.DECK_MIN && deck.length <= E.DECK_MAX ? deck : E.STARTER.slice();
}
/** The most actions a fight records (six rounds and a Press on are far fewer). */
export const ACTIONS_MAX = 400;
const cleanTilt = (raw) => {
  const out = {};
  for (const [k, v] of Object.entries(plain(raw) ?? {})) if (/^\w{1,40}$/.test(k) && (v === 1 || v === -1)) out[k] = v;
  return out;
};
/** A text the result shows ({ key, vars, gp? }): a language key of the mod, its numbers and words plain. */
const cleanLine = (l) => {
  if (plain(l) === undefined || typeof l.key !== 'string' || !/^MOD_VOY_[A-Z0-9_]+$/.test(l.key)) return undefined;
  const vars = {};
  for (const [k, v] of Object.entries(plain(l.vars) ?? {})) {
    if (!/^\w{1,20}$/.test(k)) continue;
    if (Number.isFinite(v) || (typeof v === 'string' && v.length <= 200)) vars[k] = v;
    else if (Array.isArray(v) && v.length <= 8 && v.every((x) => typeof x === 'string' && x.length <= 80)) vars[k] = v.slice();
  }
  return { key: l.key, vars, ...(Number.isFinite(l.gp) ? { gp: Math.round(l.gp) } : {}) };
};
const cleanLoot = (x, CHARMS) => {
  if (plain(x) === undefined || !['haul', 'stash', 'rare'].includes(x.kind)) return undefined;
  if (typeof x.trophy === 'string' && CHARMS[x.trophy]?.trophy !== undefined) return { trophy: x.trophy, qty: 1, kind: 'rare' };
  if (typeof x.id !== 'string' || !/^\w+:\w+$/.test(x.id) || !(isInt(x.qty) && x.qty > 0)) return undefined;
  return { id: x.id, qty: x.qty, kind: x.kind };
};
/** Bands met while away: `{ band, tier, where, ground, toll, purse }`, junk dropped, at most AWAY_MAX. */
function cleanAway(raw, BANDS) {
  const out = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    if (plain(x) === undefined || BANDS[x.band] === undefined || !(isInt(x.tier) && x.tier >= 1 && x.tier <= MAX_TIER)) continue;
    if (x.where !== 'land' && x.where !== 'sea') continue;
    if (typeof x.ground !== 'string' || !/^\w{0,40}$/.test(x.ground)) continue;
    out.push({ band: x.band, tier: x.tier, where: x.where, ground: x.ground, toll: Number.isFinite(x.toll) && x.toll >= 1 ? Math.round(x.toll) : 1, purse: Number.isFinite(x.purse) && x.purse >= 0 ? Math.round(x.purse) : 0 });
  }
  return out.sort(stronger).slice(0, AWAY_MAX);
}
/**
 * The open encounter: `opt` the fight's options as it began (newFight's, so a reload replays it on the same seed),
 * `stage` meet, fight or result, `actions` taken so far, and the stakes: toll (its rule), purse, `where` and the
 * ground or sea it was met on, `debt` what you owed that band there when it began, `away` set when it is the fold of
 * the bands met while you were away (`n` of them, their `parts`). `res`: the result shown (head, tone, lines, the purse and loot not yet banked, whether
 * Press on is open). `done`: how it ended, for the voyage it held (pay, run, fight).
 */
export function cleanFight(raw, E) {
  const { CARDS, TRICKS, BANDS, CHARMS, STARTER } = E;
  const f = plain(raw);
  const o = plain(f?.opt);
  if (o === undefined || BANDS[o.band] === undefined || !(isInt(o.tier) && o.tier >= 1 && o.tier <= MAX_TIER)) return null;
  if (o.where !== 'land' && o.where !== 'sea') return null;
  if (!(isInt(o.seed) && o.seed > 0) || !(Number.isFinite(o.strength) && o.strength > 0 && o.strength < 50)) return null;
  const opt = {
    band: o.band, tier: o.tier, where: o.where, seed: o.seed, strength: o.strength,
    deck: Array.isArray(o.deck) && o.deck.length <= 60 && o.deck.every((id) => CARDS[id] !== undefined) ? o.deck.slice() : STARTER.slice(),
    cannons: intIn(o.cannons, 0, 8), hull: o.hull === true,
    charms: Array.isArray(o.charms) ? o.charms.filter((c) => CHARMS[c] !== undefined).slice(0, 3) : [],
    tilt: cleanTilt(o.tilt), gp: Number.isFinite(o.gp) && o.gp > 0 ? Math.floor(o.gp) : 0,
    toll: Number.isFinite(o.toll) && o.toll >= 1 ? Math.round(o.toll) : 1, battered: intIn(o.battered, 0, BATTERED_MAX),
    know: Array.isArray(o.know) ? o.know.filter((k) => TRICKS[k] !== undefined) : [], learn: true,
  };
  const actions = [];
  for (const a of Array.isArray(f.actions) ? f.actions.slice(0, ACTIONS_MAX) : []) {
    if (!Array.isArray(a)) break;
    if ((a[0] === 'p' || a[0] === 't') && isInt(a[1]) && a[1] >= 0 && a[1] < 20) actions.push([a[0], a[1]]);
    else if (a[0] === 'e' || a[0] === 'o') actions.push([a[0]]);
    else break;
  }
  const out = {
    opt, actions,
    stage: ['meet', 'fight', 'result'].includes(f.stage) ? f.stage : 'meet',
    debt: Number.isFinite(f.debt) && f.debt > 0 ? Math.round(f.debt) : 0,
    roll: Number.isFinite(f.roll) && f.roll > 0 ? f.roll : 1,
    rule: ['gp', 'fare', 'hold'].includes(f.rule) ? f.rule : 'gp',
    purse: Number.isFinite(f.purse) && f.purse >= 0 ? Math.round(f.purse) : 0,
    ground: typeof f.ground === 'string' && /^\w{0,40}$/.test(f.ground) ? f.ground : '',
  };
  // A folded offline encounter: how many bands, and each one's part (its toll shares out what can't be paid).
  const away = plain(f.away);
  if (away !== undefined && isInt(away.n) && away.n >= 1) {
    const parts = cleanAway(away.parts, BANDS);
    if (parts.length > 0) out.away = { n: Math.min(away.n, 999), parts };
  }
  const r = plain(f.res);
  if (r !== undefined) {
    out.res = {
      head: cleanLine(r.head) ?? { key: 'MOD_VOY_ENC_LOG_DRAW', vars: {} },
      tone: ['good', 'mid', 'bad'].includes(r.tone) ? r.tone : 'mid',
      lines: (Array.isArray(r.lines) ? r.lines : []).map(cleanLine).filter(Boolean).slice(0, 40),
      purse: Number.isFinite(r.purse) && r.purse > 0 ? Math.round(r.purse) : 0,
      loot: (Array.isArray(r.loot) ? r.loot : []).map((x) => cleanLoot(x, CHARMS)).filter(Boolean).slice(0, 20),
      press: r.press === true, banked: r.banked === true, auto: r.auto === true,
      done: ['pay', 'run', 'fight'].includes(r.done) ? r.done : 'fight',
      owed: Number.isFinite(r.owed) && r.owed > 0 ? Math.round(r.owed) : 0,
    };
    const pair = (p) => (Array.isArray(p) && p.length === 2 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 1e6) && p[0] <= p[1] && p[1] > 0 ? [p[0], p[1]] : undefined);
    const end = plain(r.end);
    if (end !== undefined && pair(end.you) && pair(end.band)) out.res.end = { you: pair(end.you), band: pair(end.band), captain: end.captain === true };
  }
  return out;
}
/**
 * The Voyage save's `enc` (save v25): `deck` (15 to 25 card ids, the starter for a new save), `battered` (0 to 3),
 * `rest` (ms rested in a town or port towards curing it), `calm` (hexes of breather left), `cal` (the calibration
 * cache: `key` the kit it was measured for, `values` { 'land:2': strength }), `tricks` found, `trophies` won { charm: true },
 * `owned` cards { id: count }, `fight` the open encounter or null, `met` bands met so far, `away` the bands met while
 * you were away (waiting to fold into one encounter), `debts` { '<band>:<ground>': GP }.
 */
export function cleanEnc(raw, E) {
  const { TRICKS, CHARMS } = E;
  const e = plain(raw) ?? {};
  const cal = plain(e.cal);
  const values = {};
  for (const [k, v] of Object.entries(plain(cal?.values) ?? {})) if (/^(land|sea):[1-4]$/.test(k) && Number.isFinite(v) && v > 0 && v < 50) values[k] = v;
  const owned = {};
  for (const [k, v] of Object.entries(plain(e.owned) ?? {})) if (deckCard(k, E) && isInt(v) && v > 0) owned[k] = Math.min(v, 99);
  const trophies = {};
  for (const k of Object.keys(plain(e.trophies) ?? {})) if (CHARMS[k]?.trophy !== undefined && e.trophies[k] === true) trophies[k] = true;
  const debts = {};
  for (const [key, gp] of Object.entries(plain(e.debts) ?? {})) {
    const [band, ground, extra] = key.split(':');
    if (extra === undefined && E.BANDS[band] !== undefined && /^\w{1,40}$/.test(ground ?? '') && Number.isFinite(gp) && gp >= 1) debts[key] = Math.min(Math.round(gp), 1e15);
  }
  return {
    deck: cleanDeck(e.deck, E),
    battered: intIn(e.battered, 0, BATTERED_MAX),
    rest: Number.isFinite(e.rest) && e.rest > 0 ? Math.min(Math.floor(e.rest), REST_MS) : 0,
    calm: intIn(e.calm, 0, BREATHER),
    cal: { key: typeof cal?.key === 'string' && cal.key.length <= 4000 ? cal.key : '', values },
    tricks: (Array.isArray(e.tricks) ? e.tricks : []).filter((k, i, a) => TRICKS[k] !== undefined && a.indexOf(k) === i),
    trophies,
    owned,
    fight: cleanFight(e.fight, E),
    met: isInt(e.met) && e.met > 0 ? e.met : 0,
    away: cleanAway(e.away, E.BANDS),
    debts,
  };
}
/** The calibration cache's key: the kit a band's strength was measured against (deck, charms, skill tilts). */
export const calKey = ({ deck = [], charms = [], tilt = {} }) => JSON.stringify([deck.slice().sort(), charms.slice().sort(), Object.entries(tilt).sort()]);
