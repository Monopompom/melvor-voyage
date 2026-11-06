// Folks hold what they make (src/haul-model.mjs): bank places, the access rule, who to collect from, a Folk's moves and
// the collection's summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HAUL_API, REACH, isBankPlace, accessFor, hasHaul, collectFrom, lifeStep, mergeCollected, emptySummary, roomMark, fillShare } from '../src/haul-model.mjs';
import { isTradePlace, TRADE_FEATURES } from '../src/rules.mjs';

const wild = { q: 0, r: 0, t: 'grasslands', f: ['forest'] };
const port = { q: 1, r: 0, t: 'beach', f: ['port'] };
const far = { q: 5, r: 5, t: 'mountain', f: ['rocky'] };
const recs = new Map([wild, port, far].map((r) => [`${r.q},${r.r}`, r]));
const recordAt = (p) => recs.get(`${p.q},${p.r}`);
const neighboursOf = (rec) => (rec === wild ? [port] : rec === port ? [wild] : []);
const opts = { on: true, recordAt, neighboursOf, isTradePlace };
const folk = (id, place, travel = 'idle', slot = 0) => ({ id, place, travel, slot });
const dist = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));

test('the haul needs Worker Folks API 10; you reach a Folk on its hex or the next', () => {
  assert.equal(HAUL_API, 10);
  assert.equal(REACH, 1);
});

test('a bank place is a city, capital, port or market, or the hex next to one', () => {
  assert.deepEqual(TRADE_FEATURES, ['city', 'capital', 'port', 'market']);
  assert.equal(isBankPlace(port, [], isTradePlace), true);
  assert.equal(isBankPlace(wild, [port], isTradePlace), true, 'next to a port');
  assert.equal(isBankPlace(far, [], isTradePlace), false);
  assert.equal(isBankPlace(undefined, [], isTradePlace), true, 'no record fails open');
});

test('a Folk in the wild works from its room; at a bank place, with you, walking or the haul off, from the bank', () => {
  assert.equal(accessFor(folk('a', { q: 5, r: 5 }), opts), 'room');
  assert.equal(accessFor(folk('a', { q: 0, r: 0 }), opts), 'bank', 'next to the port');
  assert.equal(accessFor(folk('a', { q: 1, r: 0 }), opts), 'bank');
  assert.equal(accessFor(folk('a', { q: 5, r: 5 }, 'with'), opts), 'bank');
  assert.equal(accessFor(folk('a', { q: 5, r: 5 }, 'walking'), opts), 'bank');
  assert.equal(accessFor(folk('a', null), opts), 'bank');
  assert.equal(accessFor(folk('a', { q: 9, r: 9 }), opts), 'bank', 'a hex off the map fails open');
  assert.equal(accessFor(folk('a', { q: 5, r: 5 }), { ...opts, on: false }), 'bank');
});

test('a room has something to collect when it holds items or a purse', () => {
  assert.equal(hasHaul({ haul: [{ itemId: 'x', qty: 3, ms: 1 }], purse: [] }), true);
  assert.equal(hasHaul({ haul: [], purse: [{ currencyId: 'melvorD:GP', amount: 10 }] }), true);
  assert.equal(hasHaul({ haul: [{ itemId: 'x', qty: 0 }], purse: [], stock: [{ itemId: 'y', qty: 9 }] }), false, 'stock is not collected');
  assert.equal(hasHaul(undefined), false);
});

test('collect from idle Folks within a hex that hold something, nearest first', () => {
  const rooms = { a: { haul: [{ itemId: 'x', qty: 1 }] }, b: { haul: [{ itemId: 'x', qty: 1 }] }, c: { haul: [] }, d: { haul: [{ itemId: 'x', qty: 1 }] }, e: { haul: [{ itemId: 'x', qty: 1 }] } };
  const folks = [folk('a', { q: 1, r: 1 }, 'idle', 0), folk('b', { q: 0, r: 0 }, 'idle', 3), folk('c', { q: 0, r: 0 }), folk('d', { q: 0, r: 2 }), folk('e', { q: 0, r: 0 }, 'walking')];
  assert.deepEqual(collectFrom(folks, { q: 0, r: 0 }, { distance: dist, rooms: (id) => rooms[id] }).map((f) => f.id), ['b', 'a']);
  assert.deepEqual(collectFrom(folks, undefined, { distance: dist, rooms: (id) => rooms[id] }), []);
});

test('a Folk coming aboard or reaching a bank place empties its room; a walk or the wild keeps it', () => {
  assert.equal(lifeStep({ travel: 'idle', access: 'room' }, { travel: 'with', access: 'bank' }), 'empty');
  assert.equal(lifeStep({ travel: 'walking', access: 'bank' }, { travel: 'idle', access: 'bank' }), undefined, 'a walker\'s access was the bank rule already');
  assert.equal(lifeStep({ travel: 'idle', access: 'room' }, { travel: 'idle', access: 'bank' }), 'empty', 'a tent struck nearby, the haul turned off');
  assert.equal(lifeStep({ travel: 'idle', access: 'room' }, { travel: 'walking', access: 'bank' }), undefined, 'the room walks along');
  assert.equal(lifeStep({ travel: 'idle', access: 'room' }, { travel: 'idle', access: 'room' }), undefined);
  assert.equal(lifeStep({ travel: 'with', access: 'bank' }, { travel: 'with', access: 'bank' }), undefined);
});

test('several collections read as one summary, each kind once, biggest first', () => {
  const m = mergeCollected([
    { items: [{ itemId: 'logs', qty: 40 }, { itemId: 'ore', qty: 5 }], left: [], purse: [{ currencyId: 'gp', amount: 100 }] },
    { items: [{ itemId: 'ore', qty: 60 }], left: [{ itemId: 'gem', qty: 2 }], purse: [{ currencyId: 'gp', amount: 50 }] },
    { items: [], left: [], purse: [] },
    undefined,
  ]);
  assert.deepEqual(m.items, [{ itemId: 'ore', qty: 65 }, { itemId: 'logs', qty: 40 }]);
  assert.deepEqual(m.left, [{ itemId: 'gem', qty: 2 }]);
  assert.deepEqual(m.purse, [{ currencyId: 'gp', amount: 150 }]);
  assert.equal(m.folks, 2);
  assert.equal(emptySummary(m), false);
  assert.equal(emptySummary(mergeCollected([])), true);
});

test('the map marks a room that stopped full or dry, only away from a bank place; the fill is a share', () => {
  assert.equal(roomMark({ access: 'room', state: 'full' }), 'full');
  assert.equal(roomMark({ access: 'room', state: 'dry' }), 'dry');
  assert.equal(roomMark({ access: 'room', state: 'ok' }), undefined);
  assert.equal(roomMark({ access: 'bank', state: 'full' }), undefined, 'a full bank buffer is Worker Folks\' own');
  assert.equal(fillShare({ sizeMs: 7_200_000, usedMs: 3_600_000 }), 0.5);
  assert.equal(fillShare({ sizeMs: 0, usedMs: 5 }), 0);
  assert.equal(fillShare({ sizeMs: 10, usedMs: 50 }), 1);
});
