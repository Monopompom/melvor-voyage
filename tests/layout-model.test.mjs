import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT, DEFAULT_FOLDED, BLOCKS, clean, isDefault, setFolded, phoneOrder, situated, movesFor, moveBlock } from '../src/layout-model.mjs';

test('layout: nothing saved or unreadable gives the default', () => {
  for (const saved of [null, undefined, 'x', 3, [], { left: 'plan-block' }]) {
    const l = clean(saved);
    assert.deepEqual(l, { top: [], left: [...DEFAULT.left], right: [...DEFAULT.right], bottom: [], folded: [...DEFAULT_FOLDED] });
    assert.ok(isDefault(l));
  }
});

test('layout: a saved order is kept, every block once, unknown names dropped', () => {
  const l = clean({ left: ['ship-block', 'nope', 'plan-block', 'ship-block'], right: ['hold-block', 'stores-block', 'crew-block'], folded: ['stores-block', 'stores-block', 'gone'] });
  assert.deepEqual(l.left, ['ship-block', 'plan-block']);
  assert.deepEqual(l.right, ['hold-block', 'deck-block', 'stores-block', 'crew-block']);
  // The deck, new to this layout, comes in folded as it starts.
  assert.deepEqual(l.folded, ['stores-block', 'deck-block']);
  assert.equal([...l.left, ...l.right].length, BLOCKS.length);
  assert.ok(!isDefault(l));
});

test('layout: a layout saved with the Errands block (before .205) drops it', () => {
  const l = clean({ left: ['plan-block', 'hold-block', 'errands-block'], right: ['stores-block', 'ship-block'], folded: ['errands-block'] });
  assert.ok(![...l.left, ...l.right].includes('errands-block'));
  assert.deepEqual(l.folded, ['deck-block']);
  assert.ok(!BLOCKS.includes('errands-block'));
});

test('layout: a block missing from a saved layout goes back to its column after its default neighbours', () => {
  const l = clean({ left: ['plan-block'], right: ['ship-block', 'stores-block'] });
  assert.deepEqual(l.left, ['plan-block', 'crew-block']);
  // The hold goes after the stores, its default neighbour; the deck after the ship.
  assert.deepEqual(l.right, ['ship-block', 'deck-block', 'stores-block', 'hold-block']);
  // Its neighbours moved away: it goes first.
  const m = clean({ left: [], right: ['ship-block', 'stores-block', 'plan-block'] });
  assert.deepEqual(m.left, ['crew-block']);
});

test('layout: folding and unfolding', () => {
  let l = clean(null);
  l = setFolded(l, 'stores-block', true);
  assert.deepEqual(l.folded, [...DEFAULT_FOLDED, 'stores-block']);
  assert.ok(!isDefault(l));
  l = setFolded(l, 'stores-block', true);
  assert.deepEqual(l.folded, [...DEFAULT_FOLDED, 'stores-block']);
  l = setFolded(l, 'nope', true);
  assert.deepEqual(l.folded, [...DEFAULT_FOLDED, 'stores-block']);
  l = setFolded(l, 'stores-block', false);
  assert.ok(isDefault(l));
  // Opening a block folded by default is a change of its own.
  assert.ok(!isDefault(setFolded(l, 'hold-block', false)));
});

test('layout: a block across the page, above or below the columns, is kept there', () => {
  const l = clean({ top: ['plan-block'], left: ['hold-block'], right: ['stores-block', 'ship-block'], bottom: ['crew-block', 'nope'] });
  assert.deepEqual(l.top, ['plan-block']);
  assert.deepEqual(l.left, ['hold-block']);
  assert.deepEqual(l.right, ['stores-block', 'ship-block', 'deck-block']);
  assert.deepEqual(l.bottom, ['crew-block']);
  assert.ok(!isDefault(l));
  // A layout saved before the full-width rows: both empty, nothing moves.
  assert.ok(isDefault(clean({ left: [...DEFAULT.left], right: [...DEFAULT.right] })));
});

test('layout: by default the plan and crew on the left, stores, hold, ship and deck on the right; hold, ship and deck folded', () => {
  assert.deepEqual(DEFAULT.left, ['plan-block', 'crew-block']);
  assert.deepEqual(DEFAULT.right, ['stores-block', 'hold-block', 'ship-block', 'deck-block']);
  assert.deepEqual([...DEFAULT_FOLDED], ['hold-block', 'ship-block', 'deck-block']);
});

test('layout: a phone takes the columns in turn, by weight', () => {
  assert.deepEqual(phoneOrder(clean(null)), ['plan-block', 'stores-block', 'crew-block', 'hold-block', 'ship-block', 'deck-block']);
  const l = clean({ top: ['hold-block'], left: ['plan-block'], right: ['stores-block', 'ship-block'], bottom: ['crew-block'] });
  assert.deepEqual(phoneOrder(l), ['hold-block', 'plan-block', 'stores-block', 'ship-block', 'deck-block', 'crew-block']);
});

test('layout: with no vessel yet the Ship block leads the right column, open, unless you changed the layout', () => {
  const d = clean(null);
  const s = situated(d, { noVessel: true });
  assert.deepEqual(s.right, ['ship-block', 'stores-block', 'hold-block', 'deck-block']);
  assert.ok(!s.folded.includes('ship-block'));
  assert.equal(situated(d, { noVessel: false }), d);
  const mine = setFolded(d, 'stores-block', true);
  assert.equal(situated(mine, { noVessel: true }), mine);
});

test('layout: keyboard moves within a column, to the other side and across the page', () => {
  const d = clean(null);
  assert.deepEqual(movesFor(d, 'plan-block'), ['down', 'side', 'wide']);
  assert.deepEqual(movesFor(d, 'deck-block'), ['up', 'side', 'wide']);
  assert.deepEqual(movesFor(d, 'ship-block'), ['up', 'down', 'side', 'wide']);
  assert.deepEqual(moveBlock(d, 'crew-block', 'up').left, ['crew-block', 'plan-block']);
  const side = moveBlock(d, 'hold-block', 'side');
  assert.deepEqual(side.right, ['stores-block', 'ship-block', 'deck-block']);
  assert.deepEqual(side.left, ['plan-block', 'crew-block', 'hold-block']);
  const wide = moveBlock(d, 'stores-block', 'wide');
  assert.deepEqual(wide.top, ['stores-block']);
  assert.deepEqual(movesFor(wide, 'stores-block'), ['side']);
  assert.deepEqual(moveBlock(wide, 'stores-block', 'side').left, ['plan-block', 'crew-block', 'stores-block']);
  // A move not open to it changes nothing; the layout it was given is never changed.
  assert.equal(moveBlock(d, 'plan-block', 'up'), d);
  assert.deepEqual(d.left, ['plan-block', 'crew-block']);
});
