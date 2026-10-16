// Plan a voyage (build .119): the planner block on the Voyage page, Set off and the action on arrival.
// The rules are in src/plan-model.mjs. The route is the game's own A* (WorldMap.computePath), which Voyage's ship
// filter already bends to the ship rules (src/ship.mjs), so one path walks to the ship, boards, sails, lands and walks
// on. Each leg is an ordinary Cartography.movePlayer (setup.mjs's patch: GP, stores, hull, XP), so the autopilot
// saves clicks, never costs. Set off needs Navigator's Charts (save v9 `navigator`); the planning itself is free.
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
  /** Planning is open from Voyage level PLAN_LEVEL (build .133); Set off needs Navigator's Charts on top. */
  const open = () => usable() && skill().level >= model.PLAN_LEVEL;
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
      // Hull condition: the boat's, or with the big ship (build .150) each vessel's own.
      const sh = state.ship;
      const on = sh?.boat?.() != null && sh.enabled();
      const have = { ...st.stores(), ...(!on ? {} : sh.big?.() != null ? { conds: { boat: sh.cond('boat'), ship: sh.cond('ship') } } : { cond: sh.cond('boat') }) };
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
    const counts = { land: 0, sea: 0, hops: 0, wear: 0, wears: { boat: 0, ship: 0 } };
    for (const s of steps) {
      if (s.fastTravel) counts.hops++;
      else if (s.sea) counts.sea++;
      else counts.land++;
      counts.wear += S.wearOf(s);
      counts.wears[s.vessel === 'ship' ? 'ship' : 'boat'] += S.wearOf(s);
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
  // What the game would refuse on arrival (build .130), asked quietly with the game's own tests:
  // the ones selectMonster / selectDungeon run (combatManager.js v1.3.1) and a skill action's level. Voyage's own
  // location gate is left out (game.checkRequirement, not checkAreaEntryRequirements): you will be there. Each returns
  // the reason as HTML, or undefined when the game would start it.
  const reqHtml = (r) => {
    try { const span = document.createElement('span'); span.append(...r.getNodes('skill-icon-xs mx-1')); return span.innerHTML; } catch { return esc(t('MOD_VOY_PLAN_REFUSE_AREA')); }
  };
  const areaRefusal = (area) => {
    const c = game.combat;
    const slayerReq = typeof SlayerArea !== 'undefined' && area instanceof SlayerArea ? area.slayerLevelRequired : 0;
    const failed = (area.entryRequirements ?? []).find((r) => !game.checkRequirement(r, false, slayerReq));
    if (failed !== undefined) return reqHtml(failed);
    if (c.isDamageTypeBlockedFromArea(c.player.damageType, area)) return esc(t('MOD_VOY_PLAN_REFUSE_AREA_DAMAGE', { type: c.player.damageType.name }));
    return undefined;
  };
  const monsterRefusal = (m, area) => {
    const c = game.combat;
    if (!game.tutorial.complete && !game.tutorial.allowedMonsters.has(m)) return esc(t('MOD_VOY_PLAN_REFUSE_TUTORIAL'));
    return areaRefusal(area) ?? (c.isDamageTypeBlockedFromMonster(c.player.damageType, m) ? esc(t('MOD_VOY_PLAN_REFUSE_IMMUNE', { type: c.player.damageType.name })) : undefined);
  };
  const actionRefusal = (sk, action) => {
    if (sk === undefined) return undefined;
    if (!sk.isUnlocked) return esc(t('MOD_VOY_PLAN_REFUSE_LEVEL', { skill: sk.name, level: action.level ?? 1 }));
    if ((action.level ?? 0) > sk.level) return esc(t('MOD_VOY_PLAN_REFUSE_LEVEL', { skill: sk.name, level: action.level }));
    if ((action.abyssalLevel ?? 0) > (sk.abyssalLevel ?? 0)) return esc(t('MOD_VOY_PLAN_REFUSE_ABYSSAL', { skill: sk.name, level: action.abyssalLevel }));
    return undefined;
  };
  const refusal = (fn) => { try { return fn(); } catch (e) { log('arrival check failed', e); return undefined; } };
  /** What can be started on arrival: [{ value, label, media?, why? }], 'none' first; `why`: the game would refuse it. */
  const arrivalOptions = () => {
    const out = [{ value: 'none', label: t('MOD_VOY_PLAN_ARRIVAL_NONE') }];
    const a = target?.arrival;
    if (a?.kind === 'action' && a.action !== undefined && startable(a.skillId)) {
      const sk = game.skills.getObjectByID(a.skillId);
      out.push({ value: 'go', label: t('MOD_VOY_PLAN_ARRIVAL_ACTION', { skill: sk?.name ?? a.skillId, name: a.action.name ?? a.action.id }), media: a.action.media ?? sk?.media, why: refusal(() => actionRefusal(sk, a.action)) });
    } else if (a?.kind === 'area' && isDungeon(a.area)) {
      out.push({ value: 'go', label: t('MOD_VOY_PLAN_ARRIVAL_DUNGEON', { name: a.area.name }), media: a.area.media, why: refusal(() => areaRefusal(a.area)) });
    } else if (a?.kind === 'area' && isFightArea(a.area)) {
      const seen = new Set();
      for (const m of a.area.monsters ?? []) {
        if (m === undefined || seen.has(m.id)) continue;
        seen.add(m.id);
        out.push({ value: `m:${m.id}`, label: t('MOD_VOY_PLAN_ARRIVAL_FIGHT', { name: m.name }), media: m.media, why: refusal(() => monsterRefusal(m, a.area)) });
      }
    }
    return out;
  };
  /** The pick in force: the chosen one when the game allows it, else the first it allows, else 'none'. */
  const arrivalNow = (opts = arrivalOptions()) => {
    const ok = opts.filter((o) => o.why === undefined);
    return ok.some((o) => o.value === arrivalPick) ? arrivalPick : (ok[1]?.value ?? 'none');
  };
  /** The refusal to flag under the verdict: the chosen pick's, or the first one's when every choice is refused. */
  const arrivalWarning = (opts) => {
    const asked = opts.find((o) => o.value === arrivalPick && o.why !== undefined);
    if (asked !== undefined) return asked;
    const rest = opts.slice(1);
    return rest.length > 0 && rest.every((o) => o.why !== undefined) ? rest[0] : undefined;
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

  // ---- Set off -----------------------------------------------------------------------------------------------------
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
    if (!open()) return '';
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
    // The plan as a small ledger (the user, build .124: "give some love to that text"): a label, then the value;
    // food, fuel and hull read "now → on arrival", amber or red when they arrive low.
    const c = plan.counts;
    const sp = plan.split;
    const row = (label, value) => `<div class="voyage-plan-label">${esc(label)}</div><div class="voyage-plan-value">${value}</div>`;
    const icon = (path, alt) => `<img class="voyage-plan-ico" src="${ctx.getResourceUrl(path)}" alt="${esc(alt)}">`;
    const arrow = `<span class="voyage-plan-arrow" aria-hidden="true">→</span>`;
    const tone = (v, low) => (v <= 0 ? 'text-danger' : v < low ? 'text-warning' : '');
    const parts = [`<span class="voyage-plan-bit"><i class="fa fa-shoe-prints"></i>${esc(t('MOD_VOY_PLAN_LAND', { count: `${c.land}` }))}</span>`,
      `<span class="voyage-plan-bit"><i class="fa fa-water"></i>${esc(t('MOD_VOY_PLAN_SEA', { count: `${c.sea}` }))}</span>`];
    if (c.hops > 0) parts.push(`<span class="voyage-plan-bit"><i class="fa fa-ship"></i>${esc(t('MOD_VOY_PLAN_HOPS', { count: `${c.hops}` }))}</span>`);
    let rows = row(t('MOD_VOY_PLAN_ROW_ROUTE'), parts.join(''));
    const legs = [];
    if (sp.depart !== undefined) legs.push(`<li>${esc(t('MOD_VOY_PLAN_DEPART'))} <span class="text-success">${esc(loadText(sp.depart))}</span></li>`);
    sp.legs.forEach((leg) => {
      if (leg.load !== undefined) legs.push(`<li>${esc(t('MOD_VOY_PLAN_STOP', { place: stopName(plan.walk[leg.to], leg.load.place) }))} <span class="text-success">${esc(loadText(leg.load))}</span></li>`);
    });
    rows += row(t('MOD_VOY_PLAN_ROW_STOPS'), legs.length === 0 ? `<span class="text-muted">${esc(t('MOD_VOY_PLAN_ONE_GO'))}</span>` : `<ol class="voyage-plan-legs mb-0">${legs.join('')}</ol>`);
    // Costs: the game's travel costs.
    const costParts = [];
    try {
      for (const { currency, quantity } of plan.costs?.getCurrencyQuantityArray() ?? []) if (quantity > 0) costParts.push(costIcon(currency.media, quantity, currency.amount, currency.name));
      for (const { item, quantity } of plan.costs?.getItemQuantityArray() ?? []) if (quantity > 0) costParts.push(costIcon(item.media, quantity, game.bank.getQty(item), item.name));
    } catch {}
    if (costParts.length > 0) rows += row(t('MOD_VOY_PLAN_ROW_COST'), costParts.join(''));
    // The stores and the hull, now and on arrival.
    const st = state.stores;
    if (st?.enabled?.() === true) {
      const have = st.stores();
      const end = sp.ok ? sp.have : undefined;
      const hp = (n) => esc(t('MOD_VOY_PLAN_HP', { count: st.hp(n) }));
      const fuel = (n) => (Math.round(n * 10) / 10).toFixed(1);
      rows += `<div></div><div class="voyage-plan-when">${esc(t(end === undefined ? 'MOD_VOY_PLAN_WHEN_NOW' : 'MOD_VOY_PLAN_WHEN'))}</div>`;
      rows += row(t('MOD_VOY_PLAN_ROW_FOOD'), `${icon('assets/ration.png', t('MOD_VOY_PLAN_ROW_FOOD'))}${hp(have.food)}${end === undefined ? '' : `${arrow}<span class="${tone(end.food, S.LOW.food)}">${hp(end.food)}</span>`}`);
      rows += row(t('MOD_VOY_PLAN_ROW_FUEL'), `${icon('assets/fuel.png', t('MOD_VOY_PLAN_ROW_FUEL'))}${fuel(have.fuel)}${end === undefined ? '' : `${arrow}<span class="${tone(end.fuel, S.LOW.fuel)}">${fuel(end.fuel)}</span>`}`);
      // One hull row per vessel that wears on the way; named when you own two (build .150).
      const sh = state.ship;
      const two = sh?.big?.() != null;
      for (const kind of ['ship', 'boat']) {
        const wear = c.wears[kind];
        if (!(wear > 0) || !sh?.enabled?.() || sh.vessel(kind) == null) continue;
        const cond = sh.cond(kind);
        const after = Math.max(0, cond - wear);
        const label = two ? `${t('MOD_VOY_PLAN_ROW_HULL')}: ${sh.hullName(sh.vessel(kind))}` : t('MOD_VOY_PLAN_ROW_HULL');
        rows += row(label, `${icon('assets/hull_condition.png', t('MOD_VOY_PLAN_ROW_HULL'))}${cond}%${arrow}<span class="${after <= 0 ? 'text-danger' : after < 50 ? 'text-warning' : ''}">${after}%</span> <span class="text-muted ml-1">${esc(t('MOD_VOY_PLAN_WEAR', { wear: `${wear}` }))}</span>`);
      }
    }
    const gpOk = plan.costs?.checkIfOwned() ?? true;
    const verdictKey = !sp.ok ? `MOD_VOY_PLAN_VERDICT_${VERDICT[sp.why] ?? 'SHORT'}` : !gpOk ? 'MOD_VOY_PLAN_VERDICT_COSTS' : owned() ? 'MOD_VOY_PLAN_VERDICT_OK' : 'MOD_VOY_PLAN_VERDICT_CLEAR';
    const good = sp.ok && gpOk;
    // On arrival: what the game would refuse is flagged in amber under the verdict (a hint; Set off still goes).
    const opts = arrivalOptions();
    const pick = arrivalNow(opts);
    const warn = arrivalWarning(opts);
    const warnHtml = warn === undefined ? '' : `<div class="text-warning mb-2">${esc(t('MOD_VOY_PLAN_REFUSE_WARN', { name: warn.label }))} ${warn.why}</div>`;
    out += section(`<div class="font-w600 mb-2 ${good ? 'text-success' : 'text-danger'}">${esc(t(verdictKey))}</div>${warnHtml}` +
      `<div class="voyage-plan-ledger">${rows}</div>`);
    // Then the buttons: Set off green, the rest blue outline (confirm green, navigation blue).
    if (opts.length > 1) {
      // The game's own dropdown (Bootstrap's data-toggle, as the game's menus), not the browser's select: each choice
      // with its icon, the picked one shown on the toggle. A choice the game would refuse is greyed out, can't be
      // picked and says why.
      const face = (o) => `${o.media === undefined ? '<i class="fa fa-flag voyage-plan-pick-ico"></i>' : `<img class="voyage-plan-pick-ico" src="${esc(o.media)}" alt="">`}<span>${esc(o.label)}</span>`;
      const item = (o) => o.why === undefined
        ? `<a class="dropdown-item pointer-enabled${o.value === pick ? ' active' : ''}" role="button" data-voyage-plan="pick" data-pick="${esc(o.value)}">${face(o)}</a>`
        : `<div class="dropdown-item voyage-plan-refused" aria-disabled="true"><div class="voyage-plan-refused-name">${face(o)}</div><div class="voyage-plan-refused-why text-warning">${o.why}</div></div>`;
      const cur = opts.find((o) => o.value === pick) ?? opts[0];
      out += section(`<div class="font-w600 mb-1" id="voyage-plan-arrival-label">${esc(t('MOD_VOY_PLAN_ARRIVAL'))}</div>` +
        `<div class="dropdown voyage-plan-arrival"><button type="button" id="voyage-plan-arrival" class="btn btn-light dropdown-toggle" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false" aria-describedby="voyage-plan-arrival-label">${face(cur)}</button>` +
        `<div class="dropdown-menu overflow-y-auto" aria-labelledby="voyage-plan-arrival">${opts.map(item).join('')}</div></div>`);
    }
    const sailBtn = owned() && good ? `<button type="button" class="btn btn-success" data-voyage-plan="sail">${esc(t('MOD_VOY_PLAN_SAIL'))}</button>` : '';
    // Green last, at the right edge like every green button on the page (build .157).
    out += `<div class="voyage-plan-buttons"><button type="button" class="btn btn-outline-info" data-voyage-plan="map">${esc(t('MOD_VOY_PLAN_SHOW_MAP'))}</button>${sailBtn}</div>`;
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
    if (b === null) return;
    const what = b.dataset.voyagePlan;
    if (what === 'clear') { target = undefined; refresh(); }
    else if (what === 'pick') { arrivalPick = b.dataset.pick; refresh(); }
    else if (what === 'sail') sail();
    else if (what === 'map') showMap();
    else if (what === 'buy') buy();
  };

  /** Plans a voyage to `target` and opens the Voyage page on the planner. */
  const planTo = (next) => {
    if (!open() || next === undefined || !Array.isArray(next.hexes) || next.hexes.length === 0) return false;
    target = next;
    arrivalPick = next.pick;
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
    if (!open()) return undefined;
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
  const forArea = (area, monster) => {
    if (!open()) return undefined;
    const places = (state.terrain?.placesFor(area.id) ?? []).filter((h) => state.knowledge?.isKnown(h) !== false);
    return { name: area.name ?? area.id, media: area.media, hexes: places.map((h) => ({ q: h.q, r: h.r })), arrival: { kind: 'area', area },
      pick: monster === undefined ? undefined : `m:${monster.id}` };
  };

  // The refusals are in it, so gear or a damage type change redraws the block.
  const signature = () => `${target?.name}|${target?.hexes?.length}|${arrivalPick}|${owned()}|${target === undefined ? '' : arrivalOptions().map((o) => o.why === undefined ? 1 : 0).join('')}`;
  /** For the mini panel: the target and its straight distance from you, or undefined. */
  const summary = () => {
    if (!open() || target === undefined) return undefined;
    const from = live()?.playerPosition;
    if (from === undefined) return undefined;
    const d = Math.min(...target.hexes.map((h) => terrainMod.hexDistance(from, h)));
    return { name: target.name, media: target.media, distance: Number.isFinite(d) ? d : undefined };
  };
  const reopen = () => { if (target === undefined) return false; showBlock(); return true; };
  const api = { planTo, forAction, forArea, html, onClick, signature, open, owned, summary, reopen, NAV: P.NAVIGATOR, PLAN_LEVEL: model.PLAN_LEVEL };
  state.planner = api;
  return api;
}
