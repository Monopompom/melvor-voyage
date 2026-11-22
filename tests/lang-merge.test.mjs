import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeLang, overEnglish } from '../src/lang-merge.mjs';

test('a translation lies over the English: a missing or empty key stays English, the English object untouched', () => {
  const en = { A: 'one', B: 'two', C: 'three' };
  assert.deepEqual(overEnglish(en, { A: 'eins', B: '', D: 'vier', E: 5 }), { A: 'eins', B: 'two', C: 'three', D: 'vier' });
  assert.deepEqual(en, { A: 'one', B: 'two', C: 'three' });
  assert.deepEqual(overEnglish(en, null), en);
  assert.notEqual(overEnglish(en, {}), en);
});

test('merges string values into the target and returns it', () => {
  const target = { A: '1' };
  const out = mergeLang(target, { B: '2', A: 'x' });
  assert.equal(out, target);
  assert.deepEqual(target, { A: 'x', B: '2' });
});

test('ignores non-string values and bad inputs', () => {
  const target = { A: '1' };
  mergeLang(target, { B: 2, C: null, D: { nested: true } });
  assert.deepEqual(target, { A: '1' });
  assert.equal(mergeLang(undefined, { A: '1' }), undefined);
  assert.deepEqual(mergeLang({ A: '1' }, null), { A: '1' });
});
