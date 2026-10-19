import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SEASONS, seasonKey, tempOf, bandOf, BANDS, effectsOf, isPlain, allNight, harvestRates, nextOrder, iceOn, iceHexes,
  icedRecord, wayAshore, NONE, LEMON_SEA_FOOD, WIND_SIDES, WIND_TURN_MS, WIND_ORIGIN, WIND_FACTORS, createWind, windTurn,
  nextWindTurnAt, headingOf, windGap, windFactor, newWindSeed, windRoll, STORM_CHANCE, STORM_STEP_MS, STORM_STEPS_MIN,
  STORM_STEPS_MAX, STORM_TIME, STORM_WEAR, SIDE_OFFSETS, stormChance, stormOfTurn, stormsAt, stormHexes, stormPush,
} from '../src/weather-model.mjs';
import { stepCost, planMove, RATION_HP, HEX_COST, wearOf } from '../src/stores-model.mjs';
import { stepMs, LAND_MS, routeTicks, SEA_MS, TICK_MS } from '../src/clock-model.mjs';
import { seaIndex, canStep, isSea, shipAfterPath } from '../src/ship-model.mjs';
import { createTerrain, CLASSES } from '../src/terrain.mjs';

const loadTable = async () => JSON.parse(await readFile(new URL('../data/hex_terrain.json', import.meta.url), 'utf8'));
const [SPRING, SUMMER, FALL, WINTER, NIGHTFALL, ECLIPSE, LEMON, DARKNESS] = [0, 1, 2, 3, 4, 5, 6, 7];

test('seasons by Township order, unknown ones read as Spring', () => {
  assert.deepEqual(SEASONS.slice(0, 4), ['spring', 'summer', 'fall', 'winter']);
  assert.equal(seasonKey(LEMON), 'lemon');
  assert.equal(seasonKey(99), 'spring');
  assert.equal(seasonKey(undefined), 'spring');
});

test('degrees: the table on the canvas', () => {
  const row = (cls) => [SPRING, SUMMER, FALL, WINTER].map((o) => tempOf(cls, o));
  assert.deepEqual(row('snowlands'), [-8, 0, -12, -20]);
  assert.deepEqual(row('mountain'), [-4, 4, -8, -16]);
  assert.deepEqual(row('desert'), [28, 36, 24, 16]);
  assert.deepEqual(row('lavalands'), [32, 40, 28, 20]);
  assert.deepEqual(row('water'), [10, 18, 6, -2]);
  // The rare seasons keep Spring's degrees; an unknown ground is grasslands.
  assert.equal(tempOf('desert', NIGHTFALL), 28);
  assert.equal(tempOf('nowhere', SPRING), tempOf('grasslands', SPRING));
});

test('bands: edges on whole degrees', () => {
  assert.equal(bandOf(-15).id, 'bitter');
  assert.equal(bandOf(-14).id, 'cold');
  assert.equal(bandOf(0).id, 'cold');
  assert.equal(bandOf(1).id, 'mild');
  assert.equal(bandOf(19).id, 'mild');
  assert.equal(bandOf(20).id, 'warm');
  assert.equal(bandOf(34).id, 'warm');
  assert.equal(bandOf(35).id, 'scorching');
  assert.equal(BANDS.length, 5);
});

test('what bites in each season: every land class covered', () => {
  const land = CLASSES.filter((c) => c !== 'water' && c !== 'shoal');
  const bands = (o) => Object.fromEntries(land.map((c) => [c, effectsOf(c, o).band]));
  const w = bands(WINTER);
  assert.equal(w.snowlands, 'bitter');
  assert.equal(w.mountain, 'bitter');
  assert.equal(w.cursedlands, 'cold');
  assert.equal(w.highlands, 'cold');
  assert.equal(w.grasslands, 'mild');
  const s = bands(SUMMER);
  assert.equal(s.desert, 'scorching');
  assert.equal(s.lavalands, 'scorching');
  assert.equal(s.badlands, 'warm', 'a degree short of scorching');
  assert.equal(s.grasslands, 'warm');
  const sp = bands(SPRING);
  assert.equal(sp.snowlands, 'cold');
  assert.equal(sp.mountain, 'cold');
  assert.equal(sp.beach, 'warm');
  assert.equal(sp.grasslands, 'mild');
  assert.equal(bands(FALL).cursedlands, 'cold');
  // Every season of the year changes something; only Winter is bitter and only Summer scorches.
  const touched = (o) => land.filter((c) => !isPlain(effectsOf(c, o))).length;
  for (const o of [SPRING, SUMMER, FALL, WINTER]) assert.ok(touched(o) > 0);
  const has = (o, id) => land.some((c) => effectsOf(c, o).band === id);
  assert.deepEqual([SPRING, SUMMER, FALL, WINTER].map((o) => has(o, 'bitter')), [false, false, false, true]);
  assert.deepEqual([SPRING, SUMMER, FALL, WINTER].map((o) => has(o, 'scorching')), [false, true, false, false]);
});

