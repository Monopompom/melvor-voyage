import test from 'node:test';
import assert from 'node:assert/strict';
import { namePattern, splitNames } from '../src/skill-names.mjs';

const pattern = namePattern(['Magic', 'Alt. Magic', 'Woodcutting', 'Fishing']);

test('skill names: every whole-word name is split out, after a test() call too (build .62 bug)', () => {
  const text = 'Nothing to show: nothing in the bank helps Woodcutting in this slot.';
  assert.equal(pattern.test(text), true); // leaves lastIndex past the match, as the DOM pass does
  assert.deepEqual(splitNames(text, pattern), ['Nothing to show: nothing in the bank helps ', { name: 'Woodcutting' }, ' in this slot.']);
});

test('skill names: several names, longest first, not inside other words', () => {
  assert.deepEqual(splitNames('Fishing and Alt. Magic, not Magical or Woodcuttings.', pattern),
    [{ name: 'Fishing' }, ' and ', { name: 'Alt. Magic' }, ', not Magical or Woodcuttings.']);
});

test('skill names: no names, no pattern', () => {
  assert.deepEqual(splitNames('Plain text.', pattern), ['Plain text.']);
  assert.equal(namePattern([]), null);
  assert.deepEqual(splitNames('Anything', null), ['Anything']);
});
