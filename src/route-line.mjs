// The route line on the map (build .272): while a voyage runs, a line from you through the hexes still to sail to the
// destination, a light running along it toward the end, and the walked part kept as a dim line behind you (the user,
// 19 Oct 2026). The split and the polyline maths are in clock-model.mjs (routeParts, polySlice); this file draws.
// One Container on the map's viewport, just under the game's own path arrows and above the hexes and the journal marks.
// The map art is the same in every theme, so the colours are plain constants, as overlay.mjs's MARK_COLOUR.

/** The line still to sail: warm lamplight, with a dark edge so it reads on sea, sand and snow alike. */
const ROUTE_COLOUR = 0xffd27a;
const ROUTE_EDGE = 0x10202c;
/** The walked part: the same colour, thinner and dim. */
const WALKED_ALPHA = 0.4;
/** Width on screen in pixels; never more than this share of the hex's radius when the map is zoomed far out. */
const ROUTE_WIDTH_PX = 9;
const ROUTE_MAX_SHARE = 0.3;
/** The running light: its length and speed in hex radii, so it keeps pace with the map at any zoom. */
const LIGHT_LEN = 1.6;
const LIGHT_SPEED = 3.2;

export function install(ctx, { state, C, log }) {
  let layer;
  let line;
  let light;
  let ticker;
  let drawnKey;
  let ahead = [];
  let unit = 1;
  let width = 1;
  let failed = false;
  const still = () => { try { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true; } catch { return false; } };

  const ensure = () => {
    if (typeof cartographyMap === 'undefined' || cartographyMap.viewport === undefined || typeof PIXI === 'undefined') return false;
    const vp = cartographyMap.viewport;
    if (layer === undefined || layer.destroyed) {
      layer = new PIXI.Container();
      layer.eventMode = 'none';
      line = new PIXI.Graphics();
      light = new PIXI.Graphics();
      layer.addChild(line, light);
      drawnKey = undefined;
    }
    if (layer.parent !== vp) {
      const under = vp.children.indexOf(cartographyMap.pathLayer);
      if (under >= 0) vp.addChildAt(layer, under); else vp.addChild(layer);
    }
    const tk = cartographyMap.app?.ticker;
    if (tk !== undefined && tk !== ticker) { tk.add(frame); ticker = tk; }
    return true;
  };

  const style = (w, colour, alpha) => ({ width: w, color: colour, alpha, cap: PIXI.LINE_CAP?.ROUND ?? 'round', join: PIXI.LINE_JOIN?.ROUND ?? 'round' });
  const stroke = (g, pts) => { g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y); };

  const clear = () => { if (drawnKey !== null) { line?.clear(); light?.clear(); drawnKey = null; ahead = []; } };

  function frame() {
    if (failed) return;
    try {
      if (layer?.parent !== cartographyMap.viewport) ensure();
      const route = state.clock?.route?.();
      const map = game.cartography?.activeMap;
      if (route == null || map === undefined || cartographyMap.lastDrawnMap !== map) { clear(); return; }
      const vp = cartographyMap.viewport;
      const key = `${map.id}|${vp.scaled}|${route.behind.length}|${route.ahead.length}|${route.ahead[route.ahead.length - 1].q},${route.ahead[route.ahead.length - 1].r}`;
      if (key !== drawnKey) {
        drawnKey = key;
        const at = (h) => { const hex = map.getHex(new HexCoords(h.q, h.r)); return hex === undefined ? undefined : map.getHexOrigin(hex); };
        const behind = route.behind.map(at).filter(Boolean);
        ahead = route.ahead.map(at).filter(Boolean);
        const points = cartographyMap.hexPolygon?.points ?? [];
        unit = points.length > 0 ? Math.max(...points.map(Math.abs)) : 40;
        width = Math.min(ROUTE_WIDTH_PX / (vp.scaled || 1), unit * ROUTE_MAX_SHARE);
        line.clear();
        if (behind.length > 1) { line.lineStyle(style(width * 0.7, ROUTE_COLOUR, WALKED_ALPHA)); stroke(line, behind); }
        if (ahead.length > 1) {
          line.lineStyle(style(width + 3 / (vp.scaled || 1), ROUTE_EDGE, 0.55)); stroke(line, ahead);
          line.lineStyle(style(width, ROUTE_COLOUR, 0.95)); stroke(line, ahead);
          const end = ahead[ahead.length - 1];
          line.lineStyle(style(1.5 / (vp.scaled || 1), ROUTE_EDGE, 0.7));
          line.beginFill(ROUTE_COLOUR, 1).drawCircle(end.x, end.y, width * 1.3).endFill();
        }
      }
      light.clear();
      if (ahead.length < 2 || still()) return;
      const len = C.polyLength(ahead);
      const lit = unit * LIGHT_LEN;
      const d = ((performance.now() / 1000) * unit * LIGHT_SPEED) % (len + lit);
      const piece = C.polySlice(ahead, d - lit, d);
      if (piece.length < 2) return;
      light.lineStyle(style(width * 0.75, 0xffffff, 0.85));
      stroke(light, piece);
    } catch (e) { failed = true; log('route line failed', e); }
  }

  // The map's app may come after the mod loads: look for it until it is there, then the ticker does the rest.
  const look = () => { try { return ensure(); } catch (e) { log('route line layer failed', e); return true; } };
  ctx.onInterfaceReady(() => {
    if (look()) return;
    const id = setInterval(() => { if (look()) clearInterval(id); }, 2000);
  });
  return { refresh: () => { drawnKey = undefined; look(); } };
}
