// The haul in the game (src/haul.mjs) against a fake Worker Folks API 10: the bank-access hook, collecting within a hex
// after a move, a Folk's room emptied when it comes aboard, the setting turning it off, and an older API left alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../src/haul-model.mjs';
import * as rules from '../src/rules.mjs';
import { install } from '../src/haul.mjs';

globalThis.getLangString = (k) => k;
globalThis.templateLangString = (k, v) => `${k} ${JSON.stringify(v)}`;
globalThis.OfflineProgressElement = class { setMessages() {} };
const notes = [];
globalThis.game = {
  _isInOnlineLoop: true,
  gp: { id: 'melvorD:GP' },
  items: { getObjectByID: (id) => ({ name: id }) },
  currencies: { getObjectByID: (id) => (id === 'melvorD:GP' ? globalThis.game.gp : { name: id }) },
  notifications: { createInfoNotification: (k, text) => notes.push(['info', text]), createErrorNotification: (k, text) => notes.push(['error', text]) },
};

const recs = new Map([
  ['0,0', { q: 0, r: 0, t: 'mountain', f: ['rocky'] }],
  ['1,0', { q: 1, r: 0, t: 'mountain', f: [] }],
  ['5,0', { q: 5, r: 0, t: 'beach', f: ['port'] }],
  ['6,0', { q: 6, r: 0, t: 'beach', f: [] }],
]);
const terrainMod = { hexDistance: (a, b) => Math.abs(a.q - b.q) + Math.abs(a.r - b.r) };

function fakeFolks(version = 10) {
  const listeners = {};
  const calls = [];
  const folks = [
    { id: 'a', name: 'Ada', slot: 0, travel: 'idle', place: { q: 1, r: 0 } },
    { id: 'b', name: 'Bo', slot: 1, travel: 'idle', place: { q: 6, r: 0 } },
  ];
  const rooms = { a: { sizeMs: 7_200_000, usedMs: 3_600_000, haul: [{ itemId: 'Iron_Ore', qty: 50, ms: 1 }], stock: [], town: [], purse: [{ currencyId: 'melvorD:GP', amount: 300 }], state: 'ok', access: 'room' } };
  const api = {
    version,
    hook: undefined,
    folks: () => folks.map((f) => ({ ...f })),
    folkById: (id) => folks.find((f) => f.id === id),
    on: (name, fn) => { (listeners[name] ??= []).push(fn); },
    registerBankAccess: (fn) => { api.hook = fn; calls.push('register'); return () => { api.hook = undefined; }; },
    refreshBankAccess: () => calls.push('refresh'),
    room: (id) => rooms[id],
    collect: (id) => { calls.push(`collect:${id}`); const r = rooms[id]; const out = { items: r.haul.map((s) => ({ itemId: s.itemId, qty: s.qty })), left: [], purse: r.purse }; rooms[id] = { ...r, haul: [], purse: [] }; return out; },
    restockPlan: () => ({ items: [], freeMs: 0, actions: 0 }),
    restock: () => ({ ok: false, why: 'noInputs' }),
    emptyToBank: (id) => { calls.push(`empty:${id ?? 'all'}`); return id === undefined ? [{ id: 'a', items: [{ itemId: 'Logs', qty: 5 }], left: [], purse: [] }, { id: 'b', items: [], left: [], purse: [] }] : { items: [{ itemId: 'Iron_Ore', qty: 5 }], left: [], purse: [] }; },
  };
  const emit = (name, payload) => (listeners[name] ?? []).forEach((fn) => fn(payload));
  return { api, calls, folks, emit, rooms };
}

