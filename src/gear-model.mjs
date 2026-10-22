// Gear, relics and the Albatross: the numbers the data package data/gear.json carries, the effects
// read from the player's modifier table, and the pure rules the game side (src/gear.mjs) applies. No game globals.
//
// Every effect is a `voyage:` modifier declared in data/gear.json; a positive value is always the good way (a cut in
// rations, fuel, hull wear, time, the pirates' toll; more cargo pay; more sight), so the game's own descriptions read
// right and a stack from several sources adds up. `effects` caps each total: the stores never get cheaper than half,
// a hex never quicker than three quarters, the pirates never ask less than a quarter. The late game stays a voyage.

export const SKILL_ID = 'voyage:Voyage';
export const SUMMONING_ID = 'melvorD:Summoning';
export const ANCIENT_RELICS_GAMEMODE = 'melvorAoD:AncientRelics';

/** The modifiers, in data/gear.json's order, and the most any total may reach (percent; nightSight in hexes). */
export const MODIFIERS = ['rationCut', 'fuelCut', 'wearCut', 'paceCut', 'pirateCut', 'cargoPay', 'nightSight'];
export const CAPS = { rationCut: 50, fuelCut: 50, wearCut: 50, paceCut: 25, pirateCut: 75, cargoPay: 50, nightSight: 2 };

// ---- the Seafarer's Outfit (the Township shop, like the game's skilling outfits) ------------------------------------
/** Pieces in shop order: local item id → equipment slot. */
export const OUTFIT = { Seafarers_Hat: 'Helmet', Seafarers_Coat: 'Platebody', Seafarers_Breeches: 'Platelegs', Seafarers_Boots: 'Boots' };
/** Township shop gating per piece, as for the game's outfits: [Township level, tasks completed]. */
export const OUTFIT_GATES = [[10, 20], [20, 40], [40, 60], [60, 80]];
export const OUTFIT_PRICE = 100000;
export const OUTFIT_XP_PER_PIECE = 2;
/** The whole set's Voyage XP, set bonus included, stays at this or under (XP is the slow currency). */
export const OUTFIT_XP_MAX = 10;
/** With all four worn (itemSynergies): the stores go further. */
export const OUTFIT_SET = { 'voyage:rationCut': 10, 'voyage:fuelCut': 10 };
export const SKILLING_OUTFIT_UPGRADE = 'melvorF:Skilling_Outfit_Upgrade';

// ---- the Ancient Relics set (that game mode only) --------------------------------------------------------------------
/** Relic local ids in set order; the sixth is the master relic. */
export const RELICS = ['VoyageRelic1', 'VoyageRelic2', 'VoyageRelic3', 'VoyageRelic4', 'VoyageRelic5', 'VoyageMasterRelic'];
/** What each gives (data/gear.json, checked by the tests). */
export const RELIC_MODIFIERS = {
  VoyageRelic1: { 'voyage:rationCut': 10 },
  VoyageRelic2: { 'voyage:fuelCut': 10 },
  VoyageRelic3: { 'voyage:cargoPay': 10 },
  VoyageRelic4: { 'voyage:wearCut': 20 },
  // skillXP is scoped by skill alone: a realm on it fails the engine's soft-dependency pass, which runs again for every
  // package registered after this one (the Throne of the Herald package was lost to that until build .393).
  VoyageRelic5: { skillXP: [{ skillID: SKILL_ID, value: 10 }], 'voyage:paceCut': 10 },
  VoyageMasterRelic: { nonCombatSkillXP: 5, minHitBasedOnMaxHit: 5, 'voyage:pirateCut': 50, 'voyage:nightSight': 1 },
};
/**
 * Each of the five rolls on every hex entered (percent). A hex is rarer than a skill action by far (a timed hex is
 * minutes, an action seconds), so the odds are a hundred times the game's 0.0005% an action: about one relic in
 * 2,000 hexes, the set in some 4,500, with the two guaranteed at Voyage 20 and 99 taken off that.
 */
export const RELIC_CHANCE = 0.05;
export const RELIC_LEVELS = [20, 99];
/** The Voyage Lesser Relic: the mode's consumable, a rare drop of each hex entered, so many charges a find. */
export const LESSER_RELIC = { id: 'Voyage_Lesser_Relic', quantity: 150, chance: 1 };
export const LESSER_RELIC_MODIFIERS = { skillXP: [{ skillID: SKILL_ID, value: 5 }], 'voyage:rationCut': 5, 'voyage:fuelCut': 5, damageTaken: -5 };

// ---- the Albatross (a Summoning familiar for Voyage) -----------------------------------------------------------------
export const FAMILIAR = {
  id: 'Albatross',
  item: 'Summoning_Familiar_Albatross',
  level: 40,
  tier: 2,
  xp: 21,
  shards: [{ id: 'melvorF:Summoning_Shard_Green', quantity: 8 }, { id: 'melvorF:Summoning_Shard_Silver', quantity: 6 }],
  goods: ['voyage:Sack', 'voyage:Crate'],
  modifiers: { 'voyage:rationCut': 10, 'voyage:fuelCut': 10 },
};
/**
 * A tablet is spent on every hex entered (one per step; a hop is one step). The engine's Summoning XP for a tablet
 * grows with the action's length, and a hex is minutes long, so each is counted as a plain action of this length.
 */
