import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/safety-model.mjs';

const copy = (at, xp, extra = {}) => ({ at, xp, name: 'Ada', mode: 'melvorD:Standard', progress: 100, sig: `s${at}`, code: `code${at}`, ...extra });
const me = { name: 'Ada', mode: 'melvorD:Standard', progress: 100 };

test('progressOf counts only the game\'s own skills', () => {
  assert.equal(M.progressOf([{ xp: 10 }, { xp: 5, modded: true }, { xp: NaN }, { xp: 7, modded: false }]), 17);
  assert.equal(M.progressOf(undefined), 0);
});

test('keep holds the newest copies and the highest one', () => {
  let list = [];
  list = M.keep(list, copy(1, 900));
  list = M.keep(list, copy(2, 100));
  list = M.keep(list, copy(3, 200));
  list = M.keep(list, copy(4, 300));
  assert.deepEqual(list.map((c) => c.at), [4, 3, 1]);
});

test('keep drops junk from a damaged store', () => {
  assert.deepEqual(M.keep([null, { at: 1 }, 'x'], copy(2, 5)).map((c) => c.at), [2]);
  assert.deepEqual(M.keep('nope', copy(2, 5)).map((c) => c.at), [2]);
});

test('candidates come best first, then newest', () => {
  const list = [copy(1, 500), copy(3, 900), copy(2, 900)];
  assert.deepEqual(M.candidates(list, me).map((c) => c.at), [3, 2, 1]);
});

test('a new character with the same name gets nothing back', () => {
  assert.deepEqual(M.candidates([copy(1, 900, { progress: 5000 })], me), []);
});

test('another name, another game mode and an empty copy get nothing back', () => {
  assert.deepEqual(M.candidates([copy(1, 900, { name: 'Bo' })], me), []);
  assert.deepEqual(M.candidates([copy(1, 900, { mode: 'melvorF:Hardcore' })], me), []);
  assert.deepEqual(M.candidates([copy(1, 0)], me), []);
});

test('a copy is due with none yet, or changed and old enough', () => {
  const last = copy(1000, 5, { sig: 'a' });
  assert.equal(M.isDue(undefined, 'a', 0), true);
  assert.equal(M.isDue(last, 'a', 1000 + M.EVERY_MS), false);
  assert.equal(M.isDue(last, 'b', 1000 + M.EVERY_MS - 1), false);
  assert.equal(M.isDue(last, 'b', 1000 + M.EVERY_MS), true);
});

test('leaving the tab may copy sooner, but not more than once a minute', () => {
  const last = copy(1000, 5, { sig: 'a' });
  assert.equal(M.isDue(last, 'b', 1000 + M.LEAVE_MS - 1, M.LEAVE_MS), false);
  assert.equal(M.isDue(last, 'b', 1000 + M.LEAVE_MS, M.LEAVE_MS), true);
  assert.equal(M.isDue(last, 'a', 1000 + M.LEAVE_MS, M.LEAVE_MS), false);
});

test('newest finds the latest copy', () => {
  assert.equal(M.newest([copy(1, 5), copy(3, 1), copy(2, 9)]).at, 3);
  assert.equal(M.newest([]), undefined);
});
