import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  HULLS, PLANNED_HULLS, DINGHY_BUILD, ISLANDS, canStep, isFreeStep, shipAfterPath, launchSpot, dockSpot, freeBoatSpot, isAboard, seaIndex, isSea, beyondReach, isPlace,
  canHop, shipAfterHops, laneTier, hexDist, condOf, repairPlan, canRepair, pitchChance, REPAIR,
  holdSlots, atShip, stow, takeOut, UPGRADES, upgradeFor, upgradeBlocker, HOLD_SLOTS, BIG_SHIPS, shipBill, dinghyBuild, OLD_HAT,
} from '../src/ship-model.mjs';
import { HULL_IDS, loadSave, serializeSave, defaultSave, xpForSteps } from '../src/voyage-model.mjs';
import { createTerrain, hexDistance, NEIGHBOURS } from '../src/terrain.mjs';

const land = (q, r) => ({ q, r, t: 'grasslands' });
const sea = (q, r, shore) => ({ q, r, t: 'water', shore });
const dinghy = (q, r) => ({ hull: 'dinghy', q, r });

test('hull ids in the save model match the hull table', () => {
  assert.deepEqual(HULL_IDS, Object.keys(HULLS));
  assert.equal(HULLS.dinghy.reach, 2);
  assert.ok(DINGHY_BUILD.gp > 0 && DINGHY_BUILD.items.length > 0);
});

test('the longboat (build .142): the dinghy\'s upgrade, at Voyage 30, at a port with the dinghy at the quay', () => {
  assert.equal(HULLS.longboat.reach, 4);
  assert.equal(HULLS.longboat.tier, 2);
  assert.equal(PLANNED_HULLS.longboat, undefined, 'built now, not planned');
  assert.equal(HOLD_SLOTS.longboat, 12);
  assert.equal(upgradeFor(dinghy(0, 0))?.[0], 'longboat');
  assert.equal(upgradeFor({ hull: 'longboat', q: 0, r: 0 }), undefined, 'the brig is a second vessel, not an upgrade');
  assert.equal(upgradeFor(null), undefined);
  for (const [id, u] of Object.entries(UPGRADES)) assert.ok(HULLS[u.from] && HULLS[id] && HULLS[id].tier === HULLS[u.from].tier + 1, id);
  const u = UPGRADES.longboat;
  assert.equal(u.level, 30);
  const ok = { level: 30, atPort: true, playerRec: land(0, 0), owned: true };
  assert.equal(upgradeBlocker(dinghy(1, 0), u, ok), undefined);
  assert.equal(upgradeBlocker(dinghy(0, 0), u, ok), undefined, 'aboard at the quay');
  assert.equal(upgradeBlocker(dinghy(1, 0), u, { ...ok, level: 29 }), 'level');
  assert.equal(upgradeBlocker(dinghy(1, 0), u, { ...ok, atPort: false }), 'port');
  assert.equal(upgradeBlocker(dinghy(2, 0), u, ok), 'quay');
  assert.equal(upgradeBlocker(dinghy(1, 0), u, { ...ok, playerRec: undefined }), 'quay');
  assert.equal(upgradeBlocker(dinghy(1, 0), u, { ...ok, owned: false }), 'cost');
});

test('the galleon (build .152): the brig\'s upgrade, at Voyage 60, at a port with the brig at the quay', () => {
  const brig = (q, r) => ({ hull: 'brig', q, r });
  assert.equal(HULLS.galleon.tier, 4);
  assert.equal(HULLS.galleon.reach, Infinity);
  assert.equal(PLANNED_HULLS.galleon, undefined, 'built now, not planned');
  assert.equal(HOLD_SLOTS.galleon, 24);
  assert.equal(holdSlots(brig(0, 0), 60) + 6, holdSlots({ hull: 'galleon', q: 0, r: 0 }, 60), 'one row of six more than the brig');
  assert.equal(upgradeFor(brig(0, 0))?.[0], 'galleon');
  assert.equal(upgradeFor({ hull: 'galleon', q: 0, r: 0 }), undefined, 'the last hull');
  const u = UPGRADES.galleon;
  assert.equal(u.level, 60);
  assert.ok(u.gp > 150000 && u.items.length === 4, 'dearer than the brig');
  const bones = (items) => items.find((x) => x.id === 'melvorD:Big_Bones')?.quantity;
  assert.deepEqual([UPGRADES.longboat, BIG_SHIPS.brig, u].map((x) => bones(x.items)), [50, 250, 550], 'Big Bones grow with the hull (build .177)');
  const ok = { level: 60, atPort: true, playerRec: land(0, 0), owned: true };
  assert.equal(upgradeBlocker(brig(1, 0), u, ok), undefined, 'the brig at the quay beside you');
  assert.equal(upgradeBlocker(brig(0, 0), u, ok), undefined, 'aboard at the quay');
  assert.equal(upgradeBlocker(brig(1, 0), u, { ...ok, level: 59 }), 'level');
  assert.equal(upgradeBlocker(brig(1, 0), u, { ...ok, atPort: false }), 'port');
  assert.equal(upgradeBlocker(brig(2, 0), u, ok), 'quay');
  assert.equal(upgradeBlocker(brig(1, 0), u, { ...ok, owned: false }), 'cost');
});