export const TABLET_MS = 3000;
/**
 * The mark rolls on every hex entered as an action of this length: the engine's chance is modifier × ms /
 * (2000 × (tier + 1)²) percent, ×2 with the tablet worn (Voyage has no mastery), so 1.33% a hex bare and 2.67% worn:
 * the first mark in about 40 worn hexes, the sixth level (61 marks) in some 2,300.
 */
export const MARK_MS = 24000;
/** The synergies with the game's familiars: `with` is the partner's recipe id. Expressed as modifiers only (a mod's synergy has no custom text). */
export const SYNERGIES = [
  { with: 'melvorF:Ent', modifiers: { 'voyage:fuelCut': 20 } },
  { with: 'melvorF:Octopus', modifiers: { 'voyage:rationCut': 20 } },
  { with: 'melvorF:Leprechaun', modifiers: { 'voyage:cargoPay': 15 } },
  { with: 'melvorF:Salamander', modifiers: { 'voyage:wearCut': 25 } },
  { with: 'melvorF:Minotaur', modifiers: { 'voyage:pirateCut': 50 } },
];
/** Throne of the Herald's familiars: registered only with that expansion (its recipe ids would not resolve without it). */
export const TOTH_SYNERGIES = [
  { with: 'melvorTotH:Eagle', modifiers: { 'voyage:paceCut': 10 } },
  { with: 'melvorTotH:Owl', modifiers: { 'voyage:nightSight': 1 } },
];
export const synergyData = (list) => list.map((s) => ({ summonIDs: [`voyage:${FAMILIAR.id}`, s.with], modifiers: s.modifiers, consumesOn: [] }));
/** The data package for Throne of the Herald's synergies. */
export const familiarItemId = () => `voyage:${FAMILIAR.item}`;
export const lesserRelicItemId = () => `voyage:${LESSER_RELIC.id}`;

// ---- the capes and the pet (the user, 22 Oct 2026) -----------------------------------------------------------------
/**
 * The Voyage Skillcape at 99 and, with Throne of the Herald, the Superior at 120: the Shop's Skillcapes tabs, the
 * game's prices, each right before its Cape of Completion. A cape is the captain's trade and seamanship: cargo pay,
 * wear forgiven, a quicker timed hex; the Superior leans on the pirates too. Chosen against the caps: outside the
 * Ancient Relics mode every stack with the Superior stays under its cap, so each piece is felt; with the relics on
 * top the caps bite (the tests hold both).
 */
export const CAPE_OF_COMPLETION = 'melvorF:Cape_of_Completion';
export const SUPERIOR_CAPE_OF_COMPLETION = 'melvorTotH:Superior_Cape_Of_Completion';
export const SKILLCAPE = { id: 'Voyage_Skillcape', level: 99, price: 1000000, sellsFor: 250000, media: 'assets/skillcape.webp', modifiers: { 'voyage:cargoPay': 15, 'voyage:wearCut': 10, 'voyage:paceCut': 5 } };
export const SUPERIOR_SKILLCAPE = { id: 'Superior_Voyage_Skillcape', level: 120, price: 10000000, sellsFor: 1000000, media: 'assets/skillcape_superior.webp', modifiers: { 'voyage:cargoPay': 25, 'voyage:wearCut': 15, 'voyage:paceCut': 10, 'voyage:pirateCut': 15 } };
/** Every skillcape's defence bonus, melee, ranged and magic alike. */
export const CAPE_DEFENCE = 9;
const defence = (value) => ['meleeDefenceBonus', 'rangedDefenceBonus', 'magicDefenceBonus'].map((key) => ({ key, value }));
/** The cape as an item of the game's Skillcape kind (data/gear.json holds the base cape as this; the Superior is built). */
export const capeItem = (c, name) => ({
  itemType: 'Equipment', id: c.id, name, category: 'Voyage', type: 'Armour', media: c.media,
  ignoreCompletion: false, obtainFromItemLog: false, golbinRaidExclusive: false, sellsFor: c.sellsFor, tier: 'Skillcape',
  validSlots: ['Cape'], occupiesSlots: [], equipRequirements: [{ type: 'SkillLevel', skillID: SKILL_ID, level: c.level }],
  equipmentStats: defence(CAPE_DEFENCE), modifiers: c.modifiers,
});
/** Its shop purchase in `category`: one, at the cape's level, for its price. */
export const capePurchase = (c, category) => ({
  id: c.id, media: c.media, category, contains: { items: [{ id: `voyage:${c.id}`, quantity: 1 }] },
  cost: { items: [], currencies: [{ currency: 'melvorD:GP', type: 'Fixed', cost: c.price }] },
  allowQuantityPurchase: false, unlockRequirements: [], purchaseRequirements: [{ type: 'SkillLevel', skillID: SKILL_ID, level: c.level }],
  defaultBuyLimit: 1, buyLimitOverrides: [], showBuyLimit: false,
});
/** Throne of the Herald's package: the Superior cape, its shop entry and the expansion's synergies. */
export const tothPackage = () => ({
  items: [capeItem(SUPERIOR_SKILLCAPE, 'Superior Voyage Skillcape')],
  shopPurchases: [capePurchase(SUPERIOR_SKILLCAPE, 'melvorTotH:SuperiorSkillcapes')],
  shopDisplayOrder: [{ insertAt: 'Before', beforeID: SUPERIOR_CAPE_OF_COMPLETION, ids: [`voyage:${SUPERIOR_SKILLCAPE.id}`] }],
  skillData: [{ skillID: SUMMONING_ID, data: { synergies: synergyData(TOTH_SYNERGIES) } }],
});
/**
 * Barnacle, the ship's cat: Voyage's pet, found on the hexes travelled. Rats off the stores and the rigging: -5%
 * rations a hex and a wear point in twenty forgiven, modest as the game's own pets. The engine rolls it per hex as
 * an action of PET_MS, a land hex's plain six minutes (clock-model.mjs LAND_MS), so by the clock the cat comes at the
 * game's own pet pace: its chance is ms / 1000 × level / 250,000 %, 0.14% a hex at 99 (a cat in some 700 hexes,
 * 70 hours of timed travel, a skill pet's 70 hours of actions), 0.03% at 20 (3,500). A long-term find, like the
 * relics' one in two thousand hexes each, and the player who travels with timed travel off gets it per hex all the same.
 */
