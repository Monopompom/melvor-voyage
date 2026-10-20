// Folks walking alone on the map (phase 6d): for each walk, a boot badge on the hex the Folk has reached and its road
// still ahead as a dashed line to the place it was sent. Drawn as the route line is (route-line.mjs): one Container on
// the map's viewport, under the game's path arrows, redrawn when a Folk enters a hex or the map zooms. The map art is
// the same in every theme, so the colours are plain constants.

/** The road ahead: the route line's lamplight, with a dark edge, in dashes. */
const ROAD_COLOUR = 0xffd27a;
const ROAD_EDGE = 0x10202c;
/** Width on screen in pixels, never more than this share of the hex's radius; dashes in hex radii. */
const ROAD_WIDTH_PX = 5;
const ROAD_MAX_SHARE = 0.18;
const DASH = 0.16;
const GAP = 0.12;
/**
 * The badge: a dark disc with a lamplight ring and boot at the hex's upper right, sized as the Folks badge at its lower
 * right (overlay.mjs; the user, 20 Oct 2026): 11 px on screen, zoomed in 9% of the hex's height, never past 20%.
 */
const BADGE_RADIUS_PX = 11;
const BADGE_SHARE = 0.09;
const BADGE_MAX_SHARE = 0.2;
const BADGE_FILL = 0x14171b;

/** The boot, in a 24-unit box centred on 12,12: the shaft, the instep down to a round toe, the sole, the heel. */
const BOOT = [[7, 3], [13.5, 3], [13.5, 11], [16.5, 12], [19.5, 13.5], [21, 15.5], [21, 19], [6, 19], [6, 15], [7, 12]];
/** The sole's top edge, drawn in the badge's dark over the boot. */
const SOLE = [[6, 16.8], [21, 16.8]];

export function install(ctx, { state, C, log }) {
  let layer;
  let roads;
  let badges;
  let ticker;
  let drawnKey;
  let failed = false;

  const ensure = () => {
    if (typeof cartographyMap === 'undefined' || cartographyMap.viewport === undefined || typeof PIXI === 'undefined') return false;
    const vp = cartographyMap.viewport;
    if (layer === undefined || layer.destroyed) {
      layer = new PIXI.Container();
      layer.eventMode = 'none';
      roads = new PIXI.Graphics();
      badges = new PIXI.Graphics();
      layer.addChild(roads, badges);
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
  /** The line cut into dashes of `dash` with gaps of `gap` (map units), each drawn by `draw(piece)`. */
  const dashes = (pts, dash, gap, draw) => {
    const len = C.polyLength(pts);
    for (let d = 0; d < len; d += dash + gap) {
      const piece = C.polySlice(pts, d, Math.min(len, d + dash));
      if (piece.length > 1) draw(piece);
    }
  };
  const clear = () => { if (drawnKey !== null) { roads?.clear(); badges?.clear(); drawnKey = null; } };

  function frame() {
    if (failed) return;
    try {
      if (layer?.parent !== cartographyMap.viewport) ensure();
      const list = state.walks?.routes?.() ?? [];
      const map = game.cartography?.activeMap;
      if (list.length === 0 || map === undefined || cartographyMap.lastDrawnMap !== map) { clear(); return; }
      const vp = cartographyMap.viewport;
      const key = `${map.id}|${vp.scaled}|${list.map((w) => `${w.id}:${w.at.q},${w.at.r}:${w.ahead.length}`).join(';')}`;
      if (key === drawnKey) return;
      drawnKey = key;
      const origin = (h) => { const hex = map.getHex(new HexCoords(h.q, h.r)); return hex === undefined ? undefined : map.getHexOrigin(hex); };
      const points = cartographyMap.hexPolygon?.points ?? [];
      const unit = points.length > 0 ? Math.max(...points.map(Math.abs)) : 40;
      // The hex's box, as the Folks badge measures it.
      const xs = points.filter((_, i) => i % 2 === 0);
      const ys = points.filter((_, i) => i % 2 === 1);
      const box = xs.length === 0 ? { mid: { x: 0, y: 0 }, wide: 2 * unit, tall: 2 * unit }
        : { mid: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }, wide: Math.max(...xs) - Math.min(...xs), tall: Math.max(...ys) - Math.min(...ys) };
      const px = 1 / (vp.scaled || 1);
      const width = Math.min(ROAD_WIDTH_PX * px, unit * ROAD_MAX_SHARE);
      roads.clear();
      badges.clear();
      // Folks on the same hex share it: each badge a little further along.
      const onHex = new Map();
      for (const w of list) {
        const from = origin(w.at);
        if (from === undefined) continue;
        const pts = [from, ...w.ahead.map(origin).filter(Boolean)];
        if (pts.length > 1) {
          dashes(pts, unit * DASH, unit * GAP, (piece) => { roads.lineStyle(style(width + 2 * px, ROAD_EDGE, 0.55)); stroke(roads, piece); });
          dashes(pts, unit * DASH, unit * GAP, (piece) => { roads.lineStyle(style(width, ROAD_COLOUR, 0.95)); stroke(roads, piece); });
          const end = pts[pts.length - 1];
          roads.lineStyle(style(1.5 * px, ROAD_EDGE, 0.7));
          roads.beginFill(ROAD_COLOUR, 1).drawCircle(end.x, end.y, width * 1.2).endFill();
        }
        const k = `${w.at.q},${w.at.r}`;
        const n = onHex.get(k) ?? 0;
        onHex.set(k, n + 1);
        const r = Math.min(Math.max(BADGE_RADIUS_PX * px, box.tall * BADGE_SHARE), box.tall * BADGE_MAX_SHARE);
        const cx = from.x + box.mid.x + box.wide * 0.22 + n * r * 2.3;
        const cy = from.y + box.mid.y - box.tall * 0.22;
        badges.lineStyle({ width: 2.5 * (r / BADGE_RADIUS_PX), color: ROAD_COLOUR, alpha: 1, alignment: 1 });
        badges.beginFill(BADGE_FILL, 1).drawCircle(cx, cy, r).endFill();
        const s = (r * 1.25) / 24;
        badges.lineStyle(0);
        const at = ([x, y]) => ({ x: cx + (x - 12) * s, y: cy + (y - 12) * s });
        badges.beginFill(ROAD_COLOUR, 1).drawPolygon(BOOT.flatMap((pt) => { const o = at(pt); return [o.x, o.y]; })).endFill();
        badges.lineStyle(style(1.3 * s, BADGE_FILL, 1));
        stroke(badges, SOLE.map(at));
      }
    } catch (e) { failed = true; log('walk line failed', e); }
  }

  // The map's app may come after the mod loads: look for it until it is there, then the ticker does the rest.
  const look = () => { try { return ensure(); } catch (e) { log('walk line layer failed', e); return true; } };
  ctx.onInterfaceReady(() => {
    if (look()) return;
    const id = setInterval(() => { if (look()) clearInterval(id); }, 2000);
  });
  return { refresh: () => { drawnKey = undefined; look(); } };
}
