import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PER_CONTAINER, FLOOR, NO_CARGO, MAX_LOADS, SALE_SHARE, REPEAT, portsOf, laneDistances, regions, rng, weighted, requestSize, sizeShare, SIZE_LEVEL, SIZE_MIN, payPer, makeRequest, makeBoard,
  damped, groupOfItem, byTrade, NEW_LEAN, THIN, thinShare, GLUT, RECENT, RECENT_SEASONS, FLOOR_SHARE, weigh, postSeason, recentGoods, noteSent,
  seasonOf, SEASON_MS, portOpen, portsNear, takeRun, loadable, load, inHold, deliver, sellOff, finished, cleanCargo, isCargo,
  DUE_SHARE, plainTripMs, plainTripMsOf, dueAt, isLate, latePer, GP_PER_HEX, GOODS_PAY,
} from '../src/cargo-model.mjs';

const table = JSON.parse(readFileSync(new URL('../data/hex_terrain.json', import.meta.url), 'utf8'));
const hexes = table.hexes;
const lanes = laneDistances(hexes);
const regionMap = regions(hexes);
const goods = [
  { id: 'melvorD:Ash', weight: 2, soft: true, price: 1 },
  { id: 'melvorD:Iron_Bar', weight: 2, soft: false, price: 12 },
  { id: 'melvorD:Raw_Shrimp', weight: 1, soft: false, price: 1 },
];

test('every port has a lane to most others, and some are at least the floor away', () => {
  const ports = portsOf(hexes);
  assert.equal(ports.length, 15);
  // Moonlit Pier is inland (no sea hex next to it): no lane, so no cargo there.
  assert.deepEqual(lanes.MoonlitPier, {});
  for (const p of ports.filter((x) => x.poi !== 'MoonlitPier')) {
    const far = Object.values(lanes[p.poi]).filter((d) => d >= FLOOR);
    assert.equal(Object.keys(lanes[p.poi]).length, 13, `${p.poi} reaches few ports`);
    assert.ok(far.length > 0, `${p.poi} has no port ${FLOOR}+ hexes away`);
  }
  // Lanes are symmetric.
  for (const [a, row] of Object.entries(lanes)) for (const [b, d] of Object.entries(row)) assert.equal(lanes[b][a], d);
});

test('regions: dungeons within 6 hexes, nearest first (the user, 18 Oct 2026)', () => {
  assert.equal(regionMap.BeginningPort[0], 'ChickenCoop');
  assert.ok(regionMap.FrostDriftPort.includes('FrozenCove'));
  assert.ok(regionMap.WhisperingPort.includes('CultGrounds'));
  const cleared = (n) => (n === 'ChickenCoop' ? 1 : 0);
  assert.equal(portOpen('BeginningPort', regionMap, cleared), true);
  assert.equal(portOpen('FrostDriftPort', regionMap, cleared), false);
  assert.deepEqual(portsNear('BanditBase', regionMap), ['MulticulturalPort', 'PortOfNations', 'ShadowedPort', 'VibrantPort']);
});

test('request sizes run 1 to 3 holds, most fit one load', () => {
  const r = rng(7);
  const sizes = Array.from({ length: 4000 }, () => requestSize(6, r));
  assert.equal(Math.min(...sizes), 1);
  assert.ok(Math.max(...sizes) <= MAX_LOADS * 6);
  const fit = sizes.filter((n) => n <= 6).length / sizes.length;
  assert.ok(fit > 0.6 && fit < 0.8, `fit ${fit}`);
});

test('request sizes grow with your level in the trade', () => {
  assert.equal(sizeShare(1), SIZE_MIN);
  assert.equal(sizeShare(SIZE_LEVEL / 2), 0.5);
  assert.equal(sizeShare(99), 1);
  assert.equal(sizeShare(undefined), 1);
  // Two holds (24 slots): a level-1 trade asks at most 12, most of its requests 3 or under; a master up to 72.
  const r = rng(11);
  const low = Array.from({ length: 4000 }, () => requestSize(24, r, sizeShare(1)));
  assert.ok(Math.max(...low) <= 1 + MAX_LOADS * 24 * SIZE_MIN);
  assert.ok(low.filter((n) => n <= 3).length / low.length > 0.6);
  const high = Array.from({ length: 4000 }, () => requestSize(24, r, sizeShare(80)));
  assert.ok(Math.max(...high) > 50);
});

