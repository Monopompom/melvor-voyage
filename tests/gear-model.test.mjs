// Gear, relics and the Albatross (src/gear-model.mjs and data/gear.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SKILL_ID, SUMMONING_ID, ANCIENT_RELICS_GAMEMODE, MODIFIERS, CAPS, OUTFIT, OUTFIT_GATES, OUTFIT_PRICE, OUTFIT_XP_PER_PIECE, OUTFIT_XP_MAX,
  OUTFIT_SET, SKILLING_OUTFIT_UPGRADE, RELICS, RELIC_MODIFIERS, RELIC_CHANCE, RELIC_LEVELS, LESSER_RELIC, LESSER_RELIC_MODIFIERS, FAMILIAR,
  TABLET_MS, MARK_MS, SYNERGIES, TOTH_SYNERGIES, synergyData, tothPackage, familiarItemId, lesserRelicItemId,
  effects, costMods, pace, payOf, tollOf, forgiveWear, sightWith, chargeSteps, markChance, tabletXP,
  CAPE_OF_COMPLETION, SUPERIOR_CAPE_OF_COMPLETION, SKILLCAPE, SUPERIOR_SKILLCAPE, CAPE_DEFENCE, capeItem, capePurchase,
  PET, PET_MS, petId, petChance,
} from '../src/gear-model.mjs';
import { stepCost, pathCost, planMove, lightCost, gearMul, roundFuel, RATION_HP } from '../src/stores-model.mjs';
import { stepMs, LAND_MS } from '../src/clock-model.mjs';
import { JOURNAL_GUIDES } from '../src/voyage-model.mjs';

const pkg = JSON.parse(readFileSync(new URL('../data/gear.json', import.meta.url), 'utf8'));
const en = JSON.parse(readFileSync(new URL('../languages/en.json', import.meta.url), 'utf8'));
const data = pkg.data;
const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
/** The game's base familiars (melvorF recipe ids): a synergy partner must be one of them. */
const BASE_FAMILIARS = ['GolbinThief', 'Occultist', 'Wolf', 'Ent', 'Mole', 'Octopus', 'Minotaur', 'Centaur', 'Witch', 'Pig', 'Crow', 'Leprechaun', 'Cyclops', 'Yak', 'Unicorn', 'Dragon', 'Monkey', 'Salamander', 'Bear', 'Devil'];
const TOTH_FAMILIARS = ['Eagle', 'Owl', 'Beaver', 'Fox', 'LightningSpirit', 'Siren', 'Spider', 'Spectre'];

test('the package targets the mod namespace, the Voyage skill and Summoning', () => {
  assert.equal(pkg.namespace, 'voyage');
  assert.deepEqual(data.skillData.map((s) => s.skillID), [SKILL_ID, SUMMONING_ID]);
  assert.deepEqual(data.ancientRelicsDisplayOrder, [{ insertAt: 'End', ids: [SKILL_ID] }]);
});

test('the modifiers: declared once each, positive is the good way, every one has its text in en.json', () => {
  assert.deepEqual(data.modifiers.map((m) => m.id), MODIFIERS);
  for (const m of data.modifiers) {
    assert.equal(m.inverted, undefined, m.id);
    const d = m.allowedScopes[0].descriptions[0];
    assert.equal(d.includeSign, false);
    assert.equal(d.lang, `MOD_VOY_MODIFIER_${m.id}`);
    assert.equal(en[d.lang], d.text, m.id);
    assert.ok(CAPS[m.id] > 0, m.id);
  }
});

