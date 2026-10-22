// Events that ask (the flat mechanics, build .378): pirates meeting the big ship on the open sea, and a stowaway found
// aboard on a long crossing. Each asks for a choice with a cost either way. The rules are pure (src/events-model.mjs);
// the voyage holds while pirates wait for an answer (voyage-clock.mjs), and the stowaway rides as crew (crew.mjs).
//
// Pirates: pay a share of the hold's worth in GP, or run (a stormy hex's wear and one hex more of sailing). Offline the
// choice is made for you and told in Welcome Back. The stowaway: hire it as a Trainee at half the Shop's price
// (Worker Folks API v6), or it goes ashore at the next port or land you stand on; until then it takes a berth and eats.

// Paying the pirates is the costly button: filled amber, readable in Light too (an amber outline was too pale there).
// Run costs hull and a hex: a red outline (build .386). The stowaway's Hire is green, Not now blue outline.
const SWAL_CLASS = { popup: 'voyage-ui', confirmButton: 'btn btn-warning m-1', denyButton: 'btn btn-outline-danger m-1', cancelButton: 'btn btn-outline-info m-1' };

export function install(ctx, { state, EM, S, shipModel, helpLayout, rankName, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const gpText = (n) => { try { return numberWithCommas(Math.round(n)); } catch { return `${Math.round(n)}`; } };
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
  const hullIcon = () => `<img src="${ctx.getResourceUrl('assets/hull_condition.webp')}" alt="">`;

  // ---- pirates -----------------------------------------------------------------------------------------------------
  /** The GP your holds would sell for: the big ship's, and the boat's when it rides aboard. */
  const holdWorth = () => {
    let sum = 0;
    const kinds = ['ship', ...(state.ship?.vessel?.('boat')?.aboard === true ? ['boat'] : [])];
    for (const kind of kinds) {
      for (const e of state.hold?.contents?.(kind) ?? []) {
        try { if (e.item.sellsFor.currency === game.gp) sum += e.item.sellsFor.quantity * e.qty; } catch {}
      }
    }
    return sum;
  };
  // The dev console's voyageDev.event(kind): the next chance of that kind comes true (once).
  const forced = { pirates: false, stowaway: false };
  const force = (kind) => { if (!(kind in forced)) return `pirates or stowaway, not ${kind}`; forced[kind] = true; return `${kind}: the next chance comes true`; };
  /** Whether pirates meet this step (the roll made here). */
  const meet = (step) => {
    if (forced.pirates && EM.piratesMeet(step, 0)) { forced.pirates = false; return true; }
    return EM.piratesMeet(step, Math.random());
  };
  /** What they ask: { toll, wear, crates, loss }, `hexGp` the GP the game charged for the hex; `loss` the crates a run throws overboard (build .387). */
  const crates = () => state.hold?.hold?.('ship')?.length ?? 0;
  // The gear's pirate cut (gear.mjs) lowers what they ask, never what a run costs.
  const tollOf = (toll) => { try { return state.gear?.tollOf?.(toll) ?? toll; } catch { return toll; } };
  const offer = (hexGp) => { const n = crates(); return { toll: tollOf(EM.pirateToll(holdWorth(), hexGp, game.gp.amount)), wear: EM.pirateRunWear(S.WEAR.deep), crates: n, loss: EM.pirateRunLoss(n) }; };
  const cond = () => state.ship?.cond?.('ship') ?? 0;
  /** Pays the toll; false (and a notice) when the GP falls short. */
  const pay = (pir) => {
    if (!(game.gp.amount >= pir.toll)) { if (!offlineNow()) notify(t('MOD_VOY_PIRATES_SHORT', { gp: gpText(pir.toll) }), 'danger'); return false; }
    game.gp.remove(pir.toll);
    log(`pirates paid off: ${pir.toll} GP`);
    const text = t('MOD_VOY_PIRATES_PAID', { gp: gpText(pir.toll) });
    if (offlineNow()) away(`<span class="text-danger">${esc(t('MOD_VOY_PIRATES_AWAY_HEAD'))}</span>: ${esc(text)}`);
    else notify(text);
    return true;
  };
  /** Runs before the wind: the hull's wear now, one crate in ten overboard (build .387); the clock adds the hex of sailing. */
  const run = (pir) => {
    const to = EM.condAfterRun(cond(), pir.wear);
    state.ship?.setCond?.(to, 'ship');
    const gone = state.hold?.jettison?.(EM.pirateRunLoss(crates()), 'ship') ?? [];
    log(`ran from pirates: -${pir.wear}% hull, now ${to}%, ${gone.length} crate(s) overboard`);
    const vars = { hull: state.ship?.hullName?.(state.ship?.vessel?.('ship')) ?? '', wear: `${pir.wear}`, cond: `${to}`, crates: `${gone.length}` };
    const text = t(gone.length > 0 ? 'MOD_VOY_PIRATES_RAN_CRATES' : 'MOD_VOY_PIRATES_RAN', vars);
    if (offlineNow()) away(`<span class="text-danger">${esc(t('MOD_VOY_PIRATES_AWAY_HEAD'))}</span>: ${esc(text)}`);
    else notify(text, to < EM.PIRATE_SOUND ? 'danger' : 'info');
    return true;
  };
  let asking = false;
  /**
   * The question while a voyage holds for pirates (each voyage tick): offline the choice is made at once; online the
   * popup, asked again if something else closed it. `answer(how)` gets 'pay' or 'run'.
   */
  const ask = (pir, answer) => {
    if (offlineNow()) { answer(EM.pirateChoice({ cond: cond(), wear: pir.wear, gp: game.gp.amount, toll: pir.toll })); return; }
    if (asking) return;
    asking = true;
    const open = () => {
      const short = !(game.gp.amount >= pir.toll);
      const to = EM.condAfterRun(cond(), pir.wear);
      // The two answers as a band (build .386; the user, 21 Oct 2026: "three plain centred lines"): the Adrift block's
      // Ways out look, Pay with the coin and Run with the hull, the figures marked; the hold line plain under it.
      const ways = helpLayout.waysHtml('', [
        { icon: gpIcon(), lead: t('MOD_VOY_PIRATES_PAY_HEAD'), html: marked(t, 'MOD_VOY_PIRATES_PAY_LINE', { pct: `${Math.round(EM.PIRATE_SHARE * 100)}`, coin: `${EM.PIRATE_COIN_SHARE * 100}`, hexes: `${EM.PIRATE_FLOOR_HEXES}` }, { gp: gpMark(pir.toll) }) },
        { icon: hullIcon(), lead: t('MOD_VOY_PIRATES_RUN_HEAD'), html: marked(t, pir.loss > 0 ? 'MOD_VOY_PIRATES_RUN_LINE_CRATES' : 'MOD_VOY_PIRATES_RUN_LINE', { total: `${pir.crates}` }, { wear: `<b class="text-warning">${pir.wear}%</b>`, cond: `<b class="${to < EM.PIRATE_SOUND ? 'text-danger' : ''}">${to}%</b>`, crates: `<b class="text-warning">${pir.loss}</b>` }) },
      ]);
      fire({
        title: t('MOD_VOY_PIRATES_TITLE'),
        imageUrl: hullPic(),
        html: helpLayout.msgHtml([
          marked(t, 'MOD_VOY_PIRATES_TEXT', {}, { hull: mark.name(state.ship?.hullName?.(state.ship?.vessel?.('ship')) ?? '') }),
        ]) + ways + helpLayout.msgHtml([
          ...(short ? [`<span class="text-warning">${esc(t('MOD_VOY_PIRATES_SHORT', { gp: gpText(pir.toll) }))}</span>`] : []),
          esc(t('MOD_VOY_PIRATES_HOLD')),
        ]),
        didOpen: () => { if (short) confirmOff(); },
        allowOutsideClick: false,
        allowEscapeKey: false,
        showDenyButton: true,
        confirmButtonText: t('MOD_VOY_PIRATES_PAY', { gp: gpText(pir.toll) }),
        denyButtonText: t('MOD_VOY_PIRATES_RUN'),
        preConfirm: () => {
          if (game.gp.amount >= pir.toll) return true;
          Swal.showValidationMessage(esc(t('MOD_VOY_PIRATES_SHORT', { gp: gpText(pir.toll) })));
          return false;
        },
      }).then((r) => {
        asking = false;
        if (r.isConfirmed) answer('pay');
        else if (r.isDenied) answer('run');
        // Closed by another popup: the next tick asks again.
      }, () => { asking = false; });
    };
    try { if (state.whenNoModal) state.whenNoModal(open); else open(); } catch (e) { asking = false; log('pirates popup failed', e); }
  };
  const refuseWhileAsked = () => notify(t('MOD_VOY_PIRATES_FIRST'), 'danger');

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
    }, { ...SWAL_CLASS, confirmButton: 'btn btn-success m-1' }).then((r) => { if (r.isConfirmed) { try { hire(); } catch (e) { log('stowaway hire failed', e); } } });
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

  const out = { model: EM, rank, canHire, force, meet, offer, ask, pay, run, refuseWhileAsked, holdWorth, stowaway, stowRoll, stowFound, price, hireRefusal, hire, askStow, tick };
  state.events = out;
  return out;
}
