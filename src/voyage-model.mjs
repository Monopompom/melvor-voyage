// The Voyage skill's pure model: its save record with a version and a migration table, XP per hex
// travelled, and what the Wayfinder's Compass shows at each level (4.17). No game objects here; covered by Node tests.

export const SKILL_ID = 'voyage:Voyage';
/** Marks the start of Voyage's own data inside the skill's save region ("VOYG"). */
export const SAVE_MAGIC = 0x564f5947;
export const SAVE_VERSION = 23;

/**
 * Base XP per hex entered (decided 15 Oct 2026: XP per hex travelled, water worth more). Placeholders for the balance
 * pass: level 10 is about 58 land hexes, level 25 about 440. Global XP modifiers apply through Skill.addXP.
 */
export const XP_PER_HEX = { land: 20, water: 40 };
/** A hex lit at night (phase 3e) gives 25% more: the stars pay for the light. */
export const STAR_XP = 0.25;

/**
 * Discovery XP (balance pass): the first time you ever enter a hex, land or sea; a hex under cloud
 * never pays. About 80,000 over the map, so exploring pays more than walking the same road again.
 */
export const DISCOVERY_XP = 100;
/** Each Voyage level cuts the game's hex travel cost by this many percent (4.26): -15% at 30, -49.5% at 99. */
export const TRAVEL_DISCOUNT_PER_LEVEL = 0.5;
/** The travel discount in percent at a Voyage level (a positive number; the modifier is its negative). */
export const travelDiscount = (level) => TRAVEL_DISCOUNT_PER_LEVEL * Math.max(0, Math.min(99, Math.floor(level) || 0));

/**
 * Visited hexes (save v11): one bit per hex of the AoD map, kept as base64. The map is 32 columns (q 0..31) of 30
 * offset rows (r + floor(q / 2) in 0..29), so bit q * 30 + row; 960 bits, 120 bytes, 160 characters. A hex outside the
 * grid has no bit and is never counted.
 */
