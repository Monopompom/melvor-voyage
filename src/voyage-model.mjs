// The Voyage skill's pure model: its save record with a version and a migration table, XP per hex
// travelled, and what the Wayfinder's Compass shows at each level (4.17). No game objects here; covered by Node tests.

export const SKILL_ID = 'voyage:Voyage';
/** Marks the start of Voyage's own data inside the skill's save region ("VOYG"). */
export const SAVE_MAGIC = 0x564f5947;
export const SAVE_VERSION = 10;

/**
 * Base XP per hex entered (decided 15 Oct 2026: XP per hex travelled, water worth more). Placeholders for the balance
 * pass: level 10 is about 58 land hexes, level 25 about 440. Global XP modifiers apply through Skill.addXP.
 */
export const XP_PER_HEX = { land: 20, water: 40 };
/** A hex lit at night (phase 3e) gives 25% more: the stars pay for the light. */
export const STAR_XP = 0.25;

/** Compass detail by Voyage level. Level 1 is today's reading: temperature and direction (decided 15 Oct 2026). */
export const COMPASS_LEVELS = { steps: 10, name: 25 };

/**
 * `boat` is the small boat (dinghy or longboat), `{ hull, q, r, cond, hold, aboard }` or null; `ship` the big ship
 * (brig, later galleon), `{ hull, q, r, cond, hold }` or null (save v10). The hull
 * id of ship-model.mjs HULLS, the hex it floats on, its condition 0 to 100 % (3d) and its hold. `aboard`: the boat
 * rides on the big ship and sits on its hex. Before v10 `ship` was the small boat and `hold` its hold.
 * `shipChecked` turns true after the first load with ships, which places a free dinghy for a character that phase 2
 * left on the water or on another landmass (existing characters). It runs once per character.
 * `stores` (phase 3c) is what the player has loaded for the road: `food` in HP of healing, `fuel` in units (fractional:
 * the Firemaking discount). `kitGiven` turns true once the one-time starter kit has gone into them.
 * A vessel's `hold` (build .72) is what it carries for you: [{ id, qty }], item ids and whole quantities, one entry a slot.
 * `unlockNotice` (build .104) lists what a mode that buys skills got for free ('cartography', 'voyage') and the player
 * has not been told yet. It is in the save so the notice still comes when the page reloads during the tutorial (16 Oct
 * 2026: a reload mid-tutorial lost it, the flags were in memory).
 * `journal` (phase 4, the Captain's Journal) is what the player has found out: `found` and `missed` map
 * a zoned action id to hexes as "q,r" strings (where it worked, where its zone said no), `places` maps "kind|id" to the
 * hex it was first met on (combat areas fought in, trading places used), `guides` lists the guide pages written, in
 * the order they were written.
 * `navigator` (build .119) turns true once Navigator's Charts are bought: Plan a voyage may Set off.
 */
export function defaultSave() {
  return { v: SAVE_VERSION, landHexes: 0, waterHexes: 0, backfilled: false, boat: null, ship: null, shipChecked: false, stores: { food: 0, fuel: 0 }, kitGiven: false, unlockNotice: [], journal: emptyJournal(), navigator: false };
}

/** The guide pages, in the order the journal lists them. Each is written the first time its rule matters. */
export const JOURNAL_GUIDES = ['terrain', 'zone', 'grace', 'trade', 'combat', 'compass', 'stranded', 'dinghy', 'island'];
/** Kinds of place the journal records. */
export const JOURNAL_PLACE_KINDS = ['combat', 'trade'];
/** Hexes kept per action (found) and misses kept per action (about 20). */
export const JOURNAL_LIMITS = { found: 20, missed: 20 };

