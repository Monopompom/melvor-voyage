// Encounters (design 4.33): what a beaten band carries. Every item is the game's own (base game, Atlas of Discovery;
// grade 5 rungs are Throne of the Herald's). Two dials: the tier sets how much and how often (haul lines, amounts, a
// chest, a rare find); your grade (progress 1 to 5) sets the rung of each line, so a band carries what people at your
// stage carry. Pure: an item the game lacks (an expansion not owned) falls back to the rung below, by `has(id)`.

/** By tier 1 to 4: how many haul lines, the amount's multiplier, a chest's odds, a rare find's odds. */
export const LOOT_DRAWS = [0, 1, 1, 2, 2];
export const LOOT_QTY = [0, 1, 1.5, 2.5, 4];
export const STASH_ODDS = [0, 0.15, 0.2, 0.25, 0.3];
export const RARE_ODDS = [0, 0.02, 0.03, 0.04, 0.06];
/** A rare card from a won fight (Captain's Cutlass or Gambler's Dice): this often, and this often after Press on. */
export const CARD_DROP = 0.1;
export const CARD_DROP_PRESS = 0.25;
export const DROP_CARDS = ['capcut', 'dice'];

// A haul line: `q` the amount at tier 1, `rungs` by grade 1 to 5, each [item id, amount multiplier].
const GEMS = { q: [1, 4], rungs: [['melvorD:Topaz'], ['melvorD:Sapphire'], ['melvorD:Ruby'], ['melvorD:Diamond'], ['melvorTotH:Onyx']] };
const RAW_FISH = { q: [5, 15], rungs: [['melvorD:Raw_Trout'], ['melvorD:Raw_Lobster'], ['melvorD:Raw_Shark'], ['melvorD:Raw_Manta_Ray'], ['melvorTotH:Raw_Frozen_Manta_Ray']] };
/** Each band: the skill of its Mastery Tokens, its trophy charm, its haul lines and its chest by grade. */
export const LOOT = {
  highwaymen: { skill: 'Thieving', trophy: 'mask', haul: [
    { q: [20, 60], rungs: [['melvorD:Steel_Arrows'], ['melvorD:Mithril_Arrows'], ['melvorD:Rune_Arrows'], ['melvorD:Dragon_Arrows'], ['melvorTotH:Corundum_Arrows']] },
    { q: [2, 6], rungs: [['melvorD:Leather'], ['melvorD:Green_Dragonhide'], ['melvorD:Blue_Dragonhide'], ['melvorD:Black_Dragonhide'], ['melvorF:Elder_Dragonhide']] },
    { q: [1, 2], rungs: [['melvorD:Bird_Nest'], ['melvorD:Bird_Nest', 2], ['melvorD:Bird_Nest', 3], ['melvorD:Bird_Nest', 4], ['melvorTotH:Raven_Nest']] },
    { q: [3, 8], rungs: [['melvorF:Gentle_Hands_Potion_I'], ['melvorF:Gentle_Hands_Potion_II'], ['melvorF:Gentle_Hands_Potion_III'], ['melvorF:Gentle_Hands_Potion_IV'], ['melvorF:Gentle_Hands_Potion_IV', 2]] },
  ], stash: ['melvorD:Bandit_Chest', 'melvorD:Bandit_Chest', 'melvorAoD:Small_Lockbox', 'melvorD:Elite_Chest', 'melvorD:Elite_Chest'] },
  deserters: { skill: 'Smithing', trophy: 'medal', haul: [
    { q: [5, 15], rungs: [['melvorD:Iron_Bar'], ['melvorD:Mithril_Bar'], ['melvorD:Runite_Bar'], ['melvorD:Dragonite_Bar'], ['melvorTotH:Corundumite_Bar']] },
    { q: [1, 1], rungs: [['melvorD:Iron_Platebody'], ['melvorD:Mithril_Platebody'], ['melvorD:Rune_Platebody'], ['melvorD:Dragon_Platebody'], ['melvorTotH:Corundum_Platebody']] },
    { q: [5, 15], rungs: [['melvorD:Trout'], ['melvorD:Lobster'], ['melvorD:Shark'], ['melvorD:Manta_Ray'], ['melvorD:Whale']] },
    { q: [3, 8], rungs: [['melvorF:Melee_Strength_Potion_I'], ['melvorF:Melee_Strength_Potion_II'], ['melvorF:Melee_Strength_Potion_III'], ['melvorF:Melee_Strength_Potion_IV'], ['melvorF:Melee_Strength_Potion_IV', 2]] },
  ], stash: ['melvorF:Crate_Of_Basic_Supplies', 'melvorF:Crate_Of_Basic_Supplies', 'melvorAoD:Old_Carriage', 'melvorD:Elite_Chest', 'melvorD:Elite_Chest'] },
  smugglers: { skill: 'Herblore', trophy: 'ledger', haul: [
    { q: [5, 15], rungs: [['melvorD:Sourweed_Herb'], ['melvorD:Lemontyle_Herb'], ['melvorF:Poraxx_Herb'], ['melvorF:Barrentoe_Herb'], ['melvorTotH:Wurmtayle_Herb']] },
    GEMS,
    { q: [1, 1], rungs: [['melvorF:Potion_Box_I'], ['melvorF:Potion_Box_I', 2], ['melvorF:Potion_Box_II'], ['melvorF:Potion_Box_II', 2], ['melvorTotH:Potion_Box_III', 2]] },
  ], stash: ['melvorAoD:Trader_Crate', 'melvorAoD:Trader_Crate', 'melvorAoD:Golden_Crate', 'melvorF:Chest_Of_Gems', 'melvorF:Chest_Of_Gems'] },
  corsairs: { skill: 'Fishing', trophy: 'spyglass', haul: [
    { q: [20, 60], rungs: [['melvorAoD:Pirate_Doubloons'], ['melvorAoD:Pirate_Doubloons', 2], ['melvorAoD:Pirate_Doubloons', 4], ['melvorAoD:Pirate_Doubloons', 8], ['melvorAoD:Pirate_Doubloons', 15]] },
    GEMS,
    { q: [1, 1], rungs: [['melvorD:Steel_Sword'], ['melvorD:Mithril_Sword'], ['melvorD:Rune_Sword'], ['melvorD:Dragon_Sword'], ['melvorTotH:Augite_Sword']] },
    RAW_FISH,
  ], stash: ['melvorD:Pirate_Booty', 'melvorD:Pirate_Booty', 'melvorD:Pirate_Booty', 'melvorAoD:Old_Pirate_Treasure', 'melvorAoD:Old_Pirate_Treasure'] },
  cultists: { skill: 'Runecrafting', trophy: 'censer', haul: [
    { q: [30, 90], rungs: [['melvorD:Mind_Rune'], ['melvorD:Chaos_Rune'], ['melvorD:Death_Rune'], ['melvorD:Blood_Rune'], ['melvorTotH:Despair_Rune']] },
    { q: [5, 15], rungs: [['melvorD:Bones'], ['melvorD:Big_Bones'], ['melvorD:Dragon_Bones'], ['melvorD:Magic_Bones'], ['melvorTotH:Infernal_Bones']] },
    { q: [3, 8], rungs: [['melvorF:Divine_Potion_I'], ['melvorF:Divine_Potion_II'], ['melvorF:Divine_Potion_III'], ['melvorF:Divine_Potion_IV'], ['melvorF:Divine_Potion_IV', 2]] },
    { q: [3, 10], rungs: [['melvorF:Holy_Dust'], ['melvorF:Holy_Dust', 2], ['melvorF:Holy_Dust', 4], ['melvorF:Holy_Dust', 8], ['melvorF:Holy_Dust', 15]] },
  ], stash: ['melvorAoD:Cursed_Rune_Pouch', 'melvorAoD:Cursed_Rune_Pouch', 'melvorAoD:Ritual_Chest', 'melvorAoD:Treacherous_Chest', 'melvorTotH:Cursed_Chest'] },
  wreckers: { skill: 'Archaeology', trophy: 'lantern', haul: [
    { q: [10, 30], rungs: [['melvorD:Willow_Logs'], ['melvorD:Maple_Logs'], ['melvorD:Yew_Logs'], ['melvorD:Magic_Logs'], ['melvorTotH:Elderwood_Logs']] },
    { q: [10, 30], rungs: [['melvorD:Iron_Ore'], ['melvorD:Mithril_Ore'], ['melvorD:Runite_Ore'], ['melvorD:Dragonite_Ore'], ['melvorTotH:Corundumite_Ore']] },
    RAW_FISH,
    { q: [1, 1], rungs: [['melvorD:Treasure_Chest'], ['melvorD:Treasure_Chest'], ['melvorD:Treasure_Chest', 2], ['melvorD:Treasure_Chest', 3], ['melvorTotH:Lost_Chest']] },
  ], stash: ['melvorAoD:Toppled_Minecart', 'melvorAoD:Old_Pirate_Treasure_Map', 'melvorF:Pile_Of_Ores', 'melvorF:Pile_Of_Logs', 'melvorTotH:Lost_Chest'] },
};
/** The Mastery Token of each band's skill. */
export const TOKENS = {
  Thieving: 'melvorF:Mastery_Token_Thieving', Smithing: 'melvorD:Mastery_Token_Smithing', Herblore: 'melvorF:Mastery_Token_Herblore',
  Fishing: 'melvorD:Mastery_Token_Fishing', Runecrafting: 'melvorF:Mastery_Token_Runecrafting', Archaeology: 'melvorAoD:Mastery_Token_Archaeology',
};
export const BANK_SLOT_TOKEN = 'melvorF:Bank_Slot_Token';
export const SIGNET_HALVES = ['melvorD:Signet_Ring_Half_A', 'melvorD:Signet_Ring_Half_B'];
/** The rare find's weights: the Signet halves and the trophy only at tiers 3 and 4. */
export const RARE = [[50, 'token'], [20, 'bankslot'], [10, 'signet'], [20, 'trophy']];

