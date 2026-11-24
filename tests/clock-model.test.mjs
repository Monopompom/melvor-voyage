// The ship's clock (src/clock-model.mjs, phase 5a).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOW_KINDS as ADRIFT_TOWS } from '../src/adrift-model.mjs';
import { durationText } from '../src/clock-model.mjs';
import {
  TICK_MS, LAND_MS, SEA_MS, groundFactor, seaMs, stepMs, ticksOf, routeMs, durationParts, clockText, clockNow, gameClockSeed,
  cleanChoice, sameChoice, cleanChain, cleanVoyage, cleanEnding, cleanNameAt, ticksLeft, TOW_KINDS, TALLY_FIELDS, cleanTally, addTally, STORM_WAIT_STEP_MS, STORM_WAIT_MAX_MS, stormWaitMs,
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

test('the game clock starts where the game\'s own clock stands', () => {
  // Offline: the moment being replayed, so a careen stamped before the time away ends on time.
  assert.equal(gameClockSeed({ offline: true, info: { startTime: 1000, timeProcessed: 500 }, lastTick: 800, now: 9999 }), 1500);
  // Online: the last tick the save saw (the catch-up still to run starts there), else now.
  assert.equal(gameClockSeed({ offline: false, info: undefined, lastTick: 800, now: 9999 }), 800);
  for (const lastTick of [undefined, 0, -1, NaN, 20000]) assert.equal(gameClockSeed({ offline: false, lastTick, now: 9999 }), 9999);
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

test('a worn hull: the sailed steps of its vessel take longer, land and the other vessel as before', () => {
  const slowOf = (kind) => (kind === 'ship' ? 1.25 : 1);
  const hullOf = (kind) => (kind === 'ship' ? 'brig' : 'dinghy');
  assert.equal(stepMs({ sea: true, vessel: 'ship' }, { hullOf, slowOf }), Math.round(SEA_MS.brig * 1.25));
  assert.equal(stepMs({ sea: true, vessel: 'boat' }, { hullOf, slowOf }), SEA_MS.dinghy);
  assert.equal(stepMs({ fastTravel: true, hop: 4, vessel: 'ship' }, { hullOf, slowOf }), Math.round(4 * SEA_MS.brig * 1.25));
  assert.equal(stepMs({ cls: 'grasslands' }, { hullOf, slowOf }), LAND_MS);
  const walk = [{ q: 0, r: 0 }, { q: 1, r: 0 }];
  assert.deepEqual(cleanVoyage({ walk, worn: ['ship', 'ship', 'x'] }).worn, ['ship']);
  assert.deepEqual(cleanVoyage({ walk }).worn, []);
});

test('waiting out a storm: the first set-off whose route meets no storm, only when the route now meets one', () => {
  const clearFrom = (ms) => (w) => (w >= ms ? 0 : 2);
  assert.equal(stormWaitMs(2, clearFrom(25 * MIN)), 30 * MIN, 'tried every step, the first clear one');
  assert.equal(stormWaitMs(2, clearFrom(0)), STORM_WAIT_STEP_MS, 'never a wait of nothing');
  assert.equal(stormWaitMs(2, clearFrom(STORM_WAIT_MAX_MS)), STORM_WAIT_MAX_MS, 'the last try counts');
  assert.equal(stormWaitMs(2, clearFrom(STORM_WAIT_MAX_MS + 1)), undefined, 'no clear set-off near enough');
  assert.equal(stormWaitMs(0, clearFrom(0)), undefined, 'no storm on the route, nothing to wait out');
  assert.equal(stormWaitMs(1, () => 1), undefined, 'one storm for another is no way out');
  assert.equal(stormWaitMs(3, undefined), undefined);
  const tried = [];
  stormWaitMs(1, (w) => { tried.push(w); return 1; });
  assert.equal(tried.length, STORM_WAIT_MAX_MS / STORM_WAIT_STEP_MS);
});

test('a voyage tally: zeros to start, adds only figures above 0, kept on the voyage record', async () => {
  const { RECEIPT_FIELDS } = await import('../src/voyage-model.mjs');
  assert.deepEqual(TALLY_FIELDS, RECEIPT_FIELDS, 'the tally files as a receipt');
  const zero = cleanTally(undefined);
  for (const k of TALLY_FIELDS) assert.equal(zero[k], 0);
  let t = addTally(zero, { gp: 10, fuel: 0.1, food: -5, junk: 3 });
  t = addTally(t, { fuel: 0.2, wear: 2 });
  assert.equal(addTally(zero, { fuel: 0.0004 }).fuel, 0, 'below a thousandth: nothing');
  assert.equal(addTally(zero, { fuel: 0.6315 }).fuel, 0.632);
  assert.equal(t.gp, 10);
  assert.equal(t.fuel, 0.3, 'hundredths kept without float drift');
  assert.equal(t.food, 0);
  assert.equal(t.junk, undefined);
  const walk = [{ q: 0, r: 0 }, { q: 1, r: 0 }];
  const v = cleanVoyage({ walk, cx: 120, rc: { ...t, bad: 1 } });
  assert.equal(v.cx, 120);
  assert.deepEqual(v.rc, t);
  assert.deepEqual(cleanVoyage({ walk }).rc, zero, 'an older voyage starts its tally at none');
});

test('a voyage tally from an older or damaged record: zeros, never NaN', () => {
  const walk = [{ q: 0, r: 0 }, { q: 1, r: 0 }];
  const v = cleanVoyage({ walk, cx: NaN, rc: { gp: NaN, food: Infinity, fuel: '2', wear: -3 } });
  assert.equal(v.cx, -1, 'no departure figure: no Cartography XP claimed');
  assert.equal(cleanVoyage({ walk, cx: 0 }).cx, 0, 'a character at 0 Cartography XP still counts its surveys');
  for (const k of TALLY_FIELDS) assert.equal(v.rc[k], 0, k);
  assert.deepEqual(addTally(null, null), cleanTally({}));
  assert.equal(addTally({ gp: 5 }, { gp: NaN }).gp, 5);
});

test('Pilotage cuts a land or sea step by its own factor, never a hop', () => {
  assert.equal(stepMs({ cls: 'grasslands', pilot: 0.9 }), Math.round(LAND_MS * 0.9));
  assert.equal(stepMs({ sea: true, pilot: 0.98 }), Math.round(seaMs(undefined) * 0.98));
  assert.equal(stepMs({ fastTravel: true, hop: 3, pilot: 0.9 }), 3 * seaMs(undefined));
  assert.equal(stepMs({ cls: 'grasslands', pilot: 1.5 }), LAND_MS, 'never slower');
  assert.equal(stepMs({ cls: 'grasslands', pilot: 0 }), LAND_MS);
});

test('one step by stepTicksAt is what routeTicks gives it, wind and storm counted', async () => {
  const C = await import('../src/clock-model.mjs');
  const opts = { hullOf: () => 'brig' };
  const wind = (s, at) => (at < 200000 ? 0.7 : 1.4);
  const storm = (s, at) => (at > 300000 ? { x: 1.5, push: true } : undefined);
  const steps = [{ sea: true, vessel: 'ship' }, { sea: true, vessel: 'ship' }, { sea: false, cls: 'grasslands' }];
  const whole = C.routeTicks(steps, opts, 0, wind, storm);
  let at = 0;
  steps.forEach((s, i) => {
    const n = C.stepTicksAt(s, opts, at, wind, storm, i);
    assert.equal(n, whole[i]);
    at += n * C.TICK_MS;
  });
});
test('the fastest hex is a floor under every step', async () => {
  const C = await import('../src/clock-model.mjs');
  const opts = { hullOf: () => 'galleon', mountSpeed: 2, pace: 0.9 };
  const floor = C.fastestHexMs(['dinghy', 'galleon'], opts);
  const sea = C.stepMs({ sea: true, vessel: 'ship', pilot: 0.9 }, opts) * 0.7;
  const land = C.stepMs({ sea: false, cls: 'grasslands', pilot: 0.9 }, opts);
  assert.ok(floor <= sea && floor <= land);
  assert.equal(C.fastestHexMs([undefined, undefined], { mountSpeed: 1 }), C.LAND_MS * 0.9);
});

test('a compact duration turns to days only from 100 hours, and a broken time reads a minute', () => {
  const H = 60 * 60000;
  assert.deepEqual(durationText(5 * 60000), { key: 'MOD_VOY_CLOCK_M', vars: { m: '5' } });
  assert.deepEqual(durationText(72 * H), { key: 'MOD_VOY_CLOCK_H_M', vars: { h: '72', m: '0' } });
  assert.deepEqual(durationText(99 * H + 59 * 60000), { key: 'MOD_VOY_CLOCK_H_M', vars: { h: '99', m: '59' } });
  assert.deepEqual(durationText(100 * H), { key: 'MOD_VOY_CLOCK_D_H', vars: { d: '4', h: '4' } });
  assert.deepEqual(durationText(24000 * H, (n) => n.toLocaleString('en-US')), { key: 'MOD_VOY_CLOCK_D_H', vars: { d: '1,000', h: '0' } });
  for (const bad of [NaN, Infinity, -5, undefined]) assert.deepEqual(durationText(bad), { key: 'MOD_VOY_CLOCK_M', vars: { m: '1' } });
});

test('nameAt (build .703): a voyage and its ending keep the hex their name belongs to; junk or none, no field', () => {
  const walk = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: -1 }];
  assert.deepEqual(cleanVoyage({ walk, name: 'Port', nameAt: { q: 2, r: -1, z: 9 } }).nameAt, { q: 2, r: -1 });
  assert.equal('nameAt' in cleanVoyage({ walk, name: 'Willow Tree' }), false, "the planner's pick: text only");
  assert.deepEqual(cleanEnding({ name: 'Port', nameAt: { q: 2, r: -1 } }).nameAt, { q: 2, r: -1 });
  assert.equal('nameAt' in cleanEnding({ name: 'Port' }), false);
  for (const junk of [undefined, null, 'x', [1, 2], { q: 1 }, { q: 0.5, r: 1 }, { q: 1, r: NaN }]) {
    assert.equal(cleanNameAt(junk), undefined);
    assert.equal('nameAt' in cleanVoyage({ walk, name: 'Port', nameAt: junk }), false);
    assert.equal('nameAt' in cleanEnding({ name: 'Port', nameAt: junk }), false);
  }
});