test('a saved galleon loads as one, the boat aboard kept', () => {
  const { save } = loadSave(JSON.stringify({ ...defaultSave(), boat: { hull: 'dinghy', q: 3, r: -2, cond: 80, aboard: true }, ship: { hull: 'galleon', q: 3, r: -2, cond: 90, hold: [{ id: 'melvorD:Potatoes', qty: 4 }] } }));
  assert.equal(save.ship.hull, 'galleon');
  assert.deepEqual(save.ship.hold, [{ id: 'melvorD:Potatoes', qty: 4 }]);
  assert.equal(save.boat.aboard, true);
});

test('a saved longboat loads as one', () => {
  const { save } = loadSave(JSON.stringify({ ...defaultSave(), boat: { hull: 'longboat', q: 3, r: -2, cond: 80 } }));
  assert.deepEqual(save.boat, { hull: 'longboat', q: 3, r: -2, cond: 80, hold: [], aboard: false });
  assert.equal(holdSlots(save.boat, 1), 12);
});

test('off the ship, land only: the one sea hex you may enter from land is the ship\'s', () => {
  assert.equal(canStep(land(0, 0), land(1, 0), null), true);
  assert.equal(canStep(land(0, 0), sea(1, 0, 1), null), false);
  assert.equal(canStep(land(0, 0), sea(1, 0, 1), dinghy(5, 5)), false);
  assert.equal(canStep(land(0, 0), sea(1, 0, 1), dinghy(1, 0)), true);
});

test('aboard: sail within reach, land on any coast, the homeward rule beyond reach', () => {
  const ship = dinghy(1, 0);
  assert.equal(canStep(sea(1, 0, 1), sea(2, 0, 2), ship), true);
  assert.equal(canStep(sea(2, 0, 2), sea(3, 0, 3), ship), false, 'reach is 2');
  assert.equal(canStep(sea(1, 0, 1), land(0, 0), ship), true);
  // out of reach (an old save): only moves that never take it farther from land
  assert.equal(canStep(sea(9, 0, 5), sea(8, 0, 4), ship), true);
  assert.equal(canStep(sea(9, 0, 5), sea(9, 1, 5), ship), true);
  assert.equal(canStep(sea(9, 0, 5), sea(10, 0, 6), ship), false);
  // on the sea with no ship: only closer to land
  assert.equal(canStep(sea(9, 0, 5), sea(9, 1, 5), null), false);
  assert.equal(canStep(sea(9, 0, 5), sea(8, 0, 4), null), true);
});

test('homeward moves never end on a place; within reach they may (3b check)', () => {
  const ship = dinghy(9, 0);
  const wreck = { ...sea(9, 1, 5), poi: 'IllFatedVessel', dungeon: 'DeepSeaShip' };
  assert.equal(isPlace(wreck), true);
  assert.equal(isPlace(sea(9, 1, 5)), false);
  assert.equal(canStep(sea(9, 0, 5), wreck, ship), false, 'sideways onto a place beyond reach');
  assert.equal(canStep(sea(9, 0, 6), { ...wreck, shore: 5 }, ship), false, 'closer, but still a place beyond reach');
  assert.equal(canStep(sea(1, 0, 1), { ...sea(2, 0, 2), poi: 'NewHorizon' }, ship), true, 'a place within reach');
});

