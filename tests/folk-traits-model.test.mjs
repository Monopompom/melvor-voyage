import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRAITS, TRAIT_NS, fullId, shortId, traitDef, SOURCES, emptyFolkTraits, addProgress, resetProgress, due, earned, lost,
  travelEffects, folksEffects, cleanFolkTraits, moveOps, walkOps, pacedRoad, outpostSale, haggle, nearSale, saleLearner, SALE_MIN_GP,
  knownTraits,
  traitVars,
} from '../src/folk-traits-model.mjs';
import { ROUGH, HARD } from '../src/walk-model.mjs';
import { ROUGH_GROUND } from '../src/stores-model.mjs';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const none = { has: () => false };
const holding = (...ids) => ({ has: (id) => ids.includes(id) });

test('the table: 4 good, 4 mixed, 2 bad, ids unique, each learned by something and drawn', () => {
  const kinds = TRAITS.reduce((m, t) => ({ ...m, [t.kind]: (m[t.kind] ?? 0) + 1 }), {});
  assert.deepEqual(kinds, { good: 4, mixed: 4, bad: 2 });
  assert.equal(new Set(TRAITS.map((t) => t.id)).size, TRAITS.length);
  TRAITS.forEach((t) => {
    assert.ok(t.learn.target > 0, t.id);
    assert.match(t.id, /^[A-Za-z]+$/);
    assert.match(t.icon, /^trait_[a-z]+$/);
  });
  // The bad ones fade by a count of their own; the rest stay for good.
  assert.deepEqual(TRAITS.filter((t) => t.fade !== undefined).map((t) => t.id), ['Seasick', 'Footsore']);
  assert.equal(TRAIT_NS, 'voyage');
  assert.equal(fullId('Hardy'), 'voyage:Hardy');
  assert.equal(shortId('voyage:Hardy'), 'Hardy');
  assert.equal(shortId('Loyal'), undefined);
  assert.equal(traitDef('voyage:Merchant').effects.sellAtOutpost, 50);
  assert.equal(traitDef('Nope'), undefined);
  assert.ok(SOURCES.includes('seaBerth') && SOURCES.includes('moved') && SOURCES.includes('calmSea'));
});

test('learning: counts add up for traits the Folk lacks, then are due once', () => {
  const rec = emptyFolkTraits();
  addProgress(rec, 'seaBerth', 150, none);
  assert.deepEqual(due(rec, none), { earn: [], fade: [] });
  addProgress(rec, 'seaBerth', 50, none);
  addProgress(rec, 'seaBerth', -5, none);
  assert.deepEqual(due(rec, none).earn, ['Seafarer']);
  earned(rec, 'Seafarer');
  assert.equal(rec.counts.Seafarer, undefined);
  // Held: no more learning count.
  addProgress(rec, 'seaBerth', 500, holding('Seafarer'));
  assert.deepEqual(rec.counts, {});
  // One source can teach two traits (any travel counts for Wanderer; walking alone for Navigator too).
  addProgress(rec, 'travelled', 300, none);
  addProgress(rec, 'walkAlone', 150, none);
  assert.deepEqual(due(rec, none).earn, ['Navigator', 'Wanderer']);
});

test('in a row: Homebody restarts when the Folk moves, and remembers its hex', () => {
  const rec = emptyFolkTraits();
  addProgress(rec, 'workOneHex', 6 * DAY, none);
  resetProgress(rec, 'moved');
  assert.equal(rec.counts.Homebody, undefined);
  addProgress(rec, 'workOneHex', 7 * DAY, none);
  assert.deepEqual(due(rec, none).earn, ['Homebody']);
  earned(rec, 'Homebody', { hex: '14,16' });
  assert.equal(rec.home, '14,16');
  earned(rec, 'Homebody', { hex: 'nowhere' });
  assert.equal(rec.home, '14,16', 'a bad hex is not kept');
  lost(rec, 'Homebody');
  assert.equal(rec.home, '');
});