export const VISITED_COLS = 32;
export const VISITED_ROWS = 30;
export const VISITED_BYTES = (VISITED_COLS * VISITED_ROWS) / 8;
export function visitedBit(q, r) {
  if (!Number.isInteger(q) || !Number.isInteger(r) || q < 0 || q >= VISITED_COLS) return -1;
  const row = r + Math.floor(q / 2);
  return row < 0 || row >= VISITED_ROWS ? -1 : q * VISITED_ROWS + row;
}
const toBytes = (b64) => {
  const out = new Uint8Array(VISITED_BYTES);
  if (typeof b64 !== 'string' || b64 === '') return out;
  try {
    const bin = atob(b64);
    for (let i = 0; i < Math.min(bin.length, VISITED_BYTES); i++) out[i] = bin.charCodeAt(i);
  } catch { /* malformed: nothing visited */ }
  return out;
};
const fromBytes = (bytes) => (bytes.every((b) => b === 0) ? '' : btoa(String.fromCharCode(...bytes)));
/** Whether hex (q, r) is marked in `visited`. */
export function isVisited(visited, q, r) {
  const bit = visitedBit(q, r);
  return bit >= 0 && (toBytes(visited)[bit >> 3] & (1 << (bit & 7))) !== 0;
}
/** Marks `hexes` ({ q, r }) visited: the new string and how many were new. */
export function markVisited(visited, hexes) {
  const bytes = toBytes(visited);
  let added = 0;
  for (const h of hexes) {
    const bit = visitedBit(h?.q, h?.r);
    if (bit < 0 || (bytes[bit >> 3] & (1 << (bit & 7))) !== 0) continue;
    bytes[bit >> 3] |= 1 << (bit & 7);
    added += 1;
  }
  return { visited: fromBytes(bytes), added };
}
/** How many hexes `visited` marks. */
export function visitedCount(visited) {
  let n = 0;
  for (const b of toBytes(visited)) for (let x = b; x !== 0; x &= x - 1) n += 1;
  return n;
}
/** The journal's hexes ("q,r" in found, missed and places), for the v11 migration: where you have certainly been. */
export function journalHexes(journal) {
  const out = [];
  const add = (key) => { const m = typeof key === 'string' ? /^(-?\d+),(-?\d+)$/.exec(key) : null; if (m) out.push({ q: Number(m[1]), r: Number(m[2]) }); };
  if (journal !== null && typeof journal === 'object') {
    for (const list of [...Object.values(journal.found ?? {}), ...Object.values(journal.missed ?? {})]) if (Array.isArray(list)) list.forEach(add);
    for (const hex of Object.values(journal.places ?? {})) add(hex);
  }
  return out;
}

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
 * `visited` (save v11, the balance pass) is the hexes ever entered, as base64 bits (visitedBit): each pays DISCOVERY_XP once.
 * `sign` (save v12) is the full id of the POI the Crossroads Sign stands on, '' while carried or not bought.
 * `cargo` (save v13) is the cargo runs: `boards` (each port's requests this season) and `runs` (taken);
 * cargo-model.mjs cleanCargo checks it in depth when the runtime reads it (modules here can't import each other).
 * `charted` (save v14) is the hexes a sea chart or a rumour cleared of fog, as base64 bits like
 * `visited`. `tasks` (v14) is the Voyage tasks: `boards` (each port's notices this season), `cur` (the task taken, or
 * null) and `wait` (no Take before this time, after a drop); tasks-model.mjs cleanTasks checks it in depth. `start`
 * (v14) is the start chosen on the first load: '' not asked yet, 'game' or 'random'.
 * `voyage` (save v15, phase 5a) is the timed voyage under way, or null; `ending` the last voyage's
 * end for the page and the offline summary, or null. clock-model.mjs cleanVoyage and cleanEnding check them in depth.
 * `adrift` (save v16, phase 5b part two) is the spell adrift at sea, or null; `adriftEnd` how the last
 * one ended, for the page's note, or null. adrift-model.mjs cleanAdrift and cleanAdriftEnd check them in depth.
 */
export function defaultSave() {
  return { v: SAVE_VERSION, landHexes: 0, waterHexes: 0, backfilled: false, boat: null, ship: null, shipChecked: false, stores: { food: 0, fuel: 0 }, kitGiven: false, unlockNotice: [], journal: emptyJournal(), navigator: false, visited: '', sign: '', cargo: { boards: {}, runs: [] }, charted: '', tasks: { boards: {}, cur: null, wait: 0 }, start: '', voyage: null, ending: null, adrift: null, adriftEnd: null, waiting: null, wind: 0, jobs: {}, walks: {}, outposts: {}, folkTraits: {}, events: {} };
}

/** The guide pages, in the order the journal lists them. Each is written the first time its rule matters. */
export const JOURNAL_GUIDES = ['terrain', 'zone', 'grace', 'trade', 'combat', 'compass', 'stranded', 'dinghy', 'island', 'longboat', 'brig', 'galleon', 'planning', 'cargo', 'board', 'ports', 'market', 'notices', 'charts', 'rumour', 'stars', 'adrift', 'weather', 'outfit', 'albatross', 'relics'];
/**
 * Kinds of place the journal records. `island`: a named island (ship-model ISLANDS) or the mainland, at the first hex
 * you stood on it; `port`: a port whose harbour board you used (phase 4 wrap-up).
 */
export const JOURNAL_PLACE_KINDS = ['combat', 'trade', 'island', 'port'];
/** What the journal counts at a port you used, in the order its page lists them: `journal.ports[poi][deed]`. */
export const PORT_DEEDS = ['load', 'deliver', 'chart', 'take', 'hand'];
/** Hexes kept per action (found) and misses kept per action (about 20). */
export const JOURNAL_LIMITS = { found: 20, missed: 20 };

/** Voyage levels that each give one free chart (Charting a country). */
export const FREE_CHART_LEVELS = [30, 40, 55, 60]; // the balance pass; was 30, 50, 70, 90
/** The Voyage level from which Navigator's Charts are sold (build .119; plan-model.mjs NAVIGATOR.level must match). */
export const NAVIGATOR_LEVEL = 50; // the balance pass (4.26); was 60
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
  return { found: {}, missed: {}, places: {}, guides: [], charted: [], freeUsed: 0, unread: {}, golbin: false, ports: {}, opened: false };
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
  // the balance pass: visited hexes, filled from the journal's finds, misses and places (no XP for them)
  10: (rec) => ({ ...rec, v: 11, visited: markVisited('', journalHexes(rec.journal)).visited }),
  // the Crossroads Sign: not standing anywhere
  11: (rec) => ({ ...rec, v: 12, sign: '' }),
  // phase 4 cargo runs: no boards seen, no runs taken
  12: (rec) => ({ ...rec, v: 13, cargo: { boards: {}, runs: [] } }),
  // phase 4, the rest: nothing charted, no task; a character from before has long since started (never asked)
  13: (rec) => ({ ...rec, v: 14, charted: '', tasks: { boards: {}, cur: null, wait: 0 }, start: 'game' }),
  // phase 5a, the clock: no voyage under way, none ended
  14: (rec) => ({ ...rec, v: 15, voyage: null, ending: null }),
  // phase 5b part two: not adrift, never was
  15: (rec) => ({ ...rec, v: 16, adrift: null, adriftEnd: null }),
  // phase 5c-2, the wind: no seed yet (weather.mjs rolls one on first use)
  16: (rec) => ({ ...rec, v: 17, wind: 0 }),
  // phase 6c: no Folk keeps a job yet
  17: (rec) => ({ ...rec, v: 18, jobs: {} }),
  // The book's first opening plays once per character: a character from before it has had its journal already.
  18: (rec) => ({ ...rec, v: 19, journal: { ...(rec.journal ?? {}), opened: true } }),
  // phase 6d: no Folk walking alone yet
  19: (rec) => ({ ...rec, v: 20, walks: {} }),
  // phase 6e: no tent pitched yet
  20: (rec) => ({ ...rec, v: 21, outposts: {} }),
  // phase 6f: no Folk has counted a travel trait yet (everyone starts from zero, as in Worker Folks)
  21: (rec) => ({ ...rec, v: 22, folkTraits: {} }),
  // build .378 (events that ask): no stowaway aboard yet
  22: (rec) => ({ ...rec, v: 23, events: {} }),
};

const count = (n) => (Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);
const amount = (n) => (Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : 0);
const cleanStores = (st) => ({ food: count(st?.food), fuel: amount(st?.fuel) });
/**
 * The hold: entries with an item id and a positive whole quantity, one per id. Ids the game no longer knows are kept
 * as they are (an expansion switched off): the items come back when it is on again. Packed cargo (save v13) is one entry a sack or crate, `{ id, qty, cargo: run id, c: 'sack' | 'crate' }`, never merged.
 */
function cleanHold(hold) {
  if (!Array.isArray(hold)) return [];
  const out = [];
  for (const e of hold) {
    if (e === null || typeof e !== 'object' || typeof e.id !== 'string' || e.id === '') continue;
    const qty = count(e.qty);
    if (qty <= 0) continue;
    if (typeof e.cargo === 'string' && e.cargo !== '' && (e.c === 'sack' || e.c === 'crate')) { out.push({ id: e.id, qty, cargo: e.cargo, c: e.c }); continue; }
    const same = out.find((x) => x.id === e.id && x.cargo === undefined);
    if (same !== undefined) same.qty += qty; else out.push({ id: e.id, qty });
  }
  return out;
}

/** A saved vessel, or null when it is missing or malformed. `hulls` is the set of hull ids it may have. */
function cleanVessel(v, hulls) {
  if (v === null || typeof v !== 'object') return null;
  if (!hulls.includes(v.hull) || !Number.isInteger(v.q) || !Number.isInteger(v.r)) return null;
  const cond = Number.isFinite(v.cond) ? Math.min(100, Math.max(0, Math.round(v.cond))) : 100;
  const out = { hull: v.hull, q: v.q, r: v.r, cond, hold: cleanHold(v.hold) };
  // Careening (the flat mechanics): hauled out until `until`; the same rules as ship-model cleanCareen.
  const c = v.careen;
  if (c !== null && typeof c === 'object' && [c.at, c.until, c.from, c.to].every(Number.isFinite) && c.until >= c.at && c.from >= 0 && c.to <= 100 && c.to > c.from) {
    out.careen = { at: Math.round(c.at), until: Math.round(c.until), from: Math.round(c.from), to: Math.round(c.to) };
  }
  return out;
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
/** `journal.ports`: { [poi]: { [deed]: count } }, only PORT_DEEDS with a count above 0. */
function cleanPorts(map) {
  const out = {};
  if (map === null || typeof map !== 'object' || Array.isArray(map)) return out;
  for (const [poi, deeds] of Object.entries(map)) {
    if (!isId(poi) || deeds === null || typeof deeds !== 'object') continue;
    const kept = {};
    for (const d of PORT_DEEDS) if (count(deeds[d]) > 0) kept[d] = count(deeds[d]);
    if (Object.keys(kept).length > 0) out[poi] = kept;
  }
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
    ports: cleanPorts(src.ports),
    // The cover has been opened once (the first opening's motion); a save without it reads as not yet.
    opened: src.opened === true,
  };
}

/** What `unlockNotice` may hold, in the order the notice names them. */
export const FREE_UNLOCKS = ['cartography', 'voyage'];

/** Hull ids a save may name. Kept here so the model stays free of imports; ship-model.mjs HULLS must match. */
/** The start chosen on the first load (start-model.mjs CHOICES; modules here can't import each other). */
export const START_CHOICES = ['', 'game', 'random'];
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
    visited: cleanVisited(rec.visited),
    sign: typeof rec.sign === 'string' && /^[\w]+:[\w]+$/.test(rec.sign) ? rec.sign : '',
    cargo: rec.cargo !== null && typeof rec.cargo === 'object' && !Array.isArray(rec.cargo) ? rec.cargo : { boards: {}, runs: [] },
    charted: cleanVisited(rec.charted),
    tasks: rec.tasks !== null && typeof rec.tasks === 'object' && !Array.isArray(rec.tasks) ? rec.tasks : { boards: {}, cur: null, wait: 0 },
    start: START_CHOICES.includes(rec.start) ? rec.start : 'game',
    voyage: plainObject(rec.voyage),
    ending: plainObject(rec.ending),
    adrift: plainObject(rec.adrift),
    adriftEnd: plainObject(rec.adriftEnd),
    // A voyage waiting out a storm (build .386): { walk, name, chain, loads, until, from }, checked by voyage-clock.mjs
    // where it is read; before, a reload dropped the wait without a word.
    waiting: plainObject(rec.waiting),
    // The wind's seed (weather-model.mjs createWind): 1 to 2^31 - 1, or 0 for none rolled yet.
    wind: Number.isInteger(rec.wind) && rec.wind > 0 && rec.wind < 0x80000000 ? rec.wind : 0,
    jobs: cleanJobs(rec.jobs),
    // Folks walking alone (phase 6d): { folkId: walk }, checked by walk-model.mjs cleanWalks where it is read.
    walks: plainObject(rec.walks) ?? {},
    // Pitched tents (phase 6e): { "q,r": { food, fuel, at } }, checked by outpost-model.mjs cleanOutposts where it is read.
    outposts: plainObject(rec.outposts) ?? {},
    // Travel traits counted (phase 6f): { folkId: { counts, home } }, checked by folk-traits-model.mjs cleanFolkTraits where it is read.
    folkTraits: plainObject(rec.folkTraits) ?? {},
    // Events that ask (build .378): { stow }, checked by events-model.mjs cleanEvents where it is read.
    events: plainObject(rec.events) ?? {},
  };
}
/** Folks the most a save keeps jobs for: Worker Folks never hires more than there are skills to hold. */
export const JOBS_MAX = 64;
/** The jobs Folks keep at their own hex (crew-model.mjs): { folkId: skillId }, junk dropped. */
export function cleanJobs(raw) {
  const out = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, skillId] of Object.entries(raw)) {
    if (Object.keys(out).length >= JOBS_MAX) break;
    if (id.length > 0 && id.length <= 64 && typeof skillId === 'string' && /^[\w]+:[\w]+$/.test(skillId)) out[id] = skillId;
  }
  return out;
}
/** An object kept for its own model to check (clock-model.mjs), or null. */
const plainObject = (o) => (o !== null && typeof o === 'object' && !Array.isArray(o) ? o : null);
/** Base64 of at most VISITED_BYTES bytes, or '' (nothing visited). */
function cleanVisited(v) {
  if (typeof v !== 'string' || v.length > Math.ceil(VISITED_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(v)) return '';
  return fromBytes(toBytes(v));
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
  { level: 1, text: 'How close and which way' },
  { level: COMPASS_LEVELS.steps, text: 'Also how many hexes away' },
  { level: COMPASS_LEVELS.name, text: 'Also the name of the place' },
];

/** The next compass stage above `level`, or undefined at the top. */
export function nextCompassStage(level) {
  return COMPASS_STAGES.find((s) => s.level > level);
}
