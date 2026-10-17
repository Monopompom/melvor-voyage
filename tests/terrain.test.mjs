import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  fnv1a, waterHash, checkTable, createTerrain, hexDistance, nearest, directionLabel, CLASSES, FEATURES, CLASS_INFO,
  FEATURE_INFO, isSea, isCloud, hasFeature, areaLabel, hexKey, nearestIn, createNearestFinder,
} from '../src/terrain.mjs';
import * as rules from '../src/rules.mjs';

const table = JSON.parse(readFileSync(new URL('../data/hex_terrain.json', import.meta.url), 'utf8'));
const live = { mapId: table.meta.mapId, hexes: table.hexes.map((h) => ({ q: h.q, r: h.r, isWater: h.t === 'water' })) };

test('fnv1a matches the reference vectors', () => {
  assert.equal(fnv1a(''), '811c9dc5');
  assert.equal(fnv1a('a'), 'e40c292c');
  assert.equal(fnv1a('foobar'), 'bf9cf968');
});

test('the shipped table hashes to its own meta.waterHash (same spec as schema.py)', () => {
  assert.equal(waterHash(live.hexes), table.meta.waterHash);
  assert.equal(table.meta.hexCount, table.hexes.length);
  assert.equal(table.meta.mapId, 'melvorAoD:Melvor'); // the registered id, not the data package's bare 'Melvor'
  assert.deepEqual(table.meta.classes, CLASSES);
  assert.deepEqual(table.meta.features, FEATURES);
  assert.deepEqual(Object.keys(CLASS_INFO), CLASSES);
  assert.ok(FEATURES.every((f) => typeof FEATURE_INFO[f]?.label === 'string'));
  for (const h of table.hexes) {
    assert.ok(CLASSES.includes(h.t), `${h.q},${h.r} class ${h.t}`);
    for (const f of h.f ?? []) assert.ok(FEATURES.includes(f), `${h.q},${h.r} feature ${f}`);
    if (h.area !== undefined) assert.ok(table.meta.areas[h.area], `${h.q},${h.r} area ${h.area}`);
    if (h.dungeon !== undefined) assert.ok(table.meta.dungeons[h.dungeon], `${h.q},${h.r} dungeon ${h.dungeon}`);
  }
});

test('checkTable accepts the live map it was built from and rejects drift', () => {
  assert.deepEqual(checkTable(table, live), { ok: true, reasons: [] });
  const flipped = { ...live, hexes: live.hexes.map((h, i) => (i === 0 ? { ...h, isWater: !h.isWater } : h)) };
  assert.equal(checkTable(table, flipped).ok, false);
  assert.equal(checkTable(table, { ...live, hexes: live.hexes.slice(1) }).ok, false);
  assert.equal(checkTable(table, { ...live, mapId: 'other' }).ok, false);
  assert.equal(checkTable({}, live).ok, false);
});

test('createTerrain indexes rows and returns undefined for unknown hexes', () => {
  const t = createTerrain(table);
  assert.equal(t.size, 944);
  assert.equal(t.get(9, 12).t, 'grasslands'); // Wet Forest: grasslands with the forest feature
  assert.equal(t.get(9, 12).poi, 'WetForest');
  assert.ok(hasFeature(t.get(9, 12), 'forest'));
  assert.equal(t.get(16, 0).t, 'swamplands'); // Toxic Swamps
  assert.ok(hasFeature(t.get(16, 0), 'swamp'));
  assert.equal(t.get(2, 27).area, 'UnderwaterRuins'); // on the Melantis hex
  assert.equal(t.get(2, 27).poi, 'Melantis');
  assert.ok(isSea(t.get(2, 27)) && isCloud(t.get(2, 27)));
  assert.equal(t.get(17, 17).area, 'CollapsedCity');
  assert.equal(t.get(17, 17).dungeon, 'WaterGodDungeon');
  assert.equal(t.get(2, 26).area, 'IntoTheAbyss');
  assert.equal(Object.keys(table.meta.dungeons).length, 29);
  assert.equal(t.get(999, 999), undefined);
  assert.ok(!isSea(undefined) && !isCloud(undefined) && !hasFeature(undefined, 'forest'));
  assert.equal(areaLabel('StrongholdOfTheGods'), 'Stronghold Of The Gods');
  assert.equal(areaLabel('ANewStart'), 'A New Start');
});

test('indexes: unique numeric keys, class/feature/poi/area/dungeon lookups', () => {
  const keys = new Set(table.hexes.map((h) => hexKey(h.q, h.r)));
  assert.equal(keys.size, table.hexes.length);
  const t = createTerrain(table);
  assert.equal(t.withClass('water').length, 417);
  assert.equal(t.withFeature('forest').length, 103);
  assert.ok(t.withFeature('forest').every((h) => hasFeature(h, 'forest')));
  assert.deepEqual(t.withClass('nope'), []);
  assert.equal(t.poi('WetForest').q, 9);
  assert.equal(t.area('Farmlands').length, 3);
  assert.equal(t.dungeon('ThroneOfTheHerald').poi, 'Monolith');
  assert.equal(t.poi('nope'), undefined);
});

test('nearest finder uses the indexes, respects cloud and memoises', () => {
  const t = createTerrain(table);
  const find = createNearestFinder(t, rules);
  const full = nearest(t, { q: 16, r: 8 }, (rec) => rules.allowedAt('melvorD:Woodcutting', rec));
  const fast = find('melvorD:Woodcutting', { q: 16, r: 8 });
  assert.equal(fast.distance, full.distance);
  assert.ok(rules.allowedAt('melvorD:Woodcutting', fast.hex));
  assert.ok(!fast.hex.cloud);
  assert.strictEqual(find('melvorD:Woodcutting', { q: 16, r: 8 }), fast);
  assert.equal(find('melvorD:Astrology', { q: 16, r: 8 }), undefined); // no rule, no candidates
  assert.equal(nearestIn([], { q: 0, r: 0 }), undefined);
});

