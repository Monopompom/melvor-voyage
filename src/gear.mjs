// Gear, relics, the Albatross, the capes and the pet. Game-facing: registers data/gear.json (the Seafarer's Outfit in
// the Township shop, the Voyage relic set and the Voyage Lesser Relic for the Ancient Relics mode, the Albatross tablet
// and its synergies, the Voyage Skillcape and the pet Barnacle; the Superior cape with Throne of the Herald), names it
// from the language file, reads the effects off the player's modifier table for the stores, the clock, cargo pay, the
// pirates and night sight, and after every landed move rolls the relics, the Lesser Relic, the Albatross's charges and
// marks, and the pet. The numbers and the pure rules are src/gear-model.mjs.

/** Adds the data packages. Called right after data/package.json, before any module reads the items. */
export async function register(ctx, { G, log }) {
  await ctx.gameData.addPackage('data/gear.json');
  let toth = false;
  try { toth = game.registeredNamespaces.hasNamespace('melvorTotH'); } catch { toth = false; }
  if (toth) {
    try { await ctx.gameData.addPackage({ $schema: '', namespace: 'voyage', data: G.tothPackage() }); } catch (e) { log('Throne of the Herald synergies failed', e); }
  }
  // Names from the language file (the English in the data is the fallback).
  try {
    for (const id of [...Object.keys(G.OUTFIT), G.LESSER_RELIC.id, G.FAMILIAR.item]) {
      const it = game.items.getObjectByID(`voyage:${id}`);
      if (it === undefined) continue;
      const key = id === G.FAMILIAR.item ? 'ALBATROSS' : id.toUpperCase();
      it._name = getLangString(`MOD_VOY_ITEM_${key}_NAME`);
      if (Object.keys(G.OUTFIT).includes(id)) it._customDescription = getLangString('MOD_VOY_ITEM_OUTFIT_DESC');
      else if (id === G.LESSER_RELIC.id) it._customDescription = getLangString('MOD_VOY_ITEM_VOYAGE_LESSER_RELIC_DESC');
      it._modifiedDescription = undefined;
    }
    for (const id of G.RELICS) {
      const relic = game.ancientRelics.getObjectByID(`voyage:${id}`);
      if (relic !== undefined) relic._name = getLangString(`MOD_VOY_RELIC_${id}`);
    }
    for (const c of [G.SKILLCAPE, G.SUPERIOR_SKILLCAPE]) {
      const it = game.items.getObjectByID(`voyage:${c.id}`);
      if (it === undefined) continue;
      it._name = getLangString(`MOD_VOY_ITEM_${c.id.toUpperCase()}_NAME`);
      it._modifiedDescription = undefined;
    }
    const pet = game.pets.getObjectByID(G.petId());
    if (pet !== undefined) { pet._name = getLangString('MOD_VOY_PET_NAME'); pet._hint = getLangString('MOD_VOY_PET_HINT'); }
  } catch (e) { log('gear names failed', e); }
  log(`gear registered${toth ? ', Throne of the Herald synergies and the Superior cape too' : ''}`);
}

