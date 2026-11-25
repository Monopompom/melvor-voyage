// Travel traits in the game (src/folk-traits.mjs) against a fake Worker Folks API: the work a Folk does is added up and
// reported once a game minute, not on every action; near a market it counts for Merchant too; a move reports the work
// done before it and then starts the "on one hex" count again; a Folk let go leaves nothing waiting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as FT from '../src/folk-traits-model.mjs';
import { install } from '../src/folk-traits.mjs';

globalThis.getLangString = (k) => k;
globalThis.templateLangString = (k) => k;
globalThis.Bank = class {};
globalThis.game = { _isInOnlineLoop: true };

const MINUTE_TICKS = 1200;

function setup() {
  const listeners = {};
  let modsLoaded;
  const ctx = {
    patch: () => ({ before: () => {}, after: () => {} }),
    onModsLoaded: (fn) => { modsLoaded = fn; },
    onCharacterLoaded: () => {},
    getResourceUrl: (x) => x,
  };
  const folks = { f1: { id: 'f1', name: 'Tobin', travel: 'idle', place: { q: 2, r: 2 }, traits: [] } };
  const api = {
    version: 13,
    registerTrait: () => true,
    on: (name, fn) => { (listeners[name] ??= []).push(fn); },
    traitsOf: () => ({ held: [], waiting: [] }),
    earnTrait: () => true,
    dropTrait: () => true,
    folks: () => Object.values(folks),
    folkById: (id) => folks[id],
  };
  const skill = { record: {} };
  const state = {
    folksGuarded: true,
    folksApi: () => api,
    voyageSkill: () => skill,
    position: () => ({ q: 0, r: 0 }),
    market: { marketAt: (q, r) => (q === 5 && r === 5 ? 'market' : undefined) },
    terrain: { neighbours: (q, r) => [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]].map(([dq, dr]) => ({ q: q + dq, r: r + dr })) },
  };
  const traits = install(ctx, { state, FT, S: { ROUGH_GROUND: [] }, log: () => {} });
  modsLoaded();
  const emit = (name, payload) => (listeners[name] ?? []).forEach((fn) => fn(payload));
  const counts = () => skill.record.folkTraits?.f1?.counts ?? {};
  const minute = () => { for (let i = 0; i < MINUTE_TICKS; i += 1) traits.tick(); };
  return { traits, folks, emit, counts, minute };
}

test('work is added up and reported once a game minute, not on every action', () => {
  const { folks, emit, counts, minute } = setup();
  for (let i = 0; i < 3; i += 1) emit('folkActionDone', { folk: folks.f1, intervalMs: 2000 });
  assert.equal(counts().Homebody, undefined, 'nothing reported yet');
  minute();
  assert.equal(counts().Homebody, 6000);
  assert.equal(counts().Merchant, undefined, 'no market near (2, 2)');
  minute();
  assert.equal(counts().Homebody, 6000, 'reported once');
});

test('work within a hex of a market counts for Merchant too', () => {
  const { folks, emit, counts, minute } = setup();
  const near = { ...folks.f1, place: { q: 5, r: 6 } };
  emit('folkActionDone', { folk: near, intervalMs: 1500 });
  emit('folkActionDone', { folk: folks.f1, intervalMs: 500 });
  minute();
  assert.equal(counts().Homebody, 2000);
  assert.equal(counts().Merchant, 1500);
});

test('a move reports the work done before it, then starts the "on one hex" count again', () => {
  const { folks, emit, counts, traits, minute } = setup();
  emit('folkActionDone', { folk: folks.f1, intervalMs: 3000 });
  traits.reset('f1', 'moved');
  assert.equal(counts().Homebody, undefined, 'the work before the move was counted, then the move reset it');
  emit('folkActionDone', { folk: folks.f1, intervalMs: 1000 });
  minute();
  assert.equal(counts().Homebody, 1000);
});

test('a Folk let go leaves no work waiting', () => {
  const { folks, emit, counts, minute } = setup();
  emit('folkActionDone', { folk: folks.f1, intervalMs: 3000 });
  emit('folkFired', { folk: folks.f1 });
  minute();
  assert.deepEqual(counts(), {});
});