test('the sea pays nothing for its degrees; Lemon makes its rations go further', () => {
  const w = effectsOf('water', WINTER);
  assert.equal(w.t, -2);
  assert.equal(w.fuel, 1);
  assert.equal(w.rations, 0);
  assert.equal(w.time, 1);
  assert.ok(isPlain(w));
  assert.equal(effectsOf('shoal', LEMON).seaFood, LEMON_SEA_FOOD);
  assert.equal(effectsOf('grasslands', LEMON).seaFood, 1);
  assert.ok(isPlain(NONE));
});

test('the bands in the stores: fuel, thirst and the Firemaking cut', () => {
  const at = (cls, o) => ({ cls, sea: false, wx: effectsOf(cls, o) });
  // Winter Snowlands: 2 fuel x1.5 = 3 at Firemaking 0; 2 rations as ever.
  assert.deepEqual(stepCost(at('snowlands', WINTER), 0), { food: 2 * RATION_HP, fuel: 3 });
  // Spring Snowlands is cold: x1.25.
  assert.equal(stepCost(at('snowlands', SPRING), 0).fuel, 2.5);
  // Summer Desert: thirst, a ration more; the warm fire burns less.
  assert.deepEqual(stepCost(at('desert', SUMMER), 0), { food: 2 * RATION_HP, fuel: 0.75 });
  // Firemaking's cut on top: level 50 is x0.75.
  assert.equal(stepCost(at('snowlands', WINTER), 50).fuel, 2.25);
  // No weather: the table as before.
  assert.deepEqual(stepCost({ cls: 'snowlands', sea: false }, 0), { food: HEX_COST.snowlands.rations * RATION_HP, fuel: HEX_COST.snowlands.fuel });
  // Lemon at sea and on a hop.
  assert.equal(stepCost({ cls: 'water', sea: true, wx: effectsOf('water', LEMON) }, 0).food, 15);
  assert.equal(stepCost({ hop: 4, wx: effectsOf('water', LEMON) }, 0).food, 60);
});