test('nothing sails into cloud; under cloud only closer to a coast (3b check)', () => {
  const ship = dinghy(9, 0);
  const cloud = (q, r, shore) => ({ ...sea(q, r, shore), cloud: true });
  assert.equal(canStep(sea(1, 0, 1), cloud(2, 0, 2), ship), false);
  assert.equal(canStep(sea(9, 0, 5), cloud(9, 1, 5), ship), false, 'not even sideways beyond reach');
  assert.equal(canStep(cloud(9, 0, 5), cloud(9, 1, 5), ship), false, 'sideways inside the cloud');
  assert.equal(canStep(cloud(9, 0, 5), cloud(8, 0, 4), ship), true);
  assert.equal(canStep(cloud(9, 0, 3), sea(8, 0, 2), ship), true, 'out of the cloud');
  assert.equal(canStep(cloud(9, 0, 1), sea(8, 0, 1), ship), false, 'out, but not closer');
  assert.equal(beyondReach(cloud(9, 0, 1), ship), true, 'under cloud the moves are free');
});

test('the sailing ships sail under cloud within their reach; the small boats never do (user decision, 16 Oct 2026)', () => {
  const cloud = (q, r, shore) => ({ ...sea(q, r, shore), cloud: true });
  const brig = { hull: 'brig', q: 9, r: 0 };
  const galleon = { hull: 'galleon', q: 9, r: 0 };
  const longboat = { hull: 'longboat', q: 9, r: 0 };
  assert.equal(HULLS.brig.reach, 5);
  assert.equal(canStep(sea(1, 0, 3), cloud(2, 0, 4), longboat), false);
  assert.equal(canStep(sea(1, 0, 3), cloud(2, 0, 4), brig), true);
  assert.equal(canStep(cloud(1, 0, 4), cloud(2, 0, 5), brig), true, 'deeper, still within reach');
  assert.equal(canStep(cloud(1, 0, 5), { ...cloud(2, 0, 6), poi: 'SwirlingAbyss' }, brig), false, 'a place beyond reach waits');
  assert.equal(canStep(cloud(1, 0, 5), { ...cloud(2, 0, 6), poi: 'SwirlingAbyss' }, galleon), true);
  assert.equal(beyondReach(cloud(1, 0, 4), brig), false, 'under cloud within reach is sailing, with XP');
  assert.equal(beyondReach(cloud(1, 0, 4), dinghy(1, 0)), true);
});

test('free steps: beyond the reach and without a ship', () => {
  assert.equal(isFreeStep(sea(0, 0, 2), dinghy(0, 0)), false);
  assert.equal(isFreeStep(sea(0, 0, 3), dinghy(0, 0)), true);
  assert.equal(isFreeStep(sea(0, 0, 1), null), true);
  assert.equal(isFreeStep(land(0, 0), null), false);
  assert.deepEqual(xpForSteps([{ water: true, free: true }, { water: true }]).water, 1);
});

test('the ship follows you across the sea and waits where you step ashore', () => {
  const ship = dinghy(1, 0);
  // board from land, sail two hexes, land
  const path = [land(0, 0), sea(1, 0, 1), sea(2, 0, 2), sea(3, 0, 1), land(4, 0)];
  assert.deepEqual(shipAfterPath(path, ship), dinghy(3, 0));
  assert.equal(isAboard(land(4, 0), shipAfterPath(path, ship)), false);
  // end on the water: still aboard
  assert.deepEqual(shipAfterPath(path.slice(0, 3), ship), dinghy(2, 0));
  assert.equal(isAboard(sea(2, 0, 2), dinghy(2, 0)), true);
  // a walk on land leaves it alone (same object)
  assert.equal(shipAfterPath([land(0, 0), land(0, 1)], ship), ship);
  // rules off: crossing the sea elsewhere does not move it
  assert.equal(shipAfterPath([land(0, 0), sea(0, 1, 1), land(0, 2)], ship), ship);
  assert.equal(shipAfterPath(path, null), null);
});

test('a dinghy is launched next to the coast you stand on', () => {
  assert.deepEqual(launchSpot(land(0, 0), [land(1, 0), { ...sea(0, 1, 1), t: 'shoal' }, sea(1, -1, 1)]), sea(1, -1, 1));
  assert.deepEqual(launchSpot(land(0, 0), [land(1, 0), { ...sea(0, 1, 1), t: 'shoal' }]).t, 'shoal');
  assert.equal(launchSpot(land(0, 0), [land(1, 0)]), undefined);
  assert.equal(launchSpot(sea(0, 0, 1), [land(1, 0)]), undefined);
});

