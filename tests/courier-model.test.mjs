import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COURIERS_MAX, STOPS_MAX, LOOK_MS, STANDING_MS, ROADS_KEPT, ROAD_MAX, keptReport, advance, afterStop, atLegEnd, cleanCourier, cleanCouriers, cleanStop, hexOf, nearestBank, newCourier, nextLive, retire,
  roadToStop, routeProblem, sameStop, startLeg, walkOn, addStop, moveStop, previewRoute, removeStop, stopsAt,
  PACKET_HEX_MS, packetFare, land, sail, crossingAt, crossingAhead, stretchSteps,
  routeOf, routeServes, couriersServing, carrierOf, inputStops, loadFull, INPUT_BANK_SHARE, capInputs,
  folkKey, depotKey, noteStop, roundTime, roundFare, routeParts, folkPart, faresPerHour, SHEET_SWIPE_MIN, sheetSwipe,
  BANK_HEAL, ROAD_HEAL, ROAD_HEAL_FOOD, bankHeal, roadHealHexes, roadHeal, stretchParts, stretchFits,
} from '../src/courier-model.mjs';
import { NEIGHBOURS, findRoadToAny } from '../src/walk-model.mjs';
import { SAVE_VERSION, defaultSave, loadSave, serializeSave } from '../src/voyage-model.mjs';

const bank = (q = 0, r = 0) => ({ kind: 'bank', q, r });
const folk = (id) => ({ kind: 'folk', id });
const depot = (key) => ({ kind: 'depot', key });
const dist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
const step = (q, r, ms = 100) => ({ q, r, cls: 'grasslands', ms });
const route = () => [bank(0, 0), folk('a'), depot('t'), folk('b')];

test('the route sheet folds on a swipe down and opens on a swipe up; a tap or a sideways move changes nothing', () => {
  assert.deepEqual(sheetSwipe(0, SHEET_SWIPE_MIN, false), { moved: true, folded: true });
  assert.deepEqual(sheetSwipe(3, -40, true), { moved: true, folded: false });
  assert.deepEqual(sheetSwipe(0, 40, true), { moved: true, folded: true });
  assert.deepEqual(sheetSwipe(2, 3, true), { moved: false, folded: true });
  assert.deepEqual(sheetSwipe(0, SHEET_SWIPE_MIN - 1, false), { moved: true, folded: false });
  assert.deepEqual(sheetSwipe(60, 30, false), { moved: true, folded: false });
});

test('a stop is a bank place, a Folk or a tent; anything else is refused', () => {
  assert.deepEqual(cleanStop({ kind: 'bank', q: 1, r: 2, extra: 1 }), bank(1, 2));
  assert.deepEqual(cleanStop({ kind: 'folk', id: 'a' }), folk('a'));
  assert.deepEqual(cleanStop({ kind: 'depot', key: 't' }), depot('t'));
  for (const bad of [null, 3, {}, { kind: 'bank', q: 1 }, { kind: 'folk', id: '' }, { kind: 'depot' }, { kind: 'port', q: 1, r: 1 }]) assert.equal(cleanStop(bad), undefined);
  assert.ok(sameStop(bank(1, 2), bank(1, 2)));
  assert.ok(!sameStop(bank(1, 2), bank(2, 1)));
  assert.ok(!sameStop(folk('a'), depot('a')));
});

test('a route needs two stops, a bank stop, and no stop twice in a row', () => {
  assert.equal(routeProblem(route()), undefined);
  assert.equal(routeProblem(undefined), 'few');
  assert.equal(routeProblem([bank()]), 'few');
  assert.equal(routeProblem([folk('a'), depot('t')]), 'noBank');
  assert.equal(routeProblem([bank(), folk('a'), folk('a')]), 'repeat');
  assert.equal(routeProblem([bank(), folk('a'), bank()]), 'repeat', 'the loop closes on the same stop');
  assert.equal(routeProblem([bank(), { kind: 'x' }]), 'unreadable');
  assert.equal(routeProblem([bank(), ...Array.from({ length: STOPS_MAX }, (_, i) => folk(`f${i}`))]), 'many');
});

test('a save keeps a courier as it was, and drops what it cannot read', () => {
  const c = { ...startLeg(newCourier(route(), { q: 0, r: 0 }), { q: 0, r: 0 }, [step(1, 0), step(2, 0)]), reached: 1, into: 40, next: 2, back: 1, pending: [bank(), folk('b')] };
  assert.deepEqual(cleanCourier(JSON.parse(JSON.stringify(c))), c);
  assert.equal(cleanCourier({ ...c, stops: [folk('a')] }), undefined);
  assert.equal(cleanCourier({ ...c, from: null }), undefined);
  assert.equal(cleanCourier({ ...c, road: [{ q: 1 }] }), undefined);
  const odd = cleanCourier({ ...c, next: 99, reached: 99, into: 99, back: 99, pending: [folk('x')], retired: 'yes' });
  assert.equal(odd.next, 0);
  assert.equal(odd.reached, 2);
  assert.equal(odd.into, 0);
  for (const k of ['back', 'pending', 'retired']) assert.ok(!(k in odd), k);
  assert.equal(cleanCourier({ ...c, into: 500 }).into, 99, 'never a whole hex');
});

test('the saved couriers: keyed by Folk, junk dropped, capped', () => {
  const c = newCourier(route(), { q: 0, r: 0 });
  assert.deepEqual(cleanCouriers({ a: c, b: { stops: [] } }), { a: c });
  for (const bad of [null, [], 3]) assert.deepEqual(cleanCouriers(bad), {});
  const many = Object.fromEntries(Array.from({ length: COURIERS_MAX + 5 }, (_, i) => [`f${i}`, c]));
  assert.equal(Object.keys(cleanCouriers(many)).length, COURIERS_MAX);
});

test('time on the road enters hexes in order, keeps the part-hex and hands back what is left at the end', () => {
  const c = startLeg(newCourier(route(), { q: 0, r: 0 }), { q: 0, r: 0 }, [step(1, 0, 100), step(2, 0, 200)]);
  const a = advance(c, 60);
  assert.deepEqual([a.courier.reached, a.courier.into, a.arrived, a.entered.length], [0, 60, false, 0]);
  assert.deepEqual(hexOf(a.courier), { q: 0, r: 0 });
  const b = advance(a.courier, 40);
  assert.deepEqual([b.courier.reached, b.courier.into, b.entered.length], [1, 0, 1]);
  assert.deepEqual(hexOf(b.courier), { q: 1, r: 0 });
  const d = advance(b.courier, 250);
  assert.deepEqual([d.courier.reached, d.arrived, d.spare], [2, true, 50]);
  assert.ok(atLegEnd(d.courier));
  assert.deepEqual(advance(d.courier, 30), { courier: d.courier, entered: [], arrived: false, spare: 30 }, 'nothing left to walk');
  assert.equal(advance(c, -5).courier.reached, 0);
  assert.equal(advance(c, NaN).courier.into, 0);
});

