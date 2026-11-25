// Road moments (round 5): where a courier or a walk stands on its road, what each answer does to the road ahead, and
// the game side against a fake Worker Folks API 13: three moments registered once, which fit whom, and their answers
// changing the courier route or the walk, healing through `heal`, paying the traveller's GP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as RM from '../src/road-moments-model.mjs';
import * as W from '../src/walk-model.mjs';
import * as M from '../src/courier-model.mjs';
import { install } from '../src/road-moments.mjs';

const step = (q, ms = 360000) => ({ q, r: 0, cls: 'grasslands', ms });
const road = (n) => Array.from({ length: n }, (_, i) => step(i + 1));

test('a courier stands on its road only on a land leg it walks now', () => {
  const c = { stops: [], road: road(8), reached: 2, into: 100 };
  assert.deepEqual(RM.courierSpot(c), { road: c.road, at: 2 });
  assert.equal(RM.hexesAhead(RM.courierSpot(c)), 5);
  for (const more of [{ crossing: {} }, { held: 5 }, { packing: true }, { topping: true }, { retired: true }, { reached: 8 }]) {
    assert.equal(RM.courierSpot({ ...c, ...more }), undefined, JSON.stringify(more));
  }
});

test('a walk stands on its road until it arrives, never while a band holds it', () => {
  const w = { from: { q: 0, r: 0 }, road: road(6), start: 0 };
  assert.deepEqual(RM.walkSpot(w, 360000 * 2 + 5, W.walkAt), { road: w.road, at: 2 });
  assert.equal(RM.walkSpot(w, 360000 * 6, W.walkAt), undefined, 'arrived');
  assert.equal(RM.walkSpot({ ...w, held: 10 }, 20, W.walkAt), undefined);
});

test('the short cut skips the next hexes (they are still entered) or loses an hour on the one being walked', () => {
  const r = road(10);
  const won = RM.shortCut({ road: r, at: 3 }, () => 0);
  assert.equal(won.won, true);
  assert.deepEqual(won.road.map((s) => s.ms), [360000, 360000, 360000, 360000, 1000, 1000, 1000, 1000, 360000, 360000]);
  const lost = RM.shortCut({ road: r, at: 3 }, () => 0.99);
  assert.equal(lost.won, false);
  assert.equal(lost.road[3].ms, 360000 + RM.LOST_MS);
  assert.equal(W.roadMs(lost.road) - W.roadMs(r), RM.LOST_MS);
  assert.equal(RM.slow(r, 0, 1e12)[0].ms, 24 * 3600 * 1000, 'a hex never takes more than a day');
});

test('the farmhouse: offered below three quarters of max HP; a night gives back 30%, never past max', () => {
  assert.equal(RM.hurt(74, 100), true);
  assert.equal(RM.hurt(75, 100), false);
  assert.equal(RM.hurt(undefined, 100), false);
  assert.equal(RM.innHeal(10, 100), 30);
  assert.equal(RM.innHeal(90, 100), 10);
  assert.equal(RM.innHeal(100, 100), 0);
});

globalThis.getLangString = (k) => k;
globalThis.templateLangString = (k, v) => `${k} ${JSON.stringify(v)}`;
globalThis.numberWithCommas = (n) => `${n}`;

