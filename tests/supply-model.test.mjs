import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DAY_MS, SHARES, dayOf, shareAt, stockOf, drawn, msUntil, msUntilFull, planLoad, totalStock, pruned, cleanSupply, islandKeys } from '../src/supply-model.mjs';
import * as S from '../src/stores-model.mjs';

const CAP50 = S.capacity(50); // 2,400 HP and 60 fuel
const H = 60 * 60 * 1000;

test('a day is a share of the level\'s carry limit: farm 1/8, market 1/2 and 1/3, town 1, port 2', () => {
  assert.deepEqual(CAP50, { food: 2400, fuel: 60 });
  assert.deepEqual(dayOf('farm', CAP50), { food: 300, fuel: 7.5 });
  assert.deepEqual(dayOf('market', CAP50), { food: 1200, fuel: 20 });
  assert.deepEqual(dayOf('town', CAP50), { food: 2400, fuel: 60 });
  assert.deepEqual(dayOf('port', CAP50), { food: 4800, fuel: 120 });
  assert.deepEqual(dayOf('nowhere', CAP50), { food: 0, fuel: 0 });
  // every loading place has a share of both
  for (const p of S.LOAD_PLACES) assert.ok(SHARES[p.id]?.food > 0 && SHARES[p.id]?.fuel > 0, p.id);
  // the market's fuel follows its rate: 1/3 of a load against 1/2 of food, as its 50% fuel against 75% food
  const m = S.LOAD_PLACES.find((p) => p.id === 'market');
  assert.ok(Math.abs(SHARES.market.fuel / SHARES.market.food - m.fuel / m.food) < 1e-9);
});

test('a hex with no entry is full; a drawn stock refills steadily and never past a day\'s worth', () => {
  assert.deepEqual(shareAt(undefined, 5), { food: 1, fuel: 1 });
  assert.deepEqual(stockOf(undefined, 'farm', CAP50, 0), { food: 300, fuel: 7.5 });
  const e = drawn(undefined, 'farm', CAP50, 1000, { food: 300, fuel: 0 });
  assert.deepEqual(e, { f: 0, u: 1, at: 1000 });
  assert.equal(stockOf(e, 'farm', CAP50, 1000).food, 0);
  assert.equal(stockOf(e, 'farm', CAP50, 1000 + 12 * H).food, 150); // half back after 12 h
  assert.equal(stockOf(e, 'farm', CAP50, 1000 + 7 * DAY_MS).food, 300); // a week away is still one day's worth
  assert.equal(stockOf(e, 'farm', CAP50, 1000 + 7 * DAY_MS).fuel, 7.5);
  // the share follows the level: the same entry holds more at 99
  const cap99 = S.capacity(99);
  assert.equal(stockOf(e, 'farm', cap99, 1000 + 12 * H).food, cap99.food / 16);
});

test('an item that runs past the stock leaves it below empty until the place makes it up', () => {
  const e = drawn(undefined, 'farm', CAP50, 0, { food: 327.5, fuel: 0 }); // the last Lobster ran 27.5 past
  assert.ok(stockOf(e, 'farm', CAP50, 0).food < 0);
  assert.equal(planLoad(S, 55, 10, 1000, [{ key: '1,1', place: 'farm', food: 0.5, fuel: 0.5, stock: stockOf(e, 'farm', CAP50, 1000) }], 'food').n, 0);
  // the debt is made up first: 27.5 HP back takes 2.2 h at 300 a day
  assert.equal(msUntil(e, 'farm', CAP50, 0, 'food', 0), Math.ceil((27.5 / 300) * DAY_MS));
  // and never goes below two days' worth
  assert.equal(drawn(undefined, 'farm', CAP50, 0, { food: 1e9 }).f, -2);
});

test('msUntil: when an amount is there again; never for more than a day holds', () => {
  const e = drawn(undefined, 'town', CAP50, 0, { food: 2400, fuel: 60 });
  assert.equal(msUntil(e, 'town', CAP50, 0, 'food', 1200), 12 * H);
  assert.equal(msUntil(e, 'town', CAP50, 12 * H, 'food', 1200), 0);
  assert.equal(msUntil(e, 'town', CAP50, 0, 'food', 5000), Infinity);
  assert.equal(msUntilFull(e, 0), DAY_MS);
  assert.equal(msUntilFull(undefined, 0), 0);
});

