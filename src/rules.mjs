// Pure location rules: which skills are locked by terrain and where they work. No game globals.
// The table was approved on the heat maps (15 Oct 2026).
//
// A rule names terms, each with a rate: classes (hex class), features, flags (coast), pois, areas, and combos
// (class + feature, e.g. a river in the desert). A hex passes at the best rate any term gives it, unless it is
// under cloud (nothing works under cloud, except a rule marked `underCloud`). `grace` lets a land hex next to a
// full-rate hex work at that rate (any hex, the sea and cloud included, for an `underCloud` rule).
// Tiers: 'terrain' rules apply in both strictness modes; 'place' rules only in Strict; 'land' means any land hex.
// Rate 1 = full speed; a fraction stretches the action interval by 1 / rate (src/gate.mjs); 0 = locked.
// Unknown hexes and ungated skills return 1 (fail open).

export const SEA_CLASSES = ['water', 'shoal'];

/** skill id -> rule. `noun` is what the lock modal says the skill needs; `label` overrides the skill's name. */
export const SKILL_RULES = {
  'melvorD:Woodcutting': { tier: 'terrain', features: { forest: 1, tree: 0.8 }, noun: 'forest or trees' },
  'melvorD:Mining': {
    tier: 'terrain', classes: { mountain: 1, highlands: 1, lavalands: 1, badlands: 0.8 },
    features: { mine: 1, cave: 1, rocky: 1, rock: 0.5 }, combos: [['snowlands', 'mountain', 1]], grace: 1,
    noun: 'Mountain or Highlands, or a mine',
  },
  // Water and shoal count as allowed until phase 3 puts the ship in; then they need the ship under your feet.
  'melvorD:Fishing': {
    tier: 'terrain', classes: { beach: 1, water: 1, shoal: 1 }, features: { river: 1, lake: 1, fisherman: 1, port: 1, iceberg: 0.8 },
    flags: { coast: 0.8 }, ship: ['water', 'shoal'], noun: 'water',
  },
  'melvorD:Farming': { tier: 'terrain', classes: { grasslands: 1, kingslands: 1 }, features: { farm: 1 }, combos: [['desert', 'river', 0.8]], noun: 'Grasslands or a farm' },
  'melvorD:Thieving': { tier: 'terrain', features: { city: 1, capital: 1, market: 1, port: 1, building: 0.8, camp: 0.8 }, grace: 1, noun: 'a town, market or port' },
  'melvorD:Firemaking': { tier: 'land', noun: 'dry land' },
  'melvorD:Cooking': { tier: 'land', noun: 'dry land' },
  'melvorD:Smithing': { tier: 'place', features: { forge: 1, city: 1, capital: 1, camp: 1, port: 0.8 }, grace: 1, noun: 'a forge, town or camp' },
  'melvorD:Crafting': { tier: 'place', features: { stoneworkers: 1, city: 1, capital: 1, camp: 1, port: 1 }, grace: 1, noun: 'a workshop, town, camp or port' },
  'melvorD:Fletching': { tier: 'place', features: { city: 1, capital: 1, camp: 1, port: 1, forest: 0.8 }, noun: 'a town, camp or port' },
  'melvorD:Herblore': { tier: 'place', features: { farm: 1, market: 1, city: 1, capital: 1 }, pois: { FrostyHaven: 1 }, grace: 1, noun: 'a farm, market or town' },
  'melvorD:Runecrafting': { tier: 'place', features: { magic: 1, temple: 1, capital: 1 }, grace: 1, noun: 'a magic site, temple or the capital' },
  // The Magic skill object doubles as Alt. Magic (game.altMagic.id === 'melvorD:Magic'); combat Magic never asks.
  'melvorD:Magic': { tier: 'place', features: { magic: 1, temple: 1 }, grace: 1, noun: 'a magic site or temple', label: 'Alt. Magic' },
  'melvorD:Summoning': { tier: 'place', features: { monolith: 1, magic: 1, temple: 0.8 }, grace: 1, noun: 'a monolith, magic site or temple' },
  'melvorD:Township': { tier: 'place', features: { city: 1, capital: 1, port: 1 }, grace: 1, noun: 'a town or port' },
  // Worker Folks' Hiring follows Township: staff changes (hire, promote, fire) need a town or port.
  'worker_folks:Hiring': { tier: 'place', features: { city: 1, capital: 1, port: 1 }, grace: 1, noun: 'a town or port' },
  // The Abyss is one hex at sea under cloud (Swirling Abyss): Harvesting works on it and next to it, as combat does,
  // so the brig opens it from 5 out (user decision, 16 Oct 2026: it was locked everywhere).
  'melvorItA:Harvesting': { tier: 'terrain', areas: { IntoTheAbyss: 1 }, grace: 1, underCloud: true, noun: 'the Abyss' },
};

