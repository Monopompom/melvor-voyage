// The heat map's layout helpers (src/heatmap.mjs): the game's hex layout, hit testing, fitting and zooming.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COL, center, hexAt, bounds, fit, zoomAt } from '../src/heatmap.mjs';

test('layout matches the game: columns 0.928 of a row apart, half a row lower each column', () => {
  // cartographyMenu.js getHexOrigin, v1.3.1: (10,10) -> (3298.97, 5166.67), (11,10) -> (3608.25, 5333.33), (10,11) -> (3298.97, 5500)
  const unit = 333.3333333333333;
  const a = center(10, 10);
  const q1 = center(11, 10);
  const r1 = center(10, 11);
  assert.ok(Math.abs((q1.x - a.x) * unit - 309.2783505) < 1e-6);
  assert.ok(Math.abs((q1.y - a.y) * unit - 166.6666667) < 1e-6);
  assert.ok(Math.abs((r1.y - a.y) * unit - 333.3333333) < 1e-6);
  assert.equal(r1.x, a.x);
  assert.ok(COL > 0.92 && COL < 0.93);
});

test('hexAt finds the hex under a point, centres and near edges', () => {
  for (const [q, r] of [[0, 0], [5, -2], [12, 15], [31, 29]]) {
    const c = center(q, r);
    assert.deepEqual(hexAt(c.x, c.y), { q, r });
    assert.deepEqual(hexAt(c.x + 0.3, c.y - 0.3), { q, r });
  }
});

test('fit puts the bounds inside the screen; zoomAt keeps the pointed spot still', () => {
  const b = bounds([{ q: 0, r: 0 }, { q: 10, r: 5 }]);
  const v = fit(b, 800, 600);
  assert.ok(b.minX * v.s + v.x >= 15.99 && b.maxX * v.s + v.x <= 784.01);
  assert.ok(b.minY * v.s + v.y >= 15.99 && b.maxY * v.s + v.y <= 584.01);
  const z = zoomAt(v, 300, 200, 2, 0, 1000);
  const before = { x: (300 - v.x) / v.s, y: (200 - v.y) / v.s };
  assert.ok(Math.abs(before.x * z.s + z.x - 300) < 1e-9 && Math.abs(before.y * z.s + z.y - 200) < 1e-9);
  assert.equal(zoomAt(v, 0, 0, 100, 0, v.s * 3).s, v.s * 3);
});
