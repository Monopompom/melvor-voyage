import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WALK_MS, hexMs, findRoad, roadMs, roadPack, walkAt, nextAt, folkStepCost, sortPlaces, cleanWalk, cleanWalks, WALKS_MAX, ROAD_MAX } from '../src/walk-model.mjs';
import { stepCost } from '../src/stores-model.mjs';
import { foodShare } from '../src/crew-model.mjs';
import { stepMs } from '../src/clock-model.mjs';
import { SAVE_VERSION, defaultSave, loadSave, serializeSave } from '../src/voyage-model.mjs';

/** A little map: '.' grassland, 'h' highlands, 's' snow, '~' water, '?' unknown. Row r, column q. */
const mapOf = (rows) => (q, r) => {
  const c = rows[r]?.[q];
  return c === '.' ? 'grasslands' : c === 'h' ? 'highlands' : c === 's' ? 'snowlands' : undefined;
};

test('walk: a hex takes your time on foot without a mount, by its ground', () => {
  assert.equal(WALK_MS, 6 * 60 * 1000);
  for (const cls of ['grasslands', 'desert', 'mountain', 'snowlands', 'lavalands', 'swamplands']) {
    assert.equal(hexMs(cls), stepMs({ cls }), cls);
  }
});

test('walk: the road goes round water and unknown ground, and takes the quicker way', () => {
  const ground = mapOf([
    '.....',
    '.~~~.',
    '.?h..',
    '.....',
  ]);
  const road = findRoad({ q: 0, r: 0 }, { q: 4, r: 0 }, ground);
  assert.deepEqual(road.map((s) => [s.q, s.r]), [[1, 0], [2, 0], [3, 0], [4, 0]]);
  assert.equal(roadMs(road), 4 * WALK_MS);
  // Through the highlands (1.5) or round them on grass: the grass is quicker.
  const round = findRoad({ q: 0, r: 2 }, { q: 3, r: 2 }, ground);
  assert.ok(round.every((s) => s.cls === 'grasslands'));
  assert.equal(findRoad({ q: 0, r: 0 }, { q: 1, r: 1 }, ground), undefined, 'water is no road');
  assert.equal(findRoad({ q: 0, r: 0 }, { q: 1, r: 2 }, ground), undefined, 'nor is ground nobody knows');
  assert.deepEqual(findRoad({ q: 2, r: 3 }, { q: 2, r: 3 }, ground), []);
  assert.equal(findRoad(null, { q: 0, r: 0 }, ground), undefined);
});

test('walk: an island far away has no road, and the search stops at its limit', () => {
  const ground = mapOf(['...~...']);
  assert.equal(findRoad({ q: 0, r: 0 }, { q: 6, r: 0 }, ground), undefined);
  const wide = (q, r) => (Math.abs(q) < 60 && Math.abs(r) < 60 ? 'grasslands' : undefined);
  assert.equal(findRoad({ q: 0, r: 0 }, { q: 50, r: 0 }, wide, { limit: 20 }), undefined);
  assert.equal(findRoad({ q: 0, r: 0 }, { q: 50, r: 0 }, wide).length, 50);
});

test('walk: what the road eats is the sum of its hexes', () => {
  const road = [{ q: 1, r: 0, cls: 'grasslands', ms: 1 }, { q: 2, r: 0, cls: 'highlands', ms: 1 }];
  const pack = roadPack(road, (s) => ({ food: 20, fuel: s.cls === 'highlands' ? 1 : 0.5 }));
  assert.deepEqual(pack, { food: 40, fuel: 1.5 });
  assert.deepEqual(roadPack([], () => ({ food: 1, fuel: 1 })), { food: 0, fuel: 0 });
});

test('walk: where the Folk is at a moment, and when it arrives', () => {
  const walk = { from: { q: 0, r: 0 }, start: 1000, road: [{ q: 1, r: 0, ms: 100 }, { q: 2, r: 0, ms: 150 }] };
  assert.deepEqual(walkAt(walk, 1000), { reached: 0, at: { q: 0, r: 0 }, left: 250, done: false });
  assert.deepEqual(walkAt(walk, 1099), { reached: 0, at: { q: 0, r: 0 }, left: 151, done: false });
  assert.deepEqual(walkAt(walk, 1100), { reached: 1, at: { q: 1, r: 0 }, left: 150, done: false });
  assert.deepEqual(walkAt(walk, 1250), { reached: 2, at: { q: 2, r: 0 }, left: 0, done: true });
  assert.deepEqual(walkAt(walk, 99999), { reached: 2, at: { q: 2, r: 0 }, left: 0, done: true });
  assert.equal(walkAt(walk, 0).reached, 0, 'a clock before the start stays at the start');
});

