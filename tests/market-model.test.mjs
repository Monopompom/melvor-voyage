import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATEGORIES, DEAR, CHEAP, marketOf, marketsOf, pricesOf, percentFor, marketPrice, eachPrice, bestAndWorst } from '../src/market-model.mjs';
import { isTradePlace } from '../src/rules.mjs';

const table = JSON.parse(readFileSync(new URL('../data/hex_terrain.json', import.meta.url), 'utf8'));
const markets = marketsOf(table.hexes, isTradePlace);

test('markets: one per trading place, the Capital City as one, no Fake Port', () => {
  const ids = markets.map((m) => m.id);
  assert.ok(ids.includes('CapitalCity'));
  assert.ok(!ids.some((id) => id.startsWith('CapitalCitys')));
  assert.ok(!ids.includes('FakePort'));
  assert.equal(marketOf('FakePort'), undefined);
  assert.equal(marketOf('CapitalCitysKnights'), 'CapitalCity');
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(markets.find((m) => m.id === 'BeginningPort').port);
});

test('price lists: 2 to 3 dear at 140-180, 1 to 2 cheap at 60-80, fixed per market', () => {
  for (const m of markets) {
    const p = pricesOf(m);
    assert.deepEqual(p, pricesOf(m));
    const dear = Object.values(p).filter((x) => x >= DEAR.min);
    const cheap = Object.values(p).filter((x) => x <= CHEAP.max);
    assert.ok(dear.length >= 2 && dear.length <= 3, `${m.id} dear ${dear}`);
    assert.ok(cheap.length >= 1 && cheap.length <= 2, `${m.id} cheap ${cheap}`);
    assert.ok(dear.every((x) => x <= DEAR.max && x % 5 === 0) && cheap.every((x) => x >= CHEAP.min && x % 5 === 0));
    assert.ok(Object.keys(p).every((c) => CATEGORIES.includes(c)));
    // Fish is never dear at a port.
    if (m.port) assert.ok(!(p.fish >= DEAR.min), `${m.id} pays well for fish`);
  }
  // Not every market says the same.
  assert.ok(new Set(markets.map((m) => JSON.stringify(pricesOf(m)))).size > markets.length / 2);
});

test('processed goods fetch 20 more, unlisted goods 100', () => {
  const p = { fish: 180, logs: 75, ash: 160 };
  assert.equal(percentFor(p, 'fish', false), 180);
  assert.equal(percentFor(p, 'fish', true), 200);
  assert.equal(percentFor(p, 'logs', true), 95);
  assert.equal(percentFor(p, 'ash', true), 160); // ash has no worked goods
  assert.equal(percentFor(p, 'ore', true), 100);
  assert.equal(marketPrice(130, 140), 182);
  assert.equal(marketPrice(1, 75), 0); // sold for nothing (build .276)
});

test('best and worst known market', () => {
  const known = [{ id: 'A', prices: { fish: 160 } }, { id: 'B', prices: { fish: 60 } }, { id: 'C', prices: {} }];
  assert.deepEqual(bestAndWorst(known, 'fish', false), { best: { id: 'A', percent: 160 }, worst: { id: 'B', percent: 60 } });
  assert.equal(bestAndWorst(known, 'ore', false), undefined);
  assert.equal(bestAndWorst([], 'fish', false), undefined);
});

test('one item\'s price shows its fraction; the sale floors the sum', () => {
  assert.equal(eachPrice(1, 60), 0.6);
  assert.equal(eachPrice(3, 125), 3.75);
  assert.equal(eachPrice(10, 60), 6);
  assert.equal(eachPrice(7, 133), 9.31);
  assert.equal(marketPrice(1 * 10, 60), 6, 'ten at 0.6 pay 6');
  assert.equal(marketPrice(1, 60), 0, 'one at 0.6 is sold for nothing');
  assert.equal(marketPrice(0, 60), 0, 'nothing for what has no price');
});
