// The Voyage skill's pure model: its save record with a version and a migration table, XP per hex
// travelled, and what the Wayfinder's Compass shows at each level (4.17). No game objects here; covered by Node tests.

export const SKILL_ID = 'voyage:Voyage';
/** Marks the start of Voyage's own data inside the skill's save region ("VOYG"). */
export const SAVE_MAGIC = 0x564f5947;
export const SAVE_VERSION = 2;

/**
 * Base XP per hex entered (decided 15 Oct 2026: XP per hex travelled, water worth more). Placeholders for the balance
 * pass: level 10 is about 58 land hexes, level 25 about 440. Global XP modifiers apply through Skill.addXP.
 */
export const XP_PER_HEX = { land: 20, water: 40 };

/** Compass detail by Voyage level. Level 1 is today's reading: temperature and direction (decided 15 Oct 2026). */
export const COMPASS_LEVELS = { steps: 10, name: 25 };

/**
 * `ship` is `{ hull, q, r }` or null (phase 3b): the hull id of ship-model.mjs HULLS and the hex it floats on.
 * `shipChecked` turns true after the first load with ships, which places a free dinghy for a character that phase 2
 * left on the water or on another landmass (existing characters). It runs once per character.
 */
export function defaultSave() {
  return { v: SAVE_VERSION, landHexes: 0, waterHexes: 0, backfilled: false, ship: null, shipChecked: false };
}

/**
 * Steps keyed by the version they migrate FROM, applied in order up to SAVE_VERSION. Each step is pure and returns a
 * new record. Empty until the record changes shape (the Worker Folks rule).
 */
export const MIGRATIONS = {
  // 3b: no ship yet; the first load with ships decides whether the character gets a free dinghy
  1: (rec) => ({ ...rec, v: 2, ship: null, shipChecked: false }),
};

const count = (n) => (Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);

/** A saved ship, or null when it is missing or malformed. `hulls` is the set of known hull ids. */
function cleanShip(ship, hulls) {
  if (ship === null || typeof ship !== 'object') return null;
  if (!hulls.includes(ship.hull) || !Number.isInteger(ship.q) || !Number.isInteger(ship.r)) return null;
  return { hull: ship.hull, q: ship.q, r: ship.r };
}

/** Hull ids a save may name. Kept here so the model stays free of imports; ship-model.mjs HULLS must match. */
export const HULL_IDS = ['dinghy'];

function clean(rec) {
  return {
    v: SAVE_VERSION,
    landHexes: count(rec.landHexes),
    waterHexes: count(rec.waterHexes),
    backfilled: rec.backfilled === true,
    ship: cleanShip(rec.ship, HULL_IDS),
    shipChecked: rec.shipChecked === true,
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
 * XP for one move. `steps` are the hexes entered, each `{ water, fastTravel, free }`. Fast-travel hops give nothing
 * here (phase 3c makes them sailing and pays them by distance), nor do `free` steps: the homeward rule's moves back
 * within the hull's reach. Neither counts as a hex travelled.
 */
export function xpForSteps(steps) {
  let land = 0;
  let water = 0;
  for (const s of steps) {
    if (s.fastTravel || s.free) continue;
    if (s.water) water += 1; else land += 1;
  }
  return { land, water, xp: land * XP_PER_HEX.land + water * XP_PER_HEX.water };
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