test('fading: Seasick fades after 100 calm sea hexes, a storm restarts them; Footsore after 3 days on one hex', () => {
  const rec = emptyFolkTraits();
  addProgress(rec, 'storm', 1, none);
  assert.deepEqual(due(rec, none).earn, ['Seasick']);
  earned(rec, 'Seasick');
  const sick = holding('Seasick');
  addProgress(rec, 'calmSea', 99, sick);
  resetProgress(rec, 'storm');
  addProgress(rec, 'calmSea', 99, sick);
  assert.deepEqual(due(rec, sick).fade, []);
  addProgress(rec, 'calmSea', 1, sick);
  assert.deepEqual(due(rec, sick), { earn: [], fade: ['Seasick'] });
  lost(rec, 'Seasick');
  assert.deepEqual(rec.counts, {});
  // Footsore: learned by hungry land hexes, gone after three days on one hex in a row.
  addProgress(rec, 'hungryLand', 10, none);
  earned(rec, 'Footsore');
  const sore = holding('Footsore');
  addProgress(rec, 'oneHexRest', 2 * DAY, sore);
  resetProgress(rec, 'moved');
  addProgress(rec, 'oneHexRest', 3 * DAY, sore);
  assert.deepEqual(due(rec, sore).fade, ['Footsore']);
  // A fade count never runs for a trait the Folk doesn't have.
  addProgress(rec, 'calmSea', 500, sore);
  assert.equal(rec.counts['Seasick.fade'], undefined);
});

test('travelEffects: walking pace and food, by ground and time of day', () => {
  const plain = travelEffects([]);
  assert.deepEqual(plain, { walkSpeed: 1, roadFood: 1, seaFood: 1, sales: 0, sellAtOutpost: 0 });
  assert.deepEqual(travelEffects(undefined), plain);
  assert.equal(travelEffects(['voyage:Navigator']).walkSpeed, 1.25);
  const hardy = travelEffects(['Hardy'], { rough: true });
  assert.equal(hardy.walkSpeed, 1.25);
  assert.equal(hardy.roadFood, 0.75);
  assert.equal(travelEffects(['Hardy']).walkSpeed, 1, 'Hardy counts only on rough ground');
  // Stargazer: faster by night, slower by day; with Wanderer it adds up.
  assert.equal(travelEffects(['Stargazer'], { night: true }).walkSpeed, 1.25);
  assert.equal(travelEffects(['Stargazer']).walkSpeed, 0.9);
  const wander = travelEffects(['Wanderer', 'Stargazer'], { night: true });
  assert.equal(wander.walkSpeed, 1.5);
  assert.equal(wander.roadFood, 1.25);
  assert.equal(travelEffects(['Homebody', 'Footsore']).walkSpeed, 0.5);
  assert.equal(travelEffects(['Seasick']).seaFood, 1.5);
  assert.equal(travelEffects(['Seafarer']).seaFood, 0.75);
  assert.equal(travelEffects(['Seafarer', 'Seasick']).seaFood, 1.25, 'a seasick Seafarer still eats more');
  assert.equal(travelEffects(['Haggler']).sales, 5);
  assert.equal(travelEffects(['Merchant']).sellAtOutpost, 0.5);
  assert.equal(travelEffects(['Loyal', 'voyage:Gone']).walkSpeed, 1);
});

test('folksEffects: Haggler wage; Homebody XP only on its own hex', () => {
  const rec = { counts: {}, home: '14,16' };
  assert.deepEqual(folksEffects('voyage:Haggler', rec, null), { wage: 20 });
  assert.deepEqual(folksEffects('voyage:Haggler', rec, null, { nearMarket: false }), {}, 'the wage only within a hex of a market');
  assert.deepEqual(folksEffects('voyage:Homebody', rec, { q: 14, r: 16 }), { xp: 10 });
  assert.deepEqual(folksEffects('voyage:Homebody', rec, { q: 15, r: 16 }), {});
  assert.deepEqual(folksEffects('voyage:Homebody', undefined, { q: 14, r: 16 }), {});
  assert.deepEqual(folksEffects('voyage:Seafarer', rec, null), {});
});

test('cleanFolkTraits: known counts and a real hex kept, junk dropped', () => {
  assert.deepEqual(cleanFolkTraits(null), {});
  assert.deepEqual(cleanFolkTraits([]), {});
  assert.deepEqual(cleanFolkTraits({
    f1: { counts: { Seafarer: 12, 'Seasick.fade': 3, 'Hardy.fade': 2, Loyal: 5, Navigator: -1, Wanderer: 'x' }, home: '3,-4' },
    f2: { counts: {}, home: 'x' },
    '': { counts: { Seafarer: 1 } },
    f3: 'nope',
  }), { f1: { counts: { Seafarer: 12, 'Seasick.fade': 3 }, home: '3,-4' } });
});