/** Voyage levels that each give one free chart (Charting a country). */
export const FREE_CHART_LEVELS = [30, 50, 70, 90];
/** The Voyage level from which Navigator's Charts are sold (build .119; plan-model.mjs NAVIGATOR.level must match). */
export const NAVIGATOR_LEVEL = 60;
/** Plan a voyage opens at this Voyage level, a milestone (build .133): before it you explore by hand. */
export const PLAN_LEVEL = 15;
/** Unread marks kept at most (build .116): the oldest go first. */
export const JOURNAL_UNREAD_MAX = 300;
/** What an unread mark says: a new entry or page, or one that changed since it was last read. */
export const UNREAD_KINDS = ['new', 'more'];

/**
 * The Old Man's present for finding his golbin (build .143, the user's ask): searching Places for "goblin" the first
 * time opens his letter, with confetti, and pays this once per character (journal.golbin). A longboat's worth of coin
 * and tar, with change.
 */
export const GOLBIN_GIFT = { gp: 50000, items: [{ id: 'voyage:Pitch', quantity: 25 }] };

export function emptyJournal() {
  return { found: {}, missed: {}, places: {}, guides: [], charted: [], freeUsed: 0, unread: {}, golbin: false };
}

/**
 * Steps keyed by the version they migrate FROM, applied in order up to SAVE_VERSION. Each step is pure and returns a
 * new record. Empty until the record changes shape (the Worker Folks rule).
 */
export const MIGRATIONS = {
  // 3b: no ship yet; the first load with ships decides whether the character gets a free dinghy
  1: (rec) => ({ ...rec, v: 2, ship: null, shipChecked: false }),
  // 3c: empty stores; the starter kit is still to come
  2: (rec) => ({ ...rec, v: 3, stores: { food: 0, fuel: 0 }, kitGiven: false }),
  // 3d: hull condition; a ship from before it is sound
  3: (rec) => ({ ...rec, v: 4, ship: rec.ship !== null && typeof rec.ship === 'object' ? { ...rec.ship, cond: 100 } : rec.ship }),
  // build .72: the ship's hold, empty
  4: (rec) => ({ ...rec, v: 5, hold: [] }),
  // build .104: nothing waiting to be told
  5: (rec) => ({ ...rec, v: 6, unlockNotice: [] }),
  // phase 4: an empty Captain's Journal
  6: (rec) => ({ ...rec, v: 7, journal: emptyJournal() }),
  // build .116: nothing charted, no free chart used, nothing unread
  7: (rec) => ({ ...rec, v: 8, journal: { ...(rec.journal !== null && typeof rec.journal === 'object' ? rec.journal : {}), charted: [], freeUsed: 0, unread: {} } }),
  // build .119: Navigator's Charts not bought yet
  8: (rec) => ({ ...rec, v: 9, navigator: false }),
  // build .150, two vessels: the small boat and its hold become `boat`; no big ship yet
  9: (rec) => {
    const { hold, ship, ...rest } = rec;
    const boat = ship !== null && typeof ship === 'object' ? { ...ship, hold: Array.isArray(hold) ? hold : [], aboard: false } : null;
    return { ...rest, v: 10, boat, ship: null };
  },
};

const count = (n) => (Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);
const amount = (n) => (Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : 0);
const cleanStores = (st) => ({ food: count(st?.food), fuel: amount(st?.fuel) });
/**
 * The hold: entries with an item id and a positive whole quantity, one per id. Ids the game no longer knows are kept
 * as they are (an expansion switched off): the items come back when it is on again.
 */
function cleanHold(hold) {
  if (!Array.isArray(hold)) return [];
  const out = [];
  for (const e of hold) {
    if (e === null || typeof e !== 'object' || typeof e.id !== 'string' || e.id === '') continue;
    const qty = count(e.qty);
    if (qty <= 0) continue;
    const same = out.find((x) => x.id === e.id);
    if (same !== undefined) same.qty += qty; else out.push({ id: e.id, qty });
  }
  return out;
}

