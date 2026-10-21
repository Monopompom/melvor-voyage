// Outposts (phase 6e), the game side. Rules in outpost-model.mjs.
//
// A Tent is an item from the Voyage shop (Voyage 30). Pitched from the Here panel on the land hex you stand on, where
// one of your Folks is placed, it leaves the bank and the hex becomes an outpost: the terrain reads it as a camp
// (state.terrain.setAdditions, over the table and the winter ice), so the rule table, grace, loading and every Folk on
// it follow; a tent stands on the map at the hex's lower left; the Journal lists it with the places, and Send a Folk
// can pick it. Its store holds food and fuel outside your carry limit, shared from within a hex. Striking camp (within
// a hex) puts the tent back in the bank and the store back in your stores up to the limit; the Folks stay. Outposts
// live in the Voyage save (v21) as { "q,r": { food, fuel, at, build? } }.
//
// Pitching is not instant (build .367, the user): one Folk on the hex puts the tent up over BUILD_MS, online and
// offline, its skill set aside meanwhile (a second Folk there keeps working) and given back when the tent is up. Until
// then the hex is no camp and the tent stands faded on the map. Cancel gives the Tent back; the builder moved, sent
// off, given a skill or fired stops the work and the Tent goes back to the bank too.

const SWAL_CLASS = { popup: 'voyage-ui', confirmButton: 'btn btn-success m-1', cancelButton: 'btn btn-outline-info m-1' };
const SWAL_DANGER = { ...SWAL_CLASS, confirmButton: 'btn btn-danger m-1' };