test('a refusal names the weather-raised need, and the hunger floor still walks easy ground', () => {
  const steps = [{ cls: 'snowlands', sea: false, wx: effectsOf('snowlands', WINTER) }];
  const r = planMove({ food: 100, fuel: 2.9 }, steps, { fmLevel: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.why, 'fuel');
  assert.equal(r.need.fuel, 3);
  const desert = [{ cls: 'desert', sea: false, wx: effectsOf('desert', SUMMER) }];
  const hungry = planMove({ food: 0, fuel: 0 }, desert, { fmLevel: 0 });
  assert.equal(hungry.ok, true);
  assert.deepEqual(hungry.hungry, [0]);
});

test('time: snowdrifts and the noon rest on land, nothing at sea', () => {
  assert.equal(stepMs({ cls: 'snowlands', wx: effectsOf('snowlands', WINTER) }), LAND_MS * 2 * 1.25);
  assert.equal(stepMs({ cls: 'desert', wx: effectsOf('desert', SUMMER) }), LAND_MS * 1.5 * 1.25);
  assert.equal(stepMs({ cls: 'grasslands', wx: effectsOf('grasslands', WINTER) }), LAND_MS);
  assert.equal(stepMs({ sea: true, cls: 'water', wx: effectsOf('water', WINTER) }, { hullOf: () => 'brig' }), 3 * 60000);
});

test('rare seasons: night all season, Lemon is not', () => {
  assert.ok(allNight(NIGHTFALL));
  assert.ok(allNight(ECLIPSE));
  assert.ok(allNight(DARKNESS));
  assert.ok(!allNight(LEMON));
  assert.ok(!allNight(WINTER));
});

test('the Fall harvest lifts food where food loads, never the wild or fuel', () => {
  assert.deepEqual(harvestRates({ place: 'farm', food: 0.5, fuel: 0.5 }, FALL), { place: 'farm', food: 0.75, fuel: 0.5, harvest: true });
  assert.equal(harvestRates({ place: 'market', food: 0.75, fuel: 0.5 }, FALL).food, 1);
  assert.equal(harvestRates({ place: 'port', food: 1, fuel: 1 }, FALL).harvest, false);
  assert.equal(harvestRates(undefined, FALL), undefined);
  const r = { place: 'farm', food: 0.5, fuel: 0.5 };
  assert.equal(harvestRates(r, SUMMER), r);
});

test('the next season: the year turns, a rare season gives way to the one after the season it broke', () => {
  assert.equal(nextOrder(SPRING), SUMMER);
  assert.equal(nextOrder(WINTER), SPRING);
  assert.equal(nextOrder(NIGHTFALL, FALL), WINTER);
  assert.equal(nextOrder(LEMON, undefined), SUMMER);
  assert.equal(nextOrder(undefined), SUMMER);
});

test('the ice on the real map: 62 hexes, Winter only, and it joins Frost Island to the mainland', async () => {
  const table = await loadTable();
  const terrain = createTerrain(table);
  const ice = iceHexes(terrain.all(), (h) => terrain.neighbours(h.q, h.r));
  assert.equal(ice.length, 62);
  assert.ok(ice.every(isSea));
  assert.ok(iceOn(WINTER) && !iceOn(FALL) && !iceOn(LEMON));
  const keys = new Set(ice.map((h) => `${h.q},${h.r}`));
  // The two sea hexes between the mainland's north-east coast and Frost Island: display (20, 24) and (21, 23).
  assert.ok(keys.has('20,14') && keys.has('21,13'));
  // Laid over the table: walkable from the mainland to Frost Drift Port on foot.
  terrain.setLayer(ice.map(icedRecord));
  assert.equal(terrain.get(20, 14).t, 'snowlands');
  assert.equal(terrain.get(20, 14).ice, true);
  assert.equal(terrain.get(20, 14).was, 'water');
  assert.equal(terrain.base(20, 14).t, 'water');
  const mainland = terrain.get(22, 12);
  assert.ok(mainland !== undefined && !isSea(mainland));
  assert.ok(canStep(mainland, terrain.get(21, 13), null));
  assert.ok(canStep(terrain.get(21, 13), terrain.get(20, 14), null));
  // The landmasses stay the table's: island tiers never move with the season.
  assert.equal(terrain.landmass(20, 14), undefined);
  // Lifted again.
  const v = terrain.version;
  terrain.setLayer(undefined);
  assert.equal(terrain.get(20, 14).t, 'water');
  assert.ok(terrain.version > v);
});

test('ships and the ice: no sailing in, stepping off onto it, frozen in', async () => {
  const terrain = createTerrain(await loadTable());
  const ice = iceHexes(terrain.all(), (h) => terrain.neighbours(h.q, h.r));
  // An open sea hex next to the ice ring.
  const iceKeys = new Set(ice.map((h) => `${h.q},${h.r}`));
  const open = [...terrain.all()].find((h) => isSea(h) && !iceKeys.has(`${h.q},${h.r}`) && terrain.neighbours(h.q, h.r).some((n) => iceKeys.has(`${n.q},${n.r}`)));
  const edge = terrain.neighbours(open.q, open.r).find((n) => iceKeys.has(`${n.q},${n.r}`));
  terrain.setLayer(ice.map(icedRecord));
  const geo = seaIndex(terrain);
  const boat = { hull: 'dinghy', q: open.q, r: open.r };
  const iced = terrain.get(edge.q, edge.r);
  // From the sea onto the ice is stepping ashore; the boat stays where it was.
  assert.ok(canStep(terrain.get(open.q, open.r), iced, boat, geo));
  assert.deepEqual(shipAfterPath([terrain.get(open.q, open.r), iced], boat), boat);
  // A boat frozen in on the ice: from its hex no sea hex may be entered.
  const frozen = { hull: 'dinghy', q: iced.q, r: iced.r };
  assert.equal(canStep(iced, terrain.get(open.q, open.r), frozen, geo), false);
});

test('the thaw: the shortest way ashore from the old ice', async () => {
  const terrain = createTerrain(await loadTable());
  const nb = (h) => terrain.neighbours(h.q, h.r);
  const way = wayAshore(terrain.get(20, 14), nb);
  assert.ok(way.length >= 2 && way.length <= 3);
  assert.equal(way[0], terrain.get(20, 14));
  assert.ok(!isSea(way[way.length - 1]));
  assert.equal(wayAshore(terrain.get(22, 12), nb), undefined);
});

test('wind: six sides; a step\'s heading from its axial offset, a hop to the nearest side', () => {
  assert.deepEqual(WIND_SIDES, ['N', 'NE', 'SE', 'S', 'SW', 'NW']);
  const sides = [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]].map(([q, r]) => WIND_SIDES[headingOf(q, r)]);
  assert.deepEqual(sides, WIND_SIDES);
  assert.equal(WIND_SIDES[headingOf(0, -4)], 'N');
  assert.equal(WIND_SIDES[headingOf(3, -1)], 'SE'); // just south of east
  assert.equal(WIND_SIDES[headingOf(3, -2)], 'NE'); // just north of east
  assert.equal(headingOf(0, 0), undefined);
});

