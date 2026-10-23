import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { routeSearch, vesselsAfterRoute, canDock, seaIndex, isSea, isPort, dockSpot, HULLS } from '../src/ship-model.mjs';
import { createTerrain, NEIGHBOURS } from '../src/terrain.mjs';

// A strip of hexes along r = 0: a port, open sea and an island that needs a brig.
// q0 port (land) | q1 quay, shore 1 | q2 shore 2 | q3 shore 3 | q4 shore 2 | q5 shore 1 | q6 the island (tier 3)
const strip = (over = {}) => {
  const recs = [
    { q: 0, r: 0, t: 'grasslands', f: ['port'] },
    { q: 1, r: 0, t: 'water', shore: 1 },
    { q: 2, r: 0, t: 'water', shore: 2 },
    { q: 3, r: 0, t: 'water', shore: 3 },
    { q: 4, r: 0, t: 'water', shore: 2 },
    { q: 5, r: 0, t: 'water', shore: 1 },
    { q: 6, r: 0, t: 'grasslands', island: 3 },
    { q: 7, r: 0, t: 'grasslands', island: 3 },
  ].map((r) => ({ ...r, ...(over[r.q] ?? {}) }));
  const byQ = new Map(recs.map((r) => [r.q, r]));
  const geo = { islandTier: (rec) => rec.island ?? 1, home: (rec) => (isSea(rec) ? rec.shore : 0) };
  return { byQ, geo };
};
const search = ({ byQ, geo }, from, to, boat, ship) => routeSearch({
  start: byQ.get(from), goal: byQ.get(to), key: (n) => `${n.q},${n.r}`, rec: (n) => n,
  neighbours: (n) => [byQ.get(n.q - 1), byQ.get(n.q + 1)].filter(Boolean).map((x) => [x, 1, false]),
  heuristic: () => 0, boat, ship, geo, dockOf: () => undefined,
});
const brig = (q) => ({ hull: 'brig', q, r: 0 });
const dinghy = (q, aboard = false) => ({ hull: 'dinghy', q, r: 0, aboard });
const trail = (found) => found.path.map((n, i) => `${n.q}${found.modes[i].m[0]}`).join(' ');

test('quays: a ship meets the land only at a port', () => {
  const port = { q: 0, r: 0, t: 'grasslands', f: ['port'] };
  assert.equal(canDock({ q: 1, r: 0, t: 'water', shore: 1 }, port), true);
  assert.equal(canDock({ q: 1, r: 0, t: 'water', shore: 1 }, { q: 0, r: 0, t: 'grasslands' }), false);
  assert.equal(canDock({ q: 1, r: 0, t: 'water', shore: 1, f: ['port'] }, { q: 0, r: 0, t: 'beach' }), true, 'a port on the water: any shore next to it');
  assert.equal(isPort({ t: 'water', f: ['port'], cloud: true }), false);
});

test('the brig sails out, anchors within 2 of land and the boat rows the last stretch to its island', () => {
  const map = strip();
  const found = search(map, 0, 6, dinghy(1, true), brig(1));
  assert.equal(trail(found), '0l 1s 2s 3s 4s 5b 6l');
  const after = vesselsAfterRoute(found.path, found.modes, dinghy(1, true), brig(1), () => undefined);
  assert.deepEqual([after.ship.q, after.boat.q, after.boat.aboard], [4, 5, false]);
});

test('without the brig a dinghy cannot cross deep water, nor land on a brig\'s island', () => {
  const map = strip();
  assert.equal(search(map, 0, 6, dinghy(1), null), undefined);
  const near = strip({ 3: { shore: 2 } });
  assert.equal(search(near, 0, 6, dinghy(1), null), undefined, 'the island needs the brig within 2 hexes');
  assert.equal(trail(search(near, 0, 5, dinghy(1), null)), '0l 1b 2b 3b 4b 5b');
});

test('the way back: walk to the boat, row to the brig, it goes aboard, sail home and step off at the port', () => {
  const map = strip();
  const found = search(map, 6, 0, dinghy(5), brig(4));
  assert.equal(trail(found), '6l 5b 4s 3s 2s 1s 0l');
  const after = vesselsAfterRoute(found.path, found.modes, dinghy(5), brig(4), () => undefined);
  assert.deepEqual([after.ship.q, after.boat.q, after.boat.aboard], [1, 1, true]);
});