export function install(ctx, { state, O, terrainMod, helpLayout, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hexDistance = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
  const same = (a, b) => a != null && b != null && a.q === b.q && a.r === b.r;
  const swalClass = (c) => (typeof createSwalCustomClass === 'function' ? createSwalCustomClass(c) : c);
  const media = () => ctx.getResourceUrl('assets/tent.webp');

  const skill = () => state.voyageSkill?.();
  const record = () => { const s = skill(); return s !== undefined && s.futureRaw === undefined ? s.record : undefined; };
  const level = () => skill()?.level ?? 1;
  /** The pitched tents, cleaned: { "q,r": { food, fuel, at, build? } }, the ones going up too. */
  const outposts = () => O.cleanOutposts(record()?.outposts);
  const now = () => { try { return state.clockNow?.() ?? Date.now(); } catch { return Date.now(); } };
  const folksApi = () => (state.folksGuarded ? state.folksApi?.() : undefined);
  const usable = () => state.mode !== 'dormant' && record() !== undefined && state.terrain !== undefined;
  const provisions = () => state.stores?.enabled?.() === true;

  const tentItem = () => { try { return game.items.getObjectByID(`voyage:${O.TENT.id}`); } catch { return undefined; } };
  const tents = () => { const it = tentItem(); try { return it === undefined ? 0 : game.bank.getQty(it); } catch { return 0; } };

  // ---- words ---------------------------------------------------------------------------------------------------------
  const hexText = (h) => { try { const o = new HexCoords(h.q, h.r).to_oddq(); return `(${o.col}, ${o.row})`; } catch { return `(${h.q}, ${h.r})`; } };
  /** "Outpost, Grasslands (13, 15)": the land under the camp, as the table has it. */
  const nameOf = (h) => {
    const rec = state.terrain?.base(h.q, h.r);
    let land = '';
    try { land = rec === undefined ? '' : getLangString(terrainMod.recKey(rec)); } catch {}
    return t('MOD_VOY_OUTPOST_NAME', { land, hex: hexText(h) }).trim();
  };
  let noteN = 0;
  const notify = (text, kind = 'success') => {
    try {
      if (kind === 'danger') game.notifications.createErrorNotification(`voyage:outpost:${noteN++}`, text);
      else game.notifications.createSuccessNotification(`voyage:outpost:${noteN++}`, text, media());
    } catch {}
  };

  // ---- the camps on the map's table ----------------------------------------------------------------------------------
  /** Lays the camps over the terrain and redraws what reads it. */
  const sync = () => {
    if (state.terrain === undefined) return;
    const recs = Object.keys(O.standing(outposts())).map((k) => O.campRecord({ ...O.parseKey(k), f: [] }));
    state.terrain.setAdditions(recs);
    try { state.knowledge?.bump?.(); } catch {}
    try { state.overlay?.refresh?.(); } catch {}
    refreshMarkers();
  };
  const changed = () => {
    try { const s = skill(); if (s !== undefined) s.renderQueue.page = true; } catch {}
    state.onSettingsChange();
  };
  const setOutposts = (next, places) => {
    const r = record();
    if (r === undefined) return;
    r.outposts = next;
    if (places) sync();
    changed();
  };

  // ---- pitching ------------------------------------------------------------------------------------------------------
  /** Your Folks placed on this hex who could put a tent up: not with you, not walking through, not on strike or resting. */
  const folksOn = (pos) => {
    try {
      return (folksApi()?.folks() ?? []).filter((f) => f.travel !== 'with' && f.travel !== 'walking' && f.status !== 'strike' && f.status !== 'cooldown' && same(f.place, pos));
    } catch { return []; }
  };
  const folkOn = (pos) => folksOn(pos).length > 0;
  const duration = (ms) => {
    const m = Math.max(1, Math.ceil(ms / 60000));
    return m >= 60 ? t('MOD_VOY_CLOCK_H_M', { h: `${Math.floor(m / 60)}`, m: `${m % 60}` }) : t('MOD_VOY_CLOCK_M', { m: `${m}` });
  };
  /** What a tent may do where you stand: the model's answer, or 'busy' while under way or adrift. */
  const pitchHere = () => {
    const pos = state.position();
    if (!usable() || pos === undefined) return 'unknown';
    const act = O.pitchAction({ tents: tents(), outposts: outposts(), level: level(), rec: state.terrain.base(pos.q, pos.r), folkHere: folkOn(pos) });
    if (act === 'pitch' && state.crew?.busy?.() !== undefined) return 'busy';
    return act;
  };
  /** Starts the tent going up: the builder sets its skill aside (the work stops) until the tent is up. */
  const pitch = () => {
    if (pitchHere() !== 'pitch') return false;
    const pos = state.position();
    const folk = O.pickBuilder(folksOn(pos));
    const item = tentItem();
    if (folk === undefined || item === undefined) return false;
    const skill = folk.skillId;
    if (skill !== null && folksApi()?.assign(folk.id, null) === false) return false;
    game.bank.removeItemQuantity(item, 1, true);
    setOutposts({ ...outposts(), [O.keyOf(pos.q, pos.r)]: O.newOutpost(now(), folk.id, skill) }, false);
    refreshMarkers();
    log(`tent going up at (${pos.q},${pos.r}) by ${folk.name}${skill === null ? '' : `, ${skill} set aside`}`);
    notify(t('MOD_VOY_OUTPOST_BUILD_START', { name: folk.name, time: duration(O.BUILD_MS) }));
    return true;
  };
  /** The builder gets back the skill it set aside, when that is still its kept job and nobody else took it. */
  const giveBack = (b) => {
    const api = folksApi();
    if (api === undefined || b.skill === null) return;
    const holder = api.skills().find((sk) => sk.id === b.skill)?.holder ?? null;
    if (holder !== null && holder !== b.folk) return;
    const folk = api.folkById(b.folk);
    if (folk === undefined || !api.assign(b.folk, b.skill)) log(`tent builder ${b.folk}: ${b.skill} not given back`);
  };
  /** A tent going up stops: the record goes, the Tent goes back to the bank. `why` 'cancel' gives the skill back. */
  const stopBuild = (key, why) => {
    const all = outposts();
    const o = all[key];
    const item = tentItem();
    if (!O.isBuilding(o) || item === undefined) return false;
    delete all[key];
    setOutposts(all, false);
    refreshMarkers();
    game.bank.addItem(item, 1, false, true, true, true, 'Voyage');
    const name = nameOf(O.parseKey(key));
    log(`tent at ${key} not put up (${why})`);
    if (why === 'cancel') { giveBack(o.build); notify(t('MOD_VOY_OUTPOST_BUILD_CANCELLED', { name })); }
    else notify(t('MOD_VOY_OUTPOST_BUILD_STOPPED', { name }), 'danger');
    return true;
  };
  /** The tent is up: the hex is a camp now, and the builder goes back to its skill. */
  const finishBuild = (key) => {
    const all = outposts();
    const o = all[key];
    if (!O.isBuilding(o)) return;
    const { build, ...rest } = o;
    all[key] = rest;
    setOutposts(all, true);
    giveBack(build);
    log(`tent up at ${key}`);
    notify(t('MOD_VOY_OUTPOST_PITCHED', { name: nameOf(O.parseKey(key)) }));
  };
  /** The tents going up: [{ key, q, r, name, left, folk }]. */
  const building = () => Object.entries(outposts()).filter(([, o]) => O.isBuilding(o))
    .map(([key, o]) => ({ key, ...O.parseKey(key), name: nameOf(O.parseKey(key)), left: O.buildLeft(o, now()), folk: o.build.folk }));
  /** Each second: a tent whose work is done goes up, one whose builder left goes back to the bank. */
  let shown = '';
  const tick = () => {
    if (!usable()) return;
    const api = folksApi();
    if (api === undefined) return;
    for (const [key, o] of Object.entries(outposts())) {
      if (!O.isBuilding(o)) continue;
      const step = O.buildStep(o, key, api.folkById(o.build.folk), now());
      if (step === 'up') finishBuild(key);
      else if (step === 'stop') stopBuild(key, 'left');
    }
    // The Here panel's "N min left" follows the minutes.
    const sig = building().map((b) => `${b.key}:${duration(b.left)}`).join('|');
    if (sig !== shown) { shown = sig; try { state.herePanel?.render?.(); } catch {} try { api.refresh(); } catch {} }
  };
  setInterval(() => { try { tick(); } catch (e) { log('tent building failed', e); } }, 1000);
  /** The card's line for a Folk putting a tent up, or undefined. */
  const builderText = (folkId) => {
    const b = building().find((x) => x.folk === folkId);
    return b === undefined ? undefined : t('MOD_VOY_OUTPOST_BUILD_CARD', { time: duration(b.left) });
  };

  // ---- the outposts near you ---------------------------------------------------------------------------------------
  /** Every outpost that is up: [{ key, q, r, name, food, fuel, at }], in the order pitched. */
  const list = () => Object.entries(O.standing(outposts()))
    .map(([key, o]) => ({ key, ...O.parseKey(key), name: nameOf(O.parseKey(key)), food: o.food, fuel: o.fuel, at: o.at }))
    .sort((a, b) => a.at - b.at);
  /** The outposts within a hex of you, your own hex first. */
  const near = () => {
    const pos = state.position();
    if (!usable() || pos === undefined) return [];
    return list().filter((o) => hexDistance(pos, o) <= 1).sort((a, b) => hexDistance(pos, a) - hexDistance(pos, b));
  };
  const nearOne = (key) => near().find((o) => o.key === key);

  // ---- the store -----------------------------------------------------------------------------------------------------
  /** Shares food and fuel with the tent's store: you carry `carry`, the rest stays. False when refused. */
  const share = (key, carry) => {
    const o = nearOne(key);
    if (o === undefined || !provisions()) return false;
    const out = O.share(state.stores.stores(), o, carry, state.stores.capacity());
    state.stores.set(out.have.food, out.have.fuel);
    const all = outposts();
    all[key] = { ...all[key], food: out.store.food, fuel: out.store.fuel };
    setOutposts(all, false);
    log(`outpost ${key} store: ${out.store.food} food, ${out.store.fuel} fuel`);
    return true;
  };
  const askStore = (key, done) => {
    const o = nearOne(key);
    if (o === undefined || !provisions()) return;
    const have = state.stores.stores();
    const cap = state.stores.capacity();
    const most = { food: Math.min(have.food + o.food, Math.max(cap.food, have.food)), fuel: Math.min(have.fuel + o.fuel, Math.max(cap.fuel, have.fuel)) };
    const row = (kind) => {
      const label = t(kind === 'food' ? 'MOD_VOY_OUTPOST_STORE_FOOD' : 'MOD_VOY_OUTPOST_STORE_FUEL');
      const step = kind === 'food' ? 1 : 0.1;
      return `<div class="voyage-outpost-row"><label for="voyage-outpost-${kind}" class="font-w600">${esc(label)}</label>`
        + `<input id="voyage-outpost-${kind}" type="number" min="0" max="${most[kind]}" step="${step}" inputmode="decimal" class="form-control voyage-outpost-qty" value="${have[kind]}">`
        + `<span class="voyage-outpost-of text-muted">${esc(t('MOD_VOY_OUTPOST_STORE_OF', { n: kind === 'food' ? state.stores.hp(most[kind]) : state.stores.fuelText(most[kind]) }))}</span>`
        + `<span class="voyage-outpost-quick"><button type="button" class="btn btn-sm btn-outline-info" data-outpost-fill="${kind}" data-value="${most[kind]}">${esc(t('MOD_VOY_OUTPOST_STORE_TAKE_ALL'))}</button>`
        + `<button type="button" class="btn btn-sm btn-outline-info" data-outpost-fill="${kind}" data-value="0">${esc(t('MOD_VOY_OUTPOST_STORE_LEAVE_ALL'))}</button></span></div>`;
    };
    const html = helpLayout.msgHtml([
      // One sentence a line (build .367, the user): the tent's half no longer wraps in after yours.
      t('MOD_VOY_OUTPOST_STORE_YOU', { have: state.stores.icons(have.food, have.fuel) }),
      t('MOD_VOY_OUTPOST_STORE_TENT', { store: state.stores.icons(o.food, o.fuel) }),
    ]) + `<div class="voyage-outpost-share mt-3">${row('food')}${row('fuel')}</div>`
      + `<small class="d-block text-muted mt-2">${esc(t('MOD_VOY_OUTPOST_STORE_HINT', { amounts: state.stores.amounts(cap.food, cap.fuel) }))}</small>`;
    SwalLocale.fire({
      didRender: (el) => {
        try { state.popupDidRender?.(el); } catch {}
        const box = el?.querySelector?.('.voyage-outpost-share');
        if (box == null || box.dataset.voyageBound === '1') return;
        box.dataset.voyageBound = '1';
        box.addEventListener('click', (e) => {
          const b = e.target instanceof Element ? e.target.closest('[data-outpost-fill]') : null;
          if (b === null) return;
          const input = document.getElementById(`voyage-outpost-${b.dataset.outpostFill}`);
          if (input !== null) input.value = b.dataset.value;
        });
      },
      customClass: swalClass(SWAL_CLASS),
      title: o.name,
      html,
      showCancelButton: true,
      confirmButtonText: t('MOD_VOY_OUTPOST_STORE_BUTTON'),
      cancelButtonText: t('MOD_VOY_OUTPOST_CANCEL'),
      preConfirm: () => ({
        food: Number(document.getElementById('voyage-outpost-food')?.value ?? have.food),
        fuel: Number(document.getElementById('voyage-outpost-fuel')?.value ?? have.fuel),
      }),
    }).then((res) => {
      if (!res.isConfirmed || res.value == null) return;
      try { if (share(key, res.value)) done?.(); } catch (e) { log('outpost store failed', e); }
    });
  };

  // ---- striking camp -----------------------------------------------------------------------------------------------
  const strike = (key) => {
    const o = nearOne(key);
    const item = tentItem();
    if (o === undefined || item === undefined) return false;
    if (provisions()) {
      const out = O.strike(state.stores.stores(), o, state.stores.capacity());
      state.stores.set(out.have.food, out.have.fuel);
    }
    const all = outposts();
    delete all[key];
    setOutposts(all, true);
    game.bank.addItem(item, 1, false, true, true, true, 'Voyage');
    log(`camp struck at ${key}`);
    notify(t('MOD_VOY_OUTPOST_STRUCK', { name: o.name }));
    return true;
  };
  const askStrike = (key, done) => {
    const o = nearOne(key);
    if (o === undefined) return;
    const lines = [t('MOD_VOY_OUTPOST_STRIKE_TEXT')];
    let lost;
    if (provisions() && (o.food > 0 || o.fuel > 0)) {
      const out = O.strike(state.stores.stores(), o, state.stores.capacity());
      lost = out.lost.food > 0 || out.lost.fuel > 0 ? out.lost : undefined;
      const back = { food: o.food - out.lost.food, fuel: o.fuel - out.lost.fuel };
      if (back.food > 0 || back.fuel > 0) lines.push(t('MOD_VOY_OUTPOST_STRIKE_BACK', { amounts: state.stores.icons(back.food, back.fuel) }));
      if (lost !== undefined) lines.push(`<span class="text-danger">${t('MOD_VOY_OUTPOST_STRIKE_LOST', { amounts: state.stores.icons(lost.food, lost.fuel) })}</span>`);
    }
    SwalLocale.fire({
      didRender: state.popupDidRender,
      customClass: swalClass(lost === undefined ? SWAL_CLASS : SWAL_DANGER),
      title: t('MOD_VOY_OUTPOST_STRIKE_TITLE', { name: o.name }),
      html: helpLayout.msgHtml(lines),
      showCancelButton: true,
      confirmButtonText: t('MOD_VOY_OUTPOST_STRIKE_BUTTON'),
      cancelButtonText: t('MOD_VOY_OUTPOST_CANCEL'),
    }).then((res) => { if (!res.isConfirmed) return; try { if (strike(key)) done?.(); } catch (e) { log('strike camp failed', e); } });
  };

  // ---- the Here panel ------------------------------------------------------------------------------------------------
  const btn = (act, key, cls, label) => `<button type="button" class="btn btn-sm ${cls} voyage-row-btn voyage-outpost-btn" data-outpost-act="${act}" data-outpost-key="${esc(key)}">${esc(label)}</button>`;
  /** The outposts within a hex (store, Strike camp) and the tent you carry (Pitch, or why not here). */
  const panelHtml = () => {
    if (!usable()) return '';
    const pos = state.position();
    let html = '';
    for (const o of near()) {
      const where = t(same(pos, o) ? 'MOD_VOY_OUTPOST_HERE' : 'MOD_VOY_OUTPOST_NEXT_DOOR');
      const store = provisions() ? ` ${state.stores.icons(o.food, o.fuel)}` : '';
      html += `<div class="voyage-here-ship voyage-outpost-line"><span><span class="voyage-here-label">${esc(t('MOD_VOY_OUTPOST_LABEL'))}</span> ${esc(where)}${store}</span>`
        + `<span class="voyage-outpost-btns">${provisions() ? btn('store', o.key, 'btn-outline-info', t('MOD_VOY_OUTPOST_STORE')) : ''}${btn('strike', o.key, 'btn-outline-danger', t('MOD_VOY_OUTPOST_STRIKE'))}</span></div>`;
    }
    for (const b of building()) {
      if (hexDistance(pos, b) > 1) continue;
      const folk = folksApi()?.folkById(b.folk);
      const text = t(same(pos, b) ? 'MOD_VOY_OUTPOST_BUILD_GOING' : 'MOD_VOY_OUTPOST_BUILD_GOING_NEXT', { name: folk?.name ?? '', time: duration(b.left) });
      html += `<div class="voyage-here-ship voyage-outpost-line"><span><span class="voyage-here-label">${esc(t('MOD_VOY_OUTPOST_TENT_LABEL'))}</span> ${esc(text)}</span>`
        + `<span class="voyage-outpost-btns">${btn('cancel', b.key, 'btn-outline-info', t('MOD_VOY_OUTPOST_CANCEL'))}</span></div>`;
    }
    const act = pitchHere();
    if (['no-tent', 'unknown', 'sea', 'pitched'].includes(act)) return html;
    let text;
    let cls = 'text-muted';
    if (act === 'pitch') { text = t('MOD_VOY_OUTPOST_CAN_PITCH'); cls = ''; }
    else if (act === 'no-folk') text = t('MOD_VOY_OUTPOST_NO_FOLK');
    else if (act === 'place') text = t('MOD_VOY_OUTPOST_PLACE');
    else if (act === 'busy') text = state.crew?.busy?.() ?? '';
    else if (act === 'full') {
      const max = O.maxOutposts(level());
      const next = O.nextOutpostLevel(level());
      text = max === 0 ? t('MOD_VOY_OUTPOST_LEVEL', { level: `${O.OUTPOST_LEVELS[0]}` })
        : t(next === null ? 'MOD_VOY_OUTPOST_FULL' : 'MOD_VOY_OUTPOST_FULL_NEXT', { n: `${max}`, level: `${next}` });
    }
    const pitchBtn = act === 'pitch' ? btn('pitch', '', 'btn-success', t('MOD_VOY_OUTPOST_PITCH')) : '';
    html += `<div class="voyage-here-ship voyage-outpost-line"><span><span class="voyage-here-label">${esc(t('MOD_VOY_OUTPOST_TENT_LABEL'))}</span> <span class="${cls}">${esc(text ?? '')}</span></span>${pitchBtn}</div>`;
    return html;
  };
  /** A click on one of the panel's outpost buttons. */
  const click = (el) => {
    const redraw = () => { try { state.herePanel?.render?.(); } catch {} };
    const key = el.dataset.outpostKey ?? '';
    if (el.dataset.outpostAct === 'pitch') { if (pitch()) redraw(); return; }
    if (el.dataset.outpostAct === 'cancel') { if (stopBuild(key, 'cancel')) redraw(); return; }
    if (el.dataset.outpostAct === 'store') { askStore(key, redraw); return; }
    if (el.dataset.outpostAct === 'strike') askStrike(key, redraw);
  };

  // ---- the tents on the map ----------------------------------------------------------------------------------------
  let tex;
  const sprites = new Map();
  const refreshMarkers = () => {
    try {
      if (typeof cartographyMap === 'undefined' || cartographyMap === null || tex === undefined) return;
      const layer = cartographyMap.markerLayer;
      const map = cartographyMap._lastDrawnMap ?? game.cartography?.activeMap;
      if (layer === undefined || map === undefined) return;
      // A tent going up stands faded until it is up.
      const want = usable() ? [...list(), ...building().map((b) => ({ ...b, going: true }))] : [];
      for (const [key, sp] of sprites) {
        if (want.some((o) => o.key === key)) continue;
        try { sp.destroy(); } catch {}
        sprites.delete(key);
      }
      // At the hex's lower left: the Folks count badge holds the lower right, a walker's boot the upper right and the
      // Crossroads Sign the upper left.
      const scale = (HexCoords.SQRT3 * map.hexScale.y) / tex.orig.height / 3.2;
      for (const o of want) {
        let sp = sprites.get(o.key);
        if (sp === undefined || sp.destroyed) {
          sp = new PIXI.Sprite(tex);
          sp.anchor.set(0.5, 1);
          sp.eventMode = 'none';
          sprites.set(o.key, sp);
        }
        if (sp.parent !== layer) layer.addChildAt(sp, 0);
        let hd;
        try { hd = cartographyMap.getHexDisplay(map.getHex(new HexCoords(o.q, o.r))); } catch {}
        sp.visible = hd !== undefined;
        if (!sp.visible) continue;
        sp.scale.set(scale);
        sp.alpha = o.going === true ? 0.45 : 1;
        // The Folks badge's mirror (build .367, the user: clear of the mastery bar): its centre sits 0.22 of the hex's
        // width and height off the middle, its radius 0.09 of the height; the tent stands where the badge ends.
        const tall = HexCoords.SQRT3 * map.hexScale.y;
        sp.x = hd.x - 2 * map.hexScale.x * 0.22;
        sp.y = hd.y + tall * (0.22 + 0.09);
      }
    } catch (e) { log('tent markers failed', e); }
  };
  ctx.patch(WorldMapDisplayElement, 'movePlayerMarker').after(() => refreshMarkers());
  ctx.onInterfaceReady(async () => {
    try {
      const img = new Image();
      img.src = ctx.getResourceUrl('assets/marker_tent.webp');
      await img.decode();
      tex = PIXI.Texture.from(img);
      refreshMarkers();
    } catch (e) { log('tent marker not loaded', e); }
  });
  // A Tent bought shows its line on the panel at once.
  ctx.patch(Shop, 'buyItemOnClick').after(function (_ret, p) { try { if (p?.id === `voyage:${O.TENT.id}`) changed(); } catch {} });

  const api = {
    list, near, outposts, tents, pitchHere, pitch, share, strike, askStore, askStrike, panelHtml, click, nameOf,
    media, refreshMarkers, building, stopBuild, builderText, tick,
    /** On character load, after the terrain and its ice: lays the camps. */
    loaded() { try { sync(); tick(); } catch (e) { log('outposts failed to load', e); } },
  };
  state.outposts = api;
  return api;
}