test('the Seafarer\'s Outfit: four pieces in the game\'s format, +2% Voyage XP each, 10% at most with the set, the set cuts the stores', () => {
  const items = byId(data.items);
  for (const [id, slot] of Object.entries(OUTFIT)) {
    const item = items[id];
    assert.ok(item, `${id} missing`);
    assert.deepEqual(item.validSlots, [slot]);
    assert.deepEqual(item.modifiers, { skillXP: [{ skillID: SKILL_ID, value: OUTFIT_XP_PER_PIECE }] });
    assert.equal(item.itemType, 'Equipment');
    assert.deepEqual(item.equipRequirements, []);
    assert.equal(item.sellsFor, 2000);
    assert.match(item.media, /^assets\/seafarers_\w+\.webp$/);
    assert.equal(item.customDescription, en.MOD_VOY_ITEM_OUTFIT_DESC);
    assert.equal(en[`MOD_VOY_ITEM_${id.toUpperCase()}_NAME`], item.name);
  }
  assert.deepEqual(Object.values(OUTFIT), ['Helmet', 'Platebody', 'Platelegs', 'Boots']);
  assert.equal(data.itemSynergies.length, 1);
  const set = data.itemSynergies[0];
  assert.deepEqual(set.itemIDs, Object.keys(OUTFIT).map((id) => `voyage:${id}`));
  assert.deepEqual(set.playerModifiers, OUTFIT_SET);
  // The rule: the whole set's Voyage XP stays at 10% or under; the set bonus is no XP at all.
  const setXP = (set.playerModifiers.skillXP ?? []).reduce((s, m) => s + m.value, 0);
  assert.ok(OUTFIT_XP_PER_PIECE * 4 + setXP <= OUTFIT_XP_MAX);
});

test('the outfit in the Township shop: 100,000 GP a piece, the game\'s level and task gates, before the Skilling Outfit Upgrade', () => {
  const purchases = byId(data.shopPurchases);
  Object.keys(OUTFIT).forEach((id, i) => {
    const p = purchases[id];
    assert.ok(p, `${id} purchase missing`);
    assert.equal(p.category, 'melvorF:Township');
    assert.deepEqual(p.contains.items, [{ id: `voyage:${id}`, quantity: 1 }]);
    assert.deepEqual(p.cost.currencies, [{ currency: 'melvorD:GP', type: 'Fixed', cost: OUTFIT_PRICE }]);
    assert.deepEqual(p.purchaseRequirements, [
      { type: 'SkillLevel', skillID: 'melvorD:Township', level: OUTFIT_GATES[i][0] },
      { type: 'TownshipTask', count: OUTFIT_GATES[i][1] },
    ]);
    assert.equal(p.defaultBuyLimit, 0);
  });
  assert.deepEqual(data.shopDisplayOrder[0], { insertAt: 'Before', beforeID: SKILLING_OUTFIT_UPGRADE, ids: Object.keys(OUTFIT).map((id) => `voyage:${id}`) });
});

test('the relic set: five rolled on every hex at 0.05%, the master for the set, unlocks at 20 and 99, the effects as designed', () => {
  const relics = byId(data.ancientRelics);
  RELICS.forEach((id, i) => {
    const r = relics[id];
    assert.ok(r, `${id} missing`);
    assert.equal(r.skillID, SKILL_ID);
    assert.equal(r.number, i + 1);
    assert.deepEqual(r.modifiers, RELIC_MODIFIERS[id]);
    assert.equal(en[`MOD_VOY_RELIC_${id}`], r.name);
    assert.equal(r.name, i < 5 ? `Voyage Relic ${i + 1}` : 'Voyage Master Relic');
  });
  const set = data.skillData[0].data.ancientRelicSets;
  assert.equal(set.length, 1);
  assert.equal(set[0].realmID, 'melvorD:Melvor');
  assert.deepEqual(set[0].relicDrops.map((d) => d.relicID), RELICS.slice(0, 5).map((id) => `voyage:${id}`));
  for (const d of set[0].relicDrops) assert.deepEqual(d.chance, { type: 'Fixed', chance: RELIC_CHANCE });
  assert.equal(set[0].completedRelicID, `voyage:${RELICS[5]}`);
  assert.deepEqual(set[0].levelUpUnlocks, RELIC_LEVELS);
  // a relic in about 2,000 hexes, the set in some 4,500 (the expected longest of five such waits)
  const expectedOne = 100 / RELIC_CHANCE;
  const expectedSet = expectedOne * (1 + 1 / 2 + 1 / 3 + 1 / 4 + 1 / 5);
  assert.equal(expectedOne, 2000);
  assert.ok(expectedSet > 4000 && expectedSet < 5000, `${expectedSet}`);
});

