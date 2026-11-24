// Cairns in the game (src/cairns.mjs) against a fake Worker Folks API 13: the death keeper registered only from v13, a
// walking Folk's goods kept on its hex, the killing band as guard, the line for the death notice, the oldest cairn past
// the cap going to the bank, and nothing kept without a loaded save. Collecting (build .711): the cairns within a hex of
// you, the bank taking what fits, a guarded one opening its band's fight and handed over only when the band is beaten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/cairn-model.mjs';
import { install } from '../src/cairns.mjs';

globalThis.getLangString = (k) => k;
globalThis.templateLangString = (k, v) => `${k} ${JSON.stringify(v)}`;
globalThis.HexCoords = class { constructor(q, r) { this.q = q; this.r = r; } to_oddq() { return { col: this.q, row: this.r + 100 }; } };
const banked = [];
const paid = [];
const notes = [];
globalThis.game = {
  gp: { add: (n) => paid.push(['gp', n]) },
  items: { getObjectByID: (id) => (id === 'mod:Gone' ? undefined : { id }) },
  bank: { addItem: (item, qty) => { banked.push([item.id, qty]); return item.id !== 'mod:Full'; } },
  currencies: { getObjectByID: (id) => ({ add: (n) => paid.push([id, n]) }) },
  notifications: { createInfoNotification: (k, text) => notes.push(text) },
};

function setup({ version = 13, guarded = true, killer, pos = { q: 3, r: 4 } } = {}) {
  const hooks = [];
  const ctx = { onCharacterSelectionLoaded: (f) => hooks.push(f), onCharacterLoaded: (f) => hooks.push(f) };
  let keeper;
  const api = { version, registerDeathKeeper: (def) => { keeper = def; return () => {}; } };
  const skill = { record: { cairns: [] } };
  const state = {
    folksGuarded: guarded,
    folksApi: () => api,
    voyageSkill: () => skill,
    gameNow: () => 5000,
    encounters: { killer: () => killer, bandName: (b) => `Band ${b}`, fightOpen: () => false, guardFight: (c) => { state.fought = c.id; return true; } },
    clock: { running: () => false },
    active: () => true,
    position: () => pos,
  };
  const out = install(ctx, { state, C, log: () => {} });
  for (const h of hooks) h();
  return { out, keeper: () => keeper, skill, state };
}
const goods = {
  gear: [{ slot: 'Weapon', itemId: 'melvorD:Bronze_Sword', qty: 1 }],
  room: { haul: [{ itemId: 'melvorD:Raw_Shrimp', qty: 40 }], stock: [], town: [] },
  purse: [{ currencyId: 'melvorD:GP', amount: 250 }],
};
const folk = { id: 'worker_folks:F1', name: 'Rolf', travel: 'walking', place: { q: 3, r: 4 } };

test('from API v13 the death keeper is registered once; an older Worker Folks keeps its own rule', () => {
  const { out, keeper } = setup();
  assert.equal(out.registered(), true);
  assert.equal(typeof keeper().keep, 'function');
  assert.equal(typeof keeper().heldIds, 'function');
  assert.equal(setup({ version: 12 }).out.registered(), false);
});

test('a band killed it: the cairn holds everything on its hex, that band guards it, and the death line says where', () => {
  const { keeper, skill } = setup({ killer: { band: 'highwaymen', ground: 'highlands', tier: 2 } });
  assert.equal(keeper().keep(folk, { ...goods, cause: 'band' }), true);
  const [c] = skill.record.cairns;
  assert.deepEqual({ id: c.id, q: c.q, r: c.r, cause: c.cause, guard: c.guard }, { id: 'worker_folks:F1@5000', q: 3, r: 4, cause: 'band', guard: { band: 'highwaymen', ground: 'highlands', tier: 2 } });
  assert.deepEqual(c.items, [{ id: 'melvorD:Bronze_Sword', qty: 1 }, { id: 'melvorD:Raw_Shrimp', qty: 40 }]);
  assert.deepEqual(c.purse, [{ id: 'melvorD:GP', amount: 250 }]);
  assert.equal(keeper().textFor(folk.id), 'MOD_VOY_CAIRN_LEFT_GUARDED {"hex":"(3, 104)","band":"Band highwaymen"}');
  assert.deepEqual(keeper().heldIds().sort(), ['melvorD:Bronze_Sword', 'melvorD:Raw_Shrimp']);
  assert.equal(keeper().textFor('someone else'), '');
});

test('hunger leaves an unguarded cairn; a Folk with nothing, an unloaded save or Voyage off keeps nothing', () => {
  const { keeper, skill } = setup({ killer: { band: 'highwaymen', ground: 'highlands', tier: 2 } });
  assert.equal(keeper().keep(folk, { ...goods, cause: 'hunger' }), true);
  assert.equal(skill.record.cairns[0].guard, undefined, 'only a band guards');
  assert.match(keeper().textFor(folk.id), /^MOD_VOY_CAIRN_LEFT /);
  assert.equal(keeper().keep({ ...folk, id: 'x' }, { gear: [], room: { haul: [], stock: [], town: [] }, purse: [], cause: 'band' }), false);
  assert.equal(keeper().keep({ ...folk, place: undefined }, { ...goods, cause: 'band' }), false);
  const off = setup({ guarded: false });
  assert.equal(off.keeper().keep(folk, { ...goods, cause: 'band' }), false);
  const unloaded = setup();
  unloaded.skill.futureRaw = '{}';
  assert.equal(unloaded.keeper().keep(folk, { ...goods, cause: 'band' }), false);
});

