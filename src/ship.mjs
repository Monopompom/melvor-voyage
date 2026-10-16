// The ship in the game (phase 3b): the rules of ship-model.mjs applied to the map. The ship lives in
// the Voyage skill's save record (`record.ship`); this module keeps it in step with the player.
//
// Pathing: WorldMap.getHexNeighboursAndCosts feeds the game's A* (computePath), which the travel button, the
// trader and the stranded check all use. Dropping the steps canStep refuses makes every path obey "off the ship,
// land only" without touching travel itself. The rules apply only while state.active() (table trusted, rules on).
// A move then calls afterMove, which moves the ship along. The hex overview says why a hex has no path.

// Modal buttons: confirm green, cancel blue outline (the game's default cancel is red; grey means disabled).
const SWAL_CLASS = { popup: 'voyage-ui', confirmButton: 'btn btn-success m-1', cancelButton: 'btn btn-outline-info m-1' };

export function install(ctx, { state, model, shipModel, terrainMod, log }) {
  const { HULLS, DINGHY_BUILD } = shipModel;
  const skill = () => state.voyageSkill?.();
  /** The ship, null when there is none, undefined when the skill is missing or its save is from a newer build. */
  const ship = () => { const s = skill(); return s === undefined || s.futureRaw !== undefined ? undefined : s.record.ship; };
  const enabled = () => ship() !== undefined && state.active();
  const listeners = [];
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  /** A hull named mid-sentence ("your dinghy"): its tier name, lower case in English. */
  const hullWord = (hull) => (hull === undefined ? t('MOD_VOY_SHIP_BOAT') : t(shipModel.tierNameKey(hull.tier)));

  /** Terrain record of a game hex; hexes outside the table count as land unless the game marks them water. */
  const recOf = (hex) => state.recordAt(hex) ?? { q: hex.q, r: hex.r, t: hex.isWater ? 'water' : 'grasslands' };
  const player = () => state.position();
  /**
   * Map facts for the step rule (ship-model.mjs seaIndex): island tiers and the sailing distance to a coast each hull
   * may land on. Rebuilt when the terrain is (every character load). Undefined before a character is loaded.
   */
  let geo;
  let geoFor;
  const geoNow = () => {
    if (state.terrain === undefined) return undefined;
    if (geoFor !== state.terrain) { geo = shipModel.seaIndex(state.terrain); geoFor = state.terrain; }
    return geo;
  };
  const aboard = () => { const p = player(); return p !== undefined && shipModel.isAboard(recOf(p), ship()); };

  /** Every change to the ship goes through here: page, markers and the selected path follow. */
  const setShip = (next, why) => {
    const s = skill();
    if (s === undefined || s.futureRaw !== undefined) return;
    s.record.ship = next;
    s.renderQueue.page = true;
    try { game.cartography.renderQueue.hexPath = true; } catch {}
    if (why) log(`ship ${why}:`, next);
    listeners.forEach((fn) => { try { fn(); } catch (e) { log('ship listener failed', e); } });
    state.onSettingsChange(); // the here panel and the page redraw
  };

  // ---- pathing --------------------------------------------------------------------------------------------------
  ctx.patch(WorldMap, 'getHexNeighboursAndCosts').after(function (result, hex) {
    try {
      if (!Array.isArray(result) || !enabled()) return result;
      const from = recOf(hex);
      const s = ship();
      const g = geoNow();
      if (g === undefined) return result;
      // Fast travel between ports is sailing (3c): the hop needs the ship at this port's quay.
      return result.filter(([n]) => (isHop(hex, n) ? shipModel.canHop(from, recOf(n), s, dockOf(n), g) : shipModel.canStep(from, recOf(n), s, g)));
    } catch (e) { log('ship pathing failed; vanilla path', e); return result; }
  });

  /** A fast-travel hop between two game hexes (the game's port network; getTravelCosts skips these). */
  const isHop = (prev, next) => { try { return prev.canFastTravelTo(next) === true; } catch { return false; } };
  /**
   * True when the player has fully surveyed the hex. Travel only paths through such hexes (the game's
   * getHexNeighboursAndCosts), so a boat put anywhere else could not be reached (user report, build .55).
   */
  const charted = (rec) => {
    try { return game.cartography.activeMap?.getHex(new HexCoords(rec.q, rec.r))?.isFullySurveyed === true; } catch { return false; }
  };
  /**
   * Where the ship docks at a port reached by a hop: a sea hex next to it (open water first), a surveyed one when
   * there is any (otherwise surveying it is the way back aboard), or undefined.
   */
  const dockOf = (hex) => {
    if (state.terrain === undefined) return undefined;
    const rec = recOf(hex);
    const around = state.terrain.neighbours(rec.q, rec.r);
    return shipModel.launchSpot(rec, around.filter(charted)) ?? shipModel.launchSpot(rec, around);
  };
  /** Sea steps from `rec` to a coast the current hull may land on (any coast with no ship); 0 on land. */
  const homeOf = (rec) => {
    const g = geoNow();
    if (g === undefined) return shipModel.isSea(rec) ? (rec.shore ?? 1) : 0;
    return g.home(rec, ship() == null ? 0 : shipModel.tierOf(ship()));
  };

  /**
   * The steps of a move in walking order (start to destination), for the XP of model.xpForSteps and the stores of
   * stores-model.mjs planMove: { water, sea, cls, fastTravel, hop, free, homeward, deep }. `hop` is a fast-travel hop's
   * straight-line length while the ship rules make it sailing; with the rules off a hop stays vanilla (free). `free`
   * also marks the homeward rule's moves. `homeward`: a sea step closer to a coast. `deep`: 3+ hexes from land (hull
   * wear, 3d).
   */
  const stepsOf = (path) => {
    const s = ship();
    const g = geoNow();
    const sailing = enabled();
    const steps = [];
    for (let i = path.length - 2; i >= 0; i--) {
      const next = path[i];
      const prev = path[i + 1];
      const rec = recOf(next);
      const fastTravel = isHop(prev, next);
      const sea = shipModel.isSea(rec);
      const hop = fastTravel && sailing ? terrainMod.hexDistance(prev, next) : 0;
      const free = (fastTravel && hop === 0) || shipModel.isFreeStep(rec, s, g);
      const homeward = sea && homeOf(rec) < homeOf(recOf(prev));
      const deep = sea && (Number.isInteger(rec.shore) ? rec.shore : 1) >= shipModel.DEEP_SHORE;
      steps.push({ water: sea, sea, cls: rec.t, fastTravel, hop, free, homeward, deep });
    }
    return steps;
  };

  /**
   * After a move along `path` (the game's order: destination first). The ship follows a sea crossing it was boarded
   * for. Standing on the sea away from it (a move with the rules off) brings it over: on the sea you are aboard.
   */
  const afterMove = (path) => {
    const s = ship();
    if (s == null) return;
    // Walking order; a record reached by a sailed fast-travel hop carries hop: true (the ship goes with you).
    const recs = path.map((hex, i) => ({ ...recOf(hex), hop: enabled() && i < path.length - 1 && isHop(path[i + 1], hex), hex })).reverse();
    let next = shipModel.shipAfterHops(recs, s, (rec) => dockOf(rec.hex));
    if (next !== s && shipModel.sameHex(next, s)) next = s;
    const here = recs[recs.length - 1];
    if (shipModel.isSea(here) && !shipModel.sameHex(here, next)) next = { ...next, q: here.q, r: here.r };
    if (next !== s) setShip(next, 'moved');
  };

  // ---- building -------------------------------------------------------------------------------------------------
  const buildCosts = () => {
    const costs = new Costs(game);
    costs.addCurrency(game.gp, DINGHY_BUILD.gp);
    for (const { id, quantity } of DINGHY_BUILD.items) {
      const item = game.items.getObjectByID(id);
      if (item !== undefined) costs.addItem(item, quantity);
    }
    return costs;
  };
  const launchSpot = () => {
    const p = player();
    if (p === undefined || state.terrain === undefined) return undefined;
    const rec = recOf(p);
    // Only water the player has surveyed: a boat launched into fog can't be reached (and building it would reveal
    // that the fog hides water).
    return shipModel.launchSpot(rec, state.terrain.neighbours(rec.q, rec.r).filter(charted));
  };
  /** Why the dinghy can't be built right now, or undefined. */
  const buildBlocker = () => {
    if (ship() !== null) return t('MOD_VOY_SHIP_BLOCK_HAS_SHIP');
    if (!state.active()) return t('MOD_VOY_SHIP_BLOCK_RULES_OFF');
    if (launchSpot() === undefined) return t('MOD_VOY_SHIP_BLOCK_NOT_COAST');
    if (!buildCosts().checkIfOwned()) return t('MOD_VOY_SHIP_BLOCK_NO_MATERIALS');
    return undefined;
  };
  const build = () => {
    const why = buildBlocker();
    if (why !== undefined) { notifyPlayer(skill(), why, 'danger'); return false; }
    const spot = launchSpot();
    const costs = buildCosts();
    costs.consumeCosts();
    setShip({ hull: 'dinghy', q: spot.q, r: spot.r, cond: 100 }, 'built');
    try { game.notifications.createSuccessNotification('voyage:ship', t('MOD_VOY_SHIP_BUILT'), ctx.getResourceUrl(HULLS.dinghy.media)); } catch {}
    return true;
  };

  // ---- hull condition and repairs (phase 3d) -----------------------------------------------------
  const cond = () => shipModel.condOf(ship());
  /** After a move the stores planned: the hull keeps what the voyage left of it. */
  const setCond = (value) => {
    const s = ship();
    if (s == null || !Number.isFinite(value)) return;
    const next = Math.min(100, Math.max(0, Math.round(value)));
    if (next !== shipModel.condOf(s)) setShip({ ...s, cond: next });
  };
  /** Every log in the bank, cheapest first (by the Firemaking level it needs): timber for repairs. */
  const logStacks = () => {
    const out = [];
    try {
      [...game.firemaking.actions.allObjects].sort((a, b) => a.level - b.level).forEach((a) => {
        const qty = a.log === undefined ? 0 : game.bank.getQty(a.log);
        if (qty > 0) out.push({ item: a.log, qty });
      });
    } catch (e) { log('log stacks failed', e); }
    return out;
  };
  const pitchItem = () => { try { return game.items.getObjectByID('voyage:Pitch'); } catch { return undefined; } };
  /** { cond, plan, logs, pitch, blocker }: what a repair here would do, and why it can't when it can't. */
  const repairInfo = () => {
    const s = ship();
    if (s == null) return undefined;
    const logs = logStacks().reduce((n, x) => n + x.qty, 0);
    const item = pitchItem();
    const pitch = item === undefined ? 0 : game.bank.getQty(item);
    const c = shipModel.condOf(s);
    const plan = shipModel.repairPlan(c, logs, pitch);
    let blocker;
    const p = player();
    if (c >= 100) blocker = t('MOD_VOY_HULL_BLOCK_SOUND');
    else if (p === undefined || !shipModel.canRepair(recOf(p), s, recOf({ q: s.q, r: s.r, isWater: true }))) blocker = t('MOD_VOY_HULL_BLOCK_BEACH', { hull: hullWord(HULLS[s.hull]) });
    else if (plan.steps === 0) blocker = t('MOD_VOY_HULL_BLOCK_MATERIALS', { logs: `${shipModel.REPAIR.logs}`, pitch: `${shipModel.REPAIR.pitch}`, step: `${shipModel.REPAIR.step}` });
    return { cond: c, plan, logs, pitch, blocker };
  };
  const repair = () => {
    const info = repairInfo();
    if (info === undefined) return false;
    if (info.blocker !== undefined) { notifyPlayer(skill(), info.blocker, 'danger'); return false; }
    let logs = info.plan.logs;
    for (const { item, qty } of logStacks()) {
      if (logs <= 0) break;
      const n = Math.min(qty, logs);
      game.bank.removeItemQuantity(item, n, true);
      logs -= n;
    }
    game.bank.removeItemQuantity(pitchItem(), info.plan.pitch, true);
    setShip({ ...ship(), cond: info.plan.to }, `repaired to ${info.plan.to}%`);
    try { game.notifications.createSuccessNotification('voyage:hull', t('MOD_VOY_HULL_REPAIRED', { cond: `${info.plan.to}` }), ctx.getResourceUrl('assets/hull_condition.png')); } catch {}
    return true;
  };

  // ---- existing characters ----------------------------------------------------------------------
  const notice = (html) => {
    try {
      SwalLocale.fire({
        title: `<img class="voyage-title-icon" src="${ctx.getResourceUrl(HULLS.dinghy.media)}">${t('MOD_VOY_SHIP_NOTICE_TITLE')}`,
        html: `<div class="text-left voyage-locked"><div class="voyage-locked-lines">${html}</div></div>`,
        icon: 'info',
        confirmButtonText: t('MOD_VOY_BUTTON_GOT_IT'),
        customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass(SWAL_CLASS) : SWAL_CLASS,
      });
    } catch (e) { log('ship notice failed', e); }
  };
  /** Shown once the interface is up, after any other popup (the compass welcome) has been closed. */
  let pendingNotice;
  const showWhenFree = (html, tries = 0) => {
    let busy = false;
    try { busy = typeof Swal !== 'undefined' && Swal.isVisible(); } catch {}
    if (busy && tries < 240) { setTimeout(() => showWhenFree(html, tries + 1), 500); return; }
    notice(html);
  };
  ctx.onInterfaceReady(() => {
    if (pendingNotice !== undefined) { const html = pendingNotice; pendingNotice = undefined; setTimeout(() => showWhenFree(html), 1200); }
  });
  const ruleLine = () => `<div>${t('MOD_VOY_SHIP_NOTICE_RULE')}</div>`;

  /** Once per character, on the first load with ships: the free dinghy for anyone phase 2 left on the water or overseas. */
  const firstLoad = () => {
    const s = skill();
    if (s === undefined || s.futureRaw !== undefined || s.record.shipChecked || state.mode !== 'strict') return;
    const p = player();
    if (p === undefined) return;
    s.record.shipChecked = true;
    if (s.record.ship !== null) return;
    const map = p.map;
    const rec = recOf(p);
    const spot = shipModel.freeBoatSpot(rec, map?.startingLocation, state.terrain, terrainMod.hexDistance);
    if (spot === undefined) return;
    setShip({ hull: 'dinghy', q: spot.q, r: spot.r, cond: 100 }, 'given');
    const far = shipModel.beyondReach(rec, { hull: 'dinghy', q: rec.q, r: rec.r }, geoNow());
    const lines = shipModel.isSea(rec)
      ? `<div>${t('MOD_VOY_SHIP_NOTICE_AT_SEA')}</div>${ruleLine()}` +
        (far ? `<div>${t('MOD_VOY_SHIP_NOTICE_FAR', { reach: `${HULLS.dinghy.reach}` })}</div>` : '')
      : `<div>${t('MOD_VOY_SHIP_NOTICE_OVERSEAS')}</div>${ruleLine()}`;
    pendingNotice = lines;
  };

  /** Keeps "on the sea means aboard" true on load, whatever moved the player since (rules off, a portal). */
  const snapToPlayer = () => {
    const s = ship();
    const p = player();
    if (s == null || p === undefined) return;
    const rec = recOf(p);
    if (shipModel.isSea(rec) && !shipModel.sameHex(rec, s)) setShip({ ...s, q: rec.q, r: rec.r }, 'snapped to the player');
  };

  // ---- hex overview: why there is no path ------------------------------------------------------------------------
  const reasonFor = (hex) => {
    if (!enabled() || hex === undefined || !hex.isFullySurveyed || hex.isPlayerHere || hex.map.selectedHexPath !== undefined) return undefined;
    const to = recOf(hex);
    const s = ship();
    // Fast travel between ports is sailing (3c): the hop is there only with the ship at this port's quay.
    const here = player();
    if (here !== undefined && isHop(here, hex) && !shipModel.canHop(recOf(here), to, s, dockOf(hex), geoNow())) {
      const island = geoNow()?.islandOf(to);
      if (s === null) return t('MOD_VOY_SHIP_PATH_HOP_NO_BOAT');
      if (island === undefined || island.tier <= HULLS[s.hull].tier) return t('MOD_VOY_SHIP_PATH_HOP_AWAY', { hull: hullWord(HULLS[s.hull]), where: whereIs(s) });
    }
    if (s === null) {
      if (shipModel.isSea(to)) return t('MOD_VOY_SHIP_PATH_NEED_BOAT_WATER');
      return t('MOD_VOY_SHIP_PATH_NEED_BOAT_LAND');
    }
    const hull = HULLS[s.hull];
    const g = geoNow();
    const island = g?.islandOf(to);
    const name = hullWord(hull);
    if (island !== undefined && island.tier > hull.tier) {
      return t('MOD_VOY_SHIP_PATH_ISLAND_LOCKED', { hull: name, island: t(shipModel.islandNameKey(island.id)), needed: t(shipModel.tierNameKey(island.tier)) });
    }
    if (shipModel.beyondReach(to, s, g)) return t('MOD_VOY_SHIP_PATH_TOO_FAR', { hull: name, reach: `${hull.reach}` });
    if (!aboard()) return t('MOD_VOY_SHIP_PATH_MOORED', { hull: name, where: whereIs(s) });
    return t('MOD_VOY_SHIP_PATH_OUT_OF_REACH', { hull: name, reach: `${hull.reach}` });
  };
  /** "3 hexes south-west of you", or "here". `short`: "3 hexes SW of you" (the panel, user feedback). */
  const whereIs = (s, short = false) => {
    const p = player();
    if (p === undefined) return t('MOD_VOY_SHIP_WHERE_UNKNOWN');
    const d = terrainMod.hexDistance(p, s);
    if (d === 0) return t('MOD_VOY_SHIP_WHERE_HERE');
    const distance = t(d === 1 ? 'MOD_VOY_HEXES_ONE' : 'MOD_VOY_HEXES_MANY', { count: `${d}` });
    return t('MOD_VOY_SHIP_WHERE_AWAY', { distance, dir: t(`MOD_VOY_DIR_${short ? 'SHORT_' : ''}${terrainMod.directionLabel(p, s)}`) });
  };
  ctx.patch(HexOverviewElement, 'displayHex').after(function (_r, hex) {
    try {
      let note = this.querySelector('.voyage-path-note');
      const reason = reasonFor(hex);
      if (reason === undefined) { note?.classList.add('d-none'); return; }
      if (note === null) {
        note = document.createElement('div');
        note.className = 'voyage-path-note font-w600 text-warning mb-1';
        this.travelBtn?.before(note);
      }
      note.textContent = reason;
      note.classList.remove('d-none');
    } catch (e) { log('path note failed', e); }
  });

  // ---- dev and page helpers ------------------------------------------------------------------------------------
  const api = {
    ship, aboard, enabled, setShip,
    hullName: (s) => hullWord(HULLS[s?.hull]), stepsOf, afterMove, homeOf, dockOf, isHop, build, buildBlocker, buildCosts, launchSpot, whereIs, recOf,
    cond, setCond, repairInfo, repair,
    onChange: (fn) => listeners.push(fn),
    /** May a road step from one game hex to the next under the ship rules? True while they are off (trader roads). */
    allows(fromHex, toHex) {
      if (!enabled()) return true;
      const g = geoNow();
      return g === undefined || shipModel.canStep(recOf(fromHex), recOf(toHex), ship(), g);
    },
    /**
     * Centres the map on a hex the way the game's own location search does (animateMoveToHex). Not moveToHex: that
     * sets the view without the viewport's 'moved' event, so the game never loads the artwork tiles there and
     * surveyed hexes show black. Keeps the current zoom.
     */
    centreOn(hex) {
      if (typeof cartographyMap === 'undefined' || cartographyMap === null) return;
      const zoom = cartographyMap.viewport?.scaled;
      cartographyMap.animateMoveToHex(hex, Number.isFinite(zoom) ? zoom : 1);
    },
    /** The game hex of the ship on the active map, or undefined. */
    hex: () => { const s = ship(); try { return s ? game.cartography.activeMap?.getHex(new HexCoords(s.q, s.r)) : undefined; } catch { return undefined; } },
    loaded() {
      try { firstLoad(); snapToPlayer(); } catch (e) { console.error('[Voyage] ship load failed', e); }
      listeners.forEach((fn) => { try { fn(); } catch (e) { log('ship listener failed', e); } });
    },
  };
  state.ship = api;
  return api;
}
