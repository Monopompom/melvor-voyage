import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { seas } from '../src/charts-model.mjs';
import * as P from '../src/pilotage-model.mjs';

const table = JSON.parse(await readFile(new URL('../data/hex_terrain.json', import.meta.url), 'utf8'));
const hexes = table.hexes ?? table;

test('the curve: level 1 at nothing, 99 at HEXES_99, each level needs more than the one before', () => {
  assert.equal(P.hexesFor(1), 0);
  assert.equal(P.hexesFor(99), P.HEXES_99);
  assert.equal(P.levelOf(0), 1);
  assert.equal(P.levelOf(P.HEXES_99), 99);
  assert.equal(P.levelOf(P.HEXES_99 * 5), 99);
  assert.equal(P.levelOf(-3), 1);
  assert.equal(P.levelOf(NaN), 1);
  for (let l = 2; l <= 99; l++) assert.ok(P.hexesFor(l) > P.hexesFor(l - 1), `level ${l}`);
  assert.equal(P.hexesFor(2), 1);
  for (let l = 1; l <= 99; l++) assert.equal(P.levelOf(P.hexesFor(l)), l, `level ${l} at its own count`);
  assert.deepEqual(P.progress(P.HEXES_99), { level: 99, into: 0, need: 0 });
  const mid = P.progress(P.hexesFor(50) + 1);
  assert.equal(mid.level, 50);
  assert.equal(mid.into, 1);
  assert.equal(mid.need, P.hexesFor(51) - P.hexesFor(50));
});

test('what a level gives: the forecast at 20, the band tier at 40, 2% faster from 60, 10% and gold at 99', () => {
  assert.equal(P.seesForecast(19), false);
  assert.equal(P.seesForecast(20), true);
  assert.equal(P.seesBandTier(39), false);
  assert.equal(P.seesBandTier(40), true);
  assert.equal(P.speedFactor(59), 1);
  assert.equal(P.speedFactor(60), 0.98);
  assert.ok(Math.abs(P.speedFactor(99) - 0.9) < 1e-9);
  assert.equal(P.isGold(98), false);
  assert.equal(P.isGold(99), true);
  assert.equal(P.nextUnlock(1), 20);
  assert.equal(P.nextUnlock(45), 60);
  assert.equal(P.nextUnlock(99), undefined);
  assert.deepEqual(P.noticeLevels(18, 31), [20, 30]);
  assert.deepEqual(P.noticeLevels(58, 61), [60]);
  assert.deepEqual(P.noticeLevels(5, 5), []);
});

test('every hex that is not cloud has one area: the 13 seas and the land regions, none under the minimum', () => {
  const map = P.areas(hexes, seas(hexes, ['FakePort']));
  const open = hexes.filter((h) => h.cloud !== true);
  assert.equal(map.size, open.length);
  for (const h of hexes) if (h.cloud === true) assert.equal(map.has(`${h.q},${h.r}`), false);
  const sizes = P.areaSizes(map);
  const seaKeys = Object.keys(sizes).filter((a) => a.startsWith('sea_'));
  const landKeys = Object.keys(sizes).filter((a) => a.startsWith('land_'));
  assert.equal(seaKeys.length, 13);
  assert.ok(landKeys.length >= 10, `${landKeys.length} land regions`);
  for (const a of landKeys) assert.ok(sizes[a] >= P.MIN_REGION, `${a} has ${sizes[a]}`);
  for (const a of Object.keys(sizes)) assert.match(a, P.AREA_KEY);
  // A sea hex is in a sea, a land hex in a land region.
  for (const h of open) {
    const a = map.get(`${h.q},${h.r}`);
    if (a.startsWith('sea_')) assert.ok(h.t === 'water' || h.t === 'shoal', `${h.q},${h.r} ${h.t} in ${a}`);
  }
  // The capital is one region; the Fake Port seeds nothing.
  assert.equal(landKeys.filter((a) => a.includes('CapitalCity')).length, 1);
  assert.equal(Object.keys(sizes).some((a) => a.includes('FakePort')), false);
});

test('a small region joins the neighbour it touches most; a lone one stays', () => {
  const land = (q, r, extra = {}) => ({ q, r, t: 'grasslands', ...extra });
  // Nine hexes in a row, town A at one end and B at the other: A takes 5 (the middle on a tie, by name), B 4, which
  // is under the minimum, so B joins A.
  const row = [land(0, 0, { poi: 'A', f: ['city'] }), land(1, 0), land(2, 0), land(3, 0), land(4, 0), land(5, 0),
    land(6, 0), land(7, 0), land(8, 0, { poi: 'B', f: ['city'] })];
  assert.deepEqual(P.areaSizes(P.areas(row, {})), { land_A: 9 });
  // An island town of 2 hexes far away keeps its region.
  const island = [...row, land(20, 0, { poi: 'C', f: ['city'] }), land(21, 0)];
  assert.deepEqual(P.areaSizes(P.areas(island, {})), { land_A: 9, land_C: 2 });
});

test('the save: clean keys and whole counts, adding reports the levels before and after', () => {
  assert.deepEqual(P.cleanPilotage({ sea_VibrantPort: 12, land_OldVillage: 0, bad: 3, sea_X: -1, land_Y: 1.5, 'sea_a-b': 2 }), { sea_VibrantPort: 12, land_OldVillage: 0 });
  assert.deepEqual(P.cleanPilotage(null), {});
  assert.deepEqual(P.cleanPilotage([1]), {});
  const rec = {};
  assert.deepEqual(P.addHexes(rec, 'sea_VibrantPort', 1), { before: 1, after: P.levelOf(1) });
  P.addHexes(rec, 'sea_VibrantPort', P.hexesFor(20) - 1);
  assert.equal(rec.sea_VibrantPort, P.hexesFor(20));
  assert.equal(P.levelOf(rec.sea_VibrantPort), 20);
  assert.equal(P.addHexes(rec, 'nowhere', 1), undefined);
  assert.equal(P.addHexes(rec, 'sea_VibrantPort', 0), undefined);
});