function setup({ version = 13, provisions = true } = {}) {
  const hooks = [];
  const ctx = { onCharacterLoaded: (f) => hooks.push(f), onCharacterSelectionLoaded: (f) => hooks.push(f) };
  const defs = {};
  const healed = [];
  const notes = [];
  let gp = 0;
  globalThis.game = { _isInOnlineLoop: true, gp: { add: (n) => { gp += n; } }, notifications: { createInfoNotification: (id, text) => notes.push(text) } };
  const couriers = { c1: { stops: [{ kind: 'bank', q: 0, r: 0 }, { kind: 'folk', id: 'x' }], next: 1, from: { q: 0, r: 0 }, road: road(8), reached: 1, into: 0, pack: { food: 1000, fuel: 4 } } };
  const walks = { w1: { from: { q: 0, r: 0 }, road: road(3), start: 0, skillId: null } };
  const api = {
    version,
    registerMoment: (def) => { defs[def.id] = def; return () => {}; },
    heal: (id, n) => { healed.push([id, n]); return n; },
    folks: () => [],
  };
  const state = {
    folksApi: () => api,
    gameNow: () => 0,
    stores: { enabled: () => provisions },
    couriers: { all: () => couriers, edit: (id, fn) => { couriers[id] = M.cleanCourier(fn(couriers[id])); return couriers[id] !== undefined; } },
    walks: { walks: () => walks, edit: (id, fn) => { walks[id] = W.cleanWalk(fn(walks[id], 0)); return walks[id] !== undefined; } },
  };
  const out = install(ctx, { state, RM, W, M, log: () => {} });
  for (const h of hooks) h();
  const courier = { id: 'c1', name: 'Tobin', travel: 'walking', job: M.COURIER_JOB, hp: 40, maxHp: 100 };
  const walker = { id: 'w1', name: 'Mira', travel: 'walking', job: null, hp: 100, maxHp: 100 };
  const answer = (name, id, view, expired = false) => defs[`voyage:${name}`].answers.find((a) => a.id === id).apply(view, { offline: false, expired });
  return { out, defs, healed, notes, gp: () => gp, couriers, walks, courier, walker, answer };
}

test('three moments are registered once with Worker Folks 13, each a third the weight of one of its own; none before 13', () => {
  const s = setup();
  assert.deepEqual(Object.keys(s.defs), ['voyage:ShortCut', 'voyage:Farmhouse', 'voyage:Traveller']);
  for (const d of Object.values(s.defs)) {
    assert.equal(d.weight, RM.WEIGHT);
    assert.equal(d.answers.length, 2);
    assert.ok(d.answers.some((a) => a.id === d.defaultAnswer));
    assert.equal(d.answers.find((a) => a.id === d.defaultAnswer).tone, 'no', 'the default is the plain one');
  }
  assert.equal(s.out.registered(), true);
  assert.deepEqual(Object.keys(setup({ version: 12 }).defs), []);
});

test('which fit: the short cut needs hexes ahead, the farmhouse a hurt Folk, none a Folk at home or on a packet', () => {
  const s = setup();
  const fits = (view) => ['ShortCut', 'Farmhouse', 'Traveller'].filter((n) => s.defs[`voyage:${n}`].fits(view));
  assert.deepEqual(fits(s.courier), ['ShortCut', 'Farmhouse', 'Traveller']);
  assert.deepEqual(fits(s.walker), ['Traveller'], 'two hexes left, full HP');
  assert.deepEqual(fits({ ...s.walker, travel: 'idle' }), []);
  s.couriers.c1 = { ...s.couriers.c1, crossing: { to: { q: 9, r: 0 }, hexes: [{ q: 5, r: 1 }], ms: 1000, into: 0 } };
  assert.deepEqual(fits(s.courier), []);
});

test('answers change the courier\'s road from where it stands, heal through Worker Folks and pay the traveller', () => {
  const s = setup();
  const before = W.roadMs(s.couriers.c1.road);
  s.answer('Farmhouse', 'stay', s.courier);
  assert.equal(W.roadMs(s.couriers.c1.road) - before, RM.INN_MS);
  assert.equal(s.couriers.c1.road[1].ms, 360000 + RM.INN_MS, 'the hex it walks into');
  assert.deepEqual(s.healed, [['c1', 30]]);
  s.answer('Traveller', 'guide', s.walker);
  assert.equal(s.gp(), RM.GUIDE_GP);
  assert.equal(W.roadMs(s.walks.w1.road), 3 * 360000 + RM.GUIDE_MS);
  assert.match(s.notes.at(-1), /^MOD_VOY_MOMENT_Traveller_PAID/);
  const plain = JSON.stringify(s.couriers.c1);
  s.answer('ShortCut', 'road', s.courier);
  assert.equal(JSON.stringify(s.couriers.c1), plain, 'keeping to the road, picked, changes nothing');
  s.answer('ShortCut', 'take', s.courier);
  assert.match(s.notes.at(-1), /^MOD_VOY_MOMENT_ShortCut_(WON|LOST)/);
});