test('one big tick walks several hexes, as an offline catch-up does', () => {
  const c = startLeg(newCourier(route(), { q: 0, r: 0 }), { q: 0, r: 0 }, [step(1, 0), step(2, 0), step(3, 0)]);
  const out = advance(c, 1000);
  assert.deepEqual(out.entered.map((s) => s.q), [1, 2, 3]);
  assert.equal(out.spare, 700);
});

test('the next live stop goes round, and comes back to itself last', () => {
  const stops = route();
  assert.equal(nextLive(stops, 0), 1);
  assert.equal(nextLive(stops, 3), 0);
  assert.equal(nextLive(stops, -1), 0);
  assert.equal(nextLive(stops, 0, (s) => s.kind === 'depot'), 2);
  assert.equal(nextLive(stops, 2, (s) => s.kind === 'depot'), 2);
  assert.equal(nextLive(stops, 0, () => false), undefined);
});

test('the nearest bank stop, the first on a tie', () => {
  const stops = [bank(10, 0), folk('a'), bank(2, 0), bank(-2, 2)];
  assert.equal(nearestBank(stops, { q: 0, r: 0 }, dist), 2);
  assert.equal(nearestBank([folk('a')], { q: 0, r: 0 }, dist), undefined);
});

test('after a stop the courier takes the next one and starts its leg from where it stands', () => {
  const c = { ...startLeg(newCourier(route(), { q: 0, r: 0 }), { q: 0, r: 0 }, [step(1, 0)]), reached: 1, next: 1 };
  const out = afterStop(c, { distance: dist });
  assert.equal(out.next, 2);
  assert.deepEqual(out.from, { q: 1, r: 0 });
  assert.deepEqual([out.road.length, out.reached, out.into], [0, 0, 0]);
});

test('a stop that is away is skipped; a bank stop never is', () => {
  const c = { ...newCourier(route(), { q: 0, r: 0 }), next: 1 };
  assert.equal(afterStop(c, { distance: dist, isLive: (s) => s.kind !== 'depot' }).next, 3);
  assert.equal(afterStop(c, { distance: dist, isLive: () => false }).next, 0);
});

test('full before the last stop: home to the nearest bank, then back to the stop where it filled up', () => {
  const c = { ...newCourier(route(), { q: 5, r: 0 }), next: 2 };
  const home = afterStop(c, { full: true, distance: dist });
  assert.deepEqual([home.next, home.back], [0, 2]);
  const out = afterStop({ ...home, from: { q: 0, r: 0 } }, { distance: dist });
  assert.equal(out.next, 2);
  assert.ok(!('back' in out));
});

test('back at the bank, a stop it filled up at that has since gone is passed over', () => {
  const c = { ...newCourier(route(), { q: 0, r: 0 }), next: 0, back: 2 };
  assert.equal(afterStop(c, { distance: dist, isLive: (s) => s.kind !== 'depot' }).next, 3);
});

test('an edited route is taken up at a bank stop, never on the way', () => {
  const edit = [bank(0, 0), folk('z'), folk('y')];
  const out = afterStop({ ...newCourier(route(), { q: 0, r: 0 }), next: 1, pending: edit }, { distance: dist });
  assert.deepEqual(out.stops, route());
  assert.deepEqual(out.pending, edit);
  const taken = afterStop({ ...out, next: 0 }, { distance: dist });
  assert.deepEqual(taken.stops, edit);
  assert.equal(taken.next, 1, 'on from the same bank stop');
  assert.ok(!('pending' in taken));
  const moved = afterStop({ ...newCourier(route(), { q: 0, r: 0 }), next: 0, back: 2, pending: [bank(9, 9), folk('z')] }, { distance: dist });
  assert.equal(moved.next, 0, 'its bank stop is gone: from the top');
  assert.ok(!('back' in moved), 'the old stop index means nothing on the new route');
});

test('a deleted route: it makes for the nearest bank stop and stays there', () => {
  const c = { ...startLeg(newCourier([bank(9, 0), folk('a'), bank(2, 0)], { q: 4, r: 0 }), { q: 4, r: 0 }, [step(3, 0)]), reached: 1, next: 1, back: 1, pending: [bank(), folk('b')] };
  const out = retire(c, dist);
  assert.equal(out.retired, true);
  assert.equal(out.next, 2);
  assert.deepEqual(out.from, { q: 3, r: 0 });
  assert.deepEqual(out.road, []);
  for (const k of ['back', 'pending']) assert.ok(!(k in out), k);
  assert.equal(afterStop(out, { distance: dist }).next, 2, 'it goes nowhere after');
});

test('a road to a stop ends on land within a hex: a port on the water is reached from its shore', () => {
  const rows = ['.....~', '.....~', '.....~'];
  const ground = (q, r) => (rows[r]?.[q] === '.' ? 'grasslands' : undefined);
  let searches = 0;
  const findAny = (from, ends) => { searches += 1; return findRoadToAny(from, ends, ground); };
  const opts = { ground, findAny, distance: dist, neighbours: NEIGHBOURS };
  const road = roadToStop({ q: 0, r: 1 }, { q: 5, r: 1 }, opts);
  assert.equal(searches, 1, 'one search covers every shore hex');
  assert.equal(road.length, 4);
  assert.equal(dist(road.at(-1), { q: 5, r: 1 }), 1);
  assert.notEqual(ground(road.at(-1).q, road.at(-1).r), undefined);
  assert.deepEqual(roadToStop({ q: 4, r: 1 }, { q: 5, r: 1 }, opts), [], 'in reach already');
  assert.equal(roadToStop({ q: 0, r: 1 }, { q: 30, r: 1 }, opts), undefined, 'no road');
});

// A straight east-west line of land: every hex costs 100 ms.
const lineRoad = (from, to) => {
  const dir = Math.sign(to.q - from.q);
  const out = [];
  for (let q = from.q + dir; dir !== 0 && q !== to.q + dir; q += dir) out.push(step(q, 0));
  return out.slice(0, Math.max(0, out.length - 1));
};
const run = (c, ms, over = {}) => {
  const seen = [];
  const out = walkOn(c, ms, {
    stopHex: (s) => (s.kind === 'bank' ? s : s.kind === 'folk' ? over.at?.[s.id] : undefined),
    road: over.road ?? lineRoad,
    visit: (s) => { seen.push(s.kind === 'bank' ? 'bank' : s.id); return { full: over.full?.(s) === true }; },
    distance: dist,
  });
  return { ...out, seen };
};

