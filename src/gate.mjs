// The gates. Skills, combat and trade each have one, all failing open: any error, unknown hex, dormant or relaxed
// mode, the "Voyage rules" switch off, Golbin Raid or the tutorial (state.active) means vanilla behaviour.
//
// Skills, two layers:
//  1. Entry points: the UI method a skill uses to start (Woodcutting.selectTree, Mining.onRockClick, ...) is checked
//     BEFORE it changes any selection, so a refused start leaves the page exactly as it was. Vanilla changes the
//     selection first and only then calls start(); refusing there strands the selection (the "first click does
//     nothing" bug of build .2).
//  2. Game.idleChecker(action), the one call every start goes through. Returning true refuses the start. This is the
//     backstop for any path that does not go through a known entry point. Worker Folks patches it too; the loader
//     chains the patches, so a Folk delegated by Worker Folks may bypass this gate until phase 6.
// Combat: CombatManager.checkAreaEntryRequirements, called by every area/dungeon/stronghold/depth selection.
// Trade: the bank's sell entries and Shop.buyItemOnClick. The Township trader is not trade: it follows
// the Township rule (a town or port), decided 15 Oct 2026.
// Hiring (Worker Folks, optional): follows the Township rule for staff changes: the hire purchases, promote and fire.
// Assigning Folks to skills stays free; delegation is a phase 6 topic.

/**
 * Skill UI methods that start the skill. `cls` is a thunk: game classes are top-level `class` declarations, global
 * bindings but NOT properties of globalThis, and a ReferenceError means the class is absent (expansion not loaded).
 * `when`: 'inactive' refuses only when the skill is not running (a click on a running skill stops it, which must
 * always work); 'always' refuses every call (skills without an active state: Farming, Township). `quiet` methods
 * are refused without a modal (they are called in loops by the listed ones).
 */
const ENTRY_POINTS = [
  { skillId: 'melvorD:Woodcutting', className: 'Woodcutting', cls: () => Woodcutting, methods: ['selectTree'], when: 'inactive' },
  { skillId: 'melvorD:Mining', className: 'Mining', cls: () => Mining, methods: ['onRockClick'], when: 'inactive' },
  { skillId: 'melvorD:Fishing', className: 'Fishing', cls: () => Fishing, methods: ['onAreaStartButtonClick'], when: 'inactive' },
  { skillId: 'melvorD:Thieving', className: 'Thieving', cls: () => Thieving, methods: ['startThieving'], when: 'inactive' },
  { skillId: 'melvorD:Firemaking', className: 'Firemaking', cls: () => Firemaking, methods: ['burnLog'], when: 'inactive' },
  { skillId: 'melvorD:Cooking', className: 'Cooking', cls: () => Cooking, methods: ['onActiveCookButtonClick'], when: 'inactive' },
  // Smithing, Fletching, Crafting, Herblore, Runecrafting and Summoning share the artisan Create button; this.id decides.
  { className: 'ArtisanSkill', cls: () => ArtisanSkill, methods: ['createButtonOnClick'], when: 'inactive' },
  { skillId: 'melvorD:Magic', className: 'AltMagic', cls: () => AltMagic, methods: ['castButtonOnClick'], when: 'inactive' },
  { skillId: 'melvorD:Farming', className: 'Farming', cls: () => Farming, when: 'always',
    methods: ['plantPlotOnClick', 'plantAllOnClick', 'plantAllSelectedOnClick', 'harvestPlotOnClick', 'harvestAllOnClick', 'plantRecipe', 'plantAllRecipe'] },
  { skillId: 'melvorD:Township', className: 'Township', cls: () => Township, when: 'always',
    methods: ['buildBuilding', 'repairAllBuildings', 'repairAllBuildingsInCurrentBiome', 'repairAllBuildingsFromStorageType'],
    quiet: ['repairBuilding', 'processConversionToTownship', 'processConversionFromTownship'] },
  // The Township trader moves goods between the bank and the town: refused when its confirm dialog would open, so the
  // player never confirms a conversion that is then refused. The conversions above are the quiet backstop.
  { skillId: 'melvorD:Township', className: 'TownshipConversionElement', cls: () => TownshipConversionElement, when: 'always',
    methods: ['createConvertToSwal', 'createConvertFromSwal'] },
  { skillId: 'melvorItA:Harvesting', className: 'Harvesting', cls: () => Harvesting, methods: ['onVeinClick'], when: 'inactive' },
];

