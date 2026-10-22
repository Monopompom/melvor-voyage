// The ship's pure rules (phase 3b): hulls, which step a path may take, where the ship ends up after a
// move, where a new dinghy is launched and who gets a free one. Hexes are terrain records ({ q, r, t, shore }, see
// data/hex_terrain.json); `shore` is the precomputed number of steps from a sea hex to the nearest land.
// No game objects here; covered by tests/ship-model.test.mjs.

/**
 * Hull tiers. The dinghy (phase 3b) and the longboat (phase 4, build .142) are the small boat; the brig (build .150) and
 * the galleon that replaces it (build .152) are the big ship, a second vessel.
 * Reach and the island tiers below follow the game's default dungeon order (decided 15 Oct 2026).
 */
export const HULLS = {
  dinghy: {
    id: 'dinghy', tier: 1, name: 'Dinghy', media: 'assets/hull_dinghy.webp',
    /** Farthest a hull sails from land, in hexes. */
    reach: 2,
    blurb: 'A small rowing boat. It stays within 2 hexes of land and you can board or leave it on any coast.',
  },
  longboat: {
    id: 'longboat', tier: 2, name: 'Longboat', media: 'assets/hull_longboat.webp', reach: 4,
    blurb: 'A bigger rowing boat with a short mast. It stays within 4 hexes of land and you can board or leave it on any coast, the Cursed Isle included.',
  },
  brig: {
    id: 'brig', tier: 3, name: 'Brig', media: 'assets/hull_brig.webp', reach: 5,
    blurb: 'A two-masted sailing ship. She sails up to 5 hexes from land, under cloud too, and ties up only at ports. Your small boat rides aboard and rows you ashore anywhere else.',
  },
  galleon: {
    id: 'galleon', tier: 4, name: 'Galleon', media: 'assets/hull_galleon.webp', reach: Infinity,
    blurb: 'A three-masted ship of the line. She sails any sea, however far from land and under cloud too, and ties up only at ports. Your small boat rides aboard and rows you ashore anywhere else.',
  },
};
/** The big ships: a second vessel beside the small boat. */
export const BIG_TIER = 3;
export const isBig = (v) => tierOf(v) >= BIG_TIER;

/**
 * Big ships bought at a port. The GP was a placeholder (150,000) until build .397 (the user, 22 Oct 2026): priced in
 * days of the game's fares, as the longboat's and the galleon's, so the GP gates as the items do.
 */
export const BIG_SHIPS = {
  brig: {
    level: 45, gp: 10000000,
    items: [{ id: 'melvorD:Teak_Logs', quantity: 400 }, { id: 'melvorD:Steel_Bar', quantity: 100 }, { id: 'voyage:Pitch', quantity: 75 },
      // Big Bones for the ribs, as the longboat's (build .177, the user): 250 for the first big ship.
      { id: 'melvorD:Big_Bones', quantity: 250 }],
    milestone: 'Brig: Bought at a port',
  },
};
/**
 * Why the brig can't be bought now, as a reason id, or undefined: 'owned' (a big ship already), 'level', 'port' (not
 * on or next to a port), 'quay' (the port has no quay for it), 'cost'. `have` = { ship, level, atPort, quay, owned }.
 */
export function buyBlocker(spec, have) {
  if (have.ship != null) return 'owned';
  if (have.level < spec.level) return 'level';
  if (!have.atPort) return 'port';
  if (have.quay === undefined) return 'quay';
  if (!have.owned) return 'cost';
  return undefined;
}

/**
 * Upgrades of the hull you have: built on the Voyage page at a port with the
 * old hull at the quay, for a Voyage level, GP and items. The GP is priced in days of the game's fares since build .397 (the longboat was 25,000) (4.26).
 */