test('along the route: it walks to within a hex of each stop and does it, in order', () => {
  const c = newCourier([bank(0, 0), folk('a')], { q: 0, r: 0 });
  const out = run(c, 400, { at: { a: { q: 5, r: 0 } } });
  assert.deepEqual(out.seen, ['bank', 'a']);
  assert.deepEqual(hexOf(out.courier), { q: 4, r: 0 });
  assert.equal(out.entered.length, 4);
  assert.equal(out.courier.next, 0);
});

test('short of time it stops on the road, and the next look carries on', () => {
  const c = newCourier([bank(0, 0), folk('a')], { q: 0, r: 0 });
  const first = run(c, 250, { at: { a: { q: 5, r: 0 } } });
  assert.deepEqual(first.seen, ['bank']);
  assert.deepEqual(hexOf(first.courier), { q: 2, r: 0 });
  assert.equal(first.courier.into, 50);
  const second = run(first.courier, 150, { at: { a: { q: 5, r: 0 } } });
  assert.deepEqual(second.seen, ['a']);
});

test('every stop within reach: one round, then it says it is standing', () => {
  const c = newCourier([bank(0, 0), folk('a'), folk('b')], { q: 0, r: 0 });
  const out = run(c, 5000, { at: { a: { q: 1, r: 0 }, b: { q: 0, r: 1 } } });
  assert.deepEqual(out.seen, ['bank', 'a', 'b'], 'each stop once a look');
  assert.equal(out.entered.length, 0);
  assert.equal(out.wait, 'standing');
  assert.equal(out.courier.next, 0, 'the bank stop comes next');
});

test('a round that walked a hex is no standing round, nor one cut short on the road', () => {
  const c = newCourier([bank(0, 0), folk('a')], { q: 0, r: 0 });
  const walked = run(c, 5000, { at: { a: { q: 2, r: 0 } } });
  assert.deepEqual(walked.seen, ['bank', 'a']);
  assert.equal(walked.entered.length, 1);
  assert.equal(walked.wait, '');
  const cut = run(c, 50, { at: { a: { q: 5, r: 0 } } });
  assert.deepEqual(cut.seen, ['bank']);
  assert.equal(cut.wait, '');
});

test('the standing wait is a minute: far longer than a look, far shorter than a room fills', () => {
  assert.equal(STANDING_MS, 60000);
  assert.ok(STANDING_MS >= STOPS_MAX * LOOK_MS, 'at least as many looks as a route may have stops');
});

test('all stops in reach: each is done once a look, never in an endless round', () => {
  const c = newCourier([bank(0, 0), folk('a')], { q: 0, r: 0 });
  const out = run(c, 1e9, { at: { a: { q: 1, r: 0 } } });
  assert.deepEqual(out.seen, ['bank', 'a']);
  assert.equal(out.entered.length, 0);
});

test('a Folk that is away is skipped until it stands again', () => {
  const c = { ...newCourier([bank(0, 0), folk('a'), folk('b')], { q: 0, r: 0 }), next: 1 };
  const out = run(c, 300, { at: { b: { q: 2, r: 0 } } });
  assert.deepEqual(out.seen.slice(0, 2), ['b', 'bank']);
});

test('a Folk that moved while it walked: a new road from where it stands', () => {
  const c = { ...startLeg(newCourier([bank(0, 0), folk('a')], { q: 0, r: 0 }), { q: 0, r: 0 }, [step(1, 0)]), next: 1 };
  const out = run(c, 300, { at: { a: { q: 4, r: 0 } } });
  assert.deepEqual(out.seen, ['a']);
  assert.deepEqual(out.entered.map((s) => s.q), [1, 2, 3]);
});

test('no road to any stop: it waits and says so', () => {
  const c = newCourier([bank(9, 0), bank(-9, 0)], { q: 0, r: 0 });
  const out = run(c, 500, { road: () => undefined });
  assert.equal(out.wait, 'noRoad');
  assert.deepEqual(out.seen, []);
});

test('full at a Folk: home to the bank stop, then back to that Folk', () => {
  const c = { ...newCourier([bank(0, 0), folk('a'), folk('b')], { q: 3, r: 0 }), next: 1 };
  const at = { a: { q: 3, r: 0 }, b: { q: 6, r: 0 } };
  const out = run(c, 200, { at, full: (s) => s.id === 'a' });
  assert.deepEqual(out.seen, ['a', 'bank']);
  assert.equal(out.courier.next, 1);
});

test('a deleted route: it unloads at the bank stop and is done', () => {
  const c = retire(newCourier([bank(2, 0), folk('a')], { q: 0, r: 0 }), dist);
  const out = run(c, 100, { at: { a: { q: 5, r: 0 } } });
  assert.deepEqual(out.seen, ['bank']);
  assert.equal(out.done, true);
});

test('save v33: no courier yet after the migration, and a route survives a reload', () => {
  const { save, report } = loadSave(JSON.stringify({ ...defaultSave(), v: 32, couriers: undefined }));
  assert.deepEqual(report.applied, [32, 33, 34]);
  assert.equal(save.v, SAVE_VERSION);
  assert.deepEqual(save.couriers, {});
  const c = newCourier(route(), { q: 1, r: 1 });
  const again = loadSave(serializeSave({ ...save, couriers: { a: c } })).save;
  assert.deepEqual(cleanCouriers(again.couriers), { a: c });
});

test('a tapped hex offers the Folks, the tent and the bank place on it', () => {
  const folks = [
    { id: 'a', travel: 'idle', place: { q: 1, r: 1 }, job: null },
    { id: 'me', travel: 'walking', place: { q: 1, r: 1 }, job: 'voyage:Courier' },
    { id: 'other', travel: 'walking', place: { q: 1, r: 1 }, job: 'voyage:Courier' },
    { id: 'gone', travel: 'walking', place: { q: 1, r: 1 }, job: null },
    { id: 'far', travel: 'idle', place: { q: 2, r: 1 }, job: null },
  ];
  const got = stopsAt({ q: 1, r: 1 }, { folks, tents: [{ key: 't', q: 1, r: 1 }, { key: 'x', q: 5, r: 5 }], isBank: () => true, self: 'me' });
  assert.deepEqual(got, [folk('a'), depot('t'), bank(1, 1)]);
  assert.deepEqual(stopsAt({ q: 9, r: 9 }, { folks, tents: [], isBank: () => false, self: 'me' }), []);
});

test('adding a stop refuses a repeat in a row and a full route', () => {
  assert.deepEqual(addStop([], bank()).stops, [bank()]);
  assert.equal(addStop([bank()], bank()).why, 'repeat');
  assert.equal(addStop([bank()], { kind: 'nope' }).why, 'unreadable');
  const full = Array.from({ length: STOPS_MAX }, (_, i) => folk(`f${i}`));
  const refused = addStop(full, bank());
  assert.equal(refused.why, 'many');
  assert.equal(refused.stops, full);
  // The first stop again is fine while the route goes on: the loop's own check says when it isn't.
  assert.equal(addStop([bank(), folk('a')], bank()).why, undefined);
});

