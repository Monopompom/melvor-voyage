// Events that ask (the flat mechanics, build .378): a stowaway found aboard on a long crossing. It asks for a choice
// with a cost either way. The rules are pure (src/events-model.mjs); the stowaway rides as crew (crew.mjs). Hire it as
// a Trainee at half the Shop's price (Worker Folks API v6), or it goes ashore at the next port or land you stand on;
// until then it takes a berth and eats. The pirates that met the big ship here until version 1.1.0 are bands now
// (encounters.mjs).

// The stowaway's Hire is green, Not now a blue outline.
const SWAL_CLASS = { popup: 'voyage-ui', confirmButton: 'btn btn-success m-1', cancelButton: 'btn btn-outline-info m-1' };

export function install(ctx, { state, EM, shipModel, helpLayout, rankName, shortNumber, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  /** The toll and the hire price, short (2.5M) on the buttons, lines and notices alike. */
  const gpText = (n) => shortNumber(Math.round(n));
  const offlineNow = () => { try { return game._isInOnlineLoop === false; } catch { return false; } };
  const skill = () => state.voyageSkill?.();
  const record = () => { const s = skill(); return s !== undefined && s.futureRaw === undefined ? s.record : undefined; };
  const notify = (text, kind = 'info') => {
    try {
      if (kind === 'danger') game.notifications.createErrorNotification('voyage:events', text);
      else game.notifications.createInfoNotification('voyage:events', text, ctx.getResourceUrl('assets/icon.svg'));
    } catch {}
  };
  /** A Welcome Back line (the weather's list, told with the catch-up's other lines). */
  const away = (html) => { try { state.weather?.tellAway?.(html); } catch {} };
  const redraw = () => { const s = skill(); if (s !== undefined) s.renderQueue.page = true; try { state.onSettingsChange(); } catch {} };
  const { mark, marked } = helpLayout;
  /** The big ship's picture, the popup's subject at sea (the mod's icon when there is none). */
  const hullPic = () => { const h = state.ship?.vessel?.('ship')?.hull; return ctx.getResourceUrl(h ? `assets/hull_${h}.webp` : 'assets/icon.webp'); };
  /** A price as every popup marks it: the GP icon, then the number bold in amber, red when you can't pay. */
  const gpMark = (n) => mark.gp(game.gp.media, gpText(n), !(game.gp.amount >= n));
  /** Turns a popup's main button off while it can't be used (the reason stands in the body). */
  const confirmOff = () => { try { Swal.getConfirmButton()?.setAttribute('disabled', ''); } catch {} };
  const fire = (opts, cls = SWAL_CLASS) => SwalLocale.fire({
    didRender: state.popupDidRender,
    imageUrl: ctx.getResourceUrl('assets/icon.webp'),
    ...helpLayout.MSG_IMAGE,
    customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass(cls) : cls,
    ...opts,
  });
  const gpIcon = () => `<img src="${esc(game.gp.media)}" alt="">`;

  // The dev console's voyageDev.event('stowaway'): the next chance comes true (once).
  const forced = { stowaway: false };
  const force = (kind) => { if (!(kind in forced)) return `stowaway, not ${kind}`; forced[kind] = true; return `${kind}: the next chance comes true`; };

  // ---- the stowaway ------------------------------------------------------------------------------------------------
  const folks = () => (state.folksGuarded ? state.folksApi?.() : undefined);
  /** The stowaway's rank as Worker Folks names it (Trainee). */
  const rank = () => rankName?.(EM.STOWAWAY_TIER) ?? EM.STOWAWAY_TIER;
  // API 7 (build .386): `canHire` says licence, slot and GP, and `hire` takes the share (TG-8: v6 priced it in full).
  const canHire = () => (folks()?.version ?? 0) >= 7 && state.active?.() === true;
  // The save's `events`, cleaned once per record and kept on it from then on (so a write never lands on a stale copy).
  const cleaned = new WeakSet();
  const ev = () => {
    const r = record();
    if (r === undefined) return undefined;
    if (!cleaned.has(r)) { r.events = EM.cleanEvents(r.events); cleaned.add(r); }
    return r.events;
  };
  /** The stowaway aboard: { name, tier, portrait }, or undefined (none, or Worker Folks not there to hire it). */
  const stowaway = () => {
    const s = canHire() ? ev()?.stow : null;
    return s == null ? undefined : { name: s.name, tier: EM.STOWAWAY_TIER, portrait: portrait() };
  };
  const seaAt = (h) => { const rec = state.recordAt?.(h); return rec !== undefined && shipModel.isSea(rec); };
  /** At set-off: the walk index where a stowaway will climb out, or -1. */
  const stowRoll = (walk) => {
    if (!canHire() || ev()?.stow != null || !Array.isArray(walk)) return -1;
    const sea = [];
    for (let i = 1; i < walk.length - 1; i++) if (seaAt(walk[i])) sea.push(i);
    const at = EM.stowawayAt(sea, [forced.stowaway ? 0 : Math.random(), Math.random()]);
    if (at > 0) forced.stowaway = false;
    return at;
  };
  /** The hire's price now (a share of the Shop's), or undefined. */
  const price = () => EM.stowawayPrice(folks()?.hirePrice?.(EM.STOWAWAY_TIER));
  /** Why it can't be hired now, or undefined: Worker Folks says (licence, a crew slot, then the GP; build .386). */
  const hireRefusal = () => {
    const s = stowaway();
    if (s === undefined) return '';
    const p = price();
    let can;
    try { can = folks()?.canHire?.(EM.STOWAWAY_TIER, { share: EM.STOWAWAY_PRICE_SHARE }); } catch (e) { log('hire check failed', e); }
    if (can !== undefined && can.ok !== true) return refusedText(can.refused, s, can.price ?? p);
    if (p !== undefined && !(game.gp.amount >= p)) return t('MOD_VOY_STOW_NO_GP', { name: s.name, gp: gpText(p) });
    return undefined;
  };
  const refusedText = (why, s, p) => t(why === 'licence' ? 'MOD_VOY_STOW_NO_LICENCE' : why === 'full' ? 'MOD_VOY_STOW_NO_SLOT' : why === 'gp' ? 'MOD_VOY_STOW_NO_GP' : 'MOD_VOY_STOW_NO_HIRE', { name: s.name, gp: gpText(p ?? 0), rank: rank() });
  /** Its rank's portrait, from a Folk of yours of that rank (Worker Folks gives one per Folk), or undefined. */
  const portrait = () => { try { return folks()?.folks?.().find((f) => f.tier === EM.STOWAWAY_TIER && f.portrait)?.portrait; } catch { return undefined; } };
  /** Hires the stowaway: a Trainee with you, paid at its share of the Shop's price. True when it joined. */
  const hire = () => {
    const s = stowaway();
    const api = folks();
    if (s === undefined || api === undefined) return false;
    const p = price();
    const r = api.hire(EM.STOWAWAY_TIER, { name: s.name, travel: 'with', source: 'voyage', share: EM.STOWAWAY_PRICE_SHARE });
    if (r?.folk === undefined) { notify(refusedText(r?.refused, s, p), 'danger'); return false; }
    ev().stow = null;
    log(`stowaway ${s.name} hired for ${r.price} GP`);
    notify(t('MOD_VOY_STOW_HIRED', { name: s.name, gp: gpText(r.price ?? p ?? 0), rank: rank() }));
    redraw();
    return true;
  };
  /** The popup when it climbs out: Hire, or Not now (it goes ashore where you next land; Hire stays on the page). */
  const askStow = () => {
    const s = stowaway();
    if (s === undefined) return;
    const p = price();
    const why = hireRefusal();
    // Hire and Not now as a band (build .386; the user, 21 Oct 2026: both options sat in one sentence): the price
    // marked on the Hire row with the licence, slot or coin refusal in amber, the cost of waiting on the Not now row.
    const refusal = why !== undefined && why !== '' ? ` <span class="text-warning">${esc(why)}</span>` : '';
    const ways = helpLayout.waysHtml('', [
      { icon: gpIcon(), lead: t('MOD_VOY_STOW_HIRE_HEAD'), html: marked(t, 'MOD_VOY_STOW_HIRE_LINE', { rank: rank(), share: `${Math.round(EM.STOWAWAY_PRICE_SHARE * 100)}` }, { gp: gpMark(p ?? 0) }) + refusal },
      { icon: 'fa-anchor', lead: t('MOD_VOY_STOW_LATER_HEAD'), html: marked(t, 'MOD_VOY_STOW_LATER_LINE', {}, { name: mark.name(s.name) }) },
    ]);
    const open = () => fire({
      title: t('MOD_VOY_STOW_TITLE'),
      imageUrl: portrait() ?? hullPic(),
      html: helpLayout.msgHtml([marked(t, 'MOD_VOY_STOW_TEXT', {}, { name: mark.name(s.name) })]) + ways,
      didOpen: () => { if (why !== undefined && why !== '') confirmOff(); },
      showCancelButton: true,
      confirmButtonText: t('MOD_VOY_STOW_HIRE', { name: s.name, gp: gpText(p ?? 0) }),
      cancelButtonText: t('MOD_VOY_STOW_LATER'),
    }).then((r) => { if (r.isConfirmed) { try { hire(); } catch (e) { log('stowaway hire failed', e); } } });
    try { if (state.whenNoModal) state.whenNoModal(open); else open(); } catch (e) { log('stowaway popup failed', e); }
  };
  /**
   * A voyage reached the stowaway's hex: it climbs out, if the vessel you are in and every vessel the rest of the
   * voyage uses (`kinds`) have a berth for one more, so no later leg (a row ashore in the boat) is refused for it.
   */
  const stowFound = (kinds = []) => {
    const e = ev();
    const inV = state.crew?.inVessel?.();
    if (!canHire() || e === undefined || e.stow != null || inV === undefined) return;
    const n = (state.crew?.count?.() ?? 0) + 1;
    const full = [inV, ...kinds].find((kind) => n > (state.crew?.berthsFor?.(kind) ?? 0));
    if (full !== undefined) { log(`a stowaway stays hidden: no berth in the ${full}`); return; }
    const taken = (folks()?.folks?.() ?? []).map((f) => f.name);
    const name = EM.stowawayName(Math.random(), taken);
    // Found offline (build .386: the replay put it ashore on the arrival second, so Hire never showed): it stays hidden
    // until you are back, asks then, and only goes ashore on an online tick. `v` is the vessel it hides in (M2-13).
    const off = offlineNow();
    e.stow = { name, v: inV, ...(off ? { ask: true } : {}) };
    log(`a stowaway climbs out: ${name}`);
    if (off) away(`<span class="text-warning">${esc(t('MOD_VOY_STOW_AWAY_HEAD'))}</span>: ${esc(t('MOD_VOY_STOW_AWAY', { name }))}`);
    else askStow();
    redraw();
  };
  /** Once a second: on land or a port, not under way nor adrift, the stowaway slips ashore (online only). */
  let ticks = 0;
  const tick = () => {
    ticks += 1;
    if (ticks < 20) return;
    ticks = 0;
    const e = record()?.events;
    if (e?.stow == null) return;
    if (!canHire() || offlineNow()) return;
    if (e.stow.ask === true) { delete e.stow.ask; askStow(); return; }
    if (state.clock?.running?.() === true || state.adrift?.isAdrift?.() === true) return;
    const pos = state.position?.();
    // A port counts as land: some ports' quays are on the water, where the big ship lies.
    if (pos === undefined || (seaAt(pos) && !shipModel.isPort(state.recordAt?.(pos)))) return;
    const s = ev()?.stow;
    if (s == null) return;
    const name = s.name;
    ev().stow = null;
    log(`stowaway ${name} went ashore`);
    if (offlineNow()) away(`<span class="text-warning">${esc(t('MOD_VOY_STOW_AWAY_HEAD'))}</span>: ${esc(t('MOD_VOY_STOW_LEFT', { name }))}`);
    else notify(t('MOD_VOY_STOW_LEFT', { name }));
    redraw();
  };

  const out = { model: EM, rank, canHire, force, stowaway, stowRoll, stowFound, price, hireRefusal, hire, askStow, tick };
  state.events = out;
  return out;
}
