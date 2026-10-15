import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeLang } from '../src/lang-merge.mjs';

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
