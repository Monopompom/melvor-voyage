// The Captain's Journal's heat map (build .114, the user's ask): a fullscreen map of one resource that can be dragged
// and zoomed. The hexes where it was found glow hot, the ones where its zone said no show cold, over the land colours.
// It shows only what the journal knows, so the zones stay unspoiled. Drawn on a 2D canvas, every hex
// as a vector each frame (944 hexes), so it stays sharp at any zoom; the glow is one image made when it opens.
// The layout helpers at the top are pure, for tests/heatmap.test.mjs.

/**
 * The game's hex layout (cartographyMenu.js getHexOrigin, v1.3.1): flat-topped hexes in columns. One row is 1 world
 * unit; columns are 309.28 / 333.33 of that apart, and each column sits half a row lower than the one before.
 */
export const COL = 309.2783505154639 / 333.3333333333333;
/** A hex's width in world units (its columns overlap by a quarter). */
export const HEX_W = COL / 0.75;
export const center = (q, r) => ({ x: q * COL, y: r + q / 2 });
/** The six corners of a flat-topped hex around (cx, cy), one row tall. */
export const corners = (cx, cy) => [
  [cx - HEX_W / 2, cy], [cx - HEX_W / 4, cy - 0.5], [cx + HEX_W / 4, cy - 0.5],
  [cx + HEX_W / 2, cy], [cx + HEX_W / 4, cy + 0.5], [cx - HEX_W / 4, cy + 0.5],
];
/** The hex whose centre is nearest to a world point. */
export function hexAt(x, y) {
  const q0 = Math.round(x / COL);
  let best;
  for (let q = q0 - 1; q <= q0 + 1; q++) {
    const r0 = Math.round(y - q / 2);
    for (let r = r0 - 1; r <= r0 + 1; r++) {
      const c = center(q, r);
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (best === undefined || d < best.d) best = { q, r, d };
    }
  }
  return { q: best.q, r: best.r };
}
/** World bounds of a set of hexes, with `pad` world units round them. */
export function bounds(hexes, pad = 0.6) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const h of hexes) {
    const c = center(h.q, h.r);
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX: minX - pad - HEX_W / 2, minY: minY - pad - 0.5, maxX: maxX + pad + HEX_W / 2, maxY: maxY + pad + 0.5 };
}
/** The view `{ x, y, s }` (screen = world * s + (x, y)) that fits bounds `b` into a w x h screen. */
export function fit(b, w, h, margin = 16) {
  const s = Math.max(1e-3, Math.min((w - 2 * margin) / (b.maxX - b.minX), (h - 2 * margin) / (b.maxY - b.minY)));
  return { s, x: (w - (b.maxX - b.minX) * s) / 2 - b.minX * s, y: (h - (b.maxY - b.minY) * s) / 2 - b.minY * s };
}
/** Zooms by `factor`, keeping the screen point (sx, sy) where it is; the scale stays within [min, max]. */
export function zoomAt(view, sx, sy, factor, min, max) {
  const s = Math.min(max, Math.max(min, view.s * factor));
  const k = s / view.s;
  return { s, x: sx - (sx - view.x) * k, y: sy - (sy - view.y) * k };
}

const GLOW_PX = 24; // glow image pixels per world unit
const GLOW_RADIUS = 2.4; // world units round each find
const ZOOM_MAX = 10; // times the whole-map scale

