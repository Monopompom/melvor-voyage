// The ship's pure rules (phase 3b): hulls, which step a path may take, where the ship ends up after a
// move, where a new dinghy is launched and who gets a free one. Hexes are terrain records ({ q, r, t, shore }, see
// data/hex_terrain.json); `shore` is the precomputed number of steps from a sea hex to the nearest land.
// No game objects here; covered by tests/ship-model.test.mjs.

/**
 * Hull tiers. Only the dinghy exists in phase 3b; the longboat, brig and galleon come with phase 4. Reach and the
 * island tiers below follow the game's default dungeon order (decided 15 Oct 2026).
 */
export const HULLS = {
  dinghy: {
    id: 'dinghy', tier: 1, name: 'Dinghy', media: 'assets/hull_dinghy.png',
    /** Farthest a hull sails from land, in hexes. */
    reach: 2,
    blurb: 'A small rowing boat. It stays within 2 hexes of land and you can board or leave it on any coast.',
  },
};

/**
 * What the first dinghy costs on the Voyage page (GP and logs). Placeholder numbers for the balance
 * pass, chosen 15 Oct 2026: under a quarter of the 2,500 GP starter purse and a few minutes of level 1 Woodcutting.
 */
/**
 * Islands that need a bigger hull to land on (decided 15 Oct 2026: lock by hull tier, in the default dungeon order).
 * Each island is found by a POI on it (`anchor`), so the table survives landmass renumbering. Islands not listed
 * (the mainland, Western, Golden and Frost) take any hull. A hull may always leave an island it is on.
 */
export const ISLANDS = [
  { id: 'western', name: 'the Western Isle', anchor: 'AncientMarket', tier: 1 },
  { id: 'golden', name: 'the Golden Isle', anchor: 'MulticulturalPort', tier: 1 },
  { id: 'frost', name: 'Frost Island', anchor: 'FrostyHaven', tier: 1, why: 'Frozen Cove, dungeon 4' },
  { id: 'cursed', name: 'the Cursed Isle', anchor: 'CastleRuins', tier: 2, why: 'the Air God Dungeon, dungeon 9' },
  { id: 'ominous', name: 'the Ominous Isle', anchor: 'OminousPort', tier: 3, why: 'the Earth God Dungeon, dungeon 11' },
];

/** Hull names by tier, for "needs a longboat" before those hulls exist. */
export const TIER_NAMES = { 1: 'dinghy', 2: 'longboat', 3: 'brig', 4: 'galleon' };

/**
 * Language keys (languages/en.json) for the names above. The English stays here for the tests; the game shows
 * getLangString(key). tests/lang-ship.test.mjs checks the two agree. A hull named mid-sentence uses its tier name
 * (lower case in English), so the hull tables need no separate lower-case key.
 */
export const hullNameKey = (id) => `MOD_VOY_HULL_NAME_${String(id).toUpperCase()}`;
export const hullBlurbKey = (id) => `MOD_VOY_HULL_BLURB_${String(id).toUpperCase()}`;
export const islandNameKey = (id) => `MOD_VOY_ISLAND_${String(id).toUpperCase()}`;
export const tierNameKey = (tier) => (TIER_NAMES[tier] === undefined ? 'MOD_VOY_HULL_TIER_UNKNOWN' : `MOD_VOY_HULL_TIER_${tier}`);
/** English for MOD_VOY_HULL_TIER_UNKNOWN: an island tier with no hull name yet. */
export const UNKNOWN_TIER_NAME = 'bigger ship';

export const DINGHY_BUILD = { gp: 500, items: [{ id: 'melvorD:Normal_Logs', quantity: 50 }] };

/**
 * Hull condition (phase 3d): `ship.cond`, 0 to 100 (%). Sailing wears it (stores-model.mjs wearOf);
 * repairs cost logs and Pitch. A save without it is a sound hull.
 */
