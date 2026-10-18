import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startCandidates, pickStart, AWAY, TRADE_STEPS } from '../src/start-model.mjs';
import { isTradePlace } from '../src/rules.mjs';

const table = JSON.parse(readFileSync(new URL('../data/hex_terrain.json', import.meta.url), 'utf8'));
const hexes = table.hexes;
const byKey = new Map(hexes.map((h) => [`${h.q},${h.r}`, h]));
const start = { q: 15, r: 9 };

test('Random start: land, no place, away from the game\'s start, a trading place near, something to gather', () => {
  const gathers = (h) => (h.f ?? []).some((f) => f === 'forest' || f === 'tree') || h.coast === true;
  const list = startCandidates(hexes, { start, gathers, trades: isTradePlace });
  assert.ok(list.length > 40, `only ${list.length} starts`);
  for (const c of list) {
    const h = byKey.get(`${c.q},${c.r}`);
    assert.ok(h.t !== 'water' && h.t !== 'shoal' && h.cloud !== true);
    assert.equal(h.poi, undefined);
    assert.ok(gathers(h));
    const d = (Math.abs(c.q - start.q) + Math.abs(c.q + c.r - start.q - start.r) + Math.abs(c.r - start.r)) / 2;
    assert.ok(d >= AWAY);
  }
  // Islands a dinghy can't land on are left out.
  assert.deepEqual(startCandidates(hexes, { start, gathers, trades: isTradePlace, tier: () => 2 }), []);
  // No trading place anywhere: no start.
  assert.deepEqual(startCandidates(hexes, { start, gathers, trades: () => false }), []);
  assert.ok(TRADE_STEPS === 8);
});

test('pickStart: one of them, the same for the same seed', () => {
  const list = [{ q: 1, r: 1 }, { q: 2, r: 2 }, { q: 3, r: 3 }];
  assert.deepEqual(pickStart(list, () => 0.5), { q: 2, r: 2 });
  assert.deepEqual(pickStart(list, () => 0.999999), { q: 3, r: 3 });
  assert.equal(pickStart([], () => 0.5), undefined);
});