export function install(ctx, { state, G, log }) {
  const skill = () => state.voyageSkill?.();
  const player = () => game.combat?.player;
  const read = (id) => { try { return player()?.modifiers?.getValue(`voyage:${id}`, ModifierQuery.EMPTY) ?? 0; } catch { return 0; } };
  const effects = () => G.effects(read);
  const SUMMON_SLOTS = ['melvorD:Summon1', 'melvorD:Summon2'];

  // ---- the rolls after a landed move ----------------------------------------------------------------------------
  const rollRelics = (s, n) => {
    if (!game.currentGamemode?.allowAncientRelicDrops || typeof s.rollForAncientRelics !== 'function') return;
    const level = Math.max(1, Math.floor(s.level));
    for (let i = 0; i < n; i++) s.rollForAncientRelics(level, game.defaultRealm);
  };
  /** The skill's rare drops (the Voyage Lesser Relic, its mode only): the engine rolls each drop's mode and chance. */
  const rollRareDrops = (s, n) => {
    if (!Array.isArray(s.rareDrops) || s.rareDrops.length === 0 || typeof Rewards !== 'function') return;
    const rewards = new Rewards(game);
    rewards.setSource(`Skill.${s.id}.Travel`);
    for (let i = 0; i < n; i++) s.rollForRareDrops(s.level, rewards, undefined);
    rewards.giveRewards();
  };
  /** A worn Voyage Lesser Relic spends a charge on every hex, as the game's Lesser Relics do on their skill's actions. */
  const spendLesserRelic = (p, n) => {
    const eq = p?.equipment?.equippedItems?.['melvorD:Consumable'];
    if (eq === undefined || eq.item?.id !== G.lesserRelicItemId()) return;
    for (let i = 0; i < n; i++) { if (!(eq.quantity > 0)) break; p.consumeItemQuantities({}, eq); }
  };
  /** The Albatross spends a charge on every hex, and its synergy partner with it; the engine adds the Summoning XP and rolls the preservation. */
  const spendTablets = (p, n) => {
    const slots = p?.equipment?.equippedItems;
    if (slots === undefined) return;
    const mine = SUMMON_SLOTS.find((id) => slots[id]?.item?.id === G.familiarItemId());
    if (mine === undefined) return;
    const other = SUMMON_SLOTS.find((id) => id !== mine);
    let partner;
    try {
      const o = slots[other];
      if (o?.quantity > 0 && o.item !== undefined && game.summoning.getUnlockedSynergy(slots[mine].item, o.item) !== undefined) partner = other;
    } catch { partner = undefined; }
    for (let i = 0; i < n; i++) {
      if (!(slots[mine]?.quantity > 0)) break;
      p.removeSummonCharge(mine, G.TABLET_MS);
      if (partner !== undefined && slots[partner]?.quantity > 0) p.removeSummonCharge(partner, G.TABLET_MS);
    }
  };
  const rollMarks = (s, n) => {
    if (game.summoning?.isUnlocked !== true) return;
    for (let i = 0; i < n; i++) game.summoning.rollMarksForSkill(s, G.MARK_MS, game.defaultRealm);
  };
  /** The pet rolls on every hex entered as an action of PET_MS: the engine scales the chance by the skill's level. */
  const rollPet = (s, n) => {
    const pet = game.pets?.getObjectByID(G.petId());
    if (pet === undefined || typeof game.petManager?.rollForSkillPet !== 'function') return;
    for (let i = 0; i < n; i++) {
      if (game.petManager.unlocked?.has?.(pet) === true) return;
      game.petManager.rollForSkillPet(pet, G.PET_MS, s);
    }
  };
  /** The journal's pages, written when their matter first applies: the relics in their mode, the Albatross at its Summoning level, the outfit at the shop's first row. */
  const pages = () => {
    const j = state.journal;
    if (j?.learn === undefined) return;
    try { if (game.currentGamemode?.allowAncientRelicDrops === true) j.learn('relics', true); } catch {}
    try { if (game.summoning?.isUnlocked === true && game.summoning.level >= G.FAMILIAR.level) j.learn('albatross', true); } catch {}
    try { if ((game.township?.level ?? 0) >= G.OUTFIT_GATES[0][0]) j.learn('outfit', true); } catch {}
  };
  /** After a move that landed and paid (setup.mjs movePlayer): `steps` in walking order. */
  const afterMove = (steps) => {
    const n = G.chargeSteps(steps);
    const s = skill();
    if (n <= 0 || s === undefined) return;
    const p = player();
    try { rollRelics(s, n); } catch (e) { log('relic roll failed', e); }
    try { rollRareDrops(s, n); } catch (e) { log('rare drop roll failed', e); }
    try { spendLesserRelic(p, n); } catch (e) { log('Lesser Relic charge failed', e); }
    try { spendTablets(p, n); } catch (e) { log('Albatross charge failed', e); }
    try { rollMarks(s, n); } catch (e) { log('mark roll failed', e); }
    try { rollPet(s, n); } catch (e) { log('pet roll failed', e); }
    try { pages(); } catch (e) { log('gear pages failed', e); }
  };

  // ---- what the rest reads -----------------------------------------------------------------------------------------
  const api = {
    effects,
    /** The ceilings (gear-model.mjs CAPS), for the help and the Journal. */
    CAPS: G.CAPS,
    /** Ancient Relics mode: the relics drop, and the help and the Journal name them (the user, 22 Oct 2026: "drop if not on"). */
    relicsOn: () => { try { return game.currentGamemode?.allowAncientRelicDrops === true; } catch { return false; } },
    /** stores-model's { rations, fuel } percent changes. */
    costMods: () => G.costMods(effects()),
    /** The clock's factor on every hex's time. */
    pace: () => G.pace(effects()),
    /** GP from a delivery or a task with the cargo pay on it. */
    payOf: (gp) => G.payOf(gp, effects()),
    /** The pirates' toll with the cut on it. */
    tollOf: (toll) => G.tollOf(toll, effects()),
    /** Hull wear points given back after a move that took `taken`. */
    forgiveWear: (taken) => G.forgiveWear(taken, effects().wearCut),
    /** The night sight with the gear's hexes on a lit sea hex. */
    sightWith: (d) => G.sightWith(d, effects()),
    afterMove,
    /** For the dev console: the familiar's mark count and the synergies unlocked with it. */
    marks: () => { try { const r = game.summoning.actions.getObjectByID(`voyage:${G.FAMILIAR.id}`); return r === undefined ? undefined : { count: game.summoning.getMarkCount(r), level: game.summoning.getMarkLevel(r) }; } catch { return undefined; } },
  };
  state.gear = api;
  return api;
}
