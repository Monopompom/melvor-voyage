// The ship's clock (phase 5a): travel takes time. The game side; the rules are in clock-model.mjs.
//
// A voyage is the Voyage skill's active action (voyage-skill.mjs gives the class activeTick, isActive and stop): the
// game saves it as the active action, ticks it online and in the offline catch-up (Game.tick), and stops it like any
// skill. Each hex of the route is one action: when its timer runs out the character steps onto it through an ordinary
// one-step Cartography.movePlayer (setup.mjs's patch), so the hex is paid exactly as an instant move (GP, stores, hull
// wear, light, its Voyage XP). Stopping keeps the hexes reached. On arrival the chain of choices starts the first that
// can start, through the game's own start methods ("On arrival, do this": travel never leaves you idle).
//
// Ways in: the map's Travel (a Set off popup with the time, the costs and the arrival choices) and the planner's Set
// off (planner.mjs calls setOff). With the "Timed travel" setting off everything is phase 4's instant travel.
//
// Starting something else mid-voyage asks first (the user, 18 Oct 2026): Game.idleChecker refuses the start and a
// popup offers to drop anchor; on yes the voyage stops and the start is tried again where the game allows it.

const SWAL_CLASS = { popup: 'voyage-ui', confirmButton: 'btn btn-success m-1', cancelButton: 'btn btn-outline-info m-1' };
const STARTABLE = ['melvorD:Woodcutting', 'melvorD:Mining', 'melvorD:Fishing', 'melvorD:Thieving', 'melvorD:Astrology'];
const CARTOGRAPHY_ID = 'melvorAoD:Cartography';

