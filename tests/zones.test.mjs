import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { termMatches, zoneAllows, zoneAllowsWithGrace, zoneFor, zoneTerms, rowOf } from '../src/zones.mjs';
import * as terrainMod from '../src/terrain.mjs';
import * as rules from '../src/rules.mjs';
import * as shipModel from '../src/ship-model.mjs';

const root = new URL('../', import.meta.url);
const zoneTable = JSON.parse(readFileSync(new URL('data/zones.json', root), 'utf8'));
const mapTable = JSON.parse(readFileSync(new URL('data/hex_terrain.json', root), 'utf8'));

test('terms: every key must hold, cloud never matches', () => {
  const rec = { q: 0, r: 0, t: 'hills', f: ['rock'], coast: true };
  assert.ok(termMatches({ t: ['hills'] }, rec));
  assert.ok(termMatches({ t: ['hills'], f: ['rock'] }, rec));
  assert.ok(!termMatches({ t: ['hills'], f: ['forest'] }, rec));
  assert.ok(termMatches({ coast: true }, rec));
  assert.ok(!termMatches({ coast: true }, { ...rec, coast: false }));
  assert.ok(termMatches({}, rec)); // ANY
  assert.ok(!termMatches({}, { ...rec, cloud: true }));
  assert.ok(!termMatches({}, undefined));
});

test('terms: shore range, areas and dungeons, POIs', () => {
  const sea = { t: 'water', shore: 2 };
  assert.ok(termMatches({ shore: [1, 2] }, sea));
  assert.ok(!termMatches({ shore: [3] }, sea));
  assert.ok(termMatches({ shore: [2] }, sea)); // no max
  assert.ok(!termMatches({ shore: [0] }, { t: 'hills' })); // land has no shore
  assert.ok(termMatches({ area: ['Graveyard'] }, { t: 'swamp', dungeon: 'Graveyard' }));
  assert.ok(termMatches({ area: ['Graveyard'] }, { t: 'swamp', area: 'Graveyard' }));
  assert.ok(!termMatches({ area: ['Graveyard'] }, { t: 'swamp' }));
  assert.ok(termMatches({ poi: ['Lighthouse'] }, { t: 'hills', poi: 'Lighthouse' }));
});

test('terms: near looks within r steps through the neighbours function, skipping cloud', () => {
  const a = { id: 'a', t: 'grasslands' };
  const b = { id: 'b', t: 'grasslands' };
  const c = { id: 'c', t: 'mountains' };
  const links = { a: [b], b: [a, c], c: [b] };
  const nb = (h) => links[h.id];
  assert.ok(!termMatches({ near: { t: ['mountains'], r: 1 } }, a, nb));
  assert.ok(termMatches({ near: { t: ['mountains'], r: 2 } }, a, nb));
  assert.ok(termMatches({ near: { t: ['grasslands'] } }, a, nb)); // r defaults to 1 and the hex itself counts
  assert.ok(!termMatches({ near: { t: ['mountains'], r: 2 } }, a)); // no neighbours function
  const clouded = { a: [b], b: [a, { ...c, cloud: true }] };
  assert.ok(!termMatches({ near: { t: ['mountains'], r: 2 } }, a, (h) => clouded[h.id] ?? []));
});

test('terms: lat reads the game map row; not refuses the hex or its surroundings', () => {
  assert.equal(rowOf({ q: 14, r: 10 }), 17); // the start, display (14, 17)
  assert.equal(rowOf({ q: 3, r: 4 }), 5);
  assert.ok(termMatches({ lat: [12, 22] }, { q: 14, r: 10, t: 'grasslands' }));
  assert.ok(!termMatches({ lat: [0, 12] }, { q: 14, r: 10, t: 'grasslands' }));
  assert.ok(termMatches({ lat: [17] }, { q: 14, r: 10, t: 'grasslands' })); // no max
  const town = { id: 'town', q: 0, r: 0, t: 'grasslands', f: ['city'] };
  const field = { id: 'field', q: 1, r: 0, t: 'grasslands' };
  const wood = { id: 'wood', q: 2, r: 0, t: 'grasslands', f: ['forest'] };
  const links = { town: [field], field: [town, wood], wood: [field] };
  const nb = (h) => links[h.id];
  const dark = { not: [{ f: ['city'], r: 1 }, { f: ['forest'] }] };
  assert.ok(!termMatches(dark, field, nb)); // a town next door
  assert.ok(!termMatches(dark, wood, nb)); // under the canopy
  assert.ok(termMatches({ not: [{ f: ['city'] }] }, field, nb)); // r 0: the hex itself only
  assert.ok(!termMatches(dark, field)); // r > 0 needs neighbours
});