test('weighted picks follow the weights', () => {
  const r = rng(3);
  const n = { a: 0, b: 0 };
  for (let i = 0; i < 6000; i++) n[weighted([{ id: 'a', weight: 2 }, { id: 'b', weight: 1 }], r).id]++;
  assert.ok(n.a / n.b > 1.8 && n.a / n.b < 2.2);
  assert.equal(weighted([], r), undefined);
});

test('pay: goods at twice their price plus the run', () => {
  assert.deepEqual(payPer(12, 14), { gp: PER_CONTAINER * 12 * 2 + 120 * 14, xp: 25 * 14 });
});

test('a request goes to a port at least the floor away, soft goods in sacks', () => {
  const r = rng(11);
  for (let i = 0; i < 200; i++) {
    const q = makeRequest('BeginningPort', goods, lanes, 6, r, `x${i}`);
    assert.ok(q.hexes >= FLOOR && lanes.BeginningPort[q.to] === q.hexes);
    assert.equal(q.c, q.item === 'melvorD:Ash' ? 'sack' : 'crate');
  }
  assert.equal(makeRequest('BeginningPort', [], lanes, 6, r, 'y'), undefined);
  // The Fake Port only looks like a port: it never posts or takes cargo.
  for (let i = 0; i < 300; i++) assert.ok(!NO_CARGO.includes(makeRequest('MistyPort', goods, lanes, 6, r, `f${i}`).to));
  assert.equal(makeRequest('FakePort', goods, lanes, 6, r, 'z'), undefined);
});

test('boards: 4 to 6 requests, the same for the same season and seed', () => {
  const a = makeBoard('FrostDriftPort', 100, goods, lanes, 6, 'char1');
  const b = makeBoard('FrostDriftPort', 100, goods, lanes, 6, 'char1');
  const c = makeBoard('FrostDriftPort', 101, goods, lanes, 6, 'char1');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(a.length >= 4 && a.length <= 6);
  assert.equal(seasonOf(SEASON_MS * 5 + 1), 5);
});

test('a trade already on the board comes again, but seldom', () => {
  const list = [{ id: 'bar', g: 'smith', weight: 2 }, { id: 'sword', g: 'smith', weight: 2 }, { id: 'fish', g: 'cook', weight: 1 }, { id: 'ash', weight: 2 }];
  assert.deepEqual(damped(list, ['smith']).map((c) => c.weight), [2 * REPEAT, 2 * REPEAT, 1, 2]);
  assert.deepEqual(damped(list, ['smith', 'smith', 'ash']).map((c) => c.weight), [2 * REPEAT ** 2, 2 * REPEAT ** 2, 1, 2 * REPEAT]);
  assert.equal(damped(list, []), list);
  assert.equal(groupOfItem(list, 'sword'), 'smith');
  assert.equal(groupOfItem(list, 'ash'), 'ash'); // no group: the item is its own
});

