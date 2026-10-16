import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVE_VERSION, XP_PER_HEX, COMPASS_LEVELS, defaultSave, loadSave, serializeSave, xpForSteps, backfillXP,
  compassDetail, nextCompassStage,
} from '../src/voyage-model.mjs';

test('save round-trips through serialize and load', () => {
  const save = { ...defaultSave(), landHexes: 12, waterHexes: 3, backfilled: true };
  const { save: back, report } = loadSave(serializeSave(save));
  assert.deepEqual(back, save);
  assert.deepEqual(report, { applied: [], corrupt: false, future: false });
});

test('unreadable or shapeless save gives a fresh record marked corrupt', () => {
  for (const json of ['not json', 'null', '42', '{"landHexes":5}', '{"v":0}']) {
    const { save, report } = loadSave(json);
    assert.deepEqual(save, defaultSave(), json);
    assert.equal(report.corrupt, true, json);
  }
});

test('a save from a newer build is flagged, not downgraded', () => {
  const { save, report } = loadSave(JSON.stringify({ v: SAVE_VERSION + 1, landHexes: 99 }));
  assert.equal(report.future, true);
  assert.deepEqual(save, defaultSave());
});

test('bad counters are cleaned on load', () => {
  const { save } = loadSave(JSON.stringify({ v: SAVE_VERSION, landHexes: -4, waterHexes: 2.7, backfilled: 'yes', ship: 'boat' }));
  assert.deepEqual(save, { ...defaultSave(), waterHexes: 2 });
});

test('free-unlock notice: kept through a reload, cleaned, and empty after the v5 migration', () => {
  const { save } = loadSave(JSON.stringify({ ...defaultSave(), unlockNotice: ['voyage', 'junk', 'cartography', 'voyage'] }));
  assert.deepEqual(save.unlockNotice, ['cartography', 'voyage']);
  const old = loadSave(JSON.stringify({ v: 5, landHexes: 1, waterHexes: 0, backfilled: false, ship: null, shipChecked: true,
    stores: { food: 0, fuel: 0 }, kitGiven: true, hold: [] }));
  assert.deepEqual(old.report.applied, [5, 6, 7, 8]);
  assert.deepEqual(old.save.unlockNotice, []);
});

test('XP per hex: water worth more, fast-travel hops give nothing', () => {
  const r = xpForSteps([{ water: false }, { water: true }, { water: false, fastTravel: true }, { water: true }]);
  assert.deepEqual(r, { land: 1, water: 2, xp: XP_PER_HEX.land + 2 * XP_PER_HEX.water });
  assert.equal(xpForSteps([]).xp, 0);
});

test('backfill counts every travelled hex as land', () => {
  assert.equal(backfillXP(10), 10 * XP_PER_HEX.land);
  assert.equal(backfillXP(undefined), 0);
  assert.equal(backfillXP(-3), 0);
});

test('compass level 1 keeps today\'s reading; steps and name unlock later', () => {
  assert.deepEqual(compassDetail(1), { steps: false, name: false });
  assert.deepEqual(compassDetail(COMPASS_LEVELS.steps), { steps: true, name: false });
  assert.deepEqual(compassDetail(COMPASS_LEVELS.name), { steps: true, name: true });
  assert.equal(nextCompassStage(1).level, COMPASS_LEVELS.steps);
  assert.equal(nextCompassStage(COMPASS_LEVELS.steps).level, COMPASS_LEVELS.name);
  assert.equal(nextCompassStage(COMPASS_LEVELS.name), undefined);
});

test('skill milestones in data/skill.json: the compass stages, then the free charts', async () => {
  const { readFile } = await import('node:fs/promises');
  const { COMPASS_STAGES, FREE_CHART_LEVELS, NAVIGATOR_LEVEL, PLAN_LEVEL } = await import('../src/voyage-model.mjs');
  const { HOLD_ROW_LEVELS } = await import('../src/ship-model.mjs');
  const pkg = JSON.parse(await readFile(new URL('../data/skill.json', import.meta.url), 'utf8'));
  const levels = pkg.data.skillData[0].data.customMilestones.map((m) => m.level);
  assert.deepEqual(levels, [...COMPASS_STAGES.map((s) => s.level), ...FREE_CHART_LEVELS, NAVIGATOR_LEVEL, PLAN_LEVEL, ...HOLD_ROW_LEVELS].sort((a, b) => a - b));
});