test('the Voyage Lesser Relic: that mode\'s consumable, 1% a hex for 150 charges, a charge on every attack by the engine', () => {
  const item = byId(data.items)[LESSER_RELIC.id];
  assert.ok(item);
  assert.deepEqual(item.validSlots, ['Consumable']);
  assert.deepEqual(item.modifiers, LESSER_RELIC_MODIFIERS);
  assert.deepEqual(item.consumesOn, [{ type: 'PlayerAttack' }]);
  assert.equal(item.ignoreCompletion, true);
  assert.equal(lesserRelicItemId(), `voyage:${LESSER_RELIC.id}`);
  assert.deepEqual(data.skillData[0].data.rareDrops, [{
    itemID: lesserRelicItemId(), quantity: LESSER_RELIC.quantity, requirements: [], chance: { type: 'Fixed', chance: LESSER_RELIC.chance }, gamemodes: [ANCIENT_RELICS_GAMEMODE],
  }]);
  assert.equal(en.MOD_VOY_ITEM_VOYAGE_LESSER_RELIC_NAME, item.name);
});

test('the Albatross: a tier 2 familiar at Summoning 40 for the Voyage skill, the tablet in the game\'s format, spent by the mod', () => {
  const item = byId(data.items)[FAMILIAR.item];
  assert.ok(item);
  assert.equal(item.category, 'Summoning');
  assert.equal(item.type, 'Familiar');
  assert.equal(item.tier, `Tier ${FAMILIAR.tier} Summon`);
  assert.deepEqual(item.validSlots, ['Summon1', 'Summon2']);
  assert.equal(item.sellsFor, 0);
  assert.deepEqual(item.modifiers, FAMILIAR.modifiers);
  assert.deepEqual(item.consumesOn, [], 'no engine event fits a mod skill: src/gear.mjs spends the charge per hex');
  assert.equal(familiarItemId(), `voyage:${FAMILIAR.item}`);
  assert.equal(en.MOD_VOY_ITEM_ALBATROSS_NAME, item.name);
  const recipes = data.skillData[1].data.recipes;
  assert.equal(recipes.length, 1);
  const r = recipes[0];
  assert.equal(r.id, FAMILIAR.id);
  assert.equal(r.level, FAMILIAR.level);
  assert.equal(r.tier, FAMILIAR.tier);
  assert.equal(r.baseExperience, FAMILIAR.xp);
  assert.equal(r.baseQuantity, 25);
  assert.equal(r.productID, familiarItemId());
  assert.equal(r.categoryID, 'melvorD:TabletsFamiliars');
  assert.deepEqual(r.itemCosts, FAMILIAR.shards);
  assert.deepEqual(r.nonShardItemCosts, FAMILIAR.goods);
  assert.deepEqual(r.skillIDs, [SKILL_ID]);
  assert.match(r.markMedia, /^assets\/mark_albatross\.webp$/);
  // tier 2 shards as the game's (Pig, Crow, Leprechaun): 8 Green and 6 Silver; a level between Crow 35 and Leprechaun 45
  assert.deepEqual(FAMILIAR.shards.map((s) => s.quantity), [8, 6]);
  assert.ok(FAMILIAR.level > 35 && FAMILIAR.level < 45);
});

