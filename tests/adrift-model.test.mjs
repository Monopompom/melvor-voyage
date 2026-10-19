import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  RESCUES, TOW_KINDS, DRIFT_MS, TOW_MS, FISHER_MS, pickRescue, rescueOf, rescueChance, causeOf, driftIndex, driftTarget, towPrice, seaWay,
  pushyTake, noodleSpots, cleanAdrift, cleanAdriftEnd, RATION_HP,
} from '../src/adrift-model.mjs';
import { RATION_HP as STORES_RATION } from '../src/stores-model.mjs';
import { seaIndex, isSea, isPlace, isPort, hexDist } from '../src/ship-model.mjs';
import { createTerrain } from '../src/terrain.mjs';

const loadTerrain = async () => createTerrain(JSON.parse(await readFile(new URL('../data/hex_terrain.json', import.meta.url), 'utf8')));

test('the rescue table: weights out of 100 as the canvas has them', () => {
  assert.deepEqual(RESCUES.map((r) => [r.id, r.weight]), [['kraken', 30], ['fisherman', 25], ['bottle', 20], ['noodle', 15], ['pushy', 10]]);
  assert.equal(RESCUES.reduce((a, r) => a + r.weight, 0), 100);
  assert.deepEqual(TOW_KINDS, ['pay', 'fisherman', 'bottle', 'pushy']);
  assert.equal(rescueOf('fisherman').ms, FISHER_MS);
  assert.equal(rescueOf('pushy').take, true);
  assert.equal(DRIFT_MS, 30 * 60000);
  assert.equal(TOW_MS, 3 * 60000);
  assert.equal(RATION_HP, STORES_RATION, 'one ration, as the stores count it');
});

test('pickRescue: each roll lands by weight, ends clamped', () => {
  assert.equal(pickRescue(0).id, 'kraken');
  assert.equal(pickRescue(0.299).id, 'kraken');
  assert.equal(pickRescue(0.30).id, 'fisherman');
  assert.equal(pickRescue(0.549).id, 'fisherman');
  assert.equal(pickRescue(0.55).id, 'bottle');
  assert.equal(pickRescue(0.75).id, 'noodle');
  assert.equal(pickRescue(0.90).id, 'pushy');
  assert.equal(pickRescue(0.9999).id, 'pushy');
  assert.equal(pickRescue(1).id, 'pushy');
  assert.equal(pickRescue(-1).id, 'kraken');
  assert.equal(pickRescue(NaN).id, 'kraken');
  const n = {};
  for (let i = 0; i < 1000; i++) { const id = pickRescue(i / 1000).id; n[id] = (n[id] ?? 0) + 1; }
  assert.deepEqual(n, { kraken: 300, fisherman: 250, bottle: 200, noodle: 150, pushy: 100 });
});

test('rescueChance: the catch interval over an hour', () => {
  assert.equal(rescueChance(3600000), 1);
  assert.equal(rescueChance(6000), 6000 / 3600000);
  assert.equal(rescueChance(0), 0);
  assert.equal(rescueChance(undefined), 0);
  assert.equal(rescueChance(1e9), 1);
});

test('causeOf: hull beyond reach, then the stores, then the purse', () => {
  assert.equal(causeOf({ applies: false, food: 0 }), undefined);
  assert.equal(causeOf({ applies: true, beyond: true, food: 999, gp: 999 }), 'hull');
  assert.equal(causeOf({ applies: true, food: 19, gp: 999, stepGp: 1 }), 'food');
  assert.equal(causeOf({ applies: true, food: 20, gp: 999, stepGp: 1 }), undefined);
  assert.equal(causeOf({ applies: true, provisions: false, food: 0, gp: 999, stepGp: 1 }), undefined, 'provisions off: food never strands you');
  assert.equal(causeOf({ applies: true, food: 20, gp: 4, stepGp: 5 }), 'gp');
  assert.equal(causeOf({ applies: true, provisions: false, food: 0, gp: 4, stepGp: 5 }), 'gp', 'adrift for GP stays with provisions off');
  assert.equal(causeOf({ applies: true, food: 20, gp: 5, stepGp: 5 }), undefined);
});