test('each trade weighs as a whole, however many goods it makes', () => {
  const list = [{ id: 'bar', g: 'smith', weight: 2 }, { id: 'sword', g: 'smith', weight: 2 }, { id: 'helm', g: 'smith', weight: 2 },
    { id: 'fish', g: 'cook', weight: 1 }, { id: 'pie', g: 'cook', weight: 1 }, { id: 'stew', g: 'cook', weight: 1 }, { id: 'cake', g: 'cook', weight: 1 }];
  const w = byTrade(list).map((c) => c.weight);
  assert.ok(Math.abs(w[0] + w[1] + w[2] - 2) < 1e-9);
  assert.ok(Math.abs(w[3] + w[4] + w[5] + w[6] - 1) < 1e-9);
  // A mid-game table where smithing makes the most goods (40 of 135): it posts no more than crafting, farming or
  // firemaking, and one trade almost never takes three places on a board (about 1 board in 3 did before .200).
  const table = { s: [40, 2], craft: [20, 2], farm: [12, 2], fire: [2, 2], cook: [15, 1], fletch: [15, 1], herb: [10, 1], wood: [5, 1], mine: [6, 1], fish: [8, 1], dust: [2, 1] };
  const many = byTrade(Object.entries(table).flatMap(([g, [n, weight]]) => Array.from({ length: n }, (_, i) => ({ id: `${g}:${i}`, g, weight, price: 10 }))));
  const big = { BeginningPort: lanes.BeginningPort };
  let crowded = 0;
  let smith = 0;
  let all = 0;
  for (let s = 0; s < 500; s++) {
    const reqs = makeBoard('BeginningPort', s, many, big, 6, 'char1');
    const n = reqs.filter((q) => q.item.startsWith('s:')).length;
    if (n >= 3) crowded++;
    smith += n;
    all += reqs.length;
  }
  assert.ok(crowded < 500 * 0.03, `${crowded} of 500 boards had three or more smithing requests`);
  assert.ok(smith / all < 0.2, `smithing took ${Math.round((100 * smith) / all)}% of requests`);
});

test('goods never had come up more within their trade, the trade weighing the same', () => {
  const list = [{ id: 'bar', g: 'smith', weight: 2 }, { id: 'helm', g: 'smith', weight: 2, lean: NEW_LEAN }, { id: 'axe', g: 'smith', weight: 2 }];
  const w = byTrade(list).map((c) => c.weight);
  assert.ok(Math.abs(w[1] - w[0] * NEW_LEAN) < 1e-9);
  assert.ok(Math.abs(w[0] + w[1] + w[2] - 2) < 1e-9);
});

test('a thin trade counts for less: a third with one good, two thirds with two, full from three', () => {
  assert.deepEqual([0, 1, 2, 3, 9].map(thinShare), [1 / THIN, 1 / THIN, 2 / THIN, 1, 1]);
  // Crafting (counted twice) with its one level-1 good against a three-good trade: no longer twice as likely.
  const list = [{ id: 'gloves', g: 'craft', weight: 2 }, { id: 'a', g: 'mine', weight: 1 }, { id: 'b', g: 'mine', weight: 1 }, { id: 'c', g: 'mine', weight: 1 }];
  const w = byTrade(list).map((c) => c.weight);
  assert.ok(Math.abs(w[0] - 2 / 3) < 1e-9);
  assert.ok(Math.abs(w[1] + w[2] + w[3] - 1) < 1e-9);
});

test('the season glut and goods delivered lately weigh less, never below the floor', () => {
  const list = [{ id: 'gloves', g: 'craft', weight: 1 }, { id: 'bar', g: 'smith', weight: 1 }];
  assert.equal(weigh(list), list);
  assert.deepEqual(weigh(list, { season: ['gloves'] }).map((c) => c.weight), [GLUT, 1]);
  assert.deepEqual(weigh(list, { season: ['gloves', 'gloves'] }).map((c) => c.weight), [GLUT ** 2, 1]);
  assert.deepEqual(weigh(list, { recent: ['bar'] }).map((c) => c.weight), [1, RECENT]);
  // The cuts multiply: on this board (the trade), elsewhere this season (the good) and delivered lately.
  assert.equal(weigh(list, { board: ['craft'], season: ['gloves'], recent: ['gloves'] })[0].weight, REPEAT * GLUT * RECENT);
  // However often it was asked for, a good keeps FLOOR_SHARE of its weight.
  assert.equal(weigh(list, { season: Array(20).fill('gloves') })[0].weight, FLOOR_SHARE);
});