test('wind: with it ×0.7, broad ×0.85, close ×1.15, against ×1.4; small boats half; no wind or heading, ×1', () => {
  const NW = 5;
  const SE = 2;
  assert.equal(windGap(NW, SE), 0);
  assert.equal(windFactor(NW, SE), 0.7);
  assert.equal(windFactor(NW, 1), 0.85); // NE
  assert.equal(windFactor(NW, 3), 0.85); // S
  assert.equal(windFactor(NW, 0), 1.15); // N
  assert.equal(windFactor(NW, 4), 1.15); // SW
  assert.equal(windFactor(NW, NW), 1.4);
  assert.equal(windFactor(NW, SE, true), 0.85);
  assert.equal(windFactor(NW, NW, true), 1.2);
  assert.equal(windFactor(undefined, SE), 1);
  assert.equal(windFactor(NW, undefined), 1);
  // Over all six headings it about evens out.
  const avg = [0, 1, 2, 3, 4, 5].reduce((a, h) => a + windFactor(0, h), 0) / 6;
  assert.ok(Math.abs(avg - 1) < 0.02); // 1.017: a hair slower on average
  assert.deepEqual(WIND_FACTORS, [0.7, 0.85, 1.15, 1.4]);
});

test('wind: seeded per character, holds 6 h, turns at most one side, the same however it is asked', () => {
  const t0 = Date.UTC(2026, 9, 19, 3, 0);
  assert.equal(windTurn(WIND_ORIGIN - 1), 0);
  assert.equal(nextWindTurnAt(t0) - WIND_TURN_MS <= t0, true);
  assert.equal(nextWindTurnAt(t0) > t0, true);
  const a = createWind(4242);
  const seq = [];
  for (let i = 0; i < 400; i++) seq.push(a.at(t0 + i * WIND_TURN_MS));
  for (let i = 1; i < seq.length; i++) {
    const d = Math.abs(seq[i] - seq[i - 1]);
    assert.ok(Math.min(d, 6 - d) <= 1, `turn ${i}: ${seq[i - 1]} -> ${seq[i]}`);
  }
  // Every side comes round, and it does not hold for ever.
  assert.equal(new Set(seq).size, 6);
  assert.ok(seq.some((s, i) => i > 0 && s !== seq[i - 1]));
  // The same within a turn, and the same asked backwards or by a fresh copy (offline replays ask in any order).
  assert.equal(a.at(t0 + 1000), a.at(t0 + WIND_TURN_MS - 1 - ((t0 - WIND_ORIGIN) % WIND_TURN_MS)));
  const b = createWind(4242);
  assert.equal(b.at(t0 + 399 * WIND_TURN_MS), seq[399]);
  assert.equal(b.at(t0), seq[0]);
  // Another character, other winds.
  const c = createWind(777);
  const other = [];
  for (let i = 0; i < 400; i++) other.push(c.at(t0 + i * WIND_TURN_MS));
  assert.notDeepEqual(other, seq);
  // Seeds are whole numbers in range; the roll stays in [0, 1).
  for (const r of [0, 0.5, 0.999999]) { const s = newWindSeed(() => r); assert.ok(Number.isInteger(s) && s >= 1 && s < 2 ** 31); }
  for (let k = 0; k < 50; k++) { const x = windRoll(99, k); assert.ok(x >= 0 && x < 1); }
});

