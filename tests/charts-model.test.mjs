import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHART_SHARE, perAction, seas, seaNeighbours, chartsAt, chartPrice, rumourTarget, ringOf, RUMOUR_HOURS, STAR_CHANCE, starChance, seaAt } from '../src/charts-model.mjs';
import { chartChance } from '../src/journal-model.mjs';

const table = JSON.parse(readFileSync(new URL('../data/hex_terrain.json', import.meta.url), 'utf8'));
const hexes = table.hexes;
const byKey = new Map(hexes.map((h) => [`${h.q},${h.r}`, h]));
const seaMap = seas(hexes, ['FakePort']);

test('drop chances follow the time worked: a 3 s action, rumour 1 in 172,800, reveal item 1 in 604,800', () => {
  assert.equal(Math.round(1 / perAction(3000, RUMOUR_HOURS)), 172800);
  assert.equal(Math.round(1 / chartChance(3000)), 604800);
  assert.equal(chartChance(0), 0);
  // A ten times slower action pays ten times as often: the same per hour.
  assert.ok(Math.abs(perAction(30000, RUMOUR_HOURS) / perAction(3000, RUMOUR_HOURS) - 10) < 1e-9);
  assert.equal(perAction(0, RUMOUR_HOURS), 0);
  assert.equal(perAction(Number.NaN, RUMOUR_HOURS), 0);
});

test('seas: every port with a sea next to it has one; no hex in two seas; no cloud; the Fake Port and Moonlit Pier none', () => {
  assert.equal(seaMap.FakePort, undefined);
  assert.equal(seaMap.MoonlitPier, undefined); // inland: no sea next to it
  assert.equal(Object.keys(seaMap).length, 13);
  const seen = new Set();
  for (const [poi, list] of Object.entries(seaMap)) {
    assert.ok(list.length > 5, `${poi} has a tiny sea`);
    for (const h of list) {
      const k = `${h.q},${h.r}`;
      assert.ok(!seen.has(k), `${k} in two seas`);
      seen.add(k);
      assert.notEqual(byKey.get(k).cloud, true, `${k} under cloud`);
    }
    assert.equal(byKey.get(`${list[0].q},${list[0].r}`).poi, poi, 'the port first');
  }
  // Most of the open sea is charted by some port.
  const sea = hexes.filter((h) => (h.t === 'water' || h.t === 'shoal') && h.cloud !== true);
  const charted = sea.filter((h) => seen.has(`${h.q},${h.r}`)).length;
  assert.ok(charted / sea.length > 0.9, `only ${charted} of ${sea.length} sea hexes in a sea`);
});

test('a board sells its own sea first, then the seas next to it', () => {
  const nb = seaNeighbours(seaMap);
  for (const [poi, list] of Object.entries(nb)) for (const o of list) assert.ok(nb[o].includes(poi), `${poi}-${o} not mutual`);
  const at = chartsAt('BeginningPort', seaMap, nb);
  assert.equal(at[0], 'BeginningPort');
  assert.ok(at.length >= 2);
  assert.deepEqual(chartsAt('MoonlitPier', seaMap, nb), []);
});

test('chart price: the share of the fog hexes\' travel cost, rounded up to 100; nothing under fog is free', () => {
  assert.equal(CHART_SHARE, 0.1);
  assert.equal(chartPrice([75158, 961776]), 103700);
  assert.equal(chartPrice([]), 0);
  assert.equal(chartPrice([Number.NaN, -5, 1000]), 100);
});

test('a rumour points at the nearest place not found; a sailor\'s at the sea first; its ring is 7 hexes or fewer', () => {
  const places = [{ q: 5, r: 5, sea: false }, { q: 9, r: 5, sea: true }, { q: 20, r: 20, sea: true }];
  assert.deepEqual(rumourTarget({ q: 4, r: 5 }, places), places[0]);
  assert.deepEqual(rumourTarget({ q: 4, r: 5 }, places, true), places[1]);
  assert.deepEqual(rumourTarget({ q: 4, r: 5 }, places.filter((p) => !p.sea), true), places[0]);
  assert.equal(rumourTarget({ q: 4, r: 5 }, []), undefined);
  const ring = ringOf({ q: 12, r: 13 }, hexes);
  assert.equal(ring.length, 7);
  assert.deepEqual(ring[0], { q: 12, r: 13 });
  assert.ok(ringOf({ q: 0, r: 0 }, hexes).length < 7); // the map's corner
});

test('the Starlit Chart (phase 4 wrap-up): 1 in 1,000 lit sea hexes, at most one a move, read on the nearest sea', () => {
  assert.equal(STAR_CHANCE, 1 / 1000);
  assert.equal(starChance(0), 0);
  assert.equal(starChance(-3), 0);
  assert.equal(starChance(NaN), 0);
  assert.ok(Math.abs(starChance(1) - 0.001) < 1e-12);
  // 50 lit sea hexes a night for 21 nights: about one chart (63% to have found at least one).
  const threeWeeks = starChance(50 * 21);
  assert.ok(threeWeeks > 0.6 && threeWeeks < 0.7, `${threeWeeks}`);
  const map = { A: [{ q: 0, r: 0 }, { q: 1, r: 0 }], B: [{ q: 10, r: 0 }] };
  assert.equal(seaAt(map, { q: 1, r: 0 }), 'A');
  assert.equal(seaAt(map, { q: 8, r: 0 }), 'B', 'on land: the nearest sea');
  assert.equal(seaAt(map, undefined), undefined);
  assert.equal(seaAt({}, { q: 0, r: 0 }), undefined);
});