test('delivered goods are remembered for RECENT_SEASONS seasons', () => {
  let sent = noteSent({}, 'gloves', 10);
  sent = noteSent(sent, 'bar', 11);
  assert.deepEqual(recentGoods(sent, 10 + RECENT_SEASONS).sort(), ['bar', 'gloves']);
  assert.deepEqual(recentGoods(sent, 11 + RECENT_SEASONS), ['bar']);
  // Writing again forgets what is past remembering.
  assert.deepEqual(noteSent(sent, 'fish', 11 + RECENT_SEASONS), { bar: 11, fish: 11 + RECENT_SEASONS });
});

test('a season posts every open board together, the same whichever is looked at first', () => {
  const ports = ['FrostDriftPort', 'BeginningPort', 'MistyPort'];
  const a = postSeason(ports, 40, goods, lanes, 6, 'char1');
  const b = postSeason([...ports].reverse(), 40, goods, lanes, 6, 'char1');
  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a).sort(), [...ports].sort());
  // A board posted already (a restock) is kept, and its goods count against the rest.
  const kept = { MistyPort: a.MistyPort };
  const c = postSeason(ports, 40, goods, lanes, 6, 'char1', { boards: kept });
  assert.equal(c.MistyPort, undefined);
  assert.deepEqual(Object.keys(c).sort(), ['BeginningPort', 'FrostDriftPort']);
});

test('one good no longer fills the season: the four cuts together', () => {
  // A fresh character's table, about as the game gives it (build .204 in game: Leather Gloves 9 of 57 requests):
  // crafting, smithing, farming and firemaking count twice; each trade has one to three level-1 goods.
  const table = { craft: [1, 2], smith: [1, 2], farm: [2, 2], fire: [2, 2], fletch: [1, 1], cook: [1, 1], wood: [1, 1], mine: [3, 1], fish: [1, 1], rune: [2, 1], dust: [2, 1] };
  const fresh = byTrade(Object.entries(table).flatMap(([g, [n, weight]]) => Array.from({ length: n }, (_, i) => ({ id: `${g}:${i}`, g, weight, price: 10, soft: false }))));
  const ports = Object.keys(lanes).filter((p) => !NO_CARGO.includes(p));
  let gloves = 0;
  let all = 0;
  let worst = 0;
  for (let s = 0; s < 40; s++) {
    const season = Object.values(postSeason(ports, s, fresh, lanes, 6, 'char1')).flat();
    const n = season.filter((q) => q.item === 'craft:0').length;
    gloves += n;
    all += season.length;
    worst = Math.max(worst, n / season.length);
  }
  assert.ok(gloves / all < 0.1, `the lone crafting good took ${Math.round((100 * gloves) / all)}% of requests`);
  assert.ok(worst < 0.2, `one season gave it ${Math.round(100 * worst)}%`);
});

test('a run: load what fits, deliver, sell off', () => {
  const req = { id: 'q1', item: 'melvorD:Iron_Bar', c: 'crate', n: 5, to: 'PortOfNations', hexes: 14, gp: 3000, xp: 350 };
  const run = takeRun(req, 'BeginningPort');
  // 180 bars = 3 crates' worth, 4 empty crates, 2 free slots: 2.
  assert.equal(loadable(run, 180, 4, 2), 2);
  assert.equal(loadable(run, 40, 4, 2), 0);
  let hold = [{ id: 'melvorD:Oak_Logs', qty: 30 }];
  hold = load(hold, run, 2);
  assert.equal(inHold(hold, 'q1'), 2);
  assert.ok(isCargo(hold[1]) && !isCargo(hold[0]));
  const d = deliver(hold, run);
  assert.equal(d.k, 2);
  assert.equal(d.gp, 6000);
  assert.equal(d.xp, 700);
  assert.deepEqual(d.hold, [{ id: 'melvorD:Oak_Logs', qty: 30 }]);
  const s = sellOff(load(d.hold, run, 1), run);
  assert.equal(s.gp, Math.round(3000 * SALE_SHARE));
  assert.equal(finished({ ...run, done: 5 }), true);
});