test('wind in the schedule: each sailed step in the wind as it begins; land and calm untouched', () => {
  const hullOf = (kind) => (kind === 'ship' ? 'galleon' : 'dinghy');
  const opts = { hullOf };
  // Two galleon steps heading SE, then a land step: the wind from the NW until the first step ends, then from the SE.
  const steps = [
    { sea: true, cls: 'water', vessel: 'ship', dq: 1, dr: 0 },
    { sea: true, cls: 'water', vessel: 'ship', dq: 1, dr: 0 },
    { sea: false, cls: 'grasslands', dq: 0, dr: 1 },
  ];
  const turnAt = SEA_MS.galleon * 0.7; // the first step's end
  const windOf = (s, ms) => {
    const from = ms < turnAt ? 5 : 2; // NW, then SE
    return windFactor(from, headingOf(s.dq, s.dr), (s.vessel ?? 'boat') === 'boat');
  };
  const ticks = routeTicks(steps, opts, 0, windOf);
  assert.deepEqual(ticks.map((n) => n * TICK_MS), [SEA_MS.galleon * 0.7, SEA_MS.galleon * 1.4, LAND_MS]);
  // No wind: the plain times.
  assert.deepEqual(routeTicks(steps, opts, 0).map((n) => n * TICK_MS), [SEA_MS.galleon, SEA_MS.galleon, LAND_MS]);
  // The dinghy feels half: downwind ×0.85.
  const boat = [{ sea: true, cls: 'water', vessel: 'boat', dq: 1, dr: 0 }];
  assert.equal(routeTicks(boat, opts, 0, () => windFactor(5, 2, true))[0] * TICK_MS, SEA_MS.dinghy * 0.85);
  // A fast-travel hop takes the wind on its whole length, by its nearest side.
  const hop = [{ fastTravel: true, hop: 3, vessel: 'ship', dq: 3, dr: -1 }];
  assert.equal(routeTicks(hop, opts, 0, (s) => windFactor(5, headingOf(s.dq, s.dr), false))[0] * TICK_MS, Math.round(3 * SEA_MS.galleon * 0.7));
});

