// Couriers on the road (round 4, with Worker Folks): the Courier job, a Folk that walks a looping route and carries what
// the Folks there hold. The route rules are in courier-model.mjs; the goods stay in the courier's own Worker Folks room
// and move through its carry calls. Time comes only from the job's work(), so a strike, no Shift Slot or a guard freezes
// a courier with no code of its own here. It stays travel 'walking' for its whole duty, on land hexes only.

export function install(ctx, { state, M, W, H, N, rules, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const distance = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
  const same = (a, b) => a != null && b != null && a.q === b.q && a.r === b.r;
  const now = () => state.gameNow?.() ?? state.clockNow?.() ?? Date.now();

  /** Worker Folks with the carry calls, whether or not Voyage's guards are on yet. */
  const folksApi = () => {
    const a = state.folksApi?.();
    return a !== undefined && a.version >= M.COURIER_API && typeof a.carryTake === 'function' && typeof a.registerJob === 'function' ? a : undefined;
  };
  const api = () => (state.folksGuarded ? folksApi() : undefined);
  const record = () => { const s = state.voyageSkill?.(); return s !== undefined && s.futureRaw === undefined ? s.record : undefined; };
  /** The saved couriers, cleaned once per loaded record. */
  const cleaned = new WeakSet();
  const couriers = () => {
    const r = record();
    if (r === undefined) return undefined;
    if (!cleaned.has(r)) { r.couriers = M.cleanCouriers(r.couriers); cleaned.add(r); }
    return r.couriers;
  };
  const licence = () => { try { return game.shop.purchases.getObjectByID(M.LICENCE_ID); } catch { return undefined; } };
  const owned = () => { const p = licence(); try { return p !== undefined && game.shop.getPurchaseCount(p) > 0; } catch { return false; } };
  /** The job is open: the Licence bought, the rules on and Folks holding what they make. */
  const usable = () => api() !== undefined && state.active?.() === true && state.settings.haul?.() !== false && owned();
  const holds = (folk) => folk?.job === M.COURIER_JOB;
  const hasRoute = (id) => couriers()?.[id] !== undefined;
  const hasContracts = () => {
    try {
      const c = game.shop.purchases.getObjectByID(M.CONTRACTS_ID);
      return c !== undefined && game.shop.getPurchaseCount(c) > 0;
    } catch { return false; }
  };
  const hiringLevel = () => { try { return game.skills.getObjectByID('worker_folks:Hiring')?.level ?? 0; } catch { return 0; } };
  /** Far supply lines ride with couriers: Supply Contracts and Hiring 60. */
  const carriesLinks = () => usable() && hasContracts() && hiringLevel() >= M.CARRIED_LINK_HIRING;

  // ---- where a stop is, and what is done there ---------------------------------------------------------------------
  const tents = () => { try { return state.outposts?.list?.() ?? []; } catch { return []; } };
  /** A stop's hex now; undefined while it is away (a Folk on its way, a tent struck). A bank stop is always there. */
  const stopHex = (stop) => {
    if (stop.kind === 'bank') return { q: stop.q, r: stop.r };
    if (stop.kind === 'folk') {
      const f = api()?.folkById(stop.id);
      return f !== undefined && f.travel === 'idle' && f.place != null ? f.place : undefined;
    }
    const tent = tents().find((x) => x.key === stop.key);
    return tent === undefined ? undefined : { q: tent.q, r: tent.r };
  };
  const stopName = (stop) => {
    if (stop.kind === 'folk') return api()?.folkById(stop.id)?.name ?? '';
    if (stop.kind === 'depot') return tents().find((x) => x.key === stop.key)?.name ?? t('MOD_VOY_ROUTE_TENT_GONE');
    // A bank stop by its place's name (the port, the city), else the land it is on.
    try {
      const poi = game.cartography?.activeMap?.getHex?.(new HexCoords(stop.q, stop.r))?.pointOfInterest;
      if (typeof poi?.name === 'string' && poi.name !== '') return poi.name;
    } catch {}
    return state.landWords?.(stop)?.text ?? '';
  };
  /** The tent a Folk stands by, for a route that stops there. */
  const depotOf = (folkId) => {
    const f = folksApi()?.folkById(folkId);
    return f !== undefined && f.travel === 'idle' && f.place != null ? H.depotFor(f.place, tents(), distance)?.key : undefined;
  };
  /** A supplier's linked goods ride on the stock side when this courier's route also serves the receiver. */
  const takeOptions = (a, id, supplierId) => {
    if (!carriesLinks()) return {};
    const link = a.supplyLinks?.().find((l) => l.supplierId === supplierId);
    return link !== undefined && M.routeServes(couriers()?.[id], link.receiverId, depotOf) ? { forReceiver: link.receiverId } : {};
  };
  /** Takes what a tent's Folks hold (their town goods sit in their own rooms, never in the depot): what moved, by whom. */
  const takeFromDepot = (a, id, key) => {
    const moved = [{ key: M.depotKey(key), ms: a.carryTake(id, { depot: key }, {})?.ms ?? 0 }];
    const up = tents();
    for (const f of a.folks()) {
      if (f.id === id || f.travel !== 'idle' || f.place == null) continue;
      if (H.depotFor(f.place, up, distance)?.key === key) moved.push({ key: M.folkKey(f.id), ms: a.carryTake(id, { folk: f.id }, takeOptions(a, id, f.id))?.ms ?? 0 });
    }
    return moved;
  };
  /** At a bank stop: loads what the route's Folks use. A deleted route's leftovers go home. */
  const loadInputs = (a, id) => {
    if (!hasContracts()) return;
    const stops = M.inputStops(M.routeOf(couriers()?.[id]) ?? [], { self: id, isLive: (s) => stopHex(s) !== undefined });
    const plan = a.carryInputsPlan(id, stops);
    if (plan === undefined) return;
    const inBank = (itemId) => {
      const item = game.items.getObjectByID(itemId);
      return item === undefined ? 0 : game.bank.getQty(item);
    };
    a.carryLoadInputs(id, { ...plan, take: M.capInputs(plan.take, inBank) });
  };
  /** Folk id → what it brought to the bank during a catch-up, for the Welcome Back box. Not saved. */
  const awayTally = new Map();
  const tallyAway = (id, got) => {
    const items = (got?.items ?? []).reduce((sum, x) => sum + (x.qty ?? 0), 0);
    if (items <= 0) return;
    const was = awayTally.get(id) ?? { trips: 0, items: 0, fares: 0 };
    awayTally.set(id, { ...was, trips: was.trips + 1, items: was.items + items });
  };
  const tallyFare = (id, gp) => {
    const was = awayTally.get(id) ?? { trips: 0, items: 0, fares: 0 };
    awayTally.set(id, { ...was, fares: was.fares + gp });
  };
  const visit = (a, id, stop, offline) => {
    const carried = [];
    if (stop.kind === 'bank') {
      a.carryToTown?.(id);
      const got = a.carryToBank(id);
      if (offline) tallyAway(id, got);
      loadInputs(a, id);
    } else if (stop.kind === 'folk') {
      const gave = hasContracts() ? a.carryGive(id, { folk: stop.id }, {}) : undefined;
      const took = a.carryTake(id, { folk: stop.id }, takeOptions(a, id, stop.id));
      carried.push({ key: M.folkKey(stop.id), ms: (gave?.ms ?? 0) + (took?.ms ?? 0) });
    } else {
      const gave = hasContracts() ? a.carryGive(id, { depot: stop.key }, {}) : undefined;
      carried.push({ key: M.depotKey(stop.key), ms: gave?.ms ?? 0 }, ...takeFromDepot(a, id, stop.key));
    }
    return { full: M.loadFull(a.room(id)), carried };
  };

  // ---- the job ------------------------------------------------------------------------------------------------------
  const standOn = (a, id, hex) => {
    if (!same(a.folkById(id)?.place, hex)) a.setPlace(id, { q: hex.q, r: hex.r });
  };
  /** Roads on foot, whoever walks them. A search over the map is dear and the map fills in slowly: kept ten game minutes. */
  const ROAD_KEEP_MS = 600000;
  const roadMemo = new Map();
  let roadsSince = 0;
  const knownRoad = (from, hex) => {
    const at = now();
    if (at < roadsSince || at - roadsSince >= ROAD_KEEP_MS || roadMemo.size >= M.ROADS_KEPT) { forgetRoads(); roadsSince = at; }
    const key = `${from.q},${from.r}|${hex.q},${hex.r}`;
    if (roadMemo.has(key)) return roadMemo.get(key) ?? undefined;
    try {
      const ground = state.walks.ground;
      const road = M.roadToStop(from, hex, { ground, findAny: (x, ends) => W.findRoadToAny(x, ends, ground), distance, neighbours: W.NEIGHBOURS });
      roadMemo.set(key, road ?? null);
      return road;
    } catch (e) { log('courier road failed', e); return undefined; }
  };
  /** The road at this Folk's pace, its own copy: a kept road is shared. */
  const roadFor = (f) => (from, hex) => {
    const road = knownRoad(from, hex);
    if (road === undefined || road.length === 0) return road;
    const paced = state.folkTraits?.pace?.(road, f, now());
    return paced === undefined || paced === road ? road.map((s) => ({ ...s })) : paced;
  };
  /** Folk id → { ms, text }: it stands waiting, and looks again after `ms`. A search over the map is too dear for every look. */
  const held = new Map();
  const NO_ROAD_MS = 60000;
  const NO_FOOD_MS = 60000;
  const NO_FARE_MS = 15000;

  // ---- packets: where no road goes, between two ports you know --------------------------------------------------------
  const SEA = ['water', 'shoal'];
  const known = (q, r) => {
    const rec = state.terrain?.get(q, r);
    return rec === undefined || rec.cloud === true || state.knowledge?.isKnown(rec) === false ? undefined : rec;
  };
  const isPort = (h) => { const rec = known(h.q, h.r); return rec !== undefined && Array.isArray(rec.f) && rec.f.includes('port'); };
  const seaClass = (q, r) => { const rec = known(q, r); return rec !== undefined && SEA.includes(rec.t) ? rec.t : undefined; };
  /** What the game charges to sail from `start` over these hexes, in GP, every cut included. Its paths run destination first. */
  const gameGp = (start, hexes) => {
    try {
      const cart = game.cartography;
      const path = [...hexes].reverse().concat(start).map((h) => cart.activeMap.getHex(new HexCoords(h.q, h.r)));
      return cart.getTravelCosts(path).getCurrencyQuantityArray().reduce((sum, { currency, quantity }) => sum + (currency === game.gp ? quantity : 0), 0);
    } catch (e) { log('packet fare failed', e); return 0; }
  };
  const findPacket = (from, hex) => {
    if (!isPort(hex)) return undefined;
    const to = landFor(hex);
    if (to === undefined) return undefined;
    // The sea, and the far port's own hex, which may be land.
    const sea = (q, r) => (q === hex.q && r === hex.r ? seaClass(q, r) ?? 'water' : seaClass(q, r));
    let best;
    let boarding;
    for (const [dq, dr] of [[0, 0], ...W.NEIGHBOURS]) {
      const port = { q: from.q + dq, r: from.r + dr };
      if (same(port, hex) || !isPort(port)) continue;
      const way = W.findRoad(port, hex, sea);
      if (way !== undefined && way.length > 0 && (best === undefined || way.length < best.length)) { best = way; boarding = port; }
    }
    if (best === undefined) return undefined;
    const hexes = best.map(({ q, r }) => ({ q, r }));
    return { to, hexes, ms: hexes.length * M.PACKET_HEX_MS, fare: M.packetFare(gameGp(boarding, hexes)) };
  };
  const packetMemo = new Map();
  const packetFor = (from, hex) => {
    const key = `${from.q},${from.r}|${hex.q},${hex.r}`;
    if (!packetMemo.has(key)) packetMemo.set(key, findPacket(from, hex) ?? null);
    return packetMemo.get(key) ?? undefined;
  };
  /** Takes the fare from your GP; false when you are short. */
  const payFare = (id, boat, offline) => {
    if (boat.fare > 0) {
      if (game.gp.amount < boat.fare) return false;
      game.gp.remove(boat.fare);
      if (offline) tallyFare(id, boat.fare);
    }
    return true;
  };

  const work = (f, ms, info) => {
    const a = api();
    const list = couriers();
    if (a === undefined || list === undefined || state.walks === undefined) return '';
    let c = list[f.id];
    if (c === undefined) return t('MOD_VOY_COURIER_NO_ROUTE');
    if (f.travel === 'idle') a.setTravel(f.id, 'walking');
    // Stopped by a band (round 5): it stands until the fight is answered. A hold no open fight answers any more (a
    // restored backup, say) lets it go.
    if (c.held !== undefined && state.encounters?.courierMet?.()?.id !== f.id) {
      const { held: _gone, ...rest } = c;
      c = rest;
      list[f.id] = c;
    }
    // Until its first whole round its fares come from the route. Worked out here, so the net GP/h never has to search.
    if (c.last === undefined && !(Date.now() - (loops.get(f.id)?.at ?? -Infinity) < LOOP_MS)) loopOf(f);
    const wait = held.get(f.id);
    if (wait !== undefined) {
      // Waiting is the courier's time too: its wage runs and a slow loop costs less per hour in fares.
      if (wait.ms > ms) { wait.ms -= ms; list[f.id] = M.roundTime(c, ms); return wait.text; }
      held.delete(f.id);
      // A new way or a new fare may be open by now. Waiting for food needs no new search.
      if (wait.search) forgetRoads();
    }
    const offline = info?.offline === true;
    let shortOf;
    // Healing on its round (round 5): each bank stop gives back a share of max HP; a hex walked hurt eats double road
    // food for a little more. Worker Folks clamps and saves (API v13 `heal`); without it nothing heals here.
    const provisions = state.stores?.enabled?.() === true;
    const canHeal = typeof a.heal === 'function' && f.maxHp > 0;
    let hp = f.hp ?? f.maxHp;
    let fed = 0;
    const healNow = (n, cause) => {
      if (!(n > 0)) return;
      try { const got = a.heal(f.id, n, { cause }); hp = Number.isFinite(got) ? got : hp; } catch (e) { log('courier heal failed', e); }
    };
    const flushFed = () => { const n = fed; fed = 0; if (n > 0) { hp -= n; healNow(n, 'food'); } };
    const atBank = () => {
      flushFed();
      if (canHeal) healNow(M.bankHeal(hp, f.maxHp), 'rest');
      // A bank stop rests Footsore (it never stands on one hex long enough otherwise).
      try { state.folkTraits?.report?.(f.id, 'bankRest', 1); } catch (e) { log('courier rest count failed', e); }
    };
    const out = M.walkOn(c, ms, {
      stopHex,
      road: roadFor(f),
      distance,
      packet: packetFor,
      board: (boat) => payFare(f.id, boat, offline),
      pack: (cur) => {
        const got = packRoadFood(f, cur);
        if (got.pack === undefined) shortOf = { need: got.min ?? got.need, hex: M.hexOf(cur), have: cur.pack };
        return got.pack;
      },
      topUp: provisions ? (p, at) => topUpFood(f, p, at, (x) => { shortOf = x; }) : undefined,
      eat: provisions ? (p, s) => {
        const cost = state.walks.stepCost(s, f);
        const h = canHeal ? M.roadHeal(p, cost, hp, f.maxHp) : { cost, heal: 0 };
        hp += h.heal;
        fed += h.heal;
        return state.stores.packAfter(p, s, h.cost);
      } : undefined,
      visit: (stop, here) => { standOn(a, f.id, here); if (stop.kind === 'bank') atBank(); return visit(a, f.id, stop, offline); },
      // A band may stop it on a hex it enters, on land or on its packet's deep sea (round 5): online its walk holds
      // there, offline it walks on.
      meet: (step) => (state.encounters?.rollCourier?.(step, bandInfo(a, f, c)) === true ? now() : 0),
    });
    // With Provisions off a hurt courier heals as it walks, with no food to count.
    if (canHeal && !provisions) for (const _s of out.entered) { const h = M.roadHeal(undefined, { food: 0, fuel: 0 }, hp, f.maxHp).heal; hp += h; fed += h; }
    flushFed();
    if (out.done) delete list[f.id];
    else list[f.id] = out.courier;
    if (!out.done && out.courier.stops !== c.stops) loops.delete(f.id);
    // Its place never goes onto water: on a packet it is still the hex it boarded from.
    if (!out.done) standOn(a, f.id, M.hexOf(out.courier));
    if (out.entered.length > 0) {
      if (out.done) standOn(a, f.id, out.entered[out.entered.length - 1]);
      const at = now();
      const night = state.stores?.nightAt?.(state.realAt?.(at) ?? at) ?? null;
      try { state.folkTraits?.walked?.(f.id, out.entered.map((s) => ({ cls: s.cls, ms: s.ms, night }))); } catch (e) { log('courier trait count failed', e); }
    }
    if (out.done) return t('MOD_VOY_COURIER_NO_ROUTE');
    const hold = (holdMs, text, search = false) => { held.set(f.id, { ms: holdMs, text, search }); return text; };
    if (out.wait === 'band') return t('MOD_VOY_COURIER_BAND');
    if (out.wait === 'noRoad') return hold(NO_ROAD_MS, t('MOD_VOY_COURIER_NO_ROAD'), true);
    if (out.wait === 'fare') return hold(NO_FARE_MS, t('MOD_VOY_COURIER_NO_FARE', { gp: N.shortNumber(out.fare) }), true);
    if (out.wait === 'food') return hold(NO_FOOD_MS, foodWaitText(shortOf));
    // Every stop within reach: the next round in a minute. Nothing is wrong, so the card shows no reason.
    if (out.wait === 'standing') return hold(M.STANDING_MS, '');
    return '';
  };

  /**
   * Why it waits for road food (round 5): the places in reach refill in a while, or can never hold enough (its route
   * needs a change), or your bank is short.
   */
  const foodWaitText = (x) => {
    const left = { food: Math.max(0, (x?.need?.food ?? 0) - (x?.have?.food ?? 0)), fuel: Math.max(0, (x?.need?.fuel ?? 0) - (x?.have?.fuel ?? 0)) };
    const amounts = state.stores.shortAmounts(left.food, left.fuel);
    let why = { place: false };
    try { if (x?.hex !== undefined) why = state.stores.roadShort(x.hex, x.need, x.have); } catch (e) { log('courier food wait not read', e); }
    if (why.place && why.ms === Infinity) return t('MOD_VOY_COURIER_NO_FOOD_NEVER', { amounts });
    if (why.place) return t('MOD_VOY_COURIER_NO_FOOD_PLACE', { amounts, time: state.clock?.duration?.(why.ms) ?? '' });
    return t('MOD_VOY_COURIER_NO_FOOD', { amounts });
  };

  // ---- bands on the road (round 5) -----------------------------------------------------------------------------------
  /** The load's sale value: what its room holds (haul, stock, town goods) at the game's prices, and its GP. */
  const loadWorth = (a, id) => {
    const room = a.room?.(id);
    if (room == null) return 0;
    let sum = 0;
    for (const part of [room.haul, room.stock, room.town]) for (const x of part ?? []) sum += state.encounters?.saleGp?.(x.itemId, x.qty) ?? 0;
    for (const x of room.purse ?? []) if (x.currencyId === 'melvorD:GP' && Number.isFinite(x.amount)) sum += x.amount;
    return sum;
  };
  /** Who the band meets: its deck comes from its rank and travel traits, plus the card you lent it (else your last lent). */
  const bandInfo = (a, f, c) => ({
    id: f.id, name: f.name, tier: f.tier, traits: f.traits ?? [],
    lent: c.lent ?? state.encounters?.enc?.()?.lent,
    worth: () => loadWorth(a, f.id),
  });
  /** A band beat the courier: a share of its max HP, as a walking Folk; { hp, dead }, undefined when it is gone. */
  const bandWound = (id) => {
    const a = api();
    const f = a?.folkById(id);
    if (f === undefined) return undefined;
    const hp = state.encounters?.R?.folkWound?.(f.maxHp) ?? 1;
    const r = a.hurt(id, hp, { cause: 'band' });
    if (r === undefined) return undefined;
    log(`courier ${f.name} wounded by a band: -${hp} HP${r.dead ? ', died' : ''}`);
    return { hp, dead: r.dead === true };
  };
  /**
   * The band was answered: the courier goes on. A Run stands it still for the next hex's time and drops a share of its
   * road food (the land run's share, as yours).
   */
  const bandDone = (id, done) => {
    const list = couriers();
    const c = list?.[id];
    if (c === undefined || c.held === undefined) return;
    const { held: _gone, ...rest } = c;
    let next = rest;
    if (done === 'run') {
      const drop = state.encounters?.R?.RUN_LAND_DROP ?? 0;
      const hexMs = c.crossing !== undefined ? M.PACKET_HEX_MS : c.road[c.reached]?.ms ?? c.road[c.road.length - 1]?.ms ?? 0;
      next = { ...next, lag: (next.lag ?? 0) + hexMs };
      if (next.pack !== undefined) next = { ...next, pack: { food: Math.floor(next.pack.food * (1 - drop)), fuel: next.pack.fuel * (1 - drop) } };
    }
    list[id] = M.cleanCourier(next) ?? next;
    log(`courier ${id} goes on after the band (${done})`);
  };

  /** Why this Folk can't set off now: only one with you, while you are under way or on the water. */
  const refusal = (f) => {
    if (f.travel !== 'with') return '';
    const busy = state.crew?.busy?.();
    if (busy !== undefined) return busy;
    return state.crew?.ashoreRefusal?.() !== undefined ? t('MOD_VOY_WALK_AT_SEA') : '';
  };
  /** The card's place line. What it is doing goes on the line above (nextText, or the job's wait reason). */
  const whereText = () => t('MOD_VOY_COURIER_CARD');
  const nextText = (f) => {
    const c = couriers()?.[f.id];
    if (c === undefined) return t('MOD_VOY_COURIER_NO_ROUTE');
    if (c.crossing !== undefined) return t('MOD_VOY_COURIER_ON_PACKET', { to: stopName(c.stops[c.next]) });
    return t(c.retired === true ? 'MOD_VOY_COURIER_UNLOADING' : 'MOD_VOY_COURIER_NEXT', { to: stopName(c.stops[c.next]) });
  };

  // ---- the route as the editor and the card read it --------------------------------------------------------------
  /** The land hex a courier stands on for a stop: the hex itself, else land next to it (a port's own hex is often water). */
  const landFor = (hex) => {
    const ground = state.walks?.ground;
    if (ground === undefined) return undefined;
    for (const [dq, dr] of [[0, 0], ...W.NEIGHBOURS]) {
      if (ground(hex.q + dq, hex.r + dr) !== undefined) return { q: hex.q + dq, r: hex.r + dr };
    }
    return undefined;
  };
  const forgetRoads = () => { roadMemo.clear(); packetMemo.clear(); supplyMemo.clear(); };
  /**
   * Hexes where a courier can top up its road food (round 5): a place to load in reach, as for your stores. Kept a
   * while, as the roads are: the places you know grow as the map fills in.
   */
  const supplyMemo = new Map();
  const isSupply = (hex) => {
    const key = `${hex.q},${hex.r}`;
    const was = supplyMemo.get(key);
    const at = Date.now();
    if (was !== undefined && at - was.at < LOOP_MS) return was.on;
    let on = false;
    try { on = (state.stores?.sourcesAt?.(hex) ?? []).length > 0; } catch {}
    if (supplyMemo.size > 4096) supplyMemo.clear();
    supplyMemo.set(key, { on, at });
    return on;
  };
  const stretchOpts = (f) => ({ stopHex, road: roadFor(f), packet: packetFor, distance });
  /**
   * Whether a route's road food can ever be packed (round 5, the .711 check: Milo stood at its bank stop for good): for
   * each bank stop, the way to the next one split where it can top up, against what the places there hold when full.
   * Undefined, or { at, short, hex }: the bank stop it could never leave, by how much, and where it would stand.
   */
  const foodCheck = (id, stops) => {
    if (state.stores?.enabled?.() !== true || !Array.isArray(stops) || stops.length < 2) return undefined;
    const f = folksApi()?.folkById(id);
    if (f === undefined) return undefined;
    for (let i = 0; i < stops.length; i++) {
      if (stops[i].kind !== 'bank') continue;
      const hex = stopHex(stops[i]);
      if (hex === undefined) continue;
      const from = landFor(hex) ?? hex;
      const steps = M.stretchSteps({ stops, next: (i + 1) % stops.length, from, road: [], reached: 0, into: 0 }, stretchOpts(f));
      if (steps.length === 0) continue;
      const parts = M.stretchParts(steps, isSupply);
      const points = parts.map((part, k) => ({ need: state.walks.packFor(part, f), stock: state.stores.fullStockAt(k === 0 ? from : parts[k - 1][parts[k - 1].length - 1]) }));
      const miss = M.stretchFits(points);
      if (miss !== undefined) return { at: i, short: miss.short, hex: miss.at === 0 ? from : parts[miss.at - 1][parts[miss.at - 1].length - 1] };
    }
    return undefined;
  };
  const preview = (id, stops) => {
    const f = folksApi()?.folkById(id);
    if (f === undefined) return undefined;
    return M.previewRoute(stops, { stopHex, standOn: landFor, road: roadFor(f), packet: packetFor });
  };
  /**
   * The road food for the way to its next bank stop, from the bank where it stands: { pack, need }, `pack` undefined when
   * the bank or the place is short. With Provisions off it needs none.
   */
  const packRoadFood = (f, c) => {
    const none = { food: 0, fuel: 0 };
    if (state.stores?.enabled?.() !== true) return { pack: c.pack ?? none, need: none };
    const steps = M.stretchSteps(c, stretchOpts(f));
    const need = state.walks.packFor(steps, f);
    // As much as the bank and the places give for the whole way, but at least to the first hex where it can top up
    // (round 5: a stretch longer than the places here hold no longer keeps it at the bank for good).
    const min = state.walks.packFor(M.stretchParts(steps, isSupply)[0], f);
    // Hurt, it packs the extra food its healing eats on the first hexes (round 5); a bank short of that packs the plain
    // road food, so healing never keeps it waiting.
    const a = api();
    const now = a?.folkById(f.id) ?? f;
    const n = typeof a?.heal === 'function' && Array.isArray(steps) ? M.roadHealHexes(now.hp ?? now.maxHp, now.maxHp) : 0;
    if (n > 0) {
      const extra = state.walks.packFor(steps.slice(0, n), f);
      const more = state.stores.packRoad(M.hexOf(c), { ...need, food: need.food + extra.food * (M.ROAD_HEAL_FOOD - 1) }, c.pack);
      if (more !== undefined) return { pack: more, need, min };
    }
    return { pack: state.stores.packRoad(M.hexOf(c), need, c.pack, min), need, min };
  };
  /**
   * On a hex where it can load (round 5), it tops its pack up to what the rest of the way to its next bank stop needs,
   * from the bank at the places' rates and stocks. Undefined when it can't get at least to the next such hex: it waits
   * there. `at` the courier standing on the hex.
   */
  const topUpFood = (f, p, at, short) => {
    const here = M.hexOf(at);
    if (!isSupply(here)) return p;
    const rest = [...at.road.slice(at.reached), ...M.stretchSteps({ ...at, reached: at.road.length, into: 0 }, stretchOpts(f))];
    if (rest.length === 0) return p;
    const need = state.walks.packFor(rest, f);
    if (p.food >= need.food - 1e-6 && p.fuel >= need.fuel - 0.005) return p;
    const min = state.walks.packFor(M.stretchParts(rest, isSupply)[0], f);
    const got = state.stores.packRoad(here, need, p, min);
    if (got === undefined) { short({ need: min, hex: here, have: p }); return undefined; }
    if (got.food > p.food + 0.5 || got.fuel > p.fuel + 0.005) log(`courier ${f.name} topped up its road food at (${here.q},${here.r}): ${Math.round(p.food)} -> ${Math.round(got.food)} food`);
    return got;
  };
  /** Folk id → its last worked-out round trip. Worked out again when a stop moves, or after a while as the map fills in. */
  const loops = new Map();
  const LOOP_MS = 600000;
  /** Its round trip: { ms, fares }, undefined with a leg that has no way. */
  const loopOf = (f) => {
    const c = couriers()?.[f.id];
    if (c === undefined) return undefined;
    const key = JSON.stringify([c.stops, c.stops.map(stopHex)]);
    const was = loops.get(f.id);
    const at = Date.now();
    if (was?.key === key && at - was.at < LOOP_MS) return was.loop;
    const p = preview(f.id, c.stops);
    const loop = p === undefined || p.noRoad ? undefined : { ms: p.ms, fares: p.fares };
    loops.set(f.id, { key, loop, at });
    return loop;
  };
  const badgeText = (f) => {
    const c = couriers()?.[f.id];
    return c === undefined ? t('MOD_VOY_COURIER_NO_ROUTE') : t('MOD_VOY_COURIER_BADGE', { count: `${(c.pending ?? c.stops).length}` });
  };
  const effectLines = (f) => {
    if (couriers()?.[f.id] === undefined) return [{ before: t('MOD_VOY_COURIER_SET_ROUTE'), tone: 'bad' }];
    const loop = loopOf(f);
    if (loop === undefined) return [];
    const line = (key, name, value) => { const [before, after = ''] = t(key, { [name]: '\u0001' }).split('\u0001'); return { before, value, after }; };
    const out = [line('MOD_VOY_COURIER_LOOP', 'time', state.clock?.duration?.(loop.ms) ?? '')];
    if (loop.fares > 0) out.push(line('MOD_VOY_COURIER_FARES', 'gp', N.shortNumber(loop.fares)));
    return out;
  };
  /** Every Folk on the job or with a saved route, for the Crew block. */
  const rows = () => {
    const a = folksApi();
    if (a === undefined || !usable()) return [];
    return a.folks().filter((f) => holds(f) || hasRoute(f.id))
      .map((f) => ({ folk: f, line: holds(f) ? nextText(f) : t('MOD_VOY_COURIER_OFF_JOB'), warn: holds(f) && !hasRoute(f.id) }));
  };
  /** For the map: each courier on the job, its hex and what is left of this leg. */
  const routes = () => {
    const a = folksApi();
    const list = couriers();
    if (a === undefined || list === undefined) return [];
    const out = [];
    for (const [id, c] of Object.entries(list)) {
      if (!holds(a.folkById(id))) continue;
      if (c.crossing !== undefined) out.push({ id, at: M.crossingAt(c), ahead: M.crossingAhead(c) });
      else out.push({ id, at: M.hexOf(c), ahead: c.road.slice(c.reached).map((h) => ({ q: h.q, r: h.r })) });
    }
    return out;
  };
  const onPacket = (id) => couriers()?.[id]?.crossing !== undefined;
  /** What a tapped hex offers this courier as a stop. A bank stop has to be a place you know. */
  const stopsHere = (id, hex) => {
    const a = folksApi();
    if (a === undefined) return [];
    const isBank = (h) => {
      const rec = state.recordAt?.(h);
      return rec !== undefined && rules.isTradePlace(rec) && state.knowledge?.isKnown(rec) !== false;
    };
    return M.stopsAt(hex, { folks: a.folks(), tents: tents(), isBank, self: id });
  };
  /** Why you can't change this route from where you stand: at a bank place, or within a hex of the courier, you can. */
  const editRefusal = (id) => {
    const f = folksApi()?.folkById(id);
    if (f === undefined) return '';
    const pos = state.position();
    // On a packet it is out at sea, whatever hex it boarded from.
    if (f.travel === 'with' || (!onPacket(id) && pos != null && f.place != null && distance(pos, f.place) <= M.STOP_REACH)) return undefined;
    const rec = pos == null ? undefined : state.recordAt?.(pos);
    if (rec !== undefined && H.isBankPlace(rec, state.terrain?.neighbours(rec.q, rec.r) ?? [], rules.isTradePlace)) return undefined;
    return t('MOD_VOY_ROUTE_TOO_FAR', { name: f.name });
  };

  // ---- Welcome Back: one line a courier, under the game's own -----------------------------------------------------
  try {
    ctx.patch(OfflineProgressElement, 'setMessages').after(function () {
      try {
        const lines = [...awayTally].slice(0, 12);
        awayTally.clear();
        if (lines.length === 0 || this.messageContainer == null) return;
        const media = esc(ctx.getResourceUrl('assets/couriers_licence.webp'));
        const good = (s) => `<span class="text-success">${esc(s)}</span>`;
        for (const [id, x] of lines) {
          const name = folksApi()?.folkById(id)?.name;
          if (name === undefined) continue;
          const h = document.createElement('h5');
          h.className = 'font-w600 mb-1';
          const who = `<span class="text-nowrap"><img class="skill-icon-xs" src="${media}" alt=""> ${esc(name)}</span>`;
          const gp = good(N.shortNumber(x.fares));
          h.innerHTML = x.trips === 0 ? t('MOD_VOY_COURIER_OFFLINE_FARES_ONLY', { name: who, gp }) : t(x.fares > 0 ? 'MOD_VOY_COURIER_OFFLINE_FARES' : 'MOD_VOY_COURIER_OFFLINE', {
            name: who,
            trips: good(t(x.trips === 1 ? 'MOD_VOY_COURIER_TRIPS_ONE' : 'MOD_VOY_COURIER_TRIPS', { n: numberWithCommas(x.trips) })),
            items: good(t(x.items === 1 ? 'MOD_VOY_COURIER_ITEMS_ONE' : 'MOD_VOY_COURIER_ITEMS', { n: numberWithCommas(x.items) })),
            gp,
          });
          this.messageContainer.append(h);
        }
      } catch (e) { log('courier offline lines failed', e); }
    });
  } catch (e) { log('courier offline summary not patched', e); }

  // ---- on and off the job --------------------------------------------------------------------------------------------
  const startDuty = (a, folk) => {
    const list = couriers();
    const was = list?.[folk.id];
    // A packet it was on has come in meanwhile: it starts from the far shore.
    const from = was?.crossing !== undefined ? was.crossing.to : folk.travel === 'with' ? state.position() : folk.place;
    if (from == null) return;
    standOn(a, folk.id, from);
    if (folk.travel !== 'walking') a.setTravel(folk.id, 'walking');
    if (was !== undefined) list[folk.id] = M.startLeg(M.land(was), from, []);
    held.delete(folk.id);
  };
  /** Off the job it stands on its hex; the route stays saved for when it takes the job again. */
  const endDuty = (a, folk) => {
    const list = couriers();
    const was = list?.[folk.id];
    if (was !== undefined) {
      // Off the job mid-crossing it lands at the far port at once: nothing moves it any more.
      const c = M.land(was);
      list[folk.id] = M.startLeg(c, M.hexOf(c), []);
      if (was.crossing !== undefined) standOn(a, folk.id, M.hexOf(c));
    }
    held.delete(folk.id);
    if (a.folkById(folk.id)?.travel === 'walking') a.setTravel(folk.id, 'idle');
  };
  const forget = (id) => {
    const list = couriers();
    if (list !== undefined) delete list[id];
    held.delete(id);
    loops.delete(id);
    partsMemo.delete(id);
    awayTally.delete(id);
    linksChanged();
  };

  /** The haul or the rules went off: every courier leaves the job first, so its load empties as any Folk's. */
  const standDown = () => {
    const a = folksApi();
    if (a === undefined) return;
    const list = couriers();
    for (const f of a.folks()) {
      if (!holds(f)) continue;
      try {
        // Ashore first: a Folk on a packet takes no orders.
        if (list?.[f.id]?.crossing !== undefined) { list[f.id] = M.land(list[f.id]); standOn(a, f.id, M.hexOf(list[f.id])); }
        a.setJob(f.id, null);
      } catch (e) { log('courier stand-down failed', e); }
    }
  };

  /** Gives a Folk a route: an edit to a running route waits for its next bank stop. */
  /** A route changed: Worker Folks asks again which lines are carried, and those no route serves any more are cut. */
  const linksChanged = () => {
    try { folksApi()?.refreshLinks?.(); state.haul?.checkLinks?.(); } catch (e) { log('courier links refresh failed', e); }
  };
  /** A far supply line this route can carry now. */
  const carries = (supplierId, receiverId) => carriesLinks() && M.carrierOf(couriers(), supplierId, receiverId, depotOf) !== undefined;
  /** One route serves both Folks, whether or not the line can ride with it yet. */
  const servesBoth = (supplierId, receiverId) => usable() && M.carrierOf(couriers(), supplierId, receiverId, depotOf) !== undefined;
  /** A courier's parts by Folk and tent, kept until its last round or its route changes. */
  const partsMemo = new Map();
  const partsOf = (id, c) => {
    const route = M.routeOf(c);
    const was = partsMemo.get(id);
    if (was?.last === c.last && was?.route === route) return was.parts;
    const parts = M.routeParts(c);
    partsMemo.set(id, { last: c.last, route, parts });
    return parts;
  };
  /** How many Folks stand by each tent, counted at most once a second. */
  const TENT_COUNT_MS = 1000;
  let tentCounts;
  let tentCountsAt = 0;
  const membersAt = (a, key) => {
    const at = Date.now();
    if (tentCounts === undefined || at < tentCountsAt || at - tentCountsAt >= TENT_COUNT_MS) {
      const up = tents();
      tentCounts = new Map();
      for (const f of a.folks()) {
        if (f.travel !== 'idle' || f.place == null) continue;
        const at2 = H.depotFor(f.place, up, distance)?.key;
        if (at2 !== undefined) tentCounts.set(at2, (tentCounts.get(at2) ?? 0) + 1);
      }
      tentCountsAt = at;
    }
    return tentCounts.get(key) ?? 1;
  };
  /**
   * For Worker Folks: the couriers on the job whose routes serve this Folk, with its share of each and that courier's
   * whole fares per hour. Asked often, so it does no search: the numbers are kept from the job's own looks. It answers
   * while Voyage is still loading too, or a served Folk would set off on a Township run of its own.
   */
  const routeShare = (view) => {
    const a = folksApi();
    if (a === undefined || view?.id === undefined) return null;
    const list = couriers();
    const served = M.couriersServing(list, view.id, depotOf).filter((id) => holds(a.folkById(id)));
    if (served.length === 0) return null;
    const tent = depotOf(view.id);
    return served.map((courierId) => {
      const c = list[courierId];
      return {
        courierId,
        share: M.folkPart(partsOf(courierId, c), view.id, tent, tent === undefined ? 1 : membersAt(a, tent)),
        faresPerHour: M.faresPerHour(c, loops.get(courierId)?.loop),
      };
    });
  };
  const setRoute = (id, stops) => {
    const a = folksApi();
    const f = a?.folkById(id);
    const list = couriers();
    const problem = M.routeProblem(stops);
    if (problem !== undefined || f === undefined || list === undefined) return problem ?? 'unknown';
    const clean = stops.map(M.cleanStop);
    const c = list[id];
    if (c === undefined || c.retired === true) {
      const from = f.travel === 'with' ? state.position() : f.place;
      if (from == null) return 'unknown';
      // A courier still on the packet of a deleted route stays on it, and keeps its food.
      list[id] = { ...M.newCourier(clean, from), ...(c?.crossing === undefined ? {} : { crossing: c.crossing }), ...(c?.pack === undefined ? {} : { pack: c.pack }) };
    } else list[id] = { ...c, pending: clean };
    held.delete(id);
    linksChanged();
    return undefined;
  };
  /**
   * The card you lend a courier for the bands of its road (round 5): one of your deck's that a Folk may carry, offered
   * first next time. Refused while a band holds it: that fight was dealt its deck already.
   */
  const setLent = (id, card) => {
    const list = couriers();
    const c = list?.[id];
    if (c === undefined || c.held !== undefined || c.lent === card) return false;
    if (!(state.encounters?.lendables?.().cards ?? []).some((x) => x.id === card)) return false;
    list[id] = { ...c, lent: card };
    try { state.encounters?.rememberLent?.(card); } catch {}
    log(`courier ${id} carries ${card} for its bands`);
    return true;
  };
  /** Deletes a route: on the job it goes to the nearest of its bank stops and unloads; off it, the route is just gone. */
  const deleteRoute = (id) => {
    const list = couriers();
    const c = list?.[id];
    if (c === undefined) return false;
    if (holds(folksApi()?.folkById(id))) list[id] = M.retire(c, distance);
    else delete list[id];
    linksChanged();
    return true;
  };

  let registered = false;
  const register = () => {
    if (registered) return;
    const a = folksApi();
    if (a === undefined) return;
    try {
      a.registerJob({
        id: M.COURIER_JOB,
        name: () => t('MOD_VOY_COURIER_JOB'),
        media: () => ctx.getResourceUrl('assets/couriers_licence.webp'),
        everyMs: () => M.LOOK_MS,
        work,
        unlocked: usable,
        lockText: () => t('MOD_VOY_COURIER_LOCK', { name: licence()?.name ?? '' }),
        refusal,
        describe: (f) => [nextText(f)],
        working: (f) => nextText(f),
        badge: badgeText,
        effects: effectLines,
        travels: true,
        shared: true,
        roomScale: M.LOAD_SCALE,
      });
      registered = true;
      a.registerRouteShare?.(routeShare);
      a.on('folkJobChanged', ({ folk, previous, jobId }) => {
        try {
          if (jobId === M.COURIER_JOB) startDuty(a, folk);
          else if (previous === M.COURIER_JOB) endDuty(a, folk);
        } catch (e) { log('courier job change failed', e); }
      });
      // Brought aboard, it is one of your crew again and no longer on the road.
      a.on('folkMoved', ({ folk }) => {
        try { if (holds(folk) && folk.travel === 'with') a.setJob(folk.id, null); } catch (e) { log('courier move failed', e); }
      });
      for (const name of ['folkFired', 'folkDied']) a.on(name, ({ folk }) => { if (folk?.id !== undefined) forget(folk.id); });
    } catch (e) { console.error('[Voyage] the Courier job failed to register', e); }
  };
  // After every mod's own load step (Worker Folks' jobs exist by then), before the first game tick of a character.
  ctx.onCharacterSelectionLoaded(register);
  ctx.onCharacterLoaded(register);

  /** What this code holds between looks, counted, with anything uncapped or left by a gone Folk named in `problems`. */
  const kept = () => M.keptReport({
    roads: roadMemo,
    packets: packetMemo,
    perCourier: { held, loops, parts: partsMemo, awayTally },
    tentCounts,
    tents: tents().length,
    couriers: couriers() ?? {},
    folkIds: (folksApi()?.folks() ?? []).map((f) => f.id),
  });

  return {
    kept,
    holds, hasRoute, whereText, standDown, setRoute, setLent, deleteRoute, all: () => couriers(), usable,
    rows, routes, stopName, stopsHere, editRefusal, preview, foodCheck, forgetRoads, onPacket, carries, servesBoth,
    bandWound, bandDone, loadWorth: (id) => { const a = api(); return a === undefined ? 0 : loadWorth(a, id); },
    /** The sea hex a courier's packet is on (where a band holds it), or undefined ashore: where its cairn is left. */
    seaHexOf: (id) => { const c = couriers()?.[id]; return c?.crossing === undefined ? undefined : M.crossingAt(c); },
    /** A road moment's answer (round 5): `fn(courier)` gives the changed courier, kept when the save can read it. */
    edit: (id, fn) => {
      const all = couriers();
      const c = all?.[id];
      if (c === undefined) return false;
      const next = M.cleanCourier(fn(c));
      if (next === undefined) return false;
      all[id] = next;
      return true;
    },
  };
}
