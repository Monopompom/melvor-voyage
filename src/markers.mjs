// Map markers: the game's red player pin becomes the traveller figure on land and the vessel you are in
// (dinghy or longboat with its rower, the brig under sail) while aboard; a vessel you stepped off is drawn moored on
// its hex (the boat beached, the brig at anchor or at the quay). The boat aboard the brig is not drawn, so up to three
// markers show: you, the boat, the brig (two vessels, build .150).
//
// The pin is `cartographyMap.playerPin`, a PIXI.Sprite anchored at its bottom centre. The game sets its texture once
// (WorldMapDisplayElement.init) and scales it in configurePlayerPin(map) from the texture's height, so the mod swaps
// the texture just before that scale is computed. Our markers are 384 px tall with the base at the bottom centre (the
// vanilla pin is 512; at full zoom the game draws it about 167 CSS px tall, so 384 stays sharp on a 2x screen). The
// moored dinghy is a second sprite in the same marker layer, under the pin, scaled the same way. If a texture fails
// to load, the vanilla pin stays (and no moored marker is drawn).
//
// Cairns (round 5): a small pile of stones on the hex where a Folk fell, at the middle of the hex's right edge: the
// corners hold the Crossroads Sign (upper left), a walker's boot (upper right), the tent (lower left) and the Folks
// badge (lower right), and your own marker stands in the middle (.711 check: at the lower left the tent hid it). A red
// pennant on it while a band guards it. Drawn with PIXI.Graphics (no texture to load), in the
// same marker layer under the pin, shown with the player marker filter like the moored vessels.

const TEXTURES = {
  land: 'assets/marker_traveller_figure.webp',
  'dinghy.aboard': 'assets/marker_dinghy_aboard.webp',
  'dinghy.parked': 'assets/marker_dinghy_parked.webp',
  'longboat.aboard': 'assets/marker_longboat_aboard.webp',
  'longboat.parked': 'assets/marker_longboat_parked.webp',
  'brig.aboard': 'assets/marker_brig_aboard.webp',
  'brig.parked': 'assets/marker_brig_parked.webp',
  'galleon.aboard': 'assets/marker_galleon_aboard.webp',
  'galleon.parked': 'assets/marker_galleon_parked.webp',
};

