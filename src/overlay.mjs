// Terrain tint on the Cartography map. Patches the two getters the map uses for every hex background
// (both the initial draw and later updates go through them), so there is no timing to get right.
// Only fully surveyed hexes are tinted: vanilla fog stays intact. The journal's map marks are a border on top, drawn
// on any hex (the player has been there).

const OVERLAY_ALPHA = 0.38;
/**
 * The journal's "Show on map" (src/journal.mjs, state.mapMarks): a dark gold border inside the hex, so the land still
 * shows (the user, 16 Oct 2026: "not fill the whole hex but a border of 8-10px"). The width is in screen pixels.
 */
const MARK_COLOUR = 0xb8860b;
const MARK_WIDTH_PX = 9;
/** A mark never takes more than this share of the hex's radius, however far the map is zoomed out. */
const MARK_MAX_SHARE = 0.25;

export function install(ctx, { state, terrainMod, log }) {
  const tintFor = (hex) => {
    if (state.terrain === undefined || !state.settings.overlay()) return undefined;
    if (!hex.isFullySurveyed) return undefined;
    const rec = state.terrain.get(hex.q, hex.r);
    if (rec === undefined) return undefined;
    if (rec.cloud === true) return terrainMod.CLOUD_INFO.colour;
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
      // A sea chart or a rumour cleared the fog: the land shows, untinted until it is surveyed.
      if (state.charts?.cleared(hex)) return 0;
    } catch (e) { log('overlay alpha failed open', e); }
    return original(hex);
  });

  // ---- map marks: one Graphics on the map's viewport, just above the hexes and under the travel path ----
  let markLayer;
  let markTicker;
  let drawnScale;
  const unKey = (key) => { const r512 = ((key % 1024) + 1024) % 1024; return { q: (key - r512) / 1024, r: r512 - 512 }; };
  function drawMarks() {
    try {
      if (typeof cartographyMap === 'undefined' || cartographyMap.viewport === undefined || typeof PIXI === 'undefined') return;
      const vp = cartographyMap.viewport;
      if (markLayer === undefined || markLayer.destroyed) { markLayer = new PIXI.Graphics(); markLayer.eventMode = 'none'; }
      if (markLayer.parent !== vp) {
        const below = vp.children.indexOf(cartographyMap.hexLayer);
        if (below >= 0) vp.addChildAt(markLayer, below + 1); else vp.addChild(markLayer);
      }
      // Kept at about MARK_WIDTH_PX on screen: redrawn when the zoom changes (wheel, the zoom buttons' animation and
      // the game's own camera moves all zoom differently, so the scale is compared each frame; cheap without marks).
      const ticker = cartographyMap.app?.ticker;
      if (ticker !== undefined && markTicker !== ticker) {
        ticker.add(() => { if (state.mapMarks?.size > 0 && cartographyMap.viewport?.scaled !== drawnScale) drawMarks(); });
        markTicker = ticker;
      }
      drawnScale = vp.scaled;
      markLayer.clear();
      const map = game.cartography?.activeMap;
      if (!(state.mapMarks?.size > 0) || map === undefined || cartographyMap.lastDrawnMap !== map) return;
      const points = cartographyMap.hexPolygon?.points;
      if (points === undefined || points.length === 0) return;
      const radius = Math.max(...points.map(Math.abs));
      const width = Math.min(MARK_WIDTH_PX / (vp.scaled || 1), radius * MARK_MAX_SHARE);
      markLayer.lineStyle({ width, color: MARK_COLOUR, alpha: 1, alignment: 0 });
      for (const key of state.mapMarks) {
        const { q, r } = unKey(key);
        const hex = map.getHex(new HexCoords(q, r));
        if (hex === undefined) continue;
        const o = map.getHexOrigin(hex);
        markLayer.drawPolygon(points.map((v, i) => v + (i % 2 === 0 ? o.x : o.y)));
      }
    } catch (e) { log('map marks failed', e); }
  }

  /** Redraws every hex background on the currently drawn map (after a settings change), and the marks. */
  const refresh = () => {
    try {
      const map = game.cartography?.activeMap;
      if (map === undefined || typeof cartographyMap === 'undefined' || cartographyMap.lastDrawnMap !== map) return;
      cartographyMap.updateAllHexBackgrounds(map);
    } catch (e) { log('overlay refresh failed', e); }
    drawMarks();
  };
  state.listeners.push(refresh);
  return { refresh };
}