/**
 * Skills a Folk is never given while Voyage runs (the user, 22 Oct 2026). Cartography: a voyage into the fog does
 * the surveying itself, hex by hex at the survey's interval, and the game surveys around the player, not around the
 * Folk's hex; a Folk surveying beside a voyage would reveal the map for free and skip the level gate on a trip.
 * Worker Folks itself never hands Cartography out (since 23 Oct 2026), with or without Voyage; this stays as the
 * guard for an older Worker Folks.
 */
export const FOLK_NEVER = ['melvorAoD:Cartography'];

/** True when `skillId` is yours alone: no Folk may hold it while the rules are on. */
export function folkNever(skillId) {
  return FOLK_NEVER.includes(skillId);
}

/** Features that mark a trading place: sell, buy and trade only here or one hex away. */
export const TRADE_FEATURES = ['city', 'capital', 'port', 'market'];
/** Combat areas, dungeons and trading places reach one hex around their tagged hex. */
export const PLACE_GRACE = 1;

export function gatedSkillIds() {
  return Object.keys(SKILL_RULES);
}

export function isGated(skillId) {
  return Object.prototype.hasOwnProperty.call(SKILL_RULES, skillId);
}

const isSea = (rec) => SEA_CLASSES.includes(rec.t);

/** Rate the hex itself gives the rule, before grace. */
function ownRate(rule, rec) {
  if (rec.cloud === true && rule.underCloud !== true) return 0;
  let best = rule.classes?.[rec.t] ?? 0;
  if (rule.tier === 'land' && !isSea(rec)) best = 1;
  const features = Array.isArray(rec.f) ? rec.f : [];
  if (rule.features !== undefined) for (const f of features) best = Math.max(best, rule.features[f] ?? 0);
  if (rule.flags !== undefined) for (const [k, r] of Object.entries(rule.flags)) if (rec[k] === true) best = Math.max(best, r);
  if (rule.pois !== undefined && rec.poi !== undefined) best = Math.max(best, rule.pois[rec.poi] ?? 0);
  if (rule.areas !== undefined && rec.area !== undefined) best = Math.max(best, rule.areas[rec.area] ?? 0);
  if (rule.combos !== undefined) for (const [cls, f, r] of rule.combos) if (rec.t === cls && features.includes(f)) best = Math.max(best, r);
  return best;
}

/**
 * Rate at which the skill runs on the hex described by `record`: 1 full speed, a fraction for a penalised hex,
 * 0 locked. `opts.strictness` ('strict' | 'relaxed') lifts place-tier rules in Relaxed; `opts.neighbours(rec)`
 * returns the six neighbouring records so `grace` can look around (without it, no grace).
 */
export function rateAt(skillId, record, opts = {}) {
  const rule = SKILL_RULES[skillId];
  if (rule === undefined || record === undefined) return 1;
  if (opts.strictness === 'relaxed' && rule.tier === 'place') return 1;
  const own = ownRate(rule, record);
  if (own >= 1 || rule.grace === undefined || (rule.underCloud !== true && (record.cloud === true || isSea(record)))) return own;
  const nbs = typeof opts.neighbours === 'function' ? opts.neighbours(record) : [];
  for (const n of nbs) if (n !== undefined && ownRate(rule, n) >= 1) return Math.max(own, rule.grace);
  return own;
}

/**
 * The neighbours that lift `record` by grace: full-rate hexes next to it, when the rule has grace and the hex itself
 * is below full rate (land, not under cloud, the rule applying under this strictness). Empty otherwise. Resource zones
 * use them: a grace hex works for an action whose zone takes one of these (src/zones.mjs zoneAllowsWithGrace).
 */