test('grace: a hex lifted by its neighbours takes their zones', () => {
  const zone = { terms: [{ f: ['city'] }] };
  const town = { t: 'grasslands', f: ['city'] };
  const field = { t: 'grasslands' };
  assert.ok(!zoneAllowsWithGrace(zone, field, undefined, []));
  assert.ok(zoneAllowsWithGrace(zone, field, undefined, [town]));
  assert.deepEqual(rules.graceFrom('melvorD:Thieving', field, { neighbours: () => [town, field] }), [town]);
  assert.deepEqual(rules.graceFrom('melvorD:Thieving', town, { neighbours: () => [town] }), []); // full rate already
  assert.deepEqual(rules.graceFrom('melvorD:Woodcutting', field, { neighbours: () => [{ t: 'grasslands', f: ['forest'] }] }), []); // no grace
  assert.deepEqual(rules.graceFrom('melvorD:Township', field, { strictness: 'relaxed', neighbours: () => [town] }), []); // place rule lifted
});

test('zones: terms are ORed, a missing zone takes everything, lookups and display terms', () => {
  const zone = { level: 1, terms: [{ t: ['hills'] }, { f: ['rock'] }] };
  assert.ok(zoneAllows(zone, { t: 'hills' }));
  assert.ok(zoneAllows(zone, { t: 'grasslands', f: ['rock'] }));
  assert.ok(!zoneAllows(zone, { t: 'grasslands' }));
  assert.ok(zoneAllows(undefined, { t: 'grasslands' }));
  const table = { skills: { 'x:S': { actions: { 'x:A': zone } } } };
  assert.equal(zoneFor(table, 'x:A'), zone);
  assert.equal(zoneFor(table, 'x:B'), undefined);
  assert.equal(zoneFor(undefined, 'x:A'), undefined);
  assert.deepEqual(zoneTerms({ terms: [{ t: ['hills'], f: ['rock'] }, { near: { area: ['Graveyard'], t: ['swamp'] } }, { t: ['hills'] }] }),
    { classes: ['hills', 'swamp'], features: ['rock'], places: ['Graveyard'], lat: undefined, away: [] });
  assert.deepEqual(zoneTerms({ terms: [{ lat: [0, 12], not: [{ f: ['city'], r: 1 }, { f: ['forest'] }] }, { lat: [20] }] }),
    { classes: [], features: [], places: [], lat: [0, 12], away: ['city', 'forest'] });
});

const KEYS = ['t', 'f', 'coast', 'shore', 'area', 'poi', 'near', 'lat', 'not'];
const NEAR_KEYS = ['t', 'f', 'area', 'poi', 'r'];

