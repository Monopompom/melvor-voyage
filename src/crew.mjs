// The crew in the game (phase 6c): Folks who go along with you. They come aboard from within a hex, ride in your
// vessel's berths, eat from the stores and burn fuel like you, go hungry with you, and are put ashore to work where you
// stand. Worker Folks keeps them (travel 'with'); the rules are pure (src/crew-model.mjs).
//
// A crew Folk doesn't work and doesn't heal on the road (Worker Folks), and earns no Voyage XP. The crew changes only
// while you stand still: not under way on a voyage, not adrift.

// Modal buttons as the rest of Voyage's: confirm green, cancel blue outline.
const SWAL_CLASS = { popup: 'voyage-ui', confirmButton: 'btn btn-success m-1', cancelButton: 'btn btn-outline-info m-1' };

export function install(ctx, { state, CM, shipModel, terrainMod, helpLayout, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const api = () => (state.folksGuarded ? state.folksApi?.() : undefined);
  const on = () => state.active?.() === true && api() !== undefined;
  const hexDistance = (a, b) => terrainMod.hexDistance(a, b);

  /** The Folks with you, as Worker Folks views. */
  const list = () => (on() ? api().folks().filter((f) => f.travel === 'with') : []);
  const count = () => list().length;
  /** The crew's load on the stores: { count, food } (food by rank, crew-model FOOD_SHARE). */
  const load = () => CM.crewLoad(list());
  /** Berths in a vessel kind ('boat' | 'ship'), 0 without it. */
  const berthsFor = (kind) => CM.berthsOf(state.ship?.vessel?.(kind)?.hull);
  /** The vessel you are in now, or undefined ashore. */
  const inVessel = () => state.ship?.inVessel?.();
  const atSea = () => shipModel.isSea(state.recordAt(state.position()));
  /** Folks standing within 1 hex who could come along, nearest first (not one walking alone, 6d). */
  const near = () => {
    const pos = state.position();
    if (!on() || pos === undefined) return [];
    return api().folks()
      .filter((f) => f.travel === 'idle' && f.place !== null && hexDistance(pos, f.place) <= 1)
      .sort((a, b) => hexDistance(pos, a.place) - hexDistance(pos, b.place) || a.slot - b.slot);
  };
  /** Why the crew can't change now, or undefined: under way on a voyage, or adrift. */
  const busy = () => {
    if (state.clock?.running?.() === true) return t('MOD_VOY_CREW_BUSY_VOYAGE');
    if (state.adrift?.isAdrift?.() === true) return t('MOD_VOY_CREW_BUSY_ADRIFT');
    return undefined;
  };
  /** Why this Folk can't come along now, or undefined. At sea it needs a free berth in the vessel you are in. */
  const comeRefusal = (id) => {
    const why = busy();
    if (why !== undefined) return why;
    const kind = inVessel();
    if (atSea() && kind !== undefined) {
      const berths = berthsFor(kind);
      if (count() >= berths) return t(berths === 1 ? 'MOD_VOY_CREW_NO_BERTH_ONE' : 'MOD_VOY_CREW_NO_BERTH', { hull: state.ship.hullName(state.ship.vessel(kind)), berths: `${berths}` });
    }
    const f = api()?.folkById(id);
    if (f === undefined || f.travel !== 'idle') return '';
    return undefined;
  };
  const comeAlong = (id) => {
    if (!on()) return false;
    const why = comeRefusal(id);
    if (why !== undefined) { if (why !== '') notify(why, 'danger'); return false; }
    const f = api().folkById(id);
    if (!api().setTravel(id, 'with')) return false;
    log(`${f.name} comes along`);
    return true;
  };
  /** Why you can't put a Folk ashore here, or undefined: on land only (a coast hex, a port), and not under way. */
  const ashoreRefusal = () => busy() ?? (atSea() ? t('MOD_VOY_CREW_ASHORE_SEA') : undefined);
  /** Puts a Folk down on your hex, then on `skillId` (null: nothing yet). False when refused. */
  const putAshore = (id, skillId) => {
    const pos = state.position();
    if (!on() || pos === undefined) return false;
    const why = ashoreRefusal();
    if (why !== undefined) { notify(why, 'danger'); return false; }
    const f = api().folkById(id);
    if (f === undefined || f.travel !== 'with') return false;
    api().setTravel(id, 'idle');
    api().setPlace(id, { q: pos.q, r: pos.r });
    log(`${f.name} put ashore at (${pos.q},${pos.r})`);
    if (skillId !== null && skillId !== undefined && !api().assign(id, skillId)) log(`${f.name}: ${skillId} refused here`);
    return true;
  };

  /**
   * Put ashore: a dialog with the work this hex allows (the skills a Folk can be given that aren't locked here), and
   * "Nothing yet". A skill another Folk holds says so: picking it moves that skill to this Folk, as the Worker box does.
   * `done` redraws the page.
   */
  const askAshore = (id, done) => {
    const f = on() ? api().folkById(id) : undefined;
    if (f === undefined || f.travel !== 'with') return;
    const why = ashoreRefusal();
    if (why !== undefined) { notify(why, 'danger'); return; }
    const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const holderName = (hid) => api().folkById(hid)?.name ?? '';
    const skills = api().skills().filter((sk) => state.skillLockedHere?.(sk.id) !== true);
    const options = [`<option value="">${esc(t('MOD_VOY_CREW_WORK_NOTHING'))}</option>`,
      ...skills.map((sk) => `<option value="${esc(sk.id)}">${esc(sk.holder === null || sk.holder === id ? sk.name : t('MOD_VOY_CREW_WORK_HELD', { skill: sk.name, name: holderName(sk.holder) }))}</option>`)];
    const html = helpLayout.msgHtml([t('MOD_VOY_CREW_ASHORE_TEXT', { name: `<b>${esc(f.name)}</b>` })]) +
      `<div class="voyage-crew-work mt-2"><label for="voyage-crew-work" class="font-w600 mb-1">${esc(t('MOD_VOY_CREW_WORK_LABEL'))}</label>` +
      `<select id="voyage-crew-work" class="form-control">${options.join('')}</select></div>` +
      (skills.length === 0 ? `<small class="d-block text-muted mt-1">${esc(t('MOD_VOY_CREW_WORK_NONE'))}</small>` : '');
    SwalLocale.fire({
      didRender: state.popupDidRender,
      customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass(SWAL_CLASS) : SWAL_CLASS,
      title: t('MOD_VOY_CREW_ASHORE_TITLE'),
      html,
      showCancelButton: true,
      confirmButtonText: t('MOD_VOY_CREW_ASHORE_BUTTON'),
      cancelButtonText: t('MOD_VOY_CREW_ASHORE_CANCEL'),
      preConfirm: () => document.getElementById('voyage-crew-work')?.value ?? '',
    }).then((r) => {
      if (!r.isConfirmed) return;
      try { if (putAshore(id, r.value === '' ? null : r.value)) done?.(); } catch (e) { log('put ashore failed', e); }
    });
  };

  /** The first step of a move the crew has no berths for, or undefined. Checked before the stores (movePlayer). */
  const berthRefusal = (steps) => {
    const n = count();
    return n > 0 && Array.isArray(steps) ? CM.berthRefusal(steps, n, berthsFor) : undefined;
  };
  const refuseBerths = (r) => {
    const v = state.ship?.vessel?.(r.vessel);
    const hull = v == null ? t('MOD_VOY_SHIP_BOAT') : state.ship.hullName(v);
    notify(t(r.berths === 1 ? 'MOD_VOY_CREW_REFUSE_BERTHS_ONE' : 'MOD_VOY_CREW_REFUSE_BERTHS', { hull, berths: `${r.berths}`, crew: `${count()}` }), 'danger');
  };
  /** After a move landed: every hungry step costs each Folk with you a tenth of its max HP; hunger can kill. */
  const afterMove = (steps) => {
    if (!on() || !Array.isArray(steps)) return;
    const hungry = steps.filter((s) => s.hungry === true).length;
    if (hungry === 0) return;
    for (const f of list()) {
      const each = CM.hungerDamage(f.maxHp);
      const r = api().hurt(f.id, each * hungry, { cause: 'hunger' });
      if (r === undefined) continue;
      log(`${f.name} goes hungry for ${hungry} hex(es): -${each * hungry} HP${r.dead ? ', died' : ''}`);
      if (!r.dead) notify(t('MOD_VOY_CREW_HUNGRY', { name: f.name, hp: `${each * hungry}` }), 'warning');
    }
  };

  const notify = (text, kind) => {
    try {
      if (kind === 'danger') game.notifications.createErrorNotification('voyage:crew', text);
      else game.notifications.createInfoNotification('voyage:crew', text, ctx.getResourceUrl('assets/icon.svg'));
    } catch {}
  };

  const out = { list, count, load, berthsFor, inVessel, near, busy, comeRefusal, comeAlong, ashoreRefusal, putAshore, askAshore, berthRefusal, refuseBerths, afterMove };
  state.crew = out;
  return out;
}