test('the synergies: with the game\'s own familiars only, modifiers of this mod only, spent by the mod; TotH ones in their own package', () => {
  const partnerOk = (id, list, ns) => { const [space, local] = id.split(':'); return space === ns && list.includes(local); };
  for (const s of SYNERGIES) assert.ok(partnerOk(s.with, BASE_FAMILIARS, 'melvorF'), s.with);
  for (const s of TOTH_SYNERGIES) assert.ok(partnerOk(s.with, TOTH_FAMILIARS, 'melvorTotH'), s.with);
  const all = [...SYNERGIES, ...TOTH_SYNERGIES];
  assert.equal(new Set(all.map((s) => s.with)).size, all.length, 'one synergy a partner');
  for (const s of all) {
    for (const [id, value] of Object.entries(s.modifiers)) {
      assert.ok(MODIFIERS.includes(id.replace('voyage:', '')), id);
      assert.ok(value > 0 && value <= CAPS[id.replace('voyage:', '')], `${s.with} ${id} ${value}`);
    }
  }
  assert.deepEqual(data.skillData[1].data.synergies, synergyData(SYNERGIES));
  for (const s of data.skillData[1].data.synergies) {
    assert.equal(s.summonIDs[0], `voyage:${FAMILIAR.id}`);
    assert.deepEqual(s.consumesOn, []);
    assert.equal(s.customDescription, undefined, 'the engine reads no custom text for a mod\'s synergy');
  }
  assert.deepEqual(tothPackage().skillData, [{ skillID: SUMMONING_ID, data: { synergies: synergyData(TOTH_SYNERGIES) } }]);
});

test('tablets and marks: a hex is a short action for the XP and a long one for the mark', () => {
  assert.equal(TABLET_MS, 3000);
  assert.equal(MARK_MS, 24000);
  // the engine's chance: 2.67% a hex worn (the first mark in about 40 hexes), 1.33% bare
  assert.ok(Math.abs(markChance(MARK_MS, FAMILIAR.tier, true) - 8 / 3) < 1e-9);
  assert.ok(Math.abs(markChance(MARK_MS, FAMILIAR.tier, false) - 4 / 3) < 1e-9);
  // Summoning XP for a tablet: 25.2 at Summoning 40 for a 3 s action, the engine's formula
  assert.ok(Math.abs(tabletXP(40, TABLET_MS) - 24) < 1e-9);
  assert.equal(chargeSteps([{ cls: 'grasslands' }, { sea: true, free: true }, { sea: true }]), 2);
  assert.equal(chargeSteps(undefined), 0);
});

test('effects: read, capped at the designed most, never negative; what the rest of the mod derives from them', () => {
  const none = effects(() => 0);
  for (const id of MODIFIERS) assert.equal(none[id], 0);
  const big = effects(() => 1000);
  assert.deepEqual(big, CAPS);
  const bad = effects((id) => (id === 'rationCut' ? NaN : id === 'fuelCut' ? -40 : undefined));
  assert.equal(bad.rationCut, 0);
  assert.equal(bad.fuelCut, 0);
  const e = effects((id) => ({ rationCut: 30, fuelCut: 45, wearCut: 20, paceCut: 10, pirateCut: 50, cargoPay: 25, nightSight: 1 })[id]);
  assert.deepEqual(costMods(e), { rations: -30, fuel: -45 });
  assert.equal(pace(e), 0.9);
  assert.equal(pace(none), 1);
  assert.equal(payOf(1000, e), 1250);
  assert.equal(payOf(1000, none), 1000);
  assert.equal(payOf(0, e), 0);
  assert.equal(tollOf(1000, e), 500);
  assert.equal(tollOf(1, e), 1, 'a toll stays a toll');
  assert.equal(sightWith(1, e), 2);
  assert.equal(sightWith(-1, e), -1, 'a dark hex sees no further');
  assert.equal(sightWith(0, e), 0);
  // the everything stack (outfit, relics, Albatross and its best synergy, the Lesser Relic) still pays half the rations
  const stack = effects((id) => ({ rationCut: 10 + 10 + 10 + 20 + 5 }[id] ?? 0));
  assert.equal(stack.rationCut, CAPS.rationCut);
});