test('the table is well formed', () => {
  assert.equal(zoneTable.version, 1);
  const skills = Object.keys(zoneTable.skills);
  assert.deepEqual(skills.sort(), ['melvorD:Astrology', 'melvorD:Farming', 'melvorD:Fishing', 'melvorD:Mining', 'melvorD:Thieving', 'melvorD:Woodcutting']);
  const seen = new Set();
  for (const [skillId, skill] of Object.entries(zoneTable.skills)) {
    // Astrology has no skill rule: its zones alone decide
    assert.ok(rules.isGated(skillId) || skillId === 'melvorD:Astrology', `${skillId} has a skill rule to sit on`);
    for (const [actionId, zone] of Object.entries(skill.actions)) {
      assert.match(actionId, /^melvor[A-Za-z0-9]+:[A-Za-z0-9_]+$/, actionId);
      assert.ok(!seen.has(actionId), `${actionId} listed twice`); seen.add(actionId);
      assert.ok(Number.isInteger(zone.level) && zone.level >= 1, `${actionId} level`);
      assert.ok(typeof zone.why === 'string' && zone.why.length > 0, `${actionId} why`);
      assert.ok(Array.isArray(zone.terms) && zone.terms.length > 0, `${actionId} terms`);
      for (const term of zone.terms) {
        for (const k of Object.keys(term)) assert.ok(KEYS.includes(k), `${actionId}: unknown key ${k}`);
        for (const k of ['t', 'f', 'area', 'poi']) if (term[k] !== undefined) assert.ok(Array.isArray(term[k]) && term[k].length > 0, `${actionId}: ${k}`);
        for (const c of term.t ?? []) assert.ok(terrainMod.CLASSES.includes(c), `${actionId}: class ${c}`);
        for (const f of term.f ?? []) assert.ok(terrainMod.FEATURES.includes(f), `${actionId}: feature ${f}`);
        if (term.shore !== undefined) assert.ok(Array.isArray(term.shore) && term.shore.length >= 1 && term.shore.every(Number.isInteger), `${actionId}: shore`);
        if (term.lat !== undefined) assert.ok(Array.isArray(term.lat) && term.lat.length >= 1 && term.lat.every(Number.isInteger), `${actionId}: lat`);
        for (const no of term.not ?? []) {
          for (const k of Object.keys(no)) assert.ok(NEAR_KEYS.includes(k), `${actionId}: unknown not key ${k}`);
          for (const f of no.f ?? []) assert.ok(terrainMod.FEATURES.includes(f), `${actionId}: not feature ${f}`);
        }
        if (term.near !== undefined) {
          for (const k of Object.keys(term.near)) assert.ok(NEAR_KEYS.includes(k), `${actionId}: unknown near key ${k}`);
          for (const c of term.near.t ?? []) assert.ok(terrainMod.CLASSES.includes(c), `${actionId}: near class ${c}`);
          for (const f of term.near.f ?? []) assert.ok(terrainMod.FEATURES.includes(f), `${actionId}: near feature ${f}`);
        }
      }
    }
  }
});

test('on the real map every zoned action has ground the dinghy reaches, and level-1 actions are near the start', () => {
  const terrain = terrainMod.createTerrain(mapTable);
  const nb = (rec) => terrain.neighbours(rec.q, rec.r);
  const opts = { strictness: 'strict', neighbours: nb };
  const start = zoneTable.start;
  assert.ok(terrain.get(start.q, start.r) !== undefined, 'start hex is on the map');
  const far = new Set(); // landmasses of islands beyond the first hull tier
  for (const island of shipModel.ISLANDS) {
    const rec = terrain.poi(island.anchor);
    if (rec !== undefined && island.tier > 1) far.add(terrain.landmass(rec.q, rec.r));
  }
  const reachNow = (rec) => (terrainMod.isSea(rec) ? rec.shore <= 2 : !far.has(terrain.landmass(rec.q, rec.r)));
  const all = [...terrain.all()].filter((rec) => rec.cloud !== true);
  for (const [skillId, skill] of Object.entries(zoneTable.skills)) {
    for (const [actionId, zone] of Object.entries(skill.actions)) {
      const hexes = all.filter((rec) => rules.allowedAt(skillId, rec, opts) && zoneAllowsWithGrace(zone, rec, nb, rules.graceFrom(skillId, rec, opts)));
      assert.ok(hexes.some(reachNow), `${actionId}: no hex reachable with the dinghy`);
      if (zone.level <= 1) {
        const near = Math.min(...hexes.map((h) => terrainMod.hexDistance(start, h)));
        assert.ok(near <= 4, `${actionId}: nearest hex ${near} steps from the start`);
      }
    }
  }
});
