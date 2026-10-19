import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RATION_HP, HEX_COST, isEasy, fuelFactor, foodHP, loadingAt, loadAmount, stepCost, pathCost, planMove, ashoreReserve, STARTER_KIT,
  capacity, loadCount, wearOf, pathWear, hullReserve, WORN,
  isNight, nextTurn, nightHours, lightCost, planLight, lightFactor, lightable,
} from '../src/stores-model.mjs';
import * as terrainMod from '../src/terrain.mjs';

const land = (cls) => ({ cls, sea: false });
const sea = (homeward = false) => ({ cls: 'water', sea: true, homeward });

test('every terrain class has a cost; every land hex burns fuel; easy ground is a list', () => {
  for (const c of terrainMod.CLASSES) assert.ok(HEX_COST[c] !== undefined, c);
  for (const c of terrainMod.CLASSES) if (c !== 'water' && c !== 'shoal') assert.ok(HEX_COST[c].fuel > 0, c);
  assert.ok(isEasy('grasslands'));
  assert.ok(isEasy('desert')); // 1 fuel, still easy
  assert.ok(!isEasy('mountain'));
  assert.ok(!isEasy('water'));
  assert.ok(isEasy('unknown')); // the table does not know it: grasslands
});

test('Firemaking cuts fuel by 0.5% a level, capped at 99; food HP is healsFor x 10', () => {
  assert.equal(fuelFactor(1), 0.995);
  assert.equal(fuelFactor(99), 1 - 0.495);
  assert.equal(fuelFactor(120), fuelFactor(99));
  assert.equal(fuelFactor(undefined), 1);
  assert.equal(foodHP(3), 30);
  assert.equal(foodHP(0), 0);
  assert.deepEqual(stepCost(land('snowlands'), 99), { food: 2 * RATION_HP, fuel: 1.01 });
  assert.deepEqual(stepCost({ ...land('mountain'), free: true }, 1), { food: 0, fuel: 0 });
  assert.deepEqual(stepCost({ cls: 'grasslands', sea: false, hop: 7 }, 1), { food: 7 * RATION_HP, fuel: 0 });
  assert.deepEqual(pathCost([land('grasslands'), land('mountain')], 1), { food: 40, fuel: 1.493 });
});

test('loading: ports full, towns 75%, markets 75/50, farms and camps 50%, one hex of grace, nothing in the wild', () => {
  const at = (...f) => ({ t: 'grasslands', f });
  assert.deepEqual(loadingAt(at('port')), { place: 'port', food: 1, fuel: 1 });
  assert.deepEqual(loadingAt(at('capital')), { place: 'town', food: 0.75, fuel: 0.75 });
  assert.deepEqual(loadingAt(at('market')), { place: 'market', food: 0.75, fuel: 0.5 });
  assert.deepEqual(loadingAt(at('camp')), { place: 'farm', food: 0.5, fuel: 0.5 });
  assert.equal(loadingAt(at('forest')), undefined);
  assert.equal(loadingAt({ t: 'water' }), undefined);
  assert.deepEqual(loadingAt({ t: 'water' }, [at('port')]), { place: 'port', food: 1, fuel: 1 }); // at the quay
  assert.deepEqual(loadingAt(at('market'), [at('city')]), { place: 'town', food: 0.75, fuel: 0.75 }); // a food tie: the town gives both
  assert.deepEqual(loadingAt(at('city'), [at('market')]), { place: 'town', food: 0.75, fuel: 0.75 });
  assert.deepEqual(loadingAt(at('market'), [at('port')]), { place: 'port', food: 1, fuel: 1 }); // best of each
  assert.equal(loadingAt(at('forest'), [{ ...at('port'), cloud: true }]), undefined);
  assert.equal(loadAmount(30, 10, 0.75), 225);
  assert.equal(loadAmount(30, -2, 1), 0);
});

