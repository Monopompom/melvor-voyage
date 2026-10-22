// The crew's pure rules (phase 6c): the Folks who go along with you. Berths per vessel, mouths at the stores, hunger
// on the road. No game objects here; covered by tests/crew-model.test.mjs.

/** How many Folks each hull carries besides you. On land the crew walks, and the crew is never more than berths. */
export const BERTHS = { dinghy: 1, longboat: 2, brig: 6, galleon: 12 };
export const berthsOf = (hullId) => BERTHS[hullId] ?? 0;

/**
 * How much of your food a Folk eats, by its rank: a Trainee half, a Foreman half again. Fuel is one share each (the
 * fire warms them alike). An unknown rank eats as you do.
 */
export const FOOD_SHARE = { Newbie: 0.5, Junior: 0.75, Middle: 1, Senior: 1.25, Expert: 1.5 };
export const foodShare = (tier) => FOOD_SHARE[tier] ?? 1;
/**
 * The crew's load on the stores: `count` Folks, `food` the sum of their food shares on easy land, `foodRough` on rough
 * ground and `seaFood` at sea (fuel is one share each). `effectsOf(folk, { rough })` gives a Folk's travel-trait
 * factors (folk-traits-model travelEffects: roadFood, seaFood; phase 6f); without it every factor is 1.
 */
export const crewLoad = (folks, effectsOf) => {
  const list = Array.isArray(folks) ? folks : [];
  const fx = (f, rough) => (typeof effectsOf === 'function' ? effectsOf(f, { rough, night: null }) : undefined) ?? {};
  const k = (x) => (Number.isFinite(x) && x > 0 ? x : 1);
  const out = { count: list.length, food: 0, foodRough: 0, seaFood: 0 };
  for (const f of list) {
    const share = foodShare(f?.tier);
    const easy = fx(f, false);
    out.food += share * k(easy.roadFood);
    out.foodRough += share * k(fx(f, true).roadFood);
    out.seaFood += share * k(easy.seaFood);
  }
  return out;
};

/** Who eats from the stores and burns fuel on a step: you and every Folk with you. */
export const mouths = (crew) => 1 + (Number.isFinite(crew) && crew > 0 ? Math.floor(crew) : 0);

/** Each hex walked or rowed on empty stores costs every Folk with you a tenth of its max HP (at least 1); it can die. */
export const HUNGER_SHARE = 0.1;
export const hungerDamage = (maxHp) => Math.max(1, Math.ceil((Number.isFinite(maxHp) && maxHp > 0 ? maxHp : 0) * HUNGER_SHARE));
/** How many hungry hexes a Folk at `hp` of `maxHp` lives through (null hp: full health); the next one kills it. */
export const hungryHexes = (hp, maxHp) => {
  const now = hp === null || hp === undefined ? maxHp : hp;
  if (!(now > 0)) return 0;
  return Math.floor((now - 1) / hungerDamage(maxHp));
};

/**
 * The first step a crew of `crew` Folks can't take for want of berths: a sea step or a hop (free ones too: the boat
 * still has to carry them) in a vessel whose berths (`berthsFor(kind)`) are fewer. { at, vessel, berths }, or undefined when they all fit.
 */
export function berthRefusal(steps, crew, berthsFor) {
  const aboard = typeof crew === 'function' ? crew : () => crew;
  if (typeof crew !== 'function' && !(crew > 0)) return undefined;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!(s.sea || s.hop > 0)) continue;
    const vessel = s.vessel ?? 'boat';
    const n = aboard(vessel);
    if (!(n > 0)) continue;
    const berths = berthsFor(vessel);
    if (berths < n) return { at: i, vessel, berths };
  }
  return undefined;
}

// A Folk's kept job (the user, 20 Oct 2026). Giving a Folk a job needs you within a hex of it, but you can take the
// skill back from anywhere. So a Folk keeps the job it lost that way, at its own hex, and you may give it that job
// again from anywhere: it works on where it stands. Another job still needs the walk. `jobs` is { folkId: skillId }.

/** The jobs after a Folk's assignment changed (`skillId` null: it lost `previous`). A job someone else takes is gone. */
export function jobsAfterAssign(jobs, { folkId, previous, skillId }) {
  const out = {};
  for (const [id, kept] of Object.entries(jobs)) if (id !== folkId && kept !== skillId) out[id] = kept;
  if (skillId === null && typeof previous === 'string') out[folkId] = previous;
  return out;
}
/** The jobs without this Folk's: it moved, came aboard, was fired or died. */
export function jobsWithout(jobs, folkId) {
  if (!(folkId in jobs)) return jobs;
  const { [folkId]: _gone, ...rest } = jobs;
  return rest;
}
/** True when giving `folk` (a Worker Folks view) `skillId` is its kept job: it stands on a hex, not with you. */
export function keptJob(jobs, folk, skillId) {
  return folk !== undefined && folk !== null && folk.travel !== 'with' && folk.place !== null && folk.place !== undefined
    && typeof skillId === 'string' && jobs[folk.id] === skillId;
}
