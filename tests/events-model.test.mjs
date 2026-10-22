import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PIRATE_CHANCE, PIRATE_FLOOR_HEXES, PIRATE_SOUND, STOWAWAY_CHANCE, STOWAWAY_MIN_SEA, STOWAWAY_NAMES, STOWAWAY_PRICE_SHARE,
  piratesMeet, pirateToll, PIRATE_COIN_SHARE, PIRATE_RUN_LOSS, pirateRunLoss, pirateRunWear, pirateChoice, condAfterRun, stowawayAt, stowawayName, stowawayPrice, cleanEvents,
} from '../src/events-model.mjs';
import { STORM_WEAR } from '../src/weather-model.mjs';
import { WEAR } from '../src/stores-model.mjs';
import { WORN_COND, jettison } from '../src/ship-model.mjs';
import { cleanVoyage } from '../src/clock-model.mjs';

test('pirates: only the big ship sailing into deep sea, under the chance', () => {
  const deep = { vessel: 'ship', sea: true, deep: true };
  assert.equal(piratesMeet(deep, 0), true);
  assert.equal(piratesMeet(deep, PIRATE_CHANCE * 0.99), true);
  assert.equal(piratesMeet(deep, PIRATE_CHANCE), false);
  assert.equal(piratesMeet({ ...deep, vessel: 'boat' }, 0), false, 'the boats are too small to rob');
  assert.equal(piratesMeet({ ...deep, deep: false }, 0), false, 'not near a coast');
  assert.equal(piratesMeet({ ...deep, free: true }, 0), false);
  assert.equal(piratesMeet({ ...deep, fastTravel: true }, 0), false);
  assert.equal(piratesMeet(undefined, 0), false);
  assert.equal(piratesMeet(deep, NaN), false);
  assert.ok(PIRATE_CHANCE < 1 / 50, 'rarer than storms');
});

test('pirates: the toll is a share of the hold, never less than a few hexes of GP; an empty hold is no way out', () => {
  assert.equal(pirateToll(1000000, 75000), 250000);
  assert.equal(pirateToll(0, 75000), 75000 * PIRATE_FLOOR_HEXES);
  assert.equal(pirateToll(100000, 75000), 225000, 'the floor wins over a small hold');
  assert.equal(pirateToll(undefined, undefined), 1);
  // A share of the purse too (build .387): 5 billion carried makes a 1,419 GP floor 25 million.
  assert.equal(PIRATE_COIN_SHARE, 0.005);
  assert.equal(pirateToll(0, 473, 5e9), 25000000);
  assert.equal(pirateToll(1000000, 75000, 1000), 250000, 'a small purse changes nothing');
  assert.equal(pirateToll(0, 75000, NaN), 75000 * PIRATE_FLOOR_HEXES);
});

test('pirates: running throws one crate in ten overboard, at least one', () => {
  assert.equal(PIRATE_RUN_LOSS, 0.1);
  assert.deepEqual([0, 1, 9, 10, 11, 24].map(pirateRunLoss), [0, 1, 1, 1, 2, 3]);
  assert.equal(pirateRunLoss(undefined), 0);
  const hold = [{ id: 'a', qty: 1 }, { id: 'b', qty: 2 }, { id: 'c', qty: 3 }];
  const rolls = [0.99, 0];
  const r = jettison(hold, 2, () => rolls.shift());
  assert.deepEqual(r.dropped.map((e) => e.id), ['c', 'a']);
  assert.deepEqual(r.hold.map((e) => e.id), ['b'], 'the order kept');
  assert.deepEqual(hold.length, 3, 'the hold given is not changed');
  assert.deepEqual(jettison(hold, 5, () => 0.5).hold, [], 'never more than the hold holds');
  assert.deepEqual(jettison([], 1).dropped, []);
});

