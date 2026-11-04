import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/spoil-model.mjs';

const H = P.HOUR_MS;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('a share an hour: food 1%, fuel 0.25%; an 8-hour night loses about 8% of the food and 2% of the fuel', () => {
  near(P.keptShare('food', H, 1), 0.99);
  near(P.keptShare('fuel', H, 1), 0.9975);
  near(1 - P.keptShare('food', 8 * H, 1), 0.0773, 1e-4);
  near(1 - P.keptShare('fuel', 8 * H, 1), 0.0198, 1e-4);
  // a multiplier works as more or fewer hours: ×2 for an hour is two hours at ×1
  near(P.keptShare('food', H, 2), P.keptShare('food', 2 * H, 1));
  assert.equal(P.keptShare('food', 0, 1), 1);
  assert.equal(P.keptShare('food', H, 0), 1);
});

test('the multipliers: a food place ×1/4, a tent ×1/2 (not both), warmth on food, damp on fuel, casks and salt ×1/2', () => {
  assert.deepEqual(P.factors(), { food: 1, fuel: 1, parts: [] });
  const town = P.factors({ foodPlace: true });
  assert.equal(town.food, 0.25);
  assert.equal(town.fuel, 0.25);
  // a tent's store is ×1/2 wherever it stands, its camp loading food or not
  assert.equal(P.factors({ where: 'tent', foodPlace: true }).food, 0.5);
  // the bands: food only
  assert.deepEqual(['bitter', 'cold', 'mild', 'warm', 'scorching'].map((band) => P.factors({ band }).food), [0.25, 0.5, 1, 1.5, 2]);
  assert.equal(P.factors({ band: 'scorching' }).fuel, 1);
  // the damp: fuel at sea only
  const sea = P.factors({ sea: true, band: 'cold' });
  assert.equal(sea.fuel, 1.5);
  assert.equal(sea.food, 0.5);
  // the casks and the salt, each ×1/2, together ×1/4; the salt is for your stores only
  assert.equal(P.factors({ casks: true, cured: true }).food, 0.25);
  assert.equal(P.factors({ where: 'tent', casks: true, cured: true }).food, 0.25);
  // all at once: a town in Summer heat with both preservers
  const all = P.factors({ foodPlace: true, band: 'warm', casks: true, cured: true });
  near(all.food, 0.25 * 1.5 * 0.25);
  assert.deepEqual(all.parts.map((p) => p.id), ['place', 'warmth', 'casks', 'cured']);
});

test('a span takes whole units and carries the fraction: sixty minutes one by one lose what one hour does', () => {
  const have = { food: 2400, fuel: 60 };
  const once = P.spoil(have, undefined, H, { food: 1, fuel: 1 });
  assert.equal(once.lost.food, 24); // 2,400 × 1%
  assert.equal(once.have.food, 2376);
  near(once.lost.fuel, 0.15, 1e-3);
  let cur = { have, debt: undefined };
  let lost = 0;
  for (let i = 0; i < 60; i++) {
    const r = P.spoil(cur.have, cur.debt, H / 60, { food: 1, fuel: 1 });
    lost += r.lost.food;
    cur = r;
  }
  // a minute loses 0.4 HP: without the carried fraction every minute would round to 0 (or to 1, twice the rate)
  assert.ok(lost === 23 || lost === 24, `${lost}`);
  assert.ok(cur.debt.food < 1);
  near(cur.have.food - cur.debt.food, 2400 * 0.99, 1e-6);
});

test('the floor: the food to get ashore is never spoiled, and what is under it keeps', () => {
  const r = P.spoil({ food: 500, fuel: 10 }, undefined, 100 * H, { food: 1, fuel: 1 }, { food: 400 });
  assert.equal(r.have.food, 400);
  assert.equal(r.lost.food, 100);
  const under = P.spoil({ food: 300, fuel: 10 }, undefined, 10 * H, { food: 1, fuel: 1 }, { food: 400 });
  assert.equal(under.have.food, 300);
  assert.equal(under.lost.food, 0);
  // empty stays empty, with no debt
  const empty = P.spoil({ food: 0, fuel: 0 }, { food: 0.7, fuel: 0 }, H, { food: 1, fuel: 1 });
  assert.deepEqual(empty.have, { food: 0, fuel: 0 });
  assert.equal(empty.debt.food, 0);
});

