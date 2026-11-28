import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAIRNS_MAX, CAIRN_ITEMS_MAX, cleanCairn, cleanCairns, makeCairn, addCairn, heldIds, cairnOf, cairnsNear, collect, replaceCairn,
} from '../src/cairn-model.mjs';
import { SAVE_VERSION, defaultSave, loadSave, serializeSave } from '../src/voyage-model.mjs';

const distance = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
// What Worker Folks' death keeper hands over (API v13).
const handed = {
  gear: [{ slot: 'Cape', itemId: 'worker_folks:Folk_Satchel', qty: 1 }, { slot: 'Weapon', itemId: 'melvorD:Bronze_Sword', qty: 1 }],
  room: { haul: [{ itemId: 'melvorD:Raw_Shrimp', qty: 400 }], stock: [{ itemId: 'melvorD:Raw_Shrimp', qty: 50 }], town: [{ itemId: 'melvorD:Normal_Logs', qty: 30 }] },
  purse: [{ currencyId: 'melvorD:GP', amount: 1200 }, { currencyId: 'melvorD:GP', amount: 300 }],
};
const cairn = (folkId = 'f1', at = 1000, extra = {}) => makeCairn({ folkId, name: 'Rolf', hex: { q: 3, r: 4 }, at, cause: 'band', ...handed, ...extra });

test('a cairn holds the gear, the whole room and the purse, stacks merged', () => {
  const c = cairn('f1', 1000, { guard: { band: 'highwaymen', ground: 'highlands', tier: 2 } });
  assert.equal(c.id, 'f1@1000');
  assert.deepEqual({ q: c.q, r: c.r, folk: c.folk, name: c.name, cause: c.cause }, { q: 3, r: 4, folk: 'f1', name: 'Rolf', cause: 'band' });
  assert.deepEqual(c.items, [
    { id: 'worker_folks:Folk_Satchel', qty: 1 }, { id: 'melvorD:Bronze_Sword', qty: 1 },
    { id: 'melvorD:Raw_Shrimp', qty: 450 }, { id: 'melvorD:Normal_Logs', qty: 30 },
  ]);
  assert.deepEqual(c.purse, [{ id: 'melvorD:GP', amount: 1500 }]);
  assert.deepEqual(c.guard, { band: 'highwaymen', ground: 'highlands', tier: 2 });
});

test('a Folk with nothing leaves no cairn; a hunger cairn has no guard', () => {
  assert.equal(makeCairn({ folkId: 'f', hex: { q: 0, r: 0 }, at: 5, cause: 'hunger', gear: [], room: {}, purse: [] }), undefined);
  const c = makeCairn({ folkId: 'f', hex: { q: 0, r: 0 }, at: 5, cause: 'hunger', purse: [{ currencyId: 'melvorD:GP', amount: 9 }] });
  assert.equal(c.guard, undefined);
  assert.deepEqual(c.items, []);
});

test('junk is dropped from a cairn and from the list', () => {
  assert.equal(cleanCairn(null), undefined);
  assert.equal(cleanCairn({ q: 1, r: 1, folk: '', at: 3, items: [{ id: 'a:b', qty: 1 }] }), undefined, 'no Folk');
  assert.equal(cleanCairn({ q: 1.5, r: 1, folk: 'f', at: 3, items: [{ id: 'a:b', qty: 1 }] }), undefined, 'no hex');
  const c = cleanCairn({ q: 1, r: 1, folk: 'f', at: 3, cause: '<b>', items: [{ id: 'a:b', qty: 2 }, { id: 'no id', qty: 1 }, { id: 'a:c', qty: -1 }, { id: 'a:d', qty: 0.5 }], guard: { band: 'x', ground: 'y', tier: 9 } });
  assert.deepEqual(c.items, [{ id: 'a:b', qty: 2 }]);
  assert.equal(c.cause, 'other');
  assert.equal(c.guard, undefined);
  const many = Array.from({ length: CAIRN_ITEMS_MAX + 10 }, (_, i) => ({ id: `mod:I${i}`, qty: 1 }));
  assert.equal(cleanCairn({ q: 0, r: 0, folk: 'f', at: 1, items: many }).items.length, CAIRN_ITEMS_MAX);
  assert.deepEqual(cleanCairns('x'), []);
  const a = cairn('a', 1);
  assert.deepEqual(cleanCairns([a, a, { junk: true }]), [a], 'each id once');
});

