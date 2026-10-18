import { test } from 'node:test';
import assert from 'node:assert/strict';
import { around, distance, actionsToFull, sideQueues, levelCheck, surveyTicks, SURVEY_XP_PER_LEVEL } from '../src/fog-model.mjs';

test('rings around a hex: 6 then 12, nearest first, each at its distance', () => {
  const c = { q: 3, r: -2 };
  const one = around(c, 1);
  assert.equal(one.length, 6);
  assert.ok(one.every((h) => distance(c, h) === 1));
  const two = around(c, 2);
  assert.equal(two.length, 18);
  assert.ok(two.slice(6).every((h) => distance(c, h) === 2));
  assert.equal(new Set(two.map((h) => `${h.q},${h.r}`)).size, 18, 'no hex twice');
  assert.deepEqual(around(c, 0), []);
});

test('survey actions to full: the game table, rounded up', () => {
  assert.equal(actionsToFull(0, 1), 24);
  assert.equal(actionsToFull(0, 2), 108);
  assert.equal(actionsToFull(0, 5), 864);
  assert.equal(actionsToFull(100, 2), 8);
  assert.equal(actionsToFull(108, 2), 0, 'already full');
  assert.equal(actionsToFull(0, 2, 1.5), 72, 'survey XP modifiers make fewer actions');
  assert.equal(actionsToFull(0, 2, 0), 0, 'no XP an action: nothing to count');
  assert.equal(SURVEY_XP_PER_LEVEL.length, 6);
});

test('hexes beside the route: within the width, never the route, never twice', () => {
  const walk = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }];
  const all = () => true;
  assert.deepEqual(sideQueues(walk, 0, all), [[], []]);
  const one = sideQueues(walk, 1, all);
  assert.equal(one.length, 2, 'none for the arrival hex');
  assert.equal(one[0].length, 5, 'six around the start, less the next route hex');
  assert.ok(one[0].every((h) => distance(walk[0], h) === 1));
  // Around walk[1]: six, less two route hexes and the two the start already took.
  assert.equal(one[1].length, 2);
  const keys = one.flat().map((h) => `${h.q},${h.r}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(!keys.includes('1,0') && !keys.includes('2,0'));
  const open = sideQueues(walk, 1, (h) => h.r !== 1);
  assert.ok(open.flat().every((h) => h.r !== 1), 'only hexes still to survey');
});

test('the level check counts the XP earned on the way', () => {
  // A toy table: a level per 100 XP.
  const levelOf = (xp) => 1 + Math.floor(xp / 100);
  const hexes = [{ need: 1, actions: 10, xpEach: 10 }, { need: 2, actions: 10, xpEach: 10 }, { need: 3, actions: 1, xpEach: 10 }];
  const ok = levelCheck({ xp: 0, levelOf, hexes });
  assert.deepEqual(ok, { ok: true, need: 3, at: 2, by: 1 });
  const no = levelCheck({ xp: 0, levelOf, hexes: [{ need: 1, actions: 1, xpEach: 10 }, { need: 4, actions: 1, xpEach: 10 }] });
  assert.deepEqual(no, { ok: false, at: 1, need: 4, reach: 1 });
  assert.deepEqual(levelCheck({ xp: 500, levelOf, hexes }), { ok: true, need: 0, at: -1, by: -1 }, 'all within the level now');
});

test('survey ticks: whole ticks of the interval', () => {
  assert.equal(surveyTicks(108, 5000), 10800);
  assert.equal(surveyTicks(0, 5000), 0);
  assert.equal(surveyTicks(2, 10), 2, 'at least a tick an action');
});