test('driftTarget: fewest hexes left, never a place, same answer every time', () => {
  const lefts = new Map([['0,0', 2], ['1,0', 1], ['0,1', 1], ['-1,0', 2], ['1,-1', 3], ['2,0', 0]]);
  const left = (h) => lefts.get(`${h.q},${h.r}`) ?? Infinity;
  const here = { q: 0, r: 0 };
  const ns = [{ q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 0 }, { q: 1, r: -1 }];
  assert.deepEqual(driftTarget(here, ns, left), { q: 0, r: 1 }, 'tie: the lowest q');
  assert.deepEqual(driftTarget(here, [...ns].reverse(), left), { q: 0, r: 1 }, 'whatever the order');
  assert.deepEqual(driftTarget(here, ns, left, (h) => h.q === 0 && h.r === 1), { q: 1, r: 0 }, 'not onto a place');
  assert.equal(driftTarget({ q: 2, r: 0 }, ns, left), undefined, 'next to the coast: no drift');
  assert.equal(driftTarget(here, [{ q: -1, r: 0 }], left), undefined, 'nowhere nearer');
});

test('driftIndex: places are walls; a place you stand on drifts off', () => {
  // a strip q 0..4 along r 0: coast at q -1 (home 1 at q 0), a place at q 1
  const recs = [0, 1, 2, 3, 4].map((q) => ({ q, r: 0, t: 'water', place: q === 1 }));
  recs.push({ q: 2, r: 1, t: 'water' }, { q: 1, r: 1, t: 'water' }, { q: 0, r: 1, t: 'water' });
  const key = (h) => `${h.q},${h.r}`;
  const by = new Map(recs.map((r) => [key(r), r]));
  const neighbours = (h) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => by.get(`${h.q + a},${h.r + b}`)).filter(Boolean);
  const home = (h) => h.q + 1;
  const left = driftIndex(recs, { neighbours, home, key, isPlace: (h) => h.place === true });
  assert.equal(left(by.get('0,0')), 0);
  assert.equal(left(by.get('2,0')), 3, 'round the place: 2,1, 1,1, 0,1');
  assert.equal(left(by.get('1,0')), 1, 'standing on the place');
  assert.equal(left(by.get('4,0')), 5);
  assert.equal(left(undefined), Infinity);
});

test('the drift on the real map: from every sea hex, each hull drifts to the coast', async () => {
  const terrain = await loadTerrain();
  const idx = seaIndex(terrain);
  const key = (h) => `${h.q},${h.r}`;
  const seas = [...terrain.all()].filter(isSea);
  const neighbours = (h) => terrain.neighbours(h.q, h.r);
  for (const tier of [1, 2, 3, 4]) {
    const home = (rec) => idx.home(rec, tier);
    const left = driftIndex(seas, { neighbours, home, isPlace, key });
    let tried = 0;
    for (const rec of seas) {
      if (!Number.isFinite(home(rec)) || home(rec) <= 1) continue;
      tried += 1;
      assert.ok(Number.isFinite(left(rec)), `tier ${tier}: ${rec.q},${rec.r} has a drift`);
      let at = rec;
      for (let i = 0; i < 300 && left(at) > 0; i++) {
        const next = driftTarget(at, neighbours(at).filter(isSea), left, isPlace);
        assert.ok(next, `tier ${tier}: stuck at ${at.q},${at.r} from ${rec.q},${rec.r}`);
        assert.ok(!isPlace(next));
        at = next;
      }
      assert.equal(home(at), 1, `tier ${tier}: from ${rec.q},${rec.r}`);
    }
    assert.ok(tried > 50, `tier ${tier}: ${tried} hexes tried`);
  }
});

test('towPrice: the way\'s cost and half again, rounded up', () => {
  assert.equal(towPrice(100), 150);
  assert.equal(towPrice(7), 11);
  assert.equal(towPrice(0), 0);
  assert.equal(towPrice(undefined), 0);
});