test('a hop docks on the port hex for a port on the water, next to it for a port on land', () => {
  const port = { ...sea(0, 0, 1), f: ['port'] };
  assert.deepEqual(dockSpot(port, [land(1, 0)]), { q: 0, r: 0 });
  assert.equal(dockSpot({ ...port, cloud: true }, [sea(1, 0, 1)]), undefined);
  assert.deepEqual(dockSpot({ ...land(0, 0), f: ['port'] }, [land(1, 0), sea(0, 1, 1)]), sea(0, 1, 1));
  assert.equal(dockSpot({ ...land(0, 0), f: ['port'] }, [land(1, 0)]), undefined);
});

test('every port on the real map has a dock (piers too, but Moonlit Pier is inland on a river)', async () => {
  const terrain = await loadTerrain();
  const ports = [...terrain.all()].filter((r) => r.f?.includes('port') && r.poi !== 'MoonlitPier');
  assert.ok(ports.length >= 12);
  for (const p of ports) assert.ok(dockSpot(p, terrain.neighbours(p.q, p.r)) !== undefined, `port at ${p.q},${p.r}`);
});

test('free dinghy: under a player on the water, next to their island away from the start, none at home', async () => {
  const table = JSON.parse(await readFile(new URL('../data/hex_terrain.json', import.meta.url), 'utf8'));
  const terrain = createTerrain(table);
  const all = [...terrain.all()];
  const start = all.find((h) => h.t === 'grasslands' && terrain.landmass(h.q, h.r) !== undefined);
  const home = terrain.landmass(start.q, start.r);
  const water = all.find((h) => h.t === 'water' && h.shore === 3);
  assert.deepEqual(freeBoatSpot(water, start, terrain, hexDistance), { q: water.q, r: water.r });
  assert.equal(freeBoatSpot(start, start, terrain, hexDistance), undefined);
  const island = all.find((h) => h.t !== 'water' && h.t !== 'shoal' && h.cloud !== true && terrain.landmass(h.q, h.r) !== undefined && terrain.landmass(h.q, h.r) !== home);
  const spot = freeBoatSpot(island, start, terrain, hexDistance);
  assert.ok(spot !== undefined);
  const rec = terrain.get(spot.q, spot.r);
  assert.equal(rec.shore, 1);
  assert.ok(terrain.neighbours(spot.q, spot.r).some((n) => terrain.landmass(n.q, n.r) === terrain.landmass(island.q, island.r)));
});

test('every water and shoal hex has a shore distance; land has none', async () => {
  const table = JSON.parse(await readFile(new URL('../data/hex_terrain.json', import.meta.url), 'utf8'));
  for (const h of table.hexes) {
    if (h.t === 'water' || h.t === 'shoal') assert.ok(Number.isInteger(h.shore) && h.shore >= 1, `${h.q},${h.r}`);
    else assert.equal(h.shore, undefined, `${h.q},${h.r}`);
  }
  assert.equal(table.hexes.filter((h) => h.shore !== undefined && h.shore <= 2).length, 352);
});