test('planLoad: the best rate first, then the next place in reach at its own rate', () => {
  const market = { key: '14,12', place: 'market', food: 0.75, fuel: 0.5, stock: { food: 150, fuel: 20 } };
  const village = { key: '13,11', place: 'farm', food: 0.5, fuel: 0.5, stock: { food: 300, fuel: 7.5 } };
  // standing on the village: the market's 75% goes first anyway
  const r = planLoad(S, 55, 100, 2000, [village, market], 'food');
  assert.deepEqual(r.parts.map((p) => [p.place, p.n, p.added]), [['market', 4, 165], ['farm', 11, 302.5]]);
  assert.equal(r.n, 15);
  assert.equal(r.added, 467.5);
  // supply off: a stock of Infinity, the room alone limits
  const off = planLoad(S, 55, 100, 2000, [{ ...village, stock: { food: Infinity, fuel: Infinity } }], 'food');
  assert.equal(off.n, Math.ceil(2000 / 27.5));
  // the room stops it before the stocks do
  assert.deepEqual(planLoad(S, 55, 100, 100, [village, market], 'food').parts.map((p) => [p.place, p.n]), [['market', 3]]);
  // a tie keeps the hex you stand on first
  const twin = { ...village, key: '12,12' };
  assert.equal(planLoad(S, 55, 1, 100, [village, twin], 'food').parts[0].key, '13,11');
  // a place that doesn't load it is skipped; nothing owned, nothing loaded
  assert.equal(planLoad(S, 4, 10, 10, [{ ...market, fuel: 0 }], 'fuel').n, 0);
  assert.equal(planLoad(S, 55, 0, 100, [market], 'food').n, 0);
});

test('totalStock counts places that load the kind, a stock below empty as none', () => {
  const a = { food: 0.5, fuel: 0, stock: { food: 100, fuel: 50 } };
  const b = { food: 1, fuel: 1, stock: { food: -20, fuel: 3 } };
  assert.equal(totalStock([a, b], 'food'), 100);
  assert.equal(totalStock([a, b], 'fuel'), 3);
});

test('the save keeps only places not full yet, and drops junk', () => {
  const e = drawn(undefined, 'farm', CAP50, 0, { food: 30 });
  assert.deepEqual(Object.keys(pruned({ '1,2': e, '3,4': { f: 1, u: 1, at: 0 } }, 0)), ['1,2']);
  assert.deepEqual(pruned({ '1,2': e }, DAY_MS), {});
  assert.deepEqual(cleanSupply({ '1,2': { f: 0.5, u: 7, at: 10.7 }, 'x': { f: 0, u: 0, at: 0 }, '3,4': { f: 0, at: -1 }, '5,-6': { f: NaN, u: -9, at: 1 } }),
    { '1,2': { f: 0.5, u: 1, at: 10 }, '5,-6': { f: 1, u: -2, at: 1 } });
  assert.deepEqual(cleanSupply(null), {});
  assert.deepEqual(cleanSupply([1]), {});
});

test('loadingList: the hex first, then each neighbour that loads, with its own key and rates', () => {
  const rec = (q, r, ...f) => ({ q, r, t: 'grasslands', f });
  assert.deepEqual(S.loadingList(rec(13, 11, 'building', 'farm', 'city'), [rec(14, 11, 'forest'), rec(14, 12, 'market'), { t: 'water' }]),
    [{ key: '13,11', place: 'town', food: 0.75, fuel: 0.75 }, { key: '14,12', place: 'market', food: 0.75, fuel: 0.5 }]);
  assert.deepEqual(S.loadingList(rec(1, 1, 'forest')), []);
  assert.deepEqual(S.loadingList({ q: 1, r: 1, cloud: true, f: ['port'] }), []);
});

test('islands with no easy ground: their places never run out; on the real map the Snowlands and Cursedlands islands alone', () => {
  // a toy map: an island of snow (two hexes, one a port) and a mainland with grass
  const toy = [
    { q: 0, r: 0, t: 'snowlands', f: ['port'] }, { q: 1, r: 0, t: 'snowlands' }, { q: 2, r: 0, t: 'water' },
    { q: 3, r: 0, t: 'mountain', f: ['camp'] }, { q: 4, r: 0, t: 'grasslands' }, { q: 5, r: 0, t: 'badlands', cloud: true },
  ];
  assert.deepEqual([...islandKeys(toy, S.isEasy)].sort(), ['0,0', '1,0']);
  const table = JSON.parse(readFileSync(new URL('../data/hex_terrain.json', import.meta.url), 'utf8'));
  const keys = islandKeys(table.hexes, S.isEasy);
  const places = table.hexes.filter((h) => keys.has(`${h.q},${h.r}`) && S.loadingAt(h) !== undefined).map((h) => h.poi).sort();
  assert.deepEqual(places, ['AerisDungeonRuins', 'CastleRuins', 'FrostDriftPort', 'GlaciaDungeonRuins', 'SnowCoveredPier']);
  assert.equal(keys.size, 65); // the 50 hexes of the Snowlands island and the 15 of the Cursedlands one
});
