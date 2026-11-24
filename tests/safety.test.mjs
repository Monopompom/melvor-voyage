import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/safety-model.mjs';
import { install } from '../src/safety.mjs';

const settle = () => new Promise((res) => setTimeout(res, 25));
const memory = () => {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), remove: (k) => m.delete(k), map: m };
};
const copyStore = () => {
  const m = new Map();
  return { get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); }, map: m };
};

/** One device: what outlives a reload. */
const device = () => ({ store: copyStore(), local: memory(), session: memory(), finished: [], written: [], notes: [] });

/** One page load of one mod on that device. */
function load(d, over = {}) {
  const hooks = {};
  const ctx = { onCharacterLoaded: (f) => { hooks.character = f; }, onInterfaceReady: (f) => { hooks.ready = f; } };
  const api = install(ctx, {
    M,
    ns: 'test',
    hadSave: () => true,
    take: () => ({ xp: 500, at: 1, record: 'r' }),
    encode: async (b) => `code:${b.xp}`,
    decode: async (code) => (code.startsWith('bad') ? { why: 'broken' } : { backup: { xp: Number(code.split(':')[1]) } }),
    writeBack: (b) => d.written.push(b.xp),
    notify: async (n) => { d.notes.push(n); },
    store: d.store,
    local: d.local,
    session: d.session,
    finish: (failed) => d.finished.push(failed),
    who: () => ({ slot: 7, name: 'Ada', mode: 'std', progress: 100 }),
    now: () => 1000,
    reloadMs: 1,
    timers: false,
    queue: { busy: 0, timer: 0, failed: false, chain: Promise.resolve() },
    ...over,
  });
  return { ...api, hooks };
}
const KEY = M.slotKey(7, 'Ada', 'std');
const saved = (at, xp, extra = {}) => ({ at, xp, name: 'Ada', mode: 'std', progress: 100, sig: `s${at}`, code: `code:${xp}`, ...extra });

test('a normal load keeps a copy and restores nothing', async () => {
  const d = device();
  await load(d).run();
  await settle();
  assert.equal(d.store.map.get(KEY).length, 1);
  assert.deepEqual(d.written, []);
  assert.deepEqual(d.finished, []);
});

test('a save without the block brings back the highest copy, saves and reloads', async () => {
  const d = device();
  d.store.map.set(KEY, [saved(3, 200), saved(2, 900)]);
  const p = load(d, { hadSave: () => false });
  p.hooks.character();
  await p.run();
  await settle();
  assert.deepEqual(d.written, [900]);
  assert.deepEqual(d.finished, [false]);
  assert.equal(d.local.map.size, 0);
  assert.equal(d.store.map.get(KEY).length, 2, 'no copy of the empty game');
});

test('the popup shows once, after the reload', async () => {
  const d = device();
  d.store.map.set(KEY, [saved(2, 900)]);
  await load(d, { hadSave: () => false }).run();
  await settle();
  assert.deepEqual(d.notes, []);
  await load(d).run();
  await settle();
  assert.deepEqual(d.notes, [{ xp: 900, at: 2 }]);
  await load(d).run();
  await settle();
  assert.equal(d.notes.length, 1);
});

test('the mark outlives an autosave of an empty block before the game was ready', async () => {
  const d = device();
  d.store.map.set(KEY, [saved(2, 900)]);
  load(d, { hadSave: () => false }).hooks.character();
  await load(d, { hadSave: () => true }).run();
  await settle();
  assert.deepEqual(d.written, [900]);
});

test('a marked game makes no copy while it waits to come back', async () => {
  const d = device();
  d.store.map.set(KEY, [saved(2, 900)]);
  load(d, { hadSave: () => false }).hooks.character();
  assert.equal(await load(d).copyNow(), false);
});

test('a first install or a new character is left alone', async () => {
  const d = device();
  await load(d, { hadSave: () => false }).run();
  await settle();
  assert.deepEqual(d.written, []);
  assert.deepEqual(d.finished, []);
  assert.equal(d.local.map.size, 0);
});

test('a new character with the same name does not get the old one\'s progress', async () => {
  const d = device();
  d.store.map.set(KEY, [saved(2, 900, { progress: 99999 })]);
  await load(d, { hadSave: () => false }).run();
  await settle();
  assert.deepEqual(d.written, []);
});

