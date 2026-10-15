// Map markers: the game's red player pin becomes the traveller figure on land and the dinghy with
// its rower while aboard; a dinghy you stepped off is drawn moored on its hex.
//
// The pin is `cartographyMap.playerPin`, a PIXI.Sprite anchored at its bottom centre. The game sets its texture once
// (WorldMapDisplayElement.init) and scales it in configurePlayerPin(map) from the texture's height, so the mod swaps
// the texture just before that scale is computed. Our markers are 512 px tall like the vanilla pin, with the base at
// the bottom centre. The moored dinghy is a second sprite in the same marker layer, under the pin, scaled the same
// way. If a texture fails to load, the vanilla pin stays (and no moored marker is drawn).

const TEXTURES = {
  land: 'assets/marker_traveller_figure.png',
  aboard: 'assets/marker_dinghy_aboard.png',
  parked: 'assets/marker_dinghy_parked.png',
};

export function install(ctx, { state, log }) {
  const tex = {};
  let parked;

  const drawn = () => {
    try { return typeof cartographyMap !== 'undefined' && cartographyMap !== null ? cartographyMap._lastDrawnMap : undefined; } catch { return undefined; }
  };
  const pinTexture = () => (state.ship?.aboard() && tex.aboard !== undefined ? tex.aboard : tex.land);

  /** The moored dinghy: shown on the ship's hex while you are not aboard and the player marker filter is on. */
  const placeParked = (display, map) => {
    if (tex.parked === undefined || display?.markerLayer === undefined) return;
    if (parked === undefined || parked.destroyed) {
      parked = new PIXI.Sprite(tex.parked);
      parked.anchor.set(0.5, 1);
      parked.eventMode = 'none';
    }
    if (parked.parent !== display.markerLayer) {
      const at = display.markerLayer.getChildIndex(display.playerPin);
      display.markerLayer.addChildAt(parked, Math.max(0, at));
    }
    const ship = state.ship?.ship();
    const hexDisplay = ship ? display.getHexDisplay(ship) : undefined;
    const show = ship != null && hexDisplay !== undefined && !state.ship.aboard() && state.ship.enabled() && display.playerPin.visible;
    parked.visible = show;
    if (!show) return;
    parked.x = hexDisplay.x;
    parked.y = hexDisplay.y;
    parked.scale.set((HexCoords.SQRT3 * map.hexScale.y) / tex.parked.orig.height / 2);
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
    placeParked(cartographyMap, map);
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
  return { refresh };
}