test('save v1 migrates up with no ship; a ship round-trips; a bad ship is dropped', () => {
  const { save, report } = loadSave(JSON.stringify({ v: 1, landHexes: 4, waterHexes: 0, backfilled: true }));
  assert.deepEqual(report.applied, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.deepEqual(save, { ...defaultSave(), landHexes: 4, backfilled: true, start: 'game' }); // an old character has long since started
  const withShip = { ...defaultSave(), boat: { ...dinghy(3, 7), cond: 64, hold: [], aboard: false }, ship: { hull: 'brig', q: 9, r: 1, cond: 70, hold: [] }, shipChecked: true };
  assert.deepEqual(loadSave(serializeSave(withShip)).save, withShip);
  assert.equal(loadSave(JSON.stringify({ ...withShip, boat: { hull: 'raft', q: 1, r: 1 } })).save.boat, null);
  assert.equal(loadSave(JSON.stringify({ ...withShip, boat: { hull: 'dinghy', q: 1.5, r: 1 } })).save.boat, null);
});

const loadTerrain = async () => createTerrain(JSON.parse(await readFile(new URL('../data/hex_terrain.json', import.meta.url), 'utf8')));

test('island tiers: a small hull can\'t land on a bigger hull\'s island, but may leave it and walk on it', () => {
  const geo = { islandTier: (rec) => (rec.q === 9 ? 2 : 1), home: (rec) => rec.shore ?? 0 };
  const ship = dinghy(8, 0);
  assert.equal(canStep(sea(8, 0, 1), land(9, 0), ship, geo), false);
  assert.equal(canStep(sea(8, 0, 1), land(7, 0), ship, geo), true);
  assert.equal(canStep(land(9, 0), land(9, 1), ship, geo), true);
  assert.equal(canStep(sea(8, 0, 1), land(9, 0), null, geo), true, 'swimming home lands anywhere');
});

test('every island anchor is on its own landmass, off the mainland', async () => {
  const terrain = await loadTerrain();
  const lms = ISLANDS.map((i) => { const rec = terrain.poi(i.anchor); assert.ok(rec, i.anchor); return terrain.landmass(rec.q, rec.r); });
  assert.equal(new Set(lms).size, ISLANDS.length);
  const start = terrain.get(15, 9);
  assert.ok(!lms.includes(terrain.landmass(start.q, start.r)));
  const idx = seaIndex(terrain);
  assert.equal(idx.islandTier(terrain.poi('OminousPort')), 3);
  assert.equal(idx.islandTier(start), 1);
  assert.equal(idx.islandOf(start), undefined);
});

test('laneTier (phase 4 wrap-up): the smallest hull for a cargo lane on the real map', async () => {
  const { laneDistances } = await import('../src/cargo-model.mjs');
  const table = JSON.parse(await readFile(new URL('../data/hex_terrain.json', import.meta.url), 'utf8'));
  const terrain = createTerrain(table);
  const idx = seaIndex(terrain);
  const tier = (a, b) => laneTier(terrain.poi(a), terrain.poi(b), terrain, idx);
  assert.equal(tier('BeginningPort', 'FrostDriftPort'), 1);
  assert.equal(tier('BeginningPort', 'OminousPort'), 3, 'the Ominous Isle wants a brig');
  assert.equal(tier('OminousPort', 'BeginningPort'), 3, 'and its waters too');
  assert.equal(tier('BustlingPort', 'FakePort'), 2, 'the Cursed Isle wants a longboat');
  for (const [a, to] of Object.entries(laneDistances(table.hexes))) for (const b of Object.keys(to)) assert.ok(tier(a, b) !== undefined, `${a} -> ${b}`);
  assert.equal(laneTier(undefined, terrain.poi('BeginningPort'), terrain, idx), undefined);
});

/** Hexes a dinghy launched at `from` can reach (clouds excluded, like the game's unsurveyable corners). */
const sailFrom = (terrain, idx, from) => {
  const ship = { hull: 'dinghy', q: from.q, r: from.r };
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const [dq, dr] of NEIGHBOURS) {
      const n = terrain.get(cur.q + dq, cur.r + dr);
      if (n === undefined || n.cloud === true || seen.has(n) || !canStep(cur, n, ship, idx)) continue;
      seen.add(n);
      if (isSea(n)) queue.push(n); // stepping ashore ends this crossing
    }
  }
  return seen;
};

test('dinghy on the real map: lands on tier 1 islands, never on the Cursed or Ominous Isle, reaches Deep Sea Ship', async () => {
  const terrain = await loadTerrain();
  const idx = seaIndex(terrain);
  const start = terrain.get(15, 9);
  const launch = launchSpot(start, terrain.neighbours(start.q, start.r));
  // island hopping: sail from every coast reached so far
  const landed = new Set();
  let frontier = [launch];
  const done = new Set();
  while (frontier.length > 0) {
    const next = [];
    for (const from of frontier) {
      for (const h of sailFrom(terrain, idx, from)) {
        if (isSea(h)) continue;
        const name = idx.islandOf(h)?.id ?? 'mainland';
        if (!landed.has(name)) landed.add(name);
        for (const n of terrain.neighbours(h.q, h.r)) if (isSea(n) && n.cloud !== true && !done.has(n)) { done.add(n); next.push(n); }
      }
    }
    frontier = next;
  }
  assert.deepEqual([...landed].sort(), ['frost', 'golden', 'mainland', 'western']);
  // Deep Sea Ship (3 hexes out) is fought from the next hex, which a dinghy reaches
  const dss = terrain.dungeon('DeepSeaShip') ?? [...terrain.all()].find((h) => h.dungeon === 'DeepSeaShip');
  assert.ok(dss !== undefined && dss.shore === 3);
  assert.ok(terrain.neighbours(dss.q, dss.r).some((n) => isSea(n) && idx.home(n, 1) <= HULLS.dinghy.reach));
});