test('wear forgiven: each point taken comes back with the cut\'s chance, never more than taken, nothing without a cut', () => {
  assert.equal(forgiveWear(3, 0), 0);
  assert.equal(forgiveWear(0, 50), 0);
  assert.equal(forgiveWear(4, 50, () => 0.49), 4);
  assert.equal(forgiveWear(4, 50, () => 0.5), 0);
  assert.equal(forgiveWear(4, 100, () => 0.5), 0, 'capped at 50: 100 reads as 50');
  assert.equal(forgiveWear(4, 100, () => 0.49), 4);
  let i = 0;
  assert.equal(forgiveWear(4, 25, () => [0.1, 0.3, 0.2, 0.9][i++]), 2);
  assert.equal(forgiveWear(2.7, 50, () => 0), 2, 'whole points');
  assert.equal(forgiveWear(NaN, 50, () => 0), 0);
});

test('the stores take the cuts last: rations and fuel each by their own percent, the light too; the planner carries them', () => {
  const land = { cls: 'grasslands', sea: false };
  const plain = stepCost(land, 1, 0);
  const cut = stepCost(land, 1, 0, { rations: -50, fuel: -50 });
  assert.equal(cut.food, Math.round(plain.food * 0.5));
  assert.equal(cut.fuel, roundFuel(plain.fuel * 0.5));
  assert.deepEqual(stepCost(land, 1, 0, undefined), plain);
  assert.deepEqual(stepCost(land, 1, 0, { rations: NaN, fuel: 'x' }), plain);
  assert.deepEqual(gearMul({ rations: -10, fuel: 20 }), { rations: 0.9, fuel: 1.2 });
  assert.deepEqual(gearMul(undefined), { rations: 1, fuel: 1 });
  assert.deepEqual(stepCost({ cls: 'water', sea: true, free: true }, 1, 0, { rations: -50, fuel: -50 }), { food: 0, fuel: 0 });
  const hop = stepCost({ cls: 'water', sea: true, hop: 4 }, 1, 0, { rations: -25, fuel: 0 });
  assert.equal(hop.food, Math.round(stepCost({ cls: 'water', sea: true, hop: 4 }, 1, 0).food * 0.75));
  const steps = [land, land, { cls: 'water', sea: true }];
  const total = pathCost(steps, 1, 0, { rations: -50, fuel: -50 });
  assert.equal(total.food, steps.reduce((s, st) => s + stepCost(st, 1, 0, { rations: -50, fuel: -50 }).food, 0));
  const plan = planMove({ food: 10 * RATION_HP, fuel: 10 }, steps, { mods: { rations: -50, fuel: -50 } });
  assert.ok(plan.ok);
  assert.equal(plan.spent.food, total.food);
  const lit = lightCost(land, 1, 1);
  assert.equal(lightCost(land, 1, 1, { rations: 0, fuel: -50 }), roundFuel(lit * 0.5));
  assert.equal(lightCost(land, 1, 1, { rations: -50, fuel: 0 }), lit, 'rations do not light the way');
});

test('the clock takes the pace last: a factor on land, sea and hops; nothing without one', () => {
  assert.equal(stepMs({ cls: 'grasslands' }, { pace: 0.9 }), Math.round(LAND_MS * 0.9));
  assert.equal(stepMs({ cls: 'grasslands' }, { pace: 0 }), LAND_MS, 'a bad pace is no pace');
  assert.equal(stepMs({ cls: 'grasslands' }), LAND_MS);
  const sea = stepMs({ cls: 'water', sea: true });
  assert.equal(stepMs({ cls: 'water', sea: true }, { pace: 0.75 }), Math.round(sea * 0.75));
  const hop = stepMs({ fastTravel: true, hop: 3 });
  assert.equal(stepMs({ fastTravel: true, hop: 3 }, { pace: 0.9 }), Math.round(hop * 0.9));
});

