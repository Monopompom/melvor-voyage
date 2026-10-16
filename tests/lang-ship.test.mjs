// The ship's and the Voyage page's English kept in pure modules and data files must match languages/en.json
// (Translatable text): the game shows the language file, the tests read the modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ship from '../src/ship-model.mjs';
import * as model from '../src/voyage-model.mjs';

const root = new URL('../', import.meta.url);
const en = JSON.parse(readFileSync(new URL('languages/en.json', root), 'utf8'));
const json = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

test('hull, tier and island names match en.json', () => {
  for (const [id, hull] of Object.entries(ship.HULLS)) {
    assert.equal(en[ship.hullNameKey(id)], hull.name, id);
    assert.equal(en[ship.hullBlurbKey(id)], hull.blurb, id);
    assert.ok(en[ship.tierNameKey(hull.tier)] !== undefined, `tier ${hull.tier}`);
  }
  for (const [tier, name] of Object.entries(ship.TIER_NAMES)) assert.equal(en[ship.tierNameKey(Number(tier))], name, tier);
  assert.equal(ship.tierNameKey(99), 'MOD_VOY_HULL_TIER_UNKNOWN');
  assert.equal(en.MOD_VOY_HULL_TIER_UNKNOWN, ship.UNKNOWN_TIER_NAME);
  for (const island of ship.ISLANDS) assert.equal(en[ship.islandNameKey(island.id)], island.name, island.id);
});

test('compass stages and milestones match en.json', () => {
  const milestones = json('data/skill.json').data.skillData[0].data.customMilestones;
  model.COMPASS_STAGES.forEach((stage, i) => {
    assert.equal(en[`MOD_VOY_PAGE_COMPASS_STAGE_${i + 1}`], stage.text, `stage ${i + 1}`);
    assert.equal(en[`MOD_VOY_MILESTONE_${i + 1}`], milestones.find((m) => m.level === stage.level)?.name, `milestone ${i + 1}`);
  });
  // Upgrades: setup.mjs finds their milestone by the English name, at the upgrade's level.
  for (const [id, u] of Object.entries(ship.UPGRADES)) {
    assert.ok(milestones.some((m) => m.level === u.level && m.name === u.milestone), id);
    assert.equal(en[`MOD_VOY_MILESTONE_${id.toUpperCase()}`], u.milestone, id);
  }
});

test('compass item and shop category names match en.json', () => {
  const pkg = json('data/package.json').data;
  assert.equal(en.MOD_VOY_ITEM_COMPASS_NAME, pkg.items[0].name);
  assert.equal(en.MOD_VOY_ITEM_COMPASS_DESC, pkg.items[0].customDescription);
  assert.equal(en.MOD_VOY_SHOP_CATEGORY, pkg.shopCategories[0].name);
});

test('the six charts are in the data package, named as in en.json', async () => {
  const { CHART_ITEMS } = await import('../src/journal-model.mjs');
  const items = json('data/package.json').data.items;
  for (const id of Object.values(CHART_ITEMS)) {
    const item = items.find((i) => i.id === id);
    assert.ok(item, id);
    assert.equal(en[`MOD_VOY_ITEM_${id.toUpperCase()}_NAME`], item.name, id);
    assert.equal(en[`MOD_VOY_ITEM_${id.toUpperCase()}_DESC`], item.customDescription, id);
  }
});