test('pirates: running wears the hull as a stormy deep hex; offline, run while the hull stays sound', () => {
  assert.equal(pirateRunWear(WEAR.deep), WEAR.deep * STORM_WEAR);
  assert.equal(PIRATE_SOUND, WORN_COND, 'sound as the worn-hull rule counts it');
  const wear = pirateRunWear(WEAR.deep);
  assert.equal(pirateChoice({ cond: 100, wear, gp: 0, toll: 5 }), 'run');
  assert.equal(pirateChoice({ cond: PIRATE_SOUND + wear, wear, gp: 0, toll: 5 }), 'run');
  assert.equal(pirateChoice({ cond: PIRATE_SOUND + wear - 1, wear, gp: 5, toll: 5 }), 'pay');
  assert.equal(pirateChoice({ cond: 20, wear, gp: 4, toll: 5 }), 'run', 'no GP for the toll: run all the same');
  assert.equal(condAfterRun(4, wear), 0);
  assert.equal(condAfterRun(80, wear), 80 - wear);
});

test('stowaway: one voyage in a few, long crossings only, found in the first half of the sea, never at the quay', () => {
  const sea = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.equal(stowawayAt(sea, [STOWAWAY_CHANCE, 0]), -1);
  assert.equal(stowawayAt(sea.slice(0, STOWAWAY_MIN_SEA - 1), [0, 0]), -1);
  assert.equal(stowawayAt(sea, [0, 0]), sea[2]);
  const last = stowawayAt(sea, [0, 0.999]);
  assert.ok(last <= sea[Math.floor(sea.length / 2)] && last > sea[1]);
  const short = sea.slice(0, STOWAWAY_MIN_SEA);
  for (const b of [0, 0.5, 0.999]) assert.ok(short.includes(stowawayAt(short, [0, b])));
  assert.equal(stowawayAt(undefined, [0, 0]), -1);
});

test('stowaway: a name no Folk has; the save keeps it or nothing', () => {
  assert.equal(stowawayName(0), STOWAWAY_NAMES[0]);
  assert.notEqual(stowawayName(0, [STOWAWAY_NAMES[0]]), STOWAWAY_NAMES[0]);
  assert.ok(STOWAWAY_NAMES.includes(stowawayName(0, STOWAWAY_NAMES)), 'all taken: any name');
  assert.deepEqual(cleanEvents(undefined), { stow: null });
  assert.deepEqual(cleanEvents({ stow: { name: 'Pip', junk: 1 } }), { stow: { name: 'Pip' } });
  assert.deepEqual(cleanEvents({ stow: { name: 'Pip', v: 'ship', ask: true } }), { stow: { name: 'Pip', v: 'ship', ask: true } }, 'the vessel and the pending ask are kept');
  assert.deepEqual(cleanEvents({ stow: { name: 'Pip', v: 'raft', ask: 1 } }), { stow: { name: 'Pip' } });
  assert.deepEqual(cleanEvents({ stow: { name: '' } }), { stow: null });
  assert.deepEqual(cleanEvents([1]), { stow: null });
});

test('stowaway: a bargain on the Shop\'s price, rounded up; no price without one', () => {
  assert.ok(STOWAWAY_PRICE_SHARE > 0 && STOWAWAY_PRICE_SHARE < 1, 'cheaper than the Shop, never free');
  assert.equal(stowawayPrice(600000), 600000 * STOWAWAY_PRICE_SHARE);
  assert.equal(stowawayPrice(3), Math.ceil(3 * STOWAWAY_PRICE_SHARE));
  assert.equal(stowawayPrice(undefined), undefined);
  assert.equal(stowawayPrice(-1), undefined);
});

test('a voyage keeps waiting pirates and the stowaway\'s hex; junk is dropped', () => {
  const walk = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }];
  const v = cleanVoyage({ walk, at: 1, pir: { toll: 1200.4, wear: 6 }, stw: 2 });
  assert.deepEqual(v.pir, { toll: 1200, wear: 6 });
  assert.equal(v.stw, 2);
  const bad = cleanVoyage({ walk, at: 2, pir: { toll: 0, wear: 6 }, stw: 1 });
  assert.equal(bad.pir, undefined);
  assert.equal(bad.stw, undefined, 'already passed');
});