export const condOf = (ship) => (Number.isFinite(ship?.cond) ? Math.min(100, Math.max(0, ship.cond)) : 100);
/** Deep water: 3 or more hexes from land (the table's `shore`). Below 50% a hull keeps out of it. */
export const DEEP_SHORE = 3;
/** Every 10% of condition takes 5 logs (timber, any kind, the cheapest first) and 1 Pitch. */
export const REPAIR = { step: 10, logs: 5, pitch: 1 };
/**
 * What repairing a hull at `cond` takes with `logs` and `pitch` in the bank: as many 10% steps as it needs and they
 * pay for. { steps, to, logs, pitch } for what can be done now, `want` the steps to 100%, `full` their cost.
 */
export function repairPlan(cond, logs, pitch) {
  const want = Math.max(0, Math.ceil((100 - cond) / REPAIR.step));
  const steps = Math.max(0, Math.min(want, Math.floor(logs / REPAIR.logs), Math.floor(pitch / REPAIR.pitch)));
  return {
    steps, want, to: Math.min(100, cond + steps * REPAIR.step), logs: steps * REPAIR.logs, pitch: steps * REPAIR.pitch,
    full: { logs: want * REPAIR.logs, pitch: want * REPAIR.pitch },
  };
}
/**
 * Where a hull is repaired: a small boat (tiers 1 and 2) is beached on a coast, as careening was done, so the ship
 * sits next to land and you stand on it or next to it. A sailing ship (tiers 3 and 4) needs a port (`portNear`).
 */
export function canRepair(playerRec, ship, shipRec, portNear = false) {
  if (ship == null || playerRec === undefined) return false;
  if (tierOf(ship) >= 3) return portNear === true;
  return hexDist(playerRec, ship) <= 1 && shoreOf(shipRec) === 1;
}
/**
 * Pitch from Firemaking (3d): the chance in % per log burned, 10% plus a quarter of a percent per Firemaking level the
 * log needs (Normal 10.25%, Willow 17.5%, Magic 28.75%, Redwood 32.5%). Better logs give more.
 */
export const pitchChance = (logLevel) => 10 + 0.25 * Math.max(1, Math.floor(logLevel ?? 1));

export const SEA_CLASSES = ['water', 'shoal'];
export const isSea = (rec) => rec !== undefined && SEA_CLASSES.includes(rec.t);
export const sameHex = (a, b) => a !== undefined && a !== null && b !== undefined && b !== null && a.q === b.q && a.r === b.r;

const shoreOf = (rec) => (Number.isInteger(rec?.shore) ? rec.shore : 1);
export const reachOf = (ship) => HULLS[ship?.hull]?.reach ?? 0;
export const tierOf = (ship) => HULLS[ship?.hull]?.tier ?? 0;

/** True when the player stands on the ship's hex, which is the only way to be on the water. */
export const isAboard = (playerRec, ship) => sameHex(playerRec, ship);

/**
 * The map facts the step rule needs, `geo`: `islandTier(rec)` (hull tier an island needs, 1 elsewhere) and
 * `home(rec, tier)` (steps over the sea to the nearest coast a hull of that tier may land on, clouds avoided; 0 on
 * land, Infinity when none; tier 0 = any land, for swimming). seaIndex() builds it from the table. Without one the
 * rule falls back to the table's `shore` and no island tiers (tests).
 */
const plainGeo = { islandTier: () => 1, home: (rec) => (isSea(rec) ? shoreOf(rec) : 0) };

/**
 * May a path step from `from` to `to`? The rule has no memory of the path so far, which is enough for a shortest path:
 *  - land is open, but stepping ashore from the sea onto an island needs a hull of its tier. Without a ship
 *    (swimming home) any shore takes you;
 *  - from land, the only sea hex you may enter is the ship's own (boarding); without a ship, none;
 *  - from the sea, any sea hex within the hull's reach of a coast it may land on, or (the homeward rule) one no
 *    farther from such a coast than where you are. Reach is measured by sailing, not as the crow flies, so a hull
 *    near land it can't use (a higher-tier island, land behind cloud) is out of its place too, and every hex has a
 *    neighbour one step closer: nobody is ever trapped;
 *    A homeward move never ends on a place (a POI, area or dungeon hex): the places out there wait for a bigger hull
 *    (3b check, 16 Oct 2026: a dinghy beyond reach could drift onto the Deep Sea Ship's hex);
 *  - nothing sails into cloud. A hull that is under cloud anyway (put there with the rules off) may only step closer
 *    to a coast, by the distance seaIndex counts through the cloud, so it always gets out;
 *  - on the sea with no ship (rules switched off and on again), only steps closer to land.
 * A path enters the sea only at the ship's hex, and a shortest path never visits a hex twice, so the ship is with you
 * for every sea step of it.
 */