test('travel traits: with no night in the game Stargazer neither gains nor loses', () => {
  assert.equal(travelEffects(['Stargazer'], { night: null }).walkSpeed, 1);
  assert.equal(travelEffects(['Stargazer', 'Navigator'], { night: null }).walkSpeed, 1.25);
});

test('travel traits: a move at sea counts berth hexes, storms and the calm after the last storm', () => {
  const sea = (storm) => ({ cls: 'water', sea: true, storm });
  const ops = moveOps([sea(), sea(), sea(3), sea(), { hop: 4 }]);
  assert.deepEqual(ops, [
    { reset: 'moved' }, { source: 'travelled', amount: 8 }, { source: 'seaBerth', amount: 8 },
    { source: 'storm', amount: 1 }, { reset: 'storm' }, { source: 'calmSea', amount: 5 },
  ]);
  assert.deepEqual(moveOps([sea(), sea()]).at(-1), { source: 'calmSea', amount: 2 });
  assert.deepEqual(moveOps([]), []);
  assert.deepEqual(moveOps(undefined), []);
});

test('travel traits: a move on land counts rough hexes on foot and hungry ones', () => {
  const isRough = (cls) => ROUGH_GROUND.includes(cls);
  const ops = moveOps([{ cls: 'mountain' }, { cls: 'grasslands', hungry: true }, { cls: 'snowlands', hungry: true }], { isRough });
  assert.deepEqual(ops, [
    { reset: 'moved' }, { source: 'travelled', amount: 3 }, { source: 'roughFoot', amount: 2 }, { source: 'hungryLand', amount: 2 },
  ]);
});

test('travel traits: a learned Seasick fades only with the calm after its storm', () => {
  const rec = emptyFolkTraits();
  let held = [];
  const has = (id) => held.includes(id);
  for (const op of moveOps([{ sea: true, storm: 3 }, ...Array(100).fill({ sea: true })])) {
    if (op.reset !== undefined) { resetProgress(rec, op.reset); continue; }
    addProgress(rec, op.source, op.amount, { has });
    for (const id of due(rec, { has }).earn) { held.push(id); earned(rec, id); }
  }
  assert.ok(held.includes('Seasick'));
  assert.deepEqual(due(rec, { has }).fade, ['Seasick']);
});

test('travel traits: a lone walk counts its hexes, the rough ones and the time walked by night', () => {
  const isRough = (cls) => ROUGH_GROUND.includes(cls);
  const ops = walkOps([{ cls: 'grasslands', ms: 100, night: true }, { cls: 'desert', ms: 150, night: false }, { cls: 'lavalands', ms: 200, night: true }], { isRough });
  assert.deepEqual(ops, [
    { source: 'walkAlone', amount: 3 }, { source: 'travelled', amount: 3 }, { source: 'roughFoot', amount: 2 }, { source: 'nightRoad', amount: 300 },
  ]);
  assert.deepEqual(walkOps([{ cls: 'grasslands', ms: 100, night: null }]).map((o) => o.source), ['walkAlone', 'travelled']);
  assert.deepEqual(walkOps([]), []);
});

test('travel traits: a road at the walker pace divides each hex by its speed at the moment it is entered', () => {
  const road = [{ q: 0, r: 1, cls: 'grasslands', ms: 1000 }, { q: 0, r: 2, cls: 'mountain', ms: 1500 }, { q: 0, r: 3, cls: 'grasslands', ms: 1000 }];
  const seen = [];
  const out = pacedRoad(road, 10, (st, at) => { seen.push(at); return st.cls === 'mountain' ? 1.5 : 2; });
  assert.deepEqual(out.map((s) => s.ms), [500, 1000, 500]);
  assert.deepEqual(seen, [10, 510, 1510]);
  assert.deepEqual(out[1], { q: 0, r: 2, cls: 'mountain', ms: 1000 });
  assert.deepEqual(pacedRoad(road, 0, () => 1), road);
  assert.deepEqual(pacedRoad(road, 0, () => NaN), road);
});