test('the save cleaner keeps good boards and runs, drops the rest', () => {
  const c = cleanCargo({
    boards: { BeginningPort: { s: 4, reqs: [{ id: 'a', item: 'x:y', c: 'sack', n: 2, to: 'PortOfNations', hexes: 13, gp: 10, xp: 5 }, { id: 'b', c: 'barrel' }] }, Bad: { s: 'x' } },
    runs: [{ id: 'r', from: 'BeginningPort', item: 'x:y', c: 'crate', n: 3, to: 'P', hexes: 12, gp: 1, xp: 1, packed: 9, done: 1 }, { id: 'done', from: 'B', item: 'x:y', c: 'sack', n: 1, to: 'P', packed: 1, done: 1 }],
  });
  assert.deepEqual(Object.keys(c.boards), ['BeginningPort']);
  assert.equal(c.boards.BeginningPort.reqs.length, 1);
  assert.equal(c.runs.length, 1);
  assert.equal(c.runs[0].packed, 3);
  assert.deepEqual(cleanCargo(null), { boards: {}, runs: [], posted: -1, sent: {} });
  // The season posted and the goods delivered lately are kept; anything else in them is dropped.
  const d = cleanCargo({ posted: 7, sent: { 'x:y': 6, bad: 'no', '': 3 } });
  assert.equal(d.posted, 7);
  assert.deepEqual(d.sent, { 'x:y': 6 });
});

test('a run is due one and a half plain trips after it is taken; late, it pays the goods once and no XP', () => {
  const MIN = 60000;
  const req = { id: 'q2', item: 'melvorD:Iron_Bar', c: 'crate', n: 5, to: 'PortOfNations', hexes: 18, gp: 50 * 20 * GOODS_PAY + GP_PER_HEX * 18, xp: 450 };
  // One load: 18 hexes at 3 minutes; 13 crates in 6 slots: three loads there and two returns.
  assert.equal(plainTripMs(req, 6, 3 * MIN), 54 * MIN);
  assert.equal(plainTripMs({ ...req, n: 13 }, 6, 3 * MIN), 5 * 54 * MIN);
  assert.equal(dueAt(req, 6, 3 * MIN, 1000), 1000 + DUE_SHARE * 54 * MIN);
  assert.equal(dueAt(req, 6, undefined, 1000), 0, 'no pace (timed travel off): no deadline');
  // The real road between the ports (build .387): a crossing of 40 minutes along the coast, not 18 hexes at 3.
  assert.equal(plainTripMsOf(req, 6, 40 * MIN), 40 * MIN);
  assert.equal(plainTripMsOf({ ...req, n: 13 }, 6, 40 * MIN), 5 * 40 * MIN);
  assert.equal(dueAt(req, 6, 3 * MIN, 1000, 40 * MIN), 1000 + DUE_SHARE * 40 * MIN);
  assert.equal(dueAt(req, 6, 3 * MIN, 1000, undefined), 1000 + DUE_SHARE * 54 * MIN, 'no road known: the straight lane');
  assert.equal(dueAt(req, 6, undefined, 1000, 40 * MIN), 0, 'timed travel off: no deadline even with a road');
  const run = takeRun(req, 'BeginningPort', dueAt(req, 6, 3 * MIN, 0));
  assert.equal(isLate(run, run.due), false);
  assert.equal(isLate(run, run.due + 1), true);
  assert.equal(isLate({ ...run, due: 0 }, 1e15), false, 'an old run has none');
  assert.equal(latePer(run), 50 * 20);
  const hold = load([], run, 2);
  const ok = deliver(hold, run, run.due);
  assert.deepEqual([ok.gp, ok.xp, ok.late], [2 * req.gp, 900, false]);
  const late = deliver(hold, run, run.due + 1);
  assert.deepEqual([late.gp, late.xp, late.late, late.k], [2 * 1000, 0, true, 2]);
  assert.equal(cleanCargo({ runs: [{ ...run, due: 123.9 }] }).runs[0].due, 123);
  assert.equal(cleanCargo({ runs: [{ ...run, due: 'x' }] }).runs[0].due, 0);
});
