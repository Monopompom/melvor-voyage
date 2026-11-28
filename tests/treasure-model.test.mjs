import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from '../src/treasure-model.mjs';
import * as PM from '../src/pilotage-model.mjs';
import * as CM from '../src/charts-model.mjs';
import { directionLabel } from '../src/terrain.mjs';

const hexes = JSON.parse(readFileSync(new URL('../data/hex_terrain.json', import.meta.url), 'utf8')).hexes;
const regions = PM.areas(hexes, CM.seas(hexes, PM.SKIP));
const P = T.prepare(hexes, regions);
const key = (h) => `${h.q},${h.r}`;
const seeded = (s) => { let a = T.hash(s); return () => ((a = (Math.imul(a, 1103515245) + 12345) >>> 0) / 4294967296); };
/** A clue for every diggable hex at a grade (five seeds tried each): { found: Map key -> facts, missed }. */
const sweep = (g) => {
  const found = new Map();
  let missed = 0;
  for (const h of P.dig) {
    let f;
    for (let i = 0; i < 5 && f === undefined; i++) f = T.clueFor(h, g, P, seeded(`${key(h)}|${g}|${i}`));
    if (f === undefined) missed++;
    else found.set(key(h), f);
  }
  return { found, missed };
};
const sweeps = { 1: sweep(1), 2: sweep(2), 3: sweep(3) };

test('a treasure lies only on diggable ground: never water, cloud, a place, an area or a dungeon', () => {
  assert.ok(P.dig.length > 300, `${P.dig.length} hexes`);
  for (const h of P.dig) {
    assert.ok(T.DIG_CLASSES.includes(h.t));
    assert.ok(h.cloud !== true && h.poi === undefined && h.area === undefined && h.dungeon === undefined);
  }
  assert.ok(!T.diggable({ q: 0, r: 0, t: 'water' }));
  assert.ok(!T.diggable({ q: 0, r: 0, t: 'grasslands', poi: 'Town' }));
  assert.ok(T.diggable({ q: 0, r: 0, t: 'shoal' }));
});

test('every clue fits its own hex and no other hex on the whole map', () => {
  for (const g of T.GRADES) {
    for (const [k, facts] of sweeps[g].found) {
      const fit = T.answers(facts, P);
      assert.equal(fit.length, 1, `grade ${g} at ${k}: ${fit.length} hexes fit`);
      assert.equal(key(fit[0]), k);
      assert.ok(facts.length <= T.MAX_FACTS[g]);
      assert.equal(facts[0].k, 'class', 'the ground first');
    }
  }
});

test('every diggable hex can be a grade 1 treasure; most can be grade 2 and 3 (the rest are rolled again)', () => {
  assert.equal(sweeps[1].missed, 0);
  assert.ok(sweeps[2].found.size >= P.dig.length * 0.9, `grade 2: ${sweeps[2].found.size}`);
  assert.ok(sweeps[3].found.size >= P.dig.length * 0.8, `grade 3: ${sweeps[3].found.size}`);
});

test('the grade sets the words: names and bearings at 1, kinds of landmark at 2, ranges at 3', () => {
  const kinds = (g) => new Set([...sweeps[g].found.values()].flat().map((x) => x.k));
  for (const k of kinds(1)) assert.ok(['class', 'from', 'dir', 'look', 'coast', 'region'].includes(k), `grade 1: ${k}`);
  for (const k of kinds(2)) assert.ok(['class', 'near', 'look', 'coast', 'region'].includes(k), `grade 2: ${k}`);
  for (const k of kinds(3)) assert.ok(['class', 'range', 'look', 'coast', 'region'].includes(k), `grade 3: ${k}`);
  assert.ok(kinds(1).has('from') && kinds(1).has('dir'));
  assert.ok(kinds(2).has('near'));
  assert.ok(kinds(3).has('range'));
  for (const f of [...sweeps[3].found.values()].flat().filter((x) => x.k === 'range')) assert.equal(f.hi - f.lo, T.RANGE_SPAN);
});

test('a grade 1 map lies on a hex you know, a grade 2 within two hexes of one; one id, one map', () => {
  const known = new Set(P.dig.filter((_h, i) => i % 7 === 0).map(key));
  for (let i = 0; i < 30; i++) {
    const m1 = T.readMap(`Tester|${i}`, 1, P, known);
    assert.ok(known.has(`${m1.q},${m1.r}`));
    const m2 = T.readMap(`Tester|${i}`, 2, P, known);
    if (m2.grade === 2) assert.ok([...known].some((k) => { const [q, r] = k.split(',').map(Number); return T.hexDist({ q, r }, m2) <= 2; }));
    const m3 = T.readMap(`Tester|${i}`, 3, P, known);
    assert.deepEqual(T.readMap(`Tester|${i}`, 3, P, known), m3);
    assert.deepEqual(T.answers(m3.facts, P).map(key), [`${m3.q},${m3.r}`]);
  }
  assert.notDeepEqual(T.readMap('a', 3, P, known), T.readMap('b', 3, P, known));
  assert.equal(T.readMap('x', 1, P, new Set()), undefined, 'nothing known: no grade 1 map');
});

test('a grade 1 clue names only the places you know', () => {
  const named = new Set(['RuinedSilverCity', 'MistyPort']);
  for (const h of P.dig.slice(0, 120)) {
    const f = T.clueFor(h, 1, P, seeded(key(h)), named);
    for (const x of f ?? []) if (x.place !== undefined) assert.ok(named.has(x.place));
  }
});