test('an answer taken once the Folk is off the road does nothing: no GP, no heal', () => {
  const s = setup();
  s.answer('Traveller', 'guide', { ...s.walker, travel: 'idle' });
  s.answer('Farmhouse', 'stay', { ...s.courier, travel: 'idle' });
  assert.equal(s.gp(), 0);
  assert.deepEqual(s.healed, []);
});

test('left unanswered, a moment costs a little: an hour lost waiting, or some road food spoiled; picked, the cautious answer is free', () => {
  const s = setup();
  const pick = (name) => s.defs[`voyage:${name}`].defaultAnswer;
  const before = W.roadMs(s.couriers.c1.road);
  for (const name of ['ShortCut', 'Farmhouse', 'Traveller']) s.answer(name, pick(name), s.courier);
  assert.equal(W.roadMs(s.couriers.c1.road), before, 'picked: free');
  assert.deepEqual(s.couriers.c1.pack, { food: 1000, fuel: 4 });
  s.answer('ShortCut', pick('ShortCut'), s.courier, true);
  assert.equal(W.roadMs(s.couriers.c1.road) - before, RM.IGNORED_MS);
  assert.match(s.notes.at(-1), /^MOD_VOY_MOMENT_IGNORED_WAIT/);
  s.answer('Traveller', pick('Traveller'), s.walker, true);
  assert.equal(W.roadMs(s.walks.w1.road), 3 * 360000 + RM.IGNORED_MS);
  s.answer('Farmhouse', pick('Farmhouse'), s.courier, true);
  assert.deepEqual(s.couriers.c1.pack, { food: 900, fuel: 4 }, 'a tenth of the food, the fuel kept');
  assert.match(s.notes.at(-1), /^MOD_VOY_MOMENT_IGNORED_SPOIL/);
  s.answer('Farmhouse', pick('Farmhouse'), s.walker, true);
  assert.equal(s.walks.w1.hungry, RM.SPOIL_HEXES, 'a Folk walking alone: a hex more hungry');
  for (const name of ['ShortCut', 'Farmhouse', 'Traveller']) assert.match(s.defs[`voyage:${name}`].answers.find((a) => a.id === pick(name)).hint(s.courier), /^MOD_VOY_MOMENT_HINT_(WAIT|SPOIL)/);
  const n = s.notes.length;
  s.couriers.c1 = { ...s.couriers.c1, pack: { food: 0, fuel: 4 } };
  s.answer('Farmhouse', pick('Farmhouse'), s.courier, true);
  assert.equal(s.notes.length, n, 'nothing packed: nothing spoils, no notice');
  s.walks.w1 = { ...s.walks.w1, hungry: s.walks.w1.road.length };
  s.answer('Farmhouse', pick('Farmhouse'), s.walker, true);
  assert.equal(s.notes.length, n, 'already hungry to the end: no notice');
  assert.equal(RM.spoil({ food: 5, fuel: 1 }).food, 4);
  assert.equal(RM.spoil(undefined), undefined);
});

test('without Provisions, an unanswered farmhouse loses an hour instead; off the road, nothing', () => {
  const s = setup({ provisions: false });
  const before = W.roadMs(s.couriers.c1.road);
  s.answer('Farmhouse', 'on', s.courier, true);
  assert.equal(W.roadMs(s.couriers.c1.road) - before, RM.IGNORED_MS);
  assert.match(s.defs['voyage:Farmhouse'].answers.find((a) => a.id === 'on').hint(s.courier), /^MOD_VOY_MOMENT_HINT_WAIT/);
  const walk = JSON.stringify(s.walks.w1);
  s.answer('ShortCut', 'road', { ...s.walker, travel: 'idle' }, true);
  assert.equal(JSON.stringify(s.walks.w1), walk);
});