export const PET = { id: 'Barnacle', modifiers: { 'voyage:rationCut': 5, 'voyage:wearCut': 5 } };
export const PET_MS = 6 * 60000;
export const petId = () => `voyage:${PET.id}`;
/** The engine's chance per roll (percent) at a level, a hex counted as PET_MS. */
export const petChance = (level, ms = PET_MS) => ((ms / 1000) * level) / 250000;

// ---- reading the effects --------------------------------------------------------------------------------------------
const clamp = (v, cap) => (Number.isFinite(v) ? Math.min(cap, Math.max(0, v)) : 0);
/** Every effect's total, capped: `read(localId)` gives the player's modifier value. */
export function effects(read) {
  const out = {};
  for (const id of MODIFIERS) { let v = 0; try { v = Number(read(id)); } catch { v = 0; } out[id] = clamp(v, CAPS[id]); }
  return out;
}
/** stores-model's `mods` ({ rations, fuel } percent changes) from the effects. */
export const costMods = (e) => ({ rations: -(e?.rationCut ?? 0), fuel: -(e?.fuelCut ?? 0) });
/** The clock's pace: a factor on every hex's time. */
export const pace = (e) => 1 - (e?.paceCut ?? 0) / 100;
/** GP from a cargo delivery or a harbour task with the cargo pay on it (whole GP). */
export const payOf = (gp, e) => (Number.isFinite(gp) && gp > 0 ? Math.round(gp * (1 + (e?.cargoPay ?? 0) / 100)) : 0);
/** The pirates' toll with the cut on it (whole GP, at least 1 as the toll itself). */
export const tollOf = (toll, e) => (Number.isFinite(toll) && toll > 0 ? Math.max(1, Math.round(toll * (1 - (e?.pirateCut ?? 0) / 100))) : 0);
/**
 * Hull wear forgiven after a move: of `taken` points the plan took, each is given back with wearCut % chance. The
 * planner keeps the full wear (a trip is refused on what the hull can surely bear); the luck comes after.
 */
export function forgiveWear(taken, wearCut, rand = Math.random) {
  const n = Number.isFinite(taken) ? Math.max(0, Math.floor(taken)) : 0;
  const p = clamp(wearCut, CAPS.wearCut);
  if (n === 0 || p <= 0) return 0;
  let back = 0;
  for (let i = 0; i < n; i++) if (rand() * 100 < p) back += 1;
  return back;
}
/** The night sight on a lit sea hex: the model's +1 and the gear's hexes on top; a dark hex stays as it is. */
export const sightWith = (d, e) => (d > 0 ? d + (e?.nightSight ?? 0) : d);
/** The hexes a move charges for (relic rolls, tablets, Lesser Relic charges): every step but the homeward rule's free ones. */
export const chargeSteps = (steps) => (Array.isArray(steps) ? steps.filter((s) => s !== undefined && s.free !== true).length : 0);
/** The engine's mark chance for a tablet, in percent, for the docs and the tests. */
export const markChance = (ms, tier, worn) => ((worn ? 2 : 1) * ms) / (2000 * (tier + 1) ** 2);
/** The engine's Summoning XP for a tablet spent on an action of `ms`. */
export const tabletXP = (level, ms) => ((ms / 1000) * level) / ((level + 10) / 10);
