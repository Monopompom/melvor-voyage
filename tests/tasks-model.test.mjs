import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTICES, REACH_MIN, REACH_MAX, BRING_MIN, REACH_PAY, REACH_SHARE, reachGp, BRING_PAY, GOODS_PAY, bringCount, makeReach, makeBring, makeNotices,
  takeTask, progressOf, canHandIn, waitLeft, WAIT_MS, cleanTasks, hexDist,
} from '../src/tasks-model.mjs';

const rng = (seed) => { let a = seed >>> 0; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; };
const post = { poi: 'BeginningPort', q: 12, r: 13 };
const far = { poi: 'FrostDriftPort', q: 20, r: 16 };

test('a Bring task asks for about 20 minutes of work, in round numbers', () => {
  assert.equal(bringCount(3000), 400);
  assert.equal(bringCount(10000), 120);
  assert.equal(bringCount(60000), 20);
  assert.equal(bringCount(1000), 500); // capped
  assert.equal(bringCount(600000), 10); // at least 10
  assert.equal(bringCount(undefined), 10);
});

test('reach: a place 10 to 30 hexes off, paid by the hex', () => {
  const places = [{ poi: 'Near', q: 13, r: 13 }, { poi: 'Mid', q: 12, r: 25 }, { poi: 'Edge', q: 12, r: 60 }];
  const t = makeReach(post, places, rng(1), 'x');
  assert.equal(t.poi, 'Mid');
  assert.equal(t.hexes, 12);
  assert.equal(t.gp, 12 * REACH_PAY.gp);
  assert.equal(t.xp, 12 * REACH_PAY.xp);
  assert.ok(REACH_MIN === 10 && REACH_MAX === 30);
  assert.equal(makeReach(post, [places[0]], rng(1), 'x'), undefined);
});

test('reach pays 150% of the trip by the game\'s travel prices, rounded up to 100; the hex floor when there is no way', () => {
  assert.equal(REACH_SHARE, 1.5);
  assert.equal(reachGp(1_350_000, 18), 2_025_000);
  assert.equal(reachGp(1_000_001, 18), 1_500_100);
  assert.equal(reachGp(undefined, 18), 18 * REACH_PAY.gp);
  assert.equal(reachGp(0, 18), 18 * REACH_PAY.gp);
  assert.equal(reachGp(100, 18), 18 * REACH_PAY.gp, 'never below the floor');
  const places = [{ poi: 'Mid', q: 12, r: 25 }];
  const seen = [];
  const t = makeReach(post, places, rng(1), 'x', (p) => { seen.push(p.poi); return 400_000; });
  assert.deepEqual(seen, ['Mid']);
  assert.equal(t.gp, 600_000);
  assert.equal(t.xp, 12 * REACH_PAY.xp);
  const n = makeNotices(post, 1, { places, costOf: () => 400_000 }, rng(1));
  assert.equal(n.find((x) => x.k === 'reach').gp, 600_000);
});

test('reach: a place with no way for your hulls today is not posted; an unknown cost pays the floor', () => {
  const places = [{ poi: 'Sea', q: 12, r: 25 }, { poi: 'Land', q: 12, r: 26 }];
  for (let i = 1; i <= 20; i++) assert.equal(makeReach(post, places, rng(i), 'x', (p) => (p.poi === 'Sea' ? null : 9_000)).poi, 'Land');
  assert.equal(makeReach(post, places, rng(1), 'x', () => null), undefined);
  assert.equal(makeReach(post, [places[1]], rng(1), 'x', () => undefined).gp, reachGp(undefined, hexDist(post, places[1])));
});

test('bring: never next door; handed in here when the goods are far from here, else at a port they are far from', () => {
  const farOre = { id: 'ore', price: 10, interval: 3000, zone: [{ q: 12, r: 25 }] }; // 12 from the post
  const t = makeBring(post, [farOre], [post, far], rng(2), 'b');
  assert.equal(t.to, 'BeginningPort');
  assert.equal(t.hexes, 12);
  assert.equal(t.n, 400);
  assert.equal(t.gp, 400 * 10 * GOODS_PAY + 12 * BRING_PAY.gp);
  const nearFish = { id: 'fish', price: 2, interval: 6000, zone: [{ q: 12, r: 14 }] }; // next door to the post
  const u = makeBring(post, [nearFish], [post, far], rng(2), 'b');
  assert.equal(u.to, 'FrostDriftPort');
  assert.ok(u.hexes >= BRING_MIN);
  assert.equal(makeBring(post, [nearFish], [post], rng(2), 'b'), undefined);
  assert.equal(makeBring(post, [{ ...farOre, zone: [] }], [post], rng(2), 'b'), undefined);
});

test('a board: one Reach and the rest Bring, never the same goods twice, NOTICES at most', () => {
  const goods = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, price: 5, interval: 3000, zone: [{ q: 12, r: 25 + i }] }));
  const list = makeNotices(post, 7, { places: [{ poi: 'Mid', q: 12, r: 25 }], goods, ports: [post] }, rng(3));
  assert.equal(list.length, NOTICES);
  assert.equal(list[0].k, 'reach');
  const items = list.filter((x) => x.k === 'bring').map((x) => x.item);
  assert.equal(new Set(items).size, items.length);
  assert.equal(list[0].id, 'BeginningPort.7.t0');
  assert.deepEqual(makeNotices(post, 7, {}, rng(3)), []);
});

test('progress counts only goods found after taking; hand in at its port with enough in the bank', () => {
  const t = takeTask({ id: 'b', k: 'bring', item: 'ore', n: 100, to: 'BeginningPort', hexes: 9, gp: 1, xp: 1 }, 'BeginningPort', 5000, 1);
  assert.equal(progressOf(t, 5000), 0);
  assert.equal(progressOf(t, 5060), 60);
  assert.equal(progressOf(t, 9999), 100);
  assert.equal(canHandIn(t, 5100, 100, 'BeginningPort'), true);
  assert.equal(canHandIn(t, 5100, 99, 'BeginningPort'), false);
  assert.equal(canHandIn(t, 5099, 500, 'BeginningPort'), false);
  assert.equal(canHandIn(t, 5100, 100, 'FrostDriftPort'), false);
  assert.equal(waitLeft(WAIT_MS + 10, 10), WAIT_MS);
  assert.equal(waitLeft(5, 10), 0);
});

test('the save: unreadable notices and tasks are dropped', () => {
  const clean = cleanTasks({
    boards: { BeginningPort: { s: 3, list: [{ id: 'a', k: 'reach', poi: 'X', q: 1, r: 2, hexes: 11, gp: 5, xp: 5 }, { id: 'b', k: 'bring', item: 'ore', n: 0, to: 'P' }, 'junk'] }, Bad: { s: 'x', list: [] } },
    cur: { id: 'c', k: 'bring', item: 'ore', n: 10, to: 'P', hexes: 9, gp: 1, xp: 1, from: 'P', base: 4.7, at: 3 },
    wait: -4,
  });
  assert.deepEqual(Object.keys(clean.boards), ['BeginningPort']);
  assert.equal(clean.boards.BeginningPort.list.length, 1);
  assert.equal(clean.cur.base, 4);
  assert.equal(clean.wait, 0);
  assert.deepEqual(cleanTasks(null), { boards: {}, cur: null, wait: 0 });
  assert.equal(cleanTasks({ cur: { id: 'c', k: 'bring', item: 'ore', n: 10, to: 'P' } }).cur, null); // no `from`
});
