// Foraging on the road (build .554, the user: "Let's do foraging"): walking (never sailing) into a hex of woods or
// fresh water may give back part of a ration, and a shore a little driftwood for the campfire. Pure: which hexes give
// what, the odds by your level, a roll and the range a route may bring. The game side is src/stores.mjs. Like every
// module here it imports nothing (the game loads each one on its own): the stores' rule for easy ground comes in.

/**
 * The balance values. A forage on good ground at level 99 gives half a ration; the chance runs from a quarter at
 * level 1 to three quarters at 99. Hard ground gives half as much. Driftwood is the same for everyone.
 */
export const FORAGE = {
  food: 10, // half of stores-model RATION_HP (a test holds it)
  chanceMin: 0.25,
  chanceMax: 0.75,
  hardShare: 0.5,
  driftChance: 0.3,
  driftFuel: 0.25,
};
/** The skill each kind of ground forages with: the woods with Woodcutting, fresh water with Fishing. */
export const FORAGE_SKILLS = {
  'melvorD:Woodcutting': ['forest', 'tree'],
  'melvorD:Fishing': ['river', 'lake', 'waterfall'],
};
/** Ground that gives nothing, however it looks: the sea, the snow, the lava and the wastes stay as dear. */
export const BARREN = ['water', 'shoal', 'snowlands', 'lavalands', 'wastelands'];
/** Features that bring driftwood ashore. */
const DRIFT_FEATURES = ['lake'];

const levelShare = (level) => Math.min(1, Math.max(0, (Math.floor(Number(level) || 1) - 1) / 98));
/** The chance a forage finds something at this skill level: chanceMin at 1, chanceMax at 99. */
export const chanceAt = (level) => FORAGE.chanceMin + (FORAGE.chanceMax - FORAGE.chanceMin) * levelShare(level);

/**
 * What a hex may give a walker: { food: { chance, amount, skill } | undefined, fuel: { chance, amount } | undefined }.
 * `rec` is the table's record ({ t, f, coast? }); `levels` maps a skill id to your level in it; `isEasy(cls)` is the
 * stores' easy ground (stores-model isEasy). The better of the hex's skills counts. Undefined when it gives nothing.
 */
export function forageAt(rec, levels, isEasy = () => true) {
  if (rec == null || rec.cloud === true || BARREN.includes(rec.t)) return undefined;
  const f = Array.isArray(rec.f) ? rec.f : [];
  let best;
  for (const [skill, grounds] of Object.entries(FORAGE_SKILLS)) {
    if (!grounds.some((g) => f.includes(g))) continue;
    const level = Math.floor(Number(levels?.[skill]) || 1);
    if (best === undefined || level > best.level) best = { skill, level };
  }
  let food;
  if (best !== undefined) {
    const share = isEasy(rec.t) ? 1 : FORAGE.hardShare;
    // Level 1 finds a scrap, level 99 half a ration (on good ground).
    const amount = Math.max(1, Math.round(FORAGE.food * share * Math.max(1, best.level) / 99));
    food = { chance: chanceAt(best.level), amount, skill: best.skill };
  }
  const shore = rec.coast === true || rec.t === 'beach' || DRIFT_FEATURES.some((g) => f.includes(g));
  const fuel = shore ? { chance: FORAGE.driftChance, amount: FORAGE.driftFuel } : undefined;
  return food === undefined && fuel === undefined ? undefined : { food, fuel };
}

/** One roll of a hex's forage: { food, fuel } found (0 for nothing). `rand` gives [0, 1). */
export function rollForage(at, rand = Math.random) {
  const out = { food: 0, fuel: 0 };
  if (at === undefined) return out;
  if (at.food !== undefined && rand() < at.food.chance) out.food = at.food.amount;
  if (at.fuel !== undefined && rand() < at.fuel.chance) out.fuel = at.fuel.amount;
  return out;
}

/** The most a route's hexes (forageAt results, undefined for none) could give: { food, fuel }, never counted on. */
export function forageRange(list) {
  const out = { food: 0, fuel: 0 };
  for (const at of list) {
    if (at === undefined) continue;
    out.food += at.food?.amount ?? 0;
    out.fuel += at.fuel?.amount ?? 0;
  }
  out.fuel = Math.round(out.fuel * 1000) / 1000;
  return out;
}