const all = () => true;
const randIn = (rnd, [a, b]) => a + Math.floor(rnd() * (b - a + 1));
const gradeOf = (grade) => Math.min(5, Math.max(1, Math.floor(grade) || 1));
/** A line's rung at your grade, or the best one below it the game has: [id, multiplier], or undefined. */
export function rungOf(line, grade, has = all) {
  for (let g = gradeOf(grade); g >= 1; g--) { const [id, mul = 1] = line.rungs[g - 1]; if (has(id)) return [id, mul]; }
  return undefined;
}
/** The chest at your grade, or the best one below it the game has. */
export function stashOf(band, grade, has = all) {
  const list = LOOT[band].stash;
  for (let g = gradeOf(grade); g >= 1; g--) if (has(list[g - 1])) return list[g - 1];
  return undefined;
}

/** What a band carries at your grade, for the meet popup. */
export function lootAt(band, tier, grade, has = all) {
  const L = LOOT[band];
  return {
    haul: [...new Set(L.haul.map((l) => rungOf(l, grade, has)?.[0]).filter((x) => x !== undefined))],
    stash: stashOf(band, grade, has), draws: LOOT_DRAWS[tier], stashOdds: STASH_ODDS[tier], rareOdds: RARE_ODDS[tier],
    token: TOKENS[L.skill], trophy: L.trophy, rareHigh: tier >= 3,
  };
}

