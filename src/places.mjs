// The map's Places card (1.8.1, a player's ask, the user: "a collapsible panel of trading ports and other places of
// interest (like your Tent and Home)", a fold-out on the map under the Legend). A round badge under the Legend's in
// the map's control column (here-panel.mjs moveMapControls); a tap opens a card beside it with a search box and the
// places worth going back to: home, the camps you pitched, the ports found, the places set off for lately. A row's
// name centres the map on it and selects its hex, so the game's own overview offers Travel; Plan (once the planner is
// open, Voyage 15) plans the voyage there. One card is open at a time: opening this one folds the Legend's. Like the
// Legend's, it starts closed on every load (the user, 1.8.1) and is not kept; the key it was kept under is cleared once.
// The pure part is src/places-model.mjs.

const OPEN_KEY = 'voyage-places-open';
const PHONE = '(max-width: 575.98px)';

export function install(ctx, { state, PM, terrainMod, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  try { localStorage.removeItem(OPEN_KEY); } catch {}
  let isOpen = false;
  let query = '';
  const liveHex = (q, r) => { try { return game.cartography.activeMap?.getHex(new HexCoords(q, r)); } catch { return undefined; } };
  const away = (h) => { const pos = state.position?.(); const d = pos === undefined ? undefined : terrainMod.hexDistance(pos, h); return Number.isFinite(d) ? d : undefined; };
  const hexes = (n) => t(n === 1 ? 'MOD_VOY_HEXES_ONE' : 'MOD_VOY_HEXES_MANY', { count: `${n}` });

  // ---- the rows ------------------------------------------------------------------------------------------------
  /** { home, camps, ports, recent }: each row { name, q, r, media?, distance?, due?, recent? }. */
  const rows = () => {
    const out = { home: [], camps: [], ports: [], recent: [] };
    try {
      const h = state.planner?.home?.();
      if (h !== undefined) out.home.push({ name: h.name, q: h.q, r: h.r, media: h.media, distance: h.distance });
    } catch (e) { log('places: home failed', e); }
    try {
      const tent = state.outposts?.media?.();
      for (const o of state.outposts?.list?.() ?? []) out.camps.push({ name: o.name, q: o.q, r: o.r, media: tent, distance: away(o) });
    } catch (e) { log('places: camps failed', e); }
    try {
      for (const p of state.cargo?.ports?.() ?? []) out.ports.push({ name: p.name, q: p.q, r: p.r, media: p.media, distance: away(p), due: p.due });
    } catch (e) { log('places: ports failed', e); }
    try {
      (state.planner?.recent?.() ?? []).forEach((e, i) => {
        const pos = state.position?.();
        // The nearest of its hexes, as the planner heads for it.
        const near = pos === undefined ? e.hexes[0] : [...e.hexes].sort((a, b) => terrainMod.hexDistance(pos, a) - terrainMod.hexDistance(pos, b))[0];
        if (near === undefined) return;
        out.recent.push({ name: e.name, q: near.q, r: near.r, media: liveHex(near.q, near.r)?.pointOfInterest?.media, distance: away(near), recent: i });
      });
    } catch (e) { log('places: recent failed', e); }
    return out;
  };

  const GROUP_KEY = { home: 'MOD_VOY_PLACES_HOME', camps: 'MOD_VOY_PLACES_CAMPS', ports: 'MOD_VOY_PLACES_PORTS', recent: 'MOD_VOY_PLACES_RECENT' };
  const rowHtml = (g, r, plan) => {
    const here = r.distance === 0;
    const icon = r.media ? `<img class="voyage-places-icon" src="${esc(r.media)}" alt="">` : '<span class="voyage-places-icon"></span>';
    const due = r.due > 0 ? ` <i class="fa fa-anchor text-success" aria-label="${esc(t('MOD_VOY_PLACES_DUE'))}" title="${esc(t('MOD_VOY_PLACES_DUE'))}"></i>` : '';
    const dist = here ? t('MOD_VOY_PLACES_HERE') : r.distance === undefined ? '' : hexes(r.distance);
    const show = `<button type="button" class="voyage-places-show${r.due > 0 ? ' text-success' : ''}" data-places-q="${r.q}" data-places-r="${r.r}">${icon}<span class="voyage-places-name">${esc(r.name)}${due}</span>`
      + `<span class="voyage-places-dist text-muted">${esc(dist)}</span></button>`;
    const planBtn = plan && !here
      ? `<button type="button" class="btn btn-sm btn-outline-info voyage-places-plan" data-places-plan="${g}" data-places-q="${r.q}" data-places-r="${r.r}"${r.recent === undefined ? '' : ` data-places-i="${r.recent}"`}>${esc(t('MOD_VOY_PLACES_PLAN'))}</button>` : '';
    return `<div class="voyage-places-row">${show}${planBtn}</div>`;
  };
  const listHtml = () => {
    const all = rows();
    const groups = PM.placeGroups(all, query);
    if (groups.length === 0) {
      const none = Object.values(all).every((l) => l.length === 0);
      return `<div class="text-muted voyage-places-empty">${esc(none ? t('MOD_VOY_PLACES_NONE') : t('MOD_VOY_PLACES_NO_MATCH', { query: query.trim() }))}</div>`;
    }
    const plan = state.planner?.open?.() === true;
    return groups.map((g) => `<div class="voyage-places-group"><div class="voyage-places-head">${esc(t(GROUP_KEY[g.id]))}</div>${g.rows.map((r) => rowHtml(g.id, r, plan)).join('')}</div>`).join('');
  };
  const cardHtml = () => {
    const label = t('MOD_VOY_PLACES_TITLE');
    const search = `<div class="voyage-places-search"><input type="search" class="form-control form-control-sm voyage-places-query" maxlength="60" autocomplete="off" spellcheck="false" placeholder="${esc(t('MOD_VOY_PLACES_SEARCH'))}" aria-label="${esc(t('MOD_VOY_PLACES_SEARCH'))}" value="${esc(query)}"></div>`;
    // On a phone the card is a full-screen sheet (the user, 1.8.1: under the lowest badge it ran past the map's foot);
    // its × closes it there, where the badge lies under it.
    const close = `<button type="button" class="btn btn-sm btn-outline-info voyage-places-close" aria-label="${esc(t('MOD_VOY_PLACES_CLOSE'))}" title="${esc(t('MOD_VOY_PLACES_CLOSE'))}"><i class="fa fa-times" aria-hidden="true"></i></button>`;
    return `<div class="voyage-legend-card voyage-places-card voyage-ui block block-rounded bg-combat-inner-dark p-2 mb-0"><div class="voyage-legend-card-title voyage-places-title"><span>${esc(label)}</span>${close}</div>${search}<div class="voyage-places-list">${listHtml()}</div></div>`;
  };

  // ---- the badge -----------------------------------------------------------------------------------------------
  let boxNow;
  /** Draws (or redraws) the badge in the map's control column `box`, under the Legend's. */
  const badge = (box) => {
    if (box == null) return;
    boxNow = box;
    let wrap = box.querySelector(':scope > .voyage-places-badge');
    if (state.mode === 'dormant') { wrap?.remove(); return; }
    if (wrap === null) {
      wrap = document.createElement('div');
      wrap.className = 'voyage-places-badge m-2 pointer-events-auto';
      wrap.addEventListener('click', onClick);
      wrap.addEventListener('input', (e) => {
        if (!(e.target instanceof HTMLInputElement) || !e.target.matches('.voyage-places-query')) return;
        query = e.target.value;
        const list = wrap.querySelector('.voyage-places-list');
        if (list !== null) list.innerHTML = listHtml();
      });
      // The map's own keys and drags stay out of the search box.
      // Esc closes the card (the phone's sheet above all), from the box or a row.
      wrap.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen) { e.preventDefault(); e.stopPropagation(); setOpen(false); wrap.querySelector('.voyage-places-btn')?.focus(); return; }
        if (e.target instanceof HTMLInputElement) e.stopPropagation();
      });
    }
    const legend = box.querySelector(':scope > .voyage-legend-badge');
    if (legend !== null) { if (legend.nextElementSibling !== wrap) legend.after(wrap); } else if (wrap.parentElement !== box) box.append(wrap);
    const label = t('MOD_VOY_PLACES_TITLE');
    const btn = `<button type="button" class="btn btn-primary border border-2x border-dark btn-sm-mobile voyage-legend-btn voyage-places-btn${isOpen ? ' active' : ''}" aria-expanded="${isOpen}" aria-label="${esc(label)}" title="${esc(label)}"><i class="fa fa-map-marker-alt" aria-hidden="true"></i></button>`;
    const html = btn + (isOpen ? cardHtml() : '');
    if (wrap.dataset.html === html) return;
    // Typing in the search box keeps its focus and caret through a redraw.
    const typing = document.activeElement instanceof HTMLInputElement && wrap.contains(document.activeElement);
    const caret = typing ? document.activeElement.selectionStart : undefined;
    wrap.dataset.html = html;
    wrap.innerHTML = html;
    if (typing) { const s = wrap.querySelector('.voyage-places-query'); s?.focus(); try { s?.setSelectionRange(caret, caret); } catch {} }
    try { state.tips?.apply(wrap); } catch {}
  };
  const redraw = () => { if (boxNow?.isConnected) badge(boxNow); };
  const setOpen = (on) => {
    if (isOpen === on) return;
    isOpen = on;
    if (on) try { state.closeLegend?.(); } catch {}
    redraw();
  };

  /** Centres the map on a hex and selects it, as a tap on it does, so the game's overview offers Travel. */
  const show = (q, r) => {
    const hex = liveHex(q, r);
    if (hex === undefined) return;
    try { state.ship?.centreOn?.(hex); } catch (e) { log('places: centre failed', e); }
    try { if (!hex.isSelected && !hex.isPlayerHere) game.cartography.onHexTap(hex); } catch (e) { log('places: select failed', e); }
    // On a phone the card covers the screen: it folds away to show the place.
    if (window.matchMedia?.(PHONE).matches === true) setOpen(false);
  };
  const plan = (b) => {
    const q = Number(b.dataset.placesQ);
    const r = Number(b.dataset.placesR);
    if (b.dataset.placesPlan === 'recent' && b.dataset.placesI !== undefined) { state.planner?.fromRecent?.(Number(b.dataset.placesI)); return; }
    if (b.dataset.placesPlan === 'home') { state.planner?.planHome?.(); return; }
    const hex = liveHex(q, r);
    const poi = hex?.pointOfInterest;
    const name = b.closest('.voyage-places-row')?.querySelector('.voyage-places-name')?.textContent ?? poi?.name ?? '';
    state.planner?.planTo?.({ name, media: poi?.media, hexes: [{ q, r }] });
  };
  function onClick(e) {
    const el = e.target instanceof Element ? e.target : null;
    if (el === null) return;
    if (el.closest('.voyage-places-btn') !== null) { setOpen(!isOpen); return; }
    if (el.closest('.voyage-places-close') !== null) { setOpen(false); return; }
    const p = el.closest('[data-places-plan]');
    if (p !== null) { e.preventDefault(); plan(p); return; }
    const s = el.closest('.voyage-places-show');
    if (s !== null) { e.preventDefault(); show(Number(s.dataset.placesQ), Number(s.dataset.placesR)); }
  }

  // A move, a survey, a camp pitched or a port found redraws the open card (only when its text changed).
  state.listeners.push(() => { if (isOpen) redraw(); });

  const api = { badge, redraw, open: () => setOpen(true), close: () => setOpen(false), toggle: () => setOpen(!isOpen), isOpen: () => isOpen, usable: () => state.mode !== 'dormant' };
  state.places = api;
  return api;
}
