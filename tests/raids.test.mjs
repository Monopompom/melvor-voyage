// Raids in the game (src/raids.mjs) against fake encounters and a fake Worker Folks API 13: a due debt's band raids the
// first place on its ground that gives anything (a tent before a Folk), the debt goes down by the value taken, every
// due debt is marked raided for the day whether or not anything was found, a sea's band raids its coast, and nothing
// happens without API 13 or more often than once a minute of game time. The game clock is read once every 20 ticks
// online (200 in a catch-up), not on every tick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/encounter-rules-model.mjs';
import { install } from '../src/raids.mjs';

globalThis.getLangString = (k) => k;
globalThis.templateLangString = (k, v) => `${k} ${JSON.stringify(v)}`;
globalThis.numberWithCommas = (n) => `${n}`;
globalThis.OfflineProgressElement = class {};
const notes = [];
globalThis.game = { _isInOnlineLoop: true, notifications: { createInfoNotification: (k, text) => notes.push(text) } };

const TENTS = [{ key: 'tentA', q: 1, r: 1, name: 'Camp A' }, { key: 'tentB', q: 3, r: 3, name: 'Desert camp' }];
function setup({ version = 13, debts = { 'highwaymen:highlands': 500 }, gives = {}, tents = TENTS, ground = { '1,1': 'highlands', '2,2': 'highlands', '3,3': 'desert' } } = {}) {
  const ctx = { patch: () => ({ after: () => {} }), onCharacterLoaded: () => {}, getResourceUrl: (x) => x };
  const calls = [];
  const marks = [];
  let clock = 1000;
  let reads = 0;
  const e = { debts: { ...debts } };
  const api = {
    version,
    folks: () => [
      { id: 'f1', name: 'Tobin', travel: 'idle', place: { q: 2, r: 2 } },
      { id: 'f2', name: 'Mira', travel: 'idle', place: { q: 3, r: 3 } },
    ],
    raidRoom: (target, gp) => {
      calls.push([target.depot ?? target.folk, gp]);
      const g = Math.min(gp, gives[target.depot ?? target.folk] ?? 0);
      return { taken: g > 0 ? [{ itemId: 'x', qty: 1 }] : [], gp: g };
    },
  };
  const state = {
    folksGuarded: true,
    folksApi: () => api,
    gameNow: () => { reads += 1; return clock; },
    recordAt: (h) => ({ t: ground[`${h.q},${h.r}`] }),
    outposts: { list: () => tents },
    charts: { seaOf: (poi) => (poi === 'BeginningPort' ? [{ q: 7, r: 7 }] : []) },
    encounters: {
      isSea: (g) => g === 'BeginningPort',
      debts: () => Object.entries(e.debts).map(([key, gp]) => { const [band, g] = key.split(':'); return { key, band, ground: g, gp, name: `Band ${band}` }; }),
      raidsDue: () => Object.keys(e.debts),
      raidIn: () => 0,
      raidMark: (key) => marks.push(key),
      raidLower: (key, gp) => { e.debts = R.lowerDebt(e.debts, key, gp); return e.debts[key] ?? 0; },
    },
  };
  const out = install(ctx, { state, R, log: () => {} });
  // A second of game time: 20 ticks online.
  return { out, calls, marks, e, tick: (ms = 0) => { clock += ms; for (let i = 0; i < 20; i += 1) out.tick(); }, one: () => out.tick(), reads: () => reads, api };
}

test('a due debt raids the tent on its ground first; the debt drops by what was taken and a notice says so', () => {
  notes.length = 0;
  const { calls, marks, e, tick } = setup({ gives: { tentA: 120, f1: 999 } });
  tick();
  assert.deepEqual(calls, [['tentA', 500]], 'the tent gave something: no Folk raided that day');
  assert.deepEqual(e.debts, { 'highwaymen:highlands': 380 });
  assert.deepEqual(marks, ['highwaymen:highlands']);
  assert.match(notes[0], /^MOD_VOY_RAID_TOOK .*"gp":"120".*"left":"380"/);
});

test('an empty tent passes the raid on to a Folk on that ground; one elsewhere is safe; all paid reads so', () => {
  notes.length = 0;
  const { calls, e, tick } = setup({ gives: { tentA: 0, f1: 999, f2: 999, tentB: 999 } });
  tick();
  assert.deepEqual(calls, [['tentA', 500], ['f1', 500]]);
  assert.deepEqual(e.debts, {});
  assert.match(notes[0], /^MOD_VOY_RAID_TOOK_ALL .*MOD_VOY_RAID_AT_FOLK/);
});

test('nothing of yours on its ground: no raid, but the day counts as raided', () => {
  notes.length = 0;
  const { calls, marks, e, tick } = setup({ debts: { 'deserters:swamp': 300 } });
  tick();
  assert.deepEqual(calls, []);
  assert.deepEqual(marks, ['deserters:swamp']);
  assert.deepEqual(e.debts, { 'deserters:swamp': 300 });
  assert.equal(notes.length, 0);
});

test('a sea band raids its coast: a place on the sea or next to it', () => {
  const inland = setup({ debts: { 'pirates:BeginningPort': 200 }, gives: { tentA: 50 } });
  inland.tick();
  assert.deepEqual(inland.calls, [], 'nothing of yours on that coast');
  const coast = setup({ debts: { 'pirates:BeginningPort': 200 }, gives: { shore: 50 }, tents: [{ key: 'shore', q: 7, r: 6, name: 'Shore camp' }, ...TENTS] });
  coast.tick();
  assert.deepEqual(coast.calls, [['shore', 200]], 'the camp next to the sea');
  assert.deepEqual(coast.e.debts, { 'pirates:BeginningPort': 150 });
});

test('looked at once a minute of game time, and not at all without Worker Folks API 13', () => {
  const { calls, tick } = setup({ gives: {} });
  tick();
  tick(30 * 1000);
  assert.equal(calls.length, 2, 'the first look: the tent, then Tobin');
  tick(31 * 1000);
  assert.equal(calls.length, 4);
  const old = setup({ version: 12, gives: { tentA: 9 } });
  old.tick();
  assert.deepEqual(old.calls, []);
});

test('the game clock is read once every 20 ticks online, every 200 in a catch-up', () => {
  const { one, reads } = setup({ gives: {} });
  for (let i = 0; i < 19; i += 1) one();
  assert.equal(reads(), 0);
  one();
  assert.equal(reads(), 1);
  game._isInOnlineLoop = false;
  try {
    for (let i = 0; i < 199; i += 1) one();
    assert.equal(reads(), 1);
    one();
    assert.equal(reads(), 2);
  } finally { game._isInOnlineLoop = true; }
});