test('a move is paid step by step from the stores', () => {
  const p = planMove({ food: 100, fuel: 3 }, [land('grasslands'), land('mountain'), land('grasslands')], { fmLevel: 1 });
  assert.equal(p.ok, true);
  assert.equal(p.food, 40);
  assert.equal(p.fuel, 1.009); // 3 less 0.4975 + 0.995 + 0.4975, each step kept to thousandths
  assert.deepEqual(p.spent, { food: 60, fuel: 1.991 });
  assert.deepEqual(p.hungry, []);
});

test('the hunger floor: easy ground is walked on empty stores, hard ground and open sea are refused', () => {
  const p = planMove({ food: 30, fuel: 1 }, [land('grasslands'), land('beach'), land('desert')]);
  assert.equal(p.ok, true);
  assert.deepEqual(p.hungry, [1, 2]); // the first step is paid, the rest walked hungry; the last 10 HP eaten
  assert.equal(p.food, 0);
  assert.equal(p.fuel, 0);
  // no fuel at all: easy ground is walked cold, food or not
  assert.deepEqual(planMove({ food: 500, fuel: 0 }, [land('grasslands')]).hungry, [0]);
  assert.deepEqual(planMove({ food: 0, fuel: 0 }, [land('grasslands'), land('mountain')]), { ok: false, why: 'food', at: 1, need: { food: 20, fuel: 0.995 } });
  assert.equal(planMove({ food: 500, fuel: 0 }, [land('mountain')]).why, 'fuel');
  assert.equal(planMove({ food: 0, fuel: 9 }, [sea()]).why, 'food');
  // rowing for the coast on an empty stomach always works
  assert.deepEqual(planMove({ food: 0, fuel: 0 }, [sea(true), sea(true), land('beach')]).hungry, [0, 1, 2]);
  // where Adrift applies (5b part two) the floor is gone at sea: the drift takes you home instead
  const adrift = { ...sea(true), adrift: true };
  assert.equal(planMove({ food: 0, fuel: 0 }, [adrift, sea(true), land('beach')]).why, 'food');
  assert.deepEqual(planMove({ food: 0, fuel: 0 }, [sea(true), land('beach')]).hungry, [0, 1], 'next to the coast the floor stays');
});

test('always get ashore: a voyage ending at sea keeps the rations for the way back', () => {
  const reserve = ashoreReserve(2, 2);
  assert.equal(reserve, 2 * RATION_HP);
  assert.equal(planMove({ food: 60, fuel: 0 }, [sea(), sea()], { reserve }).why, 'ashore');
  assert.equal(planMove({ food: 80, fuel: 0 }, [sea(), sea()], { reserve }).ok, true);
  assert.equal(planMove({ food: 40, fuel: 0 }, [sea(), land('beach')], { reserve }).ok, true); // ends ashore
  assert.equal(planMove({ food: 20, fuel: 0 }, [sea(true)], { reserve }).ok, true); // heading home already
  assert.equal(ashoreReserve(Infinity, 2), 2 * RATION_HP);
  assert.equal(ashoreReserve(5, 2), 2 * RATION_HP); // beyond reach the homeward moves are free
});

test('the starter kit crosses the start cluster several times and fits the level 1 limit', () => {
  assert.ok(STARTER_KIT.food / RATION_HP >= 20);
  assert.ok(STARTER_KIT.fuel / HEX_COST.grasslands.fuel >= 20);
  assert.ok(STARTER_KIT.food <= capacity(1).food && STARTER_KIT.fuel <= capacity(1).fuel);
});

test('the stores hold more with every Voyage level, up to 99', () => {
  assert.deepEqual(capacity(1), { food: 620, fuel: 15.5 });
  assert.deepEqual(capacity(50), { food: 1600, fuel: 40 });
  assert.deepEqual(capacity(99), { food: 2580, fuel: 64.5 });
  assert.deepEqual(capacity(120), capacity(99));
  assert.deepEqual(capacity(undefined), capacity(1));
});

