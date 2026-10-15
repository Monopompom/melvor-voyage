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
 *  - on the sea with no ship (rules switched off and on again), only steps closer to land.
 * A path enters the sea only at the ship's hex, and a shortest path never visits a hex twice, so the ship is with you
 * for every sea step of it.
 */
export function canStep(from, to, ship, geo = plainGeo) {
  if (!isSea(to)) return !isSea(from) || ship == null || tierOf(ship) >= geo.islandTier(to);
  if (!isSea(from)) return ship != null && sameHex(to, ship);
  if (ship == null) return geo.home(to, 0) < geo.home(from, 0);
  const t = tierOf(ship);
  const h = geo.home(to, t);
  return h <= reachOf(ship) || h <= geo.home(from, t);
}

/** True when the hull on `rec` is beyond its reach: the homeward rule applies there. */
export function beyondReach(rec, ship, geo = plainGeo) {
  return isSea(rec) && ship != null && geo.home(rec, tierOf(ship)) > reachOf(ship);
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
 * game may not let you survey them, so no way home runs through one. `terrain` is { all(), get(q, r), poi(name),
 * landmass(q, r), neighbours(q, r) }.
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
    homes.set(tier, dist);
    return dist;
  };
  const home = (rec, tier) => {
    if (rec === undefined || !isSea(rec)) return 0;
    const table = terrain.get(rec.q, rec.r) ?? rec; // the same object the distance map holds
    return homeMap(tier).get(table) ?? Infinity;
  };
  return { islandOf, islandTier, home };
}
