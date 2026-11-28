// The port happenings in the game (src/happenings.mjs) against a fake market: a shortage's price and its filling, a
// festival's goods and depth, the news reaching where you stand, the board's word, the Welcome Back lines told once,
// and the slots rolled into the save from the goods you own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../src/happenings-model.mjs';
import { install } from '../src/happenings.mjs';

const HOUR = 60 * 60 * 1000;
globalThis.getLangString = (k) => k;
globalThis.templateLangString = (k, v) => `${k} ${JSON.stringify(v)}`;
globalThis.OfflineProgressElement = class {};
globalThis.document = { createElement: () => ({}) };
const notes = [];
const ITEMS = {
  Logs: { id: 'Logs', name: 'Logs', media: 'logs.png', sellsFor: { quantity: 10 } },
  Fish: { id: 'Fish', name: 'Fish', media: 'fish.png', sellsFor: { quantity: 20 } },
  Herb: { id: 'Herb', name: 'Herb', media: 'herb.png', sellsFor: { quantity: 5 } },
};
const bank = new Map([[ITEMS.Logs, { quantity: 3 }]]);
globalThis.game = {
  characterName: 'Tester',
  items: { getObjectByID: (id) => ITEMS[id] },
  bank: { items: bank },
  stats: { itemFindCount: (item) => (item.id === 'Fish' ? 1 : 0) },
  notifications: { createInfoNotification: (_k, text) => notes.push(text) },
};

const patches = {};
const ctx = { patch: (_cls, m) => ({ after: (fn) => { patches[m] = fn; } }), getResourceUrl: (p) => p };
const port = { id: 'Port', q: 0, r: 0, prices: { fish: 80 } };
const city = { id: 'City', q: 5, r: 0, prices: {} };
const far = { id: 'Far', q: 40, r: 0, prices: {} };
const goods = new Map([['Logs', ['logs', false]], ['Fish', ['fish', false]], ['Herb', ['herbs', false]]]);
let knownIds = ['Port', 'City'];
const market = {
  enabled: () => true,
  all: () => [port, city, far],
  depth: () => 24000,
  sizeOf: (m) => ({ Port: 'port', City: 'city' }[m.id] ?? 'market'),
  pressable: (item) => item?.sellsFor?.quantity > 0,
  goods: () => goods,
  categoryOf: (item) => goods.get(item?.id),
  name: (id) => id,
  duration: (ms) => `${Math.round(ms / HOUR)}h`,
  known: () => [port, city, far].filter((m) => knownIds.includes(m.id)),
  here: () => port,
  marketAt: (q, r) => [port, city, far].find((m) => m.q === q && m.r === r),
};
let now = 4 * H.OWN_SEASON_MS + HOUR; // a spring of the mod's own seasons, its second hour
const record = { happen: {} };
const state = {
  mode: 'active',
  market,
  gameNow: () => now,
  voyageSkill: () => ({ record }),
  position: () => ({ q: 0, r: 0 }),
};
// The encounter rules and Pilotage as the blockades read them.
const pilot = { sea_Port: 120 };
state.encounters = {
  R: { SEA_TIER: { Port: 2, Deep: 4, Unsailed: 1 }, purseOf: (where, tier) => [0, 3000, 7500, 18000, 45000][tier] },
  E: { bandsOf: (w) => (w === 'sea' ? ['corsairs', 'smugglers'] : []) },
  bandName: (b) => b,
};
state.pilotage = {
  hexesIn: (a) => pilot[a] ?? 0,
  levelIn: () => 10,
  hexesFor: (l) => l * 100,
  gift: (area, n) => { pilot[area] = (pilot[area] ?? 0) + n; return { before: 10, after: 11 }; },
};
state.charts = { seaAt: () => 'Port', seaName: (s) => s };
const terrainMod = { hexDistance: (a, b) => Math.abs(a.q - b.q) + Math.abs(a.r - b.r) };
const api = install(ctx, { state, H, terrainMod, shortNumber: (n) => `${n}`, log: () => {} });
const setHappen = (h) => { record.happen = h; api.current(); };
const slot = () => H.slotOf(now);