export function install(ctx, { state, C, storesModel: S, rules, terrainMod, helpLayout, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (n) => numberWithCommas(Math.floor(n));
  const skill = () => state.voyageSkill?.();
  const usable = () => { const s = skill(); return s !== undefined && s.futureRaw === undefined; };
  /** Timed travel applies: the setting on and the skill's save usable. */
  const on = () => usable() && state.settings.timedTravel?.() !== false;
  state.timed = on;
  state.clockNow = () => {
    try { return C.clockNow({ offline: game._isInOnlineLoop === false, info: game._offlineInfo, now: Date.now() }); } catch { return Date.now(); }
  };
  const offlineNow = () => { try { return game._isInOnlineLoop === false; } catch { return false; } };
  const cart = () => game.cartography;
  const map = () => cart()?.activeMap;
  const hexAt = (q, r) => { try { return map()?.getHex(new HexCoords(q, r)); } catch { return undefined; } };
  const at = (hex) => { try { const o = hex.to_oddq(); return `(${o.col}, ${o.row})`; } catch { return `(${hex?.q}, ${hex?.r})`; } };
  const notify = (text, kind = 'success') => {
    try {
      if (kind === 'danger') game.notifications.createErrorNotification('voyage:clock', text);
      else game.notifications.createSuccessNotification('voyage:clock', text, ctx.getResourceUrl('assets/icon.webp'));
    } catch {}
  };

  // ---- the voyage record -------------------------------------------------------------------------------------------
  // The save holds it (v15 `voyage`); cleaned once when the record object changes (a load), then kept as is.
  let seen;
  const cur = () => {
    const s = skill();
    if (s === undefined || s.futureRaw !== undefined) return null;
    const raw = s.record.voyage ?? null;
    if (raw !== seen) { const v = C.cleanVoyage(raw); s.record.voyage = v; seen = v; }
    return s.record.voyage;
  };
  const setVoyage = (v) => { const s = skill(); if (s === undefined) return; s.record.voyage = v; seen = v; };
  const ending = () => { const s = skill(); return s === undefined ? null : C.cleanEnding(s.record.ending); };
  const setEnding = (e) => { const s = skill(); if (s !== undefined) s.record.ending = e; };

  // ---- steps and their times ---------------------------------------------------------------------------------------
  const hullOf = (kind) => (kind === 'ship' ? state.ship?.big?.() : state.ship?.boat?.())?.hull;
  const timeOpts = () => ({ hullOf, mountSpeed: state.land?.speed?.() ?? 1 });
  /** The game path (destination first) of walk[from..to], with the ship's modes for each step. */
  const pathOf = (walk, from, to) => {
    const path = [];
    const modes = [];
    for (let i = to; i >= from; i--) {
      const h = hexAt(walk[i].q, walk[i].r);
      if (h === undefined) return undefined;
      path.push(h);
      if (i > from) modes.push(walk[i].m);
    }
    if (modes.some((m) => m !== undefined)) path.voyageModes = modes;
    return path;
  };
  /** The steps (ship.stepsOf) of a game path, a hop's straight-line length added for the clock. */
  const stepsOf = (path) => {
    const steps = state.ship?.stepsOf?.(path) ?? [];
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].fastTravel) { try { steps[i].dist = terrainMod.hexDistance(path[path.length - 1 - i], path[path.length - 2 - i]); } catch {} }
    }
    return steps;
  };
  /** Ticks of each step of the walk (index i: from walk[i] to walk[i + 1]). */
  const stepTicksOf = (walk) => {
    const path = pathOf(walk, 0, walk.length - 1);
    if (path === undefined) return walk.slice(1).map(() => C.ticksOf(C.LAND_MS));
    const o = timeOpts();
    return stepsOf(path).map((s) => C.ticksOf(C.stepMs(s, o)));
  };
  let ticksMemo;
  const stepTicks = (v) => {
    const key = `${v.walk.length}|${v.walk[0].q},${v.walk[0].r}|${hullOf('boat')}|${hullOf('ship')}|${state.land?.speed?.() ?? 1}`;
    if (ticksMemo?.v !== v || ticksMemo.key !== key) ticksMemo = { v, key, ticks: stepTicksOf(v.walk) };
    return ticksMemo.ticks;
  };
  /** Ticks still to go: the timer in progress, the steps after it and, in the fog, the surveys still to make. */
  const ticksToGo = (v) => {
    let n = C.ticksLeft(v, stepTicks(v));
    // Surveying before a step: the timer is a survey's, so the step's own time is still to come.
    if (v.fog === true) n += (state.fog?.ticksLeft?.(v) ?? 0) + (v.sv.length > 0 ? (stepTicks(v)[v.at] ?? 0) : 0);
    return n;
  };
  const msLeft = (v) => ticksToGo(v) * C.TICK_MS;

  // ---- what to start on arrival ------------------------------------------------------------------------------------
  const skillById = (id) => { try { return game.skills.getObjectByID(id); } catch { return undefined; } };
  const actionOf = (sk, id) => { try { return sk?.actions?.getObjectByID(id); } catch { return undefined; } };
  const areaById = (id) => { try { return game.combatAreas.getObjectByID(id) ?? game.slayerAreas.getObjectByID(id); } catch { return undefined; } };
  const dungeonById = (id) => { try { return game.dungeons.getObjectByID(id); } catch { return undefined; } };
  const monsterById = (id) => { try { return game.monsters.getObjectByID(id); } catch { return undefined; } };
  /** The action a running skill is doing now, if it has one to name. */
  const currentOf = (a) => {
    try {
      if (a.activeTrees instanceof Set) return [...a.activeTrees][0];
      return a.selectedRock ?? a.activeFish ?? a.currentNPC ?? a.studiedConstellation ?? a.selectedRecipe ?? undefined;
    } catch { return undefined; }
  };
  /** What you are doing now, as a choice for "what you were doing", or undefined. */
  const doingNow = () => {
    const a = game.activeAction;
    if (a === undefined || a === skill()) return undefined;
    try {
      if (a === game.combat) {
        const area = a.selectedArea;
        if (area === undefined) return undefined;
        if (dungeonById(area.id) === area) return { k: 'dungeon', area: area.id };
        const m = a.selectedMonster;
        return m === undefined || areaById(area.id) !== area ? undefined : { k: 'resume', area: area.id, monster: m.id };
      }
      if (typeof GatheringSkill !== 'undefined' && a instanceof GatheringSkill && a.id !== CARTOGRAPHY_ID) {
        const x = currentOf(a);
        return { k: 'resume', skill: a.id, ...(x?.id !== undefined ? { action: x.id } : {}) };
      }
    } catch (e) { log('current action not read', e); }
    return undefined;
  };
  const labelOf = (c) => {
    try {
      switch (c.k) {
        case 'skill': { const sk = skillById(c.skill); const a = actionOf(sk, c.action); return t('MOD_VOY_CLOCK_DO_SKILL', { skill: sk?.name ?? c.skill, name: a?.name ?? c.action }); }
        case 'fight': return t('MOD_VOY_CLOCK_DO_FIGHT', { name: monsterById(c.monster)?.name ?? c.monster, area: areaById(c.area)?.name ?? c.area });
        case 'dungeon': return t('MOD_VOY_CLOCK_DO_DUNGEON', { name: dungeonById(c.area)?.name ?? c.area });
        case 'resume': {
          if (c.area !== undefined) return t('MOD_VOY_CLOCK_DO_WERE', { what: t('MOD_VOY_CLOCK_DO_FIGHT', { name: monsterById(c.monster)?.name ?? c.monster, area: areaById(c.area)?.name ?? c.area }) });
          const sk = skillById(c.skill);
          const a = actionOf(sk, c.action);
          return t('MOD_VOY_CLOCK_DO_WERE', { what: a === undefined ? (sk?.name ?? c.skill) : t('MOD_VOY_CLOCK_DO_SKILL', { skill: sk?.name ?? c.skill, name: a.name }) });
        }
        default: return '';
      }
    } catch { return ''; }
  };
  const mediaOf = (c) => {
    try {
      if (c.k === 'skill') return actionOf(skillById(c.skill), c.action)?.media ?? skillById(c.skill)?.media;
      if (c.k === 'fight' || (c.k === 'resume' && c.monster !== undefined)) return monsterById(c.monster)?.media;
      if (c.k === 'dungeon') return dungeonById(c.area)?.media;
      return skillById(c.skill)?.media;
    } catch { return undefined; }
  };
  /** Why a choice can't start where you stand now, in words, or undefined (asked quietly: no popup, no toast). */
  const whyNot = (c) => {
    try {
      const sk = c.skill !== undefined ? skillById(c.skill) : undefined;
      if (c.skill !== undefined) {
        if (sk === undefined) return t('MOD_VOY_CLOCK_WHY_GONE');
        if (!sk.isUnlocked) return t('MOD_VOY_PLAN_REFUSE_LEVEL', { skill: sk.name, level: '1' });
        if (rules.isGated(c.skill) && state.active() && state.rateAt(c.skill) === 0) return t('MOD_VOY_CLOCK_WHY_HERE', { skill: sk.name });
        const a = c.action !== undefined ? actionOf(sk, c.action) : undefined;
        if (c.action !== undefined && a === undefined) return t('MOD_VOY_CLOCK_WHY_GONE');
        if (a !== undefined) {
          if ((a.level ?? 0) > sk.level) return t('MOD_VOY_PLAN_REFUSE_LEVEL', { skill: sk.name, level: `${a.level}` });
          if ((a.abyssalLevel ?? 0) > (sk.abyssalLevel ?? 0)) return t('MOD_VOY_PLAN_REFUSE_ABYSSAL', { skill: sk.name, level: `${a.abyssalLevel}` });
          if (STARTABLE.includes(c.skill) && state.zonesOn?.() && state.zoneTable?.skills?.[c.skill]?.actions?.[a.id] !== undefined
            && !(state.zoneActionsHere?.(c.skill) ?? []).includes(a)) return t('MOD_VOY_CLOCK_WHY_ZONE', { name: a.name });
        }
        return undefined;
      }
      const area = c.k === 'dungeon' ? dungeonById(c.area) : areaById(c.area);
      if (area === undefined) return t('MOD_VOY_CLOCK_WHY_GONE');
      if (state.combatLocked?.(area)) return t('MOD_VOY_CLOCK_WHY_AREA', { name: area.name });
      if (!game.checkRequirements(area.entryRequirements ?? [])) return t('MOD_VOY_PLAN_REFUSE_AREA');
      return undefined;
    } catch (e) { log('arrival check failed', e); return undefined; }
  };
  const isRunning = (skillId, a) => {
    try {
      switch (skillId) {
        case 'melvorD:Woodcutting': return game.woodcutting.activeTrees.has(a) && game.woodcutting.isActive;
        case 'melvorD:Mining': return game.mining.isActive && game.mining.selectedRock === a;
        case 'melvorD:Fishing': return game.fishing.isActive && game.fishing.activeFish === a;
        case 'melvorD:Thieving': return game.thieving.isActive && game.thieving.currentNPC === a;
        case 'melvorD:Astrology': return game.astrology.isActive && game.astrology.studiedConstellation === a;
        default: return false;
      }
    } catch { return false; }
  };
  /** Starts a choice through the game's own buttons' methods; true when it runs afterwards. */
  const start = (c) => {
    if (c.k === 'fight' || (c.k === 'resume' && c.monster !== undefined)) {
      const area = areaById(c.area);
      const m = monsterById(c.monster);
      if (area === undefined || m === undefined) return false;
      game.combat.selectMonster(m, area);
      return game.activeAction === game.combat;
    }
    if (c.k === 'dungeon') {
      const d = dungeonById(c.area);
      if (d === undefined) return false;
      game.combat.selectDungeon(d);
      return game.activeAction === game.combat;
    }
    const sk = skillById(c.skill);
    if (sk === undefined) return false;
    const a = c.action !== undefined ? actionOf(sk, c.action) : undefined;
    if (a !== undefined && STARTABLE.includes(c.skill)) {
      if (isRunning(c.skill, a)) return true;
      switch (c.skill) {
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
      return isRunning(c.skill, a);
    }
    // Any other skill restarts with the selection it kept (a recipe, a spell).
    if (typeof sk.start !== 'function') return false;
    sk.start();
    return game.activeAction === sk && sk.isActive === true;
  };
  /** Runs the chain after arrival: the first choice that starts; the ones that could not, with their reasons. */
  const runChain = (chain) => {
    const failed = [];
    for (const c of chain) {
      const name = labelOf(c);
      const why = whyNot(c);
      // A reason borrowed from the planner may start lower case ("the area's entry requirements aren't met.").
      if (why !== undefined) { failed.push({ name, why: why.charAt(0).toUpperCase() + why.slice(1) }); continue; }
      let ok = false;
      try { ok = start(c); } catch (e) { log('arrival start failed', e); }
      if (ok) return { started: name, failed };
      failed.push({ name, why: t('MOD_VOY_CLOCK_WHY_REFUSED') });
    }
    return { started: '', failed };
  };

  /**
   * The choices for a voyage to `dest` (a game hex): the action that brought you (`first`), what you are doing now,
   * then what works there (its fights and the zoned resources at or below your level), asked as if you stood there.
   * [{ choice, label, media }]; the first `first` and the doing-now come first.
   */
  /** `here` false: no choices of the place itself (an unknown destination, build .234), only first and now. */
  const optionsFor = (dest, first, here = true) => {
    const out = [];
    // "What you were doing" stands for the same action as a pick of it: one of the two is enough.
    const sameAs = (a, b) => C.sameChoice(a, b) || (a.skill !== undefined && a.skill === b.skill && a.action !== undefined && a.action === b.action)
      || (a.monster !== undefined && a.monster === b.monster && a.area === b.area);
    const add = (c) => { const cc = C.cleanChoice(c); if (cc !== undefined && !out.some((o) => sameAs(o.choice, cc))) out.push({ choice: cc, label: labelOf(cc), media: mediaOf(cc) }); };
    if (first !== undefined) add(first);
    const now = doingNow();
    if (now !== undefined) add(now);
    if (!here) return out;
    const before = state.posOverride;
    try {
      state.posOverride = dest;
      for (const area of state.combatHere?.() ?? []) {
        const seen = new Set();
        for (const m of area.monsters ?? []) { if (m !== undefined && !seen.has(m.id)) { seen.add(m.id); add({ k: 'fight', area: area.id, monster: m.id }); } }
      }
      for (const id of STARTABLE) {
        const sk = skillById(id);
        if (sk === undefined || !sk.isUnlocked) continue;
        if (rules.isGated(id) && state.active() && state.rateAt(id) === 0) continue;
        for (const a of state.zoneActionsHere?.(id) ?? []) add({ k: 'skill', skill: id, action: a.id });
      }
    } catch (e) { log('arrival options failed', e); } finally { state.posOverride = before; }
    return out.slice(0, 40);
  };

  // ---- setting off -------------------------------------------------------------------------------------------------
  const nameOfHex = (hex) => {
    try {
      const poi = hex.pointOfInterest;
      if (poi !== undefined && poi.isDiscovered) return poi.name;
      const rec = state.recordAt?.(hex);
      return rec === undefined ? at(hex) : `${getLangString(terrainMod.classKey(rec.t))} ${at(hex)}`;
    } catch { return at(hex); }
  };
  /** GP the game charges for a path (Cartography.getTravelCosts, the mounts' cut included). */
  const gpOf = (path) => {
    try { return cart().getTravelCosts(path).getCurrencyQuantityArray().reduce((sum, { currency, quantity }) => sum + (currency === game.gp ? quantity : 0), 0); } catch { return 0; }
  };
  /** The route's numbers for the Set off popup and the planner: { hexes, land, sea, ms, gp, plan } (plan: stores). */
  const routeInfo = (path) => {
    const steps = stepsOf(path);
    const o = timeOpts();
    const ms = steps.reduce((sum, s) => sum + C.ticksOf(C.stepMs(s, o)) * C.TICK_MS, 0);
    const sea = steps.filter((s) => s.sea || s.hop > 0).length;
    let plan;
    try { plan = state.stores?.planFor?.(path); } catch (e) { log('route plan failed', e); }
    return { hexes: steps.length, land: steps.length - sea, sea, ms, gp: gpOf(path), plan };
  };
  const hexes = (n) => t(n === 1 ? 'MOD_VOY_CLOCK_HEX_ONE' : 'MOD_VOY_CLOCK_HEX_MANY', { count: `${n}` });
  const duration = (ms) => { const p = C.durationParts(ms); return p.h > 0 ? t('MOD_VOY_CLOCK_H_M', { h: `${p.h}`, m: `${p.m}` }) : t('MOD_VOY_CLOCK_M', { m: `${p.m}` }); };
  const clockAt = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

  /**
   * Starts a voyage along `path` (game order, destination first): { path, name, chain, loads (walk indexes where the
   * route loads the stores), departLoad }. Stops what is running (the game's own idle check). True when under way.
   */
  const setOff = ({ path, name, chain = [], loads = [], fog }) => {
    const s = skill();
    if (!on() || s === undefined || !Array.isArray(path) || path.length < 2) return false;
    const walk = [];
    const modes = path.voyageModes;
    for (let k = 0; k < path.length; k++) {
      const h = path[path.length - 1 - k];
      const m = k === 0 ? undefined : modes?.[path.length - 1 - k];
      walk.push(m === undefined ? { q: h.q, r: h.r } : { q: h.q, r: h.r, m: JSON.parse(JSON.stringify(m)) });
    }
    const fogged = fog !== undefined && state.fog !== undefined;
    const v = C.cleanVoyage({ walk, at: 0, left: 1, total: 1, name, chain, loads, began: state.clockNow(), xp: s.xp, gp: game.gp.amount,
      ...(fogged ? { fog: true, side: fog.side ?? 0, sv: [] } : {}) });
    if (v === null) return false;
    const ticks = stepTicksOf(v.walk);
    v.left = ticks[0] ?? 1;
    if (fogged) {
      // A voyage into the fog surveys first (5b): the first timer is a survey's while there is one to make.
      v.sv = state.fog.queueAt(v, 0);
      if (state.fog.tidy(v) !== undefined) return false;
      if (v.sv.length > 0) v.left = state.fog.actionTicks();
    }
    v.of = v.left;
    v.total = ticks.reduce((a, b) => a + b, 0) + (fogged ? state.fog.ticksLeft(v) + (v.sv.length > 0 ? v.left : 0) : 0);
    const running = cur() !== null;
    if (!running) {
      // The game's own check stops what is running (refused only in Golbin Raid).
      if (game.idleChecker(s)) return false;
    }
    setVoyage(v);
    setEnding(null);
    game.activeAction = s;
    game.renderQueue.activeSkills = true;
    try { game.scheduleSave(); } catch {}
    log(`set off for ${name}: ${v.walk.length - 1} hexes, ${Math.round(v.total * C.TICK_MS / 60000)} min, chain ${v.chain.map((c) => c.k).join(',') || 'none'}${fogged ? `, into the fog (side ${v.side})` : ''}`);
    changed();
    return true;
  };

  /** GP of the steps into hexes surveyed now (a fog route's known part; the fog is paid as it is reached). */
  const knownGpOf = (path) => {
    let gp = 0;
    for (let i = 0; i < path.length - 1; i++) if (path[i].isFullySurveyed) gp += gpOf([path[i], path[i + 1]]);
    return gp;
  };
  /**
   * The Set off popup for the map's Travel: time, costs, the arrival choices; Set off starts the voyage. `fog` (5b) is
   * state.fog.estimate of a route through the fog: the surveys' time, the level check and the hexes beside.
   */
  const confirmSetOff = (path, original, fog) => {
    const info = routeInfo(path);
    const pl = info.plan?.plan;
    if (fog !== undefined) {
      // Pay as you reveal: only the known part is checked now; the fog's GP, food and fuel when each hex is reached.
      info.gp = knownGpOf(path);
      if (info.gp > game.gp.amount) { notify(t('MOD_VOY_FOG_NO_GP', { gp: num(info.gp) }), 'danger'); return; }
    } else if ((pl !== undefined && !pl.ok) || info.gp > game.gp.amount) {
      // A trip the stores or the purse refuse goes the old way, so the refusal speaks as before.
      original(); return;
    }
    const dest = path[0];
    const name = nameOfHex(dest);
    // A place not known yet (4.15: never surveyed nor charted) tells nothing of what can be done there (the user,
    // build .234: "a gating gap"): only what you were doing, tried on arrival as any pick.
    const known = state.knowledge?.isKnown(dest) !== false;
    const opts = optionsFor(dest, undefined, known);
    // Each arrival pick: its number, its words, the chosen action's icon (redrawn on change), then the game's own
    // dropdown (Bootstrap's data-toggle, as the planner's; the user, build .233: not the browser's select), each choice
    // with its icon. The value sits in a hidden input under the pick's id.
    const NOTHING_ICON = '<i class="fa fa-pause-circle" aria-hidden="true"></i>';
    const pickIcon = (i) => (opts[i]?.media ? `<img src="${esc(opts[i].media)}" alt="">` : NOTHING_ICON);
    const pickLabel = (i) => (i >= 0 && opts[i] !== undefined ? opts[i].label : t('MOD_VOY_CLOCK_DO_NOTHING'));
    const pickFace = (i) => `${opts[i]?.media ? `<img class="voyage-plan-pick-ico" src="${esc(opts[i].media)}" alt="">` : '<i class="fa fa-pause-circle voyage-plan-pick-ico" aria-hidden="true"></i>'}<span>${esc(pickLabel(i))}</span>`;
    const select = (id, n, labelKey, pick) => `<div class="voyage-clock-pick"><span class="voyage-clock-pick-num" aria-hidden="true">${n}</span>`
      + `<span class="voyage-clock-pick-label" id="${id}-label">${esc(t(labelKey))}</span><span class="voyage-clock-pick-icon" data-voyage-pick-icon="${id}">${pickIcon(pick)}</span>`
      + `<div class="dropdown voyage-plan-arrival voyage-clock-dd"><input type="hidden" id="${id}" value="${pick}">`
      + `<button type="button" class="btn btn-light dropdown-toggle" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false" aria-labelledby="${id}-label" data-voyage-dd="${id}"><span>${esc(pickLabel(pick))}</span></button>`
      + `<div class="dropdown-menu overflow-y-auto">${[-1, ...opts.keys()].map((i) => `<a class="dropdown-item pointer-enabled${i === pick ? ' active' : ''}" role="button" data-voyage-dd-for="${id}" data-pick="${i}">${pickFace(i)}</a>`).join('')}</div></div></div>`;
    // The defaults: what you were doing, if it works there, then the first
    // crafts there. A fight only when it is what you were doing (build .233: with nothing running, a battle camp's
    // first two fights were picked, and a Combat 10 character landed in one and died).
    const now = doingNow();
    const nowChoice = now === undefined ? undefined : C.cleanChoice(now);
    const isNow = (o) => nowChoice !== undefined && C.sameChoice(o.choice, nowChoice);
    const defaults = [...opts.keys()].filter((i) => opts[i].choice.k !== 'fight' || isNow(opts[i])).slice(0, 2);
    // Hull wear: the condition now less the condition the plan leaves, per vessel.
    let wear = 0;
    if (pl?.cond !== undefined) wear += Math.max(0, (state.ship?.cond?.('boat') ?? pl.cond) - pl.cond);
    for (const [kind, c] of Object.entries(pl?.conds ?? {})) wear += Math.max(0, (state.ship?.cond?.(kind) ?? c) - c);
    const img = (src, cls = 'voyage-clock-icon') => `<img class="${cls}" src="${esc(src)}" alt="">`;
    const res = (file) => ctx.getResourceUrl(`assets/${file}`);
    const costBits = [];
    if (pl?.spent !== undefined && fog === undefined) {
      costBits.push(`<span class="voyage-clock-cost">${img(res('ration.webp'))}${esc(t('MOD_VOY_CLOCK_COST_FOOD', { food: num(pl.spent.food) }))}</span>`);
      costBits.push(`<span class="voyage-clock-cost">${img(res('fuel.webp'))}${esc(t('MOD_VOY_CLOCK_COST_FUEL', { fuel: `${Math.round(pl.spent.fuel * 10) / 10}` }))}</span>`);
    }
    if (wear > 0 && fog === undefined) costBits.push(`<span class="voyage-clock-cost">${img(res('hull_condition.webp'))}${esc(t('MOD_VOY_CLOCK_COST_WEAR', { pct: `${Math.round(wear)}` }))}</span>`);
    // The route as a strip: land and sea legs in their colours, as long as they take (the user, 18 Oct 2026: "spice it up").
    const o = timeOpts();
    const legs = [];
    const steps = stepsOf(path);
    for (let k = 0; k < steps.length; k++) {
      const st = steps[k];
      // A fog hex is a leg of its own (5b): its survey and its crossing.
      const into = path[path.length - 2 - k];
      const fogged = fog !== undefined && into !== undefined && !into.isFullySurveyed;
      const sea = st.sea || st.hop > 0 || C.SEA_CLASSES.includes(st.cls);
      const kind = fogged ? 'fog' : sea ? 'sea' : 'land';
      const ms = C.stepMs(st, o) + (fogged ? state.fog.surveyMs(into) : 0);
      const last = legs[legs.length - 1];
      if (last !== undefined && last.kind === kind && last.sea === sea) last.ms += ms; else legs.push({ kind, ms, sea });
    }
    const totalMs = legs.reduce((a, l) => a + l.ms, 0) || 1;
    const strip = '<div class="voyage-clock-strip" aria-hidden="true"><i class="fa fa-circle voyage-clock-strip-start"></i><div class="voyage-clock-strip-legs">'
      + legs.map((l) => `<span class="voyage-clock-strip-${l.kind}" style="flex-grow:${Math.max(1, Math.round(l.ms / 1000))}">${l.ms / totalMs >= 0.12 ? `<i class="fa ${l.kind === 'sea' ? 'fa-ship' : l.kind === 'fog' ? 'fa-binoculars' : 'fa-shoe-prints'}"></i>` : ''}</span>`).join('')
      + '</div><i class="fa fa-map-marker-alt voyage-clock-strip-end"></i></div>';
    // Night or day when you come in (the night setting's hours, 4.23).
    // In the fog the time is the crossing plus the surveys, the hexes beside by the side picked (none at first).
    const sideOf = (w) => fog?.sides?.find((x) => x.width === w);
    const totalFor = (w) => info.ms + (fog === undefined ? 0 : fog.ms + (sideOf(w)?.ms ?? 0));
    const nightAt = (ms) => {
      try { const d = new Date(ms); return state.settings.night?.() !== false && S.isNight(d.getHours() + d.getMinutes() / 60, state.settings.nightShift?.() ?? 0); } catch { return false; }
    };
    const arriveIconAt = (ms) => (nightAt(ms) ? '<i class="fa fa-moon text-info mr-1" aria-hidden="true"></i>' : '<i class="fa fa-sun voyage-clock-sun mr-1" aria-hidden="true"></i>');
    const arriveHtml = (w) => { const ms = Date.now() + totalFor(w); return `${arriveIconAt(ms)}${esc(t('MOD_VOY_CLOCK_ARRIVE_AT', { time: clockAt(ms) }))}`; };
    const chip = (kind, n, key) => (n > 0 ? `<span class="voyage-travel-chip voyage-travel-${kind === 'sea' ? 'sail' : 'foot'}"><i class="fa ${kind === 'sea' ? 'fa-ship' : 'fa-shoe-prints'} mr-1" aria-hidden="true"></i>${esc(t(key, { n: `${n}` }))}</span>` : '');
    const head = (icon, key) => `<div class="voyage-clock-tile-label">${icon}${esc(t(key))}</div>`;
    // The fog (5b): the split of the time, the level check and the hexes beside the route.
    let fogTop = '';
    let fogSplit = '';
    let fogBlock = '';
    if (fog !== undefined) {
      fogTop = `<div class="voyage-fog-sub text-muted"><i class="fa fa-cloud mr-1" aria-hidden="true"></i>${esc(t('MOD_VOY_FOG_SUB', { fog: `${fog.fog}`, hexes: hexes(info.hexes) }))}</div>`;
      fogSplit = `<div class="voyage-fog-split"><div>${esc(t('MOD_VOY_FOG_SPLIT_GO', { time: duration(info.ms) }))}</div>`
        + `<div><b>${esc(t('MOD_VOY_FOG_SPLIT_SURVEY', { time: duration(fog.ms), hexes: hexes(fog.fog) }))}</b></div>`
        + `<div class="voyage-fog-split-side d-none" data-voyage-fog="side-split"></div></div>`;
      const c = fog.check;
      const level = c.need > 0
        ? (c.by >= 0 ? t('MOD_VOY_FOG_LEVEL_REACH', { level: `${c.need}`, n: `${c.at}`, have: `${c.have}`, m: `${c.by}` }) : t('MOD_VOY_FOG_LEVEL_HAVE', { level: `${c.need}`, n: `${c.at}` }))
        : t('MOD_VOY_FOG_LEVEL_OK');
      const radio = (w, label, extra, allowed, time) => `<label class="voyage-fog-opt${allowed ? '' : ' voyage-fog-opt-off'}"><input type="radio" name="voyage-fog-side" value="${w}"${w === 0 ? ' checked' : ''}${allowed ? '' : ' disabled'}>`
        + `<span><b>${esc(label)}</b>${extra ? `<span class="text-muted">${esc(extra)}</span>` : ''}</span><span class="text-muted voyage-fog-opt-time">${esc(time)}</span></label>`;
      const opts = [radio(0, t('MOD_VOY_FOG_SIDE_NONE'), t('MOD_VOY_FOG_SIDE_NONE_NOTE'), true, duration(totalFor(0)))];
      for (const sd of fog.sides) {
        const label = t(sd.width === 1 ? 'MOD_VOY_FOG_SIDE_ONE' : 'MOD_VOY_FOG_SIDE_MANY', { n: `${sd.width}` });
        if (!sd.allowed) opts.push(radio(sd.width, label, t('MOD_VOY_FOG_SIDE_RANGE', { n: `${sd.width}`, have: `${fog.range}` }), false, '-'));
        else opts.push(radio(sd.width, label, t('MOD_VOY_FOG_SIDE_MORE', { hexes: hexes(sd.hexes) }), sd.hexes > 0, duration(totalFor(sd.width))));
      }
      fogBlock = `<div class="voyage-fog-level"><i class="fa fa-check text-success mr-2" aria-hidden="true"></i><span>${esc(level)}</span></div>`
        + `<div class="voyage-section voyage-fog-side"><div class="voyage-clock-head"><i class="fa fa-binoculars voyage-clock-fa" aria-hidden="true"></i>${esc(t('MOD_VOY_FOG_SIDE_HEAD'))}</div>${opts.join('')}</div>`;
    }
    const fogChip = fog !== undefined && fog.fog > 0 ? `<span class="voyage-travel-chip voyage-fog-chip"><i class="fa fa-cloud mr-1" aria-hidden="true"></i>${esc(t('MOD_VOY_FOG_N_FOG', { n: `${fog.fog}` }))}</span>` : '';
    const gpText = fog === undefined ? `${num(info.gp)} GP` : t('MOD_VOY_FOG_GP', { gp: num(info.gp) });
    const fogCostNote = fog === undefined ? '' : `<div class="voyage-clock-costs text-muted">${esc(t('MOD_VOY_FOG_COST_NOTE'))}</div>`;
    const html = '<div class="voyage-clock-setoff text-left">'
      + fogTop
      // Takes on its own row first, then Hexes and Costs side by side (the user, 18 Oct 2026).
      + '<div class="voyage-clock-tiles">'
      + `<div class="voyage-clock-tile voyage-clock-tile-wide voyage-clock-tile-time">${head('<i class="fa fa-hourglass-half voyage-clock-fa" aria-hidden="true"></i>', fog === undefined ? 'MOD_VOY_CLOCK_TAKES' : 'MOD_VOY_FOG_TAKES')}`
      + `<div class="voyage-clock-time-row"><span class="voyage-clock-time" data-voyage-fog="time">${esc(duration(totalFor(0)))}</span><span class="voyage-clock-tile-sub" data-voyage-fog="arrive">${arriveHtml(0)}</span></div>${fogSplit}${strip}</div>`
      + `<div class="voyage-clock-tile">${head('<i class="fa fa-route voyage-clock-fa" aria-hidden="true"></i>', 'MOD_VOY_CLOCK_HEXES')}`
      + `<div class="voyage-clock-tile-value">${esc(hexes(info.hexes))}</div><div class="voyage-clock-chips">${chip('land', info.land, 'MOD_VOY_CLOCK_N_LAND')}${chip('sea', info.sea, 'MOD_VOY_CLOCK_N_SEA')}${fogChip}</div></div>`
      + `<div class="voyage-clock-tile">${head(img(game.gp.media, 'voyage-clock-icon voyage-clock-head-icon'), 'MOD_VOY_CLOCK_COSTS')}`
      + `<div class="voyage-clock-tile-value voyage-clock-gp">${esc(gpText)}</div>${costBits.length > 0 ? `<div class="voyage-clock-costs">${costBits.join('')}</div>` : ''}${fogCostNote}</div>`
      + '</div>'
      + fogBlock
      + `<div class="voyage-section voyage-clock-arrival"><div class="voyage-clock-head"><i class="fa fa-anchor voyage-clock-fa" aria-hidden="true"></i>${esc(t('MOD_VOY_CLOCK_ON_ARRIVAL'))}</div>`
      + select('voyage-clock-a1', 1, 'MOD_VOY_CLOCK_FIRST', defaults[0] ?? -1)
      + select('voyage-clock-a2', 2, 'MOD_VOY_CLOCK_SECOND', defaults[1] ?? -1)
      + select('voyage-clock-a3', 3, 'MOD_VOY_CLOCK_THIRD', -1)
      // Uncharted ground: a fog-tinted band with the cloud, as the level line above it (the user, build .236: "add some
      // designing"); the rule under it a small muted line with the info icon.
      + (known ? '' : `<div class="voyage-clock-unknown"><i class="fa fa-cloud" aria-hidden="true"></i><span>${esc(t('MOD_VOY_CLOCK_ARRIVAL_UNKNOWN'))}</span></div>`)
      + `<div class="text-muted voyage-clock-note voyage-clock-note-rule"><i class="fa fa-info-circle" aria-hidden="true"></i><span>${esc(t('MOD_VOY_CLOCK_ARRIVAL_NOTE'))}</span></div></div>`
      + '</div>';
    // The picture on top: what carries you most of the way (the hull at sea, the mount or your feet on land).
    let picture;
    try {
      const sea = legs.filter((l) => l.sea).reduce((a, l) => a + l.ms, 0);
      if (sea * 2 >= totalMs) {
        const big = stepsOf(path).some((st) => st.vessel === 'ship') ? hullOf('ship') : undefined;
        picture = res(`hull_${big ?? hullOf('boat') ?? 'dinghy'}.webp`);
      } else picture = state.land?.mediaOf?.(state.land.mount()) ?? res('marker_traveller_figure.webp');
    } catch { picture = res('icon.webp'); }
    SwalLocale.fire({
      title: t('MOD_VOY_CLOCK_SETOFF_TITLE', { name }),
      imageUrl: picture,
      ...helpLayout.MSG_IMAGE,
      html,
      width: helpLayout.HELP_WIDTH,
      showCancelButton: true,
      reverseButtons: true,
      confirmButtonText: t('MOD_VOY_CLOCK_SETOFF'),
      cancelButtonText: t('MOD_VOY_CLOCK_CANCEL'),
      didRender: state.popupDidRender,
      didOpen: (el) => {
        // A pick from a dropdown: the hidden value, the toggle's words, the icon by it and the menu's active row.
        el.querySelectorAll('[data-voyage-dd-for]').forEach((a) => a.addEventListener('click', () => {
          const id = a.dataset.voyageDdFor;
          const i = Number(a.dataset.pick);
          const input = el.querySelector(`#${id}`);
          if (input !== null) input.value = `${i}`;
          const face = el.querySelector(`[data-voyage-dd="${id}"] span`);
          if (face !== null) face.textContent = pickLabel(i);
          const box = el.querySelector(`[data-voyage-pick-icon="${id}"]`);
          if (box !== null) box.innerHTML = pickIcon(i);
          el.querySelectorAll(`[data-voyage-dd-for="${id}"]`).forEach((b) => b.classList.toggle('active', b === a));
        }));
        // The hexes beside: the time and the arrival follow the pick.
        el.querySelectorAll('input[name="voyage-fog-side"]').forEach((r) => r.addEventListener('change', () => {
          const w = Number(r.value);
          const timeEl = el.querySelector('[data-voyage-fog="time"]');
          const arriveEl = el.querySelector('[data-voyage-fog="arrive"]');
          const sideEl = el.querySelector('[data-voyage-fog="side-split"]');
          if (timeEl !== null) timeEl.textContent = duration(totalFor(w));
          if (arriveEl !== null) arriveEl.innerHTML = arriveHtml(w);
          const sd = sideOf(w);
          if (sideEl !== null) {
            sideEl.textContent = sd === undefined ? '' : t('MOD_VOY_FOG_SPLIT_SIDE', { time: duration(sd.ms), hexes: hexes(sd.hexes) });
            sideEl.classList.toggle('d-none', sd === undefined);
          }
        }));
      },
      // The popup's body lets the arrival dropdowns' menus out (Swal clips its html container).
      customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass({ ...SWAL_CLASS, htmlContainer: 'voyage-swal-menus' }) : { ...SWAL_CLASS, htmlContainer: 'voyage-swal-menus' },
      preConfirm: () => ({
        picks: ['voyage-clock-a1', 'voyage-clock-a2', 'voyage-clock-a3'].map((id) => Number(document.getElementById(id)?.value ?? -1)),
        side: Number(document.querySelector('input[name="voyage-fog-side"]:checked')?.value ?? 0),
      }),
    }).then((r) => {
      if (!r.isConfirmed) return;
      const chain = (r.value?.picks ?? []).filter((i) => i >= 0 && i < opts.length).map((i) => opts[i].choice);
      if (fog !== undefined) {
        // Never an instant move through the fog: refused, it says so.
        if (!setOff({ path, name, chain, fog: { side: Number.isInteger(r.value?.side) ? r.value.side : 0 } })) notify(t('MOD_VOY_FOG_REFUSED_START'), 'danger');
        try { cart().render(); } catch {}
        return;
      }
      // The selection may be gone by now (the map redrew): the path is the one priced above. Refused (Golbin Raid
      // began), it goes as an ordinary move, which speaks its own refusal.
      if (!setOff({ path, name, chain })) { try { cart().movePlayer(path, false); } catch (e) { log('instant fallback failed', e); } }
      try { cart().render(); } catch {}
    });
  };

  /** A route through the fog (5b): "Can't set off" when a survey on it is out of reach, else the Set off popup. */
  const confirmFog = (path, fog) => {
    const c = fog?.check;
    if (c !== undefined && !c.ok) {
      const hex = c.hex;
      SwalLocale.fire({
        title: t('MOD_VOY_FOG_CANT_TITLE'),
        // "brings you to N at most" only when the surveys before it give levels (the user saw "1 at most" at level 1).
        // The first fog hex of the route has no fog before it to give levels (build .233).
        html: helpLayout.msgHtml([esc(t(c.reach > c.have ? 'MOD_VOY_FOG_CANT_LEVEL' : c.first ? 'MOD_VOY_FOG_CANT_LEVEL_FIRST' : 'MOD_VOY_FOG_CANT_LEVEL_NOW', { n: `${c.at}`, at: hex === undefined ? '' : at(hex), level: `${c.need}`, have: `${c.have}`, reach: `${c.reach}` }))]),
        imageUrl: ctx.getResourceUrl('assets/icon.webp'),
        ...helpLayout.MSG_IMAGE,
        showCancelButton: hex !== undefined,
        reverseButtons: true,
        confirmButtonText: t('MOD_VOY_FOG_OK'),
        cancelButtonText: t('MOD_VOY_FOG_SHOW_HEX'),
        didRender: state.popupDidRender,
        customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass(SWAL_CLASS) : SWAL_CLASS,
      }).then((r) => {
        if (r.dismiss === 'cancel' && hex !== undefined) { try { state.ship?.centreOn?.(hex); } catch (e) { log('map centre failed', e); } }
      });
      return;
    }
    confirmSetOff(path, () => {}, fog);
  };

  // ---- the voyage under way ----------------------------------------------------------------------------------------
  /** Loads the stores at the player's place from the bank, best food then fuel (the planner's stops). */
  const loadHere = () => {
    const st = state.stores;
    for (const x of st?.loadable?.() ?? []) { try { st.load(x.item, x.qty); } catch (e) { log('voyage loading failed', e); } }
  };
  /** Fuel the rest of the walk after step `i` needs: never spent on light for this hex (stores-model planLight). */
  const holdAfter = (v, i) => {
    if (i + 1 >= v.walk.length - 1) return 0;
    const rest = pathOf(v.walk, i + 1, v.walk.length - 1);
    if (rest === undefined) return 0;
    try { return S.pathCost(stepsOf(rest), state.stores?.fmLevel?.() ?? 1).fuel; } catch { return 0; }
  };
  let stepping = false;
  let finalStep = false;
  // A voyage is one trip to the game, though it moves hex by hex (vanilla rules kept, found in game 18 Oct 2026):
  // a point of interest is discovered only at the end of the route (instant travel never discovers the ones it
  // passes), travel events roll on the hex entered, not again on the one left, and a discovery buff that lasts N
  // moves counts the whole voyage as one move.
  try {
    ctx.patch(Cartography, 'discoverPOI').replace(function (original, ...args) {
      if (stepping && !finalStep) return undefined;
      return original(...args);
    });
    ctx.patch(Cartography, 'rollForTravelEvent').replace(function (original, path, ...rest) {
      return original(stepping && Array.isArray(path) && path.length > 1 ? path.slice(0, -1) : path, ...rest);
    });
  } catch (e) { log('one-trip rules not patched', e); }
  /** The discovery buffs' moves left, to put back after a step that is not the last (one move per voyage). */
  const keepMoves = () => {
    try {
      const set = cart().activeDiscoveryModifiers;
      const was = [...set].map((d) => [d, d.movesLeft]);
      return () => {
        let changed = false;
        for (const [d, n] of was) { if (d.movesLeft !== n || !set.has(d)) { d.movesLeft = n; set.add(d); changed = true; } }
        if (changed) cart().computeProvidedStats(true);
      };
    } catch { return () => {}; }
  };
  /** Steps onto the next hex: one ordinary move, paid as an instant move is. */
  const step = (v) => {
    const i = v.at;
    const here = map()?.playerPosition;
    if (here === undefined || here.q !== v.walk[i].q || here.r !== v.walk[i].r) { log('voyage off its route: stopped'); end('stopped'); return; }
    const path = pathOf(v.walk, i, i + 1);
    if (path === undefined) { end('stopped'); return; }
    stepping = true;
    finalStep = i + 1 >= v.walk.length - 1;
    state.lightHold = holdAfter(v, i);
    const putBack = finalStep ? () => {} : keepMoves();
    try { cart().movePlayer(path, false); } catch (e) { log('voyage step failed', e); } finally { stepping = false; finalStep = false; state.lightHold = 0; }
    putBack();
    const now = map()?.playerPosition;
    // The why in the ending, so it is marked as one (red in Welcome Back, as a fog refusal's; build .233).
    if (now !== path[0]) { log(`voyage refused at step ${i + 1}`); end('refused', { why: t('MOD_VOY_CLOCK_WHY_UNPAID') }); return; }
    v.at = i + 1;
    if (v.loads.includes(v.at)) loadHere();
    if (v.at >= v.walk.length - 1) { arrive(v); return; }
    if (v.fog === true) v.sv = state.fog?.queueAt?.(v, v.at) ?? [];
    nextTimer(v);
  };
  /** The timer after a step or a survey: the next survey to make (in the fog), else the step's own time. */
  const nextTimer = (v) => {
    if (v.fog === true && state.fog !== undefined) {
      const blocked = state.fog.tidy(v);
      if (blocked !== undefined) {
        // The hex ahead can't be surveyed after all (a level lost, a requirement changed): the voyage stops here.
        const at = nameOfHex(blocked.hex);
        const level = `${blocked.level}`;
        if (!offlineNow()) notify(blocked.level > 0 ? t('MOD_VOY_FOG_REFUSED_LEVEL', { at, level }) : t('MOD_VOY_FOG_REFUSED_REQS', { at }), 'danger');
        end('refused', { quiet: true, why: blocked.level > 0 ? t('MOD_VOY_FOG_WHY_LEVEL', { at, level }) : t('MOD_VOY_FOG_WHY_REQS', { at }) });
        return;
      }
      if (v.sv.length > 0) { v.left = state.fog.actionTicks(); v.of = v.left; return; }
    }
    v.left = stepTicks(v)[v.at] ?? C.ticksOf(C.LAND_MS);
    v.of = v.left;
  };
  /** One survey action of the fog voyage's queue, then the next timer. */
  const survey = (v) => {
    const h = v.sv[0];
    const g = h === undefined ? undefined : hexAt(h.q, h.r);
    if (g !== undefined && !g.isFullySurveyed) {
      try { state.fog.surveyOnce(g); } catch (e) { log('voyage survey failed: stopped', e); end('refused'); return; }
    }
    if (cur() !== v) return;
    nextTimer(v);
  };
  const tick = () => {
    const v = cur();
    if (v === null) { clearAction(); return; }
    v.spent++;
    v.left--;
    if (v.left > 0) return;
    if (v.fog === true && v.sv.length > 0) { survey(v); return; }
    step(v);
  };
  const clearAction = () => {
    const s = skill();
    try { if (game.activeAction === s) game.clearActiveAction(false); } catch {}
    try { game.renderQueue.activeSkills = true; game.scheduleSave(); } catch {}
  };
  /** Ends the voyage where it stands: 'arrived', 'stopped' (Stop here, another start) or 'refused' (a hex refused). */
  const end = (how, extra = {}) => {
    const v = cur();
    const s = skill();
    if (v === null || s === undefined) return;
    // The time sailed, from the ticks run (the clock can jump: a catch-up replays from the last tick it saw).
    const ticks = stepTicks(v);
    let sailed = 0;
    for (let k = 0; k < v.at; k++) sailed += ticks[k] ?? 0;
    if (v.at < ticks.length) sailed += Math.max(0, (ticks[v.at] ?? 0) - v.left);
    // The ticks run when counted (build .224: a fog voyage's surveys take time of their own).
    const ms = (v.spent > 0 ? v.spent : sailed) * C.TICK_MS;
    const quiet = extra.quiet === true;
    delete extra.quiet;
    const e = C.cleanEnding({ name: v.name, hexes: v.at, ms, xp: Math.max(0, s.xp - v.xp), at: state.clockNow(), how, started: '', failed: [], ...extra });
    setVoyage(null);
    setEnding(e);
    clearAction();
    if (how !== 'arrived' && !offlineNow() && !quiet) {
      const pos = map()?.playerPosition;
      notify(t(how === 'refused' ? 'MOD_VOY_CLOCK_REFUSED_AT' : 'MOD_VOY_CLOCK_STOPPED_AT', { at: pos === undefined ? '' : nameOfHex(pos) }), how === 'refused' ? 'danger' : 'success');
    }
    changed();
    return e;
  };
  const arrive = (v) => {
    const chain = v.chain;
    const e = end('arrived');
    if (e == null) return;
    const r = chain.length > 0 ? runChain(chain) : { started: '', failed: [] };
    e.started = r.started;
    e.failed = r.failed.slice(0, 3);
    e.asked = chain.length > 0;
    setEnding(e);
    if (!offlineNow()) notify(r.started !== '' ? t('MOD_VOY_CLOCK_ARRIVED_START', { name: e.name, what: r.started }) : t('MOD_VOY_PLAN_ARRIVED', { name: e.name }), r.started === '' && r.failed.length > 0 ? 'danger' : 'success');
    log(`arrived at ${e.name}${r.started ? `, started ${r.started}` : ''}${r.failed.length ? `; could not start ${r.failed.map((f) => `${f.name} (${f.why})`).join(', ')}` : ''}`);
    changed();
  };
  let forcing = false;
  /** The skill's stop(): the game stops the voyage (another action after the question, a gamemode change). */
  const stop = () => { if (cur() === null) return false; end('stopped'); return true; };
  /** Stop here: the voyage ends on the hex reached. */
  const stopHere = () => { forcing = true; try { end('stopped'); } finally { forcing = false; } };

  // ---- asking first ------------------------------------------------------------------------------------------------
  let retryCall;
  for (const m of ['selectMonster', 'selectDungeon', 'selectStronghold', 'selectAbyssDepth']) {
    try {
      if (typeof CombatManager !== 'function' || typeof CombatManager.prototype[m] !== 'function') continue;
      // The retry calls the method afresh, so the gate's checks run again (a patch's `original` is spent once called).
      ctx.patch(CombatManager, m).replace(function (original, ...args) {
        const before = retryCall;
        const self = this;
        retryCall = () => self[m](...args);
        try { return original(...args); } finally { retryCall = before; }
      });
    } catch (e) { log(`combat ${m} not wrapped`, e); }
  }
  const ask = (action) => {
    const v = cur();
    if (v === null) return;
    const retry = retryCall ?? (typeof GatheringSkill !== 'undefined' && action instanceof GatheringSkill && action.id !== CARTOGRAPHY_ID ? () => action.start() : undefined);
    const what = action === game.combat ? t('MOD_VOY_CLOCK_ASK_COMBAT') : action?.name ?? t('MOD_VOY_CLOCK_ASK_THAT');
    const lines = [t('MOD_VOY_CLOCK_ASK_BODY', { time: duration(msLeft(v)), name: v.name, what })];
    // The voyage sails on while you read: a start asked on one hex is not tried on the next (its zone may differ).
    const askedAt = map()?.playerPosition;
    SwalLocale.fire({
      title: t('MOD_VOY_CLOCK_ASK_TITLE'),
      html: helpLayout.msgHtml(lines.map((l) => esc(l))),
      imageUrl: ctx.getResourceUrl('assets/icon.webp'),
      ...helpLayout.MSG_IMAGE,
      showCancelButton: true,
      reverseButtons: true,
      confirmButtonText: retry !== undefined ? t('MOD_VOY_CLOCK_ASK_GO', { what }) : t('MOD_VOY_CLOCK_STOP_HERE'),
      cancelButtonText: t('MOD_VOY_CLOCK_KEEP'),
      didRender: state.popupDidRender,
      customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass(SWAL_CLASS) : SWAL_CLASS,
    }).then((r) => {
      if (!r.isConfirmed || cur() === null) return;
      stopHere();
      if (retry !== undefined && map()?.playerPosition === askedAt) { try { retry(); } catch (e) { log('start after anchoring failed', e); } }
    });
  };
  // Installed after the gate's, so it runs first: a skill the gate refuses here is left to the gate (no question).
  ctx.patch(Game, 'idleChecker').replace(function (original, action) {
    try {
      const s = skill();
      if (forcing || s === undefined || action === s || this.activeAction !== s || cur() === null || this.isGolbinRaid) return original(action);
      if (typeof action?.id === 'string' && state.skillLockedHere?.(action.id)) return original(action);
      if (offlineNow()) { stopHere(); return original(action); }
      ask(action);
      return true;
    } catch (e) { log('voyage question failed', e); return original(action); }
  });

  // ---- the map's Travel ---------------------------------------------------------------------------------------------
  ctx.patch(Cartography, 'travelOnClick').replace(function (original) {
    try {
      const path = this.activeMap?.selectedHexPath;
      if (!on() || this.game.isGolbinRaid || !Array.isArray(path) || path.length < 2 || stepping) return original();
      confirmSetOff(path, () => original());
    } catch (e) { log('timed travel failed; instant', e); return original(); }
  });

  // The game's "Undiscovered Point of Interest Surveyed" prompt: Travel Now sets off too. The prompt was the question,
  // so no second one: on arrival, what you were doing. A trip the stores refuse goes the old way (its refusal).
  ctx.patch(Cartography, 'onPOIDiscoveryConfirm').replace(function (original) {
    try {
      const m = this.activeMap;
      const poi = m?.undiscoveredPOIs?.[0];
      if (!on() || this.game.isGolbinRaid || m === undefined || this.poiModalsQueued > 0 || poi === undefined) return original();
      const path = m.computePath(m.playerPosition, poi.hex);
      if (path === undefined || path.length < 2) return original();
      const info = routeInfo(path);
      if ((info.plan?.plan !== undefined && !info.plan.plan.ok) || info.gp > this.game.gp.amount) return original();
      const now = doingNow();
      if (!setOff({ path, name: nameOfHex(poi.hex), chain: now === undefined ? [] : [now] })) return original();
      try { this.render(); } catch {}
      return true;
    } catch (e) { log('timed POI travel failed; instant', e); return original(); }
  });

  // ---- the offline summary -----------------------------------------------------------------------------------------
  // The game's box asks the action it was doing when the catch-up began for its lines (getOfflineMessages, a header
  // each): a voyage can only be under way offline if it was that action, so the skill passes this on.
  // Marked up as the game's own lines (build .227, the user: "around game's own"): the skill's small icon first, the
  // numbers green as its posSpan, why a voyage stopped red as its negSpan. Values escaped, the lang text kept as is.
  const pos = (s) => `<span class="text-success">${esc(s)}</span>`;
  const neg = (s) => `<span class="text-danger">${esc(s)}</span>`;
  const icon = () => { const m = skill()?.media; return m ? `<img class="skill-icon-xs mr-1" src="${esc(m)}" alt="">` : ''; };
  const offlineMessages = () => {
    const out = [];
    try {
      const e = ending();
      const v = cur();
      const from = game._offlineInfo?.startTime ?? 0;
      if (e !== null && !e.seen && e.at >= from - 1000) {
        out.push(icon() + t(e.how === 'arrived' ? 'MOD_VOY_CLOCK_OFFLINE_ARRIVED' : e.how !== 'refused' ? 'MOD_VOY_CLOCK_OFFLINE_STOPPED' : e.why !== '' ? 'MOD_VOY_CLOCK_OFFLINE_REFUSED_WHY' : 'MOD_VOY_CLOCK_OFFLINE_REFUSED',
          { name: esc(e.name), time: esc(clockAt(e.at)), hexes: pos(hexes(e.hexes)), took: pos(duration(e.ms)), why: neg(e.why) }));
        for (const f of e.failed) out.push(`<span class="text-warning">${esc(t('MOD_VOY_CLOCK_COULD_NOT', { name: f.name, why: f.why }))}</span>`);
        if (e.started !== '') out.push(`<span class="text-success">${esc(t('MOD_VOY_CLOCK_OFFLINE_STARTED', { what: e.started, time: clockAt(e.at) }))}</span>`);
        else if (e.how === 'arrived' && e.asked) out.push(`<span class="text-warning">${esc(t('MOD_VOY_CLOCK_OFFLINE_IDLE'))}</span>`);
        else if (e.how === 'arrived') out.push(`<span class="font-w400">${esc(t('MOD_VOY_CLOCK_OFFLINE_WAITED'))}</span>`);
        setEnding({ ...e, seen: true });
      } else if (v !== null) {
        out.push(icon() + t('MOD_VOY_CLOCK_OFFLINE_UNDERWAY', { at: pos(`${v.at}`), of: esc(`${v.walk.length - 1}`), time: pos(duration(msLeft(v))), name: esc(v.name) }));
      }
    } catch (err) { log('offline note failed', err); }
    return out;
  };

  // ---- the page block and the panel chip ----------------------------------------------------------------------------
  const changed = () => {
    const s = skill();
    if (s !== undefined) s.renderQueue.page = true;
    blockSig = undefined;
    try { state.onSettingsChange(); } catch {}
  };
  const pct = (n) => `${Math.max(0, Math.min(100, Math.round(n * 1000) / 10))}%`;
  let blockSig;
  const blockEl = () => document.querySelector('#voyage-container [data-voyage="underway"]');
  const wrapEl = () => document.querySelector('#voyage-container [data-voyage="underway-block"]');
  /** The Under way block (a voyage running) or the last voyage's ending, until closed. */
  const blockHtml = () => {
    const v = cur();
    if (v !== null) {
      const ticks = stepTicks(v);
      const here = map()?.playerPosition;
      const rec = state.recordAt?.(here);
      const aboard = rec !== undefined && (rec.t === 'water' || rec.t === 'shoal');
      const where = rec === undefined ? '' : getLangString(terrainMod.classKey(rec.t));
      const how = aboard ? t('MOD_VOY_CLOCK_AT_SEA', { hull: state.ship?.hullName?.(state.ship?.vessel?.(state.ship?.inVessel?.() ?? 'boat')) ?? '' }) : t('MOD_VOY_CLOCK_ON_LAND');
      const legs = [];
      // The walk in runs of land and sea, the run in progress marked.
      let i = 0;
      const seaAt = (k) => { const r = state.recordAt?.(v.walk[k]); return r !== undefined && (r.t === 'water' || r.t === 'shoal'); };
      while (i < v.walk.length - 1) {
        const sea = seaAt(i + 1);
        let j = i;
        let ms = 0;
        while (j < v.walk.length - 1 && seaAt(j + 1) === sea) {
          ms += (ticks[j] ?? 0) * C.TICK_MS;
          // In the fog, the surveys a hex still needs (5b).
          if (v.fog === true && j >= v.at) { const g = hexAt(v.walk[j + 1].q, v.walk[j + 1].r); if (g !== undefined) ms += state.fog?.surveyMs?.(g) ?? 0; }
          j++;
        }
        const state_ = j <= v.at ? 'done' : i <= v.at ? 'now' : 'next';
        legs.push(`<div class="voyage-clock-leg voyage-clock-leg-${state_}"><i class="fa ${state_ === 'done' ? 'fa-check text-success' : state_ === 'now' ? 'fa-circle text-info' : 'fa-circle-notch text-muted'}" aria-hidden="true"></i>`
          + `<span>${esc(t(sea ? 'MOD_VOY_CLOCK_LEG_SEA' : 'MOD_VOY_CLOCK_LEG_LAND', { hexes: hexes(j - i) }))}</span><span class="text-muted">${esc(duration(ms))}</span></div>`);
        i = j;
      }
      const chain = v.chain.length === 0 ? `<div>${esc(t('MOD_VOY_CLOCK_DO_NOTHING'))}</div>`
        : `<div><b>${esc(labelOf(v.chain[0]))}</b></div>${v.chain.length > 1 ? `<div class="text-muted">${esc(t('MOD_VOY_CLOCK_THEN', { list: v.chain.slice(1).map(labelOf).join(' · ') }))}</div>` : ''}`;
      return `<div class="voyage-clock-top"><img class="voyage-clock-pic" src="${ctx.getResourceUrl('assets/icon.webp')}" alt="">`
        + `<div><h5 class="font-w600 mb-0">${esc(t('MOD_VOY_CLOCK_UNDERWAY', { name: v.name }))}</h5>`
        + `<div class="text-muted">${esc(t('MOD_VOY_CLOCK_HEX_OF', { at: `${v.at}`, of: `${v.walk.length - 1}` }))} · ${esc(how)}${where ? ` · ${esc(where)}` : ''}</div></div></div>`
        + '<div class="voyage-section voyage-clock-bars">'
        + `<div class="voyage-clock-bar-row"><span data-voyage-clock="hex-label">${esc(t('MOD_VOY_CLOCK_THIS_HEX'))}</span><span class="text-muted" data-voyage-clock="hex-time"></span></div>`
        + '<div class="progress voyage-clock-bar"><div class="progress-bar bg-info" data-voyage-clock="hex-bar"></div></div>'
        + `<div class="voyage-clock-bar-row"><span>${esc(t('MOD_VOY_CLOCK_THE_VOYAGE'))}</span><span data-voyage-clock="left"></span></div>`
        + '<div class="progress voyage-clock-bar"><div class="progress-bar bg-success" data-voyage-clock="bar"></div></div></div>'
        + `<div class="voyage-section">${legs.join('')}</div>`
        + `<div class="voyage-section"><div class="voyage-clock-head">${esc(t('MOD_VOY_CLOCK_ON_ARRIVAL'))}</div>${chain}</div>`
        + '<div class="voyage-plan-buttons">'
        + `<button type="button" class="btn btn-outline-info" data-voyage-clock-do="map">${esc(t('MOD_VOY_PAGE_SHOW_MAP'))}</button>`
        + `<button type="button" class="btn btn-outline-danger" data-voyage-clock-do="stop">${esc(t('MOD_VOY_CLOCK_STOP_HERE'))}</button></div>`
        + (v.at > 0 ? `<div class="text-muted voyage-clock-note text-right">${esc(t('MOD_VOY_CLOCK_STOP_NOTE', { hexes: hexes(v.at) }))}</div>` : '');
    }
    const e = ending();
    if (e === null || e.closed) return '';
    const lines = [t(e.how === 'arrived' ? 'MOD_VOY_CLOCK_ENDED_ARRIVED' : e.how !== 'refused' ? 'MOD_VOY_CLOCK_ENDED_STOPPED' : e.why !== '' ? 'MOD_VOY_CLOCK_ENDED_REFUSED_WHY' : 'MOD_VOY_CLOCK_ENDED_REFUSED', { name: e.name, time: clockAt(e.at), hexes: hexes(e.hexes), took: duration(e.ms), why: e.why })];
    let html = `<div>${esc(lines[0])}</div>`;
    if (e.xp > 0) html += `<div class="text-success">${esc(t('MOD_VOY_CLOCK_OFFLINE_XP', { xp: num(e.xp) }))}</div>`;
    for (const f of e.failed) html += `<div class="text-warning">${esc(t('MOD_VOY_CLOCK_COULD_NOT', { name: f.name, why: f.why }))}</div>`;
    if (e.started !== '') html += `<div>${esc(t('MOD_VOY_CLOCK_ENDED_STARTED', { what: e.started }))}</div>`;
    return `<div class="voyage-clock-ended"><div class="voyage-clock-ended-text">${html}</div>`
      + `<button type="button" class="btn btn-sm btn-outline-info" data-voyage-clock-do="close">${esc(t('MOD_VOY_CLOCK_CLOSE'))}</button></div>`;
  };
  /**
   * On a phone the status block (compass, land, travels) stacks to a screen or more, so the Under way block sits
   * above it there and keeps its place under it on a wider screen (the phone run, build .239). The movable blocks
   * below (src/page-layout.mjs) are not touched.
   */
  const PHONE = window.matchMedia?.('(max-width: 767.98px)');
  const place = () => {
    const wrap = wrapEl();
    const status = wrap?.parentElement?.querySelector(':scope > .voyage-status-block');
    if (wrap == null || status == null) return;
    const phone = PHONE?.matches === true;
    if (phone && wrap.nextElementSibling !== status) status.before(wrap);
    else if (!phone && status.nextElementSibling !== wrap) status.after(wrap);
  };
  PHONE?.addEventListener?.('change', () => { try { place(); } catch (e) { log('under way placement failed', e); } });
  /** Draws the block when what it shows changed, then moves its bars (every frame while the page is open). */
  const render = () => {
    const el = blockEl();
    if (el === null) return;
    const v = cur();
    const e = ending();
    const sig = v === null ? `e|${e?.at}|${e?.closed}` : `v|${v.at}|${v.walk.length}|${v.chain.length}|${v.fog === true}`;
    if (sig !== blockSig) {
      blockSig = sig;
      const html = on() || v !== null ? blockHtml() : '';
      el.innerHTML = html;
      wrapEl()?.classList.toggle('d-none', html === '');
      place();
      state.tips?.apply?.(el);
    }
    if (v === null) return;
    const stepAll = v.of > 0 ? v.of : 1;
    const left = msLeft(v);
    const set = (k, f) => { const x = el.querySelector(`[data-voyage-clock="${k}"]`); if (x !== null) f(x); };
    // In the fog the hex's row tells the survey under way, its bar the survey action's.
    const surveying = v.fog === true && v.sv.length > 0 ? hexAt(v.sv[0].q, v.sv[0].r) : undefined;
    set('hex-label', (x) => {
      const text = surveying === undefined ? t('MOD_VOY_CLOCK_THIS_HEX')
        : t('MOD_VOY_FOG_SURVEYING', { at: at(surveying), level: `${surveying.surveyLevel}`, max: `${surveying.maxSurveyLevel}` });
      if (x.textContent !== text) x.textContent = text;
    });
    set('hex-bar', (x) => { x.style.width = pct(1 - v.left / stepAll); x.classList.toggle('bg-warning', surveying !== undefined); x.classList.toggle('bg-info', surveying === undefined); });
    set('hex-time', (x) => { x.textContent = t('MOD_VOY_CLOCK_OF_TIME', { done: C.clockText((stepAll - v.left) * C.TICK_MS), all: C.clockText(stepAll * C.TICK_MS) }); });
    set('bar', (x) => { const all = Math.max(v.total, v.spent + left / C.TICK_MS) || 1; x.style.width = pct(v.spent / all); });
    set('left', (x) => { x.textContent = t('MOD_VOY_CLOCK_LEFT', { time: clockAt(Date.now() + left), left: duration(left) }); });
  };
  document.addEventListener('click', (ev) => {
    const b = ev.target instanceof Element ? ev.target.closest('[data-voyage-clock-do]') : null;
    if (b === null) return;
    const what = b.dataset.voyageClockDo;
    if (what === 'stop') stopHere();
    else if (what === 'close') { const e = ending(); if (e !== null) setEnding({ ...e, closed: true }); blockSig = undefined; render(); }
    else if (what === 'map') {
      const v = cur();
      const dest = v === null ? undefined : hexAt(v.walk[v.walk.length - 1].q, v.walk[v.walk.length - 1].r);
      try { state.openPage(game.pages.getObjectByID(CARTOGRAPHY_ID)); } catch {}
      if (dest !== undefined) setTimeout(() => { try { state.ship?.centreOn?.(dest); } catch (e) { log('map centre failed', e); } }, 100);
    }
  });
  /** The Here panel's chip while under way: { text, tip } or undefined. */
  const chip = () => {
    const v = cur();
    if (v === null) return undefined;
    const left = duration(msLeft(v));
    return { text: left, tip: t('MOD_VOY_CLOCK_CHIP', { left, name: v.name }) };
  };

  // A setting turned off mid-voyage ends it where it stands; a save loaded off its route too.
  state.listeners.push(() => { if (cur() !== null && !on() && usable()) end('stopped'); });
  ctx.onCharacterLoaded(() => {
    try {
      const v = cur();
      if (v === null) return;
      const here = map()?.playerPosition;
      if (here === undefined || here.q !== v.walk[v.at].q || here.r !== v.walk[v.at].r) { log('saved voyage is off its route: ended'); end('stopped'); return; }
      if (game.activeAction !== skill()) { log('saved voyage had no active action: going on'); game.activeAction = skill(); game.renderQueue.activeSkills = true; }
      log(`voyage under way to ${v.name}: hex ${v.at + 1} of ${v.walk.length - 1}`);
    } catch (e) { log('voyage load check failed', e); }
  });

  const api = { on, setOff, tick, stop, offlineMessages, running: () => cur() !== null, render, chip, optionsFor, labelOf, doingNow, routeInfo, duration, clockAt, stopHere, stepping: () => stepping, confirmFog };
  state.clock = api;
  return api;
}
