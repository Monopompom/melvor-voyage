import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEAR, NEAR_MIN, hexDist, placeDistance, nearbyPick, cleanSlayer, REGION, contractPick, takenKey, isTaken, takenMonster, markTaken } from '../src/slayer-model.mjs';

test('placeDistance: hexes to the nearest place, Infinity for none', () => {
  const at = { q: 10, r: 10 };
  assert.equal(hexDist(at, { q: 13, r: 8 }), 3);
  assert.equal(placeDistance(at, [{ q: 20, r: 10 }, { q: 12, r: 10 }]), 2);
  assert.equal(placeDistance(at, []), Infinity);
});

test('nearbyPick: the monsters within NEAR, in the order given', () => {
  const entries = [{ id: 'a', d: 2 }, { id: 'b', d: 12 }, { id: 'c', d: NEAR }, { id: 'd', d: 0 }, { id: 'e', d: 5 }];
  assert.deepEqual(nearbyPick(entries), { ids: ['a', 'c', 'd', 'e'], fallback: false });
});

test('nearbyPick: widened to the NEAR_MIN nearest, a whole area at once', () => {
  assert.equal(NEAR_MIN, 3);
  const far = [{ id: 'a', d: 20 }, { id: 'b', d: 15 }, { id: 'c', d: 15 }, { id: 'd', d: 15 }, { id: 'e', d: 30 }, { id: 'f', d: 9 }];
  assert.deepEqual(nearbyPick(far).ids, ['b', 'c', 'd', 'f'], 'the third nearest is at 15, so every monster at 15 comes');
  const one = [{ id: 'a', d: 1 }, { id: 'b', d: 30 }, { id: 'c', d: 22 }];
  assert.deepEqual(nearbyPick(one).ids, ['a', 'b', 'c'], 'three in the tier: all three');
  assert.deepEqual(nearbyPick([{ id: 'a', d: 40 }]).ids, ['a']);
});

test('nearbyPick: unknown places never count; none known falls back to the game', () => {
  const some = [{ id: 'a', d: Infinity }, { id: 'b', d: 25 }, { id: 'c', d: Infinity }];
  assert.deepEqual(nearbyPick(some), { ids: ['b'], fallback: false });
  assert.deepEqual(nearbyPick([{ id: 'a', d: Infinity }, { id: 'b', d: Infinity }]), { ids: [], fallback: true });
  assert.deepEqual(nearbyPick([]), { ids: [], fallback: false }, 'an empty list stays the game\'s own "no task found"');
});

test('cleanSlayer: off by default, junk dropped', () => {
  assert.deepEqual(cleanSlayer(undefined), { near: false, taken: {} });
  assert.deepEqual(cleanSlayer({ near: 'yes', taken: [1] }), { near: false, taken: {} });
  const ok = { season: 4, monster: 'melvorD:Seagull' };
  assert.deepEqual(cleanSlayer({ near: true, taken: { BeginningPort_Easy: ok, 'bad port': ok, A_Easy: { season: -1, monster: 'x' }, B_Easy: { season: 1.5, monster: 'x' }, C_Easy: { season: 2, monster: 'a b' }, D_Easy: 4 } }),
    { near: true, taken: { BeginningPort_Easy: ok } });
});

test('contractPick: a monster fought within REGION of the port, else the nearest known; none known, none', () => {
  assert.equal(REGION, 6);
  const near = [{ id: 'a', d: 2, s: 0.5 }, { id: 'b', d: 9, s: 0.1 }, { id: 'c', d: 6, s: 0.3 }];
  assert.equal(contractPick(near), 'c', 'the lowest score within 6; b scores lower but is too far');
  assert.equal(contractPick([{ id: 'a', d: 12, s: 0 }, { id: 'b', d: 9, s: 0.8 }, { id: 'c', d: 9, s: 0.2 }]), 'c', 'none within 6: the nearest area, lowest score');
  assert.equal(contractPick([{ id: 'a', d: Infinity, s: 0 }]), undefined);
  assert.equal(contractPick([]), undefined);
});

test('contractPick: a longer list keeps the pick unless a newcomer scores lower', () => {
  const before = [{ id: 'a', d: 2, s: 0.4 }, { id: 'b', d: 3, s: 0.2 }, { id: 'c', d: 5, s: 0.7 }];
  assert.equal(contractPick(before), 'b');
  assert.equal(contractPick([...before, { id: 'd', d: 1, s: 0.6 }, { id: 'e', d: 4, s: 0.9 }]), 'b', 'new monsters that score higher change nothing');
  assert.equal(contractPick([...before, { id: 'f', d: 2, s: 0.1 }]), 'f');
});

test('taken contracts: one mark a port and tier, old seasons dropped', () => {
  assert.equal(takenKey('BeginningPort', 'Easy'), 'BeginningPort_Easy');
  let taken = markTaken({ OldPort_Hard: { season: 3, monster: 'x' } }, 'BeginningPort', 'Easy', 4, 'melvorD:Seagull');
  assert.deepEqual(taken, { BeginningPort_Easy: { season: 4, monster: 'melvorD:Seagull' } });
  taken = markTaken(taken, 'BeginningPort', 'Normal', 4, 'melvorD:MossGiant');
  assert.ok(isTaken(taken, 'BeginningPort', 'Normal', 4));
  assert.equal(takenMonster(taken, 'BeginningPort', 'Easy', 4), 'melvorD:Seagull', 'the board names the one taken');
  assert.equal(takenMonster(taken, 'BeginningPort', 'Easy', 5), undefined);
  assert.ok(!isTaken(taken, 'BeginningPort', 'Normal', 5), 'a new season posts again');
  assert.ok(!isTaken(taken, 'FrostDriftPort', 'Easy', 4));
  assert.deepEqual(cleanSlayer({ near: false, taken }).taken, taken, 'the keys survive a save');
});