test('no trap: from every sea hex a dinghy can reach a shore it may land on', async () => {
  const terrain = await loadTerrain();
  const idx = seaIndex(terrain);
  const stuck = [];
  for (const h of terrain.all()) {
    if (!isSea(h) || h.cloud === true) continue;
    const reached = sailFrom(terrain, idx, h);
    if (![...reached].some((r) => !isSea(r))) stuck.push(`${h.q},${h.r} shore ${h.shore}`);
  }
  assert.deepEqual(stuck, []);
});

test('no trap under cloud: from every cloud sea hex a dinghy gets out, and no open sea hex leads in', async () => {
  const terrain = await loadTerrain();
  const idx = seaIndex(terrain);
  const stuck = [];
  const leadsIn = [];
  for (const h of terrain.all()) {
    if (!isSea(h)) continue;
    const ship = dinghy(h.q, h.r);
    const steps = terrain.neighbours(h.q, h.r).filter((n) => canStep(h, n, ship, idx));
    if (h.cloud !== true) {
      if (steps.some((n) => n.cloud === true)) leadsIn.push(`${h.q},${h.r}`);
      continue;
    }
    assert.ok(Number.isFinite(idx.home(h, 1)), `${h.q},${h.r} has a way home`);
    // follow any allowed step: each is strictly closer, so this ends out of the cloud
    let cur = h;
    for (let i = 0; i < 50 && cur.cloud === true && isSea(cur); i++) {
      const next = terrain.neighbours(cur.q, cur.r).find((n) => canStep(cur, n, dinghy(cur.q, cur.r), idx));
      if (next === undefined) break;
      cur = next;
    }
    if (cur.cloud === true) stuck.push(`${h.q},${h.r}`);
  }
  assert.deepEqual(stuck, []);
  assert.deepEqual(leadsIn, []);
});

