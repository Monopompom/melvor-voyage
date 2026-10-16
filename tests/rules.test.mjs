import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SKILL_RULES, gatedSkillIds, isGated, allowedAt, rateAt, appliesUnder, ruleNoun, ruleLabel, ruleTerms, combatAllowedAt, tradeAllowedAt, TRADE_FEATURES } from '../src/rules.mjs';

const WC = 'melvorD:Woodcutting';
const MINING = 'melvorD:Mining';

test('the phase 2 table gates its skills and nothing else', () => {
  const ids = gatedSkillIds();
  for (const id of ['melvorD:Woodcutting', 'melvorD:Mining', 'melvorD:Fishing', 'melvorD:Farming', 'melvorD:Thieving', 'melvorD:Firemaking', 'melvorD:Cooking',
    'melvorD:Smithing', 'melvorD:Crafting', 'melvorD:Fletching', 'melvorD:Herblore', 'melvorD:Runecrafting', 'melvorD:Magic', 'melvorD:Summoning', 'melvorD:Township', 'melvorItA:Harvesting', 'worker_folks:Hiring']) {
    assert.ok(ids.includes(id), id);
  }
  for (const id of ['melvorD:Astrology', 'melvorAoD:Cartography', 'melvorD:Agility', 'melvorD:Hitpoints', 'melvorD:Prayer', 'melvorAoD:Archaeology', 'melvorD:Attack']) {
    assert.ok(!isGated(id), id);
  }
  assert.ok(Object.values(SKILL_RULES).every((r) => ['terrain', 'land', 'place'].includes(r.tier) && typeof r.noun === 'string'));
  assert.equal(ruleNoun(WC), 'forest or trees');
  assert.equal(ruleLabel('melvorD:Magic', 'Magic'), 'Alt. Magic');
  assert.equal(ruleLabel(WC, 'Woodcutting'), 'Woodcutting');
  assert.deepEqual(ruleTerms(WC), { classes: [], features: ['forest', 'tree'], pois: [], areas: [], land: false });
  assert.deepEqual(ruleTerms('melvorD:Astrology'), { classes: [], features: [], pois: [], areas: [], land: false });
  assert.ok(ruleTerms(MINING).classes.includes('snowlands')); // from the combo
  assert.ok(ruleTerms('melvorD:Firemaking').land);
  assert.deepEqual(SKILL_RULES['worker_folks:Hiring'], SKILL_RULES['melvorD:Township']); // Hiring follows Township
});

test('rateAt: classes, features, cloud, unknown hexes', () => {
  assert.equal(rateAt(WC, undefined), 1);
  assert.equal(rateAt('melvorD:Astrology', { t: 'grasslands' }), 1);
  assert.equal(rateAt(WC, { t: 'grasslands', f: ['forest'] }), 1);
  assert.equal(rateAt(WC, { t: 'grasslands', f: ['tree'] }), 0.8);
  assert.equal(rateAt(WC, { t: 'grasslands', f: ['tree', 'forest'] }), 1);
  assert.equal(rateAt(WC, { t: 'grasslands' }), 0);
  assert.equal(rateAt(WC, { t: 'grasslands', f: ['forest'], cloud: true }), 0);
  assert.equal(rateAt(MINING, { t: 'mountain' }), 1);
  assert.equal(rateAt(MINING, { t: 'badlands' }), 0.8);
  assert.equal(rateAt(MINING, { t: 'grasslands', f: ['rock'] }), 0.5);
  assert.equal(rateAt(MINING, { t: 'badlands', f: ['mine'] }), 1);
  assert.ok(allowedAt(WC, { t: 'snowlands', f: ['tree'] }));
  assert.ok(!allowedAt(WC, { t: 'water' }));
});

