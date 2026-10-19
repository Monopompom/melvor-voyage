// Provisions (phase 3c): the stores the player loads on the Voyage page and every move draws on. Pure:
// costs per hex, the plan for one move (pay, walk hungry, or refuse), loading rates by place, the Firemaking discount.
// No game objects here; covered by tests/stores.test.mjs. The game side is src/stores.mjs.

/** HP of healing in one ration (a Shrimp heals 30). */
export const RATION_HP = 20;

/**
 * Rations and fuel per hex entered, by terrain class (decided 16 Oct 2026; build .66 balance pass: a cooking fire on
 * every land hex, the user's "fuel only matters near the mountains"). Placeholders for the balance pass.
 */
export const HEX_COST = {
  grasslands: { rations: 1, fuel: 0.5 },
  kingslands: { rations: 1, fuel: 0.5 },
  beach: { rations: 1, fuel: 0.5 },
  desert: { rations: 1, fuel: 1 },
  swamplands: { rations: 1, fuel: 0.5 },
  highlands: { rations: 1, fuel: 1 },
  mountain: { rations: 1, fuel: 1 },
  badlands: { rations: 1, fuel: 1 },
  wastelands: { rations: 1, fuel: 1 },
  cursedlands: { rations: 1, fuel: 1 },
  snowlands: { rations: 2, fuel: 2 },
  lavalands: { rations: 2, fuel: 2 },
  water: { rations: 1, fuel: 0 },
  shoal: { rations: 1, fuel: 0 },
};
const SEA = ['water', 'shoal'];
/** A hex the table does not know costs like grasslands. */
const costOf = (cls) => HEX_COST[cls] ?? HEX_COST.grasslands;
/**
 * Easy ground, which the hunger floor lets you walk with empty stores. A list of its own since build .66: until then
 * it was "land with no fuel cost", and now every land hex burns some.
 */
export const EASY = ['grasslands', 'kingslands', 'beach', 'desert', 'swamplands'];
export const isEasy = (cls) => !SEA.includes(cls) && (EASY.includes(cls) || HEX_COST[cls] === undefined);

/** Fuel units per item: any log 1 (the game side finds logs through Firemaking), Coal Ore 2, Charcoal 4. */
export const LOG_FUEL = 1;
export const FUEL_ITEMS = { 'melvorD:Coal_Ore': 2, 'melvorTotH:Charcoal': 4 };
/** HP a food item puts in the stores: its base healing, shown in game as healsFor × 10. */
export const foodHP = (healsFor) => (Number.isFinite(healsFor) && healsFor > 0 ? Math.round(healsFor * 10) : 0);

/** Every Firemaking level cuts fuel use by 0.5%, up to level 99 (-49.5%). */
export const FIREMAKING_CUT = 0.005;
export const fuelFactor = (fmLevel) => 1 - FIREMAKING_CUT * Math.min(99, Math.max(0, Math.floor(fmLevel ?? 0)));

/** New characters and characters from before 3c get this once, after the tutorial. Fits the level 1 limit. */
export const STARTER_KIT = { food: 600, fuel: 15 };

/**
 * How much the stores hold (build .66, the user's "provisions are too cheap": with no limit one load lasted for
 * ever). Grows with Voyage level up to 99: food 600 + 20 HP a level, fuel 15 + 0.5 a level. Bigger hulls add to it
 * later. Stores above the limit (loaded before it existed) are kept; only loading stops.
 */
export const CAPACITY = { food: 600, foodPerLevel: 20, fuel: 15, fuelPerLevel: 0.5 };
/**
 * "Low" stores for the page and the map panel (build .86): amber under these, red at 0. Food is 5 rations (100 HP),
 * fuel 2 (four easy land hexes); a warning, not a rule.
 */
export const LOW = { food: 100, fuel: 2 };
export function capacity(voyageLevel) {
  const l = Math.min(99, Math.max(1, Math.floor(voyageLevel ?? 1)));
  return { food: CAPACITY.food + CAPACITY.foodPerLevel * l, fuel: CAPACITY.fuel + CAPACITY.fuelPerLevel * l };
}
/**
 * How many items to load: as many as asked and owned, but no more than it takes to fill the room left (the last one
 * may top it up past the limit; what spills over is lost, so at most one item's worth). 0 when full.
 */
export function loadCount(unit, rate, qty, room) {
  const per = unit * rate;
  if (!(per > 0) || !(room > 0)) return 0;
  return Math.max(0, Math.min(Math.floor(qty), Math.ceil(room / per - 1e-9)));
}

/** Fuel is fractional (the Firemaking discount); kept to thousandths so a level's 0.5% is never rounded away. */
export const roundFuel = (n) => Math.round(n * 1000) / 1000;

