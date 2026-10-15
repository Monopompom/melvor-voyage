import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cheapestRoute, strandedVerdict } from '../src/stranded.mjs';

// A 1-D strip of hexes 0..5 with entry costs; goals marked. Neighbours are the adjacent indexes.
const strip = (costs, goals) => {
  const hexes = costs.map((c, i) => ({ i, c, goal: goals.includes(i) }));
  return {
    hexes,
    opts: {
      neighbours: (h) => [hexes[h.i - 1], hexes[h.i + 1]].filter(Boolean),
      stepCost: (h) => h.c,
      isGoal: (h) => h.goal,
      key: (h) => h.i,
    },
  };
};

test('cheapestRoute: nearest goal by cost, path destination first', () => {
  const { hexes, opts } = strip([0, 10, 10, 1, 1, 1], [0, 5]);
  // From 2: left to 0 costs 10 (enter 1) + 0 (enter 0) = 10; right to 5 costs 1 + 1 + 1 = 3.
  const r = cheapestRoute(hexes[2], opts);
  assert.equal(r.cost, 3);
  assert.deepEqual(r.path.map((h) => h.i), [5, 4, 3, 2]);
});

test('cheapestRoute: the start is never a goal; no goal means undefined', () => {
  const { hexes, opts } = strip([5, 5, 5], [1]);
  assert.equal(cheapestRoute(hexes[1], opts), undefined);
  const r = cheapestRoute(hexes[0], opts);
  assert.equal(r.cost, 5);
});

test('strandedVerdict: the rules the user set', () => {
  const route = { gp: 754, itemsOwned: true };
  assert.equal(strandedVerdict({ tradeLocked: false, route, gp: 0 }).stranded, false);
  assert.equal(strandedVerdict({ tradeLocked: true, route, gp: 755 }).stranded, false);
  assert.equal(strandedVerdict({ tradeLocked: true, route, gp: 754 }).stranded, true); // would leave 0 GP
  assert.equal(strandedVerdict({ tradeLocked: true, route, gp: 100 }).stranded, true);
  assert.equal(strandedVerdict({ tradeLocked: true, route: { gp: 10, itemsOwned: false }, gp: 5000 }).stranded, true);
  assert.equal(strandedVerdict({ tradeLocked: true, route: undefined, gp: 5000 }).stranded, true);
  assert.equal(strandedVerdict({ tradeLocked: true, route, gp: 0, gpSources: ['Thieving'] }).stranded, false);
});

test('strandedVerdict: Adventure, nothing to sell: the road to a place where combat pays is the way out', () => {
  const route = { gp: 754, itemsOwned: true };
  const combatRoute = { gp: 1090, itemsOwned: true };
  // on a market with GP but nothing to sell: trading does not help, the combat road does
  assert.equal(strandedVerdict({ tradeLocked: false, route, gp: 0, canSell: false }).stranded, true);
  assert.equal(strandedVerdict({ tradeLocked: false, route, gp: 0, canSell: false, combatRoute }).stranded, true);
  assert.equal(strandedVerdict({ tradeLocked: false, route, gp: 1090, canSell: false, combatRoute }).stranded, false, 'arriving with 0 GP is fine');
  assert.equal(strandedVerdict({ tradeLocked: true, route, gp: 5000, canSell: false }).stranded, true, 'an affordable trade road does not help with nothing to sell');
  // with goods to sell the old rules still hold; an affordable combat road also counts
  assert.equal(strandedVerdict({ tradeLocked: true, route, gp: 800, combatRoute: { gp: 900 } }).stranded, false);
  assert.equal(strandedVerdict({ tradeLocked: true, route, gp: 100, combatRoute }).stranded, true);
  assert.match(strandedVerdict({ tradeLocked: true, route, gp: 100, canSell: false, combatRoute }).reason, /nothing to sell; the road to combat costs 1090/);
});