test('past CAIRNS_MAX the oldest unguarded cairn goes first, then the oldest', () => {
  let list = [];
  for (let i = 1; i <= CAIRNS_MAX; i++) list = addCairn(list, cairn(`f${i}`, i, { guard: i === 1 ? { band: 'highwaymen', ground: 'highlands', tier: 1 } : undefined })).cairns;
  const one = addCairn(list, cairn('new', 99));
  assert.equal(one.cairns.length, CAIRNS_MAX);
  assert.deepEqual(one.dropped.map((c) => c.id), ['f2@2'], 'the guarded oldest stays');
  const guarded = Array.from({ length: CAIRNS_MAX }, (_, i) => cairn(`g${i}`, i + 1, { guard: { band: 'highwaymen', ground: 'highlands', tier: 1 } }));
  assert.deepEqual(addCairn(guarded, cairn('new', 99, { guard: { band: 'highwaymen', ground: 'highlands', tier: 1 } })).dropped.map((c) => c.id), ['g0@1']);
  assert.deepEqual(addCairn(list, undefined), { cairns: list, dropped: [] });
});

test('the ids the cairns hold, each once, for the Heirloom check', () => {
  const list = [cairn('a', 1), cairn('b', 2)];
  assert.deepEqual(heldIds(list).sort(), ['melvorD:Bronze_Sword', 'melvorD:Normal_Logs', 'melvorD:Raw_Shrimp', 'worker_folks:Folk_Satchel']);
  assert.deepEqual(heldIds(undefined), []);
});

test("a Folk's newest cairn, and the cairns near a hex", () => {
  const list = [cairn('a', 1), cairn('b', 2), cairn('a', 3, { hex: { q: 9, r: 9 } })];
  assert.equal(cairnOf(list, 'a').at, 3);
  assert.equal(cairnOf(list, 'z'), undefined);
  assert.deepEqual(cairnsNear(list, { q: 3, r: 5 }, 1, distance).map((c) => c.id), ['a@1', 'b@2']);
  assert.deepEqual(cairnsNear(list, { q: 20, r: 0 }, 1, distance), []);
});

test('collecting takes what the bank can hold and leaves the rest; the purse is always taken whole', () => {
  const c = cairn();
  const all = collect(c, (id, qty) => qty);
  assert.equal(all.left, undefined);
  assert.equal(all.taken.length, 4);
  assert.deepEqual(all.purse, [{ id: 'melvorD:GP', amount: 1500 }]);
  const part = collect(c, (id, qty) => (id === 'melvorD:Raw_Shrimp' ? 100 : id === 'melvorD:Normal_Logs' ? 0 : qty));
  assert.deepEqual(part.left.items, [{ id: 'melvorD:Raw_Shrimp', qty: 350 }, { id: 'melvorD:Normal_Logs', qty: 30 }]);
  assert.deepEqual(part.left.purse, []);
  assert.deepEqual(collect(c, () => 999).taken.find((x) => x.id === 'melvorD:Raw_Shrimp'), { id: 'melvorD:Raw_Shrimp', qty: 450 }, 'never more than it holds');
  const list = [cairn('a', 1), c];
  assert.deepEqual(replaceCairn(list, c.id, part.left).map((x) => x.items.length), [4, 2]);
  assert.deepEqual(replaceCairn(list, c.id, undefined).map((x) => x.id), ['a@1']);
});

test('save v33 to v34: no cairn yet; cairns survive a reload', () => {
  const { save, report } = loadSave(JSON.stringify({ ...defaultSave(), v: 33, cairns: undefined }));
  assert.deepEqual(report.applied, [33, 34]);
  assert.equal(save.v, SAVE_VERSION);
  assert.deepEqual(save.cairns, []);
  const list = [cairn('a', 1)];
  assert.deepEqual(cleanCairns(loadSave(serializeSave({ ...save, cairns: list })).save.cairns), list);
  assert.deepEqual(loadSave(serializeSave({ ...save, cairns: 'x' })).save.cairns, []);
});