test('stops move and go, and a move off the list changes nothing', () => {
  const s = [bank(), folk('a'), depot('t')];
  assert.deepEqual(moveStop(s, 1, -1), [folk('a'), bank(), depot('t')]);
  assert.deepEqual(moveStop(s, 1, 1), [bank(), depot('t'), folk('a')]);
  assert.equal(moveStop(s, 0, -1), s);
  assert.equal(moveStop(s, 2, 1), s);
  assert.deepEqual(removeStop(s, 1), [bank(), depot('t')]);
});

test('a route preview walks one loop, with each leg timed', () => {
  const hexes = { a: { q: 0, r: 0 }, b: { q: 3, r: 0 } };
  const stops = [bank(0, 0), folk('b')];
  const road = (from, to) => {
    const out = [];
    const dir = Math.sign(to.q - from.q);
    for (let q = from.q + dir; dist({ q, r: 0 }, to) >= 1 && q !== to.q + dir; q += dir) out.push(step(q, 0, 100));
    return out;
  };
  const p = previewRoute(stops, { stopHex: (s) => (s.kind === 'bank' ? { q: s.q, r: s.r } : hexes.b), standOn: (h) => h, road });
  assert.equal(p.noRoad, false);
  assert.deepEqual(p.legs.map((l) => [l.from, l.to, l.state, l.hexes]), [[0, 1, 'ok', 2], [1, 0, 'ok', 1]]);
  assert.equal(p.ms, 300);
  assert.deepEqual(p.lines[0], [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }]);
});

test('a route preview says which leg has no road and which stop is away', () => {
  const stops = [bank(0, 0), folk('gone'), folk('b')];
  const stopHex = (s) => (s.kind === 'bank' ? { q: 0, r: 0 } : s.id === 'b' ? { q: 5, r: 0 } : undefined);
  const p = previewRoute(stops, { stopHex, standOn: (h) => h, road: (from, to) => (to.q === 5 ? undefined : []) });
  assert.deepEqual(p.legs.map((l) => l.state), ['away', 'noRoad', 'ok']);
  assert.equal(p.noRoad, true);
  assert.deepEqual(previewRoute([bank()], { stopHex: (x) => x, standOn: (x) => x, road: () => [] }).legs, []);
});

test('a preview from a port on water starts on the land next to it', () => {
  const seen = [];
  const stops = [bank(0, 0), folk('b')];
  previewRoute(stops, {
    stopHex: (s) => (s.kind === 'bank' ? { q: 0, r: 0 } : { q: 4, r: 0 }),
    standOn: (h) => (h.q === 0 ? { q: 1, r: 0 } : h),
    road: (from, to) => { seen.push(from); return to.q === 4 ? [step(3, 0)] : []; },
  });
  assert.deepEqual(seen[0], { q: 1, r: 0 });
});

// ---- packets and road food ------------------------------------------------------------------------------------------
const portA = { kind: 'bank', q: 0, r: 0 };
const portB = { kind: 'bank', q: 5, r: 0 };
const hexOfStop = (s) => ({ q: s.q, r: s.r });
const hexDist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
const boat = { to: { q: 5, r: 0 }, hexes: [{ q: 2, r: 0 }, { q: 3, r: 0 }, { q: 4, r: 0 }], ms: 3 * PACKET_HEX_MS, fare: 40 };
const seaRoutes = (extra = {}) => ({ stopHex: hexOfStop, road: () => undefined, distance: hexDist, visit: () => ({}), packet: () => boat, board: () => true, ...extra });

test('a packet costs 40% of the game\'s fare, whole GP, nothing where the game charges nothing', () => {
  assert.equal(packetFare(100), 40);
  assert.equal(packetFare(1), 1);
  assert.equal(packetFare(0), 0);
  assert.equal(packetFare(NaN), 0);
});

test('with no road it boards the packet, pays once, stays on its boarding hex and lands on the far shore', () => {
  let paid = 0;
  const c = { ...newCourier([portA, portB], { q: 0, r: 0 }), next: 1 };
  const first = walkOn(c, PACKET_HEX_MS, seaRoutes({ board: (b) => { paid += b.fare; return true; } }));
  assert.equal(paid, 40);
  assert.deepEqual(hexOf(first.courier), { q: 0, r: 0 });
  assert.deepEqual(crossingAt(first.courier), { q: 3, r: 0 });
  assert.deepEqual(crossingAhead(first.courier), [{ q: 4, r: 0 }]);
  let visited = 0;
  const second = walkOn(first.courier, 2 * PACKET_HEX_MS, seaRoutes({ board: () => false, visit: () => { visited += 1; return {}; } }));
  assert.equal(second.wait, 'fare');
  assert.equal(paid, 40);
  assert.equal(second.courier.crossing, undefined);
  assert.deepEqual(hexOf(second.courier), { q: 5, r: 0 });
  assert.equal(visited, 1);
});

test('short of the fare it waits at the port and has not moved', () => {
  const c = { ...newCourier([portA, portB], { q: 0, r: 0 }), next: 1 };
  const out = walkOn(c, PACKET_HEX_MS, seaRoutes({ board: () => false }));
  assert.equal(out.wait, 'fare');
  assert.equal(out.fare, 40);
  assert.equal(out.courier.crossing, undefined);
  assert.deepEqual(hexOf(out.courier), { q: 0, r: 0 });
});

test('a crossing survives a save, and a broken one is dropped', () => {
  const c = { ...newCourier([portA, portB], { q: 0, r: 0 }), crossing: { to: { q: 5, r: 0 }, hexes: [{ q: 2, r: 0 }], ms: 1000, into: 400 }, pack: { food: 12, fuel: 0.5 }, packing: true };
  assert.deepEqual(cleanCourier(c), c);
  const bad = cleanCourier({ ...c, crossing: { to: null, hexes: [], ms: 0 }, pack: { food: -1 } });
  assert.equal(bad.crossing, undefined);
  assert.equal(bad.pack, undefined);
});

test('a route deleted on a packet sails on and heads for the bank stop nearest the far shore', () => {
  const c = { ...newCourier([portA, portB], { q: 0, r: 0 }), next: 1, crossing: { to: { q: 5, r: 0 }, hexes: [{ q: 2, r: 0 }], ms: 1000, into: 0 } };
  const out = retire(c, hexDist);
  assert.equal(out.retired, true);
  assert.equal(out.next, 1);
  assert.ok(out.crossing !== undefined);
  assert.deepEqual(hexOf(land(out)), { q: 5, r: 0 });
});

test('sailing past the end hands back the spare time', () => {
  const c = { ...newCourier([portA, portB], { q: 0, r: 0 }), crossing: { to: { q: 5, r: 0 }, hexes: [{ q: 2, r: 0 }], ms: 1000, into: 600 } };
  const out = sail(c, 1500);
  assert.equal(out.landed, true);
  assert.equal(out.spare, 1100);
});