test('seaWay: fewest sea hexes to the nearest goal; every goal with all', () => {
  // a strip 0..6 of sea along r = 0, land at q = 3 r = 1 (not walked)
  const recs = new Map();
  for (let q = 0; q <= 6; q++) recs.set(`${q},0`, { q, r: 0, t: 'water' });
  recs.set('3,1', { q: 3, r: 1, t: 'grasslands' });
  const key = (h) => `${h.q},${h.r}`;
  const neighbours = (h) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => recs.get(`${h.q + a},${h.r + b}`)).filter(Boolean);
  const o = { neighbours, key, isSea };
  const way = seaWay(recs.get('2,0'), new Map([['5,0', 'east'], ['0,0', 'west']]), o);
  assert.equal(way.goal, 'west');
  assert.deepEqual(way.path.map(key), ['2,0', '1,0', '0,0']);
  assert.equal(seaWay(recs.get('2,0'), new Map([['3,1', 'land']]), o), undefined, 'over the sea only');
  assert.equal(seaWay(recs.get('2,0'), new Map([['6,0', 'far']]), { ...o, limit: 3 }), undefined, 'beyond the limit');
  const all = seaWay(recs.get('2,0'), new Map([['5,0', 'east'], ['0,0', 'west'], ['6,0', 'far']]), { ...o, all: true });
  assert.deepEqual(all.map((w) => w.goal), ['west', 'east', 'far']);
  assert.equal(seaWay(recs.get('2,0'), new Map([['2,0', 'here']]), o).path.length, 1);
});

test('seaWay on the real map: every port\'s quay is reachable from the open sea', async () => {
  const terrain = await loadTerrain();
  const key = (h) => `${h.q},${h.r}`;
  const ports = [...terrain.all()].filter((r) => isPort(r) && r.poi !== 'FakePort');
  assert.ok(ports.length >= 5);
  const quays = new Map();
  for (const p of ports) for (const n of terrain.neighbours(p.q, p.r)) if (isSea(n)) quays.set(key(n), p.poi);
  const start = [...terrain.all()].find((r) => isSea(r) && r.cloud !== true && !isPlace(r));
  const all = seaWay(start, quays, { neighbours: (h) => terrain.neighbours(h.q, h.r), key, isSea, all: true });
  assert.ok(new Set(all.map((w) => w.goal)).size >= ports.length - 1, 'the ports are on one sea');
});

test('pushyTake: half of each catch, rounded up, capped at the bank', () => {
  assert.deepEqual(pushyTake({ a: 10, b: 3, c: 1 }), { a: 5, b: 2, c: 1 });
  assert.deepEqual(pushyTake({ a: 10, b: 3 }, (id) => (id === 'a' ? 2 : 0)), { a: 2 });
  assert.deepEqual(pushyTake({}), {});
  assert.deepEqual(pushyTake(undefined), {});
});

test('noodleSpots: surveyed coast hexes in range, not places, not here', () => {
  const here = { q: 0, r: 0 };
  const c = [{ q: 0, r: 0 }, { q: 3, r: 0, h: 1 }, { q: 20, r: 0, h: 1 }, { q: 2, r: 0, h: 2 }, { q: 4, r: 0, h: 1, place: true }, { q: 5, r: 0, h: 1, fog: true }];
  const spots = noodleSpots(here, c, { home: (x) => x.h ?? 3, dist: hexDist, isPlace: (x) => x.place === true, surveyed: (x) => x.fog !== true });
  assert.deepEqual(spots.map((s) => s.q), [3]);
});

test('cleanAdrift / cleanAdriftEnd: bad data out, defaults in', () => {
  assert.equal(cleanAdrift(null), null);
  assert.equal(cleanAdrift({ q: 1 }), null);
  const a = cleanAdrift({ q: 1, r: -2, why: 'bogus', left: -3, caught: { 'melvorD:Raw_Shrimp': 4, bad: -1, worse: 'x' }, pending: 'kraken', name: 7 });
  assert.deepEqual(a, { q: 1, r: -2, why: 'food', since: 0, left: 1, of: 1, drifted: 0, fishMs: 0, caught: { 'melvorD:Raw_Shrimp': 4 }, name: '', pending: 'kraken' });
  assert.equal(cleanAdrift({ q: 0, r: 0, why: 'gp', pending: 'nope' }).pending, '');
  assert.equal(cleanAdrift({ q: 0, r: 0, why: 'hull' }).why, 'hull');
  assert.equal(cleanAdriftEnd(null), null);
  assert.deepEqual(cleanAdriftEnd({ how: 'x', by: 'noodle', drifted: 3, where: 'Open sea' }), { how: 'ashore', by: 'noodle', at: 0, drifted: 3, where: 'Open sea', closed: false });
  assert.equal(cleanAdriftEnd({ how: 'clear', by: 'bogus' }).by, '');
});