/**
 * Loading rates by place (decided 16 Oct 2026, "the table works"): the share of food HP and fuel that ends up in the
 * stores. The real-world reading: a port has quays, chandlers and warehouses, everything at full measure; a town or
 * the capital has bakers and woodyards but you carry it through streets; a market sells food well but firewood is a
 * hauler's trade; a farm, village or camp spares what it can. In the wild or on the sea nobody can load anything.
 */
export const LOAD_PLACES = [
  { id: 'port', features: ['port'], food: 1, fuel: 1 },
  { id: 'town', features: ['city', 'capital'], food: 0.75, fuel: 0.75 },
  { id: 'market', features: ['market'], food: 0.75, fuel: 0.5 },
  { id: 'farm', features: ['building', 'farm', 'camp'], food: 0.5, fuel: 0.5 },
];
const placeOf = (rec) => {
  if (rec === undefined || rec.cloud === true || !Array.isArray(rec.f)) return undefined;
  return LOAD_PLACES.find((p) => p.features.some((f) => rec.f.includes(f)));
};

/**
 * Loading here: the best place on the hex itself or one hex away (grace, so a boat at the quay loads from the port).
 * Food and fuel take their best rate separately. Returns { place, food, fuel } (place: the id that gave the food
 * rate, or the fuel rate when food has none) or undefined in the wild.
 */
export function loadingAt(rec, neighbours = []) {
  let best;
  for (const r of [rec, ...neighbours]) {
    const p = placeOf(r);
    if (p === undefined) continue;
    if (best === undefined) { best = { place: p.id, food: p.food, fuel: p.fuel }; continue; }
    // On a food tie the place that also gives the better fuel names the line (build .182: by Old Village the Farmer's
    // Market read "at the market: fuel 75%", the village's fuel under the market's name).
    if (p.food > best.food || (p.food === best.food && p.fuel > best.fuel)) { best.food = p.food; best.place = p.id; }
    if (p.fuel > best.fuel) best.fuel = p.fuel;
  }
  return best;
}

/** What `qty` items of `unit` HP (or fuel units) put in the stores at `rate`. */
export const loadAmount = (unit, qty, rate) => unit * Math.max(0, Math.floor(qty)) * Math.max(0, rate);

/**
 * The cost of one step. `step` is { cls, sea, hop, free, homeward, adrift, wx }:
 *  - `hop`: a fast-travel hop sailed between ports, its straight-line length in hexes (rations at the sea rate);
 *  - `free`: the homeward rule's moves, which cost nothing;
 *  - `homeward`: a sea step closer to a coast (the hunger floor at sea, below);
 *  - `wx`: the weather on the hex (phase 5c, weather-model.mjs effectsOf): its band multiplies the fuel and adds
 *    rations on land; in Lemon season rations at sea go further (`seaFood`, hops too).
 */
export function stepCost(step, fmLevel) {
  if (step.free) return { food: 0, fuel: 0 };
  const wx = step.wx;
  const seaFood = Number.isFinite(wx?.seaFood) && wx.seaFood > 0 ? wx.seaFood : 1;
  if (step.hop > 0) return { food: Math.round(step.hop * costOf('water').rations * RATION_HP * seaFood), fuel: 0 };
  const c = costOf(step.cls);
  const sea = step.sea === true || SEA.includes(step.cls);
  const rations = c.rations + (!sea && Number.isFinite(wx?.rations) ? wx.rations : 0);
  const fuelMul = !sea && Number.isFinite(wx?.fuel) && wx.fuel >= 0 ? wx.fuel : 1;
  return { food: Math.round(rations * RATION_HP * (sea ? seaFood : 1)), fuel: roundFuel(c.fuel * fuelMul * fuelFactor(fmLevel)) };
}

/** Total cost of a move, ignoring what the stores hold (the hex overview line). */
export function pathCost(steps, fmLevel) {
  let food = 0;
  let fuel = 0;
  for (const s of steps) { const c = stepCost(s, fmLevel); food += c.food; fuel += c.fuel; }
  return { food, fuel: roundFuel(fuel) };
}

/**
 * The plan for one move, steps in walking order (start to destination). Each step is paid from the stores when they
 * cover it. When they don't:
 *  - easy ground (EASY) is walked hungry: whatever food and fuel is left goes and the hex gives no Voyage XP (the
 *    hunger floor);
 *  - a sea step closer to a coast is rowed hungry the same way, so nobody is ever stuck on the water (a safety net:
 *    "always get ashore" below keeps it from happening in play);
 *  - anything else refuses the whole move: { ok: false, why: 'food' | 'fuel', at } (at: the step index).
 * "Always get ashore": a move that ends on the sea must leave `reserve` HP for the way back to a coast, unless every
 * sea step of it heads for the coast already ({ ok: false, why: 'ashore' }).
 * With a ship (`hull`: { cond, reserve }, phase 3d) every sea step wears it (wearOf). A step it can't take refuses:
 * 'deep' (deep water below WORN %), 'hull' (worn through); a step closer to a coast always goes, down to 0. A voyage
 * ending at sea keeps `hull.reserve` % for the way back ('hullAshore').
 * On success: { ok: true, food, fuel, spent: { food, fuel }, hungry: [step indices], cond (with a hull) }.
 * Two vessels (build .150): `hulls` = { boat?, ship? }, each { cond, reserve }, and
 * each step names the `vessel` it is sailed in ('boat' when it doesn't); a step wears its own vessel. The result then
 * has `conds` = { boat?, ship? }, a refusal names the `vessel`. `hull` alone is the boat's.
 */