test('after a bank stop it will not leave until its road food is packed', () => {
  const stops = [portA, { kind: 'bank', q: 1, r: 0 }];
  const c = { ...newCourier(stops, { q: 0, r: 0 }) };
  let ok = false;
  const opts = { stopHex: hexOfStop, road: () => [], distance: hexDist, visit: () => ({}), pack: () => (ok ? { food: 9, fuel: 0 } : undefined) };
  const held = walkOn(c, 1000, opts);
  assert.equal(held.wait, 'food');
  assert.equal(held.courier.packing, true);
  ok = true;
  const off = walkOn(held.courier, 1000, opts);
  assert.equal(off.wait, 'standing', 'packed, it goes on: both stops stand in reach, so the round walked no hex');
  assert.equal(off.courier.packing, undefined);
  assert.deepEqual(off.courier.pack, { food: 9, fuel: 0 });
});

test('the road food covers the walk to the next bank stop, not a packet\'s sea', () => {
  const stops = [{ kind: 'folk', id: 'a' }, portB, portA];
  const c = { ...newCourier(stops, { q: 0, r: 0 }), next: 0 };
  const hexes = { a: { q: 2, r: 0 } };
  const step = (q) => ({ q, r: 0, cls: 'grass', ms: 10 });
  const road = (from, to) => (to.q === 5 ? undefined : to.q === 2 ? [step(1), step(2)] : []);
  const steps = stretchSteps(c, { stopHex: (s) => (s.kind === 'folk' ? hexes[s.id] : hexOfStop(s)), road, packet: () => boat });
  assert.deepEqual(steps.map((s) => s.q), [1, 2]);
});

test('each hex walked comes out of the pack, before a bank stop tops it up', () => {
  const far = { kind: 'bank', q: 3, r: 0 };
  const walk = [1, 2, 3].map((q) => ({ q, r: 0, cls: 'grass', ms: 10 }));
  const c = { ...newCourier([portA, far], { q: 0, r: 0 }), next: 1, pack: { food: 10, fuel: 0 } };
  let seen;
  const out = walkOn(c, 30, {
    stopHex: hexOfStop,
    road: (from, to) => (to.q === 3 && from.q === 0 ? walk : undefined),
    distance: hexDist,
    visit: () => ({}),
    eat: (p) => ({ food: p.food - 2, fuel: p.fuel }),
    pack: (cur) => { seen ??= cur.pack.food; return { food: 10, fuel: 0 }; },
  });
  assert.equal(seen, 4);
  assert.equal(out.courier.pack.food, 10);
});

test('a stop already within reach adds no walk to the road food', () => {
  const c = newCourier([{ kind: 'bank', q: 1, r: 0 }], { q: 0, r: 0 });
  const road = () => [{ q: 1, r: 0, cls: 'grass', ms: 10 }];
  assert.deepEqual(stretchSteps(c, { stopHex: hexOfStop, road, distance: hexDist }), []);
});

test('the preview counts a packet leg\'s time and fare, and it is no missing road', () => {
  const p = previewRoute([portA, portB], { stopHex: hexOfStop, standOn: (h) => h, road: () => undefined, packet: () => boat });
  assert.equal(p.noRoad, false);
  assert.equal(p.legs[0].state, 'packet');
  assert.equal(p.legs[0].fare, 40);
  assert.equal(p.fares, 80);
  assert.equal(p.ms, 6 * PACKET_HEX_MS);
});

// ---- what a route serves: inputs, carried lines, commissions -----------------------------------------------------------
const noTent = () => undefined;

test('a saved edit counts for what a route serves at once, a deleted route serves nobody', () => {
  const c = newCourier([bank(), folk('a')], { q: 0, r: 0 });
  assert.deepEqual(routeOf({ ...c, pending: [bank(), folk('b')] }).map((s) => s.id).filter(Boolean), ['b']);
  assert.equal(routeOf({ ...c, retired: true }), undefined);
  assert.equal(routeServes({ ...c, retired: true }, 'a', noTent), false);
});

test('a tent stop serves the Folks standing by that tent', () => {
  const c = newCourier([bank(), { kind: 'depot', key: 't1' }], { q: 0, r: 0 });
  assert.equal(routeServes(c, 'a', (id) => (id === 'a' ? 't1' : 't2')), true);
  assert.equal(routeServes(c, 'b', (id) => (id === 'a' ? 't1' : 't2')), false);
});

test('one route must serve both Folks of a carried line, and neither carries its own', () => {
  const list = {
    x: newCourier([bank(), folk('a')], { q: 0, r: 0 }),
    y: newCourier([bank(), folk('b')], { q: 0, r: 0 }),
  };
  assert.equal(carrierOf(list, 'a', 'b', noTent), undefined);
  list.z = newCourier([bank(), folk('a'), folk('b')], { q: 0, r: 0 });
  assert.equal(carrierOf(list, 'a', 'b', noTent), 'z');
  assert.equal(carrierOf({ a: newCourier([bank(), folk('a'), folk('b')], { q: 0, r: 0 }) }, 'a', 'b', noTent), undefined);
  assert.deepEqual(couriersServing(list, 'a', noTent).sort(), ['x', 'z']);
});

test('a bank stop loads for each Folk and tent once, skipping itself and those away', () => {
  const stops = [bank(), folk('a'), { kind: 'depot', key: 't' }, folk('a'), folk('me'), folk('gone')];
  assert.deepEqual(inputStops(stops, { self: 'me', isLive: (s) => s.id !== 'gone' }), [{ folk: 'a' }, { depot: 't' }]);
});

test('it turns back full only with no inputs left to hand out', () => {
  assert.equal(loadFull({ sizeMs: 10, usedMs: 10, stock: [] }), true);
  assert.equal(loadFull({ sizeMs: 10, usedMs: 10, stock: [{ itemId: 'x' }] }), false);
  assert.equal(loadFull({ sizeMs: 10, usedMs: 9, stock: [] }), false);
  assert.equal(loadFull(undefined), false);
});

test('a top-up that fits under the bank share is left alone', () => {
  const take = [{ itemId: 'ore', qty: 100, ms: 1000 }, { itemId: 'coal', qty: 400, ms: 4000 }];
  assert.equal(capInputs(take, () => 10000), take);
});

test('a big top-up takes at most a quarter of a stack and keeps the recipe in step', () => {
  assert.equal(INPUT_BANK_SHARE, 0.25);
  const stacks = { ore: 100000, coal: 42187 };
  const out = capInputs([{ itemId: 'ore', qty: 4000, ms: 4000 }, { itemId: 'coal', qty: 19254, ms: 19254 }], (id) => stacks[id]);
  const line = (id) => out.find((x) => x.itemId === id);
  assert.equal(line('coal').qty, Math.ceil(42187 / 4));
  assert.ok(line('ore').qty <= 25000);
  assert.ok(Math.abs(line('coal').qty / line('ore').qty - 19254 / 4000) < 0.01);
  assert.equal(line('coal').ms, line('coal').qty);
});

