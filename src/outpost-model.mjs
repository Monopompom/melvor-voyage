// Outposts (phase 6e): a Tent from the Voyage shop pitched on a land hex where one of your Folks stands. The hex then
// counts as a camp, and the tent keeps a store of rations and fuel outside your carry limit. Pure: where a tent may go,
// how many stand at a Voyage level, the store's sums and the save's outposts. The game side is src/outposts.mjs.

/** The Tent: its item and shop purchase (local id) and the Voyage level that sells it. */
export const TENT = { id: 'Tent', level: 30 };
/** Voyage levels that each allow one more tent pitched: one at 30, up to four at 90. */
export const OUTPOST_LEVELS = [30, 50, 70, 90];
export const MAX_OUTPOSTS = OUTPOST_LEVELS.length;
/** The skill milestones at those levels, by their English names (data/skill.json; setup.mjs finds them by these). */
export const OUTPOST_MILESTONES = { first: 'Outposts: A Tent where a Folk works; a Merchant there sells for you', more: 'Outposts: One more tent at a time' };
/** Features that make a hex a place already: no tent goes there. */
export const PLACE_FEATURES = ['city', 'capital', 'port', 'market', 'camp'];
/** What a pitched tent adds to its hex's features. */
export const OUTPOST_FEATURE = 'camp';
/**
 * A tent is not up at once (build .367, the user): one Folk on the hex puts it up over this much time, online and
 * offline, its own skill set aside meanwhile. A balance value, open to change.
 */
export const BUILD_MS = 60 * 60 * 1000;

/** Tents that may stand at a Voyage level (0 to 4). */
export function maxOutposts(level) {
  const l = Math.floor(Number(level) || 0);
  return OUTPOST_LEVELS.filter((min) => l >= min).length;
}
/** The Voyage level that allows one more tent, or null when four may stand. */
export function nextOutpostLevel(level) {
  return OUTPOST_LEVELS[maxOutposts(level)] ?? null;
}

export const keyOf = (q, r) => `${q},${r}`;
/** { q, r } from a key, or undefined when it is not one. */
export function parseKey(key) {
  const m = /^(-?\d+),(-?\d+)$/.exec(String(key));
  return m === null ? undefined : { q: Number(m[1]), r: Number(m[2]) };
}

const SEA = ['water', 'shoal'];
/** True when the table's record is a place already (a town, port, market or camp of its own). */
export const isPlace = (rec) => Array.isArray(rec?.f) && rec.f.some((f) => PLACE_FEATURES.includes(f));

/**
 * Whether a tent may be pitched here. `tents`: Tents in the bank; `outposts`: the save's map; `level`: Voyage level;
 * `rec`: the table's own record of the hex (under any weather layer: ice is still the land under it); `folkHere`: one
 * of your Folks is placed on the hex. Gives 'pitch' or why not: 'no-tent', 'pitched' (a tent stands here), 'unknown'
 * (not on the table, or under cloud), 'sea', 'place', 'full' (as many as the level allows), 'no-folk'.
 */
export function pitchAction({ tents, outposts, level, rec, folkHere }) {
  if (!(tents > 0)) return 'no-tent';
  if (rec === undefined || rec === null || rec.cloud === true) return 'unknown';
  if (outposts[keyOf(rec.q, rec.r)] !== undefined) return 'pitched';
  if (SEA.includes(rec.t)) return 'sea';
  if (isPlace(rec)) return 'place';
  if (Object.keys(outposts).length >= maxOutposts(level)) return 'full';
  if (!folkHere) return 'no-folk';
  return 'pitch';
}

/** A record with the camp added, for the terrain's layer; the record itself is never changed. */
export function campRecord(rec) {
  const f = Array.isArray(rec.f) ? rec.f : [];
  return f.includes(OUTPOST_FEATURE) ? rec : { ...rec, f: [...f, OUTPOST_FEATURE], outpost: true };
}

const whole = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
/** Fuel kept to thousandths, as the stores keep it (the Firemaking discount makes it fractional). */
const fuelOf = (n) => (Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 0);

/**
 * A new outpost's record: an empty store and when it was pitched. With `folk` (the builder's id) it is going up until
 * `until`; `skill` is the skill the builder set aside, given back when the tent is up (null: none).
 */
export const newOutpost = (now, folk, skill = null) => (folk === undefined
  ? { food: 0, fuel: 0, at: whole(now) }
  : { food: 0, fuel: 0, at: whole(now), build: { folk: String(folk), until: whole(now) + BUILD_MS, skill: skill ?? null } });