test('a first read rolls the current slot into the save, from the goods you hold or have found', () => {
  api.current();
  assert.equal(record.happen.at, slot());
  for (let s = 0; s < 60; s++) {
    const h = H.rollSlot(s, { seed: 'Tester', markets: [port, city, far].map((m) => ({ id: m.id, depth: 24000, cheap: Object.keys(m.prices) })), items: [{ id: 'Fish', kind: 'fish' }, { id: 'Logs', kind: 'logs' }], seas: [], bands: [] });
    if (h !== undefined) assert.ok(['Fish', 'Logs'].includes(h.item), 'never the herb you never had');
  }
});

test('a shortage pays 250% for what it still wants, takes its part of a sale, then is filled', () => {
  const start = now - HOUR;
  setHappen({ at: slot(), live: [{ id: `${slot()}:shortage`, kind: 'shortage', slot: slot(), start, end: start + H.SHORTAGE_MS, market: 'Port', item: 'Logs', want: 1000, sold: 0 }], told: {} });
  assert.deepEqual(api.adjust(port, ITEMS.Logs, 50, 100), { pct: 250, kind: 'shortage' });
  assert.equal(api.adjust(port, ITEMS.Logs, 200, 100).pct, 175, 'the part over what it wants sells as usual');
  assert.equal(api.adjust(city, ITEMS.Logs, 1, 100), undefined, 'another market: nothing');
  assert.equal(api.sellLines(port, ITEMS.Logs).length, 1);
  assert.equal(api.sold(port, ITEMS.Logs, 600), 0, 'all of it went into the shortage');
  assert.equal(notes.length, 0);
  assert.equal(api.sold(port, ITEMS.Logs, 600), 200, 'the rest presses the market');
  assert.equal(notes.length, 1, 'filled: one notice');
  assert.equal(api.adjust(port, ITEMS.Logs, 1, 100), undefined, 'filled: the usual price again');
  assert.equal(api.sold(port, ITEMS.Logs, 50), 50);
});

test('a festival pays ×1.5 for its goods at its city for the first day of the season, and takes twice as much', () => {
  setHappen({ at: slot(), live: [], told: {} });
  const f = api.current().fest;
  assert.ok(f, 'the own clock\'s spring holds the Planting Fair');
  assert.equal(f.market, 'City', 'the only city');
  assert.deepEqual(api.adjust(city, ITEMS.Herb, 1, 100), { pct: 150, kind: 'festival' });
  assert.equal(api.depthFactor(city, ITEMS.Herb), H.FESTIVAL_DEPTH);
  assert.equal(api.adjust(city, ITEMS.Fish, 1, 100), undefined, 'not the season\'s goods');
  assert.equal(api.depthFactor(port, ITEMS.Herb), 1, 'not its market');
  const was = now;
  now += 24 * HOUR;
  record.happen = { ...record.happen };
  api.current();
  assert.equal(api.adjust(city, ITEMS.Herb, 1, 100), undefined, 'its day is over');
  now = was;
});

test('news reaches you half an hour of game time a hex away, only from markets you know, and is told away once', () => {
  const s = slot();
  const mk = (id, market, item, ago) => ({ id: `${s - id}:shortage`, kind: 'shortage', slot: s - id, start: now - ago, end: now - ago + H.SHORTAGE_MS, market, item, want: 1000, sold: 0 });
  setHappen({ at: s, live: [mk(1, 'City', 'Fish', 2 * HOUR), mk(2, 'Far', 'Logs', 30 * HOUR)], told: {} });
  const shortages = () => api.heard().filter((x) => x.h.kind === 'shortage').map((x) => x.h.market);
  assert.deepEqual(shortages(), [], 'the City is 5 hexes: 2.5 h, not yet; Far unknown');
  assert.ok(api.heard().some((x) => x.h.kind === 'festival'), 'a festival is cried at once');
  now += HOUR;
  record.happen = { ...record.happen };
  const heard = shortages();
  assert.ok(heard.includes('City'), 'three hours on, the City is heard');
  assert.ok(!heard.includes('Far'), 'a market you don\'t know is never named');
  assert.ok(api.boardHtml().includes('MOD_VOY_HAPPEN_WORD'));
  assert.ok(api.markAt(5, 0).includes('MOD_VOY_HAPPEN_ROW_SHORTAGE'));
  assert.equal(api.markAt(0, 0), undefined, 'nothing at the port (the festival is the City\'s)');
  const box = { messageContainer: { lines: [], append(h) { this.lines.push(h.innerHTML); } } };
  patches.setMessages.call(box);
  assert.ok(box.messageContainer.lines.length >= 1 && box.messageContainer.lines.length <= 3);
  assert.ok(box.messageContainer.lines.every((l) => l.includes('MOD_VOY_HAPPEN_AWAY')));
  const again = { messageContainer: { lines: [], append(h) { this.lines.push(h.innerHTML); } } };
  patches.setMessages.call(again);
  assert.equal(again.messageContainer.lines.length, 0, 'told once');
  knownIds = ['Port', 'City', 'Far'];
  assert.ok(api.heard().some((x) => x.h.market === 'Far'), '40 hexes, 20 h: heard once you know the place');
  knownIds = ['Port', 'City'];
});

