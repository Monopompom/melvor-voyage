// The vessels in the game (phase 3b; two vessels from build .150): the rules of ship-model.mjs applied
// to the map. They live in the Voyage skill's save record: `record.boat`, the small boat (dinghy or longboat), and
// `record.ship`, the big ship (the brig) or null. This module keeps them in step with the player. Inside this file
// `ship()` is the small boat, as it was before the brig; `big()` is the big ship.
//
// Pathing: WorldMap.getHexNeighboursAndCosts feeds the game's A* (computePath), which the travel button, the
// trader and the stranded check all use. Dropping the steps canStep refuses makes every path obey "off the ship,
// land only" without touching travel itself. With a big ship that memoryless rule can't say which vessel you are in,
// so computePath itself is replaced by ship-model.mjs routeSearch, whose path carries the vessel of each step
// (`path.voyageModes`, destination first like the path). The rules apply only while state.active() (table trusted,
// rules on). A move then calls afterMove, which moves the vessels along. The hex overview says why a hex has no path.

// Modal buttons: confirm green, cancel blue outline (the game's default cancel is red; grey means disabled).
const SWAL_CLASS = { popup: 'voyage-ui', confirmButton: 'btn btn-success m-1', cancelButton: 'btn btn-outline-info m-1' };

export function install(ctx, { state, model, shipModel, terrainMod, helpLayout, log }) {
  const { HULLS, BIG_SHIPS } = shipModel;
  const skill = () => state.voyageSkill?.();
  const record = () => { const s = skill(); return s === undefined || s.futureRaw !== undefined ? undefined : s.record; };
  /** The small boat, null when there is none, undefined when the skill is missing or its save is from a newer build. */
  const ship = () => record()?.boat;
  /** The big ship (the brig), null when there is none; undefined as above. */
  const big = () => record()?.ship;
  const vessel = (kind) => (kind === 'ship' ? big() : ship());
  const enabled = () => ship() !== undefined && state.active();
  const listeners = [];
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  /** A hull named mid-sentence ("your dinghy"): its tier name, lower case in English. */
  const hullWord = (hull) => (hull === undefined ? t('MOD_VOY_SHIP_BOAT') : t(shipModel.tierNameKey(hull.tier)));

  /** Terrain record of a game hex; hexes outside the table count as land unless the game marks them water. */
  const recOf = (hex) => state.recordAt(hex) ?? { q: hex.q, r: hex.r, t: hex.isWater ? 'water' : 'grasslands' };
  const player = () => state.position();
  /**
   * Map facts for the step rule (ship-model.mjs seaIndex): island tiers and the sailing distance to a coast each hull
   * may land on. Rebuilt when the terrain is (every character load). Undefined before a character is loaded.
   */
  let geo;
  let geoFor;
  const geoNow = () => {
    if (state.terrain === undefined) return undefined;
    if (geoFor !== state.terrain) { geo = shipModel.seaIndex(state.terrain); geoFor = state.terrain; }
    return geo;
  };
  /** The vessel you are in: 'ship' on the big ship's hex, 'boat' on the small boat's, undefined ashore. */
  const inVessel = () => {
    const p = player();
    if (p === undefined) return undefined;
    const rec = recOf(p);
    if (big() != null && shipModel.sameHex(rec, big())) return 'ship';
    const b = ship();
    if (b != null && b.aboard !== true && shipModel.sameHex(rec, b)) return 'boat';
    return undefined;
  };
  const aboard = () => inVessel() !== undefined;

  /**
   * Every change to a vessel goes through here: page, markers and the selected path follow. `kind` 'boat' (the small
   * boat, `record.boat`) or 'ship' (the big ship, `record.ship`). The boat aboard follows the big ship's hex.
   */
  const setVessel = (kind, next, why) => {
    const s = skill();
    if (s === undefined || s.futureRaw !== undefined) return;
    if (kind === 'ship') {
      s.record.ship = next;
      const b = s.record.boat;
      if (b?.aboard === true) s.record.boat = next == null ? { ...b, aboard: false } : { ...b, q: next.q, r: next.r };
    } else s.record.boat = next;
    s.renderQueue.page = true;
    try { game.cartography.renderQueue.hexPath = true; } catch {}
    if (why) log(`${kind} ${why}:`, next);
    listeners.forEach((fn) => { try { fn(); } catch (e) { log('ship listener failed', e); } });
    state.onSettingsChange(); // the here panel and the page redraw
  };
  const setShip = (next, why) => setVessel('boat', next, why);

  // ---- pathing --------------------------------------------------------------------------------------------------
  /** True while routeSearch reads the game's neighbours: it applies the rules itself. */
  let rawNeighbours = false;
  ctx.patch(WorldMap, 'getHexNeighboursAndCosts').after(function (result, hex) {
    try {
      if (rawNeighbours || !Array.isArray(result) || !enabled()) return result;
      const from = recOf(hex);
      const s = ship();
      const g = geoNow();
      if (g === undefined) return result;
      // Fast travel between ports is sailing (3c): the hop needs the ship at this port's quay.
      return result.filter(([n]) => (isHop(hex, n) ? shipModel.canHop(from, recOf(n), s, dockOf(n), g) : shipModel.canStep(from, recOf(n), s, g)));
    } catch (e) { log('ship pathing failed; vanilla path', e); return result; }
  });

  /**
   * Two vessels (build .150): the route over (hex, vessel you are in). The game's own A* stays for everyone without a
   * big ship. The path is the game's (destination first) with `voyageModes` alongside.
   */
  ctx.patch(WorldMap, 'computePath').replace(function (original, start, goal) {
    if (!enabled() || big() == null) return original(start, goal);
    const g = geoNow();
    if (g === undefined) return original(start, goal);
    try {
      const costModifier = this.cartography.travelCostMultiplier;
      const scale = costModifier * this._lowestTravelCost;
      rawNeighbours = true;
      let found;
      try {
        found = shipModel.routeSearch({
          start, goal, key: (h) => `${h.q},${h.r}`, rec: recOf,
          neighbours: (h) => this.getHexNeighboursAndCosts(h, costModifier).map(([n, c]) => [n, c, isHop(h, n)]),
          heuristic: (h) => this._pathHeuristic(goal, h, scale),
          boat: ship(), ship: big(), geo: g, dockOf,
        });
      } finally { rawNeighbours = false; }
      if (found === undefined) return undefined;
      const path = [...found.path].reverse();
      path.voyageModes = [...found.modes].reverse();
      return path;
    } catch (e) { rawNeighbours = false; log('route search failed; vanilla path', e); return original(start, goal); }
  });

  /** A fast-travel hop between two game hexes (the game's port network; getTravelCosts skips these). */
  /**
   * On a phone, how far down (screen px) the middle of the map's open part lies from the map's middle: the Here panel
   * covers the top (its top-anchored form, src/here-panel.mjs), the screen's edge may cut the bottom. Else 0.
   */
  const shownMiddle = () => {
    try {
      if (window.matchMedia?.('(max-width: 767.98px)').matches !== true) return 0;
      const panel = document.getElementById('voyage-here');
      const mapEl = cartographyMap?.bottomLeftOverlay?.parentElement;
      if (panel == null || mapEl == null || !panel.classList.contains('voyage-here-top')) return 0;
      const p = panel.getBoundingClientRect();
      const m = mapEl.getBoundingClientRect();
      if (p.width === 0 || p.height === 0 || p.width < m.width / 2) return 0;
      const top = Math.max(m.top, Math.min(p.bottom, m.bottom));
      const bottom = Math.min(m.bottom, window.innerHeight);
      return bottom - top < 80 ? 0 : (top + bottom) / 2 - (m.top + m.bottom) / 2;
    } catch { return 0; }
  };
  const isHop = (prev, next) => { try { return prev.canFastTravelTo(next) === true; } catch { return false; } };
  /**
   * True when the player has fully surveyed the hex. Travel only paths through such hexes (the game's
   * getHexNeighboursAndCosts), so a boat put anywhere else could not be reached (user report, build .55).
   */
  const charted = (rec) => {
    try { return game.cartography.activeMap?.getHex(new HexCoords(rec.q, rec.r))?.isFullySurveyed === true; } catch { return false; }
  };
  /**
   * Where the ship docks at a port reached by a hop: the port hex itself for a port on the water, else a sea hex next
   * to it (open water first), a surveyed one when there is any (otherwise surveying it is the way back aboard), or
   * undefined.
   */
  const dockOf = (hex) => {
    if (state.terrain === undefined) return undefined;
    const rec = recOf(hex);
    const around = state.terrain.neighbours(rec.q, rec.r);
    return shipModel.dockSpot(rec, around.filter(charted)) ?? shipModel.dockSpot(rec, around);
  };
  /** Sea steps from `rec` to a coast the hull `v` (the small boat by default) may land on (any coast with none); 0 on land. */
  const homeOf = (rec, v = ship()) => {
    const g = geoNow();
    if (g === undefined) return shipModel.isSea(rec) ? (rec.shore ?? 1) : 0;
    return g.home(rec, v == null ? 0 : shipModel.tierOf(v));
  };

  /**
   * The steps of a move in walking order (start to destination), for the XP of model.xpForSteps and the stores of
   * stores-model.mjs planMove: { water, sea, cls, fastTravel, hop, free, homeward, deep }. `hop` is a fast-travel hop's
   * straight-line length while the ship rules make it sailing; with the rules off a hop stays vanilla (free). `free`
   * also marks the homeward rule's moves. `homeward`: a sea step closer to a coast. `deep`: 3+ hexes from land (hull
   * wear, 3d). `vessel` ('boat' or 'ship', build .150): what a sea step or hop is sailed in, from the path's
   * `voyageModes` (the small boat for a path without them); its reach, wear and condition apply. `adrift` (5b part
   * two): a sea step out of a hex where Adrift applies, so the hunger floor does not (stores-model planMove).
   */
  const stepsOf = (path) => {
    const modes = path.voyageModes;
    const g = geoNow();
    const sailing = enabled();
    const adriftOn = state.adrift?.applies?.() === true;
    const steps = [];
    for (let i = path.length - 2; i >= 0; i--) {
      const next = path[i];
      const prev = path[i + 1];
      const rec = recOf(next);
      const m = modes?.[i];
      const kind = m === undefined ? 'boat' : (m.hop ?? (m.m === 'ship' ? 'ship' : 'boat'));
      const v = vessel(kind);
      const fastTravel = isHop(prev, next);
      const sea = shipModel.isSea(rec);
      const hop = fastTravel && sailing ? terrainMod.hexDistance(prev, next) : 0;
      const free = (fastTravel && hop === 0) || shipModel.isFreeStep(rec, v, g);
      const homeward = sea && homeOf(rec, v) < homeOf(recOf(prev), v);
      const deep = sea && (Number.isInteger(rec.shore) ? rec.shore : 1) >= shipModel.DEEP_SHORE;
      // Where Adrift applies (5b part two) the sea's hunger floor is gone: a step out of a hex more than one from the coast.
      const adrift = sea && adriftOn && homeOf(recOf(prev), v) > 1;
      steps.push({ water: sea, sea, cls: rec.t, fastTravel, hop, free, homeward, deep, ...(adrift ? { adrift } : {}), ...(sea || hop > 0 ? { vessel: kind } : {}) });
    }
    return steps;
  };

  /**
   * After a move along `path` (the game's order: destination first). The ship follows a sea crossing it was boarded
   * for. Standing on the sea away from it (a move with the rules off) brings it over: on the sea you are aboard.
   */
  const afterMove = (path) => {
    // Two vessels: replay the route's modes (build .150).
    if (Array.isArray(path.voyageModes) && big() != null) {
      const recs = path.map((hex) => ({ ...recOf(hex), hex })).reverse();
      const modes = [...path.voyageModes].reverse();
      const after = shipModel.vesselsAfterRoute(recs, modes, ship(), big(), (rec) => dockOf(rec.hex));
      if (after.ship !== big()) setVessel('ship', after.ship, 'moved');
      if (after.boat !== ship()) setVessel('boat', after.boat, 'moved');
      snapToPlayer();
      return;
    }
    // One vessel moves: the big ship when the move starts on it, else the small boat (the trader's roads, rules off).
    const startRec = recOf(path[path.length - 1]);
    const kind = big() != null && shipModel.sameHex(startRec, big()) ? 'ship' : 'boat';
    const s = vessel(kind);
    if (s == null || (kind === 'boat' && s.aboard === true)) { snapToPlayer(); return; }
    // Walking order; a record reached by a sailed fast-travel hop carries hop: true (the ship goes with you).
    const recs = path.map((hex, i) => ({ ...recOf(hex), hop: enabled() && i < path.length - 1 && isHop(path[i + 1], hex), hex })).reverse();
    let next = shipModel.shipAfterHops(recs, s, (rec) => dockOf(rec.hex));
    if (next !== s && shipModel.sameHex(next, s)) next = s;
    if (next !== s) setVessel(kind, next, 'moved');
    snapToPlayer();
  };

  // ---- building -------------------------------------------------------------------------------------------------
  /** Costs of a { gp, items } spec (the dinghy, an upgrade); items the game doesn't know are left out. */
  const costsOf = (spec) => {
    const costs = new Costs(game);
    costs.addCurrency(game.gp, spec.gp);
    for (const { id, quantity } of spec.items) {
      const item = game.items.getObjectByID(id);
      if (item !== undefined) costs.addItem(item, quantity);
    }
    return costs;
  };
  /** Fishing can be had: not Adventure before Fishing is bought (the Old Hat is Fishing junk). */
  const canFish = () => { try { return game.fishing?.isUnlocked !== false; } catch { return true; } };
  const buildCosts = () => costsOf(shipModel.dinghyBuild(canFish()));
  const launchSpot = () => {
    const p = player();
    if (p === undefined || state.terrain === undefined) return undefined;
    const rec = recOf(p);
    // Only water the player has surveyed: a boat launched into fog can't be reached (and building it would reveal
    // that the fog hides water).
    return shipModel.launchSpot(rec, state.terrain.neighbours(rec.q, rec.r).filter(charted));
  };
  /** Why the dinghy can't be built right now, or undefined. */
  const buildBlocker = () => {
    if (ship() !== null) return t('MOD_VOY_SHIP_BLOCK_HAS_SHIP');
    if (!state.active()) return t('MOD_VOY_SHIP_BLOCK_RULES_OFF');
    if (launchSpot() === undefined) return t('MOD_VOY_SHIP_BLOCK_NOT_COAST');
    if (!buildCosts().checkIfOwned()) return t('MOD_VOY_SHIP_BLOCK_NO_MATERIALS');
    return undefined;
  };
  const build = () => {
    const why = buildBlocker();
    if (why !== undefined) { notifyPlayer(skill(), why, 'danger'); return false; }
    const spot = launchSpot();
    const costs = buildCosts();
    costs.consumeCosts();
    setShip({ hull: 'dinghy', q: spot.q, r: spot.r, cond: 100, hold: [], aboard: false }, 'built');
    state.journal?.learn('dinghy');
    try { game.notifications.createSuccessNotification('voyage:ship', t('MOD_VOY_SHIP_BUILT'), ctx.getResourceUrl(HULLS.dinghy.media)); } catch {}
    return true;
  };

  // ---- upgrades (phase 4) ------------------------------------------------
  /** On or next to a port: the stores' rule, as for Navigator's Charts. */
  const atPort = () => { try { return state.stores?.loadingHere?.()?.place === 'port'; } catch { return false; } };
  /**
   * { id, hull, upgrade, blocker } for the upgrade open to a vessel's hull, or undefined (no vessel, or its last hull).
   * `kind` 'boat' (dinghy to longboat) or 'ship' (brig to galleon, build .152). Either is built at a port with the old
   * hull at the quay (on your hex or next to it).
   */
  const upgradeInfo = (kind = 'boat') => {
    const s = vessel(kind);
    const up = s == null ? undefined : shipModel.upgradeFor(s);
    if (up === undefined) return undefined;
    const [id, u] = up;
    const p = player();
    const word = hullWord(HULLS[s.hull]);
    let blocker;
    if (!state.active()) blocker = t('MOD_VOY_SHIP_BLOCK_RULES_OFF');
    else {
      const why = shipModel.upgradeBlocker(s, u, { level: skill()?.level ?? 1, atPort: atPort(), playerRec: p === undefined ? undefined : recOf(p), owned: costsOf(u).checkIfOwned() });
      if (why === 'level') blocker = t('MOD_VOY_UPGRADE_BLOCK_LEVEL', { level: `${u.level}` });
      else if (why === 'port') blocker = t('MOD_VOY_UPGRADE_BLOCK_PORT', { hull: word });
      else if (why === 'quay') blocker = t('MOD_VOY_UPGRADE_BLOCK_QUAY', { hull: word });
      else if (why === 'cost') blocker = t('MOD_VOY_UPGRADE_BLOCK_COST');
    }
    return { id, hull: HULLS[id], upgrade: u, blocker, kind };
  };
  const upgrade = (kind = 'boat') => {
    const info = upgradeInfo(kind);
    if (info === undefined) return false;
    if (info.blocker !== undefined) { notifyPlayer(skill(), info.blocker, 'danger'); return false; }
    costsOf(info.upgrade).consumeCosts();
    // The new hull takes the old one's place, hold and all; a boat aboard the big ship stays aboard (setVessel).
    setVessel(kind, { ...vessel(kind), hull: info.id, cond: 100 }, `upgraded to ${info.id}`);
    // The new hull's guide page (build .174): the longboat's or the galleon's, the first time it is yours.
    state.journal?.learn(info.id);
    try { game.notifications.createSuccessNotification('voyage:ship', t('MOD_VOY_SHIP_UPGRADED', { hull: hullWord(info.hull) }), ctx.getResourceUrl(info.hull.media)); } catch {}
    return true;
  };

  // ---- the big ship (build .150) ----------------------------------------------
  /** The port you stand on or next to (a game hex), or undefined. */
  const portHex = () => {
    const p = player();
    if (p === undefined || state.terrain === undefined) return undefined;
    const rec = recOf(p);
    if (shipModel.isPort(rec)) return p;
    const n = state.terrain.neighbours(rec.q, rec.r).find((x) => shipModel.isPort(x));
    try { return n === undefined ? undefined : game.cartography.activeMap?.getHex(new HexCoords(n.q, n.r)); } catch { return undefined; }
  };
  /** { id, hull, spec, quay, blocker } for buying the brig, or undefined once you have a big ship. */
  const buyInfo = () => {
    if (big() === undefined || big() !== null) return undefined;
    const id = 'brig';
    const spec = BIG_SHIPS[id];
    const port = portHex();
    const quay = port === undefined ? undefined : dockOf(port);
    let blocker;
    if (!state.active()) blocker = t('MOD_VOY_SHIP_BLOCK_RULES_OFF');
    else {
      const why = shipModel.buyBlocker(spec, { ship: big(), level: skill()?.level ?? 1, atPort: atPort() && port !== undefined, quay, owned: costsOf(spec).checkIfOwned() });
      if (why === 'level') blocker = t('MOD_VOY_UPGRADE_BLOCK_LEVEL', { level: `${spec.level}` });
      else if (why === 'port') blocker = t('MOD_VOY_BRIG_BLOCK_PORT');
      else if (why === 'quay') blocker = t('MOD_VOY_BRIG_BLOCK_QUAY');
      else if (why === 'cost') blocker = t('MOD_VOY_UPGRADE_BLOCK_COST');
    }
    return { id, hull: HULLS[id], spec, quay, blocker };
  };
  const buy = () => {
    const info = buyInfo();
    if (info === undefined) return false;
    if (info.blocker !== undefined) { notifyPlayer(skill(), info.blocker, 'danger'); return false; }
    costsOf(info.spec).consumeCosts();
    setVessel('ship', { hull: info.id, q: info.quay.q, r: info.quay.r, cond: 100, hold: [] }, 'bought');
    state.journal?.learn('brig');
    // A boat lying on the brig's new quay is hoisted aboard: two vessels never share a hex otherwise.
    const b = ship();
    if (b != null && b.aboard !== true && shipModel.sameHex(b, info.quay)) setVessel('boat', { ...b, aboard: true }, 'hoisted aboard');
    try { game.notifications.createSuccessNotification('voyage:ship', t('MOD_VOY_BRIG_BOUGHT'), ctx.getResourceUrl(info.hull.media)); } catch {}
    return true;
  };

  // ---- hull condition and repairs (phase 3d) -----------------------------------------------------
  const cond = (kind = 'boat') => shipModel.condOf(vessel(kind));
  /** After a move the stores planned: each hull keeps what the voyage left of it. `kind` 'boat' or 'ship'. */
  const setCond = (value, kind = 'boat') => {
    const s = vessel(kind);
    if (s == null || !Number.isFinite(value)) return;
    const next = Math.min(100, Math.max(0, Math.round(value)));
    if (next !== shipModel.condOf(s)) setVessel(kind, { ...s, cond: next });
  };
  /** Every log in the bank, cheapest first (by the Firemaking level it needs): timber for repairs. */
  const logStacks = () => {
    const out = [];
    try {
      [...game.firemaking.actions.allObjects].sort((a, b) => a.level - b.level).forEach((a) => {
        const qty = a.log === undefined ? 0 : game.bank.getQty(a.log);
        if (qty > 0) out.push({ item: a.log, qty });
      });
    } catch (e) { log('log stacks failed', e); }
    return out;
  };
  const pitchItem = () => { try { return game.items.getObjectByID('voyage:Pitch'); } catch { return undefined; } };
  /** { cond, plan, logs, pitch, blocker }: what a repair here would do, and why it can't when it can't. */
  const repairInfo = (kind = 'boat') => {
    const s = vessel(kind);
    if (s == null) return undefined;
    const logs = logStacks().reduce((n, x) => n + x.qty, 0);
    const item = pitchItem();
    const pitch = item === undefined ? 0 : game.bank.getQty(item);
    const c = shipModel.condOf(s);
    const plan = shipModel.repairPlan(c, logs, pitch);
    let blocker;
    const p = player();
    if (c >= 100) blocker = t('MOD_VOY_HULL_BLOCK_SOUND');
    else if (kind === 'ship' && (p === undefined || !shipModel.canRepair(recOf(p), s, recOf({ q: s.q, r: s.r, isWater: true }), atPort() && shipModel.hexDist(recOf(p), s) <= 1))) blocker = t('MOD_VOY_HULL_BLOCK_PORT', { hull: hullWord(HULLS[s.hull]) });
    // A boat on the big ship's deck is mended there while you are aboard the big ship.
    else if (kind !== 'ship' && s.aboard === true && inVessel() !== 'ship') blocker = t('MOD_VOY_HULL_BLOCK_DECK', { hull: hullWord(HULLS[s.hull]), ship: hullWord(HULLS[big()?.hull]) });
    else if (kind !== 'ship' && s.aboard !== true && (p === undefined || !shipModel.canRepair(recOf(p), s, recOf({ q: s.q, r: s.r, isWater: true })))) blocker = t('MOD_VOY_HULL_BLOCK_BEACH', { hull: hullWord(HULLS[s.hull]) });
    else if (plan.steps === 0) blocker = t('MOD_VOY_HULL_BLOCK_MATERIALS', { logs: `${shipModel.REPAIR.logs}`, pitch: `${shipModel.REPAIR.pitch}`, step: `${shipModel.REPAIR.step}` });
    return { cond: c, plan, logs, pitch, blocker };
  };
  const repair = (kind = 'boat') => {
    const info = repairInfo(kind);
    if (info === undefined) return false;
    if (info.blocker !== undefined) { notifyPlayer(skill(), info.blocker, 'danger'); return false; }
    let logs = info.plan.logs;
    for (const { item, qty } of logStacks()) {
      if (logs <= 0) break;
      const n = Math.min(qty, logs);
      game.bank.removeItemQuantity(item, n, true);
      logs -= n;
    }
    game.bank.removeItemQuantity(pitchItem(), info.plan.pitch, true);
    setVessel(kind, { ...vessel(kind), cond: info.plan.to }, `repaired to ${info.plan.to}%`);
    try { game.notifications.createSuccessNotification('voyage:hull', t('MOD_VOY_HULL_REPAIRED', { cond: `${info.plan.to}` }), ctx.getResourceUrl('assets/hull_condition.webp')); } catch {}
    return true;
  };

  // ---- existing characters ----------------------------------------------------------------------
  /** The notice, in the help-popup layout: what happened, then how ships work, then any warning. */
  const notice = (sections) => {
    try {
      SwalLocale.fire({
        didRender: state.popupDidRender,
        title: `<img class="voyage-title-icon" src="${ctx.getResourceUrl(HULLS.dinghy.media)}" alt="">${t('MOD_VOY_SHIP_NOTICE_TITLE')}`,
        width: helpLayout.HELP_WIDTH,
        html: helpLayout.helpHtml(sections),
        confirmButtonText: t('MOD_VOY_BUTTON_GOT_IT'),
        customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass(SWAL_CLASS) : SWAL_CLASS,
      });
    } catch (e) { log('ship notice failed', e); }
  };
  /** Shown once the interface is up, after any other popup (the compass welcome) has been closed. */
  let pendingNotice;
  const showWhenFree = (sections, tries = 0) => {
    let busy = false;
    try { busy = typeof Swal !== 'undefined' && Swal.isVisible(); } catch {}
    if (busy && tries < 240) { setTimeout(() => showWhenFree(sections, tries + 1), 500); return; }
    notice(sections);
  };
  ctx.onInterfaceReady(() => {
    if (pendingNotice !== undefined) { const sections = pendingNotice; pendingNotice = undefined; setTimeout(() => showWhenFree(sections), 1200); }
  });
  const ruleBand = () => ({ head: t('MOD_VOY_SHIP_NOTICE_HEAD_RULE'), body: [t('MOD_VOY_SHIP_NOTICE_RULE_WATER'), t('MOD_VOY_SHIP_NOTICE_RULE_BOARD'), t('MOD_VOY_SHIP_NOTICE_RULE_ASHORE')] });
  /** The notice's bands: 'overseas' (moored on this land's coast), 'sea' (the boat under you), 'far' (and beyond reach). */
  const noticeSections = (kind) => (kind === 'overseas'
    ? [{ body: [{ html: t('MOD_VOY_SHIP_NOTICE_OVERSEAS') }] }, ruleBand()]
    : [{ body: [{ html: t('MOD_VOY_SHIP_NOTICE_AT_SEA') }] }, ruleBand(), ...(kind === 'far' ? [{ head: t('MOD_VOY_SHIP_NOTICE_HEAD_FAR'), warn: true, body: [
      { text: t('MOD_VOY_SHIP_NOTICE_FAR_REACH', { reach: `${HULLS.dinghy.reach}` }), cls: 'text-warning' },
      { text: t('MOD_VOY_SHIP_NOTICE_FAR_BACK'), cls: 'text-warning' },
      t('MOD_VOY_SHIP_NOTICE_FAR_FREE'),
    ] }] : [])]);

  /** Once per character, on the first load with ships: the free dinghy for anyone phase 2 left on the water or overseas. */
  const firstLoad = () => {
    const s = skill();
    if (s === undefined || s.futureRaw !== undefined || s.record.shipChecked || state.mode !== 'strict') return;
    const p = player();
    if (p === undefined) return;
    s.record.shipChecked = true;
    if (s.record.boat !== null) return;
    const map = p.map;
    const rec = recOf(p);
    const spot = shipModel.freeBoatSpot(rec, map?.startingLocation, state.terrain, terrainMod.hexDistance);
    if (spot === undefined) return;
    setShip({ hull: 'dinghy', q: spot.q, r: spot.r, cond: 100, hold: [], aboard: false }, 'given');
    const far = shipModel.beyondReach(rec, { hull: 'dinghy', q: rec.q, r: rec.r }, geoNow());
    const lines = noticeSections(shipModel.isSea(rec) ? (far ? 'far' : 'sea') : 'overseas');
    pendingNotice = lines;
  };

  /**
   * A Random start (start.mjs) that put you on another landmass than the game's start: the first-load check above has
   * already run on the game's start, so the same gift is made here, with the same notice ("the boat you hired to get
   * here is yours now"). Without it a new character on an island with no trees could never leave.
   */
  const startOverseas = () => {
    const s = skill();
    if (s === undefined || s.futureRaw !== undefined || s.record.boat !== null || state.mode !== 'strict') return false;
    const p = player();
    const rec = p === undefined ? undefined : recOf(p);
    if (rec === undefined || shipModel.isSea(rec)) return false;
    const spot = shipModel.freeBoatSpot(rec, p.map?.startingLocation, state.terrain, terrainMod.hexDistance);
    if (spot === undefined) return false;
    setShip({ hull: 'dinghy', q: spot.q, r: spot.r, cond: 100, hold: [], aboard: false }, 'given (Random start)');
    showWhenFree(noticeSections('overseas'));
    return true;
  };

  /**
   * Keeps "on the sea means aboard" true on load, whatever moved the player since (rules off, a portal): on the sea
   * away from both vessels, the small boat comes over (the big ship when the boat rides on it).
   */
  const snapToPlayer = () => {
    const p = player();
    if (p === undefined) return;
    const rec = recOf(p);
    if (!shipModel.isSea(rec) || inVessel() !== undefined) return;
    const b = ship();
    if (b != null && b.aboard !== true) setVessel('boat', { ...b, q: rec.q, r: rec.r }, 'snapped to the player');
    else if (big() != null) setVessel('ship', { ...big(), q: rec.q, r: rec.r }, 'snapped to the player');
  };

  // ---- hex overview: why there is no path ------------------------------------------------------------------------
  const reasonFor = (hex) => {
    if (!enabled() || hex === undefined || !hex.isFullySurveyed || hex.isPlayerHere || hex.map.selectedHexPath !== undefined) return undefined;
    const to = recOf(hex);
    // With the big ship (build .150) the reasons speak of it: it takes you furthest, and the boat it carries lands
    // at its tier. A check below gives its reason only when no vessel you own gets past it.
    const s = big() ?? ship();
    const fleet = [big(), ship()].filter((v) => v != null && v.aboard !== true);
    // Fast travel between ports is sailing (3c): the hop is there only with the ship at this port's quay.
    const here = player();
    if (here !== undefined && isHop(here, hex) && !fleet.some((v) => shipModel.canHop(recOf(here), to, v, dockOf(hex), geoNow()))) {
      const island = geoNow()?.islandOf(to);
      if (s === null) return t('MOD_VOY_SHIP_PATH_HOP_NO_BOAT');
      if (island === undefined || island.tier <= HULLS[s.hull].tier) return t('MOD_VOY_SHIP_PATH_HOP_AWAY', { hull: hullWord(HULLS[s.hull]), where: whereIs(s) });
    }
    if (s === null) {
      state.journal?.learn('dinghy');
      if (shipModel.isSea(to)) return t('MOD_VOY_SHIP_PATH_NEED_BOAT_WATER');
      return t('MOD_VOY_SHIP_PATH_NEED_BOAT_LAND');
    }
    const hull = HULLS[s.hull];
    const g = geoNow();
    const island = g?.islandOf(to);
    const name = hullWord(hull);
    if (island !== undefined && island.tier > hull.tier) {
      state.journal?.learn('island');
      return t('MOD_VOY_SHIP_PATH_ISLAND_LOCKED', { hull: name, island: t(shipModel.islandNameKey(island.id)), needed: t(shipModel.tierNameKey(island.tier)) });
    }
    // A lake or a cut-off channel: walking to the ship would not help (3b check, 16 Oct 2026).
    const bodies = fleet.map((v) => g?.waterBody(v));
    if (shipModel.isSea(to) && to.cloud !== true && bodies.length > 0 && bodies.every((b) => b !== undefined && g.waterBody(to) !== b)) {
      return t('MOD_VOY_SHIP_PATH_OTHER_WATER', { hull: name });
    }
    if (fleet.every((v) => shipModel.beyondReach(to, v, g))) return t('MOD_VOY_SHIP_PATH_TOO_FAR', { hull: name, reach: `${hull.reach}` });
    if (!aboard()) return t('MOD_VOY_SHIP_PATH_MOORED', { hull: name, where: whereIs(s) });
    return t('MOD_VOY_SHIP_PATH_OUT_OF_REACH', { hull: name, reach: `${hull.reach}` });
  };
  /** "3 hexes south-west of you", or "here". `short`: "3 hexes SW of you" (the panel, user feedback). */
  const whereIs = (s, short = false) => {
    const p = player();
    if (p === undefined) return t('MOD_VOY_SHIP_WHERE_UNKNOWN');
    const d = terrainMod.hexDistance(p, s);
    if (d === 0) return t('MOD_VOY_SHIP_WHERE_HERE');
    const distance = t(d === 1 ? 'MOD_VOY_HEXES_ONE' : 'MOD_VOY_HEXES_MANY', { count: `${d}` });
    return t('MOD_VOY_SHIP_WHERE_AWAY', { distance, dir: t(`MOD_VOY_DIR_${short ? 'SHORT_' : ''}${terrainMod.directionLabel(p, s)}`) });
  };
  ctx.patch(HexOverviewElement, 'displayHex').after(function (_r, hex) {
    try {
      let note = this.querySelector('.voyage-path-note');
      const reason = reasonFor(hex);
      if (reason === undefined) { note?.classList.add('d-none'); return; }
      if (note === null) {
        note = document.createElement('div');
        note.className = 'voyage-path-note font-w600 text-warning mb-1';
        this.travelBtn?.before(note);
      }
      note.textContent = reason;
      note.classList.remove('d-none');
    } catch (e) { log('path note failed', e); }
  });

  // The game's "Travelling to other hexes with Ports is free." is not so under the ship rules: a hop is a sail, paid in stores, wear and light for its straight-line hexes (the user, 18 Oct 2026: "not true anymore").
  ctx.patch(HexOverviewElement, 'updateFastTravel').after(function (_r, hex) {
    try {
      const ft = hex?.pointOfInterest?.fastTravel;
      if (!enabled() || ft === undefined || !ft.isUnlocked || this.fastTravelInfo == null) return;
      this.fastTravelInfo.textContent = t('MOD_VOY_SHIP_FAST_TRAVEL', { groupName: ft.group.name });
    } catch (e) { log('fast travel note failed', e); }
  });

  // ---- dev and page helpers ------------------------------------------------------------------------------------
  /** voyageDev.dinghyNotice(kind): the first-load notice again. */
  const demoNotice = (kind = 'overseas') => notice(noticeSections(kind));
  const api = {
    boat: ship, big, vessel, inVessel, aboard, enabled, setShip, setVessel, demoNotice,
    hullName: (s) => hullWord(HULLS[s?.hull]), stepsOf, afterMove, homeOf, dockOf, isHop, build, buildBlocker, buildCosts, canFish, launchSpot, whereIs, recOf,
    startOverseas, cond, setCond, repairInfo, repair, upgradeInfo, upgrade, buyInfo, buy, buyCosts: () => costsOf(BIG_SHIPS.brig),
    onChange: (fn) => listeners.push(fn),
    /** The step rule's map facts (ship-model seaIndex), or undefined before a character is loaded. */
    geo: geoNow,
    /**
     * May a road step from one game hex to the next under the ship rules? True while they are off (trader roads). With
     * two vessels a step either one could take.
     */
    allows(fromHex, toHex) {
      if (!enabled()) return true;
      const g = geoNow();
      if (g === undefined) return true;
      const from = recOf(fromHex);
      const to = recOf(toHex);
      return shipModel.canStep(from, to, ship(), g) || (big() != null && shipModel.canStep(from, to, big(), g));
    },
    /**
     * Centres the map on a hex the way the game's own location search does (animateMoveToHex). Not moveToHex: that
     * sets the view without the viewport's 'moved' event, so the game never loads the artwork tiles there and
     * surveyed hexes show black. Keeps the current zoom.
     */
    centreOn(hex) {
      if (typeof cartographyMap === 'undefined' || cartographyMap === null) return;
      const zoom = cartographyMap.viewport?.scaled;
      const scale = Number.isFinite(zoom) ? zoom : 1;
      // On a phone the Here panel lies across the top of the map: the hex goes to the middle of what is left under
      // it (the phone run, build .239): the game's own animation, its centre moved by the difference.
      const down = shownMiddle();
      if (down !== 0) {
        try {
          const vp = cartographyMap.viewport;
          const to = hex.map.getHexOrigin(hex);
          const from = vp.center;
          const position = { x: to.x, y: to.y - down / scale };
          const time = Math.max(500, (1000 * Math.hypot(position.x - from.x, position.y - from.y)) / 3500);
          vp.animate({ time, position, scale, ease: 'easeInOutSine' });
          return;
        } catch (e) { console.error('[Voyage] map centre failed', e); }
      }
      cartographyMap.animateMoveToHex(hex, scale);
    },
    /** The game hex of a vessel ('boat' by default, or 'ship') on the active map, or undefined. */
    hex: (kind = 'boat') => { const s = vessel(kind); try { return s ? game.cartography.activeMap?.getHex(new HexCoords(s.q, s.r)) : undefined; } catch { return undefined; } },
    loaded() {
      try { firstLoad(); snapToPlayer(); } catch (e) { console.error('[Voyage] ship load failed', e); }
      listeners.forEach((fn) => { try { fn(); } catch (e) { log('ship listener failed', e); } });
    },
    /**
     * The player was moved outside travel (dev teleport): on the sea the ship comes along. Not the first-load check,
     * which would spend the one-time free dinghy and lose its popup, shown only when the interface gets ready.
     */
    moved() {
      try { snapToPlayer(); } catch (e) { log('ship snap failed', e); }
      listeners.forEach((fn) => { try { fn(); } catch (e) { log('ship listener failed', e); } });
    },
  };
  state.ship = api;
  return api;
}