test('nearest finder only returns known hexes and forgets its memo when knowledge changes', () => {
  const t = createTerrain(table);
  const known = new Set();
  const knowledge = { version: 1, isKnown: (rec) => known.has(hexKey(rec.q, rec.r)) };
  const find = createNearestFinder(t, rules, knowledge);
  assert.equal(find('melvorD:Woodcutting', { q: 16, r: 8 }), undefined); // nothing known yet
  known.add(hexKey(9, 12)); // Wet Forest learned
  assert.equal(find('melvorD:Woodcutting', { q: 16, r: 8 }), undefined); // memo still says nothing...
  knowledge.version++;
  assert.equal(find('melvorD:Woodcutting', { q: 16, r: 8 }).hex.poi, 'WetForest'); // ...until the version moves
  const all = createNearestFinder(t, rules)('melvorD:Woodcutting', { q: 16, r: 8 });
  assert.ok(all.distance <= hexDistance({ q: 16, r: 8 }, { q: 9, r: 12 }));
});

test('hex distance, nearest and direction', () => {
  assert.equal(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 }), 0);
  assert.equal(hexDistance({ q: 0, r: 0 }, { q: 1, r: -1 }), 1);
  assert.equal(hexDistance({ q: 15, r: 9 }, { q: 11, r: 8 }), 5);
  const t = createTerrain(table);
  const near = nearest(t, { q: 15, r: 9 }, (rec) => hasFeature(rec, 'forest'));
  assert.ok(near.distance >= 1 && near.distance <= 3);
  assert.ok(hasFeature(near.hex, 'forest'));
  assert.equal(nearest(t, { q: 15, r: 9 }, () => false), undefined);
  assert.equal(directionLabel({ q: 0, r: 0 }, { q: 1, r: 0 }), 'SE');
  assert.equal(directionLabel({ q: 0, r: 0 }, { q: 0, r: -1 }), 'N');
  assert.equal(directionLabel({ q: 0, r: 0 }, { q: 0, r: 1 }), 'S');
  assert.equal(directionLabel({ q: 0, r: 0 }, { q: -1, r: 0 }), 'NW');
  assert.equal(directionLabel({ q: 0, r: 0 }, { q: 0, r: 0 }), '');
});

test('phase 2 indexes: neighbours, places (areas, dungeons, POI-backed areas, Into the Abyss wildcard), landmasses', async () => {
  const { createTerrain, candidatesFor, NEIGHBOURS } = await import('../src/terrain.mjs');
  const rules = await import('../src/rules.mjs');
  const terrain = createTerrain(table);
  assert.equal(NEIGHBOURS.length, 6);
  const start = terrain.get(15, 9);
  assert.ok(start, 'start hex');
  const nbs = terrain.neighbours(15, 9);
  assert.equal(nbs.length, 6);
  assert.ok(nbs.every((n) => Math.abs(n.q - 15) <= 1 && Math.abs(n.r - 9) <= 1));
  assert.equal(terrain.neighbours(-50, 0).length, 0);
  // places
  assert.equal(Object.keys(table.meta.poiAreas).length, 20);
  for (const id of ['EyeConicCave', 'MuckyCave', 'RitualSite', 'LostTemple', 'ShipwreckCove']) {
    assert.equal(terrain.placesFor(`melvorAoD:${id}`).length, 1, `AoD area ${id} on its POI`);
  }
  assert.ok(terrain.placesFor('melvorD:Farmlands').length >= 1, 'hand-placed area');
  assert.ok(terrain.placesFor('melvorD:Chicken_Coop').length === 1, 'dungeon');
  assert.ok(terrain.placesFor('melvorD:Goblin_Village').length === 1, 'POI-backed area');
  assert.equal(terrain.placesFor('melvorD:Goblin_Village')[0].poi, 'GolbinVillage');
  assert.ok(terrain.placesFor('melvorItA:Any_Abyssal_Area').length === 1, 'wildcard');
  assert.equal(terrain.placesFor('melvorItA:Any_Abyssal_Area')[0].area, 'IntoTheAbyss');
  assert.equal(terrain.placesFor('melvorD:Nowhere').length, 0);
  // landmasses: the start hex and Farmlands share one; water has none; the snow island differs from the mainland
  const mainland = terrain.landmass(15, 9);
  assert.notEqual(mainland, undefined);
  assert.equal(terrain.landmass(15, 9), terrain.landmass(13, 10));
  assert.equal(terrain.landmass(0, 0), terrain.get(0, 0).t === 'water' ? undefined : terrain.landmass(0, 0));
  assert.notEqual(terrain.landmass(15, 18), mainland, 'snow island is its own landmass');
  const masses = new Set();
  for (const h of terrain.all()) { const m = terrain.landmass(h.q, h.r); if (m !== undefined) masses.add(m); }
  assert.ok(masses.size > 1 && masses.size < 100, `landmass count ${masses.size}`);
  // candidates: grace neighbours count, land tier is every land hex
  const mining = candidatesFor(terrain, rules, 'melvorD:Mining');
  assert.ok(mining.some((h) => h.t === 'grasslands'), 'grace neighbours are candidates');
  const land = candidatesFor(terrain, rules, 'melvorD:Firemaking');
  assert.ok(land.length > 300 && land.every((h) => h.t !== 'water' && h.t !== 'shoal'));
  const herb = candidatesFor(terrain, rules, 'melvorD:Herblore');
  assert.ok(herb.some((h) => h.poi === 'FrostyHaven'));
});