export function canStep(from, to, ship, geo = plainGeo) {
  if (!isSea(to)) return !isSea(from) || ship == null || tierOf(ship) >= geo.islandTier(to);
  if (!isSea(from)) return ship != null && sameHex(to, ship);
  if (to.cloud === true && from.cloud !== true) return false;
  const t = ship == null ? 0 : tierOf(ship);
  const h = geo.home(to, t);
  if (ship == null) return h < geo.home(from, t);
  const out = to.cloud === true || h > reachOf(ship);
  if (out && isPlace(to)) return false;
  if (from.cloud === true) return h < geo.home(from, t);
  return !out || h <= geo.home(from, t);
}

/** A hex that holds somewhere to go: a map POI, a hand-placed area or a dungeon. */
export const isPlace = (rec) => rec?.poi !== undefined || rec?.area !== undefined || rec?.dungeon !== undefined;

/** True when the hull on `rec` is beyond its reach: the homeward rule applies there. Under cloud is always beyond. */
export function beyondReach(rec, ship, geo = plainGeo) {
  return isSea(rec) && ship != null && (rec.cloud === true || geo.home(rec, tierOf(ship)) > reachOf(ship));
}

/** A sea step that gives nothing: beyond the hull's reach (the homeward rule) or swimming with no ship. */
export function isFreeStep(to, ship, geo = plainGeo) {
  return isSea(to) && (ship == null || beyondReach(to, ship, geo));
}

/**
 * Where the ship is after a move along `path` (records from the start to the destination). Aboard means standing on
 * the ship's hex; while aboard it follows you across the sea and stays on the last sea hex when you step ashore.
 * Without the rules (switched off) a path may cross the sea elsewhere: the ship moves only when you board it.
 */
export function shipAfterPath(path, ship) {
  if (ship == null || path.length === 0) return ship;
  let at = { q: ship.q, r: ship.r };
  let aboard = sameHex(path[0], at);
  for (let i = 1; i < path.length; i++) {
    const h = path[i];
    if (!isSea(h)) { aboard = false; continue; }
    if (!aboard && sameHex(h, at)) aboard = true;
    if (aboard) at = { q: h.q, r: h.r };
  }
  return at.q === ship.q && at.r === ship.r ? ship : { ...ship, q: at.q, r: at.r };
}

/** Steps between two axial hexes. */
export const hexDist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;

/**
 * Fast travel between ports is sailing (built in 3c): a hop from `fromRec` (a port) to `toRec` (a
 * port of the same group) needs the ship at the departure port's quay (on a sea hex next to it), a hull allowed to
 * land on the destination's island, and somewhere at the destination for the ship to dock (`dock`, a sea hex next
 * to it). No reach limit: ports are linked by known sea lanes.
 */
export function canHop(fromRec, toRec, ship, dock, geo = plainGeo) {
  return ship != null && hexDist(fromRec, ship) <= 1 && tierOf(ship) >= geo.islandTier(toRec) && dock !== undefined;
}

/**
 * Where the ship is after a move whose path (records, start to destination) may contain fast-travel hops: a record
 * with `hop: true` was reached by one. The ship sails a hop with you when it waits at the port you hop from, and docks
 * at `dockOf(rec)` at the other end; between hops it follows shipAfterPath.
 */
export function shipAfterHops(path, ship, dockOf) {
  if (ship == null || path.length === 0) return ship;
  let s = ship;
  let seg = [path[0]];
  for (let i = 1; i < path.length; i++) {
    if (path[i].hop !== true) { seg.push(path[i]); continue; }
    s = shipAfterPath(seg, s);
    const dock = hexDist(path[i - 1], s) <= 1 ? dockOf(path[i]) : undefined;
    if (dock !== undefined) s = { ...s, q: dock.q, r: dock.r };
    seg = [path[i]];
  }
  return shipAfterPath(seg, s);
}