function setup(fake, { haulSetting = true } = {}) {
  const loaded = [];
  const charLoaded = [];
  const settings = { haul: () => haulSetting };
  const state = {
    folksGuarded: true,
    folksApi: () => fake.api,
    active: () => true,
    settings,
    listeners: [],
    pos: { q: 0, r: 0 },
    position() { return this.pos; },
    recordAt: (p) => recs.get(`${p.q},${p.r}`),
    terrain: { neighbours: (q, r) => [recs.get(`${q - 1},${r}`), recs.get(`${q + 1},${r}`)].filter(Boolean) },
    overlay: { folksChanged: () => {} },
  };
  const afters = [];
  const ctx = { patch: () => ({ after: (fn) => afters.push(fn) }), onModsLoaded: (fn) => loaded.push(fn), onCharacterLoaded: (fn) => charLoaded.push(fn), getResourceUrl: (p) => p };
  const out = install(ctx, { state, H, rules, terrainMod, shortNumber: (n) => `${n}`, decimal: (n) => `${n}`, log: () => {} });
  loaded.forEach((fn) => fn());
  return { out, state, settings, afters };
}

test('Voyage registers the bank-access hook; a Folk in the wild uses its room, one next to a port the bank', () => {
  const fake = fakeFolks();
  setup(fake);
  assert.ok(fake.calls.includes('register'));
  assert.equal(fake.api.hook({ id: 'a', travel: 'idle', place: { q: 1, r: 0 } }), 'room');
  assert.equal(fake.api.hook({ id: 'b', travel: 'idle', place: { q: 6, r: 0 } }), 'bank', 'next to the port');
  assert.equal(fake.api.hook({ id: 'a', travel: 'with', place: null }), 'bank');
});

test('a move that lands within a hex of a Folk collects its haul and purse, said in one notice', () => {
  const fake = fakeFolks();
  const { out } = setup(fake);
  notes.length = 0;
  out.afterMove();
  assert.deepEqual(fake.calls.filter((c) => c.startsWith('collect')), ['collect:a']);
  assert.equal(notes.length, 1);
  assert.match(notes[0][1], /MOD_VOY_HAUL_IN/);
  out.afterMove();
  assert.deepEqual(fake.calls.filter((c) => c.startsWith('collect')), ['collect:a'], 'nothing left to collect');
});

test('a Folk coming aboard empties its room to the bank; one walking keeps it', () => {
  const fake = fakeFolks();
  setup(fake);
  fake.emit('folkAssigned', { folk: { id: 'a', travel: 'idle', place: { q: 1, r: 0 } } });
  fake.emit('folkMoved', { folk: { id: 'a', name: 'Ada', travel: 'walking', place: { q: 1, r: 0 } } });
  assert.ok(!fake.calls.includes('empty:a'), 'a walk takes the room along');
  fake.emit('folkMoved', { folk: { id: 'a', name: 'Ada', travel: 'with', place: null } });
  assert.ok(fake.calls.includes('empty:a'));
});

test('turning the setting off refreshes the access and empties every room; the hook then answers the bank', () => {
  const fake = fakeFolks();
  let on = true;
  const { state, settings } = setup(fake);
  settings.haul = () => on;
  state.listeners.forEach((fn) => fn());
  on = false;
  state.listeners.forEach((fn) => fn());
  assert.ok(fake.calls.includes('refresh'));
  assert.ok(fake.calls.includes('empty:all'));
  assert.equal(fake.api.hook({ id: 'a', travel: 'idle', place: { q: 1, r: 0 } }), 'bank');
  assert.match(notes.at(-1)[1], /MOD_VOY_HAUL_EMPTIED_ONE [^,]*Ada/, 'one Folk gave something: named');
});

test('a Worker Folks older than 10 is left alone: no hook, nothing collected, no panel rows', () => {
  const fake = fakeFolks(9);
  const { out } = setup(fake);
  assert.equal(fake.api.hook, undefined);
  out.afterMove();
  assert.ok(!fake.calls.some((c) => c.startsWith('collect')));
  assert.equal(out.panelHtml(), '');
});

test('the map marks a hex whose Folk stopped full; the tooltip word says so', () => {
  const fake = fakeFolks();
  const { out } = setup(fake);
  fake.rooms.a = { ...fake.rooms.a, state: 'full' };
  assert.equal(out.markAt(1, 0), 'full');
  assert.equal(out.markAt(6, 0), undefined);
  assert.equal(out.folkWord({ id: 'a' }), 'MOD_VOY_HAUL_STATE_FULL');
});