/** Worker Folks' Hiring skill and its hire purchases (shop ids `worker_folks:Hire_<Tier>`). */
const HIRING_ID = 'worker_folks:Hiring';
const HIRE_PURCHASE_PREFIX = 'worker_folks:Hire_';
/** What to tell a player who knows of no place yet: surveying is how the map opens up. */
const SURVEY_HINT = 'Survey the hexes around you in Cartography to find';


export function install(ctx, { state, rules, terrainMod, log }) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** Map colours are picked for tinting hexes; for text on the dark modal, lift dark ones towards white. */
  const textColour = (css) => {
    const m = /^#([0-9a-f]{6})$/i.exec(css ?? '');
    if (m === null) return css ?? 'inherit';
    const n = parseInt(m[1], 16);
    const ch = (shift) => (n >> shift) & 0xff;
    const lum = 0.299 * ch(16) + 0.587 * ch(8) + 0.114 * ch(0);
    const mix = lum < 110 ? 0.45 : lum < 160 ? 0.25 : 0;
    const lift = (v) => Math.round(v + (255 - v) * mix).toString(16).padStart(2, '0');
    return `#${lift(ch(16))}${lift(ch(8))}${lift(ch(0))}`;
  };
  const coloured = (label, css) => ({ text: label, html: `<b style="color:${textColour(css)}">${esc(label)}</b>` });
  const biome = (cls) => { const info = terrainMod.CLASS_INFO[cls]; return coloured(info?.label ?? cls, info?.css); };
  const feature = (f) => { const info = terrainMod.FEATURE_INFO[f]; return coloured(info?.label ?? f, info?.css); };
  const placeName = (name) => coloured(terrainMod.areaLabel(name));
  const join = (parts, sep = ' or ') => ({ text: parts.map((p) => p.text).join(sep), html: parts.map((p) => p.html).join(sep) });

  /** What the rule asks for, e.g. "Forest or Trees", each term coloured. */
  const need = (skillId) => {
    const terms = rules.ruleTerms(skillId);
    if (terms.land) return coloured(rules.ruleNoun(skillId));
    const parts = [...terms.classes.map(biome), ...terms.features.map(feature), ...terms.pois.map(placeName), ...terms.areas.map(placeName)];
    return parts.length === 0 ? coloured(rules.ruleNoun(skillId)) : join(parts);
  };
  /** Where the player is: biome, or "Cloud" when the hex is under cloud. */
  const here = (rec) => (rec.cloud === true ? coloured(terrainMod.CLOUD_INFO.label, terrainMod.CLOUD_INFO.css) : biome(rec.t));

  /** Human name of the POI on a table hex, via the live map when it is discovered; the raw id otherwise. */
  const poiName = (rec) => {
    try {
      const hex = game.cartography?.activeMap?.getHex(new HexCoords(rec.q, rec.r));
      const poi = hex?.pointOfInterest;
      if (poi !== undefined && poi.isDiscovered) return poi.name;
    } catch {}
    return terrainMod.areaLabel(rec.poi);
  };
  const whereIs = (pos, hex, distance) => {
    const dir = terrainMod.directionLabel(pos, hex);
    const place = hex.poi ? ` (${poiName(hex)})` : hex.area ? ` (${terrainMod.areaLabel(hex.area)})` : '';
    return `${distance} hex${distance === 1 ? '' : 'es'} ${dir}${place}`;
  };
  const compassLine = (reading) => state.compass?.describe(reading);
  const modal = (title, icon, lines, { withMap = true } = {}) => {
    try {
      const page = game.pages.getObjectByID('melvorAoD:Cartography');
      const img = icon ? `<img class="skill-icon-sm mr-2" src="${icon}">` : '';
      SwalLocale.fire({
        title,
        html: `<div class="text-left voyage-locked">${img}<div class="voyage-locked-lines">${lines.map((l) => `<div>${l.html}</div>`).join('')}</div></div>`,
        icon: 'warning',
        showCancelButton: withMap,
        confirmButtonText: withMap ? 'Go to map' : 'OK',
        cancelButtonText: 'Stay',
        customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass({ popup: 'voyage-ui' }) : { popup: 'voyage-ui' },
      }).then((result) => { if (withMap && result.isConfirmed && page !== undefined) changePage(page); });
    } catch (e) {
      log('modal failed, using notification', e);
      try { game.notifications.createErrorNotification('voyage:locked', lines.map((l) => l.text).join(' ')); } catch {}
    }
  };

  // ---------------------------------------------------------------------------------------------------- skills
  const on = () => state.active();

  /** undefined when the skill may start here (or the gate is off); otherwise the position and its record. */
  const lockedHere = (skillId) => {
    if (!on() || !rules.isGated(skillId)) return undefined;
    const pos = state.position();
    if (pos === undefined) return undefined;
    const rec = state.recordAt(pos);
    if (rules.allowedAt(skillId, rec, state.ruleOpts())) return undefined;
    return { pos, rec };
  };

  const describe = (skill, skillId, { pos, rec }) => {
    const n = need(skillId);
    const h = here(rec);
    const name = rules.ruleLabel(skillId, skill?.name ?? skillId);
    const lines = [{ text: `${name} needs ${n.text}. You are on ${h.text}.`, html: `${esc(name)} needs ${n.html}. You are on ${h.html}.` }];
    const near = state.nearestFor(skillId, pos);
    if (near !== undefined) {
      const terms = rules.ruleTerms(skillId);
      const match = terms.classes.includes(near.hex.t) ? biome(near.hex.t)
        : terms.features.some((f) => terrainMod.hasFeature(near.hex, f)) ? feature(terms.features.find((f) => terrainMod.hasFeature(near.hex, f)))
          : near.hex.poi && terms.pois.includes(near.hex.poi) ? placeName(near.hex.poi)
            : near.hex.area && terms.areas.includes(near.hex.area) ? placeName(near.hex.area) : coloured(rules.ruleNoun(skillId));
      const where = whereIs(pos, near.hex, near.distance);
      lines.push({ text: `Nearest ${match.text}: ${where}.`, html: `Nearest ${match.html}: ${esc(where)}.` });
    } else {
      lines.push({ text: `You know of no ${n.text} yet. ${SURVEY_HINT} one.`, html: `You know of no ${n.html} yet. ${SURVEY_HINT} one.` });
      // The compass only speaks when the map has nothing to say: a known place already gives distance and way.
      const compass = compassLine(state.compass?.readingFor(skillId, pos));
      if (compass !== undefined) lines.push(compass);
    }
    return { name, lines };
  };

  const showLocked = (skill, skillId, locked) => {
    const d = describe(skill, skillId, locked);
    log(`refused ${skillId} at (${locked.pos.q},${locked.pos.r}) ${locked.rec.t}`);
    modal(`${d.name} is locked here`, skill?.media, d.lines);
  };

  // Layer 1: entry points, checked before the selection changes.
  for (const ep of ENTRY_POINTS) {
    let cls;
    try { cls = ep.cls(); } catch (e) {
      if (e instanceof ReferenceError) { log(`entry point ${ep.className} absent (expansion not loaded)`); continue; }
      cls = undefined;
    }
    const wrap = (method, quiet) => {
      if (typeof cls !== 'function' || typeof cls.prototype?.[method] !== 'function') {
        console.warn(`[Voyage] entry point ${ep.className}.${method} not found; gated by the backstop only`);
        return;
      }
      ctx.patch(cls, method).replace(function (original, ...args) {
        try {
          const id = ep.skillId ?? this.id;
          if (rules.isGated(id) && (ep.when === 'always' || !this.isActive)) {
            const locked = lockedHere(id);
            if (locked !== undefined) {
              if (!quiet) showLocked(ep.skillId !== undefined ? game.skills.getObjectByID(id) ?? this : this, id, locked);
              return undefined;
            }
          }
        } catch (e) {
          console.error('[Voyage] entry gate failed open', e);
        }
        return original(...args);
      });
    };
    ep.methods.forEach((m) => wrap(m, false));
    (ep.quiet ?? []).forEach((m) => wrap(m, true));
    log(`entry points ${ep.className}.${[...ep.methods, ...(ep.quiet ?? [])].join('/')} wrapped`);
  }

  // Rate: a gated skill running on a penalised hex takes proportionally longer per action. Skill.modifyInterval is
  // the one place every skill's base interval passes through (timer, skill page, offline replay).
  const rawRate = (skillId) => {
    try {
      if (!on() || !rules.isGated(skillId)) return 1;
      return rules.rateAt(skillId, state.recordAt(state.position()), state.ruleOpts());
    } catch { return 1; }
  };
  const intervalRate = (skillId) => { const r = rawRate(skillId); return r > 0 && r < 1 ? r : 1; };
  const lastRate = new Map();
  ctx.patch(Skill, 'modifyInterval').after(function (interval) {
    const rate = intervalRate(this.id);
    if (lastRate.get(this.id) !== rate) { lastRate.set(this.id, rate); log(`${this.id} interval rate ${rate} (${interval} ms -> ${Math.round(interval / rate)} ms)`); }
    return rate === 1 ? undefined : Math.round(interval / rate);
  });
  /** Rate 0..1 of a gated skill on the player's hex (0 = locked); 1 when the gate is off. */
  state.rateAt = rawRate;

  // Skill pages cache their displayed intervals; refresh the gated ones when the position or the rules change.
  const refreshRates = () => {
    for (const id of rules.gatedSkillIds()) {
      try {
        const rq = game.skills.getObjectByID(id)?.renderQueue;
        if (rq === undefined) continue;
        if ('treeRates' in rq) rq.treeRates = true;
        if ('rates' in rq) rq.rates = true;
        if ('progressBar' in rq) rq.progressBar = true;
      } catch {}
    }
  };

  // Sidebar: a gated skill that is locked here is dimmed in the Non-Combat list (hover shows why).
  const dimSidebar = () => {
    try {
      if (typeof sidebar === 'undefined') return;
      // sidebar.category(id) CREATES a missing category, so walk the existing ones instead.
      for (const cat of sidebar.categories()) {
        if (cat.id === 'Combat') continue;
        for (const item of cat.items()) {
          const id = item.id;
          if (!rules.isGated(id) || !item.rootEl) continue;
          const locked = lockedHere(id) !== undefined;
          item.rootEl.classList.toggle('voyage-dim', locked);
          item.rootEl.title = locked ? `Locked here: needs ${need(id).text}` : '';
        }
      }
    } catch (e) { log('sidebar dim failed', e); }
  };

  // ---------------------------------------------------------------------------------------------------- combat
  const warnedUnplaced = new Set();
  /** undefined when the area may be fought from here; otherwise the position and the nearest tagged hex. */
  const combatLocked = (area) => {
    if (!on() || !state.settings.combat() || area === undefined || typeof area.id !== 'string') return undefined;
    try { if (!game.tutorial.complete) return undefined; } catch {}
    const pos = state.position();
    const res = rules.combatAllowedAt(state.terrain.placesFor(area.id), pos);
    if (res.unplaced) {
      if (!warnedUnplaced.has(area.id)) { warnedUnplaced.add(area.id); log(`area ${area.id} is not placed on the map: allowed anywhere`); }
      return undefined;
    }
    return res.allowed ? undefined : { pos, nearest: res.nearest };
  };
  const showLockedArea = (area, { pos, nearest }) => {
    const name = area.name ?? area.id;
    const lines = [{ text: `You must stand on ${name} or next to it to fight there.`, html: `You must stand on <b>${esc(name)}</b> or next to it to fight there.` }];
    if (nearest !== undefined && state.knowledge?.isKnown(nearest.hex)) {
      const where = whereIs(pos, nearest.hex, nearest.distance);
      lines.push({ text: `It is ${where}.`, html: `It is ${esc(where)}.` });
    } else {
      lines.push({ text: `You do not know where ${name} is yet. ${SURVEY_HINT} it.`, html: `You do not know where <b>${esc(name)}</b> is yet. ${SURVEY_HINT} it.` });
      const compass = compassLine(state.compass?.readingTo(state.terrain.placesFor(area.id), pos));
      if (compass !== undefined) lines.push(compass);
    }
    log(`refused combat in ${area.id} at (${pos?.q},${pos?.r})`);
    modal(`${name} is out of reach`, area.media, lines);
  };
  ctx.patch(CombatManager, 'checkAreaEntryRequirements').replace(function (original, area) {
    try {
      const locked = combatLocked(area);
      if (locked !== undefined) { showLockedArea(area, locked); return false; }
    } catch (e) { console.error('[Voyage] combat gate failed open', e); }
    return original(area);
  });

  // ---------------------------------------------------------------------------------------------------- trade
  const tradeLocked = () => {
    if (!on() || !state.settings.trade()) return undefined;
    try { if (!game.tutorial.complete) return undefined; } catch {}
    const pos = state.position();
    const rec = state.recordAt(pos);
    if (rec === undefined) return undefined;
    if (rules.tradeAllowedAt(rec, state.terrain.neighbours(rec.q, rec.r))) return undefined;
    return { pos, rec };
  };
  const tradeCandidates = () => {
    const seen = new Set();
    const out = [];
    for (const f of rules.TRADE_FEATURES) for (const rec of state.terrain.withFeature(f)) if (!seen.has(rec)) { seen.add(rec); out.push(rec); }
    return out;
  };
  const showNoTrade = (what, { pos }) => {
    const lines = [{ text: `You can ${what} only in a town, port or market, or next to one.`, html: `You can ${esc(what)} only in a <b>town</b>, <b>port</b> or <b>market</b>, or next to one.` }];
    const near = terrainMod.nearestIn(tradeCandidates(), pos, (rec) => state.knowledge?.isKnown(rec) !== false);
    if (near !== undefined) {
      const where = whereIs(pos, near.hex, near.distance);
      lines.push({ text: `Nearest known trading place: ${where}.`, html: `Nearest known trading place: ${esc(where)}.` });
    } else {
      lines.push({ text: `You know of no trading place yet. ${SURVEY_HINT} one.`, html: `You know of no trading place yet. ${SURVEY_HINT} one.` });
      const compass = compassLine(state.compass?.readingTo(tradeCandidates(), pos));
      if (compass !== undefined) lines.push(compass);
    }
    log(`refused trade (${what}) at (${pos?.q},${pos?.r})`);
    modal('No one to trade with here', undefined, lines);
  };
  const tradeGate = (cls, method, what, quiet = false) => {
    if (typeof cls !== 'function' || typeof cls.prototype?.[method] !== 'function') { console.warn(`[Voyage] trade entry ${method} not found`); return; }
    ctx.patch(cls, method).replace(function (original, ...args) {
      try {
        const locked = tradeLocked();
        if (locked !== undefined) {
          // Selling while stranded: the wandering trader (src/trader.mjs) buys at half price.
          if (what === 'sell' && state.trader?.present()) return original(...args);
          if (what === 'sell' && !quiet && state.trader?.offer(() => original(...args))) return undefined;
          if (!quiet) showNoTrade(what, locked);
          return undefined;
        }
      } catch (e) { console.error('[Voyage] trade gate failed open', e); }
      return original(...args);
    });
  };
  tradeGate(Bank, 'sellItemOnClick', 'sell');
  tradeGate(Bank, 'sellUnlockedItemsOnClick', 'sell');
  tradeGate(Bank, 'processSellSelectedItems', 'sell');
  tradeGate(Bank, 'processItemSale', 'sell', true); // backstop for any other sale path
  tradeGate(Shop, 'buyItemOnClick', 'buy');
  // Registered after the trade gate, so it wraps it and runs first: a hire is a staff change before it is a purchase.
  ctx.patch(Shop, 'buyItemOnClick').replace(function (original, purchase, ...rest) {
    try {
      if (typeof purchase?.id === 'string' && purchase.id.startsWith(HIRE_PURCHASE_PREFIX)) {
        const locked = lockedHere(HIRING_ID);
        if (locked !== undefined) { showLocked(game.skills.getObjectByID(HIRING_ID), HIRING_ID, locked); return undefined; }
      }
    } catch (e) { console.error('[Voyage] hiring gate failed open', e); }
    return original(purchase, ...rest);
  });
  state.tradeLocked = () => tradeLocked() !== undefined;
  /** True when the area cannot be fought from the player's hex (the trader's GP-source check reads it). */
  state.combatLocked = (area) => combatLocked(area) !== undefined;

  // ---------------------------------------------------------------------------------------------------- hiring
  // Worker Folks may load after Voyage, so its class is looked up once the character (and every mod) is in.
  ctx.onCharacterLoaded(() => {
    try {
      const hiring = game.skills.getObjectByID(HIRING_ID);
      if (hiring === undefined) return;
      const cls = hiring.constructor;
      for (const method of ['promote', 'fire']) {
        if (typeof cls.prototype?.[method] !== 'function') { console.warn(`[Voyage] Hiring.${method} not found; not gated`); continue; }
        ctx.patch(cls, method).replace(function (original, ...args) {
          try {
            const locked = lockedHere(HIRING_ID);
            if (locked !== undefined) { showLocked(this, HIRING_ID, locked); return undefined; }
          } catch (e) { console.error('[Voyage] hiring gate failed open', e); }
          return original(...args);
        });
      }
      log('Worker Folks Hiring: hire purchases, promote and fire follow the Township rule');
    } catch (e) { log('hiring gate skipped', e); }
  });

  // ---------------------------------------------------------------------------------------------------- moving
  // A gated skill (or fight) that does not fit the current hex stops, with a notice. Checked on every move
  // (WorldMap.setPlayerPosition is where travel, portals and the dev teleport land; the 'travel' event fires BEFORE the
  // position changes), and whenever the rules tighten: a settings change (rules back on, Strict, combat switch), the
  // tutorial ending, and the first interface load. Without the last three, a skill started while the rules were off
  // kept running when they came back on.
  const stopWhatDoesNotFit = (cause) => {
    try {
      if (!on()) return;
      const rec = state.recordAt(state.position());
      for (const id of rules.gatedSkillIds()) {
        const skill = game.skills.getObjectByID(id);
        if (skill === undefined || !skill.isActive || game.activeAction !== skill) continue;
        if (rules.allowedAt(id, rec, state.ruleOpts())) continue;
        if (skill.stop()) {
          log(`stopped ${id} (${cause}) at (${rec?.q},${rec?.r}) ${rec?.t}`);
          try { game.notifications.createErrorNotification('voyage:stopped', `${rules.ruleLabel(id, skill.name)} stopped: it does not work here.`); } catch {}
        }
      }
      const cm = game.combat;
      if (cm?.isActive && cm.selectedArea !== undefined && combatLocked(cm.selectedArea) !== undefined) {
        const name = cm.selectedArea.name ?? cm.selectedArea.id;
        if (cm.stop()) {
          log(`stopped combat in ${name} (${cause})`);
          const text = cause === 'move' ? `You left ${name}: the fight is over.` : `${name} is out of reach from here: the fight is over.`;
          try { game.notifications.createErrorNotification('voyage:stopped', text); } catch {}
        }
      }
    } catch (e) { console.error('[Voyage] stop check failed open', e); }
  };
  const onMoved = () => {
    stopWhatDoesNotFit('move');
    refreshRates();
    dimSidebar();
  };
  ctx.patch(WorldMap, 'setPlayerPosition').after(function () {
    try { if (game.cartography?.activeMap === this) setTimeout(onMoved, 0); } catch {}
  });
  // Deferred: settings handlers run inside the loader's onChange, before it stores the value.
  state.listeners.push(() => setTimeout(() => stopWhatDoesNotFit('rules'), 0), refreshRates, dimSidebar);
  ctx.onInterfaceReady(() => setTimeout(() => { stopWhatDoesNotFit('load'); dimSidebar(); }, 0));
  // The gates switch on when the tutorial ends (state.active). The entry gates read that live, but the sidebar and
  // the skill pages only redraw on a move or a settings change, so finishing the tutorial must trigger one.
  try {
    ctx.patch(Tutorial, 'completeTutorial').after(() => { setTimeout(() => state.onSettingsChange(), 0); });
  } catch (e) { log('tutorial hook skipped', e); }

  // Layer 2: the universal backstop.
  ctx.patch(Game, 'idleChecker').replace(function (original, action) {
    try {
      const skillId = action?.id;
      if (typeof skillId !== 'string') return original(action);
      const locked = lockedHere(skillId);
      if (locked === undefined) return original(action);
      showLocked(action, skillId, locked);
      if (ENTRY_POINTS.some((ep) => ep.skillId === skillId)) console.warn(`[Voyage] backstop refused ${skillId}: a start path bypassed its entry point`);
      return true;
    } catch (e) {
      console.error('[Voyage] gate failed open', e);
      return original(action);
    }
  });
}