export function install(ctx, { state, terrainMod, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const icon = (d) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">${d}</svg>`;
  let current; // the open map, or undefined

  /** The glow: finds as warm light, built once per opening (alpha builds up, then a heat palette colours it). */
  const makeGlow = (found, b) => {
    const w = Math.max(1, Math.ceil((b.maxX - b.minX) * GLOW_PX));
    const h = Math.max(1, Math.ceil((b.maxY - b.minY) * GLOW_PX));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    for (const f of found) {
      const c = center(f.q, f.r);
      const x = (c.x - b.minX) * GLOW_PX;
      const y = (c.y - b.minY) * GLOW_PX;
      const rad = g.createRadialGradient(x, y, 0, x, y, GLOW_RADIUS * GLOW_PX);
      rad.addColorStop(0, 'rgba(0,0,0,0.55)');
      rad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rad;
      g.fillRect(x - GLOW_RADIUS * GLOW_PX, y - GLOW_RADIUS * GLOW_PX, 2 * GLOW_RADIUS * GLOW_PX, 2 * GLOW_RADIUS * GLOW_PX);
    }
    // Palette: faint yellow at the edge, orange, then deep red where finds crowd together.
    const pal = document.createElement('canvas');
    pal.width = 256; pal.height = 1;
    const p = pal.getContext('2d');
    const lin = p.createLinearGradient(0, 0, 256, 0);
    lin.addColorStop(0, 'rgba(255,225,80,0)');
    lin.addColorStop(0.25, 'rgba(255,205,60,0.5)');
    lin.addColorStop(0.6, 'rgba(255,120,20,0.72)');
    lin.addColorStop(1, 'rgba(190,20,10,0.85)');
    p.fillStyle = lin;
    p.fillRect(0, 0, 256, 1);
    const colours = p.getImageData(0, 0, 256, 1).data;
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a === 0) continue;
      d[i] = colours[a * 4]; d[i + 1] = colours[a * 4 + 1]; d[i + 2] = colours[a * 4 + 2]; d[i + 3] = colours[a * 4 + 3];
    }
    g.putImageData(img, 0, 0);
    return cv;
  };

  const draw = () => {
    const m = current;
    if (m === undefined) return;
    m.frame = 0;
    const { canvas, view } = m;
    const g = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#1d140d';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.setTransform(view.s * dpr, 0, 0, view.s * dpr, view.x * dpr, view.y * dpr);
    const px = 1 / view.s; // one screen pixel in world units
    const path = (q, r) => {
      const c = center(q, r);
      g.beginPath();
      corners(c.x, c.y).forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
      g.closePath();
    };
    // Land: every hex in its Legend colour, muted on the dark ground so the glow is the brightest thing on the map
    // (full colours made red Badlands read as heat, build .114); dimmer still where it is not surveyed yet.
    g.lineWidth = px;
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    for (const rec of m.hexes) {
      path(rec.q, rec.r);
      g.globalAlpha = rec.cloud === true ? 0.5 : m.surveyed(rec.q, rec.r) ? 0.34 : 0.18;
      g.fillStyle = rec.cloud === true ? terrainMod.CLOUD_INFO.css : terrainMod.CLASS_INFO[rec.t]?.css ?? '#777';
      g.fill();
      g.globalAlpha = 1;
      g.stroke();
    }
    // A charted country (build .116): pale gold hatching and a gold edge, under the glow. A plain wash read as sandy
    // land (seen in game), so the hatch says "drawn on the map", not "this kind of ground".
    if (m.charted.length > 0) {
      for (const f of m.charted) {
        const c = center(f.q, f.r);
        g.save();
        path(f.q, f.r);
        g.fillStyle = 'rgba(255,226,150,0.16)';
        g.fill();
        g.clip();
        g.beginPath();
        for (let k = -3; k <= 3; k++) { g.moveTo(c.x - 1 + k * 0.28, c.y + 1); g.lineTo(c.x + 1 + k * 0.28, c.y - 1); }
        g.lineWidth = 1.6 * px;
        g.strokeStyle = 'rgba(255,226,150,0.85)';
        g.stroke();
        g.restore();
      }
      g.lineWidth = 2 * px;
      g.strokeStyle = 'rgba(255,226,150,0.95)';
      for (const f of m.charted) { path(f.q, f.r); g.stroke(); }
    }
    // The glow, then the hexes themselves: finds outlined gold, misses cold blue.
    g.drawImage(m.glow, m.b.minX, m.b.minY, m.b.maxX - m.b.minX, m.b.maxY - m.b.minY);
    g.lineWidth = 2.5 * px;
    g.strokeStyle = '#ffd34d';
    for (const f of m.found) { path(f.q, f.r); g.stroke(); }
    g.fillStyle = 'rgba(70,130,230,0.55)';
    g.strokeStyle = '#2b5fb8';
    g.lineWidth = 2 * px;
    for (const f of m.missed) { path(f.q, f.r); g.fill(); g.stroke(); }
    // You: a ring with a dark edge, readable on any colour.
    if (m.me !== undefined) {
      const c = center(m.me.q, m.me.r);
      g.beginPath();
      g.arc(c.x, c.y, Math.max(0.32, 9 * px), 0, Math.PI * 2);
      g.lineWidth = 5 * px; g.strokeStyle = '#1d140d'; g.stroke();
      g.lineWidth = 3 * px; g.strokeStyle = '#ffffff'; g.stroke();
    }
    if (m.hover !== undefined) {
      path(m.hover.q, m.hover.r);
      g.lineWidth = 2 * px; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.stroke();
    }
  };
  const redraw = () => { if (current !== undefined && current.frame === 0) current.frame = requestAnimationFrame(draw); };

  /** Keeps some of the map under the middle of the screen, however far it is dragged. */
  const clampView = (v) => {
    const { w, h } = screenSize();
    const b = current.all;
    return { s: v.s, x: Math.min(w / 2 - b.minX * v.s, Math.max(w / 2 - b.maxX * v.s, v.x)), y: Math.min(h / 2 - b.minY * v.s, Math.max(h / 2 - b.maxY * v.s, v.y)) };
  };
  const setView = (v) => { current.view = clampView(v); redraw(); };
  const screenSize = () => ({ w: current.canvas.clientWidth, h: current.canvas.clientHeight });
  const zoom = (factor, sx, sy) => {
    const { w, h } = screenSize();
    setView(zoomAt(current.view, sx ?? w / 2, sy ?? h / 2, factor, current.minS, current.minS * ZOOM_MAX));
  };
  const whole = () => { const { w, h } = screenSize(); const v = fit(current.all, w, h); current.minS = v.s * 0.8; setView(v); };
  const toHex = (h, s) => {
    const { w, h: hh } = screenSize();
    const c = center(h.q, h.r);
    const scale = Math.min(current.minS * ZOOM_MAX, Math.max(current.minS, s ?? current.view.s));
    setView({ s: scale, x: w / 2 - c.x * scale, y: hh / 2 - c.y * scale });
  };

  /** "(12, 15) · Grasslands · found here" for the hex under the pointer. */
  const info = (h) => {
    const m = current;
    const key = `${h.q},${h.r}`;
    const rec = state.terrain?.get(h.q, h.r);
    if (rec === undefined) { m.infoEl.textContent = t('MOD_VOY_JOURNAL_HEAT_HELP'); return; }
    const bits = [m.describe(h.q, h.r)];
    if (m.foundKeys.has(key)) bits.push(t('MOD_VOY_JOURNAL_HEAT_FOUND_HERE'));
    else if (m.missedKeys.has(key)) bits.push(t('MOD_VOY_JOURNAL_HEAT_NOT_HERE'));
    else if (m.chartedKeys.has(key)) bits.push(t('MOD_VOY_JOURNAL_HEAT_CHARTED_HERE'));
    if (m.me !== undefined && m.me.q === h.q && m.me.r === h.r) bits.push(t('MOD_VOY_JOURNAL_HEAT_YOU_HERE'));
    m.infoEl.textContent = bits.join(' · ');
  };

  const close = () => {
    const m = current;
    if (m === undefined) return;
    current = undefined;
    try { if (m.frame) cancelAnimationFrame(m.frame); m.resize.disconnect(); } catch {}
    m.el.remove();
    try { m.onClose?.(); } catch (e) { log('heat map close failed', e); }
  };

  /**
   * Opens the map over `container` (the journal's root). `found`, `missed` and `charted` (the whole charted country,
   * build .116) are [{ q, r }]; `describe(q, r)` names
   * a hex ("(12, 15) · Grasslands"); `surveyed(q, r)` says whether its land shows yet; `onClose` runs after it closes.
   */
  const open = ({ container, title, media, found = [], missed = [], charted = [], describe, surveyed, onClose }) => {
    try {
      close();
      if (state.terrain === undefined) return;
      const hexes = [...state.terrain.all()];
      const el = document.createElement('div');
      el.className = 'vj-heat';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-label', t('MOD_VOY_JOURNAL_HEAT_OPEN', { name: title }));
      const tool = (act, label, d) => `<button type="button" class="vj-heat-tool" data-heat="${act}" aria-label="${esc(label)}" title="${esc(label)}">${icon(d)}</button>`;
      el.innerHTML = '<div class="vj-heat-bar">'
        + `<div class="vj-heat-title">${media ? `<img src="${media}" alt="">` : ''}<b>${esc(title)}</b><span>${esc(t('MOD_VOY_JOURNAL_HEAT_SUB'))}</span></div>`
        + '<div class="vj-heat-legend">'
        + `<span><i class="vj-heat-key vj-heat-hot"></i>${esc(t('MOD_VOY_JOURNAL_HEAT_FOUND'))}</span>`
        + `<span><i class="vj-heat-key vj-heat-cold"></i>${esc(t('MOD_VOY_JOURNAL_HEAT_MISSED'))}</span>`
        + (charted.length > 0 ? `<span><i class="vj-heat-key vj-heat-charted"></i>${esc(t('MOD_VOY_JOURNAL_HEAT_CHARTED'))}</span>` : '')
        + `<span><i class="vj-heat-key vj-heat-me"></i>${esc(t('MOD_VOY_JOURNAL_HEAT_YOU'))}</span></div>`
        + '<div class="vj-heat-tools">'
        + tool('in', t('MOD_VOY_JOURNAL_HEAT_ZOOM_IN'), '<path d="M12 5v14M5 12h14"></path>')
        + tool('out', t('MOD_VOY_JOURNAL_HEAT_ZOOM_OUT'), '<path d="M5 12h14"></path>')
        + tool('whole', t('MOD_VOY_JOURNAL_HEAT_WHOLE'), '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path>')
        + tool('me', t('MOD_VOY_JOURNAL_HEAT_ME'), '<circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="1.5"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path>')
        + tool('close', t('MOD_VOY_JOURNAL_HEAT_CLOSE'), '<path d="M6 6l12 12M18 6L6 18"></path>')
        + '</div></div>'
        + `<canvas class="vj-heat-canvas" tabindex="0" aria-label="${esc(t('MOD_VOY_JOURNAL_HEAT_CANVAS'))}"></canvas>`
        + `<div class="vj-heat-info" aria-live="polite">${esc(t('MOD_VOY_JOURNAL_HEAT_HELP'))}</div>`;
      container.append(el);
      const canvas = el.querySelector('canvas');
      const all = bounds(hexes, 0.3);
      const surveyedSet = new Set();
      for (const rec of hexes) { try { if (surveyed?.(rec.q, rec.r)) surveyedSet.add(`${rec.q},${rec.r}`); } catch {} }
      current = {
        el, canvas, hexes, found, missed, charted, chartedKeys: new Set(charted.map((h) => `${h.q},${h.r}`)), describe: describe ?? ((q, r) => `(${q}, ${r})`), onClose,
        surveyed: (q, r) => surveyedSet.has(`${q},${r}`),
        foundKeys: new Set(found.map((h) => `${h.q},${h.r}`)), missedKeys: new Set(missed.map((h) => `${h.q},${h.r}`)),
        me: state.position?.(), all, b: all, glow: makeGlow(found, all), view: { s: 1, x: 0, y: 0 }, minS: 0.01, frame: 0,
        infoEl: el.querySelector('.vj-heat-info'), hover: undefined,
      };
      const m = current;
      const size = () => {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
        canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
        redraw();
      };
      m.resize = new ResizeObserver(() => { if (current === m) size(); });
      m.resize.observe(canvas);
      size();
      // First view: the finds, misses and you, with room round them; the whole map when there is nothing yet.
      whole();
      const focus = [...found, ...missed, ...(found.length + missed.length === 0 ? charted : []), ...(m.me !== undefined ? [m.me] : [])];
      if (focus.length > 0) {
        const { w, h } = screenSize();
        const fb = bounds(focus, 2.5);
        const v = fit(fb, w, h);
        if (v.s > m.view.s) {
          const s = Math.min(v.s, m.minS * ZOOM_MAX);
          const cx = (fb.minX + fb.maxX) / 2;
          const cy = (fb.minY + fb.maxY) / 2;
          setView({ s, x: w / 2 - cx * s, y: h / 2 - cy * s });
        }
      }

      // Drag with one pointer, pinch with two; a wheel or a double click zooms at the pointer.
      const pointers = new Map();
      let pinch;
      const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      canvas.addEventListener('pointerdown', (e) => {
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, local(e));
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        }
        canvas.classList.add('vj-heat-grab');
      });
      canvas.addEventListener('pointermove', (e) => {
        const p = local(e);
        const prev = pointers.get(e.pointerId);
        if (prev === undefined) {
          const h = hexAt((p.x - m.view.x) / m.view.s, (p.y - m.view.y) / m.view.s);
          if (m.hover?.q !== h.q || m.hover?.r !== h.r) { m.hover = h; info(h); redraw(); }
          return;
        }
        pointers.set(e.pointerId, p);
        if (pointers.size === 1) { setView({ ...m.view, x: m.view.x + p.x - prev.x, y: m.view.y + p.y - prev.y }); return; }
        if (pointers.size === 2 && pinch !== undefined) {
          const [a, b] = [...pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const v = zoomAt(m.view, mid.x, mid.y, d / pinch.d, m.minS, m.minS * ZOOM_MAX);
          setView({ ...v, x: v.x + mid.x - pinch.mid.x, y: v.y + mid.y - pinch.mid.y });
          pinch = { d, mid };
        }
      });
      const up = (e) => {
        const p = pointers.get(e.pointerId);
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = undefined;
        if (pointers.size === 0) canvas.classList.remove('vj-heat-grab');
        // A tap reads the hex under it (there is no hover on a touch screen).
        if (p !== undefined && e.pointerType !== 'mouse') {
          const h = hexAt((p.x - m.view.x) / m.view.s, (p.y - m.view.y) / m.view.s);
          m.hover = h; info(h); redraw();
        }
      };
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
      canvas.addEventListener('pointerleave', () => { if (pointers.size === 0 && m.hover !== undefined) { m.hover = undefined; redraw(); } });
      canvas.addEventListener('wheel', (e) => { e.preventDefault(); const p = local(e); zoom(Math.exp(-e.deltaY * 0.0015), p.x, p.y); }, { passive: false });
      canvas.addEventListener('dblclick', (e) => { const p = local(e); zoom(2, p.x, p.y); });
      canvas.addEventListener('keydown', (e) => {
        const step = 60;
        const move = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
        if (move !== undefined) { e.preventDefault(); setView({ ...m.view, x: m.view.x + move[0], y: m.view.y + move[1] }); return; }
        if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(1.4); }
        else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoom(1 / 1.4); }
        else if (e.key === '0') { e.preventDefault(); whole(); }
      });
      el.addEventListener('click', (e) => {
        const b = e.target instanceof Element ? e.target.closest('[data-heat]') : null;
        if (b === null) return;
        const act = b.dataset.heat;
        if (act === 'in') zoom(1.4);
        else if (act === 'out') zoom(1 / 1.4);
        else if (act === 'whole') whole();
        else if (act === 'me' && m.me !== undefined) toHex(m.me, Math.max(m.view.s, m.minS * 4));
        else if (act === 'close') close();
      });
      canvas.focus();
    } catch (e) { log('heat map failed', e); close(); }
  };

  const api = { open, close, isOpen: () => current !== undefined, element: () => current?.el };
  state.heatmap = api;
  return api;
}
