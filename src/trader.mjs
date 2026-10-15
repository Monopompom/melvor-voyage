// The wandering trader: the floor under the trade gate. A player who is stranded (trade refused
// here, the road to any trading spot unaffordable, no way to earn GP here) meets a trader when they try to sell or
// click the panel line. He buys at half price on this hex until the road is affordable, then moves on. On a barren
// hex with nothing worth selling he spares exactly the GP for one step to a hex where a gathering skill works.
//
// Route and verdict are pure (src/stranded.mjs). This module reads the live map and economy, fails toward
// "stranded" on any error (a wrong offer is better than a soft lock), and never touches anything while the gates are off.

const GATHERING = ['melvorD:Woodcutting', 'melvorD:Fishing', 'melvorD:Mining'];
const HALF = 0.5;

export function install(ctx, { state, rules, terrainMod, stranded, log }) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const keyOf = (hex) => terrainMod.hexKey(hex.q, hex.r);
  /** The trader met on this stranded spell: { key, coinsGiven }; undefined when none is here. */
  let met;

  // ------------------------------------------------------------------------------------------------ the road
  const neighboursOf = (map) => (hex) => {
    const out = [];
    HexCoords.axialDirVectors.forEach((_, i) => { const n = map.getHex(HexCoords.axialNeighbor(hex, i)); if (n !== undefined) out.push(n); });
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
  /** { stranded, reason, road } for the player's hex; stranded on any error so the floor never fails closed. */
  const verdict = () => {
    const pos = state.position();
    const tradeLocked = state.tradeLocked?.() === true;
    if (!tradeLocked || pos === undefined) return { stranded: false, reason: 'can trade here' };
    try {
      const r = road(pos);
      const v = stranded.strandedVerdict({ tradeLocked, route: r, gp: game.gp.amount, gpSources: gpSources(pos) });
      return { ...v, road: r, pos };
    } catch (e) {
      console.error('[Voyage] stranded check failed; treating as stranded', e);
      return { stranded: true, reason: 'check failed', pos };
    }
  };

  /** Spare coins on a barren hex with nothing to sell: GP for one step to the cheapest neighbour where gathering works. */
  const spareCoins = (pos) => {
    try {
      const rec = state.recordAt(pos);
      const opts = state.ruleOpts();
      if (GATHERING.some((id) => rules.allowedAt(id, rec, opts)) || sellableItem()) return undefined;
      const cart = game.cartography;
      let best;
      for (const n of neighboursOf(cart.activeMap)(pos)) {
        const nrec = state.recordAt(n);
        if (!GATHERING.some((id) => rules.allowedAt(id, nrec, opts))) continue;
        if ((n.travelCost.items ?? []).length > 0) continue;
        const gp = (n.travelCost.currencies ?? []).reduce((s, { currency, quantity }) => s + (currency === game.gp ? Math.floor(quantity * cart.travelCostMultiplier) : 0), 0);
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
      try { game.notifications.createSuccessNotification('voyage:trader', moved ? 'You leave the wandering trader behind.' : 'The wandering trader moves on: you can afford the road now.', game.gp.media); } catch {}
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
    const coins = spareCoins(v.pos);
    const lines = [
      'Looks like you\'re stranded here. Good timing: a wandering trader is just passing by.',
      'He looks over your goods and offers <b>half</b> of what a market would pay. <i>You see his eyes spark for a moment: he knows you have no other choice.</i>',
      'He stays until you can afford the road to a trading place.',
    ];
    if (coins !== undefined) lines.push(`You have nothing worth selling, and nothing grows or swims here. He sighs and spares you <b>${numberWithCommas(coins.gp)} GP</b>, just enough for one step ${esc(coins.dir)}.`);
    try {
      SwalLocale.fire({
        title: 'Stranded?',
        html: `<div class="text-left voyage-locked"><img class="skill-icon-sm mr-2" src="${game.gp.media}"><div class="voyage-locked-lines">${lines.map((l) => `<div>${l}</div>`).join('')}</div></div>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: coins !== undefined ? 'Thank him' : 'Trade with him',
        cancelButtonText: 'Not now',
        customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass({ popup: 'voyage-ui' }) : { popup: 'voyage-ui' },
      }).then((result) => {
        if (!result.isConfirmed) return;
        met = { key: keyOf(v.pos), coinsGiven: false };
        if (coins !== undefined) {
          game.gp.add(coins.gp);
          met.coinsGiven = true;
          log(`trader spared ${coins.gp} GP`);
        }
        log(`wandering trader met at (${v.pos.q},${v.pos.r}): ${v.reason}`);
        state.onSettingsChange();
        then?.();
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
  ctx.patch(WorldMap, 'setPlayerPosition').after(() => { checkLeave(); });
  state.listeners.push(checkLeave);

  state.trader = {
    present,
    offer,
    /** For the panel: 'here' while he is here, 'stranded' when an offer would be made, undefined otherwise. */
    status() {
      if (present()) return 'here';
      if (state.tradeLocked?.() !== true) return undefined;
      return verdict().stranded ? 'stranded' : undefined;
    },
    verdict,
  };
}