/**
 * Where a dinghy built on the Voyage page goes in: a sea hex next to the coast hex you stand on (the first in
 * neighbour order, open water before shoal). Undefined when you are not on a coast.
 */
export function launchSpot(playerRec, neighbours) {
  if (playerRec === undefined || isSea(playerRec)) return undefined;
  const sea = neighbours.filter((n) => isSea(n) && n.cloud !== true);
  return sea.find((n) => n.t === 'water') ?? sea[0];
}

/**
 * The one-time free dinghy for a character phase 2 left out of reach of the rules (existing
 * characters). On the sea: under them. On land away from the start's landmass: on the nearest sea hex next to their
 * own landmass ("the boat you hired to get here is yours now"). Anyone else builds one. Returns the hex or undefined.
 * `terrain` is { all(), neighbours(q, r), landmass(q, r) }; `start` the map's starting hex.
 */
export function freeBoatSpot(playerRec, start, terrain, distance) {
  if (playerRec === undefined) return undefined;
  if (isSea(playerRec)) return { q: playerRec.q, r: playerRec.r };
  const mine = terrain.landmass(playerRec.q, playerRec.r);
  if (mine === undefined || start === undefined || mine === terrain.landmass(start.q, start.r)) return undefined;
  let best;
  for (const rec of terrain.all()) {
    if (!isSea(rec) || rec.cloud === true || shoreOf(rec) !== 1) continue;
    if (!terrain.neighbours(rec.q, rec.r).some((n) => !isSea(n) && terrain.landmass(n.q, n.r) === mine)) continue;
    const d = distance(playerRec, rec);
    if (best === undefined || d < best.d) best = { d, q: rec.q, r: rec.r };
  }
  return best === undefined ? undefined : { q: best.q, r: best.r };
}

/**
 * The `geo` for canStep from the terrain table: ISLANDS resolved by their anchor POIs (`islandOf(rec)`, the island
 * entry a land hex is on; `islandTier(rec)`, its hull tier, 1 when unlisted) and `home(rec, tier)`, a breadth-first
 * distance from the coasts that tier may land on, computed once per tier on first use. Cloud hexes are left out: the
 * game may not let you survey them, so no way home runs through one. They get a distance of their own afterwards,
 * counted through the cloud from the sea around it, so a hull put under cloud has a way out (3b check, 16 Oct 2026:
 * before, every cloud hex was Infinity and the homeward rule let a hull wander the cloud freely).
 * `waterBody(rec)` numbers the stretches of open sea (cloud left out) that connect hex to hex, so a lake can be told
 * from the sea a ship is on. `terrain` is { all(), get(q, r), poi(name), landmass(q, r), neighbours(q, r) }.
 */