test('walk: the next hex comes when its time is walked, and nothing after the last', () => {
  const walk = { from: { q: 0, r: 0 }, start: 1000, road: [{ q: 1, r: 0, ms: 100 }, { q: 2, r: 0, ms: 150 }] };
  assert.equal(nextAt(walk, 1000), 1100);
  assert.equal(nextAt(walk, 1099), 1100);
  assert.equal(nextAt(walk, 1100), 1250);
  assert.equal(nextAt(walk, 1250), undefined);
});

test('walk: a Folk alone eats its rank\'s share of your food and burns your fuel', () => {
  const yours = stepCost({ cls: 'highlands' }, 1, 0);
  assert.deepEqual(folkStepCost(yours, foodShare('Middle')), yours);
  assert.deepEqual(folkStepCost(yours, foodShare('Newbie')), { food: Math.round(yours.food / 2), fuel: yours.fuel });
  assert.equal(folkStepCost(yours, foodShare('Expert')).food, Math.round(yours.food * 1.5));
  assert.deepEqual(folkStepCost(undefined, 1), { food: 0, fuel: 0 });
  // Snowlands cost twice the easy ground, as yours do.
  const snow = folkStepCost(stepCost({ cls: 'snowlands' }, 1, 0), 1);
  const grass = folkStepCost(stepCost({ cls: 'grasslands' }, 1, 0), 1);
  assert.equal(snow.food, grass.food * 2);
});

test('walk: places it can reach come first, quickest first; then the ones across water, nearest first', () => {
  const step = (ms) => ({ q: 0, r: 0, cls: 'grasslands', ms });
  const list = [
    { id: 'far-water', road: undefined, distance: 9 },
    { id: 'slow', road: [step(300), step(300)], distance: 2 },
    { id: 'near-water', road: undefined, distance: 3 },
    { id: 'quick', road: [step(100), step(100), step(100)], distance: 3 },
  ];
  assert.deepEqual(sortPlaces(list).map((p) => p.id), ['quick', 'slow', 'near-water', 'far-water']);
  assert.deepEqual(sortPlaces(undefined), []);
});

test('walk: a saved walk keeps what it needs and drops junk', () => {
  const good = { from: { q: 1, r: 2 }, start: 5, road: [{ q: 2, r: 2, cls: 'grasslands', ms: 360000.4 }], skillId: 'melvorD:Mining', actionId: 'melvorD:Iron_Ore', extra: 1 };
  assert.deepEqual(cleanWalk(good), { from: { q: 1, r: 2 }, start: 5, road: [{ q: 2, r: 2, cls: 'grasslands', ms: 360000 }], skillId: 'melvorD:Mining', actionId: 'melvorD:Iron_Ore' });
  assert.equal(cleanWalk({ ...good, skillId: 3 }).skillId, null);
  assert.equal(cleanWalk({ ...good, holder: 'f2' }).holder, 'f2');
  assert.equal('holder' in cleanWalk({ ...good, holder: 7 }), false);
  for (const bad of [null, 'x', { ...good, from: { q: 1.5, r: 0 } }, { ...good, start: -1 }, { ...good, road: [] }, { ...good, road: [{ q: 1, r: 1, cls: '', ms: 5 }] }, { ...good, road: [{ q: 1, r: 1, cls: 'x', ms: 0 }] }]) {
    assert.equal(cleanWalk(bad), undefined);
  }
  assert.equal(cleanWalk({ ...good, road: Array.from({ length: ROAD_MAX + 5 }, (_, i) => ({ q: i, r: 0, cls: 'grasslands', ms: 1 })) }).road.length, ROAD_MAX);
  assert.deepEqual(cleanWalks({ a: good, b: { from: 1 } }), { a: cleanWalk(good) });
  for (const junk of [null, [good], 'x']) assert.deepEqual(cleanWalks(junk), {});
  const many = Object.fromEntries(Array.from({ length: WALKS_MAX + 3 }, (_, i) => [`f${i}`, good]));
  assert.equal(Object.keys(cleanWalks(many)).length, WALKS_MAX);
});

test('save v20: nobody walks yet, and a walk survives a save', () => {
  assert.equal(SAVE_VERSION, 20);
  assert.deepEqual(defaultSave().walks, {});
  const v19 = { ...JSON.parse(serializeSave(defaultSave())), v: 19 };
  delete v19.walks;
  const { save, report } = loadSave(JSON.stringify(v19));
  assert.deepEqual(report.applied, [19]);
  assert.deepEqual(save.walks, {});
  const walks = { a: { from: { q: 0, r: 0 }, start: 1, road: [{ q: 1, r: 0, cls: 'grasslands', ms: 360000 }], skillId: null } };
  assert.deepEqual(loadSave(serializeSave({ ...defaultSave(), walks })).save.walks, walks);
  for (const junk of [null, [1], 'x']) assert.deepEqual(loadSave(serializeSave({ ...defaultSave(), walks: junk })).save.walks, {});
});