export function graceFrom(skillId, record, opts = {}) {
  const rule = SKILL_RULES[skillId];
  if (rule?.grace === undefined || record === undefined || (rule.underCloud !== true && (record.cloud === true || isSea(record)))) return [];
  if (opts.strictness === 'relaxed' && rule.tier === 'place') return [];
  if (ownRate(rule, record) >= 1 || typeof opts.neighbours !== 'function') return [];
  return opts.neighbours(record).filter((n) => n !== undefined && ownRate(rule, n) >= 1);
}

/** True when the skill may start on the hex (at any rate). */
export function allowedAt(skillId, record, opts) {
  return rateAt(skillId, record, opts) > 0;
}

/** True when the rule still applies under this strictness. */
export function appliesUnder(skillId, strictness) {
  const rule = SKILL_RULES[skillId];
  return rule !== undefined && !(strictness === 'relaxed' && rule.tier === 'place');
}

export function ruleNoun(skillId) {
  return SKILL_RULES[skillId]?.noun ?? 'the right terrain';
}

export function ruleLabel(skillId, fallback) {
  return SKILL_RULES[skillId]?.label ?? fallback;
}

/** Language keys for ruleNoun and ruleLabel (the English stays above for tests; tests/lang-keys.test.mjs). */
const localId = (skillId) => String(skillId).split(':').pop();
export function ruleNounKey(skillId) {
  return SKILL_RULES[skillId]?.noun === undefined ? 'MOD_VOY_RULE_NOUN_DEFAULT' : `MOD_VOY_RULE_NOUN_${localId(skillId)}`;
}
/** Undefined when the rule keeps the skill's own (game-translated) name. */
export function ruleLabelKey(skillId) {
  return SKILL_RULES[skillId]?.label === undefined ? undefined : `MOD_VOY_RULE_LABEL_${localId(skillId)}`;
}

/** The classes, features, pois and areas a rule names, for display and for candidate lookup. */
export function ruleTerms(skillId) {
  const rule = SKILL_RULES[skillId];
  if (rule === undefined) return { classes: [], features: [], pois: [], areas: [], land: false };
  const classes = Object.keys(rule.classes ?? {});
  const features = Object.keys(rule.features ?? {});
  for (const [cls, f] of rule.combos ?? []) { if (!classes.includes(cls)) classes.push(cls); if (!features.includes(f)) features.push(f); }
  return { classes, features, pois: Object.keys(rule.pois ?? {}), areas: Object.keys(rule.areas ?? {}), land: rule.tier === 'land' };
}

/** Axial hex distance (duplicated from terrain.mjs so this module stays dependency-free). */
const hexDistance = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q - b.q + a.r - b.r)) / 2;

/**
 * Combat placement: the area (combat area, slayer area, dungeon, stronghold, abyss depth) may be entered from its
 * tagged hex or one hex away. `places` is the list of tagged hexes for the area id (terrain.placesFor); an
 * empty list means the area is not on the map and stays allowed anywhere (fail open), flagged `unplaced`.
 * `isKnown(hex)`: a tagged hex one away counts only once you know it (grace from a known hex; the hex you stand on
 * always counts). `nearest` is the nearest tagged hex, known or not, for the refusal's hint.
 */
export function combatAllowedAt(places, pos, isKnown = () => true) {
  if (places.length === 0) return { allowed: true, unplaced: true };
  if (pos === undefined) return { allowed: true, unplaced: false };
  let best;
  let allowed = false;
  for (const h of places) {
    const d = hexDistance(pos, h);
    if (best === undefined || d < best.distance) best = { hex: h, distance: d };
    if (d === 0 || (d <= PLACE_GRACE && isKnown(h))) allowed = true;
  }
  return { allowed, unplaced: false, nearest: best };
}

export const isTradePlace = (rec) => rec !== undefined && Array.isArray(rec.f) && rec.f.some((f) => TRADE_FEATURES.includes(f));

/** Trade gate: on a trading hex or next to one. */
export function tradeAllowedAt(record, neighbours = []) {
  if (record === undefined) return true;
  if (isTradePlace(record)) return true;
  return neighbours.some(isTradePlace);
}
