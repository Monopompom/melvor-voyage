// Land speed and the Crossroads Sign, the rules (build .162). Pure: no game objects.
//
// Land upgrades are shop purchases bought in order (each needs the one before and a Voyage level). Until phase 5 they
// cut the GP of land hexes; phase 5 swaps the cut for `speed`. The sign is one shop purchase: it stands on one POI with
// standing buffs (`SIGN_POIS`) and carries those buffs to the character wherever they are.

/** The four land upgrades, in order. `id` is the shop purchase's local id (namespace `voyage`). */
export const MOUNTS = [
  { id: 'Sturdy_Boots', level: 5, cut: 0.1, speed: 1.25, media: 'assets/land_boots.webp' },
  { id: 'Pack_Yak', level: 25, cut: 0.2, speed: 1.5, media: 'assets/land_yak.webp' },
  { id: 'Riding_Horse', level: 45, cut: 0.3, speed: 2, media: 'assets/land_horse.webp' },
  { id: 'Unicorn', level: 60, cut: 0.4, speed: 3, media: 'assets/land_unicorn.webp' },
];
/** On foot: tier 0, no cut. */
export const ON_FOOT = { id: '', level: 0, cut: 0, speed: 1, media: 'assets/marker_traveller_figure.webp' };

/**
 * The tier the player travels at: the number of upgrades owned in order, 0 (on foot) to 4. One missing breaks the
 * chain (the shop sells them only in order, so that means a save edited by hand or a purchase refunded).
 */
export function mountTier(owned) {
  let tier = 0;
  for (const m of MOUNTS) { if (!owned(m.id)) break; tier++; }
  return tier;
}

/** The mount at `tier` (0 = on foot). */
export const mountAt = (tier) => (tier <= 0 ? ON_FOOT : MOUNTS[Math.min(tier, MOUNTS.length) - 1]);

/** The next upgrade to buy after `tier`, or undefined at the top. */
export const nextMount = (tier) => MOUNTS[tier];

/** What a hex's GP is multiplied by at `tier`: the cut on land, nothing at sea. */
export const gpFactor = (tier, land) => (land ? 1 - mountAt(tier).cut : 1);

/**
 * One hex's GP on a path, as Cartography.getTravelCosts adds it with the cut: the game's price times its travel cost
 * multiplier (the Voyage level discount and the rest), times the cut on land, rounded down.
 */
export const hexGp = (quantity, mult, tier, land) => Math.floor(quantity * mult * gpFactor(tier, land));

/** A path's GP: `steps` are `{ gp, land }`, the hexes the game charges for (fast-travel hops left out). */
export const pathGp = (steps, mult, tier) => steps.reduce((sum, s) => sum + hexGp(s.gp, mult, tier, s.land), 0);

/** The Crossroads Sign's shop purchase (local id) and its Voyage level. */
export const SIGN = { id: 'Crossroads_Sign', level: 35 };

/**
 * The 14 POIs with standing buffs (AoD data v1.3.1), as local ids of namespace `melvorAoD`. The game
 * object decides in the end (`poi.activeStats.hasStats`); this list is what the tests and the help know.
 */
export const SIGN_POIS = [
  'RagnarDungeonRuins', 'TerranDungeonRuins', 'AerisDungeonRuins', 'SecretGlacialHoard', 'FishermansBounty',
  'BanditHideout', 'AcademiaArcanum', 'DarkWaters', 'Monolith', 'MoltenPeak', 'SpiderForest', 'PerilousPeaks',
  'ShimmeringOasis', 'UnhallowedWasteland',
];

/**
 * What the sign may do now. `owned`: the sign was bought; `placed`: the POI id it stands on ('' while carried);
 * `here`: the POI underfoot, `{ id, buffs, discovered }` or undefined. Gives 'place', 'pickup' or a reason it can't:
 * 'not-owned', 'elsewhere' (it stands on another POI), 'no-poi', 'no-buffs', 'undiscovered'.
 */
export function signAction({ owned, placed, here }) {
  if (!owned) return 'not-owned';
  if (placed !== '') return here !== undefined && here.id === placed ? 'pickup' : 'elsewhere';
  if (here === undefined) return 'no-poi';
  if (!here.buffs) return 'no-buffs';
  if (!here.discovered) return 'undiscovered';
  return 'place';
}

/**
 * Whether the signed POI's buffs are added on top of the game's: only while it stands somewhere and that is not the
 * POI underfoot (the game already adds that one; the sign never doubles it).
 */
export const signAdds = (placed, hereId) => placed !== '' && placed !== hereId;
