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
    if (rec.ice === true) return terrainMod.ICE_INFO.colour;
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

  // ---- storms (phase 5c-3): their cells over the hexes, on any hex (weather is seen from afar), above the marks ----
  const STORM_ALPHA = 0.42;
  let stormLayer;
  /** The bolts go on top of the hexes' icons, in the upper half of each storm's centre hex. */
  let boltLayer;
  let stormTicker;
  let stormDrawn;
  function drawStorms() {
    try {
      if (typeof cartographyMap === 'undefined' || cartographyMap.viewport === undefined || typeof PIXI === 'undefined') return;
      const vp = cartographyMap.viewport;
      if (stormLayer === undefined || stormLayer.destroyed) { stormLayer = new PIXI.Graphics(); stormLayer.eventMode = 'none'; }
      if (stormLayer.parent !== vp) {
        const below = vp.children.indexOf(cartographyMap.hexLayer);
        if (below >= 0) vp.addChildAt(stormLayer, below + 1); else vp.addChild(stormLayer);
      }
      if (boltLayer === undefined || boltLayer.destroyed) { boltLayer = new PIXI.Graphics(); boltLayer.eventMode = 'none'; }
      if (boltLayer.parent !== vp || vp.children[vp.children.length - 1] !== boltLayer) vp.addChild(boltLayer);
      // Checked each frame, redrawn only when the storms move, the zoom changes (the edge's width) or the map does.
      const ticker = cartographyMap.app?.ticker;
      if (ticker !== undefined && stormTicker !== ticker) {
        ticker.add(() => {
          const key = `${state.weather?.stormKey?.() ?? ''}|${cartographyMap.viewport?.scaled}|${game.cartography?.activeMap?.id}`;
          if (key !== stormDrawn) drawStorms();
        });
        stormTicker = ticker;
      }
      const map = game.cartography?.activeMap;
      stormDrawn = `${state.weather?.stormKey?.() ?? ''}|${vp.scaled}|${map?.id}`;
      stormLayer.clear();
      boltLayer.clear();
      if (map === undefined || cartographyMap.lastDrawnMap !== map || state.weather?.stormsOn?.() !== true) return;
      const storms = state.weather.stormsAt(state.clockNow?.() ?? Date.now());
      if (storms.length === 0) return;
      const points = cartographyMap.hexPolygon?.points;
      if (points === undefined || points.length === 0) return;
      const xs = points.filter((_, i) => i % 2 === 0);
      const ys = points.filter((_, i) => i % 2 === 1);
      // The polygon's points are from the hex's origin (its box's corner): the centre is the middle of the box.
      const mid = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
      const tall = Math.max(...ys) - Math.min(...ys);
      const info = terrainMod.STORM_INFO;
      const edge = Math.min(4 / (vp.scaled || 1), tall * 0.05);
      for (const st of storms) {
        stormLayer.lineStyle({ width: edge, color: info.edge, alpha: 0.85, alignment: 0 });
        for (const h of st.cells) {
          const hex = map.getHex(new HexCoords(h.q, h.r));
          if (hex === undefined) continue;
          const o = map.getHexOrigin(hex);
          stormLayer.beginFill(info.colour, STORM_ALPHA);
          stormLayer.drawPolygon(points.map((v, i) => v + (i % 2 === 0 ? o.x : o.y)));
          stormLayer.endFill();
        }
        // A bolt on the centre (or the first cell left when the centre is land or shelter).
        const c = st.cells.find((h) => h.q === st.q && h.r === st.r) ?? st.cells[0];
        const hex = map.getHex(new HexCoords(c.q, c.r));
        if (hex === undefined) continue;
        const o = map.getHexOrigin(hex);
        // A bolt about a sixth of the hex tall, in its upper half, clear of the hex's own icon in the middle.
        const k = tall * 0.09;
        const cx = o.x + mid.x;
        const cy = o.y + mid.y - tall * 0.3;
        const bolt = [0.15, -1, -0.45, 0.1, 0, 0.1, -0.2, 1, 0.5, -0.15, 0.05, -0.15, 0.35, -1];
        boltLayer.lineStyle({ width: k * 0.18, color: 0x1b1f24, alpha: 0.9, alignment: 1 });
        boltLayer.beginFill(info.edge, 1);
        boltLayer.drawPolygon(bolt.map((v, i) => v * k + (i % 2 === 0 ? cx : cy)));
        boltLayer.endFill();
      }
    } catch (e) { log('storm layer failed', e); }
  }

  // ---- Worker Folks (phase 6b): a badge with the count on each hex where Folks stand, at the hex's lower right ----
  // Dark with a light green ring: it reads on grass, sand and sea alike.
  const FOLK_FILL = 0x14171b;
  const FOLK_EDGE = 0x74d394;
  /** The badge's smallest radius and count size in screen pixels; zoomed in it grows to FOLK_SHARE of the hex, never past FOLK_MAX_SHARE. */
  const FOLK_RADIUS_PX = 11;
  const FOLK_FONT_PX = 13;
  const FOLK_SHARE = 0.09;
  const FOLK_MAX_SHARE = 0.2;
  let folkLayer;
  let folkTicker;
  let folkDrawn;
  /** Bumped when a Folk moves, joins or leaves (gate.mjs listens to Worker Folks); part of the redraw key. */
  let folkStamp = 0;
  // The map's own draw counts too: a first call before the map is drawn would otherwise never be redone.
  const folkKey = (vp, map) => `${folkStamp}|${vp?.scaled}|${map?.id}|${cartographyMap.lastDrawnMap === map}|${state.active?.()}|${state.folksGuarded === true}`;
  function drawFolks() {
    try {
      if (typeof cartographyMap === 'undefined' || cartographyMap.viewport === undefined || typeof PIXI === 'undefined') return;
      const vp = cartographyMap.viewport;
      if (folkLayer === undefined || folkLayer.destroyed) { folkLayer = new PIXI.Container(); folkLayer.eventMode = 'none'; }
      // Under the game's markers (the player figure), over the hexes, marks and storms.
      const pins = cartographyMap.markerLayer;
      if (folkLayer.parent !== vp || (pins?.parent === vp && vp.children.indexOf(folkLayer) > vp.children.indexOf(pins))) {
        if (pins?.parent === vp) vp.addChildAt(folkLayer, vp.children.indexOf(pins)); else vp.addChild(folkLayer);
      }
      const ticker = cartographyMap.app?.ticker;
      if (ticker !== undefined && folkTicker !== ticker) {
        ticker.add(() => { if (folkKey(cartographyMap.viewport, game.cartography?.activeMap) !== folkDrawn) drawFolks(); });
        folkTicker = ticker;
      }
      const map = game.cartography?.activeMap;
      folkDrawn = folkKey(vp, map);
      for (const child of folkLayer.removeChildren()) child.destroy();
      if (map === undefined || cartographyMap.lastDrawnMap !== map || !state.active?.() || !state.folksGuarded) return;
      const counts = new Map();
      for (const f of state.folksApi?.()?.folks() ?? []) {
        if (f.place === null || f.travel !== 'idle') continue;
        const key = `${f.place.q},${f.place.r}`;
        counts.set(key, { q: f.place.q, r: f.place.r, n: (counts.get(key)?.n ?? 0) + 1 });
      }
      if (counts.size === 0) return;
      const points = cartographyMap.hexPolygon?.points;
      if (points === undefined || points.length === 0) return;
      const xs = points.filter((_, i) => i % 2 === 0);
      const ys = points.filter((_, i) => i % 2 === 1);
      const mid = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
      const wide = Math.max(...xs) - Math.min(...xs);
      const tall = Math.max(...ys) - Math.min(...ys);
      const radius = Math.min(Math.max(FOLK_RADIUS_PX / (vp.scaled || 1), tall * FOLK_SHARE), tall * FOLK_MAX_SHARE);
      const k = radius / FOLK_RADIUS_PX;
      const dots = new PIXI.Graphics();
      folkLayer.addChild(dots);
      for (const { q, r, n } of counts.values()) {
        const hex = map.getHex(new HexCoords(q, r));
        if (hex === undefined) continue;
        const o = map.getHexOrigin(hex);
        const cx = o.x + mid.x + wide * 0.22;
        const cy = o.y + mid.y + tall * 0.22;
        dots.lineStyle({ width: 2.5 * k, color: FOLK_EDGE, alpha: 1, alignment: 1 });
        dots.beginFill(FOLK_FILL, 1);
        dots.drawCircle(cx, cy, FOLK_RADIUS_PX * k);
        dots.endFill();
        // The count is drawn at (at least) its screen size and scaled down, so it stays sharp at any zoom.
        const sharp = Math.max(2, Math.ceil((vp.scaled || 1) * k * 2));
        const text = new PIXI.Text(`${n}`, { fontFamily: 'Arial', fontSize: FOLK_FONT_PX * sharp, fontWeight: '700', fill: 0xffffff });
        text.anchor.set(0.5, 0.5);
        text.scale.set(k / sharp);
        text.position.set(cx, cy);
        folkLayer.addChild(text);
      }
    } catch (e) { log('folk badges failed', e); }
  }
  const folksChanged = () => { folkStamp += 1; };

  /** Redraws every hex background on the currently drawn map (after a settings change), and the marks. */
  const refresh = () => {
    try {
      const map = game.cartography?.activeMap;
      if (map === undefined || typeof cartographyMap === 'undefined' || cartographyMap.lastDrawnMap !== map) return;
      cartographyMap.updateAllHexBackgrounds(map);
    } catch (e) { log('overlay refresh failed', e); }
    drawMarks();
    drawStorms();
    drawFolks();
  };
  state.listeners.push(refresh);
  return { refresh, drawStorms, drawFolks, folksChanged };
}
