import test from 'node:test';
import assert from 'node:assert/strict';
import { namePattern, splitNames, tieTitle, tieCoords, tieArticles, tieLast } from '../src/skill-names.mjs';

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

test('popup titles: coordinates never split, articles keep their word, the last word keeps the one before it', () => {
  const N = '\u00a0';
  assert.equal(tieCoords('Water (2, 8) and (-3, 12)'), `Water (2,${N}8) and (-3,${N}12)`);
  assert.equal(tieArticles('Set off for The Hunt for the Gilded Golbins?'), `Set off for The${N}Hunt for the${N}Gilded Golbins?`);
  assert.equal(tieArticles('A Friendly Fisherman'), `A${N}Friendly Fisherman`);
  assert.equal(tieArticles('Theatre and Anvil'), 'Theatre and Anvil');
  assert.equal(tieLast(' is out of reach'), ` is out of${N}reach`);
  assert.equal(tieLast('Adrift'), 'Adrift');
  assert.equal(tieLast(' Adrift'), ' Adrift');
  assert.equal(tieTitle('Change course for Water (2, 8)?'), `Change course for Water${N}(2,${N}8)?`);
  assert.equal(tieTitle('Set off for The Whispering Port?'), `Set off for The${N}Whispering${N}Port?`);
});