/** True while the tent is still going up. */
export const isBuilding = (o) => o?.build !== undefined;
/** The builder's statuses (Worker Folks' view `status`) that pause the work (build .387, the user: a Folk on strike built on). */
export const BUILD_PAUSE = ['strike', 'debt', 'cooldown'];
/** Ms of work left on a tent going up at `now` (0 when it is up); a paused build keeps what it had when it paused. */
export const buildLeft = (o, now) => (isBuilding(o) ? Math.max(0, o.build.until - (o.build.pausedAt ?? whole(now))) : 0);
/** True while the work is paused. */
export const isPaused = (o) => isBuilding(o) && o.build.pausedAt !== undefined;
/** The record with its work paused at `now` (unchanged when it is paused already). */
export const pauseBuild = (o, now) => (isBuilding(o) && o.build.pausedAt === undefined ? { ...o, build: { ...o.build, pausedAt: whole(now) } } : o);
/** The record with its work resumed at `now`: the pause's length is added to `until` (unchanged when not paused). */
export const resumeBuild = (o, now) => {
  if (!isPaused(o)) return o;
  const { pausedAt, ...b } = o.build;
  return { ...o, build: { ...b, until: b.until + Math.max(0, whole(now) - pausedAt) } };
};
/** The outposts that count as camps: the tents that are up. */
export const standing = (outposts) => Object.fromEntries(Object.entries(outposts).filter(([, o]) => !isBuilding(o)));
/**
 * The Folk who puts the tent up, from the Folks placed on the hex: one with no skill first (the others keep working),
 * else the first by slot. Undefined when none.
 */
export function pickBuilder(folks) {
  const list = [...folks].sort((a, b) => (a.skillId === null ? 0 : 1) - (b.skillId === null ? 0 : 1) || a.slot - b.slot);
  return list[0];
}
/**
 * What happens to a tent going up: 'up' (the work is done), 'stop' (the builder is gone, moved away, walking or given
 * a skill: the tent goes back to the bank), 'paused' (the builder is on strike, owed wages or cooling down, BUILD_PAUSE)
 * or 'going'. `folk` is the builder's view, undefined when it is gone.
 */
export function buildStep(o, key, folk, now) {
  if (!isBuilding(o)) return 'up';
  const at = parseKey(key);
  if (folk === undefined || folk.travel !== 'idle' || folk.skillId !== null || folk.place == null || at === undefined
    || folk.place.q !== at.q || folk.place.r !== at.r) return 'stop';
  if (BUILD_PAUSE.includes(folk.status)) return 'paused';
  return buildLeft(o, now) === 0 ? 'up' : 'going';
}

/**
 * Splits food and fuel between you and the tent's store. `have` and `store` are { food, fuel }; `carry` what you want
 * to carry after; `cap` your carry limit. You carry at most the limit (or what you carry now, when that is more: stores
 * from before the limit are never cut), and never more than the two hold together; the rest stays in the tent.
 * Returns { have, store } after.
 */
export function share(have, store, carry, cap) {
  const out = { have: {}, store: {} };
  for (const kind of ['food', 'fuel']) {
    const clean = kind === 'food' ? whole : fuelOf;
    const total = clean(clean(have[kind]) + clean(store[kind]));
    const most = Math.min(total, Math.max(clean(cap[kind]), clean(have[kind])));
    const mine = clean(Math.min(most, Math.max(0, Number(carry[kind]) || 0)));
    out.have[kind] = mine;
    out.store[kind] = clean(total - mine);
  }
  return out;
}

/**
 * Striking camp: the store comes back to your stores up to the carry limit; what does not fit is lost (it is food and
 * fuel loaded at a rate, not items, so nothing goes back to the bank). Returns { have, lost }.
 */
export function strike(have, store, cap) {
  const out = { have: {}, lost: {} };
  for (const kind of ['food', 'fuel']) {
    const clean = kind === 'food' ? whole : fuelOf;
    const mine = clean(have[kind]);
    const room = Math.max(0, clean(cap[kind]) - mine);
    const back = Math.min(room, clean(store[kind]));
    out.have[kind] = clean(mine + back);
    out.lost[kind] = clean(clean(store[kind]) - back);
  }
  return out;
}

/** The save's outposts: { "q,r": { food, fuel, at, build? } }, junk dropped, at most MAX_OUTPOSTS. */
export function cleanOutposts(raw) {
  const out = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, o] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_OUTPOSTS) break;
    const at = parseKey(key);
    if (at === undefined || o === null || typeof o !== 'object') continue;
    const b = o.build;
    const build = b !== null && typeof b === 'object' && typeof b.folk === 'string' && b.folk !== ''
      ? { folk: b.folk, until: whole(b.until), skill: typeof b.skill === 'string' ? b.skill : null, ...(Number.isFinite(b.pausedAt) && b.pausedAt > 0 ? { pausedAt: whole(b.pausedAt) } : {}) } : undefined;
    out[keyOf(at.q, at.r)] = { food: whole(o.food), fuel: fuelOf(o.fuel), at: whole(o.at), ...(build === undefined ? {} : { build }) };
  }
  return out;
}
