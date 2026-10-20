import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT, BLOCKS, clean, isDefault, setFolded } from '../src/layout-model.mjs';

test('layout: nothing saved or unreadable gives the default', () => {
  for (const saved of [null, undefined, 'x', 3, [], { left: 'plan-block' }]) {
    const l = clean(saved);
    assert.deepEqual(l, { left: [...DEFAULT.left], right: [...DEFAULT.right], folded: [] });
    assert.ok(isDefault(l));
  }
});

test('layout: a saved order is kept, every block once, unknown names dropped', () => {
  const l = clean({ left: ['ship-block', 'nope', 'plan-block', 'ship-block'], right: ['hold-block', 'stores-block', 'crew-block'], folded: ['stores-block', 'stores-block', 'gone'] });
  assert.deepEqual(l.left, ['ship-block', 'plan-block']);
  assert.deepEqual(l.right, ['hold-block', 'stores-block', 'crew-block']);
  assert.deepEqual(l.folded, ['stores-block']);
  assert.equal([...l.left, ...l.right].length, BLOCKS.length);
  assert.ok(!isDefault(l));
});

test('layout: a layout saved with the Errands block (before .205) drops it', () => {
  const l = clean({ left: ['plan-block', 'hold-block', 'errands-block'], right: ['stores-block', 'ship-block'], folded: ['errands-block'] });
  assert.ok(isDefault(l));
  assert.ok(!BLOCKS.includes('errands-block'));
});

test('layout: a block missing from a saved layout goes back to its column after its default neighbours', () => {
  const l = clean({ left: ['plan-block'], right: ['ship-block', 'stores-block'] });
  assert.deepEqual(l.left, ['plan-block', 'hold-block']);
  // The Crew block (6c), new to a layout saved before it: under the ship, its default neighbour.
  assert.deepEqual(l.right, ['ship-block', 'crew-block', 'stores-block']);
  // Its neighbours moved away: it goes first.
  const m = clean({ left: [], right: ['ship-block', 'stores-block', 'plan-block'] });
  assert.deepEqual(m.left, ['hold-block']);
});

test('layout: folding and unfolding', () => {
  let l = clean(null);
  l = setFolded(l, 'ship-block', true);
  assert.deepEqual(l.folded, ['ship-block']);
  assert.ok(!isDefault(l));
  l = setFolded(l, 'ship-block', true);
  assert.deepEqual(l.folded, ['ship-block']);
  l = setFolded(l, 'nope', true);
  assert.deepEqual(l.folded, ['ship-block']);
  l = setFolded(l, 'ship-block', false);
  assert.ok(isDefault(l));
});