test('storms: chances by season, born on open sea, 3 to 6 hours, drifting downwind a hex each half-hour', () => {
  assert.equal(stormChance(0), STORM_CHANCE.spring);
  assert.equal(stormChance(3), STORM_CHANCE.winter);
  assert.equal(stormChance(6), STORM_CHANCE.spring); // Lemon keeps Spring's
  const sea = [{ q: 10, r: 10 }, { q: 20, r: 5 }, { q: 3, r: 30 }];
  // Over many turns: Winter bears about 35%, Summer about 5%; each storm born inside its turn, on the list, 6-12 steps.
  const count = (order) => {
    let n = 0;
    for (let k = 0; k < 4000; k++) {
      const s = stormOfTurn(777, k, order, sea);
      if (s === undefined) continue;
      n += 1;
      const start = WIND_ORIGIN + k * WIND_TURN_MS;
      assert.ok(s.born >= start && s.born < start + WIND_TURN_MS && (s.born - start) % STORM_STEP_MS === 0);
      assert.ok(s.steps >= STORM_STEPS_MIN && s.steps <= STORM_STEPS_MAX);
      assert.ok(sea.some((h) => h.q === s.q && h.r === s.r));
    }
    return n / 4000;
  };
  assert.ok(Math.abs(count(3) - 0.35) < 0.03);
  assert.ok(Math.abs(count(1) - 0.05) < 0.02);
  // No open sea, no storm.
  assert.equal(stormOfTurn(777, 1, 3, []), undefined);
  // A storm drifts: with the wind steady from the NW (5) it goes SE (2) a hex each half-hour, and is gone at its end.
  let k = 0;
  let s;
  while ((s = stormOfTurn(5, k, 3, sea)) === undefined) k += 1;
  const nw = () => 5;
  assert.deepEqual(stormsAt(5, s.born - 1, 3, sea, nw).filter((x) => x.k === k), []);
  const first = stormsAt(5, s.born, 3, sea, nw).find((x) => x.k === k);
  assert.equal(first.q, s.q); assert.equal(first.r, s.r); assert.equal(first.toward, 2);
  const later = stormsAt(5, s.born + 2 * STORM_STEP_MS + 1, 3, sea, nw).find((x) => x.k === k);
  assert.equal(later.q, s.q + 2 * SIDE_OFFSETS[2][0]); assert.equal(later.r, s.r + 2 * SIDE_OFFSETS[2][1]);
  const ends = s.born + s.steps * STORM_STEP_MS;
  assert.equal(stormsAt(5, ends - 1, 3, sea, nw).some((x) => x.k === k), true);
  assert.equal(stormsAt(5, ends, 3, sea, nw).some((x) => x.k === k), false);
  // Seven hexes: the centre and its ring, each a neighbour.
  const hexes = stormHexes({ q: 4, r: 4 });
  assert.equal(hexes.length, 7);
  assert.equal(new Set(hexes.map((h) => `${h.q},${h.r}`)).size, 7);
  // The push: about 1 in 4, the same for the same voyage and step.
  let pushes = 0;
  for (let i = 0; i < 4000; i++) if (stormPush(9, 1200 + (i % 7), i % 60, Math.floor(i / 60))) pushes += 1;
  assert.ok(Math.abs(pushes / 4000 - 0.25) < 0.03);
  assert.equal(stormPush(9, 1200, 17, 4), stormPush(9, 1200, 17, 4));
});

test('storms in the schedule and the wear: ×1.5 the time, a push adds a calm hex, ×3 the hull', () => {
  const opts = { hullOf: (kind) => (kind === 'ship' ? 'galleon' : 'dinghy') };
  const steps = [
    { sea: true, cls: 'water', vessel: 'ship', dq: 1, dr: 0 },
    { sea: true, cls: 'water', vessel: 'ship', dq: 1, dr: 0 },
    { sea: false, cls: 'grasslands' },
  ];
  // The second hex is stormy when entered; then with a push.
  const stormy = (push) => (s, ms, i) => (i === 1 ? { x: STORM_TIME, push } : undefined);
  assert.deepEqual(routeTicks(steps, opts, 0, undefined, stormy(false)).map((n) => n * TICK_MS), [SEA_MS.galleon, SEA_MS.galleon * 1.5, LAND_MS]);
  assert.deepEqual(routeTicks(steps, opts, 0, undefined, stormy(true)).map((n) => n * TICK_MS), [SEA_MS.galleon, SEA_MS.galleon * 2.5, LAND_MS]);
  // The storm is asked about the moment the hex is entered: the step's start plus its time in the wind.
  const asked = [];
  routeTicks(steps.slice(0, 1), opts, 1000, () => 0.7, (s, ms) => { asked.push(ms); return undefined; });
  assert.deepEqual(asked, [1000 + SEA_MS.galleon * 0.7]);
  // Wear: ×3 on a stormy sea hex, deep water too; a hop is never stormy.
  assert.equal(wearOf({ sea: true, storm: STORM_WEAR }), 3);
  assert.equal(wearOf({ sea: true, deep: true, storm: STORM_WEAR }), 6);
  assert.equal(wearOf({ fastTravel: true, hop: 2, storm: STORM_WEAR }), 2);
});
