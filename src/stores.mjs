// Provisions in the game (phase 3c): the stores in the Voyage save, loading them from the bank at a
// port, town, market or farm, paying every move from them, the hex overview line and the refusal. The rules are pure
// (src/stores-model.mjs); this module reads the live map, bank and Firemaking level.
//
// A move is planned in setup.mjs's movePlayer replace, before the game takes its GP: refused moves never cost
// anything. The plan's food and fuel are written back only once the move has landed.

// Modal buttons: confirm green, cancel blue outline (the game's default cancel is red; grey means disabled).
const SWAL_CLASS = { popup: 'voyage-ui', confirmButton: 'btn btn-success m-1', cancelButton: 'btn btn-outline-info m-1' };

/** The Voyage shop's Dry Casks (data/package.json): spoilage halved for good. */
export const CASKS_ID = 'voyage:Dry_Casks';
/** Curing Salt (data/package.json, a Cooking recipe): loaded beside fuel, each one keeps the stores cured 6 game-hours. */
export const SALT_ID = 'voyage:Curing_Salt';

export function install(ctx, { state, model, storesModel, supplyModel, spoilModel, shipModel, terrainMod, stranded, helpLayout, shortNumber, log }) {
  const S = storesModel;
  const SM = supplyModel;
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const skill = () => state.voyageSkill?.();
  const usable = () => { const s = skill(); return s !== undefined && s.futureRaw === undefined; };
  /** The stores, or undefined without the skill (or with a save from a newer build). */
  const stores = () => (usable() ? skill().record.stores : undefined);
  /** True while moves cost provisions: rules active and the "Provisions" setting on. */
  const enabled = () => usable() && state.active() && state.settings.provisions();
  const fmLevel = () => { try { return game.firemaking?.level ?? 1; } catch { return 1; } };
  /** The gear's cuts on rations and fuel (gear.mjs): stores-model's `mods`, undefined without the gear. */
  const mods = () => { try { return state.gear?.costMods?.(); } catch { return undefined; } };
  const modsKey = () => { const m = mods(); return m === undefined ? '' : `${m.rations},${m.fuel}`; };
  const astroLevel = () => { try { return game.astrology?.level ?? 1; } catch { return 1; } };
  // ---- night (3e): the player's own clock ----------------------------------------------------------
  const shift = () => state.settings.nightShift?.() ?? 0;
  // Phase 5a: the clock a timed voyage reads (during the offline catch-up, the hour being replayed; voyage-clock.mjs).
  const hourNow = () => { const d = new Date(state.clockNow?.() ?? Date.now()); return d.getHours() + d.getMinutes() / 60; };
  /** True at night with the "Night" setting on: light is bought from spare fuel and lit hexes pay more XP. */
  // Nightfall, Solar Eclipse and Eternal Darkness are night all season (phase 5c-1, weather.mjs).
  const allNight = () => state.weather?.allNight?.() === true;
  const night = () => state.settings.night?.() !== false && (allNight() || S.isNight(hourNow(), shift()));
  /** Whether it is night at `ms` on the player's clock; null with the "Night" setting off (no night at all). */
  const nightAt = (ms) => {
    if (state.settings.night?.() === false) return null;
    const d = new Date(ms);
    return allNight() || S.isNight(d.getHours() + d.getMinutes() / 60, shift());
  };
  const clock = (h) => `${String(h).padStart(2, '0')}:00`;
  /**
   * { night, until, season } for the panel and page: whether it is night and when it next turns ("05:00"); `season`
   * true when the season keeps it night (no turn to tell). Undefined when off.
   */
  const timeOfDay = () => {
    if (state.settings.night?.() === false) return undefined;
    if (allNight()) return { night: true, until: '', season: true };
    return { night: S.isNight(hourNow(), shift()), until: clock(S.nextTurn(hourNow(), shift())) };
  };
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
  /** The Folks with you (phase 6c): they eat from the stores and burn fuel like you. */
  // The crew's load (phase 6c): { count, food }, food by each Folk's rank.
  const crew = () => { try { return state.crew?.load?.() ?? { count: 0, food: 0 }; } catch { return { count: 0, food: 0 }; } };

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
  const fuelText = (n) => {
    if (Number.isInteger(n)) return numberWithCommas(n);
    const d = n < 10 ? 2 : 1;
    return typeof formatFixed === 'function' ? formatFixed(n, d) : n.toFixed(d);
  };
  const hexes = (n) => t(n === 1 ? 'MOD_VOY_HEXES_ONE' : 'MOD_VOY_HEXES_MANY', { count: `${n}` });
  const amounts = (food, fuel) => t('MOD_VOY_STORES_AMOUNTS', { food: hp(food), fuel: fuelText(fuel) });
  /** The same with the ration and fuel art (page and panel), titled with the words. */
  // `tip` false (build .283): inside something with its own tooltip (the Here strip's stores chip), so only one shows.
  const icons = (food, fuel, tip = true) => `<span class="voyage-stores-icons"${tip ? ` title="${esc(amounts(food, fuel))}"` : ''}>` +
    `<span class="voyage-stores-pair"><img src="${ctx.getResourceUrl('assets/ration.webp')}">${t('MOD_VOY_UNIT_FOOD', { n: hp(food) })}</span> <span class="voyage-stores-pair"><img src="${ctx.getResourceUrl('assets/fuel.webp')}">${t('MOD_VOY_UNIT_FUEL', { n: fuelText(fuel) })}</span></span>`; // both units (.308, A-11/B-20)

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
    // The reserve feeds the crew at its sea share (build .399: the road share before, a Folk's sea trait left out).
    const opts = { fmLevel: fmLevel(), reserve: Math.ceil(reserveAt(dest, ends) * (1 + (crew().seaFood ?? crew().food))), crew: crew(), mods: mods() };
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
    return night() ? S.planLight(plan, steps, { fmLevel: fmLevel(), astroLevel: astroLevel(), hold: state.lightHold ?? 0, mods: mods() }) : plan;
  };
  /** { steps, plan } for a game path (destination first), or undefined when provisions are off. */
  const planFor = (path) => {
    if (!enabled() || !Array.isArray(path) || path.length < 2 || state.ship?.stepsOf === undefined) return undefined;
    const steps = state.ship.stepsOf(path);
    return { steps, plan: priceSteps(stores(), steps, path[0]) };
  };
  /** Night sight of a planned move (stores-model nightSight): +1 lit (the gear's hexes on top, 4.31), -1 dark, 0 otherwise. */
  const sightOf = (planned) => {
    if (planned === undefined) return 0;
    const d = S.nightSight(planned.steps, planned.plan, night());
    try { return state.gear?.sightWith?.(d) ?? d; } catch { return d; }
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
    // The gear's wear cut (4.31): the plan took the full wear; some of it is given back now, by luck, point by point.
    const settle = (kind, to) => {
      let back = 0;
      try { const taken = (state.ship?.cond?.(kind) ?? to) - to; back = taken > 0 ? state.gear?.forgiveWear?.(taken) ?? 0 : 0; } catch { back = 0; }
      if (back > 0) log(`${kind}: ${back}% of hull wear forgiven`);
      state.ship?.setCond?.(to + back, kind);
    };
    if (planned.plan.cond !== undefined) settle('boat', planned.plan.cond);
    for (const [kind, c] of Object.entries(planned.plan.conds ?? {})) settle(kind, c);
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
  /** The Fall harvest (phase 5c-1): food loads a quarter better where it loads at all; `harvest` marks the lift. */
  const harvested = (rates) => state.weather?.harvest?.(rates) ?? rates;
  const safe = (hex, food = bankFood()) => {
    const rec = recOf(hex);
    if (rec === undefined || rec.cloud === true) return false;
    if (S.isEasy(rec.t)) return true;
    const rates = harvested(S.loadingAt(rec, state.knownNeighbours(rec)));
    if (rates === undefined || !(rates.food > 0) || !(food > 0)) return false;
    // Local supply (4.4a): a place sold out of food is no way out either; one ration's worth in reach will do.
    return !supplyOn() || SM.totalStock(sourcesAt(hex), 'food') >= S.RATION_HP;
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
  // A stock refills with time alone, which moves no version: with local supply on the key also takes the game clock in
  // steps of this (build .520), so a place that has a ration again is a way out again within the step.
  const RESCUE_CLOCK_MS = 10 * 60 * 1000;
  const rescue = () => {
    const pos = state.position();
    if (pos === undefined || !enabled()) return undefined;
    // Out at sea, where Adrift applies (5b part two), the drift takes you home: no sea crossing on his road.
    if (state.adrift?.here?.() === true) return undefined;
    const have = stores();
    const food = bankFood();
    const c = crew();
    const key = `${pos.q},${pos.r}|${have.food}|${have.fuel}|${fmLevel()}|${state.ship?.boat()?.q},${state.ship?.boat()?.r}|${state.ship?.big()?.q},${state.ship?.big()?.r}|${food}|${c.count}:${c.food}|${modsKey()}|${supplyVersion}|${supplyOn() ? Math.floor(gameNow() / RESCUE_CLOCK_MS) : 0}`;
    if (rescueMemo?.key === key) return rescueMemo.value;
    let value;
    try { value = rescueFrom(pos, have, food); } catch (e) { log('provisions rescue failed', e); }
    rescueMemo = { key, value };
    return value;
  };
  const rescueFrom = (pos, have, food) => {
    if (safe(pos, food)) return undefined; // easy ground walks on hungry; a loading place loads
    const level = fmLevel();
    // The crew's load and the gear's modifiers once, not per hex the search expands (build .401).
    const load = crew();
    const md = mods();
    const cost = (h) => { const c = S.stepCost({ cls: recOf(h)?.t, sea: shipModel.isSea(recOf(h)) }, level, load, md); return c.food + c.fuel * S.RATION_HP; };
    const found = stranded.cheapestRoute(pos, { neighbours, stepCost: cost, isGoal: (h) => safe(h, food), key: (h) => terrainMod.hexKey(h.q, h.r) });
    if (found === undefined) return undefined;
    const need = S.pathCost(state.ship.stepsOf(found.path), level, load, md);
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
      // A voyage's step at sea that leaves you Adrift: the Adrift popup says it (5b part two).
      if (state.clock?.stepping?.() && state.adrift?.cause?.() !== undefined) return;
      const p = planned.plan;
      const step = planned.steps[p.at];
      const rec = recOf(path[path.length - 2 - p.at]);
      const terrain = rec === undefined ? '' : getLangString(terrainMod.recKey(rec));
      const have = stores();
      // The whole trip against the stores, and where it runs out (user report, build .58: "needs 20 HP, your stores
      // hold 160" named only the step that failed, after the stores had gone on the steps before it).
      const total = S.pathCost(planned.steps, fmLevel(), crew(), mods());
      const along = hexes(p.at + 1);
      const lines = [];
      // Message popup marks (build .259): the names and the amounts bold, what you are short of in red.
      const b = (x) => `<b>${x}</b>`;
      const red = (x) => `<b class="text-danger">${x}</b>`;
      // The hull (3d): the fix is a repair, not food, so no trader and no loading hint.
      if (HULL_WHY.includes(p.why)) {
        const hull = b(state.ship?.hullName?.(state.ship.vessel(p.vessel ?? 'boat')) ?? t('MOD_VOY_SHIP_BOAT'));
        if (p.why === 'deep') lines.push(t('MOD_VOY_STORES_REFUSE_DEEP', { hull, cond: red(p.cond), worn: b(S.WORN) }));
        else if (p.why === 'hullAshore') lines.push(t('MOD_VOY_STORES_REFUSE_HULL_ASHORE', { hull, need: b(p.reserve), cond: red(p.cond) }));
        else lines.push(t('MOD_VOY_STORES_REFUSE_HULL', { hull, cond: red(p.cond), need: b(p.need), hexes: along }));
        lines.push(t('MOD_VOY_STORES_REFUSE_HULL_HINT'));
        swal({ title: t('MOD_VOY_STORES_REFUSE_HULL_TITLE'), html: body(lines), imageUrl: ctx.getResourceUrl('assets/hull_condition.webp'), ...helpLayout.MSG_IMAGE, confirmButtonText: t('MOD_VOY_BUTTON_OK') });
        return;
      }
      if (p.why === 'ashore') lines.push(t('MOD_VOY_STORES_REFUSE_ASHORE', { trip: b(hp(total.food)), left: red(hp(Math.max(0, have.food - total.food))), need: b(hp(p.reserve)), have: b(hp(have.food)) }));
      else if (step?.hop > 0) lines.push(t('MOD_VOY_STORES_REFUSE_HOP', { hexes: `${step.hop}`, need: b(hp(p.need.food)), have: red(hp(have.food)) }));
      else if (p.why === 'food') lines.push(t('MOD_VOY_STORES_REFUSE_FOOD', { terrain: b(terrain), need: b(hp(total.food)), have: red(hp(have.food)), hexes: along }));
      else lines.push(t('MOD_VOY_STORES_REFUSE_FUEL', { terrain: b(terrain), need: b(fuelText(total.fuel)), have: red(fuelText(have.fuel)), hexes: along }));
      const help = rescue();
      if (help === undefined) {
        // At sea, walking on empty stores is no way out (3c check, 16 Oct 2026).
        lines.push(t(p.why === 'ashore' ? 'MOD_VOY_STORES_REFUSE_HINT_SEA' : 'MOD_VOY_STORES_REFUSE_HINT'));
        swal({ title: t('MOD_VOY_STORES_REFUSE_TITLE'), html: body(lines), imageUrl: ctx.getResourceUrl('assets/ship_stores.webp'), ...helpLayout.MSG_IMAGE, confirmButtonText: t('MOD_VOY_BUTTON_OK') });
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
    if (lines.length === 0) lines.push(t('MOD_VOY_PANEL_HUNGRY_HINT')); // from the panel: what is wrong first (.308, B-45)
    lines.push(t('MOD_VOY_STORES_RESCUE', { hexes: hexes(help.steps), dir: t(`MOD_VOY_DIR_${help.dir}`) }));
    swal({
      // The trader's own portrait, as in his stranded popup (trader.mjs; build .259, it was the "?" sign).
      title: t('MOD_VOY_STORES_RESCUE_TITLE'), html: body(lines), showCancelButton: true, width: '36em', // as the trader's popup (.308, B-43/B-44)
      ...(state.trader?.art !== undefined ? { imageUrl: state.trader.art(), ...helpLayout.MSG_IMAGE, imageWidth: 112, imageHeight: 112 } : { icon: 'question' }),
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
      // The game's "Travel Cost:" block (build .274, the user: "change title to Travel Cost. Centered. And move GP price
      // into our row"): the title alone and centred over our rows, the GP the first of them. Put back as the game drew
      // it when our rows are not shown, or when the trip costs more than GP (the game's icons then keep every cost).
      const own = (on) => {
        const box = this.travelCost;
        if (box === undefined) return;
        box.classList.toggle('voyage-cost-own', on);
        let title = box.querySelector('.voyage-cost-title');
        if (on && title === null) {
          title = document.createElement('span');
          title.className = 'voyage-cost-title';
          box.querySelector('h5')?.append(title);
        }
        if (title !== null) title.textContent = t('MOD_VOY_STORES_PATH_TITLE');
      };
      if (planned === undefined) { note?.classList.add('d-none'); own(false); return; }
      if (note === null) {
        note = document.createElement('div');
        note.className = 'voyage-stores-note mb-1';
        this.travelBtn?.before(note);
      }
      const cost = S.pathCost(planned.steps, fmLevel(), crew(), mods());
      const p = planned.plan;
      // One line each: provisions, each hull's wear, the night (the user, 19 Oct 2026: "put each on new line").
      // One row each, its first words an icon with them as its tooltip (the user, 19 Oct 2026: "put each on new line";
      // "replace first words with icons/tooltips, this will shorten each row").
      const row = (lead, tip, html) => ({ lead: `<span class="voyage-stores-lead" title="${esc(tip)}">${lead}</span>`, html });
      const fuelIcon = `<img class="voyage-stores-lead-img" src="${ctx.getResourceUrl('assets/fuel.webp')}" alt="">`;
      const fill = (key, vars, html) => Object.entries(html).reduce((out, [k, v]) => out.replace(`\u0000${k}\u0000`, v),
        esc(t(key, { ...vars, ...Object.fromEntries(Object.keys(html).map((k) => [k, `\u0000${k}\u0000`])) })));
      // Only what the trip takes (build .270, the user: "we will drop current stats altogether, show only what it
      // takes"): the stores and the hull now are in the Here panel.
      // Each in a row of its own behind its round icon (build .274, the user: "styled in circle GP icon and then price
      // number with green if player have enough gold and red if not"; "and style fire icon in circle as well").
      const lines = [];
      let gpOnly = false;
      try {
        const costs = game.cartography.getTravelCosts(path);
        const cur = costs.getCurrencyQuantityArray();
        gpOnly = costs._items.size === 0 && cur.every((c) => c.currency === game.gp);
        const gp = cur.find((c) => c.currency === game.gp)?.quantity ?? 0;
        if (gpOnly && gp > 0) {
          const enough = game.gp.amount >= gp;
          lines.push(row(`<img class="voyage-stores-lead-img" src="${game.gp.media}" alt="">`,
            t('MOD_VOY_STORES_PATH_GP_TIP', { have: shortNumber(game.gp.amount) }),
            `<span class="${enough ? 'text-success' : 'text-danger'}">${esc(shortNumber(gp))}</span>`));
        }
      } catch (e) { log('travel GP row failed', e); }
      own(gpOnly);
      // A row only when the trip takes some (build .275, the user: "hide if there are 0s.. no point to show them").
      // With Folks along (phase 6c) the tooltip says the trip feeds them too.
      const n = crew().count;
      const costTip = n > 0 ? t(n === 1 ? 'MOD_VOY_STORES_PATH_COST_TIP_CREW_ONE' : 'MOD_VOY_STORES_PATH_COST_TIP_CREW', { count: `${n}` }) : t('MOD_VOY_STORES_PATH_COST_TIP');
      const fuelTip = n > 0 ? t(n === 1 ? 'MOD_VOY_STORES_PATH_FUEL_TIP_CREW_ONE' : 'MOD_VOY_STORES_PATH_FUEL_TIP_CREW', { count: `${n}` }) : t('MOD_VOY_STORES_PATH_FUEL_TIP');
      if (Math.floor(cost.food) > 0) {
        lines.push(row(`<img class="voyage-stores-lead-img" src="${ctx.getResourceUrl('assets/ship_stores.webp')}" alt="">`, costTip,
          `<span class="voyage-stores-icons"><img src="${ctx.getResourceUrl('assets/ration.webp')}">${esc(hp(cost.food))}&nbsp;HP</span>`));
      }
      if (cost.fuel >= 0.005) lines.push(row(fuelIcon, fuelTip, esc(fuelText(cost.fuel))));
      // Each vessel's own wear (two vessels, build .150: named in the tooltip when there are two).
      const two = state.ship?.big?.() != null;
      for (const kind of ['boat', 'ship']) {
        const wear = S.pathWear(planned.steps.filter((x) => (x.vessel ?? 'boat') === kind));
        const hull = hullOf(path[0], kind, endKind(planned.steps));
        if (hull === undefined || wear <= 0) continue;
        const tip = two ? t('MOD_VOY_STORES_PATH_WEAR_OF', { hull: t(shipModel.hullNameKey(state.ship.vessel(kind).hull)) }) : t('MOD_VOY_STORES_PATH_WEAR_TIP');
        lines.push(row('<i class="fa fa-ship" aria-hidden="true"></i>', tip, esc(t('MOD_VOY_STORES_PATH_WEAR', { wear: `${wear}` }))));
      }
      // Night (3e): what the light takes from the spare fuel, and how many hexes it covers.
      if (p.ok && p.lit !== undefined) {
        const could = S.lightable(planned.steps, p);
        const bonus = `${Math.round(model.STAR_XP * 100)}`;
        if (could > 0) {
          lines.push(row('<i class="fa fa-moon" aria-hidden="true"></i>', t('MOD_VOY_STORES_PATH_LIGHT_TIP', { bonus }),
            // Only the fuel the light takes (build .271, the user: "show only 0.74 lights, drop everything else"); the
            // tooltip says what light gives.
            fill('MOD_VOY_STORES_PATH_LIGHT', {}, { fuel: `${fuelIcon}${esc(fuelText(p.light))}` })));
        }
      }
      // The weather on the way (phase 5c-1): the coldest or hottest hex where a band bites, and what it does.
      const wx = state.weather?.wayWords?.(planned.steps);
      if (wx !== undefined) {
        lines.push(row('<i class="fa fa-thermometer-half" aria-hidden="true"></i>', t('MOD_VOY_STORES_PATH_WX_TIP', { season: wx.season }),
          // The degrees, a separator, the effects as icons (the user, build .290: "temperature then some fancy separator
          // then fuel icon x1.5, clock icon x1.25"); the band's name is the degrees' tooltip.
          `<b class="${wx.tone}"${wx.head === '' ? '' : ` title="${esc(wx.head)}"`}>${esc(wx.deg)}</b><span class="voyage-wx-sep" aria-hidden="true">◆</span>${wx.fx}`));
      }
      // The verdict first, bold and in its colour; the numbers under it (UI review, build .86).
      let verdict;
      let cls = '';
      if (!p.ok) {
        cls = 'text-danger';
        verdict = t(HULL_WHY.includes(p.why) ? 'MOD_VOY_STORES_PATH_HULL' : p.why === 'ashore' ? 'MOD_VOY_STORES_PATH_ASHORE' : 'MOD_VOY_STORES_PATH_SHORT');
      } else if (p.hungry.length > 0) { cls = 'text-warning'; verdict = t('MOD_VOY_STORES_PATH_HUNGRY', { hexes: hexes(p.hungry.length), pct: `${Math.round(S.HUNGRY_GP * 100)}` }); }
      note.className = 'voyage-stores-note mb-1';
      note.innerHTML = (verdict === undefined ? '' : `<div class="font-w600 ${cls}">${esc(verdict)}</div>`) +
        // The rows as one block, left (phase 5c-1, the user's comment: they were centred): the leads in a column, each
        // text left beside its lead (build .264).
        `<div class="voyage-stores-rows">${lines.map((l) => `<div class="voyage-stores-row ${verdict === undefined ? 'text-info' : ''}">${l.lead}<span>${l.html}</span></div>`).join('')}</div>`;
      state.tips?.apply?.(note);
    } catch (e) { log('stores note failed', e); }
  });

  // ---- loading -------------------------------------------------------------------------------------------------
  /** Loading rates on a game hex: { place, food, fuel } or undefined (wild, sea). */
  const loadingAtHex = (hex) => {
    const rec = hex === undefined ? undefined : recOf(hex);
    if (rec === undefined || state.terrain === undefined) return undefined;
    return harvested(S.loadingAt(rec, state.knownNeighbours(rec)));
  };
  /** Loading rates where the player stands: { place, food, fuel } or undefined (wild, sea, or provisions off). */
  const loadingHere = () => loadingAtHex(state.position());

  // ---- local supply (4.4a): each loading hex packs only so much a day ------------------------------------------
  /** On with Provisions and its own "Local supply" setting. */
  const supplyOn = () => enabled() && state.settings.supply?.() !== false;
  const gameNow = () => { try { return state.gameNow?.() ?? Date.now(); } catch { return Date.now(); } };
  // The save's stocks, cleaned once per record read (a load or a new character brings a new record).
  let supplyFor;
  const supplyOf = () => {
    const r = skill().record;
    if (supplyFor !== r) { r.supply = SM.cleanSupply(r.supply); supplyFor = r; }
    return r.supply;
  };
  // Moves on with every draw, for the memos that read stocks (the trader's road, the planner).
  let supplyVersion = 0;
  /**
   * The loading places in reach of a game hex, each { key, place, food, fuel, stock: { food, fuel } } with the Fall
   * harvest on its rates; `at` the game-clock time the stock is read for (the planner's arrival), now by default.
   * With local supply off, every stock is Infinity.
   */
  const sourcesAt = (hex, at) => {
    const rec = hex === undefined ? undefined : recOf(hex);
    if (rec === undefined || state.terrain === undefined || !usable()) return [];
    const on = supplyOn();
    const cap = capacity();
    const sup = on ? supplyOf() : undefined;
    const now = at ?? gameNow();
    // On land with no easy ground a place never runs out (state.supplyIslands, set when the table loads).
    const islands = state.supplyIslands;
    return S.loadingList(rec, state.knownNeighbours(rec)).map((p) => ({ ...harvested(p),
      stock: on && islands?.has(p.key) !== true ? SM.stockOf(sup[p.key], p.place, cap, now) : { food: Infinity, fuel: Infinity } }));
  };
  /**
   * What the places in reach of `hex` hold now (4.4a), or undefined with local supply off or nowhere to load:
   * { food, fuel } in stores units, `room` the stores' room, `short` each kind whose stock is less than the room,
   * `back` the game-clock ms until a ration's worth of each is there again (0 when it is), `full` until every place in
   * reach is full.
   */
  const supplyAt = (hex) => {
    if (!supplyOn()) return undefined;
    const src = sourcesAt(hex);
    // Nowhere to load, or a place in reach that never runs out (an island with no easy ground): nothing to tell.
    if (src.length === 0 || src.some((p) => p.stock.food === Infinity)) return undefined;
    const have = stores();
    const cap = capacity();
    const sup = supplyOf();
    const now = gameNow();
    const out = { food: SM.totalStock(src, 'food'), fuel: SM.totalStock(src, 'fuel'), room: { food: Math.max(0, cap.food - have.food), fuel: Math.max(0, cap.fuel - have.fuel) } };
    out.short = { food: out.food < out.room.food, fuel: out.fuel < out.room.fuel };
    const want = { food: S.RATION_HP, fuel: 1 };
    out.back = {};
    for (const kind of ['food', 'fuel']) {
      const ms = src.filter((p) => p[kind] > 0).map((p) => SM.msUntil(sup[p.key], p.place, cap, now, kind, want[kind]));
      out.back[kind] = ms.length === 0 ? Infinity : Math.min(...ms);
    }
    out.full = Math.max(0, ...src.map((p) => SM.msUntilFull(sup[p.key], now)));
    return out;
  };
  const supplyHere = () => supplyAt(state.position());
  /**
   * One loading hex's own stock, for its Journal entry (build .521): { place, day, left, full, never } in stores
   * units, `full` the game-clock ms until it is full again, `never` on an island with no easy ground. Undefined with
   * local supply off or no loading place on the hex itself (a neighbour's stock is its own entry).
   */
  const placeSupply = (hex) => {
    if (!supplyOn()) return undefined;
    const rec = hex === undefined ? undefined : recOf(hex);
    if (rec === undefined || state.terrain === undefined) return undefined;
    const own = S.loadingList(rec)[0];
    if (own === undefined) return undefined;
    const cap = capacity();
    const day = SM.dayOf(own.place, cap);
    if (state.supplyIslands?.has(own.key) === true) return { place: own.place, day, left: day, full: 0, never: true };
    const e = supplyOf()[own.key];
    const now = gameNow();
    return { place: own.place, day, left: SM.stockOf(e, own.place, cap, now), full: SM.msUntilFull(e, now), never: false };
  };
  /** Draws a load's parts from the stocks they came from (4.4a). */
  const draw = (kind, parts, now) => {
    if (!supplyOn() || parts.length === 0) return;
    const cap = capacity();
    const sup = supplyOf();
    for (const p of parts) if (state.supplyIslands?.has(p.key) !== true) sup[p.key] = SM.drawn(sup[p.key], p.place, cap, now, { [kind]: p.added });
    skill().record.supply = SM.pruned(sup, now);
    supplyFor = skill().record;
    supplyVersion++;
    rescueMemo = undefined;
  };
  /**
   * How a load of `qty` items of `unit` of `kind` would go in where you stand (the page's preview and Load):
   * supply-model planLoad's { n, added, parts } against the stores' room and the places' stocks.
   */
  const loadPlan = (unit, qty, kind) => {
    const s = stores();
    if (s === undefined) return { n: 0, added: 0, parts: [] };
    // Curing Salt (4.4b): yours, not a place's stock; as many as fit under the curing's 48 h.
    if (kind === 'cure') { const n = spoilOn() ? Math.min(Math.max(0, Math.floor(qty)), P.curesRoom(spoilOf().cure)) : 0; return { n, added: n * unit, parts: [] }; }
    return SM.planLoad(S, unit, qty, capacity()[kind] - s[kind], sourcesAt(state.position()), kind);
  };
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
        if (fuel > 0) { out.push({ item, kind: 'fuel', unit: fuel, qty }); continue; }
        // Curing Salt with spoilage on: `unit` its game-hours of curing.
        if (item.id === SALT_ID && spoilOn()) out.push({ item, kind: 'cure', unit: P.CURE_MS / P.HOUR_MS, qty });
      }
    } catch (e) { log('loadable failed', e); }
    const order = { food: 0, fuel: 1, cure: 2 };
    return out.sort((a, b) => (a.kind === b.kind ? b.unit - a.unit : order[a.kind] - order[b.kind]));
  };
  /** Loads `qty` of an item from the bank at this place's rate. Returns what went in, or undefined. */
  const load = (item, qty) => {
    const rates = loadingHere();
    if (!usable() || rates === undefined) return undefined;
    if (item.id === SALT_ID) return loadSalt(item, qty);
    const food = foodOf(item);
    const kind = food > 0 ? 'food' : 'fuel';
    const unit = food > 0 ? food : fuelOf(item);
    const s = stores();
    const cap = capacity();
    if (unit <= 0 || !(rates[kind] > 0)) return undefined;
    // The best place in reach first, then the next at its own rate, each up to its stock (local supply, 4.4a).
    const now = gameNow();
    const plan = loadPlan(unit, Math.min(Math.floor(qty), game.bank.getQty(item)), kind);
    const { n, added } = plan;
    if (n <= 0) return undefined;
    game.bank.removeItemQuantity(item, n, true);
    draw(kind, plan.parts, now);
    // up to the limit: the last item may spill over (loadCount)
    if (kind === 'food') set(Math.min(cap.food, s.food + added), s.fuel); else set(s.food, Math.min(cap.fuel, s.fuel + added));
    log(`loaded ${n} ${item.id}: +${added} ${kind} at ${plan.parts.map((p) => `${p.place} ${p.key} ${p.added}`).join(', ')}`);
    return { kind, added, n, parts: plan.parts };
  };

  // ---- spoilage (4.4b): the stores lose a share with every game-hour ----------------------------------------------
  const P = spoilModel;
  /** On with Provisions and its own "Spoilage" setting. */
  const spoilOn = () => P !== undefined && enabled() && state.settings.spoilage?.() !== false;
  let spoilFor;
  const spoilOf = () => {
    const r = skill().record;
    if (spoilFor !== r) { r.spoil = P.cleanSpoil(r.spoil); spoilFor = r; }
    return r.spoil;
  };
  /** Dry Casks bought (the Voyage shop, for good): every store loses half. */
  const casks = () => {
    try { const p = game.shop.purchases.getObjectByID(CASKS_ID); return p !== undefined && game.shop.getPurchaseCount(p) > 0; } catch { return false; }
  };
  /**
   * The multipliers on a store at a game hex: `where` 'stores' (yours: a food place ×¼ and the salt count) or 'tent'
   * or 'pack' (neither). The band and the damp come from the weather (off: both ×1).
   */
  const spoilFactors = (where, hex, cured = false) => {
    const rec = hex === undefined ? undefined : recOf(hex);
    const wx = rec === undefined ? undefined : state.weather?.effectsAt?.(rec);
    const foodPlace = where === 'stores' && (loadingAtHex(hex)?.food ?? 0) > 0;
    return P.factors({ where: where === 'tent' ? 'tent' : 'stores', band: wx?.band, sea: wx !== undefined && shipModel.isSea(rec), foodPlace, casks: casks(), cured: where === 'stores' && cured });
  };
  /**
   * The food to get ashore from `hex` at sea with the crew's share (0 ashore), as a move ending there keeps it: in
   * `kind`'s reach, or the farther of the two vessels' when no kind is given.
   */
  const reserveFood = (hex, kind) => {
    try {
      const kinds = kind !== undefined ? [kind] : state.ship?.big?.() != null ? ['boat', 'ship'] : ['boat'];
      return Math.ceil(Math.max(...kinds.map((k) => reserveAt(hex, k))) * (1 + (crew().seaFood ?? crew().food)));
    } catch { return 0; }
  };
  // The steps of a voyage under way still ahead, each its cost and the reserve where it ends (spoil-model legFloor),
  // memoised per step: the floor that keeps spoilage from pushing a step into a refusal.
  let legMemo;
  const legAhead = () => {
    const v = state.clock?.running?.() === true ? skill().record.voyage : null;
    if (v == null || !Array.isArray(v.walk)) return [];
    const key = `${v.walk.length}|${v.at}|${v.walk[v.walk.length - 1]?.q},${v.walk[v.walk.length - 1]?.r}`;
    if (legMemo?.key === key) return legMemo.value;
    let value = [];
    try {
      const map = game.cartography.activeMap;
      // Walking order, where you are first; the game path (destination first) carries each step's vessel, as the
      // clock prices it (a hop or a reserve in the ship is not the boat's).
      const rest = v.walk.slice(Math.max(0, v.at));
      const hexes = rest.map((h) => map.getHex(new HexCoords(h.q, h.r)));
      if (hexes.length >= 2 && hexes.every((h) => h !== undefined)) {
        const path = [...hexes].reverse();
        const modes = rest.slice(1).map((h) => h.m).reverse();
        if (modes.some((m) => m !== undefined)) path.voyageModes = modes;
        value = state.ship.stepsOf(path).map((s, k) => ({ ...S.stepCost(s, fmLevel(), crew(), mods()), reserve: reserveFood(hexes[k + 1], s.vessel ?? 'boat') }));
      }
    } catch (e) { log('spoilage: leg ahead failed', e); }
    legMemo = { key, value };
    return value;
  };
  /** Never below: the food to get ashore from here at sea, or the most a step of the leg under way asks. */
  const spoilFloor = (pos) => {
    const f = P.legFloor(legAhead(), reserveFood(pos));
    return { food: Math.ceil(f.food), fuel: f.fuel };
  };
  /** What spoiled during this catch-up, for the Welcome Back box (not saved: the box comes in the same session). */
  let spoiledAway = { food: 0, fuel: 0 };
  /** Settles every store from the last stamp to now (the passive tick, once a game-minute; a load, a move). */
  const settleSpoil = (now = gameNow()) => {
    if (!usable()) return;
    const sp = spoilOf();
    if (!spoilOn() || !(sp.at > 0) || now < sp.at) { sp.at = now; return; }
    const ms = now - sp.at;
    if (ms <= 0) return;
    sp.at = now;
    const pos = state.position();
    // Your stores, the curing split where it runs out.
    const have = stores();
    if (have.food > 0 || have.fuel > 0) {
      const r = P.settle(have, sp.debt, ms, { fWith: spoilFactors('stores', pos, true), fWithout: spoilFactors('stores', pos, false), cure: sp.cure, floor: spoilFloor(pos) });
      sp.debt = r.debt;
      sp.cure = r.cure;
      if (r.lost.food > 0 || r.lost.fuel > 0) {
        skill().record.stores = { food: r.have.food, fuel: r.have.fuel };
        if (offlineNow()) { spoiledAway.food += r.lost.food; spoiledAway.fuel = S.roundFuel(spoiledAway.fuel + r.lost.fuel); }
        else spoilShown();
      }
    } else sp.cure = Math.max(0, sp.cure - ms);
    // The tents' stores (×½ wherever they stand), each with its own carried fraction.
    try {
      state.outposts?.mapStores?.((key, store) => {
        if (!(store.food > 0 || store.fuel > 0)) { delete sp.tents[key]; return undefined; }
        const [q, r] = key.split(',').map(Number);
        const r1 = P.spoil(store, sp.tents[key], ms, spoilFactors('tent', { q, r }));
        sp.tents[key] = r1.debt;
        return r1.lost.food > 0 || r1.lost.fuel > 0 ? r1.have : undefined;
      });
    } catch (e) { log('spoilage: tents failed', e); }
  };
  const offlineNow = () => { try { return game._isInOnlineLoop === false; } catch { return false; } };
  // The page and the Here panel redraw at most once a game-minute for it (a whole HP lost), never per tick, and not
  // through every listener as a load does (the map and the sidebar show no amounts).
  const spoilShown = () => {
    const s = skill();
    if (s !== undefined) s.renderQueue.page = true;
    try { state.herePanel?.render?.(); } catch {}
  };
  const SPOIL_STEP_MS = 60 * 1000;
  let spoilTicks = 0;
  /** The skill's passive tick: a settle once a game-minute, counted in ticks so the catch-up costs little. */
  const spoilTick = () => {
    spoilTicks += 1;
    if (spoilTicks < (offlineNow() ? 200 : 20)) return;
    spoilTicks = 0;
    if (!usable()) return;
    const now = gameNow();
    const sp = spoilOf();
    if (sp.at > 0 && now - sp.at < SPOIL_STEP_MS && spoilOn()) return;
    settleSpoil(now);
  };
  /**
   * What your stores lose an hour where you stand, for the Stores block: { food, fuel, parts, cure } (`parts` the
   * multipliers that are not ×1, `cure` the curing time left), or undefined with spoilage off or nothing to lose.
   */
  const spoilRate = () => {
    if (!spoilOn()) return undefined;
    const have = stores();
    if (!(have.food > 0 || have.fuel > 0)) return undefined;
    const sp = spoilOf();
    const f = spoilFactors('stores', state.position(), sp.cure > 0);
    return { food: P.lossPerHour('food', have.food, f.food), fuel: P.lossPerHour('fuel', have.fuel, f.fuel), parts: f.parts, cure: sp.cure };
  };
  /**
   * What your stores will lose on a timed trip (4.4b, the planner and Set off): `path` the game path (destination
   * first), `stepMs` each step's game time (voyage-clock routeInfo), `split` the planner's legs (plan-model splitLegs:
   * a stop's load sets the stores before the next step). Each step spoils at the hex it leaves, the curing counted
   * while it lasts. { food, fuel } lost, or undefined with spoilage off, no time on the way or nothing lost. The floors
   * keep a leg under way from falling short, so this only lowers what arrives.
   */
  const spoilAhead = (path, stepMs, split) => {
    if (!spoilOn() || !Array.isArray(path) || path.length < 2 || !Array.isArray(stepMs) || state.ship?.stepsOf === undefined) return undefined;
    try {
      const steps = state.ship.stepsOf(path);
      const walk = [...path].reverse();
      const sets = new Map();
      if (split?.depart !== undefined) sets.set(0, split.depart.stores);
      for (const leg of split?.legs ?? []) if (leg.load !== undefined) sets.set(leg.to, leg.load.stores);
      const cure = spoilOf().cure;
      let elapsed = 0;
      const legs = steps.map((step, i) => {
        const ms = Number.isFinite(stepMs[i]) ? stepMs[i] : 0;
        const leg = { ms, f: spoilFactors('stores', walk[i], elapsed < cure), cost: S.pathCost([step], fmLevel(), crew(), mods()), set: sets.get(i) };
        elapsed += ms;
        return leg;
      });
      const lost = P.forecast(stores(), legs);
      return lost.food >= 1 || lost.fuel >= 0.01 ? lost : undefined;
    } catch (e) { log('spoilage: forecast failed', e); return undefined; }
  };
  /**
   * Spoiled amounts in words (4.4b): "7.5 food and 0.02 fuel", each with `sign` before it, a part that rounds to 0
   * left out ("−0 fuel" read as nothing, the user, 5 Nov 2026), '' when both do. `perHour`: food to a tenth under 10.
   */
  const spoilText = (food, fuel, { sign = '', perHour = false } = {}) => {
    const f = perHour && food < 10 ? Math.round(food * 10) / 10 : Math.round(food);
    const u = Math.round(fuel * 100) / 100;
    const parts = [];
    if (f > 0) parts.push(`${sign}${t('MOD_VOY_UNIT_FOOD', { n: f >= 1000 ? numberWithCommas(f) : `${f}` })}`);
    if (u > 0) parts.push(`${sign}${t('MOD_VOY_UNIT_FUEL', { n: `${u}` })}`);
    return parts.length === 2 ? t('MOD_VOY_SPOIL_AND', { a: parts[0], b: parts[1] }) : parts[0] ?? '';
  };
  /** What a tent's store (`o`: { q, r, food, fuel }) loses an hour, or undefined with spoilage off or nothing to lose. */
  const tentRate = (o) => {
    if (!spoilOn() || !(o?.food > 0 || o?.fuel > 0)) return undefined;
    const f = spoilFactors('tent', { q: o.q, r: o.r });
    return { food: P.lossPerHour('food', o.food, f.food), fuel: P.lossPerHour('fuel', o.fuel, f.fuel), parts: f.parts };
  };
  /** A walking Folk's pack (4.4b): the road's costs grossed up by what it spoils on the way. `costOf(step)` { food, fuel }. */
  const packWith = (road, costOf) => {
    if (!spoilOn()) return undefined;
    return P.packWith((road ?? []).map((s) => ({ ...costOf(s), ms: Number.isFinite(s.ms) ? s.ms : 0, f: spoilFactors('pack', { q: s.q, r: s.r }) })));
  };
  // Dry Casks bought: the Stores line's rate halves at once.
  try { ctx.patch(Shop, 'buyItemOnClick').after(function (_ret, p) { try { if (p?.id === CASKS_ID) changed(); } catch {} }); } catch (e) { log('spoilage: shop patch failed', e); }
  try {
    ctx.patch(Game, 'enterOfflineLoop').after(function () { spoiledAway = { food: 0, fuel: 0 }; });
    ctx.patch(OfflineProgressElement, 'setMessages').after(function () {
      try {
        const a = spoiledAway;
        spoiledAway = { food: 0, fuel: 0 };
        // In the spoil lines' words, a part that rounds to 0 left out ("0 HP of food" when only fuel spoiled, the user).
        const words = spoilText(a.food, a.fuel);
        if (words === '' || this.messageContainer == null) return;
        const h = document.createElement('h5');
        h.className = 'font-w600 mb-1';
        const m = skill()?.media;
        h.innerHTML = (m ? `<img class="skill-icon-xs mr-1" src="${esc(m)}" alt="">` : '') + t('MOD_VOY_SPOIL_OFFLINE', { amounts: `<span class="text-warning">${esc(words)}</span>` });
        this.messageContainer.append(h);
      } catch (e) { log('spoilage offline line failed', e); }
    });
  } catch (e) { log('spoilage offline summary not patched', e); }

  /** Loads Curing Salt (4.4b): the stores settled first, so the curing starts now; `n` salts add 6 game-hours each. */
  const loadSalt = (item, qty) => {
    if (!spoilOn()) return undefined;
    settleSpoil();
    const sp = spoilOf();
    const n = Math.min(Math.floor(qty), game.bank.getQty(item), P.curesRoom(sp.cure));
    if (!(n > 0)) return undefined;
    game.bank.removeItemQuantity(item, n, true);
    sp.cure = P.cureAfter(sp.cure, n);
    changed();
    log(`loaded ${n} Curing Salt: cured for ${Math.round(sp.cure / 60000)} min`);
    return { kind: 'cure', added: n * (P.CURE_MS / P.HOUR_MS), n, parts: [] };
  };
  /** The curing time left (ms), 0 with spoilage off. */
  const cureLeft = () => (spoilOn() ? spoilOf().cure : 0);

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
    supplyOn, sourcesAt, supplyAt, supplyHere, placeSupply, loadPlan, supplyVersion: () => supplyVersion,
    spoilOn, spoilTick, settleSpoil, spoilRate, spoilFactors, spoilAhead, tentRate, spoilText, packWith, casks, cureLeft, spoilModel: P,
    /** Offers the trader's share when the stores can't reach safe ground (the panel's Stranded? button). */
    offer() {
      const help = rescue();
      if (help === undefined) return false;
      offerRescue(help, []);
      return true;
    }, loadingHere, loadable, load, amounts, icons, hp, fuelText, fmLevel, capacity, astroLevel, night, nightAt, sightOf, timeOfDay, shift,
    loaded() { try { state.afterTutorial?.(giveKit); } catch (e) { log('starter kit failed', e); } },
    /** For the dev console: set the stores outright. */
    set,
  };
  state.stores = api;
  return api;
}
