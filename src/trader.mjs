// The wandering trader: the floor under the trade gate. A player who is stranded (trade refused
// here, the road to any trading spot unaffordable, no way to earn GP here) meets a trader when they try to sell or
// click the panel line. He buys at half price on this hex until the road is affordable, then moves on. With nothing
// worth selling he spares exactly the GP for the road to the nearest place where combat pays (Adventure: every skill
// starts locked, so combat is the only income; decided 15 Oct 2026), or failing that one step to a hex where an
// unlocked gathering skill works. Roads follow the ship rules (src/ship.mjs `allows`).
//
// Route and verdict are pure (src/stranded.mjs). This module reads the live map and economy, fails toward
// "stranded" on any error (a wrong offer is better than a soft lock), and never touches anything while the gates are off.

// Modal buttons: confirm green, cancel blue outline (the game's default cancel is red; grey means disabled).
const SWAL_CLASS = { popup: 'voyage-ui', confirmButton: 'btn btn-success m-1', cancelButton: 'btn btn-outline-info m-1' };

const GATHERING = ['melvorD:Woodcutting', 'melvorD:Fishing', 'melvorD:Mining'];
/** His portrait (build .210, the user's pick); the GP coin before. */
const TRADER_ART = 'assets/trader.webp';
const HALF = 0.5;

