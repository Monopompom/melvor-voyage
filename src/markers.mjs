// Map markers: the game's red player pin is replaced by the traveller figure. Phase 3b adds the
// dinghy aboard and parked markers here.
//
// The pin is `cartographyMap.playerPin`, a PIXI.Sprite anchored at its bottom centre. The game sets its texture once
// (WorldMapDisplayElement.init) and scales it in configurePlayerPin(map) from the texture's height, so the mod swaps
// the texture just before that scale is computed. Our markers are 512 px tall like the vanilla pin, with the feet at
// the bottom centre. If the texture fails to load, the vanilla pin stays.

const LAND_MARKER = 'assets/marker_traveller_figure.png';

export function install(ctx, { log }) {
  let land;

  const currentMap = () => {
    try { return cartographyMap?._lastDrawnMap ?? game.cartography?.activeMap; } catch { return undefined; }
  };

  /** Puts the land texture on the pin and lets the game rescale it. */
  const apply = (display, map) => {
    if (land === undefined || display?.playerPin === undefined) return;
    if (display.playerPin.texture !== land) display.playerPin.texture = land;
    if (map !== undefined) display.configurePlayerPin(map);
  };

  ctx.patch(WorldMapDisplayElement, 'configurePlayerPin').before(function () {
    try { if (land !== undefined && this.playerPin !== undefined) this.playerPin.texture = land; } catch (e) { log('player marker failed', e); }
  });

  ctx.onInterfaceReady(async () => {
    try {
      // A plain image, not PIXI.Assets: mod resource URLs may carry no file extension, which Assets uses to pick a
      // loader. Decoded first, so the texture's height is known when the game scales the pin.
      const img = new Image();
      img.src = ctx.getResourceUrl(LAND_MARKER);
      await img.decode();
      land = PIXI.Texture.from(img);
      // The map may already be drawn with the vanilla pin.
      if (typeof cartographyMap !== 'undefined' && cartographyMap !== null) {
        const map = currentMap();
        if (map !== undefined && cartographyMap._lastDrawnMap !== undefined) apply(cartographyMap, map);
      }
      log('player marker loaded');
    } catch (e) {
      land = undefined;
      log('player marker not loaded; keeping the game pin', e);
    }
  });
}
