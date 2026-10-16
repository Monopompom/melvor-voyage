// Plan a voyage (build .119): the planner block on the Voyage page, Sail! and the action on arrival.
// The rules are in src/plan-model.mjs. The route is the game's own A* (WorldMap.computePath), which Voyage's ship
// filter already bends to the ship rules (src/ship.mjs), so one path walks to the ship, boards, sails, lands and walks
// on. Each leg is an ordinary Cartography.movePlayer (setup.mjs's patch: GP, stores, hull, XP), so the autopilot
// saves clicks, never costs. Sail! needs Navigator's Charts (save v9 `navigator`); the planning itself is free.
//
// Ways in: state.planner.planTo(target) from the journal's entries and places and from the lock popups (gate.mjs).
// A target is { name, media?, hexes: [{ q, r }], arrival? } with `arrival` one of { kind: 'action', skillId, action }
// or { kind: 'area', area }; the planner heads for the nearest of `hexes` by route.

const VOYAGE_PAGE = 'voyage:Voyage';
const CARTOGRAPHY_PAGE = 'melvorAoD:Cartography';
/** Candidate hexes priced by route (the nearest by straight distance first): enough to find the shortest way. */
const CANDIDATES = 6;

export function install(ctx, { state, model, planModel: P, storesModel: S, terrainMod, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const skill = () => state.voyageSkill?.();
  const usable = () => { const s = skill(); return s !== undefined && s.futureRaw === undefined; };
  const owned = () => usable() && skill().record.navigator === true;
  const live = () => game.cartography?.activeMap;
  const liveHex = (q, r) => { try { return live()?.getHex(new HexCoords(q, r)); } catch { return undefined; } };
  const at = (hex) => { try { const o = hex.to_oddq(); return `(${o.col}, ${o.row})`; } catch { return `(${hex.q}, ${hex.r})`; } };
  const num = (n) => numberWithCommas(Math.floor(n));

  /** The planned voyage: the target and the chosen arrival ('none', 'go', or 'm:<monster id>'). */
  let target;
  let arrivalPick;

  // ---- the route ---------------------------------------------------------------------------------------------------
  /** The nearest of the target's hexes by route: { dest, path (game order: destination first) } or a reason. */
  const route = () => {
    const map = live();
    const from = map?.playerPosition;
    if (map === undefined || from === undefined) return { why: 'noway' };
    const hexes = target.hexes.map((h) => liveHex(h.q, h.r)).filter((h) => h !== undefined);
    if (hexes.some((h) => h === from)) return { why: 'here', dest: from };
    const near = hexes.filter((h) => h.isFullySurveyed)
      .sort((a, b) => terrainMod.hexDistance(from, a) - terrainMod.hexDistance(from, b)).slice(0, CANDIDATES);
    let best;
    for (const h of near) {
      let path;
      try { path = map.computePath(from, h); } catch (e) { log('plan path failed', e); }
      if (Array.isArray(path) && path.length > 1 && (best === undefined || path.length < best.path.length)) best = { dest: h, path };
    }
    if (best === undefined) return { why: hexes.length > 0 && near.length === 0 ? 'uncharted' : 'noway' };
    return best;
  };

  /**
   * The plan: { why } when there is no way, else { dest, path, walk (start first), steps, split, costs, counts }.
   * Without provisions (setting off, no skill) the whole way is one leg.
   */
  const compute = () => {
    if (target === undefined) return undefined;
    const r = route();
    if (r.path === undefined) return r;
    const walk = [...r.path].reverse();
    const n = walk.length - 1;
    const steps = state.ship?.stepsOf?.(r.path) ?? [];
    const st = state.stores;
    let split = { ok: true, legs: [{ from: 0, to: n }] };
    if (st?.enabled?.() === true && steps.length === n) {
      const ship = state.ship?.ship?.();
      const have = { ...st.stores(), ...(ship != null && state.ship.enabled() ? { cond: ship.cond } : {}) };
      const cap = st.capacity();
      const bank = st.loadable().map((x) => ({ id: x.item.id, kind: x.kind, unit: x.unit, qty: x.qty }));
      const price = (h, from, to) => st.priceSteps(h, steps.slice(from, to), walk[to]);
      const loadAt = (i, h, stock) => {
        const rates = st.loadingAtHex(walk[i]);
        if (rates === undefined) return undefined;
        return { ...P.simulateLoad(S, h, cap, rates, stock), place: rates.place };
      };
      split = P.splitLegs(n, have, bank, price, loadAt);
    }
    let costs;
    try { costs = game.cartography.getTravelCosts(r.path); } catch {}
    const counts = { land: 0, sea: 0, hops: 0, wear: 0 };
    for (const s of steps) {
      if (s.fastTravel) counts.hops++;
      else if (s.sea) counts.sea++;
      else counts.land++;
      counts.wear += S.wearOf(s);
    }
    if (steps.length !== n) counts.land = n;
    return { ...r, walk, steps, split, costs, counts };
  };

  // ---- arrival -----------------------------------------------------------------------------------------------------
  const isRunning = (skillId, a) => {
    try {
      switch (skillId) {
        case 'melvorD:Woodcutting': return game.woodcutting.activeTrees.has(a);
        case 'melvorD:Mining': return game.mining.isActive && game.mining.selectedRock === a;
        case 'melvorD:Fishing': return game.fishing.isActive && game.fishing.activeFish === a;
        case 'melvorD:Thieving': return game.thieving.isActive && game.thieving.currentNPC === a;
        case 'melvorD:Astrology': return game.astrology.isActive && game.astrology.studiedConstellation === a;
        default: return false;
      }
    } catch { return false; }
  };
  /** Starts a zoned action through the game's own buttons' methods; true when it runs afterwards. */
  const startAction = (skillId, a) => {
    if (isRunning(skillId, a)) return true;
    switch (skillId) {
      case 'melvorD:Woodcutting': game.woodcutting.selectTree(a); break;
      case 'melvorD:Mining': game.mining.onRockClick(a); break;
      case 'melvorD:Fishing': {
        const area = game.fishing.areas.find((x) => x.fish.includes(a));
        if (area === undefined) return false;
        game.fishing.onAreaFishSelection(area, a);
        game.fishing.onAreaStartButtonClick(area);
        break;
      }
      case 'melvorD:Thieving': {
        const area = game.thieving.areas.find((x) => x.npcs.includes(a));
        if (area === undefined) return false;
        game.thieving.startThieving(area, a);
        break;
      }
      case 'melvorD:Astrology': game.astrology.studyConstellationOnClick(a); break;
      default: return false;
    }
    return isRunning(skillId, a);
  };
  const startable = (skillId) => ['melvorD:Woodcutting', 'melvorD:Mining', 'melvorD:Fishing', 'melvorD:Thieving', 'melvorD:Astrology'].includes(skillId);
  const isDungeon = (area) => { try { return game.dungeons.getObjectByID(area.id) === area; } catch { return false; } };
  const isFightArea = (area) => { try { return game.combatAreas.getObjectByID(area.id) === area || game.slayerAreas.getObjectByID(area.id) === area; } catch { return false; } };
  /** What can be started on arrival: [{ value, label }], 'none' first. */
  const arrivalOptions = () => {
    const out = [{ value: 'none', label: t('MOD_VOY_PLAN_ARRIVAL_NONE') }];
    const a = target?.arrival;
    if (a?.kind === 'action' && a.action !== undefined && startable(a.skillId)) {
      const sk = game.skills.getObjectByID(a.skillId);
      out.push({ value: 'go', label: t('MOD_VOY_PLAN_ARRIVAL_ACTION', { skill: sk?.name ?? a.skillId, name: a.action.name ?? a.action.id }) });
    } else if (a?.kind === 'area' && isDungeon(a.area)) {
      out.push({ value: 'go', label: t('MOD_VOY_PLAN_ARRIVAL_DUNGEON', { name: a.area.name }) });
    } else if (a?.kind === 'area' && isFightArea(a.area)) {
      const seen = new Set();
      for (const m of a.area.monsters ?? []) {
        if (m === undefined || seen.has(m.id)) continue;
        seen.add(m.id);
        out.push({ value: `m:${m.id}`, label: t('MOD_VOY_PLAN_ARRIVAL_FIGHT', { name: m.name }) });
      }
    }
    return out;
  };
  const arrivalNow = () => {
    const opts = arrivalOptions();
    return opts.some((o) => o.value === arrivalPick) ? arrivalPick : (opts[1]?.value ?? 'none');
  };
  const arrive = () => {
    const pick = arrivalNow();
    const a = target?.arrival;
    if (pick === 'none' || a === undefined) return;
    try {
      if (a.kind === 'action') {
        if (!startAction(a.skillId, a.action)) notify(t('MOD_VOY_PLAN_START_FAILED', { name: a.action.name ?? a.action.id }), 'danger');
      } else if (pick === 'go' && isDungeon(a.area)) game.combat.selectDungeon(a.area);
      else if (pick.startsWith('m:')) {
        const m = (a.area.monsters ?? []).find((x) => x?.id === pick.slice(2));
        if (m !== undefined) game.combat.selectMonster(m, a.area);
      }
    } catch (e) { log('arrival action failed', e); notify(t('MOD_VOY_PLAN_START_FAILED', { name: a.action?.name ?? a.area?.name ?? '' }), 'danger'); }
  };

  // ---- Sail! -------------------------------------------------------------------------------------------------------
  const notify = (text, kind = 'success') => {
    try {
      const media = ctx.getResourceUrl('assets/ship_stores.png');
      if (kind === 'danger') game.notifications.createErrorNotification('voyage:plan', text);
      else game.notifications.createSuccessNotification('voyage:plan', text, media);
    } catch {}
  };
  /** Loads at the player's place from the bank, best food then fuel, up to the stores limit (the stores block's Load). */
  const loadHere = () => {
    const st = state.stores;
    for (const x of st.loadable()) { try { st.load(x.item, x.qty); } catch (e) { log('plan loading failed', e); } }
  };
  const sail = () => {
    const plan = compute();
    if (plan?.path === undefined || !plan.split.ok || !owned() || !(plan.costs?.checkIfOwned() ?? true)) return;
    const cart = game.cartography;
    const name = target.name;
    if (plan.split.depart !== undefined) loadHere();
    for (const leg of plan.split.legs) {
      const path = plan.walk.slice(leg.from, leg.to + 1).reverse();
      try { cart.movePlayer(path, false); } catch (e) { log('plan leg failed', e); }
      if (cart.activeMap?.playerPosition !== plan.walk[leg.to]) {
        notify(t('MOD_VOY_PLAN_STOPPED', { at: at(cart.activeMap?.playerPosition ?? plan.walk[leg.from]) }), 'danger');
        try { cart.render(); } catch {}
        refresh();
        return;
      }
      if (leg.load !== undefined) loadHere();
    }
    try { cart.render(); } catch {}
    log(`sailed to ${name} in ${plan.split.legs.length} leg(s)`);
    notify(t('MOD_VOY_PLAN_ARRIVED', { name }));
    arrive();
    target = undefined;
    refresh();
  };

  // ---- Navigator's Charts ------------------------------------------------------------------------------------------
  const pitch = () => game.items.getObjectByID('voyage:Pitch');
  const atPort = () => state.stores?.loadingHere?.()?.place === 'port';
  const navCosts = () => {
    const costs = new Costs(game);
    costs.addCurrency(game.gp, P.NAVIGATOR.gp);
    for (const { id, quantity } of P.NAVIGATOR.items) { const it = game.items.getObjectByID(id); if (it !== undefined) costs.addItem(it, quantity); }
    return costs;
  };
  const navBlocker = () => {
    if (!usable()) return 'owned';
    const items = {};
    for (const { id } of P.NAVIGATOR.items) { const it = game.items.getObjectByID(id); items[id] = it === undefined ? 0 : game.bank.getQty(it); }
    return P.navigatorBlocker({ owned: owned(), level: skill().level, atPort: atPort(), gp: game.gp.amount, items });
  };
  const buy = () => {
    if (navBlocker() !== undefined) return;
    const costs = navCosts();
    if (!costs.checkIfOwned()) return;
    costs.consumeCosts();
    skill().record.navigator = true;
    log('Navigator\'s Charts bought');
    notify(t('MOD_VOY_PLAN_NAV_BOUGHT'));
    refresh();
  };

  // ---- the block ---------------------------------------------------------------------------------------------------
  const refresh = () => { const s = skill(); if (s !== undefined) s.renderQueue.page = true; };
  const section = (html) => `<div class="voyage-section">${html}</div>`;
  const costIcon = (media, need, have, title) =>
    `<span class="voyage-cost ${have >= need ? '' : 'text-danger'}" title="${esc(title)}"><img class="mr-1" src="${media}" alt="${esc(title)}">${num(need)}` +
    ` <span class="${have >= need ? 'text-muted' : ''} ml-1">(${t('MOD_VOY_PAGE_HAVE', { count: num(have) })})</span></span>`;
  const amounts = (food, fuel) => state.stores?.amounts?.(food, fuel) ?? '';
  const stopName = (hex, place) => {
    const poi = hex.pointOfInterest;
    const name = poi !== undefined && poi.isDiscovered ? poi.name : t(`MOD_VOY_STORES_PLACE_${String(place).toUpperCase()}`);
    return `${name} ${at(hex)}`;
  };
  const hexesText = (n) => t(n === 1 ? 'MOD_VOY_HEXES_ONE' : 'MOD_VOY_HEXES_MANY', { count: `${n}` });
  const loadText = (l) => {
    const food = l.used.filter((u) => u.kind === 'food').reduce((s, u) => s + u.added, 0);
    const fuel = l.used.filter((u) => u.kind === 'fuel').reduce((s, u) => s + u.added, 0);
    return amounts(food, S.roundFuel(fuel));
  };
  const VERDICT = { food: 'SHORT', fuel: 'SHORT', ashore: 'ASHORE', deep: 'HULL', hull: 'HULL', hullAshore: 'HULL', noway: 'NOWAY', uncharted: 'UNCHARTED', here: 'HERE' };

  const navHtml = () => {
    if (owned()) return '';
    const why = navBlocker();
    const costs = [costIcon(game.gp.media, P.NAVIGATOR.gp, game.gp.amount, game.gp.name)];
    for (const { id, quantity } of P.NAVIGATOR.items) { const it = game.items.getObjectByID(id); if (it !== undefined) costs.push(costIcon(it.media, quantity, game.bank.getQty(it), it.name)); }
    const reason = why === 'level' ? t('MOD_VOY_PLAN_NAV_WHY_LEVEL', { level: `${P.NAVIGATOR.level}` })
      : why === 'port' ? t('MOD_VOY_PLAN_NAV_WHY_PORT') : why === 'cost' ? t('MOD_VOY_PLAN_NAV_WHY_COST') : '';
    return section(`<div class="font-w600">${esc(t('MOD_VOY_PLAN_NAV_TITLE'))}</div>` +
      `<div class="mb-1">${esc(t('MOD_VOY_PLAN_NAV_NEED', { level: `${P.NAVIGATOR.level}` }))}</div>` +
      `<div class="d-flex flex-wrap align-items-center">${costs.join('')}</div>` +
      (why === undefined
        ? `<div class="voyage-hold-main"><button type="button" class="btn btn-success" data-voyage-plan="buy">${esc(t('MOD_VOY_PLAN_NAV_BUY'))}</button></div>`
        : `<div class="text-warning mt-2">${esc(reason)}</div>`));
  };

  const html = () => {
    if (!usable()) return '';
    if (target === undefined) return section(`<div>${esc(t('MOD_VOY_PLAN_EMPTY'))}</div>`) + navHtml();
    const plan = compute();
    const media = target.media ? `<img class="voyage-plan-icon mr-2" src="${esc(target.media)}" alt="">` : '';
    const destAt = plan.dest !== undefined ? ` <span class="text-muted">${at(plan.dest)}</span>` : '';
    let out = section(`<div class="voyage-row"><div class="d-flex align-items-center">${media}<div><small class="text-muted d-block">${esc(t('MOD_VOY_PLAN_TO'))}</small><b>${esc(target.name)}</b>${destAt}</div></div>` +
      `<button type="button" class="btn btn-sm btn-outline-info" data-voyage-plan="clear">${esc(t('MOD_VOY_PLAN_CLEAR'))}</button></div>`);
    if (plan.path === undefined) {
      out += section(`<div class="font-w600 ${plan.why === 'here' ? 'text-success' : 'text-danger'}">${esc(t(`MOD_VOY_PLAN_VERDICT_${VERDICT[plan.why] ?? 'NOWAY'}`))}</div>`);
      return out + navHtml();
    }
    const c = plan.counts;
    let route = t('MOD_VOY_PLAN_ROUTE', { land: hexesText(c.land), sea: hexesText(c.sea) });
    if (c.hops > 0) route += ` ${t('MOD_VOY_PLAN_ROUTE_HOPS', { count: `${c.hops}` })}`;
    const legs = [];
    const sp = plan.split;
    if (sp.depart !== undefined) legs.push(`<li>${esc(t('MOD_VOY_PLAN_DEPART', { amounts: loadText(sp.depart) }))}</li>`);
    sp.legs.forEach((leg) => {
      if (leg.load !== undefined) legs.push(`<li>${esc(t('MOD_VOY_PLAN_STOP', { place: stopName(plan.walk[leg.to], leg.load.place), amounts: loadText(leg.load) }))}</li>`);
    });
    const legLine = legs.length === 0 ? `<div>${esc(t('MOD_VOY_PLAN_ONE_GO'))}</div>` : `<ol class="voyage-plan-legs mb-0">${legs.join('')}</ol>`;
    // Costs: the game's travel costs, then what the stores spend and hold.
    const costParts = [];
    try {
      for (const { currency, quantity } of plan.costs?.getCurrencyQuantityArray() ?? []) if (quantity > 0) costParts.push(costIcon(currency.media, quantity, currency.amount, currency.name));
      for (const { item, quantity } of plan.costs?.getItemQuantityArray() ?? []) if (quantity > 0) costParts.push(costIcon(item.media, quantity, game.bank.getQty(item), item.name));
    } catch {}
    const st = state.stores;
    let storesLine = '';
    if (st?.enabled?.() === true) {
      const have = st.stores();
      storesLine = `<div>${esc(t('MOD_VOY_PLAN_STORES', { have: amounts(have.food, have.fuel) }))}${sp.ok ? ` ${esc(t('MOD_VOY_PLAN_LEFT', { left: amounts(sp.have.food, sp.have.fuel) }))}` : ''}</div>`;
      if (c.wear > 0 && state.ship?.enabled?.()) storesLine += `<div>${esc(t('MOD_VOY_PLAN_WEAR', { wear: `${c.wear}`, cond: `${state.ship.ship()?.cond ?? 100}` }))}</div>`;
    }
    const gpOk = plan.costs?.checkIfOwned() ?? true;
    const verdictKey = !sp.ok ? `MOD_VOY_PLAN_VERDICT_${VERDICT[sp.why] ?? 'SHORT'}` : !gpOk ? 'MOD_VOY_PLAN_VERDICT_COSTS' : owned() ? 'MOD_VOY_PLAN_VERDICT_OK' : 'MOD_VOY_PLAN_VERDICT_CLEAR';
    const good = sp.ok && gpOk;
    out += section(`<div class="font-w600 ${good ? 'text-success' : 'text-danger'}">${esc(t(verdictKey))}</div>` +
      `<div>${esc(route)}</div>${legLine}` +
      (costParts.length > 0 ? `<div class="d-flex flex-wrap align-items-center"><span class="mr-2">${esc(t('MOD_VOY_PLAN_COSTS'))}</span>${costParts.join('')}</div>` : '') + storesLine);
    // On arrival, then the buttons: Sail! green, the rest blue outline (confirm green, navigation blue).
    const opts = arrivalOptions();
    const pick = arrivalNow();
    if (opts.length > 1) {
      out += section(`<label class="d-block mb-1" for="voyage-plan-arrival">${esc(t('MOD_VOY_PLAN_ARRIVAL'))}</label>` +
        `<select id="voyage-plan-arrival" class="form-control" data-voyage-plan="arrival">${opts.map((o) => `<option value="${esc(o.value)}"${o.value === pick ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`);
    }
    const sailBtn = owned() && good ? `<button type="button" class="btn btn-success" data-voyage-plan="sail">${esc(t('MOD_VOY_PLAN_SAIL'))}</button>` : '';
    out += `<div class="voyage-plan-buttons">${sailBtn}<button type="button" class="btn btn-outline-info" data-voyage-plan="map">${esc(t('MOD_VOY_PLAN_SHOW_MAP'))}</button></div>`;
    return out + navHtml();
  };

  /** Opens the map on the destination with the route selected, so the map's own Travel can take you (one leg). */
  const showMap = () => {
    const plan = compute();
    if (plan?.dest === undefined) return;
    try { state.openPage(game.pages.getObjectByID(CARTOGRAPHY_PAGE)); } catch (e) { log('plan map page failed', e); }
    setTimeout(() => {
      try {
        const cart = game.cartography;
        if (!plan.dest.isSelected) cart.onHexTap(plan.dest);
        cartographyMap.moveToHex(plan.dest, 1);
      } catch (e) { log('plan map select failed', e); }
    }, 150);
  };

  const onClick = (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-voyage-plan]') : null;
    if (b === null || b.tagName === 'SELECT') return;
    const what = b.dataset.voyagePlan;
    if (what === 'clear') { target = undefined; refresh(); }
    else if (what === 'sail') sail();
    else if (what === 'map') showMap();
    else if (what === 'buy') buy();
  };
  const onChange = (e) => {
    const s = e.target instanceof Element ? e.target.closest('[data-voyage-plan="arrival"]') : null;
    if (s !== null) { arrivalPick = s.value; refresh(); }
  };

  /** Plans a voyage to `target` and opens the Voyage page on the planner. */
  const planTo = (next) => {
    if (!usable() || next === undefined || !Array.isArray(next.hexes) || next.hexes.length === 0) return false;
    target = next;
    arrivalPick = undefined;
    refresh();
    showBlock();
    return true;
  };
  /** Opens the Voyage page at the planner block. */
  const showBlock = () => {
    try { state.openPage(game.pages.getObjectByID(VOYAGE_PAGE)); } catch (e) { log('plan page failed', e); }
    setTimeout(() => { try { document.querySelector('#voyage-container [data-voyage="plan-block"]')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch {} }, 100);
  };
  /** A target for a zoned action: the hexes where the journal found it, else the known hexes of its zone, else `hexes`. */
  const forAction = (skillId, action, hexes = [], name) => {
    const known = (h) => state.knowledge?.isKnown(h) !== false;
    let to = [];
    if (action !== undefined) {
      const found = state.journal?.foundHexes?.(action.id) ?? [];
      to = found.length > 0 ? found : (state.zonesOn?.() ? (state.zoneCandidates?.(action.id) ?? []).filter(known) : []);
    }
    if (to.length === 0) to = hexes;
    return { name: name ?? action?.name ?? game.skills.getObjectByID(skillId)?.name ?? skillId, media: action?.media, hexes: to.map((h) => ({ q: h.q, r: h.r })), arrival: action === undefined ? undefined : { kind: 'action', skillId, action } };
  };
  /** A target for a combat area, slayer area or dungeon: its known places on the map. */
  const forArea = (area) => {
    const places = (state.terrain?.placesFor(area.id) ?? []).filter((h) => state.knowledge?.isKnown(h) !== false);
    return { name: area.name ?? area.id, media: area.media, hexes: places.map((h) => ({ q: h.q, r: h.r })), arrival: { kind: 'area', area } };
  };

  const signature = () => `${target?.name}|${target?.hexes?.length}|${arrivalPick}|${owned()}`;
  /** For the mini panel: the target and its straight distance from you, or undefined. */
  const summary = () => {
    if (!usable() || target === undefined) return undefined;
    const from = live()?.playerPosition;
    if (from === undefined) return undefined;
    const d = Math.min(...target.hexes.map((h) => terrainMod.hexDistance(from, h)));
    return { name: target.name, media: target.media, distance: Number.isFinite(d) ? d : undefined };
  };
  const reopen = () => { if (target === undefined) return false; showBlock(); return true; };
  const api = { planTo, forAction, forArea, html, onClick, onChange, signature, owned, summary, reopen };
  state.planner = api;
  return api;
}