test('standing by a working Folk collects each new stack quietly; arriving says what came in', async () => {
  const fake = fakeFolks();
  const { out } = setup(fake);
  notes.length = 0;
  fake.emit('roomChanged', { folk: { id: 'a', name: 'Ada', travel: 'idle', place: { q: 1, r: 0 } } });
  await Promise.resolve();
  assert.deepEqual(fake.calls.filter((c) => c.startsWith('collect')), ['collect:a']);
  assert.equal(notes.length, 0, 'no notice for a stack collected while you stand there');
  fake.rooms.a = { ...fake.rooms.a, haul: [{ itemId: 'Iron_Ore', qty: 4, ms: 1 }] };
  out.afterMove();
  assert.equal(notes.length, 1);
});

test('offline, every collection becomes one Welcome Back line, the Folk named once', () => {
  const fake = fakeFolks();
  const { out, afters } = setup(fake);
  const shown = [];
  globalThis.document = { createElement: () => ({}) };
  game._isInOnlineLoop = false;
  try {
    out.afterMove();
    fake.rooms.a = { ...fake.rooms.a, haul: [{ itemId: 'Iron_Ore', qty: 7, ms: 1 }] };
    out.afterMove();
    afters.forEach((fn) => fn.call({ messageContainer: { append: (h) => shown.push(h.innerHTML) } }));
  } finally { game._isInOnlineLoop = true; delete globalThis.document; }
  assert.equal(shown.length, 1);
  assert.match(shown[0], /MOD_VOY_HAUL_IN/);
  assert.match(shown[0], /<span class="voyage-keep voyage-haul-piece"><span class="text-success">57<\/span> Iron_Ore<\/span>/, 'both collections summed, the amount green, the piece kept whole');
  assert.match(shown[0], /MOD_VOY_HAUL_FROM_ONE/);
});

test('up to three Folks within reach get their rows in the panel; more, one row says how many and how many stopped', () => {
  const fake = fakeFolks();
  const { out } = setup(fake);
  fake.api.restockPlan = () => ({ items: [{ itemId: 'Raw_Shrimp', qty: 10 }], freeMs: 1, actions: 10 });
  const rowsOf = (html) => (html.match(/voyage-haul-row"/g) ?? []).length;
  assert.equal(out.rows, 3);
  assert.equal(rowsOf(out.panelHtml()), 1);
  assert.match(out.panelHtml(), /voyage-haul-rows voyage-haul-b"/, 'a Restock column; no stop word, no column for it');
  for (const id of ['c', 'd']) {
    fake.folks.push({ id, name: id.toUpperCase(), slot: 2, travel: 'idle', place: { q: 0, r: 0 } });
    fake.rooms[id] = { ...fake.rooms.a, state: id === 'c' ? 'dry' : 'ok' };
  }
  assert.equal(rowsOf(out.panelHtml()), 3);
  assert.match(out.panelHtml(), /voyage-haul-w/, 'a stop word in one row: every row keeps its column');
  fake.folks.push({ id: 'e', name: 'E', slot: 3, travel: 'idle', place: { q: 1, r: 0 } });
  fake.rooms.e = { ...fake.rooms.a, state: 'full' };
  const sum = out.panelHtml();
  assert.equal(rowsOf(sum), 0);
  assert.match(sum, /MOD_VOY_HAUL_SUM [^<]*4/);
  assert.match(sum, /MOD_VOY_HAUL_SUM_STOPPED [^<]*2/);
  assert.match(sum, /data-haul-act="open"/);
});

test('the haul names the Folks its rows show, so the Folks here row can leave them out; a row tells rank and work', () => {
  const fake = fakeFolks();
  const { out, state } = setup(fake);
  assert.deepEqual(out.listed(), ['a'], 'Ada works from her room within reach; Bo is far');
  state.rankName = (n) => `rank${n}`;
  state.folkDoing = () => 'Mining';
  fake.folks[0].tier = 2;
  assert.match(out.panelHtml(), /title="Ada \(MOD_VOY_PANEL_FOLK_WHAT [^"]*rank2[^"]*Mining/);
  fake.rooms.a = { ...fake.rooms.a, access: 'bank' };
  assert.deepEqual(out.listed(), [], 'one working from the bank is not in the rows');
});
