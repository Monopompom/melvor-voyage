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
  assert.deepEqual(old.report.applied, [5, 6, 7, 8, 9, 10, 11, 12]);
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
  const { HOLD_ROW_LEVELS, UPGRADES, BIG_SHIPS } = await import('../src/ship-model.mjs');
  const pkg = JSON.parse(await readFile(new URL('../data/skill.json', import.meta.url), 'utf8'));
  const levels = pkg.data.skillData[0].data.customMilestones.map((m) => m.level);
  assert.deepEqual(levels, [...COMPASS_STAGES.map((s) => s.level), ...FREE_CHART_LEVELS, NAVIGATOR_LEVEL, PLAN_LEVEL, ...HOLD_ROW_LEVELS, ...Object.values(UPGRADES).map((u) => u.level), ...Object.values(BIG_SHIPS).map((u) => u.level)].sort((a, b) => a - b));
});

test('v2 saves gain empty stores and a starter kit still to come; stores are cleaned', () => {
  const { save, report } = loadSave(JSON.stringify({ v: 2, landHexes: 5, waterHexes: 1, backfilled: true, ship: null, shipChecked: true }));
  assert.deepEqual(report.applied, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
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
  const v3 = { ...defaultSave(), v: 3, boat: undefined, ship: { hull: 'dinghy', q: 2, r: 5 } };
  const { save, report } = loadSave(JSON.stringify(v3));
  assert.deepEqual(report.applied, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(save.boat, { hull: 'dinghy', q: 2, r: 5, cond: 100, hold: [], aboard: false });
  assert.equal(save.ship, null);
  assert.equal(loadSave(JSON.stringify({ ...v3, v: 3, ship: null })).save.boat, null);
  const worn = (cond) => loadSave(JSON.stringify({ ...defaultSave(), boat: { hull: 'dinghy', q: 1, r: 1, cond } })).save.boat.cond;
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
  const { save, report } = loadSave(JSON.stringify({ ...defaultSave(), v: 4, boat: undefined, ship: { hull: 'dinghy', q: 1, r: 1, cond: 90 } }));
  assert.deepEqual(report.applied, [4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(save.boat.hold, []);
  const messy = [{ id: 'melvorD:Bones', qty: 5 }, { id: 'melvorD:Bones', qty: 2.7 }, { id: '', qty: 1 }, { id: 'x:Gone', qty: 3 }, { id: 'melvorD:Feathers', qty: 0 }, null];
  assert.deepEqual(loadSave(JSON.stringify({ ...defaultSave(), boat: { hull: 'dinghy', q: 1, r: 1, hold: messy } })).save.boat.hold, [{ id: 'melvorD:Bones', qty: 7 }, { id: 'x:Gone', qty: 3 }]);
});

test('v9 saves: the small boat and its hold become `boat`; no big ship; the boat aboard rides on its hex', () => {
  const v9 = { v: 9, landHexes: 3, waterHexes: 1, backfilled: true, ship: { hull: 'longboat', q: 4, r: 8, cond: 61 }, shipChecked: true,
    stores: { food: 10, fuel: 2 }, kitGiven: true, hold: [{ id: 'melvorD:Bones', qty: 4 }], unlockNotice: [], journal: {}, navigator: true };
  const { save, report } = loadSave(JSON.stringify(v9));
  assert.deepEqual(report.applied, [9, 10, 11, 12]);
  assert.deepEqual(save.boat, { hull: 'longboat', q: 4, r: 8, cond: 61, hold: [{ id: 'melvorD:Bones', qty: 4 }], aboard: false });
  assert.equal(save.ship, null);
  assert.equal(save.hold, undefined);
  assert.equal(save.navigator, true);
  const none = loadSave(JSON.stringify({ ...v9, ship: null })).save;
  assert.equal(none.boat, null);
  // v10: a brig is a ship, never a boat; the boat aboard sits on the brig's hex; aboard with no brig is not aboard
  const brig = { hull: 'brig', q: 10, r: 2, cond: 100, hold: [] };
  const both = loadSave(JSON.stringify({ ...defaultSave(), boat: { hull: 'dinghy', q: 0, r: 0, aboard: true }, ship: brig })).save;
  assert.deepEqual(both.ship, brig);
  assert.deepEqual([both.boat.q, both.boat.r, both.boat.aboard], [10, 2, true]);
  assert.equal(loadSave(JSON.stringify({ ...defaultSave(), boat: { hull: 'dinghy', q: 0, r: 0, aboard: true } })).save.boat.aboard, false);
  assert.equal(loadSave(JSON.stringify({ ...defaultSave(), boat: brig })).save.boat, null);
  assert.equal(loadSave(JSON.stringify({ ...defaultSave(), ship: { hull: 'dinghy', q: 1, r: 1 } })).save.ship, null);
});

test('the balance pass: visited hexes as bits, one per hex of the map, cleaned on load', async () => {
  const { readFile } = await import('node:fs/promises');
  const { visitedBit, markVisited, isVisited, visitedCount, VISITED_BYTES } = await import('../src/voyage-model.mjs');
  const table = JSON.parse(await readFile(new URL('../data/hex_terrain.json', import.meta.url), 'utf8'));
  const bits = table.hexes.map((h) => visitedBit(h.q, h.r));
  assert.ok(bits.every((b) => b >= 0 && b < VISITED_BYTES * 8), 'every map hex has a bit');
  assert.equal(new Set(bits).size, table.hexes.length, 'no two hexes share one');
  assert.equal(visitedBit(-1, 0), -1);
  assert.equal(visitedBit(0, 40), -1);
  let r = markVisited('', [{ q: 12, r: 13 }, { q: 12, r: 13 }, { q: 2, r: 27 }, { q: 99, r: 0 }]);
  assert.equal(r.added, 2, 'repeats and off-map hexes are not new');
  assert.ok(isVisited(r.visited, 12, 13) && isVisited(r.visited, 2, 27) && !isVisited(r.visited, 12, 14));
  assert.equal(markVisited(r.visited, [{ q: 12, r: 13 }]).added, 0);
  assert.equal(visitedCount(r.visited), 2);
  const all = markVisited('', table.hexes).visited;
  assert.equal(visitedCount(all), table.hexes.length);
  assert.ok(all.length <= 160);
  const { save } = loadSave(JSON.stringify({ ...defaultSave(), visited: r.visited }));
  assert.equal(visitedCount(save.visited), 2, 'kept through a reload');
  for (const junk of [5, 'not base64!', 'A'.repeat(400), null]) assert.equal(loadSave(JSON.stringify({ ...defaultSave(), visited: junk })).save.visited, '');
});

test('save v10 -> v11: visited filled from the journal\'s finds, misses and places', async () => {
  const { isVisited, visitedCount } = await import('../src/voyage-model.mjs');
  const journal = { found: { 'melvorD:Iron': ['3,4', '5,6'] }, missed: { 'melvorD:Gold': ['7,8'] }, places: { 'combat|melvorD:Farmlands': '3,4', 'trade|x': '10,2' } };
  const { save, report } = loadSave(JSON.stringify({ ...defaultSave(), v: 10, journal }));
  assert.deepEqual(report.applied, [10, 11, 12]);
  assert.equal(visitedCount(save.visited), 4);
  assert.ok(isVisited(save.visited, 3, 4) && isVisited(save.visited, 10, 2) && isVisited(save.visited, 7, 8) && !isVisited(save.visited, 0, 0));
});

test('the balance pass: travel discount 0.5% a level, discovery 100 XP', async () => {
  const { travelDiscount, DISCOVERY_XP } = await import('../src/voyage-model.mjs');
  assert.equal(travelDiscount(1), 0.5);
  assert.equal(travelDiscount(30), 15);
  assert.equal(travelDiscount(60), 30);
  assert.equal(travelDiscount(99), 49.5);
  assert.equal(travelDiscount(120), 49.5, 'capped at 99');
  assert.equal(travelDiscount(NaN), 0);
  assert.equal(DISCOVERY_XP, 100);
});

test('save v12: the Crossroads Sign field, migrated empty and cleaned', async () => {
  const { loadSave, serializeSave, defaultSave } = await import('../src/voyage-model.mjs');
  assert.equal(defaultSave().sign, '');
  const v11 = { ...JSON.parse(serializeSave(defaultSave())), v: 11 };
  delete v11.sign;
  const { save, report } = loadSave(JSON.stringify(v11));
  assert.deepEqual(report.applied, [11, 12]);
  assert.equal(save.sign, '');
  assert.equal(loadSave(serializeSave({ ...defaultSave(), sign: 'melvorAoD:Monolith' })).save.sign, 'melvorAoD:Monolith');
  assert.equal(loadSave(serializeSave({ ...defaultSave(), sign: '<b>' })).save.sign, '');
});

test('save v13: cargo runs, migrated empty; packed cargo in a hold stays one entry a container', () => {
  assert.deepEqual(defaultSave().cargo, { boards: {}, runs: [] });
  const v12 = { ...JSON.parse(serializeSave(defaultSave())), v: 12 };
  delete v12.cargo;
  const { save, report } = loadSave(JSON.stringify(v12));
  assert.deepEqual(report.applied, [12]);
  assert.deepEqual(save.cargo, { boards: {}, runs: [] });
  const boat = { hull: 'dinghy', q: 1, r: 2, cond: 100, aboard: false, hold: [
    { id: 'melvorD:Ash', qty: 50, cargo: 'q1', c: 'sack' }, { id: 'melvorD:Ash', qty: 50, cargo: 'q1', c: 'sack' },
    { id: 'melvorD:Ash', qty: 7 }, { id: 'melvorD:Ash', qty: 3 }, { id: 'melvorD:Ash', qty: 50, cargo: 'q2', c: 'barrel' },
  ] };
  const hold = loadSave(serializeSave({ ...defaultSave(), boat })).save.boat.hold;
  assert.deepEqual(hold, [
    { id: 'melvorD:Ash', qty: 50, cargo: 'q1', c: 'sack' }, { id: 'melvorD:Ash', qty: 50, cargo: 'q1', c: 'sack' }, { id: 'melvorD:Ash', qty: 60 }, // a malformed container falls back to loose goods: nothing is lost
  ]);
});
