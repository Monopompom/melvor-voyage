// The ship in the game (phase 3b): the rules of ship-model.mjs applied to the map. The ship lives in
// the Voyage skill's save record (`record.ship`); this module keeps it in step with the player.
//
// Pathing: WorldMap.getHexNeighboursAndCosts feeds the game's A* (computePath), which the travel button, the
// trader and the stranded check all use. Dropping the steps canStep refuses makes every path obey "off the ship,
// land only" without touching travel itself. The rules apply only while state.active() (table trusted, rules on).
// A move then calls afterMove, which moves the ship along. The hex overview says why a hex has no path.

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
      return result.filter(([n]) => shipModel.canStep(from, recOf(n), s, g));
    } catch (e) { log('ship pathing failed; vanilla path', e); return result; }
  });

  /** Steps of a move for the XP of model.xpForSteps, with the homeward rule's moves marked free. */
  const stepsOf = (path) => {
    const s = ship();
    const steps = [];
    for (let i = 0; i < path.length - 1; i++) {
      const next = path[i];
      const prev = path[i + 1];
      const rec = recOf(next);
      steps.push({ water: shipModel.isSea(rec), fastTravel: prev.canFastTravelTo(next), free: shipModel.isFreeStep(rec, s, geoNow()) });
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
    const recs = path.map(recOf).reverse();
    let next = shipModel.shipAfterPath(recs, s);
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
    return shipModel.launchSpot(rec, state.terrain.neighbours(rec.q, rec.r));
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
    setShip({ hull: 'dinghy', q: spot.q, r: spot.r }, 'built');
    try { game.notifications.createSuccessNotification('voyage:ship', t('MOD_VOY_SHIP_BUILT'), ctx.getResourceUrl(HULLS.dinghy.media)); } catch {}
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
        customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass({ popup: 'voyage-ui' }) : { popup: 'voyage-ui' },
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
    setShip({ hull: 'dinghy', q: spot.q, r: spot.r }, 'given');
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
        note.className = 'voyage-path-note font-size-sm text-warning mb-1';
        this.travelBtn?.before(note);
      }
      note.textContent = reason;
      note.classList.remove('d-none');
    } catch (e) { log('path note failed', e); }
  });

  // ---- dev and page helpers ------------------------------------------------------------------------------------
  const api = {
    ship, aboard, enabled, setShip,
    hullName: (s) => hullWord(HULLS[s?.hull]), stepsOf, afterMove, build, buildBlocker, buildCosts, launchSpot, whereIs, recOf,
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