test('the journal has a page for the outfit, the Albatross and the relics', () => {
  for (const id of ['outfit', 'albatross', 'relics']) {
    assert.ok(JOURNAL_GUIDES.includes(id), id);
    for (const x of ['TITLE', 'BODY', 'POINTS']) assert.ok(typeof en[`MOD_VOY_JOURNAL_GUIDE_${id.toUpperCase()}_${x}`] === 'string', `${id} ${x}`);
  }
  // the pages quote the numbers: keep them with the constants
  assert.match(en.MOD_VOY_JOURNAL_GUIDE_RELICS_POINTS, new RegExp(`${RELIC_CHANCE}% chance`));
  assert.match(en.MOD_VOY_JOURNAL_GUIDE_RELICS_POINTS, new RegExp(`${LESSER_RELIC.quantity} Voyage Lesser Relics`));
  assert.match(en.MOD_VOY_JOURNAL_GUIDE_ALBATROSS_POINTS, new RegExp(`Summoning ${FAMILIAR.level} makes`));
  assert.match(en.MOD_VOY_JOURNAL_GUIDE_OUTFIT_POINTS, /100,000 GP each/);
  assert.match(en.MOD_VOY_JOURNAL_GUIDE_OUTFIT_POINTS, /Voyage Skillcape for 1,000,000 GP/);
  assert.match(en.MOD_VOY_JOURNAL_GUIDE_OUTFIT_POINTS, /Barnacle, the ship's cat/);
});

test('outside Ancient Relics mode every text that names a relic has a twin that names none', () => {
  const twins = Object.keys(en).filter((k) => k.endsWith('_NR'));
  assert.ok(twins.length >= 9, `${twins.length} twins`);
  for (const nr of twins) {
    const key = nr.slice(0, -3);
    assert.equal(typeof en[key], 'string', `${nr} has no original`);
    assert.match(en[key], /relic/i, `${key} names no relic: its twin is not needed`);
    assert.doesNotMatch(en[nr], /relic/i, nr);
  }
  for (const key of ['MOD_VOY_JOURNAL_GUIDE_OUTFIT_POINTS', 'MOD_VOY_JOURNAL_CH_LEAVING_WHAT_BODY']) assert.ok(`${key}_NR` in en, key);
});

test('the capes: the Voyage Skillcape at 99 and, with Throne of the Herald, the Superior at 120; the game\'s prices and tabs, a Cape of Completion behind each', () => {
  const item = byId(data.items)[SKILLCAPE.id];
  assert.deepEqual(item, capeItem(SKILLCAPE, 'Voyage Skillcape'));
  assert.equal(en[`MOD_VOY_ITEM_${SKILLCAPE.id.toUpperCase()}_NAME`], item.name);
  assert.equal(en[`MOD_VOY_ITEM_${SUPERIOR_SKILLCAPE.id.toUpperCase()}_NAME`], 'Superior Voyage Skillcape');
  assert.deepEqual(byId(data.shopPurchases)[SKILLCAPE.id], capePurchase(SKILLCAPE, 'melvorD:Skillcapes'));
  assert.equal(data.shopDisplayOrder.length, 2);
  assert.deepEqual(data.shopDisplayOrder[1], { insertAt: 'Before', beforeID: CAPE_OF_COMPLETION, ids: [`voyage:${SKILLCAPE.id}`] });
  for (const [c, level, price] of [[SKILLCAPE, 99, 1000000], [SUPERIOR_SKILLCAPE, 120, 10000000]]) {
    assert.equal(c.level, level);
    assert.equal(c.price, price);
    const it = capeItem(c, 'x');
    assert.equal(it.tier, 'Skillcape');
    assert.deepEqual(it.validSlots, ['Cape']);
    assert.deepEqual(it.equipRequirements, [{ type: 'SkillLevel', skillID: SKILL_ID, level }]);
    assert.deepEqual(it.equipmentStats.map((s) => s.value), [CAPE_DEFENCE, CAPE_DEFENCE, CAPE_DEFENCE]);
    for (const [k, v] of Object.entries(c.modifiers)) {
      assert.ok(MODIFIERS.includes(k.replace('voyage:', '')), k);
      assert.ok(v > 0 && v <= CAPS[k.replace('voyage:', '')], `${c.id} ${k} ${v}`);
    }
    const p = capePurchase(c, 'x');
    assert.deepEqual(p.purchaseRequirements, [{ type: 'SkillLevel', skillID: SKILL_ID, level }]);
    assert.equal(p.defaultBuyLimit, 1);
  }
  const t = tothPackage();
  assert.deepEqual(t.items, [capeItem(SUPERIOR_SKILLCAPE, 'Superior Voyage Skillcape')]);
  assert.deepEqual(t.shopPurchases, [capePurchase(SUPERIOR_SKILLCAPE, 'melvorTotH:SuperiorSkillcapes')]);
  assert.deepEqual(t.shopDisplayOrder, [{ insertAt: 'Before', beforeID: SUPERIOR_CAPE_OF_COMPLETION, ids: [`voyage:${SUPERIOR_SKILLCAPE.id}`] }]);
  // the Superior is the base cape and more, on every count the base cape has
  for (const [k, v] of Object.entries(SKILLCAPE.modifiers)) assert.ok(SUPERIOR_SKILLCAPE.modifiers[k] > v, k);
});

test('the pet: Barnacle, Voyage\'s own, rolled per hex as a land hex\'s six minutes: the game\'s pet pace by the clock, some 700 hexes at 99', () => {
  assert.equal(data.pets.length, 1);
  const pet = data.pets[0];
  assert.equal(pet.id, PET.id);
  assert.equal(pet.skillID, SKILL_ID);
  assert.deepEqual(pet.modifiers, PET.modifiers);
  assert.equal(pet.media, 'assets/pet.webp');
  assert.equal(pet.scaleChanceWithMasteryPool, false, 'Voyage has no mastery pool');
  assert.equal(petId(), `voyage:${PET.id}`);
  assert.deepEqual(data.skillData[0].data.pets, [petId()], 'the skill lists its pet, as the game\'s skills do');
  assert.equal(en.MOD_VOY_PET_NAME, pet.name);
  assert.equal(PET_MS, LAND_MS, 'a hex is a land hex\'s six minutes to the pet roll');
  assert.ok(petChance(99) > 0.14 && petChance(99) < 0.15, petChance(99));
  assert.ok(petChance(20) > 0.025 && petChance(20) < 0.03, petChance(20));
  // the engine's formula, percent: a 3 s action at 99 is the game's 0.0012%
  assert.ok(Math.abs(petChance(99, 3000) - 0.001188) < 1e-6);
  for (const [k, v] of Object.entries(PET.modifiers)) assert.ok(MODIFIERS.includes(k.replace('voyage:', '')) && v > 0 && v <= 5, k);
});

test('no breeze: outside the Ancient Relics mode every stack stays under its cap, the Superior cape and the cat in; with the relics the caps bite', () => {
  const sum = (sources) => {
    const t = {};
    for (const m of sources) for (const [k, v] of Object.entries(m)) if (k.startsWith('voyage:')) t[k.slice(7)] = (t[k.slice(7)] ?? 0) + v;
    return t;
  };
  // every synergy at once overstates (one partner is worn at a time), and the stack still fits
  const standard = [OUTFIT_SET, FAMILIAR.modifiers, ...SYNERGIES.map((s) => s.modifiers), ...TOTH_SYNERGIES.map((s) => s.modifiers), SUPERIOR_SKILLCAPE.modifiers, PET.modifiers];
  const s = sum(standard);
  for (const id of MODIFIERS) assert.ok((s[id] ?? 0) <= CAPS[id], `${id} ${s[id]} over ${CAPS[id]}`);
  const r = sum([...standard, ...Object.values(RELIC_MODIFIERS), LESSER_RELIC_MODIFIERS]);
  for (const id of ['rationCut', 'fuelCut', 'wearCut', 'paceCut', 'pirateCut']) assert.ok(r[id] >= CAPS[id], `${id} ${r[id]} under ${CAPS[id]}`);
  const e = effects((id) => r[id] ?? 0);
  for (const id of MODIFIERS) assert.ok(e[id] <= CAPS[id], id);
});
