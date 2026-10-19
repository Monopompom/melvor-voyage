// The ship's clock (src/clock-model.mjs, phase 5a).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOW_KINDS as ADRIFT_TOWS } from '../src/adrift-model.mjs';
import {
  TICK_MS, LAND_MS, SEA_MS, groundFactor, seaMs, stepMs, ticksOf, routeMs, durationParts, clockText, clockNow,
  cleanChoice, sameChoice, cleanChain, cleanVoyage, cleanEnding, ticksLeft, TOW_KINDS,
} from '../src/clock-model.mjs';

const MIN = 60000;

test('the canvas times: land 6 min on easy ground, x1.5 rough, x2 snow and lava', () => {
  assert.equal(LAND_MS, 6 * MIN);
  assert.equal(stepMs({ cls: 'grasslands' }), 6 * MIN);
  assert.equal(stepMs({ cls: 'forest' }), 6 * MIN);
  assert.equal(stepMs({ cls: 'mountain' }), 9 * MIN);
  assert.equal(stepMs({ cls: 'desert' }), 9 * MIN, 'desert is rough, as the fuel classes have it');
  assert.equal(stepMs({ cls: 'snowlands' }), 12 * MIN);
  assert.equal(stepMs({ cls: 'lavalands' }), 12 * MIN);
  assert.equal(groundFactor(undefined), 1);
});

test('mounts divide land time; a bad speed counts as on foot', () => {
  assert.equal(stepMs({ cls: 'grasslands' }, { mountSpeed: 2 }), 3 * MIN);
  assert.equal(stepMs({ cls: 'snowlands' }, { mountSpeed: 3 }), 4 * MIN);
  assert.equal(stepMs({ cls: 'grasslands' }, { mountSpeed: 0 }), 6 * MIN);
  assert.equal(stepMs({ cls: 'grasslands' }, { mountSpeed: NaN }), 6 * MIN);
});

test('sea hexes by hull; shoals as open sea; mounts do not speed ships', () => {
  assert.deepEqual(SEA_MS, { dinghy: 5 * MIN, longboat: 4 * MIN, brig: 3 * MIN, galleon: 2 * MIN });
  const hullOf = (k) => (k === 'ship' ? 'galleon' : 'longboat');
  assert.equal(stepMs({ sea: true, cls: 'water', vessel: 'boat' }, { hullOf, mountSpeed: 3 }), 4 * MIN);
  assert.equal(stepMs({ sea: true, cls: 'water', vessel: 'ship' }, { hullOf }), 2 * MIN);
  assert.equal(stepMs({ cls: 'shoal' }, { hullOf }), 4 * MIN, 'a shoal step without the sea flag still sails');
  assert.equal(seaMs(undefined), 5 * MIN, 'no hull: the dinghy');
  assert.equal(seaMs('raft'), 5 * MIN);
});

test('a port hop takes its straight-line hexes at the vessel speed', () => {
  const hullOf = () => 'brig';
  assert.equal(stepMs({ fastTravel: true, hop: 7, vessel: 'ship' }, { hullOf }), 21 * MIN);
  assert.equal(stepMs({ fastTravel: true, hop: 0, dist: 4 }, { hullOf }), 12 * MIN, 'vanilla hop: its distance');
  assert.equal(stepMs({ fastTravel: true }, { hullOf }), 3 * MIN, 'no distance: one hex');
});

test('ticks, route time, durations and the hex clock', () => {
  assert.equal(TICK_MS, 50);
  assert.equal(ticksOf(6 * MIN), 7200);
  assert.equal(ticksOf(0), 1, 'at least one tick');
  assert.equal(routeMs([{ cls: 'grasslands' }, { cls: 'mountain' }]), 15 * MIN);
  assert.equal(routeMs(undefined), 0);
  assert.equal(stepMs(null), 0);
  assert.deepEqual(durationParts(0), { h: 0, m: 1 }, 'at least a minute');
  assert.deepEqual(durationParts(MIN + 1000), { h: 0, m: 2 }, 'rounded up');
  assert.deepEqual(durationParts(125 * MIN), { h: 2, m: 5 });
  assert.equal(clockText(0), '0:00');
  assert.equal(clockText(65_400), '1:06');
  assert.equal(clockText(-5), '0:00');
});

test('the clock reads the replayed moment offline, the wall clock online', () => {
  const info = { startTime: 1000, timeProcessed: 500 };
  assert.equal(clockNow({ offline: true, info, now: 9999 }), 1500);
  assert.equal(clockNow({ offline: false, info, now: 9999 }), 9999);
  assert.equal(clockNow({ offline: true, info: undefined, now: 9999 }), 9999);
  assert.equal(clockNow({ offline: true, info: { startTime: 0, timeProcessed: 5 }, now: 9999 }), 9999);
});

test('arrival choices are cleaned, deduplicated and capped at three', () => {
  assert.deepEqual(cleanChoice({ k: 'skill', skill: 'melvorD:Mining', action: 'melvorD:Copper', x: 1 }), { k: 'skill', skill: 'melvorD:Mining', action: 'melvorD:Copper' });
  assert.equal(cleanChoice({ k: 'skill', skill: 'melvorD:Mining' }), undefined, 'a skill choice names its action');
  assert.equal(cleanChoice({ k: 'swim' }), undefined);
  assert.equal(cleanChoice(null), undefined);
  assert.deepEqual(cleanChoice({ k: 'dungeon', area: 'melvorD:Chicken_Coop' }), { k: 'dungeon', area: 'melvorD:Chicken_Coop' });
  assert.deepEqual(cleanChoice({ k: 'resume', skill: 'melvorD:Smithing' }), { k: 'resume', skill: 'melvorD:Smithing' });
  assert.deepEqual(cleanChoice({ k: 'resume', area: 'a', monster: 'm', skill: 's' }), { k: 'resume', area: 'a', monster: 'm' });
  assert.equal(cleanChoice({ k: 'resume' }), undefined);
  const a = { k: 'fight', area: 'a', monster: 'm' };
  assert.ok(sameChoice(a, { ...a, extra: 2 }));
  assert.ok(!sameChoice(a, null));
  const chain = cleanChain([a, a, { k: 'nope' }, { k: 'dungeon', area: 'd' }, { k: 'resume', skill: 's' }, { k: 'dungeon', area: 'e' }]);
  assert.deepEqual(chain.map((c) => c.k), ['fight', 'dungeon', 'resume']);
  assert.deepEqual(cleanChain('x'), []);
});