export function planMove(stores, steps, { fmLevel = 1, reserve = 0, hull, hulls } = {}) {
  let food = Math.max(0, stores?.food ?? 0);
  let fuel = Math.max(0, stores?.fuel ?? 0);
  const hs = hulls ?? (hull === undefined ? {} : { boat: hull });
  const conds = {};
  for (const [v, h] of Object.entries(hs)) if (h !== undefined) conds[v] = Math.max(0, h.cond);
  const hungry = [];
  let outward = false;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const c = stepCost(s, fmLevel);
    if (s.sea && !s.free && !s.homeward) outward = true;
    const v = s.vessel ?? 'boat';
    const cond = conds[v];
    const w = cond === undefined ? 0 : wearOf(s);
    if (w > 0) {
      const limping = s.sea && s.homeward === true;
      if (!limping && s.deep && cond < WORN) return { ok: false, why: 'deep', at: i, cond: hs[v].cond, vessel: v };
      if (!limping && w > cond) return { ok: false, why: 'hull', at: i, cond: hs[v].cond, need: pathWear(steps.filter((x) => (x.vessel ?? 'boat') === v)), vessel: v };
      conds[v] = Math.max(0, cond - w);
    }
    if (food >= c.food && fuel + 1e-9 >= c.fuel) {
      food -= c.food;
      fuel = roundFuel(Math.max(0, fuel - c.fuel));
      continue;
    }
    // At sea the homeward floor walks you on hungry, except where Adrift applies (5b part two: `adrift`, the step
    // leaves a hex more than one from the coast with the rules and timed travel on): there the drift takes you home.
    const easy = !s.hop && (s.sea ? s.homeward === true && s.adrift !== true : isEasy(s.cls));
    if (easy) {
      // walked on what is left: the rest of the food and the fuel go, the hex gives no XP
      food = Math.max(0, food - c.food);
      fuel = roundFuel(Math.max(0, fuel - c.fuel));
      hungry.push(i);
      continue;
    }
    return { ok: false, why: food < c.food ? 'food' : 'fuel', at: i, need: c };
  }
  const last = steps[steps.length - 1];
  if (last !== undefined && last.sea && outward && food < reserve) return { ok: false, why: 'ashore', at: steps.length - 1, reserve };
  const lastV = last?.vessel ?? 'boat';
  if (last !== undefined && last.sea && outward && conds[lastV] !== undefined && conds[lastV] < hs[lastV].reserve) {
    return { ok: false, why: 'hullAshore', at: steps.length - 1, reserve: hs[lastV].reserve, cond: hs[lastV].cond, vessel: lastV };
  }
  const start = { food: Math.max(0, stores?.food ?? 0), fuel: Math.max(0, stores?.fuel ?? 0) };
  const out = { ok: true, food, fuel, spent: { food: start.food - food, fuel: roundFuel(start.fuel - fuel) }, hungry };
  if (hulls !== undefined) out.conds = conds;
  else if (conds.boat !== undefined) out.cond = conds.boat;
  return out;
}

/**
 * Hull wear (phase 3d), in % of condition: 1 per sea hex entered, 2 in deep water (`deep`: 3+ hexes
 * from land), 1 per hex of a fast-travel hop. The homeward rule's free moves wear nothing. Below WORN % a hull keeps
 * out of deep water; at 0 it only limps home (sea steps closer to a coast, which may always be taken).
 */
export const WEAR = { near: 1, deep: 2 };
export const WORN = 50;
export const wearOf = (step) => {
  if (step.free) return 0;
  if (step.hop > 0) return step.hop * WEAR.near;
  if (!step.sea) return 0;
  // A storm on the sea hex entered (phase 5c-3): `storm` is its wear factor (weather-model STORM_WEAR, ×3).
  const x = Number.isFinite(step.storm) && step.storm > 0 ? step.storm : 1;
  return (step.deep ? WEAR.deep : WEAR.near) * x;
};
export const pathWear = (steps) => steps.reduce((sum, s) => sum + wearOf(s), 0);
/**
 * The paid steps home: the way to a coast, at most the hull's reach (beyond it the way home is free). The galleon's
 * reach has no limit (build .152): a hex with no way home at all then counts nothing rather than Infinity.
 */