/** A saved vessel, or null when it is missing or malformed. `hulls` is the set of hull ids it may have. */
function cleanVessel(v, hulls) {
  if (v === null || typeof v !== 'object') return null;
  if (!hulls.includes(v.hull) || !Number.isInteger(v.q) || !Number.isInteger(v.r)) return null;
  const cond = Number.isFinite(v.cond) ? Math.min(100, Math.max(0, Math.round(v.cond))) : 100;
  return { hull: v.hull, q: v.q, r: v.r, cond, hold: cleanHold(v.hold) };
}
/** The boat: aboard only with a big ship to ride on, and then on its hex. */
function cleanBoat(v, ship) {
  const boat = cleanVessel(v, BOAT_IDS);
  if (boat === null) return null;
  const aboard = v.aboard === true && ship !== null;
  return aboard ? { ...boat, q: ship.q, r: ship.r, aboard } : { ...boat, aboard };
}

const HEX_RE = /^-?\d{1,4},-?\d{1,4}$/;
const isId = (id) => typeof id === 'string' && id !== '' && id.length <= 128;
/** Unique "q,r" strings, at most `max` (the first ones kept). */
function cleanHexes(list, max) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((h) => typeof h === 'string' && HEX_RE.test(h)))].slice(0, max);
}
/** action id -> hexes, empty lists dropped. Ids the game no longer knows are kept (an expansion switched off). */
function cleanHexMap(map, max) {
  const out = {};
  if (map === null || typeof map !== 'object' || Array.isArray(map)) return out;
  for (const [id, list] of Object.entries(map)) {
    const hexes = cleanHexes(list, max);
    if (isId(id) && hexes.length > 0) out[id] = hexes;
  }
  return out;
}
/** "a:<action id>", "p:<kind|id>" or "g:<guide id>" -> 'new' | 'more', the newest last, at most JOURNAL_UNREAD_MAX. */
function cleanUnread(map) {
  const out = {};
  if (map === null || typeof map !== 'object' || Array.isArray(map)) return out;
  const ok = Object.entries(map).filter(([key, kind]) => /^[apg]:./.test(key) && UNREAD_KINDS.includes(kind));
  for (const [key, kind] of ok.slice(-JOURNAL_UNREAD_MAX)) out[key] = kind;
  return out;
}
/** The journal as saved: anything malformed dropped, never thrown on. */
export function cleanJournal(j) {
  const src = j !== null && typeof j === 'object' ? j : {};
  const places = {};
  if (src.places !== null && typeof src.places === 'object' && !Array.isArray(src.places)) {
    for (const [key, hex] of Object.entries(src.places)) {
      const bar = key.indexOf('|');
      if (bar <= 0 || !JOURNAL_PLACE_KINDS.includes(key.slice(0, bar)) || !isId(key.slice(bar + 1))) continue;
      if (typeof hex === 'string' && HEX_RE.test(hex)) places[key] = hex;
    }
  }
  return {
    found: cleanHexMap(src.found, JOURNAL_LIMITS.found),
    missed: cleanHexMap(src.missed, JOURNAL_LIMITS.missed),
    places,
    // In the order they were written (the Guide index shows them so); unknown ids and repeats dropped.
    guides: (Array.isArray(src.guides) ? src.guides : []).filter((g, i, all) => JOURNAL_GUIDES.includes(g) && all.indexOf(g) === i),
    // Action ids in the order charted; a chart is never undone.
    charted: (Array.isArray(src.charted) ? src.charted : []).filter((id, i, all) => isId(id) && all.indexOf(id) === i),
    freeUsed: Math.min(FREE_CHART_LEVELS.length, count(src.freeUsed)),
    unread: cleanUnread(src.unread),
    // The golbin's purse was given (GOLBIN_GIFT); a save without it never had it.
    golbin: src.golbin === true,
  };
}

/** What `unlockNotice` may hold, in the order the notice names them. */
export const FREE_UNLOCKS = ['cartography', 'voyage'];

/** Hull ids a save may name. Kept here so the model stays free of imports; ship-model.mjs HULLS must match. */
export const BOAT_IDS = ['dinghy', 'longboat'];
export const SHIP_IDS = ['brig', 'galleon'];
export const HULL_IDS = [...BOAT_IDS, ...SHIP_IDS];

