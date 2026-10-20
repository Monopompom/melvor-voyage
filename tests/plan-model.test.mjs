import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/stores-model.mjs';
import { NAVIGATOR, navigatorBlocker, simulateLoad, splitLegs, legPath } from '../src/plan-model.mjs';

test('Navigator\'s Charts: owned, level, port, cost, then buyable', () => {
  const ok = { owned: false, level: NAVIGATOR.level, atPort: true, gp: NAVIGATOR.gp, items: Object.fromEntries(NAVIGATOR.items.map((x) => [x.id, x.quantity])) };
  assert.equal(navigatorBlocker(ok), undefined);
  assert.equal(navigatorBlocker({ ...ok, owned: true }), 'owned');
  assert.equal(navigatorBlocker({ ...ok, level: NAVIGATOR.level - 1 }), 'level');
  assert.equal(navigatorBlocker({ ...ok, atPort: false }), 'port');
  assert.equal(navigatorBlocker({ ...ok, gp: NAVIGATOR.gp - 1 }), 'cost');
  assert.equal(navigatorBlocker({ ...ok, items: {} }), 'cost');
});

test('loading at a stop: best food first up to the limit, then fuel, at the place\'s rate', () => {
  const bank = [{ id: 'shark', kind: 'food', unit: 200, qty: 10 }, { id: 'bread', kind: 'food', unit: 50, qty: 100 }, { id: 'logs', kind: 'fuel', unit: 1, qty: 100 }];
  const r = simulateLoad(S, { food: 100, fuel: 2 }, { food: 1000, fuel: 10 }, { food: 1, fuel: 0.5 }, bank);
  assert.deepEqual(r.stores, { food: 1000, fuel: 10 });
  assert.deepEqual(r.used.map((u) => [u.id, u.n]), [['shark', 5], ['logs', 16]]);
  assert.equal(r.bank[0].qty, 5);
  assert.equal(bank[0].qty, 10, 'the bank list handed in is not changed');
  assert.deepEqual(simulateLoad(S, { food: 0, fuel: 0 }, { food: 100, fuel: 10 }, { food: 0, fuel: 0 }, bank).used, []);
});

// A toy route: each step costs 1 food; loading places refill to 5.
const toy = (places) => ({
  price: (have, from, to) => (have.food >= to - from ? { ok: true, food: have.food - (to - from), fuel: have.fuel } : { ok: false, why: 'food', at: have.food }),
  loadAt: (i, have, bank) => (places.includes(i) && bank > 0 && have.food < 5 ? { stores: { food: 5, fuel: have.fuel }, bank: bank - 1, used: [{ id: 'x', n: 1 }], place: 'port' } : undefined),
});

test('legs: one leg when the stores pay the whole way', () => {
  const { price, loadAt } = toy([2]);
  const r = splitLegs(4, { food: 5, fuel: 0 }, 9, price, loadAt);
  assert.equal(r.ok, true);
  assert.deepEqual(r.legs, [{ from: 0, to: 4 }]);
  assert.equal(r.have.food, 1);
});

test('legs: cut at the farthest loading place reached, refilled there', () => {
  const { price, loadAt } = toy([2, 4, 7]);
  const r = splitLegs(10, { food: 5, fuel: 0 }, 9, price, loadAt);
  assert.equal(r.ok, true);
  assert.deepEqual(r.legs.map((l) => [l.from, l.to]), [[0, 4], [4, 7], [7, 10]]);
  assert.equal(r.have.food, 2);
});

test('legs: loading where you stand first; refused with no place to load', () => {
  const { price, loadAt } = toy([0, 5]);
  const r = splitLegs(8, { food: 1, fuel: 0 }, 9, price, loadAt);
  assert.equal(r.ok, true);
  assert.ok(r.depart !== undefined);
  assert.deepEqual(r.legs.map((l) => [l.from, l.to]), [[0, 5], [5, 8]]);
  const bad = splitLegs(8, { food: 3, fuel: 0 }, 9, toy([]).price, toy([]).loadAt);
  assert.equal(bad.ok, false);
  assert.equal(bad.why, 'food');
  assert.equal(bad.legs.length, 0);
  const empty = splitLegs(8, { food: 3, fuel: 0 }, 0, toy([2]).price, toy([2]).loadAt);
  assert.equal(empty.ok, false, 'a loading place with nothing in the bank is no stop');
});

test('save v9: Navigator\'s Charts start unbought and stay bought', async () => {
  const { loadSave, serializeSave, defaultSave } = await import('../src/voyage-model.mjs');
  const old = { ...defaultSave(), v: 8 };
  delete old.navigator;
  const { save, report } = loadSave(JSON.stringify(old));
  assert.deepEqual(report.applied, [8, 9, 10, 11, 12, 13, 14, 15, 16]);
  assert.equal(save.navigator, false);
  const bought = loadSave(serializeSave({ ...save, navigator: true })).save;
  assert.equal(bought.navigator, true);
  assert.equal(loadSave(JSON.stringify({ ...save, navigator: 'yes' })).save.navigator, false);
});

test('the Navigator milestone level is the unlock level', async () => {
  const { NAVIGATOR_LEVEL } = await import('../src/voyage-model.mjs');
  assert.equal(NAVIGATOR.level, NAVIGATOR_LEVEL);
});

test('a leg keeps its share of the route\'s vessel modes (build .313)', () => {
  // walk start first: hexes a..e; the game path is destination first, its modes one per step (into path[i]).
  const walk = ['a', 'b', 'c', 'd', 'e'];
  const modes = [{ m: 'ship' }, { m: 'ship' }, { m: 'boat' }, undefined]; // into e, d, c, b
  const whole = legPath(walk, 0, 4, modes);
  assert.deepEqual([...whole], ['e', 'd', 'c', 'b', 'a']);
  assert.deepEqual(whole.voyageModes, modes);
  const first = legPath(walk, 0, 2, modes); // a -> c: steps into b, c
  assert.deepEqual([...first], ['c', 'b', 'a']);
  assert.deepEqual(first.voyageModes, [{ m: 'boat' }, undefined]);
  const second = legPath(walk, 2, 4, modes); // c -> e: steps into d, e
  assert.deepEqual([...second], ['e', 'd', 'c']);
  assert.deepEqual(second.voyageModes, [{ m: 'ship' }, { m: 'ship' }]);
  assert.equal(legPath(walk, 0, 4, undefined).voyageModes, undefined);
});