test('a small stack still moves one, and a line the bank lacks drops out', () => {
  const stacks = { rune: 3, ore: 1000, gone: 0 };
  const out = capInputs([{ itemId: 'rune', qty: 100, ms: 100 }, { itemId: 'ore', qty: 10, ms: 10 }, { itemId: 'gone', qty: 5, ms: 5 }], (id) => stacks[id]);
  assert.deepEqual(out.map((x) => [x.itemId, x.qty]), [['rune', 1], ['ore', 1]]);
  assert.deepEqual(capInputs(undefined, () => 0), []);
});

// ---- what a round carried ------------------------------------------------------------------------------------------

const tallied = (c, ms, load) => walkOn(c, ms, {
  stopHex: (s) => (s.kind === 'bank' ? s : { q: { a: 3, b: 6 }[s.id], r: 0 }),
  road: lineRoad,
  visit: (s) => ({ carried: s.kind === 'folk' ? [{ key: folkKey(s.id), ms: load[s.id] }] : [] }),
  distance: dist,
}).courier;
const round = (over = {}) => ({ carried: {}, ms: 0, fares: 0, trips: 0, ...over });

test('a whole round counts the hours carried for each Folk and its own time, even in one long tick', () => {
  const load = { a: 3000, b: 1000 };
  const begun = tallied(newCourier([bank(0, 0), folk('a'), folk('b')], { q: 0, r: 0 }), 0, load);
  assert.deepEqual(begun.round, round(), 'it starts counting at its first bank stop');
  assert.equal(begun.last, undefined);
  const out = tallied(begun, 1000, load);
  assert.deepEqual(out.last.carried, { 'f:a': 3000, 'f:b': 1000 });
  assert.equal(out.last.ms, 900, 'two, three and four hexes of 100 ms');
  assert.equal(out.round.ms, 100, 'the rest of the tick belongs to the next round');
  const parts = routeParts(out);
  assert.equal(parts['f:a'], 0.75);
  assert.equal(parts['f:b'], 0.25);
});

test('a courier that starts partway round counts nothing until its first bank stop', () => {
  const c = { ...newCourier([bank(0, 0), folk('a')], { q: 3, r: 0 }), next: 1 };
  const out = noteStop(c, afterStop(c, { distance: dist }), [{ key: folkKey('a'), ms: 500 }]);
  assert.equal(out.round, undefined);
  assert.equal(out.last, undefined);
});

test('before a whole round the route splits evenly by stop, and a route edit goes back to that', () => {
  const c = newCourier(route(), { q: 0, r: 0 });
  const parts = routeParts(c);
  assert.deepEqual(Object.keys(parts).sort(), ['d:t', 'f:a', 'f:b']);
  for (const v of Object.values(parts)) assert.ok(Math.abs(v - 1 / 3) < 1e-9);
  const ran = { ...c, last: round({ carried: { 'f:a': 900, 'f:b': 100 }, ms: 1000 }) };
  assert.equal(routeParts(ran)['f:a'], 0.9);
  const edited = routeParts({ ...ran, pending: [bank(0, 0), folk('b')] });
  assert.deepEqual(edited, { 'f:b': 1 }, 'the new route counts at once');
  assert.deepEqual(routeParts({ ...ran, last: round({ ms: 1000 }) }), parts, 'a round that carried nothing tells nothing');
  assert.deepEqual(routeParts({ ...c, retired: true }), {});
});

test('a depot member gets its own hours and an even slice of the tent', () => {
  const parts = { 'd:t': 0.5, 'f:a': 0.5 };
  assert.equal(folkPart(parts, 'b', 't', 2), 0.25);
  assert.equal(folkPart(parts, 'a', 't', 2), 0.75);
  assert.equal(folkPart(parts, 'a', undefined), 0.5);
  assert.equal(folkPart(parts, 'x', undefined), 0);
  assert.equal(folkPart({ 'd:t': 1 }, 'b', 't', 0), 1, 'never divides by nobody');
  assert.equal(depotKey('t'), 'd:t');
});

test('home early with a full load is not a whole round, but a Folk that fills every load cannot hold one open', () => {
  const stops = [bank(0, 0), folk('a')];
  const atBank = { stops, next: 0, back: 1, from: { q: 0, r: 0 }, road: [], reached: 0, into: 0, round: round({ ms: 50, carried: { 'f:a': 10 } }) };
  const once = noteStop(atBank, afterStop(atBank, { distance: dist }));
  assert.equal(once.last, undefined);
  assert.equal(once.round.trips, 1);
  const twice = { ...once, next: 0, back: 1 };
  const closed = noteStop(twice, afterStop(twice, { distance: dist }));
  assert.equal(closed.last.ms, 50);
  assert.deepEqual(closed.round, round());
});

test('a round that took no time keeps the last real one, and a new route drops both', () => {
  const stops = [bank(0, 0), folk('a')];
  const c = { stops, next: 0, from: { q: 0, r: 0 }, road: [], reached: 0, into: 0, round: round(), last: round({ ms: 700 }) };
  assert.equal(noteStop(c, afterStop(c, { distance: dist })).last.ms, 700);
  const taken = afterStop({ ...c, pending: [bank(0, 0), folk('b')] }, { distance: dist });
  const out = noteStop({ ...c, pending: taken.stops }, taken);
  assert.equal(out.round, undefined);
  assert.equal(out.last, undefined);
});

test('fares per hour are the whole courier\'s: from the last round, else from the route', () => {
  const c = newCourier([bank(0, 0), folk('a')], { q: 0, r: 0 });
  assert.equal(faresPerHour(c), 0);
  assert.equal(faresPerHour(c, { ms: 3600000, fares: 200 }), 200);
  assert.equal(faresPerHour({ ...c, last: round({ ms: 1800000, fares: 500 }) }, { ms: 3600000, fares: 200 }), 1000);
  assert.equal(faresPerHour({ ...c, last: round({ ms: 1800000 }) }, { ms: 3600000, fares: 200 }), 0, 'a round without a boat paid nothing');
  const counting = roundFare(roundTime({ ...c, round: round() }, 40), 7);
  assert.deepEqual([counting.round.ms, counting.round.fares], [40, 7]);
  assert.equal(roundFare(roundTime(c, 40), 7), c, 'nothing to count into yet');
});