const homeStepsPaid = (homeSteps, reach) => {
  const steps = Number.isFinite(homeSteps) ? Math.min(homeSteps, reach) : reach;
  return Number.isFinite(steps) ? steps : 0;
};

/** Condition to keep when a voyage ends at sea: one hex of wear per step home, at most the hull's reach. */
export const hullReserve = (homeSteps, reach) => homeStepsPaid(homeSteps, reach) * WEAR.near;

/** HP the stores must keep at sea: one ration per paid step home. Beyond the hull's reach the way home is free. */
export const ashoreReserve = (homeSteps, reach) => homeStepsPaid(homeSteps, reach) * costOf('water').rations * RATION_HP;

// ---- night (phase 3e) ------------------------------------------------------------------------------

/**
 * Night on the player's own clock (decided 16 Oct 2026): 21:00 to 05:00 local time, moved by the "Night" setting's
 * shift (−12 to 12 hours). Night is a trade, never a penalty: light is bought only from the fuel a move leaves over,
 * and every lit hex pays more Voyage XP (voyage-model.mjs STAR_XP).
 */
export const NIGHT = { start: 21, end: 5 };
/** Fuel per night hex for light: campfire and torch on land, the lanterns at sea (the galley stays in the ration). */
export const LIGHT = { land: 0.5, sea: 0.25 };
/** Every Astrology level cuts the light by 0.5% (steering by the stars), up to level 99; on top of Firemaking's cut. */
export const ASTROLOGY_CUT = 0.005;
export const lightFactor = (astroLevel) => 1 - ASTROLOGY_CUT * Math.min(99, Math.max(0, Math.floor(astroLevel ?? 0)));

const clampShift = (shift) => (Number.isFinite(shift) ? Math.max(-12, Math.min(12, Math.round(shift))) : 0);
/** True when `hour` (0 to 24, fractions for the minutes) falls in the night, moved by `shift` hours. */
export function isNight(hour, shift = 0) {
  const h = (((hour - clampShift(shift)) % 24) + 24) % 24;
  return h >= NIGHT.start || h < NIGHT.end;
}
/** The whole hour at which it next turns (night ends or starts), on the player's clock. */
export function nextTurn(hour, shift = 0) {
  const at = isNight(hour, shift) ? NIGHT.end : NIGHT.start;
  return (((at + clampShift(shift)) % 24) + 24) % 24;
}
/** The night's hours on the player's clock, { start, end }. */
export const nightHours = (shift = 0) => ({ start: (NIGHT.start + clampShift(shift) + 24) % 24, end: (NIGHT.end + clampShift(shift) + 24) % 24 });

/** Light for one step: a hop counts its hexes at sea; free and hungry steps are not lit. */
export function lightCost(step, fmLevel, astroLevel) {
  if (step.free || step.hungry) return 0;
  const base = step.hop > 0 ? step.hop * LIGHT.sea : step.sea ? LIGHT.sea : LIGHT.land;
  return roundFuel(base * fuelFactor(fmLevel) * lightFactor(astroLevel));
}
/**
 * Lights a planned move at night. The day plan comes first and stands (planMove: pay, walk hungry, or refuse); only
 * the fuel it leaves over lights the hexes, in walking order, until it runs short. So light can never refuse a move,
 * never takes fuel a later step needs, and an unlit hex is just a day hex. Returns the plan with `lit` (step indices),
 * the fuel left and spent updated, and `light` (the fuel burned); a refused plan comes back as it was.
 */
export function planLight(plan, steps, { fmLevel = 1, astroLevel = 1, hold = 0 } = {}) {
  if (!plan.ok) return plan;
  const hungry = new Set(plan.hungry);
  let fuel = plan.fuel;
  // `hold` (phase 5a): fuel the rest of a timed voyage still needs, never spent on light for this hex.
  let spare = roundFuel(Math.max(0, fuel - (Number.isFinite(hold) && hold > 0 ? hold : 0)));
  let light = 0;
  const lit = [];
  for (let i = 0; i < steps.length; i++) {
    const c = hungry.has(i) ? 0 : lightCost(steps[i], fmLevel, astroLevel);
    if (c <= 0) continue;
    if (spare + 1e-9 < c) break;
    spare = roundFuel(Math.max(0, spare - c));
    fuel = roundFuel(Math.max(0, fuel - c));
    light = roundFuel(light + c);
    lit.push(i);
  }
  return { ...plan, fuel, lit, light, spent: { ...plan.spent, fuel: roundFuel(plan.spent.fuel + light) } };
}
/** How many steps of a move could be lit at all (not free, not hungry). */
export const lightable = (steps, plan) => steps.filter((s, i) => !s.free && !(plan?.hungry ?? []).includes(i)).length;
