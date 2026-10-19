// The map's route line (build .272): the walk split at you, and pieces of a polyline for the running light.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeParts, polyLength, polySlice } from '../src/clock-model.mjs';

const walk = [{ q: 0, r: 0, m: 'boat' }, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }];

test('the walk splits at the hex you are on; both parts hold it', () => {
  assert.deepEqual(routeParts({ walk, at: 0 }), { behind: [{ q: 0, r: 0 }], ahead: walk.map(({ q, r }) => ({ q, r })) });
  const mid = routeParts({ walk, at: 2 });
  assert.deepEqual(mid.behind, [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }]);
  assert.deepEqual(mid.ahead, [{ q: 2, r: 0 }, { q: 3, r: 0 }]);
});

test('no route without a voyage or a walk; a bad `at` is clamped', () => {
  assert.equal(routeParts(null), null);
  assert.equal(routeParts({ walk: [{ q: 0, r: 0 }], at: 0 }), null);
  assert.equal(routeParts({ walk: 'x', at: 0 }), null);
  assert.equal(routeParts({ walk, at: 9 }).ahead.length, 1);
  assert.equal(routeParts({ walk, at: -3 }).behind.length, 1);
  assert.equal(routeParts({ walk, at: NaN }).behind.length, 1);
});

const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];

test('polyline length', () => {
  assert.equal(polyLength(line), 20);
  assert.equal(polyLength([{ x: 0, y: 0 }]), 0);
  assert.equal(polyLength(undefined), 0);
});

test('a piece inside one segment, across a corner, and clamped at the ends', () => {
  assert.deepEqual(polySlice(line, 2, 6), [{ x: 2, y: 0 }, { x: 6, y: 0 }]);
  assert.deepEqual(polySlice(line, 5, 15), [{ x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }]);
  assert.deepEqual(polySlice(line, -4, 3), [{ x: 0, y: 0 }, { x: 3, y: 0 }]);
  assert.deepEqual(polySlice(line, 18, 30), [{ x: 10, y: 8 }, { x: 10, y: 10 }]);
});

test('an empty piece gives no points', () => {
  assert.deepEqual(polySlice(line, 25, 30), []);
  assert.deepEqual(polySlice(line, 6, 6), []);
  assert.deepEqual(polySlice(line, -9, -1), []);
});