test('off (dormant) nothing changes a price', () => {
  state.mode = 'dormant';
  record.happen = { ...record.happen };
  assert.equal(api.adjust(city, ITEMS.Herb, 1, 100)?.pct, undefined);
  assert.deepEqual(api.sellLines(city, ITEMS.Herb), []);
  assert.equal(api.boardHtml(), '');
  state.mode = 'active';
});

test('blockades roll only on a tier 1-3 sea you sailed, by one of the sea bands', () => {
  let n = 0;
  for (let s = 0; s < 300; s++) {
    const h = H.rollSlot(s, { seed: 'Tester', markets: [], items: [], seas: [{ id: 'Port', tier: 2, weight: 120 }, { id: 'Deep', tier: 4, weight: 9 }, { id: 'Unsailed', tier: 1, weight: 0 }], bands: ['corsairs', 'smugglers'] });
    if (h === undefined) continue;
    n++;
    assert.equal(h.kind, 'blockade');
    assert.equal(h.sea, 'Port');
  }
  assert.ok(n > 150);
});

test('a blockade: a tier worse on its sea, three wins lift it, the bounty and a Pilotage level of hexes; its cargo pays more', () => {
  const s = slot();
  setHappen({ at: s, live: [{ id: `${s}:blockade`, kind: 'blockade', slot: s, start: now - HOUR, end: now - HOUR + H.BLOCKADE_MS, sea: 'Port', tier: 2, band: 'corsairs', wins: 0 }], told: {} });
  assert.equal(api.blockadeOn('Port').band, 'corsairs');
  assert.equal(api.blockadeOn('Deep'), undefined);
  assert.equal(api.cargoPay({ from: 'Port', to: 'City' }, 1000), 1250);
  assert.equal(api.cargoPay({ from: 'City', to: 'Far' }, 1000), 1000);
  assert.ok(api.panelHtml().includes('MOD_VOY_HAPPEN_HERE_BLOCKADE'), 'on its sea: the Here panel says so');
  assert.ok(api.heard().some((x) => x.h.kind === 'blockade'), 'on its sea you hear of it at once');
  assert.ok(api.boardHtml().includes('MOD_VOY_HAPPEN_ROW_BLOCKADE'));
  assert.equal(api.wonAt('Deep'), undefined, 'a win elsewhere counts nothing');
  assert.deepEqual([api.wonAt('Port').wins, api.wonAt('Port').wins].concat([]), [1, 2]);
  const r = api.wonAt('Port');
  assert.equal(r.lifted, true);
  assert.equal(r.bounty, 7500 * H.BOUNTY_PURSES);
  assert.equal(r.pilot, 100, 'one level\'s worth of hexes');
  assert.equal(pilot.sea_Port, 220);
  assert.equal(api.blockadeOn('Port'), undefined, 'lifted');
  assert.equal(api.cargoPay({ from: 'Port', to: 'City' }, 1000), 1000);
  assert.equal(api.panelHtml(), '');
});

test('the check hook forces a blockade on the sea you are on', () => {
  setHappen({ at: slot(), live: [], told: {} });
  const h = api.force.blockade();
  assert.equal(h.sea, 'Port');
  assert.equal(api.blockadeOn('Port').id, h.id);
  assert.match(api.force.blockade('Deep'), /tier 1-3/);
  api.force.clear();
  assert.equal(api.blockadeOn('Port'), undefined);
});