test('loading stops at the limit: the last item may top it up', () => {
  assert.equal(loadCount(30, 1, 100, 300), 10);
  assert.equal(loadCount(30, 1, 100, 301), 11); // one more fills the last HP; 29 spill
  assert.equal(loadCount(30, 1, 5, 300), 5); // only 5 owned
  assert.equal(loadCount(30, 0.5, 100, 300), 20);
  assert.equal(loadCount(30, 1, 100, 0), 0);
  assert.equal(loadCount(30, 0, 100, 300), 0);
  assert.equal(loadCount(1, 0.75, 10, 0.5), 1);
});

const deepSea = (homeward = false) => ({ cls: 'water', sea: true, deep: true, homeward });

test('hull wear: 1 a sea hex, 2 in deep water, 1 a hop hex, nothing on land or on free moves', () => {
  assert.equal(wearOf(sea()), 1);
  assert.equal(wearOf(deepSea()), 2);
  assert.equal(wearOf({ cls: 'grasslands', sea: false, hop: 6 }), 6);
  assert.equal(wearOf(land('grasslands')), 0);
  assert.equal(wearOf({ ...sea(), free: true }), 0);
  assert.equal(pathWear([land('beach'), sea(), deepSea(), land('beach')]), 3);
  assert.equal(hullReserve(1, 2), 1);
  assert.equal(hullReserve(Infinity, 2), 2);
});

test('a voyage wears the hull; worn through it refuses, but a step home always goes', () => {
  const hull = (cond, reserve = 0) => ({ hull: { cond, reserve } });
  const ok = planMove({ food: 500, fuel: 5 }, [land('beach'), sea(), sea(), land('beach')], hull(80));
  assert.equal(ok.ok, true);
  assert.equal(ok.cond, 78);
  assert.equal(planMove({ food: 500, fuel: 5 }, [sea()], {}).cond, undefined); // no ship, no wear
  const worn = planMove({ food: 500, fuel: 5 }, [sea(), sea(), sea()], hull(2));
  assert.equal(worn.why, 'hull');
  assert.equal(worn.at, 2);
  assert.equal(worn.need, 3);
  const limp = planMove({ food: 500, fuel: 5 }, [sea(true), sea(true), land('beach')], hull(0));
  assert.equal(limp.ok, true);
  assert.equal(limp.cond, 0);
  assert.equal(planMove({ food: 500, fuel: 5 }, [{ cls: 'grasslands', sea: false, hop: 8 }], hull(5)).why, 'hull');
});

test('two vessels: each sea step wears the vessel it is sailed in; a refusal names it', () => {
  const ship = (v) => ({ ...sea(), vessel: v });
  const hulls = (boat, big, reserve = 0) => ({ hulls: { boat: { cond: boat, reserve }, ship: { cond: big, reserve } } });
  const p = planMove({ food: 500, fuel: 5 }, [ship('ship'), ship('ship'), ship('ship'), ship('boat'), land('beach')], hulls(60, 90));
  assert.equal(p.ok, true);
  assert.deepEqual(p.conds, { boat: 59, ship: 87 });
  assert.equal(p.cond, undefined);
  const worn = planMove({ food: 500, fuel: 5 }, [ship('ship'), ship('boat'), ship('boat')], hulls(1, 90));
  assert.equal(worn.why, 'hull');
  assert.equal(worn.vessel, 'boat');
  assert.equal(worn.at, 2);
  // the reserve for the way back is the vessel's that ends the move at sea
  assert.equal(planMove({ food: 500, fuel: 5 }, [ship('boat'), ship('ship')], hulls(1, 3, 3)).vessel, 'ship');
});