test('the bearing is the terrain\'s own', () => {
  for (let i = 0; i < 400; i++) {
    const a = hexes[(i * 37) % hexes.length];
    const b = hexes[(i * 91 + 5) % hexes.length];
    assert.equal(T.bearing(a, b), directionLabel(a, b));
  }
});

test('a fact from the save keeps its kind\'s fields only and drops junk', () => {
  assert.deepEqual(T.cleanFact({ k: 'near', kind: 'temple', d: 3, extra: 1 }), { k: 'near', kind: 'temple', d: 3 });
  assert.deepEqual(T.cleanFact({ k: 'coast' }), { k: 'coast' });
  assert.equal(T.cleanFact({ k: 'dir', place: 'MistyPort', dir: 'UP' }), undefined);
  assert.equal(T.cleanFact({ k: 'near', kind: '<b>', d: 3 }), undefined);
  assert.equal(T.cleanFact({ k: 'range', kind: 'ruin', lo: -1, hi: 1 }), undefined);
  assert.equal(T.cleanFact({ k: 'what' }), undefined);
  assert.equal(T.cleanFact(null), undefined);
});

test('maps held from the save: bad entries dropped, at most five, a dig only for a map held, counts kept', () => {
  const good = { id: 'm1', grade: 2, q: 3, r: -4, facts: [{ k: 'class', t: 'desert' }, { k: 'near', kind: 'temple', d: 2 }], dug: [[1, 1], [1, 1], ['x', 2], [2, 2]], at: 5 };
  const raw = {
    n: 9, found: 2, lost: 1,
    held: [good, { ...good }, { ...good, id: 'm2', grade: 4 }, { ...good, id: 'm3', facts: [{ k: 'what' }] }, { ...good, id: 'bad id' },
      ...[4, 5, 6, 7, 8].map((i) => ({ ...good, id: `m${i}` }))],
    left: [{ q: 1, r: 2, grade: 3, band: 'corsairs' }, { q: 1, r: 2, grade: 3, band: 'corsairs' }, { q: 0, r: 0, grade: 3, band: '<b>' }],
    dig: { id: 'm1', q: 3, r: -4, start: 10, end: 20 },
  };
  const m = T.cleanMaps(raw);
  assert.deepEqual(m.held.map((x) => x.id), ['m1', 'm4', 'm5', 'm6', 'm7']);
  assert.deepEqual(m.held[0].dug, [[1, 1], [2, 2]]);
  assert.deepEqual(m.left, [{ q: 1, r: 2, grade: 3, band: 'corsairs' }]);
  assert.deepEqual(m.dig, { id: 'm1', q: 3, r: -4, start: 10, end: 20 });
  assert.deepEqual([m.n, m.found, m.lost], [9, 2, 1]);
  assert.equal(T.cleanMaps({ ...raw, dig: { ...raw.dig, id: 'm9' } }).dig, undefined, 'a dig for a map not held goes');
  assert.deepEqual(T.cleanMaps(null), { n: 0, held: [], left: [], found: 0, lost: 0 });
  assert.deepEqual(T.cleanMaps('junk'), { n: 0, held: [], left: [], found: 0, lost: 0 });
});

test('a dig: the right hex finds it, a wrong one is nothing, the third wrong one ends the map', () => {
  const m = { q: 5, r: 5, dug: [] };
  assert.equal(T.digOutcome(m, { q: 5, r: 5 }), 'found');
  assert.equal(T.digOutcome(m, { q: 1, r: 1 }), 'nothing');
  assert.equal(T.digOutcome({ ...m, dug: [[1, 1]] }, { q: 2, r: 2 }), 'nothing');
  assert.equal(T.digOutcome({ ...m, dug: [[1, 1], [2, 2]] }, { q: 3, r: 3 }), 'apart');
  assert.equal(T.digOutcome({ ...m, dug: [[1, 1], [2, 2]] }, { q: 5, r: 5 }), 'found', 'two wrong digs still find it');
});

test('prizes by grade: GP in purses, Pitch in its span, the extra rolls on their own', () => {
  const r0 = () => 0;
  const r1 = () => 0.999;
  assert.deepEqual(T.prizeOf(1, 2000, r1), { gp: 6000, pitch: 30, extra: [] });
  assert.deepEqual(T.prizeOf(1, 2000, r0), { gp: 6000, pitch: 10, extra: ['bankslot'] });
  assert.deepEqual(T.prizeOf(2, 5000, r0), { gp: 30000, pitch: 30, extra: ['card', 'token'] });
  assert.deepEqual(T.prizeOf(3, 12000, r1), { gp: 144000, pitch: 200, extra: ['relic'] }, 'a relic roll always comes with grade 3');
  assert.deepEqual(T.prizeOf(3, 12000, r0).extra, ['card', 'signet', 'relic']);
  assert.equal(T.prizeOf(2, NaN, r1).gp, 0);
});

test('items, grades and tiers: each map item is its grade, a tier gives its grade, reading needs the level', () => {
  assert.deepEqual(Object.values(T.MAP_ITEMS).map(T.gradeOfItem), [1, 2, 3]);
  assert.equal(T.gradeOfItem('voyage:Captains_Map'), 3);
  assert.equal(T.gradeOfItem('voyage:Tent'), undefined);
  assert.deepEqual([1, 2, 3, 4].map(T.gradeOfTier), [1, 1, 2, 3]);
  assert.deepEqual([T.READ_LEVEL[2], T.READ_LEVEL[3]], [40, 80]);
  assert.ok(T.DIG_MS[1] < T.DIG_MS[2] && T.DIG_MS[2] < T.DIG_MS[3]);
});