test('rateAt: combos, flags, pois, areas, land tier', () => {
  assert.equal(rateAt(MINING, { t: 'snowlands', f: ['snow', 'mountain'] }), 1);
  assert.equal(rateAt(MINING, { t: 'snowlands', f: ['snow'] }), 0);
  assert.equal(rateAt('melvorD:Farming', { t: 'desert', f: ['river'] }), 0.8);
  assert.equal(rateAt('melvorD:Farming', { t: 'desert' }), 0);
  assert.equal(rateAt('melvorD:Fishing', { t: 'grasslands', coast: true }), 0.8);
  assert.equal(rateAt('melvorD:Fishing', { t: 'grasslands', coast: true, f: ['river'] }), 1);
  assert.equal(rateAt('melvorD:Fishing', { t: 'water' }), 1); // until phase 3 asks for the ship
  assert.equal(rateAt('melvorD:Herblore', { t: 'snowlands', poi: 'FrostyHaven' }), 1);
  assert.equal(rateAt('melvorD:Herblore', { t: 'snowlands', poi: 'PenguinBay' }), 0);
  assert.equal(rateAt('melvorItA:Harvesting', { t: 'water', area: 'IntoTheAbyss' }), 1);
  assert.equal(rateAt('melvorItA:Harvesting', { t: 'grasslands', area: 'Farmlands' }), 0);
  assert.equal(rateAt('melvorD:Firemaking', { t: 'desert' }), 1);
  assert.equal(rateAt('melvorD:Firemaking', { t: 'water' }), 0);
  assert.equal(rateAt('melvorD:Firemaking', { t: 'shoal' }), 0);
  assert.equal(rateAt('melvorD:Cooking', { t: 'desert', cloud: true }), 0);
});

test('rateAt: one-hex grace at full speed for Mining, Smithing, Herblore, Summoning and the town and magic skills; land only, never under cloud', () => {
  const nextToMountain = () => [{ t: 'mountain' }];
  const nextToNothing = () => [{ t: 'grasslands' }, undefined];
  assert.equal(rateAt(MINING, { t: 'grasslands' }, { neighbours: nextToMountain }), 1);
  assert.equal(rateAt(MINING, { t: 'badlands' }, { neighbours: nextToMountain }), 1); // grace beats the 0.8
  assert.equal(rateAt(MINING, { t: 'grasslands' }, { neighbours: nextToNothing }), 0);
  assert.equal(rateAt(MINING, { t: 'grasslands' }), 0); // no neighbour lookup, no grace
  assert.equal(rateAt(MINING, { t: 'water' }, { neighbours: nextToMountain }), 0);
  assert.equal(rateAt(MINING, { t: 'grasslands', cloud: true }, { neighbours: nextToMountain }), 0);
  assert.equal(rateAt(MINING, { t: 'grasslands' }, { neighbours: () => [{ t: 'mountain', cloud: true }] }), 0); // a clouded neighbour gives nothing
  assert.equal(rateAt('melvorD:Smithing', { t: 'grasslands' }, { neighbours: () => [{ t: 'grasslands', f: ['city'] }] }), 1);
  assert.equal(rateAt('melvorD:Smithing', { t: 'grasslands' }, { neighbours: () => [{ t: 'grasslands', f: ['port'] }] }), 0); // port is 0.8, no grace from it
  assert.equal(rateAt('melvorD:Herblore', { t: 'snowlands' }, { neighbours: () => [{ t: 'snowlands', poi: 'FrostyHaven' }] }), 1);
  assert.equal(rateAt('melvorD:Summoning', { t: 'desert' }, { neighbours: () => [{ t: 'desert', f: ['monolith'] }] }), 1);
  assert.equal(rateAt(WC, { t: 'grasslands' }, { neighbours: () => [{ t: 'grasslands', f: ['forest'] }] }), 0);
  // grace added 15 Oct 2026 (the user): Thieving, Crafting, Runecrafting, Alt. Magic, Township (and Hiring with it)
  const nextToTown = { neighbours: () => [{ t: 'grasslands', f: ['city'] }] };
  for (const id of ['melvorD:Thieving', 'melvorD:Crafting', 'melvorD:Township', 'worker_folks:Hiring']) assert.equal(rateAt(id, { t: 'grasslands' }, nextToTown), 1, id);
  for (const id of ['melvorD:Runecrafting', 'melvorD:Magic']) assert.equal(rateAt(id, { t: 'grasslands' }, { neighbours: () => [{ t: 'grasslands', f: ['temple'] }] }), 1, id);
  assert.equal(rateAt('melvorD:Thieving', { t: 'grasslands' }, { neighbours: () => [{ t: 'grasslands', f: ['camp'] }] }), 0); // camp is 0.8, no grace from it
  assert.equal(rateAt('melvorD:Thieving', { t: 'grasslands', f: ['building'] }, nextToTown), 1); // grace beats the 0.8
  assert.equal(rateAt('melvorD:Fletching', { t: 'grasslands' }, nextToTown), 0); // Fletching has none // no grace for Woodcutting
});