test('an unreadable copy falls through to the next best', async () => {
  const d = device();
  d.store.map.set(KEY, [saved(3, 900, { code: 'bad' }), saved(2, 400)]);
  await load(d, { hadSave: () => false }).run();
  await settle();
  assert.deepEqual(d.written, [400]);
});

test('a failed write reloads unsaved and never loops', async () => {
  const d = device();
  d.store.map.set(KEY, [saved(2, 900)]);
  const writeBack = () => { d.written.push('try'); throw new Error('no'); };
  for (let i = 0; i < 4; i++) {
    await load(d, { hadSave: () => false, writeBack }).run();
    await settle();
  }
  assert.equal(d.written.length, 2);
  assert.deepEqual(d.finished, [true, true]);
  assert.equal(d.local.get(`test:safety-lost:${KEY}`), '1', 'tried again next session');
});

test('two mods restored together reload once', async () => {
  const a = device();
  const b = device();
  a.store.map.set(KEY, [saved(2, 900)]);
  b.store.map.set(KEY, [saved(2, 300)]);
  const queue = { busy: 0, timer: 0, failed: false, chain: Promise.resolve() };
  const finished = [];
  const finish = (x) => finished.push(x);
  await Promise.all([
    load(a, { hadSave: () => false, queue, finish, ns: 'one' }).run(),
    load(b, { hadSave: () => false, queue, finish, ns: 'two' }).run(),
  ]);
  await settle();
  assert.deepEqual([a.written, b.written], [[900], [300]]);
  assert.deepEqual(finished, [false]);
});

test('two mods write back by rank, whichever was ready first', async () => {
  const a = device();
  const b = device();
  a.store.map.set(KEY, [saved(2, 900)]);
  b.store.map.set(KEY, [saved(2, 300)]);
  const queue = { busy: 0, timer: 0, failed: false, chain: Promise.resolve() };
  const order = [];
  await load(a, { hadSave: () => false, queue, ns: 'late', rank: 1, writeBack: () => order.push('late') }).run();
  await load(b, { hadSave: () => false, queue, ns: 'first', rank: 0, writeBack: () => order.push('first') }).run();
  await settle();
  assert.deepEqual(order, ['first', 'late']);
});

test('one mod failing saves neither and shows no popup', async () => {
  const a = device();
  const b = device();
  a.store.map.set(KEY, [saved(2, 900)]);
  b.store.map.set(KEY, [saved(2, 300)]);
  const queue = { busy: 0, timer: 0, failed: false, chain: Promise.resolve() };
  const finished = [];
  const finish = (x) => finished.push(x);
  await load(a, { hadSave: () => false, queue, finish, ns: 'good', rank: 0 }).run();
  await load(b, { hadSave: () => false, queue, finish, ns: 'bad', rank: 1, writeBack: () => { throw new Error('no'); } }).run();
  await settle();
  assert.deepEqual(finished, [true]);
  assert.equal(a.session.get('good:safety-restored'), null);
  assert.equal(a.local.get(`good:safety-lost:${KEY}`), '1');
  assert.equal(b.local.get(`bad:safety-lost:${KEY}`), '1');
});

test('leaving the tab keeps a copy once the last is a minute old', async () => {
  const d = device();
  let time = 1000;
  let n = 0;
  const listeners = [];
  const doc = { visibilityState: 'visible', addEventListener: (_, f) => listeners.push(f) };
  await load(d, { doc, now: () => time, take: () => ({ xp: 500, at: time, record: `r${n++}` }) }).run();
  await settle();
  assert.equal(listeners.length, 1);
  assert.equal(d.store.map.get(KEY).length, 1);
  doc.visibilityState = 'hidden';
  time += M.LEAVE_MS - 1;
  listeners[0]();
  await settle();
  assert.equal(d.store.map.get(KEY).length, 1, 'too soon');
  time += 1;
  listeners[0]();
  await settle();
  assert.equal(d.store.map.get(KEY).length, 2);
  doc.visibilityState = 'visible';
  time += M.LEAVE_MS;
  listeners[0]();
  await settle();
  assert.equal(d.store.map.get(KEY).length, 2, 'coming back makes none');
});

test('a mod that switched itself off does nothing', async () => {
  const d = device();
  d.store.map.set(KEY, [saved(2, 900)]);
  const p = load(d, { active: () => false, hadSave: () => false });
  p.hooks.character();
  await p.run();
  await settle();
  assert.deepEqual(d.written, []);
  assert.equal(d.local.map.size, 0);
});
