// Terrain tint on the Cartography map. Patches the two getters the map uses for every hex background
// (both the initial draw and later updates go through them), so there is no timing to get right.
// Only fully surveyed hexes are tinted: vanilla fog stays intact.

const OVERLAY_ALPHA = 0.38;

export function install(ctx, { state, terrainMod, log }) {
  const tintFor = (hex) => {
    if (state.terrain === undefined || !state.settings.overlay()) return undefined;
    if (!hex.isFullySurveyed) return undefined;
    const rec = state.terrain.get(hex.q, hex.r);
    if (rec === undefined) return undefined;
    return terrainMod.CLASS_INFO[rec.t]?.colour;
  };

  ctx.patch(WorldMapDisplayElement, 'getHexBGColour').replace(function (original, map, hex) {
    try {
      const tint = tintFor(hex);
      if (tint !== undefined) return tint;
    } catch (e) { log('overlay colour failed open', e); }
    return original(map, hex);
  });
  ctx.patch(WorldMapDisplayElement, 'getHexBgAlpha').replace(function (original, hex) {
    try {
      if (tintFor(hex) !== undefined) return OVERLAY_ALPHA;
    } catch (e) { log('overlay alpha failed open', e); }
    return original(hex);
  });

  /** Redraws every hex background on the currently drawn map (after a settings change). */
  const refresh = () => {
    try {
      const map = game.cartography?.activeMap;
      if (map === undefined || typeof cartographyMap === 'undefined' || cartographyMap.lastDrawnMap !== map) return;
      cartographyMap.updateAllHexBackgrounds(map);
    } catch (e) { log('overlay refresh failed', e); }
  };
  state.listeners.push(refresh);
  return { refresh };
}