test('strictness: Relaxed lifts place-tier rules only', () => {
  const town = { t: 'grasslands' };
  assert.equal(rateAt('melvorD:Smithing', town, { strictness: 'relaxed' }), 1);
  assert.equal(rateAt('melvorD:Township', town, { strictness: 'relaxed' }), 1);
  assert.equal(rateAt('melvorD:Smithing', town, { strictness: 'strict' }), 0);
  assert.equal(rateAt(WC, town, { strictness: 'relaxed' }), 0);
  assert.equal(rateAt('melvorD:Thieving', town, { strictness: 'relaxed' }), 0);
  assert.equal(rateAt('melvorD:Firemaking', { t: 'water' }, { strictness: 'relaxed' }), 0);
  assert.ok(appliesUnder(WC, 'relaxed'));
  assert.ok(!appliesUnder('melvorD:Smithing', 'relaxed'));
  assert.ok(appliesUnder('melvorD:Smithing', 'strict'));
  assert.ok(!appliesUnder('melvorD:Astrology', 'strict'));
});

test('combat placement: on the tagged hex or one away; unplaced areas fail open', () => {
  const places = [{ q: 10, r: 10 }, { q: 20, r: 0 }];
  assert.deepEqual(combatAllowedAt([], { q: 0, r: 0 }), { allowed: true, unplaced: true });
  assert.equal(combatAllowedAt(places, undefined).allowed, true);
  assert.equal(combatAllowedAt(places, { q: 10, r: 10 }).allowed, true);
  assert.equal(combatAllowedAt(places, { q: 11, r: 9 }).allowed, true);
  const far = combatAllowedAt(places, { q: 12, r: 10 });
  assert.equal(far.allowed, false);
  assert.deepEqual(far.nearest, { hex: places[0], distance: 2 });
  assert.equal(combatAllowedAt(places, { q: 19, r: 1 }).allowed, true);
});

test('trade gate: on a town, port or market hex or next to one', () => {
  assert.deepEqual(TRADE_FEATURES, ['city', 'capital', 'port', 'market']);
  assert.ok(tradeAllowedAt(undefined));
  assert.ok(tradeAllowedAt({ t: 'grasslands', f: ['city'] }));
  assert.ok(tradeAllowedAt({ t: 'beach', f: ['port'] }));
  assert.ok(!tradeAllowedAt({ t: 'grasslands', f: ['building'] }));
  assert.ok(tradeAllowedAt({ t: 'grasslands' }, [{ t: 'grasslands', f: ['market'] }]));
  assert.ok(!tradeAllowedAt({ t: 'grasslands' }, [{ t: 'grasslands', f: ['forest'] }]));
});

test('Harvesting works on the Abyss hex and next to it, at sea under cloud; nowhere else (user decision, 16 Oct 2026)', () => {
  const H = 'melvorItA:Harvesting';
  const abyss = { t: 'shoal', cloud: true, area: 'IntoTheAbyss', poi: 'SwirlingAbyss' };
  const cloudSea = { t: 'shoal', cloud: true };
  assert.equal(rateAt(H, abyss), 1);
  assert.equal(rateAt(H, cloudSea, { neighbours: () => [abyss, cloudSea] }), 1);
  assert.equal(rateAt(H, cloudSea, { neighbours: () => [cloudSea] }), 0);
  assert.equal(rateAt(H, { t: 'grasslands', f: ['forest'] }, { neighbours: () => [{ t: 'grasslands' }] }), 0);
  assert.equal(rateAt(MINING, { t: 'mountain', cloud: true }), 0, 'other rules still stop under cloud');
});