export const UPGRADES = {
  longboat: {
    from: 'dinghy', level: 30, gp: 2000000,
    items: [{ id: 'melvorD:Oak_Logs', quantity: 300 }, { id: 'melvorD:Iron_Bar', quantity: 50 }, { id: 'voyage:Pitch', quantity: 25 },
      // Big Bones for the ribs of the bigger boat (build .158, the user): about fifty giants' worth of combat.
      { id: 'melvorD:Big_Bones', quantity: 50 }],
    /** data/skill.json's English name for its milestone (setup.mjs finds the milestone by it). */
    milestone: 'Longboat: Built at a port',
  },
  /** The big ship's upgrade (build .152); the GP in days of fares since build .397 (was 600,000). */
  galleon: {
    from: 'brig', level: 60, gp: 50000000,
    items: [{ id: 'melvorD:Yew_Logs', quantity: 500 }, { id: 'melvorD:Mithril_Bar', quantity: 150 }, { id: 'voyage:Pitch', quantity: 150 },
      // Big Bones (build .177, the user): 550 for the biggest.
      { id: 'melvorD:Big_Bones', quantity: 550 }],
    milestone: 'Galleon: Built at a port',
  },
};
/** The upgrade open to a ship's hull, as [id, upgrade], or undefined. */
export const upgradeFor = (ship) => Object.entries(UPGRADES).find(([, u]) => u.from === ship?.hull);
/**
 * Why the upgrade can't be built now, as a reason id, or undefined: 'level', 'port' (not at a port), 'quay' (the hull
 * is not on your hex or next to it), 'cost'. `have` = { level, atPort, playerRec, owned }.
 */
export function upgradeBlocker(ship, upgrade, have) {
  if (have.level < upgrade.level) return 'level';
  if (!have.atPort) return 'port';
  if (ship == null || have.playerRec === undefined || hexDist(have.playerRec, ship) > 1) return 'quay';
  if (!have.owned) return 'cost';
  return undefined;
}

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

// The Old Hat (Fishing's junk) is the new captain's first hat (the user, 18 Oct 2026: "one funny detail").
export const DINGHY_BUILD = { gp: 500, items: [{ id: 'melvorD:Normal_Logs', quantity: 50 }, { id: 'melvorD:Old_Hat', quantity: 1 }] };
export const OLD_HAT = 'melvorD:Old_Hat';
/**
 * The dinghy's price for this character: without the Old Hat while Fishing can't be had (Adventure before Fishing is
 * unlocked; the user, 18 Oct 2026: "skip for Adv").
 */
export const dinghyBuild = (canFish = true) => (canFish ? DINGHY_BUILD : { ...DINGHY_BUILD, items: DINGHY_BUILD.items.filter((x) => x.id !== OLD_HAT) });

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
// ---- careening (the user, 21 Oct 2026: stakes for the flat mechanics) -------------------------------------------
// A repair takes time: the vessel is hauled out for CAREEN_STEP_MS every 10% it mends, out of use meanwhile (you walk
// on, Folks work on), online and offline. The logs and Pitch go when it begins. Stopped early, the steps done stand.
export const CAREEN_STEP_MS = 6 * 60 * 1000;
/** A careen begun at `now`, from `from`% to `to`%: { at, until, from, to }. */
export const careenOf = (from, to, now) => ({ at: now, until: now + Math.ceil(Math.max(0, to - from) / REPAIR.step) * CAREEN_STEP_MS, from, to });
/** Ms left of a vessel's careen at `now`; 0 with none (or one that is over). */
export const careenLeft = (v, now) => (v?.careen == null ? 0 : Math.max(0, v.careen.until - now));
/** The condition a careen has reached by `now`: its whole steps done, all of them once it is over. */
export const careenDone = (c, now) => Math.min(c.to, c.from + Math.floor(Math.max(0, now - c.at) / CAREEN_STEP_MS) * REPAIR.step);
/** A saved careen, or undefined when it is missing or malformed. */
export function cleanCareen(c) {
  if (c === null || typeof c !== 'object') return undefined;
  const { at, until, from, to } = c;
  if (![at, until, from, to].every(Number.isFinite) || until < at || from < 0 || to > 100 || to <= from) return undefined;
  return { at: Math.round(at), until: Math.round(until), from: Math.round(from), to: Math.round(to) };
}
/** Below this condition (stores-model WORN, the same 50%) a hull sails WORN_TIME as long a hex. */
export const WORN_COND = 50;
export const WORN_TIME = 1.25;
export const wornTime = (v) => (v != null && condOf(v) < WORN_COND ? WORN_TIME : 1);

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
 * log needs (Normal 10.25%, Willow 16.25%, Magic 28.75%, Redwood 32.5%). Better logs give more.
 */
export const pitchChance = (logLevel) => 10 + 0.25 * Math.max(1, Math.floor(logLevel ?? 1));

