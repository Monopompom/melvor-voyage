// Provisions in the game (phase 3c): the stores in the Voyage save, loading them from the bank at a
// port, town, market or farm, paying every move from them, the hex overview line and the refusal. The rules are pure
// (src/stores-model.mjs); this module reads the live map, bank and Firemaking level.
//
// A move is planned in setup.mjs's movePlayer replace, before the game takes its GP: refused moves never cost
// anything. The plan's food and fuel are written back only once the move has landed.

// Modal buttons: confirm green, cancel blue outline (the game's default cancel is red; grey means disabled).
const SWAL_CLASS = { popup: 'voyage-ui', confirmButton: 'btn btn-success m-1', cancelButton: 'btn btn-outline-info m-1' };

export function install(ctx, { state, model, storesModel, shipModel, terrainMod, stranded, helpLayout, log }) {
  const S = storesModel;
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const skill = () => state.voyageSkill?.();
  const usable = () => { const s = skill(); return s !== undefined && s.futureRaw === undefined; };
  /** The stores, or undefined without the skill (or with a save from a newer build). */
  const stores = () => (usable() ? skill().record.stores : undefined);
  /** True while moves cost provisions: rules active and the "Provisions" setting on. */
  const enabled = () => usable() && state.active() && state.settings.provisions();
  const fmLevel = () => { try { return game.firemaking?.level ?? 1; } catch { return 1; } };
  const astroLevel = () => { try { return game.astrology?.level ?? 1; } catch { return 1; } };
  // ---- night (3e): the player's own clock ----------------------------------------------------------
  const shift = () => state.settings.nightShift?.() ?? 0;
  const hourNow = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; };
  /** True at night with the "Night" setting on: light is bought from spare fuel and lit hexes pay more XP. */
  const night = () => state.settings.night?.() !== false && S.isNight(hourNow(), shift());
  const clock = (h) => `${String(h).padStart(2, '0')}:00`;
  /** { night, until } for the panel and page: whether it is night and when it next turns ("05:00"); undefined when off. */
  const timeOfDay = () => (state.settings.night?.() === false ? undefined : { night: S.isNight(hourNow(), shift()), until: clock(S.nextTurn(hourNow(), shift())) });
  // Day turns to night with nobody clicking: redraw the panel and page when it does.
  let wasNight;
  setInterval(() => {
    try {
      const n = night();
      if (wasNight !== undefined && n !== wasNight) changed();
      wasNight = n;
    } catch {}
  }, 30000);
  /** What the stores hold at most (build .66): grows with the Voyage level. */
  const capacity = () => S.capacity(usable() ? skill().level : 1);
  const recOf = (hex) => state.ship?.recOf?.(hex) ?? state.recordAt(hex);

  const changed = () => {
    const s = skill();
    if (s !== undefined) s.renderQueue.page = true;
    state.onSettingsChange();
  };
  const set = (food, fuel) => {
    if (!usable()) return;
    skill().record.stores = { food: Math.max(0, Math.floor(food)), fuel: S.roundFuel(Math.max(0, fuel)) };
    changed();
  };

  // ---- numbers as the player reads them ------------------------------------------------------------------------
  const hp = (n) => numberWithCommas(Math.floor(n));
  const fuelText = (n) => (Number.isInteger(n) ? numberWithCommas(n) : n.toFixed(n < 10 ? 2 : 1));
  const hexes = (n) => t(n === 1 ? 'MOD_VOY_HEXES_ONE' : 'MOD_VOY_HEXES_MANY', { count: `${n}` });
  const amounts = (food, fuel) => t('MOD_VOY_STORES_AMOUNTS', { food: hp(food), fuel: fuelText(fuel) });
  /** The same with the ration and fuel art (page and panel), titled with the words. */
  const icons = (food, fuel) => `<span class="voyage-stores-icons" title="${esc(amounts(food, fuel))}">` +
    `<img src="${ctx.getResourceUrl('assets/ration.webp')}">${hp(food)} HP <img src="${ctx.getResourceUrl('assets/fuel.webp')}">${fuelText(fuel)}</span>`;

  // ---- planning a move -----------------------------------------------------------------------------------------
  /** The vessel a move ends in: the last step's (build .150, two vessels), else the small boat. */
  const endKind = (steps) => steps?.[steps.length - 1]?.vessel ?? 'boat';
  /** HP to keep when a move ends on the sea: the rations for the way back (always get ashore, 4.3). */
  const reserveAt = (hex, kind = 'boat') => {
    const rec = recOf(hex);
    if (!shipModel.isSea(rec)) return 0;
    const v = state.ship?.vessel?.(kind);
    return S.ashoreReserve(state.ship?.homeOf?.(rec, v), shipModel.reachOf(v));
  };
  /**
   * A hull for the plan (3d): its condition and what to keep for the way back when the move ends at sea in it.
   * Undefined without that vessel or with the ship rules off: then nothing wears.
   */
  const hullOf = (dest, kind, endsIn) => {
    const sh = state.ship;
    const s = sh?.vessel?.(kind);
    if (s == null || !sh.enabled()) return undefined;
    const rec = recOf(dest);
    const reserve = shipModel.isSea(rec) && kind === endsIn ? S.hullReserve(sh.homeOf(rec, s), shipModel.reachOf(s)) : 0;
    return { cond: shipModel.condOf(s), reserve };
  };
  /**
   * Prices `steps` (walking order) that end on the game hex `dest`, starting from `have` ({ food, fuel, cond?, conds? }):
   * the move's plan as movePlayer would make it, night light included. `cond` stands in for the small boat's condition
   * and `conds` ({ boat, ship }) for both vessels' (Plan a voyage prices later legs with what the earlier ones leave,
   * build .119). With a big ship each step wears its own vessel (`hulls`, build .150).
   */
  const priceSteps = (have, steps, dest) => {
    const ends = endKind(steps);
    const opts = { fmLevel: fmLevel(), reserve: reserveAt(dest, ends) };
    if (state.ship?.big?.() != null) {
      const hulls = {};
      for (const kind of ['boat', 'ship']) {
        const h = hullOf(dest, kind, ends);
        if (h !== undefined) hulls[kind] = have.conds?.[kind] === undefined ? h : { ...h, cond: have.conds[kind] };
      }
      opts.hulls = hulls;
    } else {
      const hull = hullOf(dest, 'boat', 'boat');
      opts.hull = hull === undefined || have.cond === undefined ? hull : { ...hull, cond: have.cond };
    }
    const plan = S.planMove(have, steps, opts);
    return night() ? S.planLight(plan, steps, { fmLevel: fmLevel(), astroLevel: astroLevel() }) : plan;
  };
  /** { steps, plan } for a game path (destination first), or undefined when provisions are off. */
  const planFor = (path) => {
    if (!enabled() || !Array.isArray(path) || path.length < 2 || state.ship?.stepsOf === undefined) return undefined;
    const steps = state.ship.stepsOf(path);
    return { steps, plan: priceSteps(stores(), steps, path[0]) };
  };
  /** After a move landed: the stores keep what the plan left; hungry steps are marked for the XP; the hull wears. */
  const afterMove = (planned) => {
    if (planned === undefined || !planned.plan.ok) return;
    for (const i of planned.plan.hungry) planned.steps[i].hungry = true;
    for (const i of planned.plan.lit ?? []) planned.steps[i].lit = true;
    set(planned.plan.food, planned.plan.fuel);
    if ((planned.plan.lit ?? []).length > 0) log(`lit ${planned.plan.lit.length} hex(es) at night for ${planned.plan.light} fuel`);
    // The stars pay at sea: a lit sea hex may turn up a Starlit Chart (phase 4 wrap-up, charts.mjs rollStars).
    const seaLit = (planned.plan.lit ?? []).reduce((n, i) => n + (planned.steps[i].hop > 0 ? planned.steps[i].hop : planned.steps[i].sea ? 1 : 0), 0);
    if (seaLit > 0) { try { state.charts?.rollStars?.(seaLit); } catch (e) { log('star chart roll failed', e); } }
    if (planned.plan.cond !== undefined) state.ship?.setCond?.(planned.plan.cond, 'boat');
    for (const [kind, c] of Object.entries(planned.plan.conds ?? {})) state.ship?.setCond?.(c, kind);
    if (planned.plan.hungry.length > 0) log(`walked ${planned.plan.hungry.length} hex(es) hungry`);
  };

  // ---- the floor under it: stuck on hard ground with empty stores ----------------------------------------------
  const neighbours = (hex) => {
    const out = [];
    try {
      HexCoords.axialDirVectors.forEach((_, i) => {
        const n = hex.map.getHex(HexCoords.axialNeighbor(hex, i));
        if (n !== undefined && n.isFullySurveyed && (state.ship?.allows?.(hex, n) ?? true)) out.push(n);
      });
    } catch {}
    return out;
  };
  /** Safe ground: easy land (the hunger floor walks on from there) or a place to load. */
  /**
   * Safe ground: easy land (the hunger floor walks on from there), or a place to load while the bank holds food it
   * takes. A loading place with nothing to load is no way out (user report, build .61: food sold to the trader next
   * to a farm in the Snowlands, and no help came).
   */
  const safe = (hex, food = bankFood()) => {
    const rec = recOf(hex);
    if (rec === undefined || rec.cloud === true) return false;
    if (S.isEasy(rec.t)) return true;
    const rates = S.loadingAt(rec, state.terrain?.neighbours(rec.q, rec.r) ?? []);
    return rates !== undefined && rates.food > 0 && food > 0;
  };
  /** HP of food in the bank, at full worth. */
  const bankFood = () => loadable().reduce((sum, x) => sum + (x.kind === 'food' ? x.unit * x.qty : 0), 0);
  /**
   * The road the wandering trader walks you out on when the stores can't pay the way to safe ground (made provisions-aware in 3c): the cheapest road there, { path, steps, dir }. Undefined when the stores already
   * cover it (you are not stranded, just short for this trip) or there is no road at all. Build .59: this used to wait
   * until not even one step was possible (user report). Build .63: he walks you out instead of handing over food and
   * fuel, which could be spent going the other way and asked for again (the user's exploit question).
   */
  let rescueMemo;
  const rescue = () => {
    const pos = state.position();
    if (pos === undefined || !enabled()) return undefined;
    const have = stores();
    const food = bankFood();
    const key = `${pos.q},${pos.r}|${have.food}|${have.fuel}|${fmLevel()}|${state.ship?.boat()?.q},${state.ship?.boat()?.r}|${state.ship?.big()?.q},${state.ship?.big()?.r}|${food}`;
    if (rescueMemo?.key === key) return rescueMemo.value;
    let value;
    try { value = rescueFrom(pos, have, food); } catch (e) { log('provisions rescue failed', e); }
    rescueMemo = { key, value };
    return value;
  };
  const rescueFrom = (pos, have, food) => {
    if (safe(pos, food)) return undefined; // easy ground walks on hungry; a loading place loads
    const level = fmLevel();
    const cost = (h) => { const c = S.stepCost({ cls: recOf(h)?.t, sea: shipModel.isSea(recOf(h)) }, level); return c.food + c.fuel * S.RATION_HP; };
    const found = stranded.cheapestRoute(pos, { neighbours, stepCost: cost, isGoal: (h) => safe(h, food), key: (h) => terrainMod.hexKey(h.q, h.r) });
    if (found === undefined) return undefined;
    const need = S.pathCost(state.ship.stepsOf(found.path), level);
    if (need.food <= have.food && need.fuel <= have.fuel + 1e-9) return undefined;
    return { path: found.path, steps: found.path.length - 1, dir: terrainMod.directionLabel(pos, found.path[0]) };
  };

  const HULL_WHY = ['hull', 'deep', 'hullAshore'];
  const swal = (opts) => SwalLocale.fire({
    didRender: state.popupDidRender,
    customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass(SWAL_CLASS) : SWAL_CLASS,
    ...opts,
  });
  /** The refusal, from movePlayer. When the stores can't reach safe ground at all, the trader offers his share too. */
  const refuse = (planned, path) => {
    try {
      const p = planned.plan;
      const step = planned.steps[p.at];
      const rec = recOf(path[path.length - 2 - p.at]);
      const terrain = rec === undefined ? '' : getLangString(terrainMod.classKey(rec.t));
      const have = stores();
      // The whole trip against the stores, and where it runs out (user report, build .58: "needs 20 HP, your stores
      // hold 160" named only the step that failed, after the stores had gone on the steps before it).
      const total = S.pathCost(planned.steps, fmLevel());
      const along = hexes(p.at + 1);
      const lines = [];
      // The hull (3d): the fix is a repair, not food, so no trader and no loading hint.
      if (HULL_WHY.includes(p.why)) {
        const hull = state.ship?.hullName?.(state.ship.vessel(p.vessel ?? 'boat')) ?? t('MOD_VOY_SHIP_BOAT');
        if (p.why === 'deep') lines.push(t('MOD_VOY_STORES_REFUSE_DEEP', { hull, cond: `${p.cond}`, worn: `${S.WORN}` }));
        else if (p.why === 'hullAshore') lines.push(t('MOD_VOY_STORES_REFUSE_HULL_ASHORE', { hull, need: `${p.reserve}`, cond: `${p.cond}` }));
        else lines.push(t('MOD_VOY_STORES_REFUSE_HULL', { hull, cond: `${p.cond}`, need: `${p.need}`, hexes: along }));
        lines.push(t('MOD_VOY_STORES_REFUSE_HULL_HINT'));
        swal({ title: t('MOD_VOY_STORES_REFUSE_HULL_TITLE'), html: body(lines), icon: 'warning', confirmButtonText: t('MOD_VOY_BUTTON_OK') });
        return;
      }
      if (p.why === 'ashore') lines.push(t('MOD_VOY_STORES_REFUSE_ASHORE', { trip: hp(total.food), left: hp(Math.max(0, have.food - total.food)), need: hp(p.reserve), have: hp(have.food) }));
      else if (step?.hop > 0) lines.push(t('MOD_VOY_STORES_REFUSE_HOP', { hexes: `${step.hop}`, need: hp(p.need.food), have: hp(have.food) }));
      else if (p.why === 'food') lines.push(t('MOD_VOY_STORES_REFUSE_FOOD', { terrain, need: hp(total.food), have: hp(have.food), hexes: along }));
      else lines.push(t('MOD_VOY_STORES_REFUSE_FUEL', { terrain, need: fuelText(total.fuel), have: fuelText(have.fuel), hexes: along }));
      const help = rescue();
      if (help === undefined) {
        // At sea, walking on empty stores is no way out (3c check, 16 Oct 2026).
        lines.push(t(p.why === 'ashore' ? 'MOD_VOY_STORES_REFUSE_HINT_SEA' : 'MOD_VOY_STORES_REFUSE_HINT'));
        swal({ title: t('MOD_VOY_STORES_REFUSE_TITLE'), html: body(lines), icon: 'warning', confirmButtonText: t('MOD_VOY_BUTTON_OK') });
        return;
      }
      offerRescue(help, lines);
    } catch (e) { console.error('[Voyage] provisions refusal failed', e); }
  };
  /**
   * The trader walks you along the road in one move: nothing from the stores, no Voyage XP (movePlayer with
   * ignoreCosts, which the setup.mjs replace treats as a free move; the ship still follows a sea crossing). The road's
   * GP and items are paid as usual when you have them; when you don't, he lets it go (the GP floor).
   */
  const offerRescue = (help, lines) => {
    lines.push(t('MOD_VOY_STORES_RESCUE', { hexes: hexes(help.steps), dir: t(`MOD_VOY_DIR_${help.dir}`) }));
    swal({
      title: t('MOD_VOY_TRADER_TITLE'), html: body(lines), icon: 'question', showCancelButton: true,
      confirmButtonText: t('MOD_VOY_STORES_RESCUE_BUTTON'), cancelButtonText: t('MOD_VOY_TRADER_BUTTON_NOT_NOW'),
    }).then((r) => {
      if (!r.isConfirmed) return;
      try {
        const cart = game.cartography;
        const pos = state.position();
        if (pos === undefined || help.path[help.path.length - 1] !== pos) { log('escort skipped: the player moved'); return; }
        const costs = cart.getTravelCosts(help.path);
        if (costs.checkIfOwned()) costs.consumeCosts();
        cart.movePlayer(help.path, true);
        // the map follows you, as the game's own "go to player" button does (it throws while the map is not built yet)
        try { cart.goToPlayerOnClick(); } catch { /* map not open yet */ }
        rescueMemo = undefined;
        log(`trader walked the player ${help.steps} hex(es) to safe ground`);
        changed();
      } catch (e) { console.error('[Voyage] escort failed', e); }
    });
  };
  const body = (lines) => helpLayout.msgHtml(lines);

  // ---- hex overview: what the selected path costs ----------------------------------------------------------------
  ctx.patch(HexOverviewElement, 'displayHex').after(function (_r, hex) {
    try {
      let note = this.querySelector('.voyage-stores-note');
      const path = hex?.map?.selectedHexPath;
      const planned = hex !== undefined && !hex.isPlayerHere && path !== undefined ? planFor(path) : undefined;
      if (planned === undefined) { note?.classList.add('d-none'); return; }
      if (note === null) {
        note = document.createElement('div');
        note.className = 'voyage-stores-note mb-1';
        this.travelBtn?.before(note);
      }
      const cost = S.pathCost(planned.steps, fmLevel());
      const have = stores();
      const p = planned.plan;
      let html = t('MOD_VOY_STORES_PATH_COST', { cost: amounts(cost.food, cost.fuel), have: amounts(have.food, have.fuel) });
      // Each vessel's own wear (two vessels, build .150: named when there are two).
      const two = state.ship?.big?.() != null;
      for (const kind of ['boat', 'ship']) {
        const wear = S.pathWear(planned.steps.filter((x) => (x.vessel ?? 'boat') === kind));
        const hull = hullOf(path[0], kind, endKind(planned.steps));
        if (hull === undefined || wear <= 0) continue;
        const line = t('MOD_VOY_STORES_PATH_WEAR', { wear: `${wear}`, cond: `${hull.cond}` });
        html += ` ${two ? `${esc(t(shipModel.hullNameKey(state.ship.vessel(kind).hull)))}: ` : ''}${line}`;
      }
      // Night (3e): what the light takes from the spare fuel, and how many hexes it covers.
      if (p.ok && p.lit !== undefined) {
        const could = S.lightable(planned.steps, p);
        if (could > 0) html += ` ${t('MOD_VOY_STORES_PATH_LIGHT', { fuel: fuelText(p.light), lit: `${p.lit.length}`, hexes: `${could}`, bonus: `${Math.round(model.STAR_XP * 100)}` })}`;
      }
      // The verdict first, bold and in its colour; the numbers under it (UI review, build .86).
      let verdict;
      let cls = '';
      if (!p.ok) {
        cls = 'text-danger';
        verdict = t(HULL_WHY.includes(p.why) ? 'MOD_VOY_STORES_PATH_HULL' : p.why === 'ashore' ? 'MOD_VOY_STORES_PATH_ASHORE' : 'MOD_VOY_STORES_PATH_SHORT');
      } else if (p.hungry.length > 0) { cls = 'text-warning'; verdict = t('MOD_VOY_STORES_PATH_HUNGRY', { hexes: hexes(p.hungry.length) }); }
      note.className = 'voyage-stores-note mb-1';
      note.innerHTML = (verdict === undefined ? '' : `<div class="font-w600 ${cls}">${esc(verdict)}</div>`) +
        `<div class="${verdict === undefined ? 'text-info' : ''}">${esc(html)}</div>`;
    } catch (e) { log('stores note failed', e); }
  });

  // ---- loading -------------------------------------------------------------------------------------------------
  /** Loading rates on a game hex: { place, food, fuel } or undefined (wild, sea). */
  const loadingAtHex = (hex) => {
    const rec = hex === undefined ? undefined : recOf(hex);
    if (rec === undefined || state.terrain === undefined) return undefined;
    return S.loadingAt(rec, state.terrain.neighbours(rec.q, rec.r));
  };
  /** Loading rates where the player stands: { place, food, fuel } or undefined (wild, sea, or provisions off). */
  const loadingHere = () => loadingAtHex(state.position());
  let logIds;
  const logs = () => {
    if (logIds === undefined) {
      logIds = new Set();
      try { game.firemaking.actions.forEach((a) => { if (a.log !== undefined) logIds.add(a.log.id); }); } catch {}
    }
    return logIds;
  };
  /** Fuel units per item, 0 for anything that is not fuel. */
  const fuelOf = (item) => S.FUEL_ITEMS[item.id] ?? (logs().has(item.id) ? S.LOG_FUEL : 0);
  const foodOf = (item) => S.foodHP(item.healsFor);
  /** What the bank holds that can be loaded: [{ item, kind: 'food' | 'fuel', unit, qty }], better first. */
  const loadable = () => {
    const out = [];
    try {
      for (const bankItem of game.bank.items.values()) {
        const item = bankItem.item;
        const qty = bankItem.quantity;
        if (qty <= 0) continue;
        const food = foodOf(item);
        if (food > 0) { out.push({ item, kind: 'food', unit: food, qty }); continue; }
        const fuel = fuelOf(item);
        if (fuel > 0) out.push({ item, kind: 'fuel', unit: fuel, qty });
      }
    } catch (e) { log('loadable failed', e); }
    return out.sort((a, b) => (a.kind === b.kind ? b.unit - a.unit : a.kind === 'food' ? -1 : 1));
  };
  /** Loads `qty` of an item from the bank at this place's rate. Returns what went in, or undefined. */
  const load = (item, qty) => {
    const rates = loadingHere();
    if (!usable() || rates === undefined) return undefined;
    const food = foodOf(item);
    const kind = food > 0 ? 'food' : 'fuel';
    const unit = food > 0 ? food : fuelOf(item);
    const rate = rates[kind];
    const s = stores();
    const cap = capacity();
    const n = S.loadCount(unit, rate, Math.min(Math.floor(qty), game.bank.getQty(item)), cap[kind] - s[kind]);
    if (unit <= 0 || rate <= 0 || n <= 0) return undefined;
    game.bank.removeItemQuantity(item, n, true);
    const added = S.loadAmount(unit, n, rate);
    // up to the limit: the last item may spill over (loadCount)
    if (kind === 'food') set(Math.min(cap.food, s.food + added), s.fuel); else set(s.food, Math.min(cap.fuel, s.fuel + added));
    log(`loaded ${n} ${item.id}: +${added} ${kind} at ${rates.place}`);
    return { kind, added, n };
  };

  // ---- the starter kit -----------------------------------------------------------------------------------------
  /** Once per character, after the tutorial: a few days' food and some fuel (existing characters too). */
  const giveKit = () => {
    if (!usable() || skill().record.kitGiven) return;
    const s = stores();
    skill().record.kitGiven = true;
    const cap = capacity();
    const after = { food: Math.max(s.food, Math.min(cap.food, s.food + S.STARTER_KIT.food)), fuel: Math.max(s.fuel, Math.min(cap.fuel, s.fuel + S.STARTER_KIT.fuel)) };
    set(after.food, after.fuel);
    log('starter kit given');
    // What went in, not the kit's size: the stores limit (3d) can cut it short (3c check, 16 Oct 2026).
    const added = { food: after.food - s.food, fuel: after.fuel - s.fuel };
    if (added.food <= 0 && added.fuel <= 0) return;
    const notify = () => { try { game.notifications.createSuccessNotification('voyage:kit', t('MOD_VOY_STORES_KIT', { amounts: amounts(added.food, added.fuel) }), ctx.getResourceUrl('assets/ship_stores.webp')); } catch {} };
    if (state.whenNoModal) state.whenNoModal(notify); else notify();
  };

  const api = {
    enabled, stores, planFor, priceSteps, loadingAtHex, afterMove, refuse, rescue,
    /** Offers the trader's share when the stores can't reach safe ground (the panel's Stranded? button). */
    offer() {
      const help = rescue();
      if (help === undefined) return false;
      offerRescue(help, []);
      return true;
    }, loadingHere, loadable, load, amounts, icons, hp, fuelText, fmLevel, capacity, astroLevel, night, timeOfDay, shift,
    loaded() { try { state.afterTutorial?.(giveKit); } catch (e) { log('starter kit failed', e); } },
    /** For the dev console: set the stores outright. */
    set,
  };
  state.stores = api;
  return api;
}