test('curing splits the span where it ends: 2 h cured then 2 h plain', () => {
  const f = { food: 1, fuel: 1 };
  const half = { food: 0.5, fuel: 0.5 };
  const r = P.settle({ food: 10000, fuel: 100 }, undefined, 4 * H, { fWith: half, fWithout: f, cure: 2 * H });
  assert.equal(r.cure, 0);
  // 2 h at ×1/2 is 1 h's loss, then 2 h: 3 h in all
  near(r.have.food + r.debt.food, 10000 - Math.floor(10000 * (1 - 0.99 ** 3)), 1);
  const still = P.settle({ food: 10000, fuel: 100 }, undefined, H, { fWith: half, fWithout: f, cure: 5 * H });
  assert.equal(still.cure, 4 * H);
});

test('the forecast: later legs lose less as the stores are spent', () => {
  const legs = [{ ms: H, f: { food: 1, fuel: 1 }, cost: { food: 1000, fuel: 0 } }, { ms: H, f: { food: 1, fuel: 1 }, cost: { food: 0, fuel: 0 } }];
  const lost = P.forecast({ food: 2000, fuel: 0 }, legs);
  // 20 the first hour; 980 left after the cost, 9.8 the second
  assert.equal(lost.food, Math.round(20 + 9.8));
  assert.deepEqual(P.forecast({ food: 2000, fuel: 10 }, []), { food: 0, fuel: 0 });
  // a stop that loads sets the stores before its leg: the second hour spoils 1% of the 2,000 loaded, not of 980
  const stop = P.forecast({ food: 2000, fuel: 0 }, [legs[0], { ...legs[1], set: { food: 2000, fuel: 0 } }]);
  assert.equal(stop.food, 40);
});

test('a walk\'s pack carries the extra its road spoils, so it arrives as without spoilage', () => {
  const f = { food: 1, fuel: 1 };
  const steps = [{ food: 40, fuel: 1, ms: H / 10, f }, { food: 40, fuel: 1, ms: H / 10, f }, { food: 80, fuel: 2, ms: H / 10, f }];
  const pack = P.packWith(steps);
  assert.ok(pack.food >= 160 && pack.food <= 162, `${pack.food}`);
  assert.ok(pack.fuel >= 4 && pack.fuel < 4.01, `${pack.fuel}`);
  // walked step by step, the pack pays every hex and ends at or just above empty
  let cur = { ...pack };
  for (const s of steps) {
    for (const k of ['food', 'fuel']) cur[k] = cur[k] * P.keptShare(k, s.ms, 1) - s[k];
    assert.ok(cur.food >= -1e-9 && cur.fuel >= -1e-9, JSON.stringify(cur));
  }
  // with no time on the road it is the plain sum
  assert.deepEqual(P.packWith(steps.map((s) => ({ ...s, ms: 0 }))), { food: 160, fuel: 4 });
});

test('curing salts: 6 h each, at most 48 h banked', () => {
  assert.equal(P.cureAfter(0, 1), 6 * H);
  assert.equal(P.cureAfter(45 * H, 3), 48 * H);
  assert.equal(P.curesRoom(0), 8);
  assert.equal(P.curesRoom(43 * H), 0);
  assert.equal(P.curesRoom(42 * H), 1);
});

test('the save record cleans to its shape', () => {
  assert.deepEqual(P.cleanSpoil(undefined), { at: 0, cure: 0, debt: { food: 0, fuel: 0 }, tents: {} });
  const c = P.cleanSpoil({ at: 5, cure: 99 * H, debt: { food: 0.4, fuel: 9 }, tents: { '3,4': { food: 0.2 }, bad: {} } });
  assert.equal(c.cure, 48 * H);
  assert.equal(c.debt.fuel, 0.001);
  assert.deepEqual(Object.keys(c.tents), ['3,4']);
});
