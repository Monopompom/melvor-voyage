// Foraging on the road (src/forage-model.mjs): which hexes give, the odds by level, a roll and a route's range.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORAGE, BARREN, chanceAt, forageAt, rollForage, forageRange } from '../src/forage-model.mjs';
import { RATION_HP, isEasy } from '../src/stores-model.mjs';

const WC = 'melvorD:Woodcutting';
const FI = 'melvorD:Fishing';
const forest = { t: 'grasslands', f: ['forest'] };

test('half a ration on good ground at 99, a scrap at 1; a quarter to three quarters of a chance', () => {
  assert.equal(FORAGE.food, RATION_HP / 2);
  assert.deepEqual(forageAt(forest, { [WC]: 99 }).food, { chance: 0.75, amount: 10, skill: WC });
  assert.deepEqual(forageAt(forest, { [WC]: 1 }).food, { chance: 0.25, amount: 1, skill: WC });
  assert.equal(forageAt(forest, { [WC]: 50 }).food.amount, 5);
  assert.equal(chanceAt(50), 0.25 + 0.5 * 49 / 98);
  assert.equal(forageAt(forest, {}).food.amount, 1, 'no level known reads as 1');
});

test('the woods forage with Woodcutting, fresh water with Fishing, the better of the two counts', () => {
  assert.equal(forageAt({ t: 'kingslands', f: ['tree'] }, { [WC]: 40, [FI]: 90 }).food.skill, WC);
  assert.equal(forageAt({ t: 'grasslands', f: ['river'] }, { [WC]: 90, [FI]: 20 }).food.skill, FI);
  const both = forageAt({ t: 'grasslands', f: ['forest', 'river'] }, { [WC]: 30, [FI]: 70 }).food;
  assert.equal(both.skill, FI);
  assert.equal(both.amount, 7);
  assert.equal(forageAt({ t: 'grasslands', f: ['farm'] }, { [WC]: 99 }), undefined, 'nothing to forage');
});

test('hard ground gives half; the sea, snow, lava and the wastes give nothing', () => {
  assert.equal(forageAt({ t: 'mountain', f: ['forest'] }, { [WC]: 99 }, isEasy).food.amount, 5);
  assert.equal(forageAt({ t: 'grasslands', f: ['forest'] }, { [WC]: 99 }, isEasy).food.amount, 10);
  for (const t of BARREN) assert.equal(forageAt({ t, f: ['forest', 'river', 'lake'], coast: true }, { [WC]: 99 }), undefined, t);
  assert.equal(forageAt({ t: 'grasslands', f: ['forest'], cloud: true }, { [WC]: 99 }), undefined, 'not under cloud');
});

test('a shore, a beach or a lake brings driftwood, the same for everyone', () => {
  assert.deepEqual(forageAt({ t: 'grasslands', f: [], coast: true }, {}), { food: undefined, fuel: { chance: 0.3, amount: 0.25 } });
  assert.deepEqual(forageAt({ t: 'beach', f: [] }, {}).fuel, { chance: 0.3, amount: 0.25 });
  const lake = forageAt({ t: 'grasslands', f: ['lake'] }, { [FI]: 99 });
  assert.equal(lake.food.amount, 10);
  assert.equal(lake.fuel.amount, 0.25);
});

test('a roll finds each part by its own chance', () => {
  const at = forageAt({ t: 'grasslands', f: ['forest'], coast: true }, { [WC]: 99 });
  assert.deepEqual(rollForage(at, () => 0), { food: 10, fuel: 0.25 });
  assert.deepEqual(rollForage(at, () => 0.99), { food: 0, fuel: 0 });
  const seq = [0.7, 0.5];
  assert.deepEqual(rollForage(at, () => seq.shift()), { food: 10, fuel: 0 });
  assert.deepEqual(rollForage(undefined, () => 0), { food: 0, fuel: 0 });
});

test('a route\'s range is what every hex could give, never counted on', () => {
  const a = forageAt(forest, { [WC]: 99 });
  const b = forageAt({ t: 'beach', f: ['river'] }, { [FI]: 50 });
  assert.deepEqual(forageRange([a, undefined, b]), { food: 15, fuel: 0.25 });
  assert.deepEqual(forageRange([]), { food: 0, fuel: 0 });
});
