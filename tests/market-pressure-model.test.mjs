import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/market-pressure-model.mjs';
import { CATEGORIES } from '../src/market-model.mjs';
import { SAVE_VERSION, defaultSave, loadSave, serializeSave } from '../src/voyage-model.mjs';

const H = 60 * 60 * 1000;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} vs ${b}`);

test('the kinds are the market categories and the other-goods bucket', () => {
  assert.deepEqual(P.KINDS, [...CATEGORIES, P.OTHER]);
  assert.equal(P.kindOf('fish'), 'fish');
  assert.equal(P.kindOf(undefined), 'other', 'gear and drops press the other bucket');
  assert.equal(P.kindOf('other'), 'other');
  assert.equal(P.kindOf('nonsense'), 'other');
});

test('a market\'s depth grows with its size and the Voyage level', () => {
  assert.equal(P.depthOf('port', 0), 20000);
  assert.equal(P.depthOf('port', 1), 24000);
  near(P.depthOf('port', 99), 416000);
  assert.equal(P.depthOf('capital', 1), 96000);
  assert.equal(P.depthOf('city', 1), 48000);
  assert.equal(P.depthOf('farm', 1), P.depthOf('market', 1));
  assert.equal(P.depthOf('unknown', 1), P.depthOf('market', 1), 'an unknown size counts as a market POI');
  assert.equal(P.depthOf('port', NaN), 20000);
  assert.equal(P.sizeOf({ capital: true, city: true }), 'capital');
  assert.equal(P.sizeOf({ city: true, port: true }), 'city');
  assert.equal(P.sizeOf({ farm: true }), 'farm');
  assert.equal(P.sizeOf({ port: true }), 'port');
  assert.equal(P.sizeOf({}), 'market');
});

test('no entry is no pressure; a sale presses, and the price is at the floor after the whole depth', () => {
  assert.equal(P.shareAt(undefined, 5), 0);
  assert.equal(P.pressAt(undefined, 5), 1);
  const d = P.depthOf('port', 1);
  const half = P.sold(undefined, d / 2, d, 1000);
  assert.deepEqual(half, { s: 0.5, at: 1000 });
  near(P.pressAt(half, 1000), 0.75, 'half the depth: three quarters of the price');
  const full = P.sold(half, d, d, 1000);
  assert.equal(full.s, 1, 'never past full');
  assert.equal(P.pressAt(full, 1000), P.FLOOR);
  assert.equal(P.sold(undefined, 0, d, 7).s, 0, 'selling nothing presses nothing');
  assert.equal(P.sold(undefined, 100, 0, 7).s, 0, 'no depth: no pressure (never a division by zero)');
});

test('pressure drains linearly on the game clock: from the floor back in 24 h', () => {
  const full = { s: 1, at: 0 };
  near(P.shareAt(full, 12 * H), 0.5);
  near(P.pressAt(full, 12 * H), 0.75);
  assert.equal(P.shareAt(full, 24 * H), 0);
  assert.equal(P.pressAt(full, 30 * H), 1);
  assert.equal(P.msUntilFull(full, 0), 24 * H);
  assert.equal(P.msUntilFull(full, 18 * H), 6 * H);
  assert.equal(P.msUntilFull(full, 25 * H), 0);
  assert.equal(P.shareAt(full, -5), 1, 'a clock read before the entry drains nothing');
  // a sale on top of a part-drained entry starts from what is left
  const again = P.sold(full, P.depthOf('port', 1) / 4, P.depthOf('port', 1), 18 * H);
  near(again.s, 0.5);
});

test('a big stack sells at the average of the pressure it makes, the floor past the depth', () => {
  const d = 1000;
  near(P.averagePress(0, 0, d), 1, 'a price read');
  near(P.averagePress(0.5, 0, d), 0.75);
  near(P.averagePress(0, d, d), 0.75, 'the whole depth from none: from 1 down to 0.5, average 0.75');
  near(P.averagePress(0, d / 2, d), 0.875);
  near(P.averagePress(0, 2 * d, d), (0.75 + 0.5) / 2, 'half sloped, half at the floor');
  near(P.averagePress(1, 500, d), P.FLOOR, 'already at the floor');
  // never above the price as it stands, never below the floor
  for (const s of [0, 0.2, 0.7, 1]) for (const v of [1, 300, 1000, 5000]) {
    const a = P.averagePress(s, v, d);
    assert.ok(a <= P.pressOf(s) + 1e-12 && a >= P.FLOOR - 1e-12, `${s} ${v} ${a}`);
  }
});

test('drained entries are pruned; the save keeps the newest, junk dropped', () => {
  const now = 30 * H;
  const kept = P.pruned({ 'BeginningPort|fish': { s: 1, at: 0 }, 'BeginningPort|ore': { s: 1, at: 20 * H } }, now);
  assert.deepEqual(Object.keys(kept), ['BeginningPort|ore']);
  assert.deepEqual(P.cleanPressure(undefined), { p: {} });
  assert.deepEqual(P.cleanPressure({ p: [] }), { p: {} });
  const clean = P.cleanPressure({
    p: {
      'BeginningPort|fish': { s: 0.4, at: 10.7 },
      'BeginningPort|gold': { s: 0.4, at: 1 },
      'Bad Key|fish': { s: 0.4, at: 1 },
      'MistyPort|ore': { s: 7, at: 3 },
      'MistyPort|logs': { s: 0, at: 3 },
      'MistyPort|gems': { s: 0.2, at: -1 },
      'MistyPort|ash': { s: 'x', at: 3 },
      'MistyPort|bones': null,
    },
  });
  assert.deepEqual(clean, { p: { 'BeginningPort|fish': { s: 0.4, at: 10 }, 'MistyPort|ore': { s: 1, at: 3 } } });
  const many = {};
  for (let i = 0; i < P.ENTRIES_MAX + 20; i += 1) many[P.keyOf(`M${i}`, 'fish')] = { s: 0.5, at: i };
  const capped = P.cleanPressure({ p: many });
  assert.equal(Object.keys(capped.p).length, P.ENTRIES_MAX);
  assert.ok(capped.p[P.keyOf(`M${P.ENTRIES_MAX + 19}`, 'fish')], 'the newest kept');
  assert.equal(capped.p[P.keyOf('M0', 'fish')], undefined, 'the oldest dropped');
});

test('save v34 to v35: no market pressed, no happening, no map; the fields survive a reload', () => {
  const { market, happen, maps, ...old } = defaultSave();
  const { save, report } = loadSave(JSON.stringify({ ...old, v: 34 }));
  assert.deepEqual(report.applied, [34]);
  assert.equal(save.v, SAVE_VERSION);
  assert.deepEqual(save.market, { p: {} });
  assert.deepEqual(save.happen, {});
  assert.deepEqual(save.maps, {});
  const pressed = { p: { 'MistyPort|fish': { s: 0.3, at: 5 } } };
  const back = loadSave(serializeSave({ ...save, market: pressed, happen: { filled: { a: 1 } }, maps: { n: 2 } })).save;
  assert.deepEqual(P.cleanPressure(back.market), pressed);
  assert.deepEqual(back.happen, { filled: { a: 1 } });
  assert.deepEqual(back.maps, { n: 2 });
  const junk = loadSave(serializeSave({ ...save, market: 'x', happen: [], maps: null })).save;
  assert.deepEqual([junk.market, junk.happen, junk.maps], [{ p: {} }, {}, {}]);
});