test('v2 saves gain empty stores and a starter kit still to come; stores are cleaned', () => {
  const { save, report } = loadSave(JSON.stringify({ v: 2, landHexes: 5, waterHexes: 1, backfilled: true, ship: null, shipChecked: true }));
  assert.deepEqual(report.applied, [2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(save.stores, { food: 0, fuel: 0 });
  assert.equal(save.kitGiven, false);
  assert.equal(save.landHexes, 5);
  const bad = loadSave(JSON.stringify({ ...defaultSave(), stores: { food: 12.7, fuel: 3.4561 }, kitGiven: true })).save;
  assert.deepEqual(bad.stores, { food: 12, fuel: 3.456 });
  assert.deepEqual(loadSave(JSON.stringify({ ...defaultSave(), stores: { food: -1, fuel: 'x' } })).save.stores, { food: 0, fuel: 0 });
});

test('XP: a sailed hop counts its length in water hexes; hungry and free steps give nothing', () => {
  assert.deepEqual(xpForSteps([{ water: false, fastTravel: true, hop: 6 }]), { land: 0, water: 6, xp: 6 * XP_PER_HEX.water });
  assert.deepEqual(xpForSteps([{ water: false, hungry: true }, { water: true, free: true }, { water: false }]), { land: 1, water: 0, xp: XP_PER_HEX.land });
});

test('v3 saves: the ship gains a sound hull; condition is kept to 0..100', () => {
  const v3 = { ...defaultSave(), v: 3, ship: { hull: 'dinghy', q: 2, r: 5 } };
  const { save, report } = loadSave(JSON.stringify(v3));
  assert.deepEqual(report.applied, [3, 4, 5, 6, 7, 8]);
  assert.deepEqual(save.ship, { hull: 'dinghy', q: 2, r: 5, cond: 100 });
  assert.equal(loadSave(JSON.stringify({ ...v3, v: 3, ship: null })).save.ship, null);
  const worn = (cond) => loadSave(JSON.stringify({ ...defaultSave(), ship: { hull: 'dinghy', q: 1, r: 1, cond } })).save.ship.cond;
  assert.equal(worn(37), 37);
  assert.equal(worn(-5), 0);
  assert.equal(worn(140), 100);
  assert.equal(worn('x'), 100);
});

test('XP: a hex lit at night gives 25% more', () => {
  assert.deepEqual(xpForSteps([{ water: false, lit: true }, { water: true, lit: true }, { water: false }]), { land: 2, water: 1, xp: 25 + 50 + 20 });
  assert.equal(xpForSteps([{ water: false, fastTravel: true, hop: 4, lit: true }]).xp, 4 * 50);
  assert.equal(xpForSteps([{ water: false, hungry: true, lit: true }]).xp, 0);
});

test('v4 saves gain an empty hold; hold entries are cleaned and merged', () => {
  const { save, report } = loadSave(JSON.stringify({ ...defaultSave(), v: 4, hold: undefined }));
  assert.deepEqual(report.applied, [4, 5, 6, 7, 8]);
  assert.deepEqual(save.hold, []);
  const messy = { ...defaultSave(), hold: [{ id: 'melvorD:Bones', qty: 5 }, { id: 'melvorD:Bones', qty: 2.7 }, { id: '', qty: 1 }, { id: 'x:Gone', qty: 3 }, { id: 'melvorD:Feathers', qty: 0 }, null] };
  assert.deepEqual(loadSave(JSON.stringify(messy)).save.hold, [{ id: 'melvorD:Bones', qty: 7 }, { id: 'x:Gone', qty: 3 }]);
});
