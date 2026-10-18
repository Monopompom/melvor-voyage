// Voyages into the fog (phase 5b). The game side; the rules are in
// fog-model.mjs and the voyage itself is src/voyage-clock.mjs, which calls this module for the fog.
//
// The game routes only through fully surveyed hexes (WorldMap.getHexNeighboursAndCosts) and runs one action at a
// time, so Cartography can't survey beside a voyage: the voyage surveys the fog itself, the hex ahead before it steps
// into it (and, as an option, the hexes beside the route first), with the game's own Cartography.surveyHex, so the
// survey gives its Cartography XP, survey XP, rewards and the unlocks of a full survey as surveying by hand does.
// Each survey action takes Cartography's survey interval, on top of the hex's sailing or walking time.
//
// Ways in: the hex overview's "Explore there" on a hex not fully surveyed (or one with no known route), and a hex
// cleared by a sea chart or a rumour can be selected on the map like a seen one.

export function install(ctx, { state, F, C, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const cart = () => game.cartography;
  const map = () => cart()?.activeMap;
  const hexAt = (q, r) => { try { return map()?.getHex(new HexCoords(q, r)); } catch { return undefined; } };
  const on = () => state.timed?.() === true;

  // ---- what a survey needs -----------------------------------------------------------------------------------------
  const isCartLevel = (req) => req != null && req.skill === cart() && Number.isFinite(req.level);
  /** The Cartography level a hex's survey needs (0 none). */
  const levelNeed = (hex) => Math.max(0, ...(hex?.requirements ?? []).filter(isCartLevel).map((r) => r.level));
  const reqsMet = (hex) => { try { return game.checkRequirements(hex.requirements ?? []); } catch { return false; } };
  /** Every requirement met but the Cartography level ones (those the voyage may reach on the way). */
  const otherReqsMet = (hex) => { try { return game.checkRequirements((hex.requirements ?? []).filter((r) => !isCartLevel(r))); } catch { return false; } };
  const table = () => { try { return Cartography.SURVEY_XP_PER_LEVEL ?? F.SURVEY_XP_PER_LEVEL; } catch { return F.SURVEY_XP_PER_LEVEL; } };
  /** Survey XP a survey action gives a hex (the game's surveyHex). */
  const perAction = () => { try { return F.BASE_SURVEY_XP * (1 + (game.modifiers.cartographySurveyXP ?? 0) / 100); } catch { return F.BASE_SURVEY_XP; } };
  const intervalMs = () => { try { return cart().surveyInterval; } catch { return 5000; } };
  const actionTicks = () => C.ticksOf(intervalMs());
  /** Survey actions a hex still needs to be fully surveyed. */
  const actionsOf = (hex) => (hex === undefined || hex.isFullySurveyed ? 0 : F.actionsToFull(hex.surveyXP, hex.maxSurveyLevel, perAction(), table()));
  /** Cartography XP of a survey action on a hex (getSkillXPForHexSurveyAction, before the skill's XP modifiers). */
  const xpEach = (hex) => {
    const base = (hex?.cartographyLevel ?? 1) * 2.6;
    try { const m = cart().modifyXP?.(base); return Number.isFinite(m) && m > 0 ? m : base; } catch { return base; }
  };
  const levelOf = (xp) => {
    let l;
    try { l = exp.xpToLevel(xp); } catch { l = cart()?.level ?? 1; }
    let cap = Infinity;
    try { cap = cart().currentLevelCap ?? Infinity; } catch {}
    return Math.min(l, Number.isFinite(cap) && cap > 0 ? cap : Infinity);
  };

  // ---- routing through the fog -------------------------------------------------------------------------------------
  /** While a fog route is searched: 'met' (fog hexes you can survey now) or 'level' (also those a level gates). */
  let routing;
  try {
    // Replaced, not hooked after: ship.mjs's filter (an after hook) then applies the vessels' rules to the fog too.
    ctx.patch(WorldMap, 'getHexNeighboursAndCosts').replace(function (original, hex, costModifier) {
      const out = original(hex, costModifier);
      if (routing === undefined || !Array.isArray(out)) return out;
      try {
        const seen = new Set(out.map(([n]) => n));
        HexCoords.axialDirVectors.forEach((_, i) => {
          const n = this.getHex(HexCoords.axialNeighbor(hex, i));
          if (n === undefined || seen.has(n) || n.isFullySurveyed) return;
          if (!(routing === 'met' ? reqsMet(n) : otherReqsMet(n))) return;
          out.push([n, n.getCombinedCost(costModifier)]);
        });
      } catch (e) { log('fog neighbours failed', e); }
      return out;
    });
  } catch (e) { log('fog routing not patched', e); }
  /** A route from the player to `goal` that may cross the fog (game order, destination first), or undefined. */
  const routeTo = (goal) => {
    const m = map();
    if (m === undefined || goal === undefined || goal === m.playerPosition) return undefined;
    for (const mode of ['met', 'level']) {
      routing = mode;
      let path;
      try { path = m.computePath(m.playerPosition, goal); } catch (e) { log('fog route failed', e); } finally { routing = undefined; }
      if (Array.isArray(path) && path.length >= 2) return path;
    }
    return undefined;
  };

  // ---- what the fog takes ------------------------------------------------------------------------------------------
  const isFog = (h) => { const g = hexAt(h.q, h.r); return g !== undefined && !g.isFullySurveyed; };
  /** A hex beside the route the voyage may survey: on the map, not fully surveyed, its survey allowed now. */
  const sideOpen = (h) => { const g = hexAt(h.q, h.r); return g !== undefined && !g.isFullySurveyed && reqsMet(g); };
  /** The widest side band the game lets you survey (the survey range: it surveys only that close to you). */
  const surveyRange = () => { try { return map()?.surveyRange ?? 1; } catch { return 1; } };
  /** A walk (start first) of a game path. */
  const walkOf = (path) => [...path].reverse().map((h) => ({ q: h.q, r: h.r }));
  /**
   * The fog of a route (game order): { fog: route hexes under fog, actions, ms (their surveys), check (fog-model
   * levelCheck, the route's surveys in turn), sides: [{ width, hexes, ms }] for 1 to the widest offered, range }.
   */
  const estimate = (path) => {
    const walk = walkOf(path);
    const fogHexes = walk.slice(1).map((h) => hexAt(h.q, h.r)).filter((g) => g !== undefined && !g.isFullySurveyed);
    const each = intervalMs();
    const actions = fogHexes.reduce((a, g) => a + actionsOf(g), 0);
    let check = { ok: true, need: 0, at: -1, by: -1 };
    try {
      const xp = cart().xp;
      check = F.levelCheck({ xp, levelOf, hexes: fogHexes.map((g) => ({ need: levelNeed(g), actions: actionsOf(g), xpEach: xpEach(g) })) });
      // Index into the route (hex N of the route, counting from the first step).
      const idx = (i) => (i < 0 ? -1 : walk.findIndex((h) => h.q === fogHexes[i].q && h.r === fogHexes[i].r));
      check = { ...check, at: idx(check.at), ...(check.ok ? { by: idx(check.by) } : {}), have: levelOf(xp), hex: check.ok ? undefined : fogHexes[check.at], first: !check.ok && check.at === 0 };
    } catch (e) { log('fog level check failed', e); }
    const range = surveyRange();
    const sides = [];
    for (let w = 1; w <= Math.min(F.MAX_SIDE, Math.max(range, 2)); w++) {
      const q = F.sideQueues(walk, w, sideOpen).flat();
      const a = q.reduce((n, h) => n + actionsOf(hexAt(h.q, h.r)), 0);
      sides.push({ width: w, hexes: q.length, ms: F.surveyTicks(a, each, C.TICK_MS) * C.TICK_MS, allowed: w <= range });
    }
    return { fog: fogHexes.length, actions, ms: F.surveyTicks(actions, each, C.TICK_MS) * C.TICK_MS, check, sides, range };
  };

  // ---- the voyage's surveys ----------------------------------------------------------------------------------------
  /** The hexes to survey standing on walk[i] before the step: those beside (nearest first), then the hex ahead. */
  const queueAt = (v, i) => {
    if (v.fog !== true || i >= v.walk.length - 1) return [];
    const route = new Set(v.walk.map((h) => `${h.q},${h.r}`));
    const out = v.side > 0 ? F.around(v.walk[i], Math.min(v.side, surveyRange())).filter((h) => !route.has(`${h.q},${h.r}`) && sideOpen(h)) : [];
    const ahead = v.walk[i + 1];
    if (isFog(ahead)) out.push({ q: ahead.q, r: ahead.r });
    return out;
  };
  const isAhead = (v, h) => { const a = v.walk[v.at + 1]; return a !== undefined && a.q === h.q && a.r === h.r; };
  /**
   * Drops from the queue what needs no survey or can't have one now: a hex surveyed already, or one beside the route
   * out of range, without a surveyed neighbour (the game's rule) or with its requirements unmet. Returns the hex
   * ahead when the survey it needs can't be done ({ hex, level }), else undefined.
   */
  const tidy = (v) => {
    while (v.sv.length > 0) {
      const h = v.sv[0];
      const g = hexAt(h.q, h.r);
      if (g === undefined || g.isFullySurveyed) { v.sv.shift(); continue; }
      if (isAhead(v, h)) {
        if (!reqsMet(g)) return { hex: g, level: levelNeed(g) };
        return undefined;
      }
      let ok = reqsMet(g);
      try { ok = ok && g.inSurveyRange && g.someNeighbour((n) => n.isFullySurveyed); } catch { ok = false; }
      if (ok) return undefined;
      v.sv.shift();
    }
    return undefined;
  };
  /** One survey action on a hex, as the game's queue survey does it (surveyHex, its stats and its event). */
  const surveyOnce = (hex) => {
    const c = cart();
    const timer = c.actionTimer;
    const ticks = actionTicks();
    // surveyHex rolls pets and Summoning marks by the action's interval (the timer's length): the survey's own.
    const keep = timer?._maxTicks;
    try {
      if (timer !== undefined && '_maxTicks' in timer) timer._maxTicks = ticks;
      c.surveyHex(hex);
      try { c.game.stats.Cartography.inc(0); c.game.stats.Cartography.add(1, ticks * C.TICK_MS); } catch {}
      try { const ev = new CartographySurveyEvent(c, hex); ev.interval = ticks * C.TICK_MS; c._events.emit('survey', ev); } catch (e) { log('survey event failed', e); }
    } finally { if (timer !== undefined && '_maxTicks' in timer) timer._maxTicks = keep; }
  };
  /** Ticks the fog still takes: the surveys left here and on the hexes ahead (an estimate: XP modifiers change). */
  let leftMemo;
  const ticksLeft = (v) => {
    if (v?.fog !== true) return 0;
    const first = v.sv[0];
    const g0 = first === undefined ? undefined : hexAt(first.q, first.r);
    const key = `${v.at}|${v.sv.length}|${g0?.surveyXP ?? ''}|${v.walk.length}`;
    if (leftMemo?.v === v && leftMemo.key === key) return leftMemo.n;
    let actions = 0;
    const counted = new Set();
    const add = (h) => { const k = `${h.q},${h.r}`; if (counted.has(k)) return; counted.add(k); actions += actionsOf(hexAt(h.q, h.r)); };
    v.sv.forEach(add);
    // The action under way is counted by the timer.
    if (g0 !== undefined && actionsOf(g0) > 0) actions -= 1;
    for (let i = v.at + 1; i < v.walk.length - 1; i++) queueAt(v, i).forEach(add);
    const n = Math.max(0, actions) * actionTicks();
    leftMemo = { v, key, n };
    return n;
  };

  // ---- ways in -----------------------------------------------------------------------------------------------------
  // A hex a chart or a rumour cleared can be picked like a seen one (the game picks only seen or begun hexes).
  try {
    ctx.patch(Cartography, 'onHexTap').replace(function (original, hex) {
      try {
        if (on() && this.activeMap === hex?.map && !hex.isSelected && hex.surveyLevel === 0 && !hex.inSightRange
          && this.currentlySurveyedHex !== hex && state.charts?.isCharted?.(hex.q, hex.r)) {
          if (this.activeMap.selectedHex !== undefined) cartographyMap.unHighlightHex(this.activeMap.selectedHex);
          hex.map.selectHex(hex);
          cartographyMap.highlightHex(hex);
          cartographyMap.showOverview();
          cartographyMap.updateOverview(hex.map, this.game, this);
          cartographyMap.updateHexPath(hex.map);
          return;
        }
      } catch (e) { log('charted hex not selected', e); }
      return original(hex);
    });
  } catch (e) { log('charted hex tap not patched', e); }

  // The hex overview: "Explore there" where the game has no route (the hex is not fully surveyed, or no known way).
  try {
    ctx.patch(HexOverviewElement, 'displayHex').after(function (_r, hex) {
      try {
        let btn = this.querySelector('.voyage-fog-btn');
        // A charted hex with no route offers it only when the fog gives one (build .233: a charted hex past the
        // dinghy's reach offered it, and pressing it said "No way through the fog", the wrong reason).
        const show = on() && hex !== undefined && !hex.isPlayerHere && hex.map === map()
          && (!hex.isFullySurveyed || (hex.map.selectedHexPath === undefined && routeTo(hex) !== undefined));
        if (!show) { btn?.classList.add('d-none'); return; }
        if (btn === null) {
          btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `${this.travelBtn?.className ?? 'btn btn-sm btn-primary'} voyage-fog-btn`.replace(/\bd-none\b/g, '');
          (this.travelBtn ?? this.interactions)?.after(btn);
        }
        btn.innerHTML = `<i class="fa fa-binoculars mr-1" aria-hidden="true"></i>${t('MOD_VOY_FOG_BUTTON')}`;
        btn.classList.remove('d-none');
        btn.disabled = false;
        btn.onclick = () => explore(hex);
      } catch (e) { log('fog button failed', e); }
    });
  } catch (e) { log('fog button not patched', e); }

  const at = (hex) => { try { const o = hex.to_oddq(); return `(${o.col}, ${o.row})`; } catch { return `(${hex?.q}, ${hex?.r})`; } };
  /** "Explore there": a route through the fog, then the Set off popup (or why there is none). */
  const explore = (hex) => {
    try {
      if (!on() || game.isGolbinRaid) return;
      const path = routeTo(hex);
      if (path === undefined) {
        try { game.notifications.createErrorNotification('voyage:fog', t('MOD_VOY_FOG_NO_WAY', { at: at(hex) })); } catch {}
        return;
      }
      state.clock?.confirmFog?.(path, estimate(path));
    } catch (e) { log('explore failed', e); }
  };

  /** Milliseconds a hex's survey still takes at Cartography's pace. */
  const surveyMs = (hex) => F.surveyTicks(actionsOf(hex), intervalMs(), C.TICK_MS) * C.TICK_MS;
  const api = { routeTo, estimate, queueAt, tidy, surveyOnce, ticksLeft, actionTicks, surveyMs, isFog, levelNeed, at, explore };
  state.fog = api;
  return api;
}
