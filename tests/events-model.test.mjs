import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STOWAWAY_CHANCE, STOWAWAY_MIN_SEA, STOWAWAY_NAMES, STOWAWAY_PRICE_SHARE,
  SEA_RUN_LOSS, seaRunLoss, seaRunWear, condAfterRun, stowawayAt, stowawayName, stowawayPrice, cleanEvents,
} from '../src/events-model.mjs';
import { STORM_WEAR } from '../src/weather-model.mjs';
import { WEAR } from '../src/stores-model.mjs';
import { jettison } from '../src/ship-model.mjs';
import { cleanVoyage } from '../src/clock-model.mjs';

test('running at sea throws one crate in five overboard, at least one', () => {
  assert.equal(SEA_RUN_LOSS, 0.2);
  assert.deepEqual([0, 1, 4, 5, 6, 24].map(seaRunLoss), [0, 1, 1, 1, 2, 5]);
  assert.equal(seaRunLoss(undefined), 0);
  const hold = [{ id: 'a', qty: 1 }, { id: 'b', qty: 2 }, { id: 'c', qty: 3 }];
  const rolls = [0.99, 0];
  const r = jettison(hold, 2, () => rolls.shift());
  assert.deepEqual(r.dropped.map((e) => e.id), ['c', 'a']);
  assert.deepEqual(r.hold.map((e) => e.id), ['b'], 'the order kept');
  assert.deepEqual(hold.length, 3, 'the hold given is not changed');
  assert.deepEqual(jettison(hold, 5, () => 0.5).hold, [], 'never more than the hold holds');
  assert.deepEqual(jettison([], 1).dropped, []);
});

test('running at sea wears the hull as a stormy deep hex, never below 0', () => {
  assert.equal(seaRunWear(WEAR.deep), WEAR.deep * STORM_WEAR);
  const wear = seaRunWear(WEAR.deep);
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

test('a voyage keeps the stowaway\'s hex; the old pirates waiting on it are dropped, so it sails on', () => {
  const walk = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }];
  const v = cleanVoyage({ walk, at: 1, pir: { toll: 1200.4, wear: 6 }, stw: 2 });
  assert.equal(v.pir, undefined, 'bands replaced the pirates (version 1.1.0): an old save\'s wait is dropped');
  assert.equal(v.stw, 2);
  const bad = cleanVoyage({ walk, at: 2, stw: 1 });
  assert.equal(bad.stw, undefined, 'already passed');
});