test('past the cap the oldest unguarded cairn goes to the bank as far as it has room, its purse to yours', () => {
  const { keeper, skill } = setup();
  skill.record.cairns = Array.from({ length: C.CAIRNS_MAX }, (_, i) => C.makeCairn({
    folkId: `f${i}`, name: `F${i}`, hex: { q: 0, r: 0 }, at: i + 1, cause: 'hunger',
    gear: i === 0 ? [{ itemId: 'mod:Full', qty: 2 }, { itemId: 'mod:Gone', qty: 1 }, { itemId: 'mod:Fine', qty: 3 }] : [{ itemId: 'mod:Fine', qty: 1 }],
    purse: i === 0 ? [{ currencyId: 'melvorD:GP', amount: 9 }, { currencyId: 'melvorD:SlayerCoins', amount: 4 }] : [],
  }));
  banked.length = 0; paid.length = 0; notes.length = 0;
  assert.equal(keeper().keep(folk, { ...goods, cause: 'hunger' }), true);
  assert.equal(skill.record.cairns.length, C.CAIRNS_MAX);
  assert.equal(skill.record.cairns.some((c) => c.folk === 'f0'), false);
  assert.deepEqual(banked, [['mod:Full', 2], ['mod:Fine', 3]]);
  assert.deepEqual(paid, [['gp', 9], ['melvorD:SlayerCoins', 4]]);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /^MOD_VOY_CAIRN_BANKED_LOST /, 'two stacks found no room');
});

const cairnAt = (over = {}) => C.makeCairn({ folkId: 'worker_folks:F1', name: 'Rolf', hex: { q: 3, r: 4 }, at: 100, cause: 'hunger', ...over });

test('collecting: a cairn on your hex or the next one has a row; the bank takes what fits, the rest stays, unguarded', () => {
  const { out, skill } = setup({ pos: { q: 4, r: 4 } });
  skill.record.cairns = [
    cairnAt({ gear: [{ itemId: 'mod:Fine', qty: 3 }, { itemId: 'mod:Full', qty: 2 }], purse: [{ currencyId: 'melvorD:GP', amount: 70 }] }),
    cairnAt({ folkId: 'far', name: 'Far', hex: { q: 9, r: 9 }, gear: [{ itemId: 'mod:Fine', qty: 1 }] }),
  ];
  assert.deepEqual(out.near().map((c) => c.folk), ['worker_folks:F1'], 'one hex away is in reach, five is not');
  const html = out.panelHtml();
  assert.match(html, /data-cairn="worker_folks:F1@100"/);
  assert.doesNotMatch(html, /aria-disabled/);
  banked.length = 0; paid.length = 0; notes.length = 0;
  assert.equal(out.collect('worker_folks:F1@100'), true);
  assert.deepEqual(banked, [['mod:Fine', 3], ['mod:Full', 2]]);
  assert.deepEqual(paid, [['gp', 70]]);
  const left = skill.record.cairns.find((c) => c.folk === 'worker_folks:F1');
  assert.deepEqual(left.items, [{ id: 'mod:Full', qty: 2 }]);
  assert.deepEqual(left.purse, []);
  assert.match(notes[0], /^MOD_VOY_CAIRN_COLLECTED_PART /);
  assert.equal(out.collect('far@100'), false, 'out of reach');
});

test('Collect waits while you are under way or a band waits; a guarded cairn opens its fight and is yours only when beaten', () => {
  const { out, skill, state } = setup();
  skill.record.cairns = [cairnAt({ cause: 'band', guard: { band: 'highwaymen', ground: 'highlands', tier: 2 }, gear: [{ itemId: 'mod:Fine', qty: 1 }] })];
  state.clock.running = () => true;
  assert.equal(out.collectWhy(), 'moving');
  assert.match(out.panelHtml(), /aria-disabled="true" title="MOD_VOY_CAIRN_WHY_MOVING"/);
  assert.equal(out.collect('worker_folks:F1@100'), false);
  state.clock.running = () => false;
  assert.match(out.panelHtml(), /MOD_VOY_CAIRN_GUARD/);
  banked.length = 0;
  assert.equal(out.collect('worker_folks:F1@100'), true);
  assert.equal(state.fought, 'worker_folks:F1@100');
  assert.deepEqual(banked, [], 'nothing taken before the fight');
  out.guardDone('worker_folks:F1@100', false);
  assert.equal(skill.record.cairns[0].guard.band, 'highwaymen', 'a loss, a draw or Run leaves it guarded');
  out.guardDone('worker_folks:F1@100', true);
  assert.deepEqual(banked, [['mod:Fine', 1]]);
  assert.equal(skill.record.cairns.length, 0);
});

test('a courier killed on a packet leaves its cairn on the sea hex the packet had reached, not the port it boarded at', () => {
  const { keeper, skill, state } = setup({ killer: { band: 'pirates', ground: 'deepSea', tier: 3 } });
  state.couriers = { seaHexOf: (id) => (id === folk.id ? { q: 7, r: 8 } : undefined) };
  assert.equal(keeper().keep(folk, { ...goods, cause: 'band' }), true);
  assert.deepEqual([skill.record.cairns[0].q, skill.record.cairns[0].r], [7, 8]);
  state.couriers = { seaHexOf: () => undefined };
  assert.equal(keeper().keep({ ...folk, id: 'worker_folks:F2' }, { ...goods, cause: 'hunger' }), true);
  assert.deepEqual([skill.record.cairns[1].q, skill.record.cairns[1].r], [3, 4], 'ashore: where it stood');
});