export const SEA_CLASSES = ['water', 'shoal'];
export const isSea = (rec) => rec !== undefined && SEA_CLASSES.includes(rec.t);
export const sameHex = (a, b) => a !== undefined && a !== null && b !== undefined && b !== null && a.q === b.q && a.r === b.r;

const shoreOf = (rec) => (Number.isInteger(rec?.shore) ? rec.shore : 1);
/**
 * Hulls whose step rules were written and tested before they were built. Empty since the
 * galleon (build .152): every hull of the ladder is in HULLS.
 */
export const PLANNED_HULLS = {};
const hullOf = (ship) => HULLS[ship?.hull] ?? PLANNED_HULLS[ship?.hull];
export const reachOf = (ship) => hullOf(ship)?.reach ?? 0;
export const tierOf = (ship) => hullOf(ship)?.tier ?? 0;
/**
 * The sailing ships (brig and galleon, tier 3 up) sail under cloud, where the far places are: Into the Mist and the
 * Abyss for the brig, Melantis, Impending Darkness, Stronghold of the Gods and Millennium Gate for the galleon
 * (user decision, 16 Oct 2026). The small boats never do.
 */
export const CLOUD_TIER = 3;
export const sailsCloud = (ship) => tierOf(ship) >= CLOUD_TIER;

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
 *  - a small boat never sails into cloud. One that is under cloud anyway (put there with the rules off) may only step
 *    closer to a coast, by the distance seaIndex counts through the cloud, so it always gets out. The sailing ships
 *    (sailsCloud) take cloud like open sea, by that same distance;
 *  - on the sea with no ship (rules switched off and on again), only steps closer to land.
 * A path enters the sea only at the ship's hex, and a shortest path never visits a hex twice, so the ship is with you
 * for every sea step of it.
 */
export function canStep(from, to, ship, geo = plainGeo) {
  if (!isSea(to)) return !isSea(from) || ship == null || tierOf(ship) >= geo.islandTier(to);
  if (!isSea(from)) return ship != null && sameHex(to, ship);
  const cloudOk = sailsCloud(ship);
  if (to.cloud === true && from.cloud !== true && !cloudOk) return false;
  const t = ship == null ? 0 : tierOf(ship);
  const h = geo.home(to, t);
  if (ship == null) return h < geo.home(from, t);
  const out = (to.cloud === true && !cloudOk) || h > reachOf(ship);
  if (out && isPlace(to)) return false;
  if (from.cloud === true && !cloudOk) return h < geo.home(from, t);
  return !out || h <= geo.home(from, t);
}

/** A hex that holds somewhere to go: a map POI, a hand-placed area or a dungeon. */
export const isPlace = (rec) => rec?.poi !== undefined || rec?.area !== undefined || rec?.dungeon !== undefined;