test('a save keeps the rounds and drops what it cannot read', () => {
  const c = { ...newCourier([bank(0, 0), folk('a')], { q: 0, r: 0 }), round: round({ ms: 5, carried: { 'f:a': 9 } }), last: round({ ms: 8, fares: 2, trips: 1 }) };
  assert.deepEqual(cleanCourier(JSON.parse(JSON.stringify(c))), c);
  const junk = cleanCourier({ ...c, round: { carried: { 'f:a': -1, 'x:b': 4, 'd:t': 3 }, ms: 'no', fares: NaN, trips: 1.5 }, last: 7 });
  assert.deepEqual(junk.round, round({ carried: { 'd:t': 3 } }));
  assert.equal(junk.last, undefined);
});

test('what the courier code keeps: counted, and clean when every part is capped and every entry has its Folk', () => {
  const roads = new Map([['0,0|5,0', [step(1, 0), step(2, 0)]], ['5,0|0,0', null]]);
  const packets = new Map([['1,0|9,0', { hexes: [{ q: 2, r: 0 }, { q: 3, r: 0 }, { q: 4, r: 0 }] }]]);
  const couriers = { a: { ...newCourier([bank(0, 0), folk('b')], { q: 0, r: 0 }), road: [step(1, 0)], last: { carried: { 'f:b': 10 }, ms: 1, fares: 0, trips: 0 } } };
  const out = keptReport({
    roads, packets, couriers, tents: 1, tentCounts: new Map([['t1', 2]]),
    perCourier: { held: new Map([['a', {}]]), loops: new Map([['a', {}]]) },
    folkIds: ['a', 'b'],
  });
  assert.deepEqual(out.problems, []);
  assert.equal(out.roads, 2);
  assert.equal(out.roadHexes, 2);
  assert.equal(out.packets, 1);
  assert.equal(out.packetHexes, 3);
  assert.equal(out.held, 1);
  assert.equal(out.tentCounts, 1);
  assert.deepEqual({ ...out.saved, bytes: out.saved.bytes > 0 }, { couriers: 1, stops: 2, roadHexes: 1, roundKeys: 1, bytes: true });
});

test('what the courier code keeps: anything past its cap, or left by a Folk that is gone, is named', () => {
  const roads = new Map();
  for (let i = 0; i <= ROADS_KEPT; i++) roads.set(`${i}`, null);
  roads.set('long', Array.from({ length: ROAD_MAX + 1 }, (_, i) => step(i, 0)));
  const wide = { carried: Object.fromEntries(Array.from({ length: STOPS_MAX + 1 }, (_, i) => [`f:${i}`, 1])) };
  const out = keptReport({
    roads,
    perCourier: { held: new Map([['gone', {}]]), awayTally: new Map(Array.from({ length: COURIERS_MAX + 1 }, (_, i) => [`${i}`, {}])) },
    tentCounts: new Map([['t1', 1], ['t2', 1]]),
    tents: 1,
    couriers: { gone: { ...newCourier([bank(0, 0), folk('b')], { q: 0, r: 0 }), round: wide } },
    folkIds: Array.from({ length: COURIERS_MAX + 1 }, (_, i) => `${i}`),
  });
  const named = out.problems.join(' | ');
  for (const part of ['roads: 514 kept', `one of ${ROAD_MAX + 1} hexes`, 'held: 1 for Folks that are gone', `awayTally: ${COURIERS_MAX + 1} entries`, 'tentCounts: 2 for 1 tents', 'saved: 1 routes for Folks that are gone', `more than ${STOPS_MAX} stops`]) {
    assert.ok(named.includes(part), `names ${part}: ${named}`);
  }
});

test('save v34: a courier keeps the band that stopped it and the card you lend it', () => {
  const c = { ...newCourier(route(), { q: 1, r: 1 }), held: 5000.6, lent: 'slash' };
  assert.deepEqual({ held: cleanCourier(c).held, lent: cleanCourier(c).lent }, { held: 5000, lent: 'slash' });
  const junk = cleanCourier({ ...newCourier(route(), { q: 1, r: 1 }), held: -3, lent: '<b>' });
  assert.equal('held' in junk, false);
  assert.equal('lent' in junk, false);
});

test('a band on a hex just entered stops the courier there, its time unspent, until answered', () => {
  const c = startLeg(newCourier(route(), { q: 0, r: 0 }), { q: 0, r: 0 }, [step(1, 0), step(2, 0), step(3, 0)]);
  const met = [];
  const out = advance(c, 1000, (s) => { met.push(s.q); return s.q === 2 ? 777.9 : 0; });
  assert.deepEqual(met, [1, 2]);
  assert.equal(out.held, true);
  assert.deepEqual([out.courier.reached, out.courier.into, out.courier.held, out.spare, out.arrived], [2, 0, 777, 0, false]);
  assert.deepEqual(out.entered.map((s) => s.q), [1, 2]);
  assert.equal(advance(c, 1000, () => undefined).arrived, true, 'no band: on as before');
});

test('along the route: a held courier waits for the band; after a Run it stands the lag out first', () => {
  const c = newCourier([bank(0, 0), folk('a')], { q: 0, r: 0 });
  const opts = (meet) => ({ stopHex: (s) => (s.kind === 'bank' ? s : { q: 5, r: 0 }), road: lineRoad, visit: () => ({}), distance: dist, meet });
  const stopped = walkOn(c, 400, opts((s) => (s.q === 2 ? 5000 : 0)));
  assert.equal(stopped.wait, 'band');
  assert.deepEqual(hexOf(stopped.courier), { q: 2, r: 0 });
  assert.equal(stopped.courier.held, 5000);
  const still = walkOn(stopped.courier, 400, opts(() => 0));
  assert.equal(still.wait, 'band');
  assert.deepEqual(hexOf(still.courier), { q: 2, r: 0 }, 'nothing moves while held');
  const { held, ...free } = stopped.courier;
  const lagged = walkOn({ ...free, lag: 150 }, 100, opts(() => 0));
  assert.deepEqual(hexOf(lagged.courier), { q: 2, r: 0 });
  assert.equal(lagged.courier.lag, 50);
  const on = walkOn(lagged.courier, 150, opts(() => 0));
  assert.equal('lag' in on.courier, false);
  assert.deepEqual(hexOf(on.courier), { q: 3, r: 0 }, 'the rest of the time walks on');
});

test('a Run lag is kept whole, at most a day', () => {
  const c = newCourier(route(), { q: 1, r: 1 });
  assert.equal(cleanCourier({ ...c, lag: 1200.4 }).lag, 1200);
  assert.equal(cleanCourier({ ...c, lag: 1e12 }).lag, 24 * 3600 * 1000);
  assert.equal('lag' in cleanCourier({ ...c, lag: -1 }), false);
});

