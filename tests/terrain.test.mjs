import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fnv1a, waterHash, checkTable, createTerrain, hexDistance, nearest, directionLabel, CLASSES, FEATURES, CLASS_INFO } from '../src/terrain.mjs';

const table = JSON.parse(readFileSync(new URL('../data/hex_terrain.json', import.meta.url), 'utf8'));
const live = { mapId: table.meta.mapId, hexes: table.hexes.map((h) => ({ q: h.q, r: h.r, isWater: h.t === 'water' })) };

test('fnv1a matches the reference vectors', () => {
  assert.equal(fnv1a(''), '811c9dc5');
  assert.equal(fnv1a('a'), 'e40c292c');
  assert.equal(fnv1a('foobar'), 'bf9cf968');
});

test('the shipped table hashes to its own meta.waterHash (same spec as build.py)', () => {
  assert.equal(waterHash(live.hexes), table.meta.waterHash);
  assert.equal(table.meta.hexCount, table.hexes.length);
  assert.deepEqual(table.meta.classes, CLASSES);
  assert.deepEqual(table.meta.features, FEATURES);
  assert.ok(Object.keys(CLASS_INFO).every((c) => CLASSES.includes(c)));
});

test('checkTable accepts the live map it was built from and rejects drift', () => {
  assert.deepEqual(checkTable(table, live), { ok: true, reasons: [] });
  const flipped = { ...live, hexes: live.hexes.map((h, i) => (i === 0 ? { ...h, isWater: !h.isWater } : h)) };
  assert.equal(checkTable(table, flipped).ok, false);
  assert.equal(checkTable(table, { ...live, hexes: live.hexes.slice(1) }).ok, false);
  assert.equal(checkTable(table, { ...live, mapId: 'other' }).ok, false);
  assert.equal(checkTable({}, live).ok, false);
});

test('createTerrain indexes rows and returns undefined for unknown hexes', () => {
  const t = createTerrain(table);
  assert.equal(t.size, 944);
  assert.equal(t.get(15, 9).t, 'grassland'); // A New Start
  assert.equal(t.get(9, 12).t, 'forest'); // Wet Forest
  assert.equal(t.get(9, 12).poi, 'WetForest');
  assert.deepEqual(t.get(16, 0).f, ['swamp']);
  assert.equal(t.get(999, 999), undefined);
});

test('hex distance, nearest and direction', () => {
  assert.equal(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 }), 0);
  assert.equal(hexDistance({ q: 0, r: 0 }, { q: 1, r: -1 }), 1);
  assert.equal(hexDistance({ q: 15, r: 9 }, { q: 11, r: 8 }), 5);
  const t = createTerrain(table);
  const near = nearest(t, { q: 15, r: 9 }, (rec) => rec.t === 'forest');
  assert.ok(near.distance >= 1 && near.distance <= 4);
  assert.equal(near.hex.t, 'forest');
  assert.equal(nearest(t, { q: 15, r: 9 }, () => false), undefined);
  assert.equal(directionLabel({ q: 0, r: 0 }, { q: 1, r: 0 }), 'SE');
  assert.equal(directionLabel({ q: 0, r: 0 }, { q: 0, r: -1 }), 'N');
  assert.equal(directionLabel({ q: 0, r: 0 }, { q: 0, r: 1 }), 'S');
  assert.equal(directionLabel({ q: 0, r: 0 }, { q: -1, r: 0 }), 'NW');
  assert.equal(directionLabel({ q: 0, r: 0 }, { q: 0, r: 0 }), '');
});