/** True when the hull on `rec` is beyond its reach: the homeward rule applies there. Under cloud a small boat always is. */
export function beyondReach(rec, ship, geo = plainGeo) {
  return isSea(rec) && ship != null && ((rec.cloud === true && !sailsCloud(ship)) || geo.home(rec, tierOf(ship)) > reachOf(ship));
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
 * Where the ship docks at a port reached by a fast-travel hop. A port drawn on the water (Beginning, Misty, Vibrant,
 * Whispering Port) is its own quay: the ship ties up on the port hex. A port on land docks on a sea hex next to it
 * (launchSpot). Undefined under cloud or with no sea next to it. (3c check, 16 Oct 2026: water ports had no dock.)
 */
export function dockSpot(portRec, neighbours) {
  if (portRec === undefined) return undefined;
  if (isSea(portRec)) return portRec.cloud === true ? undefined : { q: portRec.q, r: portRec.r };
  return launchSpot(portRec, neighbours);
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
  /** False for a vessel standing on ground: the winter ice froze it in (phase 5c-1). It sails, hops and launches nothing. */
  const afloat = (v) => v == null || isSea(terrain.get(v.q, v.r));
  return { islandOf, islandTier, home, waterBody, afloat };
}

/**
 * The hold (build .72; the user: early bank space is hard to manage and loot can only be sold at a market). Ordinary
 * bank items, bank-style: a slot holds one kind of item in any amount. The dinghy has 6 slots; slots grow a whole row
 * of HOLD_ROW at a time (build .134, the user: the Voyage page draws them as crates, six to a row): one row at each of
 * HOLD_ROW_LEVELS (skill milestones). Bigger hulls add rows later, and cargo runs use the same slots.
 */
export const HOLD_SLOTS = { dinghy: 6, longboat: 12, brig: 18, galleon: 24 };
export const HOLD_ROW = 6;
export const HOLD_ROW_LEVELS = [35, 55]; // the balance pass; was 40, 80
export function holdSlots(ship, voyageLevel = 1) {
  if (ship == null) return 0;
  return (HOLD_SLOTS[ship.hull] ?? 0) + HOLD_ROW * HOLD_ROW_LEVELS.filter((l) => voyageLevel >= l).length;
}
/**
 * The shipwright's bill (build .178, the journal's hull chapter): every hull in the order you meet it,
 * with its price as the code has it (DINGHY_BUILD, UPGRADES, BIG_SHIPS), so a price change shows in the book unasked.
 * `level` 0 = no level needed; `from` = the hull it is built out of; `bought` = bought outright, not built.
 */
export const BILL_ORDER = ['dinghy', 'longboat', 'brig', 'galleon'];
export function shipBill(canFish = true) {
  return BILL_ORDER.map((id) => {
    const spec = id === 'dinghy' ? dinghyBuild(canFish) : UPGRADES[id] ?? BIG_SHIPS[id];
    return { id, level: spec.level ?? 0, gp: spec.gp, items: spec.items, from: spec.from, bought: BIG_SHIPS[id] !== undefined, reach: HULLS[id].reach, hold: HOLD_SLOTS[id] };
  });
}
/** The hold is reached at the ship: standing on it or on a hex next to it. */
export const atShip = (playerRec, ship) => ship != null && playerRec !== undefined && hexDist(playerRec, ship) <= 1;
/**
 * Puts `qty` of item `id` in the hold. Returns the new hold, or undefined when it needs a new slot and none is free.
 * Pure: the hold given is not changed.
 */
/**
 * `k` entries of a hold thrown overboard at random (the pirates, build .387): `roll()` in [0, 1) picks each. Returns
 * { hold, dropped } with the hold's order kept; never more than the hold holds.
 */
export function jettison(hold, k, roll = Math.random) {
  const left = [...hold];
  const dropped = [];
  for (let i = 0; i < k && left.length > 0; i++) {
    const r = roll();
    const at = Math.min(left.length - 1, Math.max(0, Math.floor((Number.isFinite(r) ? r : 0) * left.length)));
    dropped.push(...left.splice(at, 1));
  }
  return { hold: left, dropped };
}
export function stow(hold, id, qty, slots) {
  const n = Math.max(0, Math.floor(qty));
  if (n <= 0) return hold;
  // Packed cargo never takes loose items in.
  const i = hold.findIndex((e) => e.id === id && e.cargo === undefined);
  if (i >= 0) return hold.map((e, j) => (j === i ? { id, qty: e.qty + n } : e));
  if (hold.length >= slots) return undefined;
  return [...hold, { id, qty: n }];
}
/** Takes up to `qty` of item `id` out: { hold, taken }. An emptied slot is freed. */
export function takeOut(hold, id, qty) {
  const i = hold.findIndex((e) => e.id === id && e.cargo === undefined); // packed cargo stays sealed
  if (i < 0) return { hold, taken: 0 };
  const taken = Math.min(hold[i].qty, Math.max(0, Math.floor(qty)));
  const left = hold[i].qty - taken;
  const next = left > 0 ? hold.map((e, j) => (j === i ? { id, qty: left } : e)) : hold.filter((_, j) => j !== i);
  return { hold: next, taken };
}

// ---- two vessels: the route search ---------------------------------------------

/** A port hex (the terrain table's `port` feature), outside the cloud. */
export const isPort = (rec) => rec !== undefined && rec.cloud !== true && Array.isArray(rec.f) && rec.f.includes('port');
/**
 * The smallest hull tier (1-4) that sails from the port `from` to the port `to` (terrain records) within its reach,
 * or undefined when none does (phase 4 wrap-up): a breadth-first search over
 * the sea hexes that tier keeps to (within reach of a coast it may land on; under cloud only the sailing ships), from
 * the port or the sea next to it to the port or the sea next to it. A port on an island needs that island's tier.
 * The homeward rule is left out: it only brings a hull back, it never takes one farther out.
 */
export function laneTier(from, to, terrain, geo) {
  if (from === undefined || to === undefined) return undefined;
  const hulls = Object.values(HULLS).sort((a, b) => a.tier - b.tier);
  for (const hull of hulls) {
    const tier = hull.tier;
    if (!isSea(to) && geo.islandTier(to) > tier) continue;
    const open = (rec) => isSea(rec) && (rec.cloud !== true || tier >= CLOUD_TIER) && geo.home(rec, tier) <= hull.reach;
    const ends = (rec) => rec === to || (isSea(rec) && terrain.neighbours(rec.q, rec.r).includes(to));
    const start = isSea(from) ? [from] : terrain.neighbours(from.q, from.r).filter(open);
    if (isSea(from) && !open(from)) continue;
    const seen = new Set(start);
    const queue = [...start];
    let found = false;
    for (let i = 0; i < queue.length && !found; i++) {
      const cur = queue[i];
      if (ends(cur)) { found = true; break; }
      for (const n of terrain.neighbours(cur.q, cur.r)) {
        if (seen.has(n)) continue;
        if (n === to) { found = true; break; }
        if (!open(n)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    if (found) return tier;
  }
  return undefined;
}
/**
 * May a big ship's deck and the land meet across this step (either way)? Only at a port: the quay is the port hex
 * itself for a port drawn on the water (then any land next to it is the shore), or a sea hex next to a port on land.
 */
export const canDock = (seaRec, landRec) => isSea(seaRec) && !isSea(landRec) && (isPort(landRec) || isPort(seaRec));
/** A big ship is at anchor within this many hexes of land: from there the small boat can be launched. */
export const ANCHOR_SHORE = 2;
/** Boat sea steps cost this share more, so the big ship sails as close as it can and the boat rows the rest. */
export const BOAT_EPSILON = 1e-3;

/**
 * The cheapest route with two vessels, over states (hex, the vessel you are in), A* like the game's computePath.
 * `o` = {
 *   start, goal: nodes (game hexes, or terrain records in the tests);
 *   key(node): a string per hex; rec(node): its terrain record;
 *   neighbours(node): [[node, cost, hop]] (hop: a fast-travel jump between ports);
 *   heuristic(node): a lower bound to the goal (0 is fine);
 *   boat, ship: the vessel records ({ hull, q, r, aboard }) or null; geo: seaIndex();
 *   dockOf(node): where a vessel ties up at the port `node` after a hop, { q, r } or undefined.
 * }
 * Each vessel is 'h' (where it was), 'w' (with you: you are in it), 'a' (the boat, aboard the ship you are on) or 'l'
 * (left behind on this route: not boarded again, a cheapest route never needs it). Returns { path: nodes start to
 * goal, modes: per node { m: 'land' | 'boat' | 'ship', hop?: 'boat' | 'ship' } } or undefined.
 */
export function routeSearch(o) {
  const { boat, ship, geo } = o;
  const B0 = boat ?? null;
  const S0 = ship ?? null;
  const at = (v, rec) => ({ hull: v.hull, q: rec.q, r: rec.r });
  const nbCache = new Map();
  const nbs = (node) => {
    const k = o.key(node);
    let list = nbCache.get(k);
    if (list === undefined) { list = o.neighbours(node); nbCache.set(k, list); }
    return list;
  };
  const startRec = o.rec(o.start);
  let mode = 'land';
  let b = 'h';
  let sv = 'h';
  if (isSea(startRec)) {
    if (S0 !== null && sameHex(startRec, S0)) { mode = 'ship'; sv = 'w'; if (B0 !== null && B0.aboard === true) b = 'a'; }
    else if (B0 !== null && sameHex(startRec, B0)) { mode = 'boat'; b = 'w'; }
    else if (B0 !== null && B0.aboard !== true) { mode = 'boat'; b = 'w'; } // on the sea away from both: as in the boat
    else if (S0 !== null) { mode = 'ship'; sv = 'w'; if (B0 !== null && B0.aboard === true) b = 'a'; }
    else mode = 'none';
  }
  const stateKey = (st) => `${o.key(st.node)}|${st.mode}|${st.b}|${st.s}|${st.mode === 'boat' && st.s === 'l' ? `${st.sAt.q},${st.sAt.r}` : ''}`;
  const boatAboard = (st) => st.b === 'a' || (st.b === 'h' && B0 !== null && B0.aboard === true);
  const shipPos = (st) => (st.s === 'h' ? S0 ?? undefined : st.s === 'l' ? st.sAt : undefined);

  const first = { node: o.start, mode, b, s: sv, sAt: undefined, g: 0, prev: undefined, hop: undefined };
  const open = [];
  const push = (st) => {
    const f = st.g + o.heuristic(st.node);
    st.f = f;
    let i = open.length;
    open.push(st);
    while (i > 0) { const p = (i - 1) >> 1; if (open[p].f <= f) break; open[i] = open[p]; i = p; }
    open[i] = st;
  };
  const pop = () => {
    const top = open[0];
    const last = open.pop();
    if (open.length > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= open.length) break;
        const c = l + 1 < open.length && open[l + 1].f < open[l].f ? l + 1 : l;
        if (open[c].f >= last.f) break;
        open[i] = open[c];
        i = c;
      }
      open[i] = last;
    }
    return top;
  };
  const best = new Map();
  const goalKey = o.key(o.goal);
  best.set(stateKey(first), 0);
  push(first);
  const offer = (from, node, cost, patch) => {
    const st = { ...from, ...patch, node, g: from.g + cost, prev: from };
    const k = stateKey(st);
    const old = best.get(k);
    if (old !== undefined && old <= st.g) return;
    best.set(k, st.g);
    push(st);
  };
  const done = new Set();
  while (open.length > 0) {
    const cur = pop();
    const ck = stateKey(cur);
    if (done.has(ck) || best.get(ck) < cur.g) continue;
    done.add(ck);
    if (o.key(cur.node) === goalKey) {
      const states = [];
      for (let st = cur; st !== undefined; st = st.prev) states.push(st);
      states.reverse();
      return { path: states.map((st) => st.node), modes: states.map((st) => (st.hop === undefined ? { m: st.mode } : { m: st.mode, hop: st.hop })) };
    }
    const p = o.rec(cur.node);
    for (const [node, cost, hop] of nbs(cur.node)) {
      const n = o.rec(node);
      if (n === undefined) continue;
      if (hop) { hopFrom(cur, p, node, n, cost); continue; }
      if (cur.mode === 'none') {
        // On the sea with no vessel (the rules switched off and on): only towards land, as canStep without a ship.
        if (canStep(p, n, null, geo)) offer(cur, node, cost, { mode: isSea(n) ? 'none' : 'land', hop: undefined });
        continue;
      }
      if (cur.mode === 'land') {
        if (!isSea(n)) { offer(cur, node, cost, { hop: undefined }); continue; }
        if (cur.b === 'h' && B0 !== null && B0.aboard !== true && sameHex(n, B0)) offer(cur, node, cost * (1 + BOAT_EPSILON), { mode: 'boat', b: 'w', hop: undefined });
        if (cur.s === 'h' && S0 !== null && sameHex(n, S0) && canDock(n, p)) offer(cur, node, cost, { mode: 'ship', s: 'w', b: boatAboard(cur) ? 'a' : cur.b, hop: undefined });
        continue;
      }
      if (cur.mode === 'boat') {
        if (!isSea(n)) {
          const sp = shipPos(cur);
          const tier = Math.max(tierOf(B0), sp !== undefined && hexDist(sp, n) <= ANCHOR_SHORE ? tierOf(S0) : 0);
          if (tier >= geo.islandTier(n)) offer(cur, node, cost, { mode: 'land', b: 'l', hop: undefined });
          continue;
        }
        const sp = shipPos(cur);
        if (sp !== undefined && sameHex(n, sp)) {
          if (cur.s === 'h') offer(cur, node, cost, { mode: 'ship', s: 'w', b: 'a', hop: undefined });
          continue; // a ship left on this route is not boarded again
        }
        if (canStep(p, n, at(B0, p), geo)) offer(cur, node, cost * (1 + BOAT_EPSILON), { hop: undefined });
        continue;
      }
      // in the ship
      if (!isSea(n)) {
        if (canDock(p, n) && tierOf(S0) >= geo.islandTier(n)) offer(cur, node, cost, { mode: 'land', s: 'l', b: cur.b === 'a' ? 'l' : cur.b, sAt: { q: p.q, r: p.r }, hop: undefined });
        continue;
      }
      if (canStep(p, n, at(S0, p), geo)) {
        // sailing over the beached boat takes it aboard
        const pick = cur.b === 'h' && B0 !== null && B0.aboard !== true && sameHex(n, B0);
        offer(cur, node, cost, { b: pick ? 'a' : cur.b, hop: undefined });
      }
      if (boatAboard(cur) && p.cloud !== true && Number.isInteger(p.shore) && p.shore <= ANCHOR_SHORE && canStep(p, n, at(B0, p), geo)) {
        offer(cur, node, cost * (1 + BOAT_EPSILON), { mode: 'boat', b: 'w', s: 'l', sAt: { q: p.q, r: p.r }, hop: undefined });
      }
    }
  }
  return undefined;

  /** A fast-travel hop: the ship sails it when it is at this port's quay (the boat with it if aboard), else the boat. */
  function hopFrom(cur, p, node, n, cost) {
    const dock = o.dockOf(node);
    if (dock === undefined) return;
    const landing = isSea(n) ? undefined : n;
    // A vessel frozen in (phase 5c-1, geo.afloat) waits at its quay for the thaw.
    const shipHere = (cur.mode === 'ship') || (cur.mode === 'land' && cur.s === 'h' && S0 !== null && hexDist(p, S0) <= 1 && geo.afloat?.(S0) !== false);
    if (shipHere && S0 !== null && canHop(p, n, at(S0, p), dock, geo)) {
      const aboard = boatAboard(cur);
      if (landing === undefined) offer(cur, node, cost, { mode: 'ship', s: 'w', b: aboard ? 'a' : cur.b, hop: 'ship' });
      else offer(cur, node, cost, { mode: 'land', s: 'l', b: aboard ? 'l' : cur.b, sAt: dock, hop: 'ship' });
      return;
    }
    const boatHere = (cur.mode === 'boat') || (cur.mode === 'land' && cur.b === 'h' && B0 !== null && B0.aboard !== true && hexDist(p, B0) <= 1 && geo.afloat?.(B0) !== false);
    if (boatHere && B0 !== null && canHop(p, n, at(B0, p), dock, geo)) {
      if (landing === undefined) offer(cur, node, cost, { mode: 'boat', b: 'w', hop: 'boat' });
      else offer(cur, node, cost, { mode: 'land', b: 'l', hop: 'boat' });
    }
  }
}

/**
 * Where both vessels are after a route of routeSearch (records start to destination, `modes` alongside). A vessel
 * moves while you are in it; the boat aboard moves with the ship; a hop docks the vessel that sailed it at
 * `dockOf(rec)`. Returns { boat, ship } (the same objects when they did not move).
 */
export function vesselsAfterRoute(recs, modes, boat, ship, dockOf) {
  let b = boat == null ? null : { ...boat };
  let s = ship == null ? null : { ...ship };
  for (let i = 1; i < recs.length; i++) {
    const rec = recs[i];
    const m = modes[i] ?? { m: 'land' };
    const prev = modes[i - 1]?.m;
    if (m.hop !== undefined) {
      const dock = dockOf(rec);
      if (dock === undefined) continue;
      if (m.hop === 'ship' && s !== null) { s = { ...s, q: dock.q, r: dock.r }; if (b?.aboard) b = { ...b, q: dock.q, r: dock.r }; }
      if (m.hop === 'boat' && b !== null) b = { ...b, q: dock.q, r: dock.r, aboard: false };
      continue;
    }
    if (m.m === 'boat' && b !== null) b = { ...b, q: rec.q, r: rec.r, aboard: false };
    if (m.m === 'ship' && s !== null) {
      s = { ...s, q: rec.q, r: rec.r };
      if (prev === 'boat' && b !== null) b = { ...b, aboard: true };
      if (b !== null && !b.aboard && sameHex(b, s)) b = { ...b, aboard: true }; // sailed over the beached boat
      if (b?.aboard) b = { ...b, q: rec.q, r: rec.r };
    }
  }
  const same = (x, y) => x === y || (x !== null && y != null && x.q === y.q && x.r === y.r && (x.aboard === true) === (y.aboard === true));
  return { boat: same(b, boat ?? null) ? boat ?? null : b, ship: same(s, ship ?? null) ? ship ?? null : s };
}