export function install(ctx, { state, rules, terrainMod, stranded, helpLayout, log }) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const keyOf = (hex) => terrainMod.hexKey(hex.q, hex.r);
  // Player-facing text comes from languages/<code>.json (Translatable text).
  const hexes = (n) => templateLangString(n === 1 ? 'MOD_VOY_HEXES_ONE' : 'MOD_VOY_HEXES_MANY', { count: `${n}` });
  /** The trader met on this stranded spell: { key, coinsGiven }; undefined when none is here. */
  let met;
  const art = () => { try { return ctx.getResourceUrl(TRADER_ART); } catch { return game.gp.media; } };

  // ------------------------------------------------------------------------------------------------ the road
  const neighboursOf = (map) => (hex) => {
    const out = [];
    HexCoords.axialDirVectors.forEach((_, i) => {
      const n = map.getHex(HexCoords.axialNeighbor(hex, i));
      if (n !== undefined && (state.ship?.allows?.(hex, n) ?? true)) out.push(n);
    });
    return out;
  };
  const tradeSpot = (hex) => {
    const rec = state.recordAt(hex);
    return rec !== undefined && rec.cloud !== true && rules.tradeAllowedAt(rec, state.terrain.neighbours(rec.q, rec.r));
  };
  const gpOf = (costs) => costs.getCurrencyQuantityArray().reduce((sum, { currency, quantity }) => sum + (currency === game.gp ? quantity : 0), 0);

  /** Cheapest road to any trading spot, known or not (survey state ignored): { path, gp, itemsOwned }. */
  const road = (pos) => {
    const cart = game.cartography;
    const map = cart.activeMap;
    const mult = cart.travelCostMultiplier;
    const found = stranded.cheapestRoute(pos, { neighbours: neighboursOf(map), stepCost: (h) => h.getCombinedCost(mult), isGoal: tradeSpot, key: keyOf });
    if (found === undefined) return undefined;
    const costs = cart.getTravelCosts(found.path);
    const gp = gpOf(costs);
    // Items: the costs object checks GP too; with GP covered separately, a failed check means missing items.
    const itemsOwned = costs.getItemQuantityArray().every(({ item, quantity }) => game.bank.getQty(item) >= quantity);
    return { path: found.path, gp, itemsOwned };
  };

  // ------------------------------------------------------------------------------------------------ combat road
  /**
   * Where combat pays for this player: hex key -> area, for every combat or slayer area they may enter (its entry
   * requirements met) whose monsters drop GP, on its tagged hexes and one hex around (the combat placement rule).
   * Rebuilt per call: cheap next to the route search, and requirements change as the player levels.
   */
  const combatSpots = () => {
    const spots = new Map();
    try { if (!game.tutorial.complete) return spots; } catch {} // the gate is off during the tutorial
    game.combatAreas.forEach((area) => {
      if (area === game.unknownCombatArea || notAreaKind(area)) return;
      if (!game.checkRequirements(area.entryRequirements ?? []) || !(area.monsters ?? []).some(gpDrop)) return;
      const places = state.terrain.placesFor(area.id);
      // Grace of one hex (rules.PLACE_GRACE). An unplaced area may be fought anywhere, so gpSources already counts it.
      for (const p of places) {
        for (const h of [p, ...state.terrain.neighbours(p.q, p.r)]) {
          const k = terrainMod.hexKey(h.q, h.r);
          if (!spots.has(k)) spots.set(k, area);
        }
      }
    });
    return spots;
  };
  /** Cheapest road to a place where combat pays: { path, gp, itemsOwned, area }, or undefined. */
  const combatRoad = (pos) => {
    if (!state.settings.combat()) return undefined; // combat works anywhere: gpSources already says so
    const cart = game.cartography;
    const map = cart.activeMap;
    const mult = cart.travelCostMultiplier;
    const spots = combatSpots();
    if (spots.size === 0) return undefined;
    const found = stranded.cheapestRoute(pos, { neighbours: neighboursOf(map), stepCost: (h) => h.getCombinedCost(mult), isGoal: (h) => spots.has(keyOf(h)), key: keyOf });
    if (found === undefined) return undefined;
    const costs = cart.getTravelCosts(found.path);
    const itemsOwned = costs.getItemQuantityArray().every(({ item, quantity }) => game.bank.getQty(item) >= quantity);
    return { path: found.path, gp: gpOf(costs), itemsOwned, area: spots.get(keyOf(found.path[0])) };
  };

  // ------------------------------------------------------------------------------------------------ GP sources
  const gpDrop = (monster) => (monster?.currencyDrops ?? []).some((d) => d.currency === game.gp && d.max > 0);
  // Dungeons, strongholds and Abyss depths are not "fight for coin" areas. Game classes are global bindings but not
  // globalThis properties, so they are read through thunks (a ReferenceError means the class is absent).
  const AREA_KINDS = [() => Dungeon, () => Stronghold, () => AbyssDepth];
  const notAreaKind = (area) => AREA_KINDS.some((cls) => { try { return area instanceof cls(); } catch { return false; } });
  const sellableItem = () => {
    for (const bankItem of game.bank.items.values()) {
      if (!bankItem.locked && bankItem.item.sellsFor?.currency === game.gp && bankItem.item.sellsFor.quantity > 0) return true;
    }
    return false;
  };
  /** Names of the ways to earn GP that work for the player right now on this hex (the user's rule). */
  const gpSources = (pos) => {
    const out = [];
    const rec = state.recordAt(pos);
    const opts = state.ruleOpts();
    const check = (name, fn) => { try { if (fn()) out.push(name); } catch (e) { log(`gp source ${name} check failed`, e); } };
    check('Thieving', () => game.thieving?.isUnlocked !== false && rules.allowedAt('melvorD:Thieving', rec, opts));
    check('combat', () => {
      let ok = false;
      game.combatAreas.forEach((area) => {
        if (ok || area === game.unknownCombatArea || notAreaKind(area)) return;
        if (state.combatLocked?.(area)) return;
        if (!game.checkRequirements(area.entryRequirements ?? [])) return;
        if ((area.monsters ?? []).some(gpDrop)) ok = true;
      });
      return ok;
    });
    check('Alt. Magic', () => {
      const am = game.altMagic;
      if (am === undefined || am.isUnlocked === false || !rules.allowedAt('melvorD:Magic', rec, opts) || !sellableItem()) return false;
      const gpId = typeof AltMagicProductionID !== 'undefined' ? AltMagicProductionID.GP : -1;
      let ok = false;
      am.actions.forEach((spell) => {
        if (ok || spell.produces !== gpId || spell.level > am.level) return;
        if ((spell.abyssalLevel ?? 0) > 0 && (spell.abyssalLevel > (am.abyssalLevel ?? 0))) return;
        const runes = game.combat.player.getRuneCosts(spell);
        if (runes.every(({ item, quantity }) => game.bank.getQty(item) >= quantity)) ok = true;
      });
      return ok;
    });
    check('Township', () => (game.township?.getGPGainRate?.() ?? 0) >= 1);
    check('Agility', () => {
      let ok = false;
      game.agility?.courses?.forEach((course) => course.builtObstacles.forEach((ob) => {
        if ((ob.currencyRewards ?? []).some(({ currency, quantity }) => currency === game.gp && quantity > 0)) ok = true;
      }));
      return ok;
    });
    return out;
  };

  // ------------------------------------------------------------------------------------------------ verdict
  /** { stranded, reason, road, combat } for the player's hex; stranded on any error so the floor never fails closed. */
  const verdict = () => {
    const pos = state.position();
    if (pos === undefined) return { stranded: false, reason: 'no position' };
    // Adrift at sea (5b part two) has its own ways out; the trader stays ashore.
    if (state.adrift?.isAdrift?.() === true) return { stranded: false, reason: 'adrift' };
    const tradeLocked = state.tradeLocked?.() === true;
    const canSell = sellableItem();
    // Cheap exit for the common case: trade works here and there is something to sell.
    if (!tradeLocked && canSell) return { stranded: false, reason: 'can trade here' };
    try {
      const sources = gpSources(pos);
      // Nothing to sell yet, but an unlocked gathering skill works here: gather first, then the trade road counts.
      if (!canSell) {
        const rec = state.recordAt(pos);
        const opts = state.ruleOpts();
        if (GATHERING.some((id) => game.skills.getObjectByID(id)?.isUnlocked !== false && rules.allowedAt(id, rec, opts))) sources.push('gathering');
      }
      if (sources.length > 0) return { stranded: false, reason: `earns GP: ${sources.join(', ')}`, pos };
      const r = canSell ? road(pos) : undefined;
      const combat = combatRoad(pos);
      const v = stranded.strandedVerdict({ tradeLocked, route: r, gp: game.gp.amount, gpSources: sources, canSell, combatRoute: combat });
      return { ...v, road: r, combat, canSell, pos };
    } catch (e) {
      console.error('[Voyage] stranded check failed; treating as stranded', e);
      return { stranded: true, reason: 'check failed', pos };
    }
  };

  /**
   * Spare coins when there is nothing to sell: the GP for the road to the nearest place where combat pays, or else
   * for one step to the cheapest neighbour where an unlocked gathering skill works. undefined when he can't help so.
   */
  const spareCoins = (v) => {
    const pos = v.pos;
    if (v.canSell !== false && sellableItem()) return undefined;
    if (v.combat !== undefined && v.combat.itemsOwned !== false) {
      const need = v.combat.gp - game.gp.amount;
      const dest = v.combat.path[0];
      const at = (() => { try { const o = dest.to_oddq(); return `${o.col}, ${o.row}`; } catch { return `${dest.q}, ${dest.r}`; } })();
      if (need > 0) return { gp: need, to: v.combat.area?.name ?? getLangString('MOD_VOY_TRADER_SOME_AREA'), at, dir: terrainMod.directionLabel(pos, dest), steps: v.combat.path.length - 1, combat: true };
    }
    try {
      const rec = state.recordAt(pos);
      const opts = state.ruleOpts();
      const gathering = GATHERING.filter((id) => game.skills.getObjectByID(id)?.isUnlocked !== false);
      if (gathering.length === 0 || gathering.some((id) => rules.allowedAt(id, rec, opts))) return undefined;
      const cart = game.cartography;
      let best;
      for (const n of neighboursOf(cart.activeMap)(pos)) {
        const nrec = state.recordAt(n);
        if (!gathering.some((id) => rules.allowedAt(id, nrec, opts))) continue;
        if (!(state.ship?.allows?.(pos, n) ?? true)) continue;
        if ((n.travelCost.items ?? []).length > 0) continue;
        const gp = (n.travelCost.currencies ?? []).reduce((s, { currency, quantity }) => s + (currency === game.gp ? Math.floor(quantity * cart.travelCostMultiplier * (state.land?.gpFactor(n) ?? 1)) : 0), 0);
        if (best === undefined || gp < best.gp) best = { hex: n, gp };
      }
      if (best === undefined) return undefined;
      const need = best.gp - game.gp.amount;
      return need > 0 ? { gp: need, dir: terrainMod.directionLabel(pos, best.hex) } : undefined;
    } catch (e) { log('spare coins failed', e); return undefined; }
  };

  // ------------------------------------------------------------------------------------------------ presence
  /** True while the trader stands on the player's hex: sales go through at half price. Cheap: no route search. */
  const present = () => {
    if (met === undefined) return false;
    const pos = state.position();
    return pos !== undefined && keyOf(pos) === met.key && state.tradeLocked?.() === true;
  };

  let leaveQueued = false;
  /** Deferred and coalesced (a bulk sale calls this per item): the trader leaves once the road is affordable. */
  const checkLeave = () => {
    if (leaveQueued || met === undefined) return;
    leaveQueued = true;
    setTimeout(() => {
      leaveQueued = false;
      if (met === undefined) return;
      const pos = state.position();
      const moved = pos === undefined || keyOf(pos) !== met.key;
      if (!moved && verdict().stranded) return;
      met = undefined;
      log(`wandering trader left (${moved ? 'moved' : 'no longer stranded'})`);
      try { game.notifications.createSuccessNotification('voyage:trader', getLangString(moved ? 'MOD_VOY_TRADER_LEFT_BEHIND' : 'MOD_VOY_TRADER_MOVES_ON'), art()); } catch {}
      state.onSettingsChange();
    }, 0);
  };

  /**
   * Offers the trader if the player is stranded here. Returns false when they are not (the caller refuses as usual).
   * `then` continues the sale the player clicked once they accept.
   */
  const offer = (then) => {
    if (present()) { then?.(); return true; }
    const v = verdict();
    log(`stranded check: ${v.reason}`);
    if (!v.stranded) return false;
    state.journal?.learn('stranded');
    const coins = spareCoins(v);
    const lines = [getLangString('MOD_VOY_TRADER_ARRIVES')];
    if (v.canSell !== false) {
      lines.push(getLangString('MOD_VOY_TRADER_HALF_PRICE'));
      lines.push(getLangString('MOD_VOY_TRADER_STAYS'));
    }
    if (coins?.combat) {
      lines.push(templateLangString('MOD_VOY_TRADER_SPARES_COMBAT', {
        gp: numberWithCommas(coins.gp), area: esc(coins.to), at: coins.at, hexes: hexes(coins.steps), dir: esc(getLangString(`MOD_VOY_DIR_${coins.dir}`)),
      }));
    } else if (coins !== undefined) {
      lines.push(templateLangString('MOD_VOY_TRADER_SPARES_STEP', { gp: numberWithCommas(coins.gp), dir: esc(getLangString(`MOD_VOY_DIR_SHORT_${coins.dir}`)) }));
    } else if (v.canSell === false) {
      lines.push(getLangString('MOD_VOY_TRADER_NO_ROAD'));
    }
    const hasOffer = coins !== undefined || v.canSell !== false;
    try {
      SwalLocale.fire({
        didRender: state.popupDidRender,
        title: getLangString('MOD_VOY_TRADER_TITLE'),
        width: '36em', // an eighth wider than the 32em default, so the opening line fits on two lines (user feedback)
        // One picture on top, the trader (the coin until build .210); no "?" sign beside it (message popup layout, build .94).
        html: helpLayout.msgHtml(lines),
        imageUrl: art(),
        ...helpLayout.MSG_IMAGE,
        imageWidth: 112, imageHeight: 112, // the trader bigger than a message's usual 64 px (the user, build .210)
        showCancelButton: hasOffer,
        confirmButtonText: getLangString(coins !== undefined ? 'MOD_VOY_TRADER_BUTTON_THANK' : hasOffer ? 'MOD_VOY_TRADER_BUTTON_TRADE' : 'MOD_VOY_BUTTON_OK'),
        cancelButtonText: getLangString('MOD_VOY_TRADER_BUTTON_NOT_NOW'),
        customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass(SWAL_CLASS) : SWAL_CLASS,
      }).then((result) => {
        if (!result.isConfirmed || !hasOffer) return;
        met = { key: keyOf(v.pos), coinsGiven: false };
        if (coins !== undefined) {
          game.gp.add(coins.gp);
          met.coinsGiven = true;
          log(`trader spared ${coins.gp} GP`);
        }
        log(`wandering trader met at (${v.pos.q},${v.pos.r}): ${v.reason}`);
        state.onSettingsChange();
        if (then !== undefined) { then(); return; }
        // From the panel's button: open the bank to sell there (user feedback, build .61). A sale the player clicked
        // in the bank already continues through `then`.
        if (v.canSell !== false) {
          try { state.openPage(game.pages.getObjectByID('melvorD:Bank')); } catch (e) { log('bank page failed', e); }
        }
      });
    } catch (e) {
      console.error('[Voyage] trader modal failed; letting the sale through', e);
      met = { key: keyOf(v.pos), coinsGiven: false };
      then?.();
    }
    return true;
  };

  // Half price while he is here: the sale dialogs and the sale itself read Bank.getItemSalePrice.
  ctx.patch(Bank, 'getItemSalePrice').after((price) => {
    try { return present() ? Math.floor(price * HALF) : undefined; } catch { return undefined; }
  });
  ctx.patch(Bank, 'processItemSale').after(() => { checkLeave(); });
  (state.saleListeners ??= []).push(checkLeave); // a sale from the hold (build .265)
  ctx.patch(WorldMap, 'setPlayerPosition').after(() => { checkLeave(); });
  state.listeners.push(checkLeave);

  state.trader = {
    present,
    offer,
    /** His portrait, for the provisions rescue popup (stores.mjs; the same face on every popup he is in, build .259). */
    art,
    /** For the panel: 'here' while he is here, 'stranded' when an offer would be made, undefined otherwise. */
    status() {
      if (present()) return 'here';
      return verdict().stranded ? 'stranded' : undefined;
    },
    verdict,
    combatRoad: (pos) => { try { return combatRoad(pos); } catch (e) { log('combat road failed', e); return undefined; } },
  };
}
