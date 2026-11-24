// The courier route editor (round 4): a panel on the map while you set a courier's stops. A tap on the map adds what stands
// on that hex (a Folk, a tent, a bank place); the panel lists the stops in order with each leg's time, and saves. Nothing
// changes until Save. The rules are in courier-model.mjs, the courier's side in courier.mjs; the route line on the map is
// drawn by walk-line.mjs from `line()`.

const MAP_PAGE = 'melvorAoD:Cartography';

export function install(ctx, { state, M, N, helpLayout, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const couriers = () => state.couriers;
  const folk = (id) => state.folksApi?.()?.folkById(id);
  const hexes = (n) => t(n === 1 ? 'MOD_VOY_HEXES_ONE' : 'MOD_VOY_HEXES_MANY', { count: numberWithCommas(n) });

  /** What is being edited: { id, stops, choices (a hex's stops to pick from), note (the last tap's reason) }. */
  let editing;
  let panel;
  /** Bumped when the stops change, so the map line redraws only then. */
  let version = 0;
  let shown;
  /** On a phone the editor folds to its title row, so the map stays free. A browser convenience, kept out of the save. */
  const FOLD_KEY = 'voyage-route-folded';
  let folded = (() => { try { return localStorage.getItem(FOLD_KEY) === '1'; } catch { return false; } })();
  const phone = () => { try { return window.matchMedia('(max-width: 575.98px)').matches; } catch { return false; } };
  const foldedNow = () => folded && phone();
  /** The finger on the title row, and until when the click that ends its swipe is ignored. */
  let drag;
  let ignoreClickUntil = 0;

  const isOpen = () => editing !== undefined;
  const sameRoute = (a, b) => a.length === b.length && a.every((s, i) => M.sameStop(s, b[i]));

  // ---- what can stop it saving ---------------------------------------------------------------------------------------
  const problemText = (stops, p) => {
    const problem = M.routeProblem(stops);
    if (problem === 'few') return t('MOD_VOY_ROUTE_FEW');
    if (problem === 'noBank') return t('MOD_VOY_ROUTE_NO_BANK');
    if (problem === 'repeat') return t('MOD_VOY_ROUTE_SAME');
    if (problem !== undefined) return t('MOD_VOY_ROUTE_UNREADABLE');
    return p?.noRoad === true ? t('MOD_VOY_ROUTE_NO_ROAD_SAVE') : '';
  };

  // ---- the panel --------------------------------------------------------------------------------------------------
  const iconBtn = (action, at, icon, label, off, cls = 'btn-outline-info') => `<button type="button" class="btn btn-sm ${off ? 'btn-outline-secondary disabled' : cls} voyage-route-icon" data-route="${action}" data-at="${at}" aria-label="${esc(label)}" title="${esc(label)}"${off ? ' aria-disabled="true"' : ''}><i class="fa ${icon}" aria-hidden="true"></i></button>`;
  /** A footer button: greyed with its reason on hover and in a toast when it can't be used now. */
  const footBtn = (action, cls, label, why) => (why === undefined || why === ''
    ? `<button type="button" class="btn btn-sm ${cls}" data-route="${action}">${esc(label)}</button>`
    : `<button type="button" class="btn btn-sm btn-outline-secondary disabled" data-route="${action}" aria-disabled="true" data-why="${esc(why)}" title="${esc(why)}">${esc(label)}</button>`);
  const legHtml = (leg) => {
    if (leg.state === 'noRoad') return `<div class="voyage-route-leg text-danger">${esc(t('MOD_VOY_ROUTE_NO_ROAD'))}</div>`;
    if (leg.state === 'away') return `<div class="voyage-route-leg text-warning">${esc(t('MOD_VOY_ROUTE_AWAY'))}</div>`;
    const dot = '<span class="voyage-walk-dot" aria-hidden="true">·</span>';
    if (leg.state === 'packet') {
      const fare = leg.fare > 0 ? `${dot}<span class="text-nowrap"><img class="skill-icon-xxs" src="${esc(game.gp.media)}" alt=""> ${esc(t('MOD_VOY_HAUL_GP', { gp: N.shortNumber(leg.fare) }))}</span>` : '';
      return `<div class="voyage-route-leg text-muted"><span class="text-nowrap"><i class="fa fa-ship" aria-hidden="true"></i> ${esc(t('MOD_VOY_ROUTE_PACKET'))}</span>${dot}${helpLayout.timeHtml(state.clock?.duration?.(leg.ms) ?? '')}${fare}</div>`;
    }
    const parts = leg.hexes === 0 ? esc(t('MOD_VOY_ROUTE_NEXT_DOOR')) : `${helpLayout.timeHtml(state.clock?.duration?.(leg.ms) ?? '')}<span class="voyage-walk-dot" aria-hidden="true">·</span>${esc(hexes(leg.hexes))}`;
    return `<div class="voyage-route-leg text-muted">${parts}</div>`;
  };
  /** A name of three words or more never leaves its last word alone on a line. */
  const keepEnd = (x) => String(x).replace(/^(\S+ .*\S) (\S+)$/, '$1\u00a0$2');
  const stopsHtml = (stops, p) => {
    if (stops.length === 0) return '';
    const n = stops.length;
    return `<ol class="voyage-route-stops">${stops.map((s, i) => `<li><div class="voyage-route-stop">`
      + `<span class="voyage-route-num" aria-hidden="true">${i + 1}</span>`
      + `<span class="voyage-route-name font-w600">${esc(keepEnd(couriers().stopName(s)))}</span>`
      + `<span class="voyage-route-btns">${iconBtn('up', i, 'fa-arrow-up', t('MOD_VOY_ROUTE_UP'), i === 0)}${iconBtn('down', i, 'fa-arrow-down', t('MOD_VOY_ROUTE_DOWN'), i === n - 1)}`
      + `${iconBtn('remove', i, 'fa-times', t('MOD_VOY_ROUTE_REMOVE'), false, 'btn-outline-danger')}</span></div>`
      + (p?.legs[i] === undefined ? '' : legHtml(p.legs[i])) + '</li>').join('')}</ol>`;
  };
  const html = () => {
    const { id, stops, choices, note } = editing;
    const f = folk(id);
    if (f === undefined) return '';
    const c = couriers();
    const p = stops.length >= 2 ? c.preview(id, stops) : undefined;
    const saved = c.all()?.[id];
    const far = c.editRefusal(id);
    const problem = problemText(stops, p);
    const why = far ?? problem;
    const edited = saved !== undefined && saved.retired !== true && !sameRoute(stops, saved.pending ?? saved.stops);
    const pick = choices === undefined ? ''
      : `<div class="voyage-route-pick"><div class="font-w600">${esc(t('MOD_VOY_ROUTE_ADD_HERE'))}</div><div class="voyage-route-chips">${choices.map((s, i) => `<button type="button" class="btn btn-sm btn-outline-info" data-route="pick" data-at="${i}">${esc(keepEnd(c.stopName(s)))}</button>`).join('')}</div></div>`;
    const round = p !== undefined && !p.noRoad && p.ms > 0 ? `<div class="voyage-route-round">${helpLayout.withTime('MOD_VOY_COURIER_LOOP', { time: state.clock?.duration?.(p.ms) ?? '' })}</div>`
      + (p.fares > 0 ? `<div class="voyage-route-round">${esc(t('MOD_VOY_COURIER_FARES', { gp: N.shortNumber(p.fares) }))}</div>` : '') : '';
    const count = t(stops.length === 1 ? 'MOD_VOY_ROUTE_STOPS_ONE' : 'MOD_VOY_ROUTE_STOPS_MANY', { count: numberWithCommas(stops.length) });
    return `<div class="voyage-route-head"><h5 class="voyage-route-title font-w600">${esc(t('MOD_VOY_ROUTE_TITLE', { name: f.name }))}</h5>`
      + `<span class="voyage-route-count text-muted">${esc(count)}${p !== undefined && !p.noRoad && p.ms > 0 ? `<span class="voyage-walk-dot" aria-hidden="true">·</span>${helpLayout.timeHtml(state.clock?.duration?.(p.ms) ?? '')}` : ''}</span>`
      + `<button type="button" class="voyage-route-grab" data-route="fold" data-tip-touch="off" aria-expanded="${!folded}" aria-label="${esc(t(folded ? 'MOD_VOY_ROUTE_UNFOLD' : 'MOD_VOY_ROUTE_FOLD'))}"><svg viewBox="0 0 36 10" aria-hidden="true"><path d="M3 7.5 18 2.5 33 7.5"/></svg></button></div>`
      // The hint only teaches the first tap: it goes once the list has a stop.
      + `<div class="voyage-section">${stops.length === 0 ? `<div>${esc(t('MOD_VOY_ROUTE_HINT'))}</div>` : ''}${pick}`
      + (note === '' || note === undefined ? '' : `<div class="text-warning mt-2">${esc(note)}</div>`)
      + stopsHtml(stops, p) + round + '</div>'
      + '<div class="voyage-route-foot">'
      + (why === '' ? (edited ? `<div class="text-muted voyage-route-why">${esc(t('MOD_VOY_ROUTE_PENDING'))}</div>` : '') : `<div class="text-warning voyage-route-why">${esc(why)}</div>`)
      + (saved === undefined || saved.retired === true ? '' : footBtn('delete', 'btn-outline-danger', t('MOD_VOY_ROUTE_DELETE'), far))
      + `<span class="voyage-route-pair"><button type="button" class="btn btn-sm btn-outline-info" data-route="cancel">${esc(t('MOD_VOY_ROUTE_CANCEL'))}</button>`
      + `${footBtn('save', 'btn-success', t('MOD_VOY_ROUTE_SAVE'), why)}</span></div>`;
  };
  const render = () => {
    if (editing === undefined) return;
    if (folk(editing.id) === undefined) { close(); return; }
    if (panel === undefined || !panel.isConnected) {
      panel = document.createElement('div');
      panel.id = 'voyage-route';
      panel.className = 'voyage-ui block block-rounded bg-combat-inner-dark p-2';
      panel.addEventListener('click', onClick);
      panel.addEventListener('pointerdown', onPointerDown);
      cartographyMap.append(panel);
    }
    const next = html();
    if (next !== shown) { panel.innerHTML = next; shown = next; state.tips?.apply(panel); }
    panel.classList.remove('d-none');
    panel.classList.toggle('voyage-route-folded', folded);
    panel.parentElement?.classList.add('voyage-route-open');
  };
  const changed = (stops) => {
    editing = { ...editing, stops, choices: undefined, note: '' };
    version += 1;
    render();
  };
  const close = () => {
    editing = undefined;
    shown = undefined;
    version += 1;
    panel?.parentElement?.classList.remove('voyage-route-open');
    panel?.classList.add('d-none');
    if (panel !== undefined) panel.innerHTML = '';
    couriers()?.forgetRoads?.();
  };

  /** Why a tap added nothing: in the panel, or in a toast while the panel is folded and its note can't be seen. */
  const refuse = (note) => {
    const toast = foldedNow();
    editing = { ...editing, choices: undefined, note: toast ? '' : note };
    if (toast) state.refused?.(note);
    render();
  };
  const add = (stop) => {
    const out = M.addStop(editing.stops, stop);
    if (out.why === undefined) { changed(out.stops); return; }
    refuse(t(out.why === 'many' ? 'MOD_VOY_ROUTE_MANY' : 'MOD_VOY_ROUTE_REPEAT', { n: `${M.STOPS_MAX}` }));
  };
  const save = () => {
    const c = couriers();
    if ((c.editRefusal(editing.id) ?? '') !== '') { render(); return; }
    const saved = c.all()?.[editing.id];
    // Nothing changed: no edit to wait for at the next bank stop.
    if (saved !== undefined && saved.retired !== true && sameRoute(editing.stops, saved.pending ?? saved.stops)) { close(); return; }
    const problem = c.setRoute(editing.id, editing.stops);
    if (problem === undefined) { close(); return; }
    editing = { ...editing, note: problemText(editing.stops) || t('MOD_VOY_ROUTE_UNREADABLE') };
    render();
  };
  const setFolded = (on) => {
    if (on === folded) return;
    folded = on;
    try { localStorage.setItem(FOLD_KEY, on ? '1' : '0'); } catch {}
    render();
  };
  // The grip takes vertical swipes only; the game's sideways menu swipe stays off while a finger is on it.
  const setSwipes = (off) => { try { if (typeof disableSwipeEvents !== 'undefined') disableSwipeEvents = off; } catch {} };
  const endDrag = (e) => {
    if (drag === undefined || e.pointerId !== drag.id) return;
    const { x, y } = drag;
    drag = undefined;
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
    setSwipes(false);
    if (e.type !== 'pointerup' || editing === undefined) return;
    const out = M.sheetSwipe(e.clientX - x, e.clientY - y, folded);
    if (out.moved) ignoreClickUntil = performance.now() + 350;
    setFolded(out.folded);
  };
  function onPointerDown(e) {
    if (e.button !== 0 || !phone() || !(e.target instanceof Element) || e.target.closest('.voyage-route-grab') === null) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    setSwipes(true);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  }
  function onClick(e) {
    const b = e.target instanceof Element ? e.target.closest('[data-route]') : null;
    if (b === null || editing === undefined) return;
    if (b.dataset.route === 'fold') { if (performance.now() >= ignoreClickUntil) setFolded(!folded); return; }
    if (b.getAttribute('aria-disabled') === 'true') { state.refused?.(b.dataset.why); return; }
    try {
      const at = Number(b.dataset.at);
      const action = b.dataset.route;
      if (action === 'up') changed(M.moveStop(editing.stops, at, -1));
      else if (action === 'down') changed(M.moveStop(editing.stops, at, 1));
      else if (action === 'remove') changed(M.removeStop(editing.stops, at));
      else if (action === 'pick') { const s = editing.choices?.[at]; if (s !== undefined) add(s); }
      else if (action === 'cancel') close();
      else if (action === 'save') save();
      else if (action === 'delete') { couriers().deleteRoute(editing.id); close(); }
    } catch (err) { log('route editor failed', err); }
  }

  /** A tap on the map while editing: what stands on that hex becomes a stop, or a choice when several do. */
  const tapped = (hex) => {
    const found = couriers().stopsHere(editing.id, { q: hex.q, r: hex.r });
    if (found.length === 1) { add(found[0]); return; }
    if (found.length === 0) { refuse(t('MOD_VOY_ROUTE_NOTHING')); return; }
    editing = { ...editing, choices: found, note: '' };
    if (foldedNow()) setFolded(false); // the choice of stops sits in the open panel
    render();
  };
  try {
    ctx.patch(Cartography, 'onHexTap').replace(function (original, hex) {
      if (editing !== undefined && hex?.map === this.activeMap) {
        try { tapped(hex); } catch (e) { log('route tap failed', e); }
        return undefined;
      }
      return original(hex);
    });
  } catch (e) { log('route tap not patched', e); }

  /** Opens the editor on the map for a Folk, with its route (the edit waiting at its next bank stop, if there is one). */
  const open = (id) => {
    const c = couriers();
    if (c === undefined || folk(id) === undefined) return;
    const saved = c.all()?.[id];
    c.forgetRoads();
    editing = { id, stops: saved === undefined || saved.retired === true ? [] : [...(saved.pending ?? saved.stops)], choices: undefined, note: '' };
    if (editing.stops.length === 0) folded = false; // an empty route opens with its hint in view; the kept choice returns with the next route
    version += 1;
    shown = undefined;
    try { state.openPage(game.pages.getObjectByID(MAP_PAGE)); } catch (e) { log('route editor: map not opened', e); }
    render();
  };

  /** For the map: the route being edited, each leg a list of hexes, and its stops. */
  let lineMemo;
  const line = () => {
    if (editing === undefined || editing.stops.length === 0) return undefined;
    if (lineMemo?.version === version) return lineMemo.value;
    const c = couriers();
    const p = editing.stops.length >= 2 ? c.preview(editing.id, editing.stops) : undefined;
    const marks = editing.stops.map((s) => (s.kind === 'bank' ? { q: s.q, r: s.r } : s.kind === 'folk' ? folk(s.id)?.place : state.outposts?.list?.().find((x) => x.key === s.key))).filter((h) => h != null);
    lineMemo = { version, value: { key: `edit${version}`, lines: p?.lines ?? [], marks } };
    return lineMemo.value;
  };

  return { open, close, isOpen, line };
}