test('a voyage record: kept when sound, null when not', () => {
  const walk = [{ q: 0, r: 0 }, { q: 1, r: 0, m: { k: 'boat' } }, { q: 2, r: 0 }];
  const v = cleanVoyage({ walk, at: 1, left: 30, total: 100, name: 'Port', chain: [{ k: 'dungeon', area: 'd' }], loads: [1, 0, 5, 'x'], began: 7, xp: 3, gp: 9 });
  assert.equal(v.at, 1);
  assert.equal(v.left, 30);
  assert.deepEqual(v.walk[1], { q: 1, r: 0, m: { k: 'boat' } });
  assert.deepEqual(v.loads, [1], 'only inner or last indexes');
  assert.equal(cleanVoyage({ walk: [{ q: 0, r: 0 }] }), null, 'one hex is no voyage');
  assert.equal(cleanVoyage({ walk, at: 2 }), null, 'standing on the last hex: arrived');
  assert.equal(cleanVoyage({ walk: [{ q: 0, r: 0 }, { q: 'a', r: 0 }] }), null);
  assert.equal(cleanVoyage(null), null);
  const d = cleanVoyage({ walk });
  assert.deepEqual([d.at, d.left, d.total, d.name, d.chain, d.began], [0, 1, 1, '', [], 0]);
});

test('a fog voyage keeps its survey queue and side width', () => {
  const walk = [{ q: 0, r: 0 }, { q: 1, r: 0 }];
  const v = cleanVoyage({ walk, fog: true, side: 9, sv: [{ q: 1, r: 0 }, { q: 'x', r: 0 }, null], spent: 12, of: 100 });
  assert.equal(v.fog, true);
  assert.equal(v.side, 0, 'an unknown width reads as none');
  assert.deepEqual(v.sv, [{ q: 1, r: 0 }]);
  assert.deepEqual([v.spent, v.of], [12, 100]);
  const k = cleanVoyage({ walk, sv: [{ q: 1, r: 0 }], left: 7 });
  assert.equal(k.fog, undefined, 'a known route has no fog fields');
  assert.equal(k.sv, undefined);
  assert.equal(k.of, 7, 'the timer in progress defaults to what is left');
});

test('an ending is cleaned; unknown ways read as arrived', () => {
  const e = cleanEnding({ name: 'Port', hexes: 3, ms: 5, xp: 12.7, at: 99, how: 'stopped', started: 'Mining', failed: [{ name: 'a', why: 'b' }, null, 1, {}, {}, {}] });
  assert.equal(e.how, 'stopped');
  assert.equal(e.xp, 12);
  assert.equal(e.failed.length, 3);
  assert.equal(e.seen, false);
  assert.equal(cleanEnding({ how: 'sank' }).how, 'arrived');
  assert.equal(cleanEnding(undefined), null);
  assert.equal(cleanEnding({ closed: true }).closed, true);
});

test('an ending keeps why it was refused and whether the arrival had a plan', () => {
  const e = cleanEnding({ how: 'refused', why: '(3, 4) needs Cartography 50 to survey', asked: false });
  assert.equal(e.why, '(3, 4) needs Cartography 50 to survey');
  assert.equal(e.asked, false);
  // Old endings: the GP refusal and "something was asked", as they read before.
  assert.equal(cleanEnding({ how: 'refused' }).why, '');
  assert.equal(cleanEnding({ how: 'arrived' }).asked, true);
});

test('ticks left: the step in progress and the steps after it', () => {
  const v = { walk: [{}, {}, {}, {}], at: 1, left: 5 };
  assert.equal(ticksLeft(v, [100, 200, 300]), 305);
  assert.equal(ticksLeft({ ...v, at: 2 }, [100, 200, 300]), 5);
  assert.equal(ticksLeft(null, []), 0);
});

test('a tow (5b part two): kept on the voyage, junk dropped; the adrift ending and the tow kind on an ending', () => {
  assert.deepEqual(TOW_KINDS, ADRIFT_TOWS, 'the same kinds as adrift-model');
  const walk = [{ q: 0, r: 0 }, { q: 1, r: 0 }];
  assert.deepEqual(cleanVoyage({ walk, tow: { kind: 'bottle', port: 'BustlingPort', find: true, gp: 0 } }).tow, { kind: 'bottle', port: 'BustlingPort', find: true, gp: 0 });
  assert.deepEqual(cleanVoyage({ walk, tow: { kind: 'pay', port: 'X', gp: 12.6 } }).tow, { kind: 'pay', port: 'X', find: false, gp: 12 });
  assert.equal(cleanVoyage({ walk, tow: { kind: 'kraken' } }).tow, undefined, 'the kraken does not tow');
  assert.equal('tow' in cleanVoyage({ walk }), false);
  assert.equal(cleanEnding({ how: 'adrift', why: 'food' }).how, 'adrift');
  assert.equal(cleanEnding({ how: 'arrived', tow: 'pushy' }).tow, 'pushy');
  assert.equal(cleanEnding({ how: 'arrived', tow: 'whale' }).tow, '');
});