test('below 50% a hull keeps out of deep water; a voyage ending at sea keeps condition for the way back', () => {
  const opts = (cond, reserve = 0) => ({ hull: { cond, reserve } });
  assert.equal(planMove({ food: 500, fuel: 5 }, [sea(), deepSea()], opts(WORN - 1)).why, 'deep');
  assert.equal(planMove({ food: 500, fuel: 5 }, [sea(), deepSea()], opts(WORN + 1)).ok, true); // 50 when it reaches deep water
  assert.equal(planMove({ food: 500, fuel: 5 }, [deepSea(true)], opts(10)).ok, true); // heading home
  assert.equal(planMove({ food: 500, fuel: 5 }, [sea(), sea()], opts(3, 2)).why, 'hullAshore');
  assert.equal(planMove({ food: 500, fuel: 5 }, [sea(), sea()], opts(4, 2)).ok, true);
  assert.equal(planMove({ food: 500, fuel: 5 }, [sea(), land('beach')], opts(1, 2)).ok, true); // ends ashore
});

test('night runs 21:00 to 05:00 on the player\'s clock, moved by the setting', () => {
  assert.equal(isNight(21), true);
  assert.equal(isNight(23.5), true);
  assert.equal(isNight(4.99), true);
  assert.equal(isNight(5), false);
  assert.equal(isNight(20.99), false);
  assert.equal(isNight(22, 2), false); // night from 23:00
  assert.equal(isNight(6, 2), true); // until 07:00
  assert.equal(isNight(20, -1), true);
  assert.equal(nextTurn(12), 21);
  assert.equal(nextTurn(23), 5);
  assert.equal(nextTurn(12, 4), 1);
  assert.deepEqual(nightHours(-3), { start: 18, end: 2 });
  assert.deepEqual(nightHours(99), nightHours(12)); // clamped
});

test('light: 0.5 a land hex, 0.25 at sea, cut by Firemaking and Astrology; free and hungry steps are dark', () => {
  assert.equal(lightCost(land('grasslands'), 0, 0), 0.5);
  assert.equal(lightCost(sea(), 0, 0), 0.25);
  assert.equal(lightCost({ cls: 'grasslands', sea: false, hop: 4 }, 0, 0), 1);
  assert.equal(lightCost({ ...sea(), free: true }, 0, 0), 0);
  assert.equal(lightFactor(99), 1 - 0.495);
  assert.equal(lightCost(land('mountain'), 99, 99), 0.128); // 0.5 x 0.505 x 0.505
});

test('night buys light only from the fuel the day plan leaves: it never refuses or starves a later step', () => {
  const steps = [land('grasslands'), land('mountain'), land('grasslands')];
  const day = planMove({ food: 500, fuel: 2.5 }, steps, { fmLevel: 0 });
  assert.equal(day.fuel, 0.5); // 0.5 + 1 + 0.5 spent
  const lit = planLight(day, steps, { fmLevel: 0, astroLevel: 0 });
  assert.deepEqual(lit.lit, [0]); // the spare 0.5 lights the first hex only
  assert.equal(lit.fuel, 0);
  assert.equal(lit.light, 0.5);
  assert.equal(lit.spent.fuel, 2.5);
  assert.equal(lit.ok, true);
  const refused = planMove({ food: 0, fuel: 0 }, [land('mountain')]);
  assert.equal(planLight(refused, [land('mountain')]), refused);
  const hungry = planMove({ food: 10, fuel: 5 }, [land('grasslands'), land('beach')], { fmLevel: 0 });
  assert.deepEqual(hungry.hungry, [0, 1]); // short of food: walked hungry, so not lit
  assert.deepEqual(planLight(hungry, [land('grasslands'), land('beach')]).lit, []);
  assert.equal(lightable([land('grasslands'), land('beach')], hungry), 0);
});

test('the galleon\'s unlimited reach (build .152): the reserves count the way home, never Infinity', () => {
  assert.equal(ashoreReserve(3, Infinity), ashoreReserve(3, 5));
  assert.equal(hullReserve(3, Infinity), hullReserve(3, 5));
  assert.equal(ashoreReserve(Infinity, Infinity), 0);
  assert.equal(hullReserve(Infinity, Infinity), 0);
});