function clean(rec) {
  const ship = cleanVessel(rec.ship, SHIP_IDS);
  return {
    v: SAVE_VERSION,
    landHexes: count(rec.landHexes),
    waterHexes: count(rec.waterHexes),
    backfilled: rec.backfilled === true,
    boat: cleanBoat(rec.boat, ship),
    ship,
    shipChecked: rec.shipChecked === true,
    stores: cleanStores(rec.stores),
    kitGiven: rec.kitGiven === true,
    unlockNotice: FREE_UNLOCKS.filter((x) => Array.isArray(rec.unlockNotice) && rec.unlockNotice.includes(x)),
    journal: cleanJournal(rec.journal),
    navigator: rec.navigator === true,
  };
}

/**
 * Reads a saved JSON string. Never throws: unreadable data gives a fresh record with `corrupt`, a newer version than
 * this build knows gives a fresh record with `future` (the caller keeps the raw string so it is written back as is).
 */
export function loadSave(json) {
  const report = { applied: [], corrupt: false, future: false };
  let raw;
  try { raw = JSON.parse(json); } catch { return { save: defaultSave(), report: { ...report, corrupt: true } }; }
  if (raw === null || typeof raw !== 'object' || !Number.isInteger(raw.v) || raw.v < 1) {
    return { save: defaultSave(), report: { ...report, corrupt: true } };
  }
  if (raw.v > SAVE_VERSION) return { save: defaultSave(), report: { ...report, future: true } };
  let rec = raw;
  while (rec.v < SAVE_VERSION) {
    const step = MIGRATIONS[rec.v];
    if (step === undefined) return { save: defaultSave(), report: { ...report, corrupt: true } };
    report.applied.push(rec.v);
    rec = step(rec);
  }
  return { save: clean(rec), report };
}

export function serializeSave(save) {
  return JSON.stringify(clean(save));
}

/**
 * XP for one move. `steps` are the hexes entered, each `{ water, fastTravel, free, hop, hungry, lit }`. A fast-travel
 * hop sailed between ports (`hop`, phase 3c) counts as that many water hexes; a vanilla hop (ship rules off) gives
 * nothing. Nor do `free` steps (the homeward rule's moves back within the hull's reach) or `hungry`
 * ones (walked on empty stores, 4.4). None of those counts as a hex travelled. A `lit` step (night, 3e) adds STAR_XP.
 */
export function xpForSteps(steps) {
  let land = 0;
  let water = 0;
  let stars = 0;
  for (const s of steps) {
    if (s.hop > 0 && !s.free && !s.hungry) {
      water += s.hop;
      if (s.lit) stars += s.hop * XP_PER_HEX.water;
      continue;
    }
    if (s.fastTravel || s.free || s.hungry) continue;
    if (s.water) water += 1; else land += 1;
    if (s.lit) stars += s.water ? XP_PER_HEX.water : XP_PER_HEX.land;
  }
  return { land, water, xp: land * XP_PER_HEX.land + water * XP_PER_HEX.water + Math.round(stars * STAR_XP) };
}

/**
 * One-time XP for a character that travelled before the Voyage skill existed, from the game's own HexesTravelled
 * stat. The stat does not tell land from water, so every hex counts as land.
 */
export function backfillXP(hexesTravelled) {
  return count(hexesTravelled) * XP_PER_HEX.land;
}

/** What the compass reading includes at a Voyage level. */
export function compassDetail(level) {
  return { steps: level >= COMPASS_LEVELS.steps, name: level >= COMPASS_LEVELS.name };
}

/** Every compass stage, for the skill page and the milestones. */
export const COMPASS_STAGES = [
  { level: 1, text: 'How close (Hot, Warm, Cold, Freezing) and which way' },
  { level: COMPASS_LEVELS.steps, text: 'Also how many hexes away' },
  { level: COMPASS_LEVELS.name, text: 'Also the name of the place' },
];

/** The next compass stage above `level`, or undefined at the top. */
export function nextCompassStage(level) {
  return COMPASS_STAGES.find((s) => s.level > level);
}