/**
 * A win's loot: [{ id, qty, kind: 'haul' | 'stash' | 'rare' }] and, for a trophy, { trophy, qty: 1, kind: 'rare' }.
 * opt.press: a broken captain (the haul doubles, a chest for sure, the rare odds ×3). owned: the trophies you have
 * (one of a kind, so a second rolls a Bank Slot Token). opt.rare: a rare find for sure, of that kind ('token',
 * 'bankslot', 'signet' or 'trophy'), at any tier.
 */
export function rollLoot(band, tier, grade, rnd, opt = {}, owned = [], has = all) {
  const L = LOOT[band];
  const out = [];
  const lines = L.haul.slice();
  for (let i = 0; i < LOOT_DRAWS[tier] && lines.length; i++) {
    const l = lines.splice(Math.floor(rnd() * lines.length), 1)[0];
    const r = rungOf(l, grade, has);
    const q = randIn(rnd, l.q);
    if (r !== undefined) out.push({ id: r[0], qty: Math.max(1, Math.round(q * LOOT_QTY[tier] * r[1] * (opt.press ? 2 : 1))), kind: 'haul' });
  }
  if (opt.press || rnd() < STASH_ODDS[tier]) { const id = stashOf(band, grade, has); if (id !== undefined) out.push({ id, qty: 1, kind: 'stash' }); }
  if (opt.rare !== undefined || rnd() < RARE_ODDS[tier] * (opt.press ? 3 : 1)) {
    let k = opt.rare;
    if (k === undefined) {
      const rows = RARE.filter(([, r]) => tier >= 3 || (r !== 'signet' && r !== 'trophy'));
      let x = rnd() * rows.reduce((a, [w]) => a + w, 0);
      k = rows[0][1];
      for (const [w, id] of rows) { if ((x -= w) < 0) { k = id; break; } }
    }
    if (k === 'trophy' && owned.includes(L.trophy)) k = 'bankslot';
    if (k === 'token') out.push({ id: TOKENS[L.skill], qty: randIn(rnd, [1, 3]), kind: 'rare' });
    else if (k === 'signet') out.push({ id: SIGNET_HALVES[rnd() < 0.5 ? 0 : 1], qty: 1, kind: 'rare' });
    else if (k === 'trophy') out.push({ trophy: L.trophy, qty: 1, kind: 'rare' });
    else out.push({ id: BANK_SLOT_TOKEN, qty: 1, kind: 'rare' });
  }
  return out.filter((x) => x.trophy !== undefined || has(x.id));
}

/** A failed Press on keeps half the haul; a chest or a rare find stays yours. */
export const halveHaul = (loot) => loot.map((x) => (x.kind === 'haul' ? { ...x, qty: Math.floor(x.qty / 2) } : x)).filter((x) => x.qty > 0);

/** A rare card from a won fight, or undefined. */
export function rollCard(rnd, press = false) {
  if (!(rnd() < (press ? CARD_DROP_PRESS : CARD_DROP))) return undefined;
  return DROP_CARDS[rnd() < 0.5 ? 0 : 1];
}
