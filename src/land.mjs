// Land upgrades and the Crossroads Sign (build .162), the game side. Rules in land-model.mjs.
//
// Both are shop purchases in the Voyage category (data/package.json), so the game keeps what was bought in its own
// shop save. Land: until phase 5 the mount cuts the GP of land hexes, in Cartography.getTravelCosts (the one place the
// game prices a path: travel, the planner, the stores' rescue and the trader's floor all read it). The route search
// still weighs hexes at the game's prices. Sign: the POI it stands on is the skill record's `sign` (save v12); its
// standing buffs are added after the game's own (Cartography.addProvidedStats), unless it is the POI underfoot, which
// the game already counts. A signpost marker stands on its hex.

export function install(ctx, { state, landModel: L, shipModel, log }) {
  const skill = () => state.voyageSkill?.();
  const enabled = () => skill() !== undefined;
  const purchase = (id) => { try { return game.shop.purchases.getObjectByID(`voyage:${id}`); } catch { return undefined; } };
  const owned = (id) => { const p = purchase(id); try { return p !== undefined && game.shop.getPurchaseCount(p) > 0; } catch { return false; } };
  const changed = () => { try { state.onSettingsChange(); } catch (e) { log('land refresh failed', e); } };

  // ---- land upgrades -------------------------------------------------------------------------------------------------
  const tier = () => (enabled() ? L.mountTier(owned) : 0);
  const nameOf = (m) => (m.id === '' ? getLangString('MOD_VOY_PAGE_LAND_ON_FOOT') : purchase(m.id)?.name ?? m.id);
  /** Land for the cut: Voyage's terrain says sea or not; without the table, the game's water flag. */
  const isLand = (hex) => { const rec = state.recordAt?.(hex); return rec !== undefined ? !shipModel.isSea(rec) : hex?.isWater !== true; };

  ctx.patch(Cartography, 'getTravelCosts').replace(function (original, path) {
    const t = tier();
    if (t === 0) return original(path);
    try {
      const costs = new Costs(this.game);
      const mult = this.travelCostMultiplier;
      for (let i = 0; i < path.length - 1; i++) {
        const next = path[i];
        if (path[i + 1].canFastTravelTo(next)) continue;
        const land = isLand(next);
        (next.travelCost.currencies ?? []).forEach(({ currency, quantity }) => costs.addCurrency(currency, currency === this.game.gp ? L.hexGp(quantity, mult, t, land) : Math.floor(quantity * mult)));
        (next.travelCost.items ?? []).forEach(({ item, quantity }) => costs.addItem(item, Math.max(Math.floor(quantity * mult), 1)));
      }
      return costs;
    } catch (e) { log('land cut failed; game prices', e); return original(path); }
  });

  // ---- the Crossroads Sign -------------------------------------------------------------------------------------------
  const placedId = () => { const r = skill()?.record; return typeof r?.sign === 'string' ? r.sign : ''; };
  const poiById = (id) => {
    if (id === '') return undefined;
    try {
      for (const map of game.cartography.worldMaps.allObjects) { const p = map.pointsOfInterest.getObjectByID(id); if (p !== undefined) return p; }
    } catch {}
    return undefined;
  };
  const hereHex = () => { try { return game.cartography.activeMap?.playerPosition; } catch { return undefined; } };
  const herePoi = () => { const p = hereHex()?.pointOfInterest; return p === undefined ? undefined : { id: p.id, buffs: p.activeStats?.hasStats === true, discovered: p.isDiscovered === true, poi: p }; };
  const action = () => L.signAction({ owned: enabled() && owned(L.SIGN.id), placed: placedId(), here: herePoi() });
  const posMult = () => { try { return game.cartography.hasCarthuluPet ? 2 : 1; } catch { return 1; } };
  const recompute = () => { try { game.cartography.computeProvidedStats(true); } catch (e) { log('sign stats failed', e); } };

  ctx.patch(Cartography, 'addProvidedStats').after(function () {
    try {
      const id = placedId();
      if (!L.signAdds(id, this.activeMap?.playerPosition?.pointOfInterest?.id)) return;
      const poi = poiById(id);
      if (poi === undefined || poi.activeStats?.hasStats !== true) return;
      this.providedStats.addStatObject(poi, poi.activeStats, 1, this.hasCarthuluPet ? 2 : 1);
    } catch (e) { log('sign buffs failed', e); }
  });

  const place = () => {
    if (action() !== 'place') return false;
    skill().record.sign = herePoi().id;
    log(`sign placed on ${skill().record.sign}`);
    recompute(); refreshMarker(); changed();
    return true;
  };
  const pickup = () => {
    if (action() !== 'pickup') return false;
    skill().record.sign = '';
    log('sign picked up');
    recompute(); refreshMarker(); changed();
    return true;
  };

  // A purchase of ours (land upgrade or sign) shows at once on the page and the panel, and a new mount reprices paths.
  ctx.patch(Shop, 'buyItemOnClick').after(function (_ret, p) {
    try { if (p?.namespace === 'voyage' && p.localID !== 'Wayfinder_Compass') changed(); } catch {}
  });

  // ---- the sign's marker -------------------------------------------------------------------------------------------
  let tex;
  let sprite;
  const refreshMarker = () => {
    try {
      if (typeof cartographyMap === 'undefined' || cartographyMap === null || tex === undefined) return;
      const layer = cartographyMap.markerLayer;
      const map = cartographyMap._lastDrawnMap ?? game.cartography?.activeMap;
      if (layer === undefined || map === undefined) return;
      const poi = poiById(placedId());
      if (sprite === undefined || sprite.destroyed) {
        sprite = new PIXI.Sprite(tex);
        sprite.anchor.set(0.5, 1);
        sprite.eventMode = 'none';
      }
      if (sprite.parent !== layer) layer.addChildAt(sprite, 0);
      const hexDisplay = poi === undefined ? undefined : cartographyMap.getHexDisplay(poi.hex);
      sprite.visible = hexDisplay !== undefined;
      if (!sprite.visible) return;
      // A little left of the hex centre, so the player figure standing on it does not hide it.
      const scale = (HexCoords.SQRT3 * map.hexScale.y) / tex.orig.height / 2.2;
      sprite.scale.set(scale);
      sprite.x = hexDisplay.x - tex.orig.width * scale * 0.45;
      sprite.y = hexDisplay.y;
    } catch (e) { log('sign marker failed', e); }
  };
  ctx.patch(WorldMapDisplayElement, 'movePlayerMarker').after(() => refreshMarker());
  ctx.onInterfaceReady(async () => {
    try {
      const img = new Image();
      img.src = ctx.getResourceUrl('assets/marker_crossroads_sign.webp');
      await img.decode();
      tex = PIXI.Texture.from(img);
      refreshMarker();
    } catch (e) { log('sign marker not loaded', e); }
  });
  ctx.onCharacterLoaded(() => { recompute(); });

  const api = {
    // land
    tier, mount: () => L.mountAt(tier()), next: () => L.nextMount(tier()), nameOf,
    mediaOf: (m) => ctx.getResourceUrl(m.media), isLand,
    /** The GP factor for one hex now (the trader's floor reads it). */
    gpFactor: (hex) => L.gpFactor(tier(), isLand(hex)),
    levelOf: (m) => m.level,
    // sign
    signOwned: () => enabled() && owned(L.SIGN.id),
    signPoi: () => poiById(placedId()),
    signAction: action, place, pickup,
    signName: () => purchase(L.SIGN.id)?.name ?? 'Crossroads Sign',
    signMedia: () => ctx.getResourceUrl('assets/crossroads_sign.webp'),
    /** The signed POI's buffs as the game writes them (coloured spans), or []. */
    signBuffSpans: () => { const p = poiById(placedId()); try { return p?.activeStats?.hasStats ? p.activeStats.describeAsSpans(1, posMult()) : []; } catch { return []; } },
    /** Opens the shop on the Voyage tab (the sign and the mounts are sold there). */
    openShop: () => {
      try {
        changePage(game.pages.getObjectByID('melvorD:Shop'), -1, undefined, false, false);
        const cat = game.shop.categories.getObjectByID('voyage:Voyage');
        if (cat !== undefined) shopMenu.showSingleTab(cat);
      } catch (e) { log('open shop failed', e); }
    },
    refreshMarker,
  };
  state.land = api;
  return api;
}