test('the places under cloud: none for the boats; the brig fights at Into the Mist and the Abyss; the galleon reaches all', async () => {
  const terrain = await loadTerrain();
  const idx = seaIndex(terrain);
  const places = [...terrain.all()].filter((r) => r.cloud === true && isPlace(r) && terrain.neighbours(r.q, r.r).every((n) => n === undefined || n.cloud === true));
  const name = (r) => r.dungeon ?? r.area ?? r.poi;
  const sail = (hull) => {
    const ship = { hull, q: 0, r: 0 }; // sea to sea, where the ship is doesn't matter
    const start = [...terrain.all()].filter((r) => isSea(r) && r.cloud !== true && idx.home(r, PLANNED_HULLS[hull]?.tier ?? HULLS[hull].tier) <= 1);
    const seen = new Set(start);
    const queue = [...start];
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const n of terrain.neighbours(cur.q, cur.r)) {
        if (n === undefined || !isSea(n) || seen.has(n) || !canStep(cur, n, ship, idx)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    const on = places.filter((p) => seen.has(p)).map(name).sort();
    const fights = places.filter((p) => seen.has(p) || terrain.neighbours(p.q, p.r).some((n) => seen.has(n))).map(name).sort();
    return { on, fights };
  };
  assert.equal(places.length, 6, places.map(name).join(', '));
  assert.deepEqual(sail('dinghy'), { on: [], fights: [] });
  assert.deepEqual(sail('longboat'), { on: [], fights: [] });
  const brig = sail('brig');
  assert.ok(brig.fights.includes('IntoTheAbyss') && brig.fights.includes('IntoTheMist'), brig.fights.join(', '));
  assert.ok(!brig.on.includes('IntoTheAbyss'), 'the Abyss hex itself is 6 out');
  assert.deepEqual(sail('galleon').on, places.map(name).sort());
});

test('no sea hex lets a dinghy onto the Deep Sea Ship\'s hex (3b check)', async () => {
  const terrain = await loadTerrain();
  const idx = seaIndex(terrain);
  const dss = [...terrain.all()].find((h) => h.dungeon === 'DeepSeaShip');
  for (const n of terrain.neighbours(dss.q, dss.r)) {
    if (isSea(n)) assert.equal(canStep(n, dss, dinghy(n.q, n.r), idx), false, `from ${n.q},${n.r}`);
  }
});

test('water bodies: the lake at display (16, 29) is not the sea the start launches into (3b check)', async () => {
  const terrain = await loadTerrain();
  const idx = seaIndex(terrain);
  const start = terrain.get(15, 9);
  const launch = launchSpot(start, terrain.neighbours(start.q, start.r));
  const lake = terrain.get(16, 21); // display (16, 29)
  assert.ok(isSea(lake) && lake.cloud !== true);
  assert.notEqual(idx.waterBody(lake), idx.waterBody(launch));
  assert.equal(idx.waterBody(terrain.poi('IllFatedVessel')), idx.waterBody(launch));
  assert.equal(idx.waterBody(start), undefined);
});

test('the corner pocket (0,9): 2 hexes from land behind cloud, so a dinghy there is beyond reach and heads out', async () => {
  const terrain = await loadTerrain();
  const idx = seaIndex(terrain);
  const pocket = terrain.get(0, 9);
  assert.equal(pocket.shore, 2);
  const ship = dinghy(0, 9);
  assert.ok(idx.home(pocket, 1) > HULLS.dinghy.reach);
  assert.equal(beyondReach(pocket, ship, idx), true);
  assert.equal(canStep(pocket, terrain.get(0, 8), ship, idx), true);
  assert.equal(isFreeStep(terrain.get(0, 8), ship, idx), true);
});

test('next to a higher-tier island counts as beyond a dinghy\'s reach unless a landable coast is near', async () => {
  const terrain = await loadTerrain();
  const idx = seaIndex(terrain);
  const port = terrain.poi('OminousPort');
  const off = terrain.neighbours(port.q, port.r).filter(isSea);
  assert.ok(off.length > 0);
  for (const h of off) assert.ok(idx.home(h, 3) === 1 && idx.home(h, 1) >= 1);
  // the brig may land at Ominous Port: its distance is 1 there
  assert.ok(off.some((h) => idx.home(h, 1) > idx.home(h, 3)));
});

test('fast travel is sailing: the ship must wait at the departure quay, may land there, and docks at the other end', () => {
  const portA = { ...land(0, 0), f: ['port'] };
  const portB = { ...land(10, 0), f: ['port'] };
  const dock = sea(11, 0, 1);
  assert.equal(hexDist(portA, portB), 10);
  assert.equal(canHop(portA, portB, dinghy(1, 0), dock), true);
  assert.equal(canHop(portA, portB, dinghy(3, 0), dock), false); // the ship is elsewhere
  assert.equal(canHop(portA, portB, null, dock), false);
  assert.equal(canHop(portA, portB, dinghy(1, 0), undefined), false); // nowhere to dock
  assert.equal(canHop(portA, portB, dinghy(1, 0), dock, { islandTier: () => 3, home: () => 0 }), false); // a brig's island
  // walk to the port, hop, walk on: the ship docks next to B and stays there
  const path = [land(-1, 0), portA, { ...portB, hop: true }, land(10, 1)];
  assert.deepEqual(shipAfterHops(path, dinghy(1, 0), () => dock), dinghy(11, 0));
  // the ship was not at A: it stays where it was
  const left = dinghy(5, 5);
  assert.equal(shipAfterHops(path, left, () => dock), left);
  assert.equal(shipAfterHops([land(0, 1), land(0, 2)], left, () => dock), left);
});

test('hull condition: a ship without one is sound; repairs go in 10% steps of 5 logs and 1 Pitch', () => {
  assert.equal(condOf(dinghy(1, 1)), 100);
  assert.equal(condOf({ ...dinghy(1, 1), cond: 42 }), 42);
  assert.equal(condOf(null), 100);
  assert.deepEqual(repairPlan(100, 999, 999), { steps: 0, want: 0, to: 100, logs: 0, pitch: 0, full: { logs: 0, pitch: 0 } });
  assert.deepEqual(repairPlan(0, 999, 999), { steps: 10, want: 10, to: 100, logs: 50, pitch: 10, full: { logs: 50, pitch: 10 } });
  assert.equal(repairPlan(95, 999, 999).to, 100); // the last step tops it up
  assert.equal(repairPlan(95, 999, 999).logs, REPAIR.logs);
  const short = repairPlan(40, 12, 9);
  assert.equal(short.steps, 2); // 12 logs pay for two steps
  assert.equal(short.to, 60);
  assert.equal(repairPlan(40, 999, 0).steps, 0);
});

test('a small boat is repaired beached on a coast, with you on it or next to it', () => {
  const boat = dinghy(5, 5);
  assert.equal(canRepair(land(5, 4), boat, sea(5, 5, 1)), true); // on the shore next to it
  assert.equal(canRepair(sea(5, 5, 1), boat, sea(5, 5, 1)), true); // aboard at the coast
  assert.equal(canRepair(sea(5, 5, 2), boat, sea(5, 5, 2)), false); // afloat away from land
  assert.equal(canRepair(land(5, 2), boat, sea(5, 5, 1)), false); // too far from it
  assert.equal(canRepair(land(5, 4), null, undefined), false);
});

test('Pitch: better logs give more', () => {
  assert.equal(pitchChance(1), 10.25);
  assert.equal(pitchChance(99), 34.75);
  assert.ok(pitchChance(60) > pitchChance(30));
});

test('the hold: 6 slots on a dinghy, a row of six more at Voyage 35 and 55 (the balance pass); reached at the ship', () => {
  assert.equal(holdSlots(dinghy(1, 1), 1), 6);
  assert.equal(holdSlots(dinghy(1, 1), 34), 6);
  assert.equal(holdSlots(dinghy(1, 1), 35), 12);
  assert.equal(holdSlots(dinghy(1, 1), 54), 12);
  assert.equal(holdSlots(dinghy(1, 1), 55), 18);
  assert.equal(holdSlots(dinghy(1, 1), 99), 18);
  for (const lv of [1, 40, 60, 80, 99]) assert.equal(holdSlots(dinghy(1, 1), lv) % 6, 0, 'whole rows of crates');
  assert.equal(holdSlots(null, 50), 0);
  assert.equal(atShip(land(5, 4), dinghy(5, 5)), true);
  assert.equal(atShip(sea(5, 5, 1), dinghy(5, 5)), true);
  assert.equal(atShip(land(5, 3), dinghy(5, 5)), false);
  assert.equal(atShip(land(5, 4), null), false);
});

test('stowing stacks like the bank; a new kind needs a free slot; taking out frees an emptied slot', () => {
  let hold = stow([], 'a', 5, 2);
  hold = stow(hold, 'b', 1, 2);
  assert.deepEqual(hold, [{ id: 'a', qty: 5 }, { id: 'b', qty: 1 }]);
  assert.equal(stow(hold, 'c', 1, 2), undefined); // full
  assert.deepEqual(stow(hold, 'a', 3, 2), [{ id: 'a', qty: 8 }, { id: 'b', qty: 1 }]); // stacks even when full
  assert.deepEqual(takeOut(hold, 'a', 2), { hold: [{ id: 'a', qty: 3 }, { id: 'b', qty: 1 }], taken: 2 });
  assert.deepEqual(takeOut(hold, 'b', 99), { hold: [{ id: 'a', qty: 5 }], taken: 1 });
  assert.deepEqual(takeOut(hold, 'z', 1), { hold, taken: 0 });
});

test('the dinghy wants an Old Hat only where Fishing can be had (the user, 18 Oct 2026: "skip for Adv")', () => {
  assert.ok(dinghyBuild(true).items.some((x) => x.id === OLD_HAT));
  assert.ok(!dinghyBuild(false).items.some((x) => x.id === OLD_HAT));
  assert.equal(dinghyBuild(false).gp, DINGHY_BUILD.gp);
  assert.ok(!shipBill(false)[0].items.some((x) => x.id === OLD_HAT));
});

test('the shipwright\'s bill lists every hull at the price the code charges', () => {
  const bill = shipBill();
  assert.deepEqual(bill.map((b) => b.id), ['dinghy', 'longboat', 'brig', 'galleon']);
  assert.equal(bill[0].level, 0);
  assert.deepEqual(bill[0].items, DINGHY_BUILD.items);
  assert.equal(bill[1].from, 'dinghy');
  assert.equal(bill[2].bought, true);
  assert.equal(bill[3].from, 'brig');
  assert.equal(bill[3].reach, Infinity);
  assert.deepEqual(bill.map((b) => b.hold), [6, 12, 18, 24]);
  // Big Bones in every hull after the dinghy (builds .148 and .177).
  assert.deepEqual(bill.map((b) => b.items.find((i) => i.id === 'melvorD:Big_Bones')?.quantity), [undefined, 50, 250, 550]);
});