test('travel traits: rough ground for food is the rough and hard ground of walks', () => {
  assert.deepEqual([...ROUGH_GROUND].sort(), [...ROUGH, ...HARD].sort());
});

test('travel traits: a Merchant standing on an outpost within a hex buys at its rate; nobody else does', () => {
  const tent = { q: 4, r: 4, name: 'Iron Hills' };
  const mira = { id: 'm', place: { q: 4, r: 4 }, travel: 'idle', traits: ['voyage:Merchant'] };
  assert.deepEqual(outpostSale([tent], [mira]), { rate: 0.5, folk: mira, outpost: tent });
  assert.equal(outpostSale([tent], [{ ...mira, place: { q: 4, r: 5 } }]), undefined, 'on the outpost itself');
  assert.equal(outpostSale([tent], [{ ...mira, travel: 'with' }]), undefined, 'not one with you');
  assert.equal(outpostSale([tent], [{ ...mira, travel: 'walking' }]), undefined, 'not one on the road');
  assert.equal(outpostSale([tent], [{ ...mira, traits: ['Haggler'] }]), undefined);
  assert.equal(outpostSale([], [mira]), undefined);
});

test('travel traits: one Haggler within a hex adds its percent; two do not add up; none on the road', () => {
  const here = { q: 0, r: 0 };
  const at = (f) => f.place;
  const a = { place: { q: 1, r: 0 }, travel: 'idle', traits: ['voyage:Haggler'] };
  const b = { place: { q: 0, r: 1 }, travel: 'idle', traits: ['Haggler'] };
  assert.equal(haggle([a, b], here, at).pct, 5);
  assert.equal(haggle([{ ...a, place: { q: 2, r: 0 } }], here, at), undefined);
  assert.equal(haggle([{ ...a, travel: 'walking' }], here, at), undefined);
  assert.equal(haggle([a], undefined, at), undefined);
  assert.equal(nearSale([a, { ...b, travel: 'walking' }, { place: { q: 3, r: 3 }, travel: 'idle' }], here, at).length, 1);
  const atOrHere = (f) => (f.travel === 'with' ? here : f.place);
  assert.equal(saleLearner([{ place: { q: 1, r: 0 }, travel: 'idle', id: 'near' }, { place: null, travel: 'with', id: 'with' }], here, atOrHere)?.id, 'with', 'one Folk learns from a sale: the one with you first');
  assert.equal(saleLearner([{ place: { q: 3, r: 3 }, travel: 'idle' }], here, at), undefined);
  assert.ok(SALE_MIN_GP > 0);
});

test('travel traits: the known ones are those some Folk holds, in table order, other mods and junk left out', () => {
  const folks = [{ traits: ['voyage:Haggler', 'worker_folks:QuickLearner'] }, { traits: ['Seafarer', 'voyage:Haggler'] }, { traits: null }, null];
  assert.deepEqual(knownTraits(folks), ['Seafarer', 'Haggler']);
  assert.deepEqual(knownTraits([]), []);
  assert.deepEqual(knownTraits(undefined), []);
});

test('every trait text names its numbers from the table, and every number it names is filled', async () => {
  const { readFile } = await import('node:fs/promises');
  const en = JSON.parse(await readFile(new URL('../languages/en.json', import.meta.url), 'utf8'));
  assert.deepEqual(traitVars('Merchant'), { sellAtOutpost: '50' });
  assert.deepEqual(traitVars('voyage:Haggler'), { sales: '5', wage: '20' });
  assert.equal(traitVars('Footsore').walk, '25', 'slower reads as a positive percent');
  assert.equal(traitVars('Footsore').fade, '3', 'days');
  assert.equal(traitVars('Seasick').fade, '100', 'hexes');
  assert.deepEqual(traitVars('Nope'), {});
  for (const def of TRAITS) {
    const vars = traitVars(def.id);
    for (const key of [`MOD_VOY_TRAIT_${def.id}_DESC`, ...(def.fade ? [`MOD_VOY_TRAIT_${def.id}_FADES`] : [])]) {
      for (const [, name] of en[key].matchAll(/\$\{(\w+)\}/g)) assert.ok(name in vars, `${key}: \${${name}}`);
    }
  }
});