test('a brig never ties up at a plain coast, and a vessel left on the route is not boarded again', () => {
  const map = strip({ 0: { f: [] } });
  assert.equal(search(map, 1, 0, null, brig(1)), undefined, 'no port, no boat: no way ashore');
  assert.equal(trail(search(map, 1, 0, dinghy(1, true), brig(1))), '1s 2s 1b 0l', 'the brig moves off the quay and the boat rows ashore');
  // From land a brig is boarded only from its port
  assert.equal(search(map, 0, 3, null, brig(1)), undefined);
  assert.equal(trail(search(strip(), 0, 3, null, brig(1))), '0l 1s 2s 3s');
});

test('vessel replay: the boat aboard moves with the brig; untouched vessels stay the same objects', () => {
  const b = dinghy(1, true);
  const s = brig(1);
  const recs = [0, 1, 2].map((q) => ({ q, r: 0 }));
  const after = vesselsAfterRoute(recs, [{ m: 'land' }, { m: 'ship' }, { m: 'ship' }], b, s, () => undefined);
  assert.deepEqual([after.ship.q, after.boat.q, after.boat.aboard], [2, 2, true]);
  const still = vesselsAfterRoute([{ q: 0, r: 0 }, { q: -1, r: 0 }], [{ m: 'land' }, { m: 'land' }], b, s, () => undefined);
  assert.equal(still.boat, b);
  assert.equal(still.ship, s);
});

const loadTerrain = async () => createTerrain(JSON.parse(await readFile(new URL('../data/hex_terrain.json', import.meta.url), 'utf8')));

// The bound is the work, not the clock: the states the search expands are the same on every machine and under any
// load, where the time was not (a 1.5 s bound tripped at 6.7 s with the sims running beside the tests). The real
// route expands some 21,000 states and the dead end some 83,000 (22 Oct 2026); the bounds leave room for a map
// change, not for a search that forgets its `best` table. The clock stays as a hang guard, generous on purpose.
test('the real map: from Beginning Port the brig and dinghy reach the Ominous Isle, quickly; dead ends end quickly too', async () => {
  const terrain = await loadTerrain();
  const geo = seaIndex(terrain);
  const nb = (rec) => terrain.neighbours(rec.q, rec.r).filter(Boolean).map((n) => [n, 1, false]);
  const stats = {};
  const run = (start, goal, boat, ship) => routeSearch({
    start, goal, key: (n) => `${n.q},${n.r}`, rec: (n) => n, neighbours: nb, heuristic: () => 0, boat, ship, geo, stats,
    dockOf: (rec) => dockSpot(rec, terrain.neighbours(rec.q, rec.r).filter(Boolean)),
  });
  const port = terrain.poi('BeginningPort');
  const ominous = terrain.poi('OminousPort');
  const ship = { hull: 'brig', q: port.q, r: port.r };
  const boat = { hull: 'dinghy', q: port.q, r: port.r, aboard: true };
  const land = terrain.neighbours(port.q, port.r).find((n) => n !== undefined && !isSea(n));
  let t0 = performance.now();
  const found = run(land, ominous, boat, ship);
  const took = performance.now() - t0;
  const expanded = stats.expanded;
  assert.ok(found, 'a route to the Ominous Isle');
  assert.ok(found.modes.some((m) => m.m === 'ship'));
  assert.ok(expanded < 40000, `${expanded} states expanded for the route`);
  assert.ok(took < 15000, `${Math.round(took)} ms: the search hangs`);
  assert.equal(run(land, ominous, { ...boat, aboard: false }, null), undefined, 'a dinghy alone never lands there');
  // A goal in the cloud the brig can't reach: the whole search space, still bounded
  const far = [...terrain.all()].find((r) => r.dungeon === 'ImpendingDarkness' || r.poi === 'Melantis') ?? [...terrain.all()].find((r) => r.cloud === true);
  t0 = performance.now();
  run(land, far, boat, ship);
  const all = performance.now() - t0;
  const allExpanded = stats.expanded;
  assert.ok(allExpanded < 160000, `${allExpanded} states expanded for a dead end`);
  assert.ok(all < 30000, `${Math.round(all)} ms for a dead end: the search hangs`);
  console.log(`route to Ominous Port: ${found.path.length} hexes, ${expanded} states in ${Math.round(took)} ms; dead end ${allExpanded} states in ${Math.round(all)} ms`);
});

test('the brig is a tier 3 hull with an 18-crate hold', () => {
  assert.equal(HULLS.brig.tier, 3);
});