export function install(ctx, { state, log }) {
  const tex = {};
  /** The moored sprites, one per vessel kind ('boat', 'ship'). */
  const parked = {};

  // The map being drawn. loadWorldMap moves the pin before it sets `_lastDrawnMap`, so on the first draw the active
  // map stands in; without it the moored dinghy stayed hidden until the first move (build .82, user report).
  const drawn = () => {
    try {
      if (typeof cartographyMap === 'undefined' || cartographyMap === null) return undefined;
      return cartographyMap._lastDrawnMap ?? game.cartography?.activeMap;
    } catch { return undefined; }
  };
  /**
   * A vessel's own texture for `look` ('aboard' or 'parked'); when its hull has none (it failed to load), the brig's for
   * a big ship and the dinghy's for a small boat.
   */
  const hullTex = (v, look) => tex[`${v?.hull}.${look}`] ?? tex[`${v?.hull === 'brig' || v?.hull === 'galleon' ? 'brig' : 'dinghy'}.${look}`];
  const pinTexture = () => {
    const kind = state.ship?.inVessel?.();
    const want = kind === undefined ? undefined : hullTex(state.ship.vessel(kind), 'aboard');
    return want ?? tex.land;
  };

  /**
   * A moored vessel: shown on its hex while you are not in it and the player marker filter is on. The boat aboard
   * the big ship is not drawn.
   */
  const placeParked = (display, map, kind) => {
    const v = state.ship?.vessel?.(kind);
    const want = v == null ? undefined : hullTex(v, 'parked');
    if (display?.markerLayer === undefined) return;
    let sprite = parked[kind];
    if (want === undefined) { if (sprite !== undefined && !sprite.destroyed) sprite.visible = false; return; }
    if (sprite === undefined || sprite.destroyed) {
      sprite = new PIXI.Sprite(want);
      sprite.anchor.set(0.5, 1);
      sprite.eventMode = 'none';
      parked[kind] = sprite;
    }
    if (sprite.texture !== want) sprite.texture = want; // the hull was upgraded
    if (sprite.parent !== display.markerLayer) {
      const at = display.markerLayer.getChildIndex(display.playerPin);
      display.markerLayer.addChildAt(sprite, Math.max(0, at));
    }
    const hexDisplay = display.getHexDisplay(v);
    // With the Voyage rules off too (1.8.1, a player's report: the galleon "pins at the last port but is not visible"):
    // the vessel is still yours, its block and Show on map point at it, so the map shows where it lies.
    const show = hexDisplay !== undefined && v.aboard !== true && state.ship.inVessel() !== kind && display.playerPin.visible;
    sprite.visible = show;
    if (!show) return;
    sprite.x = hexDisplay.x;
    sprite.y = hexDisplay.y;
    sprite.scale.set((HexCoords.SQRT3 * map.hexScale.y) / want.orig.height / 2);
  };

  /** The cairn markers drawn, by cairn id: { g, guarded }. */
  const cairnMarks = new Map();
  /** Drawn 100 units tall, base at (0, 0); scaled to the hex where placed. */
  const CAIRN_H = 100;
  const drawCairn = (guarded) => {
    const g = new PIXI.Graphics();
    g.eventMode = 'none';
    const stone = (x, y, rx, ry, fill) => g.lineStyle(5, 0x24262b, 1).beginFill(fill, 1).drawEllipse(x, y, rx, ry).endFill();
    g.lineStyle(0).beginFill(0x000000, 0.28).drawEllipse(0, -6, 50, 12).endFill();
    stone(0, -24, 42, 21, 0x7d838b);
    stone(-4, -55, 31, 16, 0x9aa0a8);
    stone(3, -80, 19, 11, 0xb8bdc3);
    if (guarded) {
      g.lineStyle(5, 0x24262b, 1).moveTo(14, -86).lineTo(14, -CAIRN_H - 30);
      g.lineStyle(4, 0x24262b, 1).beginFill(0xc0392b, 1).drawPolygon([14, -CAIRN_H - 30, 52, -CAIRN_H - 20, 14, -CAIRN_H - 10]).endFill();
    }
    return g;
  };
  const placeCairns = (display, map) => {
    if (display?.markerLayer === undefined) return;
    const cairns = state.folksGuarded === true ? (state.cairns?.all?.() ?? []) : [];
    const ids = new Set(cairns.map((c) => c.id));
    for (const [id, m] of cairnMarks) {
      if (!ids.has(id) || m.g.destroyed) { try { if (!m.g.destroyed) m.g.destroy(); } catch {} cairnMarks.delete(id); }
    }
    for (const c of cairns) {
      const guarded = c.guard !== undefined;
      let m = cairnMarks.get(c.id);
      if (m !== undefined && m.guarded !== guarded) { try { m.g.destroy(); } catch {} m = undefined; }
      if (m === undefined) { m = { g: drawCairn(guarded), guarded }; cairnMarks.set(c.id, m); }
      if (m.g.parent !== display.markerLayer) {
        const at = display.markerLayer.getChildIndex(display.playerPin);
        display.markerLayer.addChildAt(m.g, Math.max(0, at));
      }
      const hexDisplay = display.getHexDisplay(c);
      const show = hexDisplay !== undefined && display.playerPin.visible;
      m.g.visible = show;
      if (!show) continue;
      // Between the two right-hand badges (their centres 0.22 of the hex's width and height off the middle, radius 0.09
      // of its height): the stones a fifth of the hex tall, their base a tenth below the middle.
      const tall = HexCoords.SQRT3 * map.hexScale.y;
      m.g.scale.set((tall * 0.2) / CAIRN_H);
      m.g.x = hexDisplay.x + 2 * map.hexScale.x * 0.38;
      m.g.y = hexDisplay.y + tall * 0.1;
    }
  };

  /** Puts the right texture on the pin, lets the game rescale it, and places the moored dinghy. */
  const refresh = () => {
    const map = drawn();
    if (map === undefined || cartographyMap.playerPin === undefined) return;
    const want = pinTexture();
    if (want !== undefined && cartographyMap.playerPin.texture !== want) {
      cartographyMap.playerPin.texture = want;
      cartographyMap.configurePlayerPin(map);
    }
    placeParked(cartographyMap, map, 'ship');
    placeParked(cartographyMap, map, 'boat');
    try { placeCairns(cartographyMap, map); } catch (e) { log('cairn markers failed', e); }
  };

  ctx.patch(WorldMapDisplayElement, 'configurePlayerPin').before(function () {
    try { const want = pinTexture(); if (want !== undefined && this.playerPin !== undefined) this.playerPin.texture = want; } catch (e) { log('player marker failed', e); }
  });
  // The game moves the pin after every move and redraw; the moored dinghy and the pin's texture follow it.
  ctx.patch(WorldMapDisplayElement, 'movePlayerMarker').after(function () {
    try { refresh(); } catch (e) { log('ship marker failed', e); }
  });
  ctx.patch(WorldMapDisplayElement, 'togglePlayerMarker').after(function () {
    try { refresh(); } catch (e) { log('ship marker failed', e); }
  });

  const load = async (path) => {
    // A plain image, not PIXI.Assets: mod resource URLs may carry no file extension, which Assets uses to pick a
    // loader. Decoded first, so the texture's height is known when the game scales the pin.
    const img = new Image();
    img.src = ctx.getResourceUrl(path);
    await img.decode();
    return PIXI.Texture.from(img);
  };

  ctx.onInterfaceReady(async () => {
    for (const [key, path] of Object.entries(TEXTURES)) {
      try { tex[key] = await load(path); } catch (e) { tex[key] = undefined; log(`marker ${key} not loaded`, e); }
    }
    log(`markers loaded: ${Object.keys(tex).filter((k) => tex[k] !== undefined).join(', ') || 'none; keeping the game pin'}`);
    // The map may already be drawn with the vanilla pin.
    try { refresh(); } catch (e) { log('marker refresh failed', e); }
  });

  state.ship?.onChange(() => { try { refresh(); } catch (e) { log('marker refresh failed', e); } });
  /** For voyageDev.marker(): what the moored-vessel sprites are doing right now. */
  const debug = () => {
    const map = drawn();
    const one = (kind) => {
      const v = state.ship?.vessel?.(kind);
      const hexDisplay = v && typeof cartographyMap !== 'undefined' ? cartographyMap?.getHexDisplay?.(v) : undefined;
      const sprite = parked[kind];
      return {
        vessel: v ?? null,
        hexDisplay: hexDisplay ? { x: hexDisplay.x, y: hexDisplay.y } : undefined,
        sprite: sprite === undefined ? 'never made' : {
          destroyed: sprite.destroyed,
          inMarkerLayer: !sprite.destroyed && sprite.parent === cartographyMap?.markerLayer,
          visible: sprite.visible, x: sprite.x, y: sprite.y, scale: sprite.scale?.x, alpha: sprite.alpha,
        },
      };
    };
    return {
      textures: Object.fromEntries(Object.keys(TEXTURES).map((k) => [k, tex[k] !== undefined])),
      mapDrawn: map !== undefined,
      inVessel: state.ship?.inVessel?.(),
      rules: state.ship?.enabled(),
      playerPinVisible: cartographyMap?.playerPin?.visible,
      boat: one('boat'),
      ship: one('ship'),
      cairns: [...cairnMarks].map(([id, m]) => ({ id, guarded: m.guarded, visible: m.g.visible, x: m.g.x, y: m.g.y, scale: m.g.scale?.x })),
    };
  };
  return { refresh, debug };
}