export function seaIndex(terrain) {
  const byLandmass = new Map();
  for (const island of ISLANDS) {
    const rec = terrain.poi(island.anchor);
    const lm = rec === undefined ? undefined : terrain.landmass(rec.q, rec.r);
    if (lm !== undefined) byLandmass.set(lm, island);
  }
  const islandOf = (rec) => (rec === undefined || isSea(rec) ? undefined : byLandmass.get(terrain.landmass(rec.q, rec.r)));
  const islandTier = (rec) => islandOf(rec)?.tier ?? 1;

  const homes = new Map();
  const homeMap = (tier) => {
    let dist = homes.get(tier);
    if (dist !== undefined) return dist;
    dist = new Map();
    let frontier = [];
    for (const rec of terrain.all()) {
      if (isSea(rec) || rec.cloud === true || (tier > 0 && islandTier(rec) > tier)) continue;
      frontier.push(rec);
    }
    let d = 0;
    while (frontier.length > 0) {
      d += 1;
      const next = [];
      for (const rec of frontier) {
        for (const n of terrain.neighbours(rec.q, rec.r)) {
          if (!isSea(n) || n.cloud === true || dist.has(n)) continue;
          dist.set(n, d);
          next.push(n);
        }
      }
      frontier = next;
    }
    // Under cloud: relax from the open sea (and any coast) inward until nothing shortens. The ways out run around
    // places at sea (Melantis, Swirling Abyss, the Deep Sea Ship...), which no move out of the cloud may end on; a place
    // under cloud gets one more than its best neighbour, so a hull standing on one can always step off.
    const clouds = [...terrain.all()].filter((rec) => isSea(rec) && rec.cloud === true);
    const best = (rec) => {
      let b = Infinity;
      for (const n of terrain.neighbours(rec.q, rec.r)) {
        if (isSea(n) && isPlace(n)) continue;
        const d = isSea(n) ? dist.get(n) : (tier > 0 && islandTier(n) > tier ? undefined : 0);
        if (d !== undefined && d + 1 < b) b = d + 1;
      }
      return b;
    };
    let changed = true;
    while (changed) {
      changed = false;
      for (const rec of clouds) {
        if (isPlace(rec)) continue;
        const b = best(rec);
        if (b < (dist.get(rec) ?? Infinity)) { dist.set(rec, b); changed = true; }
      }
    }
    for (const rec of clouds) if (isPlace(rec) && Number.isFinite(best(rec))) dist.set(rec, best(rec));
    homes.set(tier, dist);
    return dist;
  };
  const home = (rec, tier) => {
    if (rec === undefined || !isSea(rec)) return 0;
    const table = terrain.get(rec.q, rec.r) ?? rec; // the same object the distance map holds
    return homeMap(tier).get(table) ?? Infinity;
  };

  const bodies = new Map();
  let body = 0;
  for (const rec of terrain.all()) {
    if (!isSea(rec) || rec.cloud === true || bodies.has(rec)) continue;
    bodies.set(rec, body);
    const queue = [rec];
    while (queue.length > 0) {
      const cur = queue.pop();
      for (const n of terrain.neighbours(cur.q, cur.r)) {
        if (!isSea(n) || n.cloud === true || bodies.has(n)) continue;
        bodies.set(n, body);
        queue.push(n);
      }
    }
    body += 1;
  }
  /** The stretch of open sea a hex is in, or undefined for land and cloud. */
  const waterBody = (rec) => (rec === undefined ? undefined : bodies.get(terrain.get(rec.q, rec.r) ?? rec));
  return { islandOf, islandTier, home, waterBody };
}

/**
 * The hold (build .72; the user: early bank space is hard to manage and loot can only be sold at a market). Ordinary
 * bank items, bank-style: a slot holds one kind of item in any amount. The dinghy has 6 slots and every 10 Voyage
 * levels add one; bigger hulls add more later, and cargo runs use the same slots.
 */
export const HOLD_SLOTS = { dinghy: 6 };
export function holdSlots(ship, voyageLevel = 1) {
  if (ship == null) return 0;
  return (HOLD_SLOTS[ship.hull] ?? 0) + Math.floor(Math.min(99, Math.max(1, voyageLevel)) / 10);
}
/** The hold is reached at the ship: standing on it or on a hex next to it. */
export const atShip = (playerRec, ship) => ship != null && playerRec !== undefined && hexDist(playerRec, ship) <= 1;
/**
 * Puts `qty` of item `id` in the hold. Returns the new hold, or undefined when it needs a new slot and none is free.
 * Pure: the hold given is not changed.
 */
export function stow(hold, id, qty, slots) {
  const n = Math.max(0, Math.floor(qty));
  if (n <= 0) return hold;
  const i = hold.findIndex((e) => e.id === id);
  if (i >= 0) return hold.map((e, j) => (j === i ? { id, qty: e.qty + n } : e));
  if (hold.length >= slots) return undefined;
  return [...hold, { id, qty: n }];
}
/** Takes up to `qty` of item `id` out: { hold, taken }. An emptied slot is freed. */
export function takeOut(hold, id, qty) {
  const i = hold.findIndex((e) => e.id === id);
  if (i < 0) return { hold, taken: 0 };
  const taken = Math.min(hold[i].qty, Math.max(0, Math.floor(qty)));
  const left = hold[i].qty - taken;
  const next = left > 0 ? hold.map((e, j) => (j === i ? { id, qty: left } : e)) : hold.filter((_, j) => j !== i);
  return { hold: next, taken };
}