test('on a packet each sea hex after the first may meet a band; one holds it there until answered, and is not met twice', () => {
  const c = { ...newCourier([portA, portB], { q: 0, r: 0 }), next: 1, crossing: { ...boat, into: 0 } };
  const asked = [];
  const out = sail(c, 3 * PACKET_HEX_MS, (h) => { asked.push(h); return h.q === 3 ? 4242 : 0; });
  assert.deepEqual(asked, [{ q: 3, r: 0, sea: true }], 'the first sea hex, by the port, never meets one');
  assert.equal(out.held, true);
  assert.deepEqual([out.landed, out.spare, out.courier.held, out.courier.crossing.into], [false, 0, 4242, PACKET_HEX_MS]);
  assert.deepEqual(crossingAt(out.courier), { q: 3, r: 0 });
  const { held, ...free } = out.courier;
  const again = [];
  const on = sail(free, 3 * PACKET_HEX_MS, (h) => { again.push(h.q); return 0; });
  assert.deepEqual(again, [4]);
  assert.equal(on.landed, true);
  assert.equal(on.spare, PACKET_HEX_MS);
  assert.equal(sail(c, PACKET_HEX_MS - 1, () => 1).held, undefined, 'short of the next hex: nothing asked');
});

test('along the route: a band on the packet holds the courier at sea, and it waits there', () => {
  const c = { ...newCourier([portA, portB], { q: 0, r: 0 }), next: 1 };
  const held = walkOn(c, 3 * PACKET_HEX_MS, seaRoutes({ meet: (h) => (h.sea === true && h.q === 4 ? 9000 : 0) }));
  assert.equal(held.wait, 'band');
  assert.deepEqual(crossingAt(held.courier), { q: 4, r: 0 });
  assert.equal(held.courier.held, 9000);
  const still = walkOn(held.courier, 3 * PACKET_HEX_MS, seaRoutes());
  assert.equal(still.wait, 'band');
  assert.deepEqual(crossingAt(still.courier), { q: 4, r: 0 });
});

test('a bank stop gives back a quarter of max HP, never past max; full or unknown health heals nothing', () => {
  assert.deepEqual([BANK_HEAL, ROAD_HEAL, ROAD_HEAL_FOOD], [0.25, 0.03, 2]);
  assert.equal(bankHeal(10, 100), 25);
  assert.equal(bankHeal(90, 100), 10);
  assert.equal(bankHeal(null, 100), 0, 'null is full health');
  assert.equal(bankHeal(100, 100), 0);
  assert.equal(bankHeal(0, 3), 1, 'at least 1');
  assert.equal(bankHeal(5, undefined), 0);
});

test('on the road a hurt courier eats double for 3% of max HP a hex; a hex without that food heals nothing', () => {
  const cost = { food: 4, fuel: 1 };
  assert.deepEqual(roadHeal({ food: 8, fuel: 5 }, cost, 50, 100), { cost: { food: 8, fuel: 1 }, heal: 3 });
  assert.deepEqual(roadHeal({ food: 7, fuel: 5 }, cost, 50, 100), { cost, heal: 0 }, 'not enough for double');
  assert.deepEqual(roadHeal({ food: 99, fuel: 5 }, cost, 99, 100), { cost: { food: 8, fuel: 1 }, heal: 1 }, 'only what is missing');
  assert.deepEqual(roadHeal({ food: 99, fuel: 5 }, cost, null, 100), { cost, heal: 0 }, 'full: plain road food');
  assert.equal(roadHeal(undefined, { food: 0, fuel: 0 }, 10, 100).heal, 3, 'Provisions off: no food to count');
  assert.equal(roadHealHexes(50, 100), 17);
  assert.equal(roadHealHexes(null, 100), 0);
  assert.equal(roadHealHexes(99, 1000), 31);
});

test('a stretch splits at the hexes where it can top up its road food; the last hex never starts a part', () => {
  const steps = [1, 2, 3, 4, 5].map((q) => ({ q, r: 0 }));
  const town = (s) => s.q === 2 || s.q === 5;
  assert.deepEqual(stretchParts(steps, town).map((p) => p.map((s) => s.q)), [[1, 2], [3, 4, 5]]);
  assert.deepEqual(stretchParts(steps, () => false).map((p) => p.length), [5]);
  assert.deepEqual(stretchParts([], town), [[]]);
});

test('a stretch fits when each part can be packed at its start, topping up towards the rest of the way', () => {
  const pt = (food, stock, fuel = 0, fstock = Infinity) => ({ need: { food, fuel }, stock: { food: stock, fuel: fstock } });
  // 723 food to the next bank stop, a town holding 600: it never leaves (Milo, the .711 check).
  assert.deepEqual(stretchFits([pt(723, 600)]), { at: 0, short: { food: 123, fuel: 0 } });
  // With a town on the way the same trip goes: 600 here, the rest topped up there.
  assert.equal(stretchFits([pt(400, 600), pt(323, 600)]), undefined);
  // The bank stop packs what it can (600 of 723): 200 left after the first part, and the farm on the way gives 75 of 123.
  assert.deepEqual(stretchFits([pt(400, 600), pt(323, 75)]), { at: 1, short: { food: 48, fuel: 0 } });
  assert.deepEqual(stretchFits([pt(10, 100, 3, 2)]), { at: 0, short: { food: 0, fuel: 1 } });
  assert.equal(stretchFits([pt(500, Infinity)]), undefined, 'supply off: the places never run out');
  assert.equal(stretchFits([]), undefined);
});

test('on a hex it can load on, the courier tops its pack up; short, it waits there and tries again before walking on', () => {
  const far = { kind: 'bank', q: 4, r: 0 };
  const walk = [1, 2, 3, 4].map((q) => ({ q, r: 0, cls: 'grass', ms: 10 }));
  const c = { ...newCourier([portA, far], { q: 0, r: 0 }), next: 1, pack: { food: 4, fuel: 0 } };
  let give = false;
  const opts = {
    stopHex: hexOfStop,
    road: (from, to) => (to.q === 4 && from.q < 4 ? walk.slice(from.q) : undefined),
    distance: hexDist,
    visit: () => ({}),
    eat: (p) => ({ food: p.food - 1, fuel: p.fuel }),
    topUp: (p, at) => (hexOf(at).q !== 2 ? p : give ? { food: 9, fuel: 0 } : undefined),
  };
  const first = walkOn(c, 40, opts);
  assert.equal(first.wait, 'food');
  assert.deepEqual(hexOf(first.courier), { q: 2, r: 0 });
  assert.equal(first.courier.topping, true);
  assert.equal(first.courier.pack.food, 2, 'two hexes eaten');
  assert.equal(cleanCourier(first.courier).topping, true, 'kept in the save');
  const still = walkOn(first.courier, 40, opts);
  assert.equal(still.wait, 'food');
  assert.deepEqual(hexOf(still.courier), { q: 2, r: 0 });
  give = true;
  const on = walkOn(still.courier, 15, opts);
  assert.equal(on.courier.topping, undefined);
  assert.deepEqual(hexOf(on.courier), { q: 3, r: 0 });
  assert.equal(on.courier.pack.food, 8, 'topped up to 9, then a hex eaten');
});

