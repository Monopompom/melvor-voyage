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
//     chains the patches. Since phase 6b a start Worker Folks gives a Folk is judged where that Folk stands
//     (`lockedFor`, `zoneLockedFor`, the rate), with a toast instead of the lock popup.
// Combat: CombatManager.checkAreaEntryRequirements, called by every area/dungeon/stronghold/depth selection.
// Trade: the bank's sell entries and Shop.buyItemOnClick. The Township trader is not trade: it follows
// the Township rule (a town or port), decided 15 Oct 2026.
// Hiring (Worker Folks, optional): hires follow the Township rule; since phase 6b every Folk has a place, and
// Promote, Fire, Settle, picking it for a skill and its gear need you within 1 hex of it (guards through its API).

/**
 * Skill UI methods that start the skill. `cls` is a thunk: game classes are top-level `class` declarations, global
 * bindings but NOT properties of globalThis, and a ReferenceError means the class is absent (expansion not loaded).
 * `when`: 'inactive' refuses only when the skill is not running (a click on a running skill stops it, which must
 * always work); 'always' refuses every call (skills without an active state: Farming, Township). `quiet` methods
 * are refused without a modal (they are called in loops by the listed ones).
 */
// Modal buttons: confirm green, cancel blue outline (the game's default cancel is red; grey means disabled).
const SWAL_CLASS = { popup: 'voyage-ui', confirmButton: 'btn btn-success m-1', cancelButton: 'btn btn-outline-info m-1' };

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
/** The trade refusal sentence per trade kind (languages/en.json). */
const TRADE_ONLY_KEYS = { sell: 'MOD_VOY_GATE_TRADE_ONLY_SELL', buy: 'MOD_VOY_GATE_TRADE_ONLY_BUY' };

export function install(ctx, { state, rules, terrainMod, zones, helpLayout, log }) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** Map colours are picked for tinting hexes; for text on the dark modal, lift dark ones towards white. On the
   *  Light theme's white modal darken them instead, step by step, until they reach 4.5:1 on white. */
  const textColour = (css) => {
    const m = /^#([0-9a-f]{6})$/i.exec(css ?? '');
    if (m === null) return css ?? 'inherit';
    const n = parseInt(m[1], 16);
    const ch = (shift) => (n >> shift) & 0xff;
    const hex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
    const rgb = [ch(16), ch(8), ch(0)];
    if (!document.body.classList.contains('darkMode')) {
      const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      const onWhite = (c) => 1.05 / (0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]) + 0.05);
      let c = rgb;
      for (let k = 1; onWhite(c) < 4.5 && k <= 20; k++) c = rgb.map((v) => v * (1 - k * 0.05));
      return hex(c);
    }
    const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    const mix = lum < 110 ? 0.55 : lum < 160 ? 0.4 : lum < 200 ? 0.2 : 0; // 4.5:1 on the dark modal for every map colour (.308, C2-05)
    return hex(rgb.map((v) => v + (255 - v) * mix));
  };
  const coloured = (label, css) => ({ text: label, html: `<b style="color:${textColour(css)}">${esc(label)}</b>` });
  const biome = (cls) => { const info = terrainMod.CLASS_INFO[cls]; return coloured(info === undefined ? cls : getLangString(terrainMod.classKey(cls)), info?.css); };
  const feature = (f) => { const info = terrainMod.FEATURE_INFO[f]; return coloured(info === undefined ? f : getLangString(terrainMod.featureKey(f)), info?.css); };
  const placeName = (name) => coloured(terrainMod.areaLabel(name));
  const ruleNoun = (skillId) => getLangString(rules.ruleNounKey(skillId));
  /** The skill's name as the rules show it (Magic is "Alt. Magic"), else the game's own name. */
  const skillLabel = (skillId, fallback) => { const k = rules.ruleLabelKey(skillId); return k === undefined ? fallback : getLangString(k); };
  const join = (list) => {
    const sep = getLangString('MOD_VOY_GATE_LIST_OR');
    // One name once: Mining's Snowlands-with-mountain combo adds a "mountain" feature labelled like the Mountain
    // class, so the lock popup read "... or Rock or Mountain" after "Mountain or Highlands" (16 Oct 2026).
    const parts = list.filter((p, i) => list.findIndex((o) => o.text === p.text) === i);
    return { text: parts.map((p) => p.text).join(sep), html: parts.map((p) => p.html).join(sep) };
  };
  /**
   * One modal line from a language key: `vars` are HTML-safe (escaped or coloured() html); the plain text for the
   * notification fallback is the same line with the tags stripped.
   */
  const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const line = (key, vars = {}) => {
    const html = templateLangString(key, vars);
    return { text: unesc(html.replace(/<[^>]*>/g, '')), html };
  };

  /** What the rule asks for, e.g. "Forest or Trees", each term coloured. */
  const need = (skillId) => {
    const terms = rules.ruleTerms(skillId);
    if (terms.land) return coloured(ruleNoun(skillId));
    const parts = [...terms.classes.map(biome), ...terms.features.map(feature), ...terms.pois.map(placeName), ...terms.areas.map(placeName)];
    // No more than three in a sentence (.308, scan C-14/C2-08): the rest is a count, the journal's Guide has the list.
    if (parts.length === 0) return coloured(ruleNoun(skillId));
    if (parts.length <= 3) return join(parts);
    // Still a { text, html } pair: a plain string here printed a raw "${need}" in the lock popup (Folks scan A-39, .311).
    const first = join(parts.slice(0, 3));
    const more = templateLangString('MOD_VOY_GATE_NEEDS_MORE', { n: `${parts.length - 3}` });
    return { text: `${first.text}${more}`, html: `${first.html}${esc(more)}` };
  };
  /** Where the player is: biome, or "Cloud" when the hex is under cloud. */
  const here = (rec) => (rec.cloud === true ? coloured(getLangString(terrainMod.CLOUD_KEY), terrainMod.CLOUD_INFO.css) : biome(rec.t));

  /** Human name of the POI on a table hex, via the live map when it is discovered; the raw id otherwise. */
  const poiName = (rec) => {
    try {
      const hex = game.cartography?.activeMap?.getHex(new HexCoords(rec.q, rec.r));
      const poi = hex?.pointOfInterest;
      if (poi !== undefined && poi.isDiscovered) return poi.name;
    } catch {}
    return terrainMod.areaLabel(rec.poi);
  };
  /** HTML: the place's name is escaped and bold, so callers pass it as is (build .315: escaped again, the tags showed). */
  const whereIs = (pos, hex, distance) => {
    const dir = getLangString(`MOD_VOY_DIR_SHORT_${terrainMod.directionLabel(pos, hex)}`);
    const name = hex.poi ? poiName(hex) : hex.area ? terrainMod.areaLabel(hex.area) : undefined;
    const place = name === undefined ? '' : templateLangString('MOD_VOY_GATE_WHERE_PLACE', { name: `<b>${esc(name)}</b>` }); // a name in bold (.308, C2-07)
    const hexes = templateLangString(distance === 1 ? 'MOD_VOY_HEXES_ONE' : 'MOD_VOY_HEXES_MANY', { count: `${distance}` });
    return templateLangString('MOD_VOY_GATE_WHERE', { hexes, dir, place });
  };
  const compassLine = (reading) => state.compass?.describe(reading);
  /**
   * `icon`: a picture that isn't a skill's (an action, a combat area). A skill's own icon comes with its name. Message popup layout (build .94): one picture on top, the action or area's when there is one, else the
   * warning sign; never both. `guide`: the Captain's Journal page this rule is taught on (phase 4), linked in the
   * footer and written the first time. `plan`: a function giving Plan a voyage's target (build .119):
   * a third, blue outline button that opens the planner on it. Shown only when the planner is there and the target
   * has somewhere known to go.
   */
  const modal = (title, icon, lines, { withMap = true, guide, plan } = {}) => {
    try {
      const page = game.pages.getObjectByID('melvorAoD:Cartography');
      let target;
      try { target = plan?.(); } catch (e) { log('plan target failed', e); }
      const planned = withMap && state.planner !== undefined && target !== undefined && target.hexes.length > 0;
      const fire = (params) => SwalLocale.fire(params).then((result) => {
        if (withMap && result.isConfirmed) state.openPage(page);
        else if (planned && result.isDenied) state.planner.planTo(target);
      });
      const params = {
        didRender: state.popupDidRender,
        title,
        html: helpLayout.msgHtml(lines.map((l) => l.html)),
        ...(icon ? { imageUrl: icon, ...helpLayout.MSG_IMAGE } : { icon: 'warning' }),
        showCancelButton: withMap,
        confirmButtonText: getLangString(withMap ? 'MOD_VOY_GATE_BUTTON_MAP' : 'MOD_VOY_BUTTON_OK'),
        cancelButtonText: getLangString('MOD_VOY_GATE_BUTTON_STAY'),
        ...(planned ? { showDenyButton: true, denyButtonText: getLangString('MOD_VOY_PLAN_BUTTON') } : {}),
        // "Go to map" is filled blue, Stay blue outline (the user, 16 Oct 2026: "Only Go to map"; it was outline since .86);
        // a plain OK stays green.
        customClass: (() => { const c = withMap ? { ...SWAL_CLASS, confirmButton: 'btn btn-info m-1', denyButton: 'btn btn-outline-info m-1' } : SWAL_CLASS; return typeof createSwalCustomClass === 'function' ? createSwalCustomClass(c) : c; })(),
      };
      // The footer is asked for on every showing: "A new page" the first time, "Read more" after "Back to the lock".
      const show = () => {
        const footer = guide === undefined ? undefined : state.journal?.footer(guide, show);
        fire(footer !== undefined ? { ...params, footer } : params);
      };
      show();
    } catch (e) {
      log('modal failed, using notification', e);
      try { game.notifications.createErrorNotification('voyage:locked', lines.map((l) => l.text).join(' ')); } catch {}
    }
  };

  // ---------------------------------------------------------------------------------------------------- skills
  const on = () => state.active();

  /** undefined when the skill may start here (or the gate is off); otherwise the position and its record. */
  const lockedAt = (skillId, pos) => {
    if (!on() || !rules.isGated(skillId) || pos === undefined || pos === null) return undefined;
    const rec = state.recordAt(pos);
    if (rules.allowedAt(skillId, rec, state.ruleOpts())) return undefined;
    return { pos, rec };
  };
  const lockedHere = (skillId) => lockedAt(skillId, state.position());
  // Phase 6b: the Folk a start of this skill goes to (Worker Folks' API), or undefined when it is yours.
  const folkActor = (skillId) => {
    if (!state.folksGuarded) return undefined;
    try { return state.folksApi?.()?.workerOf?.(skillId); } catch (e) { log('folk actor failed', e); return undefined; }
  };
  /** lockedHere, or, for a start that goes to a Folk, locked where it stands ({ pos, rec, folk }); no place is free. */
  const lockedFor = (skillId) => {
    const folk = folkActor(skillId);
    if (folk === undefined) return lockedHere(skillId);
    const locked = lockedAt(skillId, folk.place);
    return locked === undefined ? undefined : { ...locked, folk };
  };
  /** A Folk's refusal is a toast with the reason, never the lock popup (its own Worker box says it before the click). */
  const toastFolk = (text) => { try { game.notifications.createErrorNotification('voyage:folk', text); } catch {} };
  const folkWorkText = (skillId, { rec, folk }) => line('MOD_VOY_FOLK_WORK_NEEDS', {
    name: esc(folk.name), here: here(rec).html, skill: esc(skillLabel(skillId, game.skills.getObjectByID(skillId)?.name ?? skillId)), need: need(skillId).html,
  }).text;
  /** True when the gate refuses a gated skill on the player's hex (the ship's clock leaves it to the gate). */
  state.skillLockedHere = (skillId) => lockedHere(skillId) !== undefined;

  const describe = (skill, skillId, { pos, rec }) => {
    const n = need(skillId);
    const h = here(rec);
    const name = skillLabel(skillId, skill?.name ?? skillId);
    const lines = [line('MOD_VOY_GATE_NEEDS', { name: esc(name), need: n.html, here: h.html })];
    const near = state.nearestFor(skillId, pos);
    if (near !== undefined) {
      const terms = rules.ruleTerms(skillId);
      const matchOf = (hex) => (terms.classes.includes(hex.t) ? biome(hex.t)
        : terms.features.some((f) => terrainMod.hasFeature(hex, f)) ? feature(terms.features.find((f) => terrainMod.hasFeature(hex, f)))
          : hex.poi && terms.pois.includes(hex.poi) ? placeName(hex.poi)
            : hex.area && terms.areas.includes(hex.area) ? placeName(hex.area) : undefined);
      const match = matchOf(near.hex);
      const where = whereIs(pos, near.hex, near.distance);
      if (match !== undefined) lines.push(line('MOD_VOY_GATE_NEAREST', { match: match.html, where }));
      else {
        // The nearest hex works by grace: name what is next door (phase 2 re-run, 16 Oct 2026: the noun made "Nearest
        // a town or port: 2 hexes SW").
        const from = rules.graceFrom(skillId, near.hex, state.ruleOpts()).map(matchOf).find((m) => m !== undefined);
        lines.push(from !== undefined
          ? line('MOD_VOY_GATE_NEAREST_GRACE', { match: from.html, where })
          : line('MOD_VOY_GATE_NEAREST_ANY', { where }));
      }
    } else {
      lines.push(line('MOD_VOY_GATE_NONE_KNOWN', { need: n.html }));
      // The compass only speaks when the map has nothing to say: a known place already gives distance and way.
      const compass = compassLine(state.compass?.readingFor(skillId, pos));
      if (compass !== undefined) lines.push(compass);
    }
    return { name, lines };
  };

  /** The action a skill's entry point was about to start, for Plan a voyage's "on arrival" (build .119). */
  const actionOfCall = (skillId, self, args) => {
    try {
      switch (skillId) {
        case 'melvorD:Woodcutting': case 'melvorD:Mining': return args[0];
        case 'melvorD:Fishing': return self.selectedAreaFish?.get(args[0]);
        case 'melvorD:Thieving': return args[1];
        default: return undefined;
      }
    } catch { return undefined; }
  };
  const showLocked = (skill, skillId, locked, args = []) => {
    const d = describe(skill, skillId, locked);
    log(`refused ${skillId} at (${locked.pos.q},${locked.pos.r}) ${locked.rec.t}`);
    const plan = () => {
      const near = state.nearestFor(skillId, locked.pos);
      return state.planner?.forAction(skillId, actionOfCall(skillId, skill, args), near === undefined ? [] : [near.hex]);
    };
    modal(templateLangString('MOD_VOY_GATE_LOCKED_TITLE', { name: d.name }), undefined, d.lines, { guide: 'terrain', plan });
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
            const locked = lockedFor(id);
            if (locked !== undefined) {
              if (quiet) return undefined;
              if (locked.folk !== undefined) toastFolk(folkWorkText(id, locked));
              else showLocked(ep.skillId !== undefined ? game.skills.getObjectByID(id) ?? this : this, id, locked, args);
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
      // A Folk's skill runs at the rate of the Folk's hex (6b); one with no place yet at full rate.
      const folk = folkActor(skillId);
      if (folk !== undefined && folk.place === null) return 1;
      return rules.rateAt(skillId, state.recordAt(folk === undefined ? state.position() : folk.place), state.ruleOpts());
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

  /** Why a zoned skill has nothing for you on this hex ('' when something fits, or it is not zoned): the panel's words. */
  const levelLockTip = (id) => {
    try {
      if (!zonesOn() || state.zoneTable?.skills?.[id] === undefined || state.zoneActionsHere(id).length > 0) return '';
      const skill = game.skills.getObjectByID(id);
      const key = rules.ruleLabelKey(id);
      const name = key !== undefined ? getLangString(key) : skill?.name ?? id;
      if (state.zonedUngated?.()?.includes(id)) return templateLangString('MOD_VOY_PANEL_SKY_NONE', { skill: name });
      const later = state.zoneActionsHere(id, { later: true });
      if (later.length === 0) return templateLangString('MOD_VOY_PANEL_ZONE_NEVER', { skill: name });
      const first = later[0].level ?? 1;
      return templateLangString('MOD_VOY_PANEL_ZONE_LATER', { skill: name, level: `${first}`, names: later.filter((a) => (a.level ?? 1) === first).map((a) => a.name).join(', ') });
    } catch { return ''; }
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
          const zonedOnly = state.zonedUngated?.()?.includes(id) === true;
          if ((!rules.isGated(id) && !zonedOnly) || !item.rootEl) continue;
          const locked = !zonedOnly && lockedHere(id) !== undefined;
          // As the Here panel (build .280, the user: "menu bar skill is drawn as active"): a zoned skill with nothing
          // here for your level is locked too, its tooltip the panel's ("Fishing is locked here until level 20: …").
          const zoneTip = locked ? '' : levelLockTip(id);
          item.rootEl.classList.toggle('voyage-dim', locked || zoneTip !== '');
          const tip = locked ? templateLangString('MOD_VOY_GATE_SIDEBAR_LOCKED', { need: need(id).text }) : zoneTip;
          // Melvor's tooltip, to the right of the sidebar (build .161).
          if (state.tips !== undefined) state.tips.set(item.rootEl, tip, { placement: 'right' }); else item.rootEl.title = tip;
        }
      }
    } catch (e) { log('sidebar dim failed', e); }
  };

  // ---------------------------------------------------------------------------------------------------- zones
  // Resource zones (setting "Resource zones"): an ore, tree, fish, crop or thieving target works only
  // where its zone takes the hex, on top of the skill's own rule above. The table is data/zones.json (state.zoneTable);
  // actions it does not list follow the skill rule alone.
  const ASTROLOGY = 'melvorD:Astrology';
  const zoneIndex = new Map(); // action id -> { skillId, zone }
  for (const [skillId, s] of Object.entries(state.zoneTable?.skills ?? {})) {
    for (const [id, zone] of Object.entries(s.actions ?? {})) zoneIndex.set(id, { skillId, zone });
  }
  const zonesOn = () => zones !== undefined && on() && state.settings.zones();
  const nbOf = (rec) => state.terrain.neighbours(rec.q, rec.r); // zone terms read the land around (geography), not grace
  /** The zone takes the hex, or (a grace hex) one of the full-rate neighbours that lift it (src/zones.mjs). */
  const allowsHere = (z, rec) => zones.zoneAllowsWithGrace(z.zone, rec, nbOf, rules.graceFrom(z.skillId, rec, state.ruleOpts()));
  /** undefined when the action may run here (or zones are off); otherwise { pos, rec, skillId, zone }. */
  const zoneLockedAt = (action, pos) => {
    if (!zonesOn() || action === undefined || action === null || pos === undefined || pos === null) return undefined;
    const z = zoneIndex.get(action.id);
    if (z === undefined) return undefined;
    const rec = state.recordAt(pos);
    if (rec === undefined) return undefined;
    return allowsHere(z, rec) ? undefined : { pos, rec, ...z };
  };
  const zoneLocked = (action) => zoneLockedAt(action, state.position());
  /** zoneLocked, or for an action a Folk would do, judged where the Folk stands ({ ..., folk }) (6b). */
  const zoneLockedFor = (action) => {
    const z = action === undefined || action === null ? undefined : zoneIndex.get(action.id);
    const folk = z === undefined ? undefined : folkActor(z.skillId);
    if (folk === undefined) return zoneLocked(action);
    const locked = zoneLockedAt(action, folk.place);
    return locked === undefined ? undefined : { ...locked, folk };
  };
  const folkZoneText = (action, { rec, folk }) => line('MOD_VOY_FOLK_ZONE_NEEDS', { name: esc(folk.name), here: here(rec).html, action: esc(action.name ?? action.id) }).text;
  /** Every hex where the action works (skill rule and zone), memoised per action and strictness. */
  const zoneHexes = new Map();
  state.listeners.push(() => zoneHexes.clear());
  const zoneCandidates = (actionId) => {
    const z = zoneIndex.get(actionId);
    if (z === undefined || state.terrain === undefined) return [];
    const opts = state.ruleOpts();
    const key = `${actionId}|${opts.strictness}`;
    let list = zoneHexes.get(key);
    if (list === undefined) {
      list = [];
      for (const rec of state.terrain.all()) {
        if (rec.cloud === true || !rules.allowedAt(z.skillId, rec, opts) || !allowsHere(z, rec)) continue;
        list.push(rec);
      }
      zoneHexes.set(key, list);
    }
    return list;
  };
  const hexDistance = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
  /** What the zone names, coloured: "Desert or Badlands or Rock or the coast". */
  const zoneNeed = (zone) => {
    const t = zones.zoneTerms(zone);
    const parts = [...t.classes.map(biome), ...t.features.map(feature), ...t.places.map(placeName)];
    if (zone.terms.some((x) => x.coast === true)) parts.push(coloured(getLangString('MOD_VOY_ZONE_COAST')));
    if (zone.terms.some((x) => x.shore !== undefined)) parts.push(coloured(getLangString('MOD_VOY_ZONE_SEA')));
    return join(parts);
  };
  /** A row range in words: "in the north, row 12 or further north", "between rows 12 and 22". */
  const latText = ([min, max]) => (min <= 0 ? templateLangString('MOD_VOY_ZONE_LAT_NORTH', { row: `${max}` })
    : max === undefined ? templateLangString('MOD_VOY_ZONE_LAT_SOUTH', { row: `${min}` })
      : templateLangString('MOD_VOY_ZONE_LAT_BAND', { min: `${min}`, max: `${max}` }));
  /** One term in words, for the sky (Astrology): "Mountain or Highlands, between rows 6 and 24"; "near Magic". */
  const termText = (term) => {
    const bits = [];
    const what = [...(term.t ?? []).map(biome), ...(term.f ?? []).map(feature)];
    if (what.length > 0) bits.push(join(what).html);
    if (term.near !== undefined) {
      const near = [...(term.near.t ?? []).map(biome), ...(term.near.f ?? []).map(feature), ...[...(term.near.area ?? []), ...(term.near.poi ?? [])].map(placeName)];
      bits.push(templateLangString('MOD_VOY_ZONE_NEAR', { what: join(near).html }));
    }
    if (term.coast === true) bits.push(coloured(getLangString('MOD_VOY_ZONE_COAST')).html);
    if (term.shore !== undefined) bits.push(coloured(getLangString('MOD_VOY_ZONE_SEA')).html);
    if (term.lat !== undefined) bits.push(esc(latText(term.lat)));
    return bits.length > 0 ? bits.join(', ') : esc(getLangString('MOD_VOY_ZONE_ANYWHERE'));
  };
  /** The modal's first lines. A sky zone (Astrology: rows and a dark sky) is told term by term. */
  const zoneLines = (name, zone) => {
    const t = zones.zoneTerms(zone);
    if (t.lat === undefined && t.away.length === 0) return [line('MOD_VOY_ZONE_NEEDS', { name: esc(name), need: zoneNeed(zone).html })];
    const where = [...new Set(zone.terms.map(termText))].join(esc(getLangString('MOD_VOY_ZONE_TERM_OR')));
    const lines = [line('MOD_VOY_ZONE_SKY_NEEDS', { name: esc(name), where })];
    if (t.away.length > 0) lines.push(line('MOD_VOY_ZONE_SKY_DARK'));
    return lines;
  };
  const showZoneLocked = (action, { pos, zone, skillId }) => {
    const name = action.name ?? action.id;
    const lines = zoneLines(name, zone);
    const all = zoneCandidates(action.id);
    let best;
    for (const rec of all) {
      if (!state.knowledge?.isKnown(rec)) continue;
      const d = hexDistance(pos, rec);
      if (best === undefined || d < best.distance) best = { hex: rec, distance: d };
    }
    if (best !== undefined) lines.push(line('MOD_VOY_ZONE_NEAREST', { where: whereIs(pos, best.hex, best.distance) }));
    else {
      lines.push(line('MOD_VOY_ZONE_NONE_KNOWN'));
      const compass = compassLine(state.compass?.readingTo(all, pos));
      if (compass !== undefined) lines.push(compass);
    }
    log(`refused ${action.id} at (${pos?.q},${pos?.r}): outside its zone`);
    state.journal?.miss(action, pos);
    const plan = () => state.planner?.forAction(skillId, action, best === undefined ? [] : [best.hex]);
    modal(templateLangString(skillId === ASTROLOGY ? 'MOD_VOY_ZONE_SKY_TITLE' : 'MOD_VOY_ZONE_TITLE', { name }), action.media, lines, { guide: 'zone', plan });
  };
  /**
   * Zone entry points, after the skill's own (Layer 1 above): `action(...args)` returns the action being started, or
   * undefined when the call stops or deselects (always allowed). `quiet` refuses without a modal and returns `refused`.
   * `skipped(...args)`, read before the call goes through, lists the actions it will leave out; one notice names them.
   */
  /** The distinct seeds picked for the empty plots of a Farming category (what Plant All Selected would plant). */
  const selectedSeeds = (farming, category) => [...new Set(farming.getPlotsForCategory(category)
    .filter((p) => p.state === 1 /* FarmingPlotState.Empty */).map((p) => p.selectedRecipe).filter((r) => r !== undefined))];
  const ZONE_ENTRIES = [
    { name: 'Mining.onRockClick', cls: () => Mining, method: 'onRockClick', action(rock) { return this.isActive && this.selectedRock === rock ? undefined : rock; } },
    { name: 'Woodcutting.selectTree', cls: () => Woodcutting, method: 'selectTree', action(tree) { return this.activeTrees?.has(tree) ? undefined : tree; } },
    { name: 'Fishing.onAreaStartButtonClick', cls: () => Fishing, method: 'onAreaStartButtonClick', action(area) { return this.isActive && this.activeFishingArea === area ? undefined : this.selectedAreaFish?.get(area); } },
    { name: 'Thieving.startThieving', cls: () => Thieving, method: 'startThieving', action(area, npc) { return npc; } },
    { name: 'Farming.plantRecipe', cls: () => Farming, method: 'plantRecipe', action(recipe) { return recipe; } },
    { name: 'Farming.plantAllRecipe', cls: () => Farming, method: 'plantAllRecipe', action(recipe) { return recipe; } },
    // Plant All Selected (the user, build .141): the seeds whose zone takes the hex are planted, the others' plots stay
    // empty (plantPlot below) and one notice names them. Only when none of them grows here does the popup show.
    { name: 'Farming.plantAllSelectedOnClick', cls: () => Farming, method: 'plantAllSelectedOnClick',
      action(category) {
        const seeds = selectedSeeds(this, category);
        return seeds.length > 0 && seeds.every((r) => zoneLocked(r) !== undefined) ? seeds[0] : undefined;
      },
      skipped(category) { return selectedSeeds(this, category).filter((r) => zoneLocked(r) !== undefined); } },
    // Planting all plots plants each one here: a plot whose seed is outside its zone stays empty (-1, as vanilla does
    // for a seed it cannot afford), the others are planted.
    { name: 'Farming.plantPlot', cls: () => Farming, method: 'plantPlot', quiet: true, refused: -1, action(plot, recipe) { return recipe; } },
    // Astrology has no skill rule; its constellations are zoned by the sky.
    { name: 'Astrology.studyConstellationOnClick', cls: () => Astrology, method: 'studyConstellationOnClick',
      action(constellation) { return this.isActive && this.studiedConstellation === constellation ? undefined : constellation; } },
  ];
  for (const ze of ZONE_ENTRIES) {
    let cls;
    try { cls = ze.cls(); } catch { cls = undefined; }
    if (typeof cls !== 'function' || typeof cls.prototype?.[ze.method] !== 'function') { console.warn(`[Voyage] zone entry ${ze.name} not found; not zoned`); continue; }
    ctx.patch(cls, ze.method).replace(function (original, ...args) {
      let left = [];
      try {
        if (zonesOn()) {
          const action = ze.action.apply(this, args);
          const locked = zoneLockedFor(action);
          // Where the skill itself is locked, its own gate speaks (the skill modal, not the zone one).
          if (locked !== undefined && rules.allowedAt(locked.skillId, locked.rec, state.ruleOpts())) {
            if (!ze.quiet) { if (locked.folk !== undefined) toastFolk(folkZoneText(action, locked)); else showZoneLocked(action, locked); }
            return ze.refused;
          }
          left = ze.skipped?.apply(this, args) ?? [];
        }
      } catch (e) { console.error('[Voyage] zone gate failed open', e); left = []; }
      const result = original(...args);
      if (left.length > 0) {
        try {
          const pos = state.position();
          for (const r of left) { log(`skipped ${r.id} at (${pos?.q},${pos?.r}): outside its zone`); state.journal?.miss(r, pos); }
          game.notifications.createErrorNotification('voyage:skipped', templateLangString('MOD_VOY_ZONE_SKIPPED', { names: left.map((r) => r.name ?? r.id).join(', ') }));
        } catch (e) { log('skipped notice failed', e); }
      }
      return result;
    });
  }
  /** The zoned actions a running skill is doing now (several trees at once for Woodcutting). */
  const runningActions = (skill) => {
    try {
      switch (skill.id) {
        case 'melvorD:Mining': return [skill.selectedRock];
        case 'melvorD:Woodcutting': return [...(skill.activeTrees ?? [])];
        case 'melvorD:Fishing': return [skill.activeFish];
        case 'melvorD:Thieving': return [skill.currentNPC];
        case 'melvorD:Astrology': return [skill.studiedConstellation];
        default: return [];
      }
    } catch { return []; }
  };
  /**
   * The zoned actions of a skill that work on the player's hex, at or below the skill's level, for the panel tooltip.
   * Empty when zones are off or the skill is not zoned.
   */
  // `later` (build .277): the ones whose water or ground this is but whose level you have not reached, lowest first
  // (the Here panel: "From level 20: Raw Trout", the user found Fishing "works" on a river at Fishing 11).
  state.zoneActionsHere = (skillId, { later = false } = {}) => {
    try {
      if (!zonesOn()) return [];
      const table = state.zoneTable?.skills?.[skillId]?.actions;
      const skill = game.skills.getObjectByID(skillId);
      if (table === undefined || skill === undefined) return [];
      const out = [];
      for (const id of Object.keys(table)) {
        const action = skill.actions?.getObjectByID(id);
        if (action === undefined || ((action.level ?? 1) > skill.level) !== later || (action.abyssalLevel ?? 0) > 0) continue;
        if (zoneLocked(action) === undefined) out.push(action);
      }
      if (later) out.sort((a, b) => (a.level ?? 1) - (b.level ?? 1));
      return out;
    } catch (e) { log('zone actions failed', e); return []; }
  };
  state.zonesOn = zonesOn;
  /** Every hex where a zoned action works now (skill rule, zone, grace); [] for an unzoned one. */
  state.zoneCandidates = (actionId) => { try { return zoneCandidates(actionId); } catch (e) { log('zone candidates failed', e); return []; } };
  /** Zoned skills without a skill rule (Astrology): the panel shows them only while zones are on. */
  state.zonedUngated = () => (zonesOn() ? Object.keys(state.zoneTable?.skills ?? {}).filter((id) => !rules.isGated(id)) : []);

  // ---------------------------------------------------------------------------------------------------- combat
  const warnedUnplaced = new Set();
  /** An area's hex next to you counts only once you know it (grace from a known hex, setup.mjs ruleOpts). */
  const knownPlace = (h) => state.knowledge?.isKnown(state.terrain.get(h.q, h.r) ?? h) ?? true;
  /** undefined when the area may be fought from here; otherwise the position and the nearest tagged hex. */
  const combatLocked = (area) => {
    if (!on() || !state.settings.combat() || area === undefined || typeof area.id !== 'string') return undefined;
    try { if (!game.tutorial.complete) return undefined; } catch {}
    const pos = state.position();
    const res = rules.combatAllowedAt(state.terrain.placesFor(area.id), pos, knownPlace);
    if (res.unplaced) {
      if (!warnedUnplaced.has(area.id)) { warnedUnplaced.add(area.id); log(`area ${area.id} is not placed on the map: allowed anywhere`); }
      return undefined;
    }
    return res.allowed ? undefined : { pos, nearest: res.nearest };
  };
  /**
   * Combat and slayer areas the player may enter from this hex: placed on the map, on it or next to it, entry
   * requirements met. Unplaced areas (allowed anywhere) are left out. For the panel's "Combat:" line and the lock
   * modal (user report, 15 Oct 2026: a player next to Golbin Village didn't know they could fight there).
   */
  const combatHere = () => {
    if (!on() || !state.settings.combat()) return [];
    const pos = state.position();
    if (pos === undefined) return [];
    const out = [];
    game.combatAreas.forEach((area) => {
      if (area === game.unknownCombatArea || typeof area.id !== 'string') return;
      const places = state.terrain.placesFor(area.id);
      if (places.length === 0 || !rules.combatAllowedAt(places, pos, knownPlace).allowed) return;
      try { if (!game.checkRequirements(area.entryRequirements ?? [])) return; } catch {}
      out.push(area);
    });
    return out;
  };
  const showLockedArea = (area, { pos, nearest }) => {
    const name = area.name ?? area.id;
    const lines = [line('MOD_VOY_GATE_AREA_STAND', { name: esc(name) })];
    const here = combatHere();
    if (here.length > 0) lines.push(line('MOD_VOY_GATE_AREA_HERE', { names: esc(here.map((a) => a.name).join(', ')) }));
    if (nearest !== undefined && state.knowledge?.isKnown(nearest.hex)) {
      const where = whereIs(pos, nearest.hex, nearest.distance);
      lines.push(line('MOD_VOY_GATE_AREA_WHERE', { where }));
    } else {
      lines.push(line('MOD_VOY_GATE_AREA_UNKNOWN', { name: esc(name) }));
      const compass = compassLine(state.compass?.readingTo(state.terrain.placesFor(area.id), pos));
      if (compass !== undefined) lines.push(compass);
    }
    log(`refused combat in ${area.id} at (${pos?.q},${pos?.r})`);
    const monster = clickedMonster?.area === area ? clickedMonster.monster : undefined;
    modal(helpLayout.marked(templateLangString, 'MOD_VOY_GATE_AREA_TITLE', {}, { name: helpLayout.titleName(name) }), area.media, lines, { guide: 'combat', plan: () => state.planner?.forArea(area, monster) });
  };
  // The monster a click picked, so a planned voyage's "On arrival" starts on it (build .123).
  let clickedMonster;
  ctx.patch(CombatManager, 'selectMonster').before(function (monster, area) { clickedMonster = { monster, area }; });
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
    if (rules.tradeAllowedAt(rec, state.knownNeighbours(rec))) return undefined;
    return { pos, rec };
  };
  const tradeCandidates = () => {
    const seen = new Set();
    const out = [];
    for (const f of rules.TRADE_FEATURES) for (const rec of state.terrain.withFeature(f)) if (!seen.has(rec)) { seen.add(rec); out.push(rec); }
    return out;
  };
  const showNoTrade = (what, { pos }) => {
    const lines = [line(TRADE_ONLY_KEYS[what] ?? TRADE_ONLY_KEYS.sell)];
    const near = terrainMod.nearestIn(tradeCandidates(), pos, (rec) => state.knowledge?.isKnown(rec) !== false);
    if (near !== undefined) {
      const where = whereIs(pos, near.hex, near.distance);
      lines.push(line('MOD_VOY_GATE_TRADE_NEAREST', { where }));
    } else {
      lines.push(line('MOD_VOY_GATE_TRADE_NONE_KNOWN'));
      const compass = compassLine(state.compass?.readingTo(tradeCandidates(), pos));
      if (compass !== undefined) lines.push(compass);
    }
    log(`refused trade (${what}) at (${pos?.q},${pos?.r})`);
    modal(getLangString('MOD_VOY_GATE_TRADE_TITLE'), undefined, lines, { guide: 'trade' });
  };
  /** Runs a trade (`run`) if it may happen here; else the trader's offer or the refusal (none when `quiet`). */
  const guardTrade = (what, run, quiet = false) => {
    try {
      const locked = tradeLocked();
      if (locked !== undefined) {
        // Selling while stranded: the wandering trader (src/trader.mjs) buys at half price.
        if (what === 'sell' && state.trader?.present()) return run();
        if (what === 'sell' && !quiet && state.trader?.offer(run)) return undefined;
        if (!quiet) showNoTrade(what, locked);
        return undefined;
      }
    } catch (e) { console.error('[Voyage] trade gate failed open', e); }
    return run();
  };
  const tradeGate = (cls, method, what, quiet = false) => {
    if (typeof cls !== 'function' || typeof cls.prototype?.[method] !== 'function') { console.warn(`[Voyage] trade entry ${method} not found`); return; }
    ctx.patch(cls, method).replace(function (original, ...args) { return guardTrade(what, () => original(...args), quiet); });
  };
  tradeGate(Bank, 'sellItemOnClick', 'sell');
  tradeGate(Bank, 'sellUnlockedItemsOnClick', 'sell');
  tradeGate(Bank, 'processSellSelectedItems', 'sell');
  tradeGate(Bank, 'processItemSale', 'sell', true); // backstop for any other sale path
  tradeGate(Shop, 'buyItemOnClick', 'buy');
  // Hiring follows Township: a hire needs a town or port. Worker Folks 1.3 asks through its staff guard and shows the
  // reason on its own Shop line, before the click (phase 6a, build .314). An older Worker Folks has no API: the
  // patch below still refuses the purchase, with the lock popup after the click.
  const hireRefusal = () => {
    const locked = lockedHere(HIRING_ID);
    if (locked === undefined) return undefined;
    const d = describe(game.skills.getObjectByID(HIRING_ID), HIRING_ID, locked);
    return { reason: d.lines.slice(0, 2).map((l) => l.text).join(' ') };
  };
  ctx.onModsLoaded(() => {
    const api = state.folksApi?.();
    if (api === undefined) return;
    // Every guard fails open: an error, the rules off or no hex means Worker Folks plays as without Voyage.
    const guard = (what, fn) => (request) => {
      try { return on() ? fn(request ?? {}) : undefined; } catch (e) { console.error(`[Voyage] ${what} guard failed open`, e); return undefined; }
    };
    api.registerGuard('staff', guard('staff', ({ action, folk, skillId }) => {
      if (action === 'hire') return hireRefusal();
      const far = farRefusal(folk);
      if (far !== undefined || action !== 'assign') return far;
      // Picking a Folk for a skill puts it on your hex (6b), so the skill must work here.
      const locked = lockedHere(skillId);
      return locked === undefined ? undefined : { reason: describe(game.skills.getObjectByID(skillId), skillId, locked).lines[0].text };
    }));
    api.registerGuard('gear', guard('gear', ({ folk }) => farRefusal(folk)));
    api.registerGuard('work', guard('work', ({ folk, skillId, skill }) => workRefusal(folk, skillId, skill)));
    // A new Folk stands where it was hired; a Folk picked for a skill moves to your hex.
    const placeHere = (folk, why) => {
      const pos = state.position();
      if (pos === undefined || folk === undefined) return;
      api.setPlace(folk.id, { q: pos.q, r: pos.r });
      log(`${folk.name} placed at (${pos.q},${pos.r}): ${why}`);
    };
    api.on('folkHired', ({ folk }) => placeHere(folk, 'hired'));
    api.on('folkAssigned', ({ folk, skillId }) => { if (skillId !== null) placeHere(folk, `picked for ${skillId}`); });
    api.registerLocationText((folk) => { try { return on() ? folkWhere(folk) : ''; } catch (e) { log('folk location failed', e); return ''; } });
    // The map's badges and the Here panel's Folks line follow the crew (6b); one redraw per burst of events.
    let folksDirty = false;
    const folksChanged = () => {
      state.overlay?.folksChanged?.();
      if (folksDirty) return;
      folksDirty = true;
      setTimeout(() => { folksDirty = false; try { state.herePanel?.render?.(); } catch (e) { log('folks redraw failed', e); } }, 0);
    };
    for (const name of ['folkMoved', 'folkHired', 'folkFired', 'folkDied', 'folkPromoted', 'folkAssigned', 'folkStarted', 'folkStruck', 'folkReleased', 'crewChanged']) api.on(name, folksChanged);
    state.folksGuarded = true;
    log('hiring: Worker Folks guards registered (staff, gear, work)');
  });
  // A place no longer on the map (the table changed) moves to your hex, said once per Folk.
  ctx.onInterfaceReady(() => setTimeout(() => {
    try {
      const api = state.folksGuarded ? state.folksApi?.() : undefined;
      const pos = state.position();
      if (api === undefined || pos === undefined || state.terrain === undefined) return;
      for (const f of api.folks()) {
        if (f.place === null || state.recordAt(f.place) !== undefined) continue;
        api.setPlace(f.id, { q: pos.q, r: pos.r });
        console.warn(`[Voyage] ${f.name}'s place (${f.place.q},${f.place.r}) is not on the map: moved to your hex`);
      }
    } catch (e) { log('folk place check failed', e); }
  }, 0));
  // Registered after the trade gate, so it wraps it and runs first: a hire is a staff change before it is a purchase.
  ctx.patch(Shop, 'buyItemOnClick').replace(function (original, purchase, ...rest) {
    try {
      if (!state.folksGuarded && typeof purchase?.id === 'string' && purchase.id.startsWith(HIRE_PURCHASE_PREFIX)) {
        const locked = lockedHere(HIRING_ID);
        if (locked !== undefined) { showLocked(game.skills.getObjectByID(HIRING_ID), HIRING_ID, locked); return undefined; }
      }
    } catch (e) { console.error('[Voyage] hiring gate failed open', e); }
    return original(purchase, ...rest);
  });
  state.tradeLocked = () => tradeLocked() !== undefined;
  /** The hold's Sell (build .265) goes through the bank's own gate: the same trader, the same refusal. */
  state.guardTrade = (what, run) => guardTrade(what, run);
  /** True when the area cannot be fought from the player's hex (the trader's GP-source check reads it). */
  state.combatLocked = (area) => combatLocked(area) !== undefined;
  state.combatHere = () => { try { return combatHere(); } catch (e) { log('combat here failed', e); return []; } };

  // ---------------------------------------------------------------------------------------------------- hiring
  // Only signing a hand (the hire purchases above) follows the Township rule (D-2, build .312). Management goes by
  // distance since 6b (build .316): Promote, Fire, Settle, picking a Folk for a skill and its gear need you within 1
  // hex of the Folk (the guards above, below).

  /** Management needs you within 1 hex of the Folk (6b, the user 19 Oct 2026); a Folk with no place yet is free. */
  const farRefusal = (folk) => {
    if (folk === undefined || folk.place === null || folk.place === undefined) return undefined;
    const pos = state.position();
    if (pos === undefined) return undefined;
    const d = hexDistance(pos, folk.place);
    if (d <= 1) return undefined;
    return { reason: line('MOD_VOY_FOLK_TOO_FAR', { name: esc(folk.name), where: whereIs(pos, state.recordAt(folk.place) ?? folk.place, d) }).text };
  };
  /** A Folk works only what its own hex allows, resource zones included (6b): the skill rule, then what it was on. */
  const workRefusal = (folk, skillId, skill) => {
    if (folk === undefined || folk.place === null || folk.place === undefined) return undefined;
    const locked = lockedAt(skillId, folk.place);
    if (locked !== undefined) return { reason: folkWorkText(skillId, { ...locked, folk }) };
    const off = skill === undefined ? undefined : runningActions(skill).map((a) => [a, zoneLockedAt(a, folk.place)]).find(([, z]) => z !== undefined);
    return off === undefined ? undefined : { reason: folkZoneText(off[0], { ...off[1], folk }) };
  };
  /** The card's and Worker box's line: where the Folk stands, from you. */
  const folkWhere = (folk) => {
    if (folk.place === null) return getLangString('MOD_VOY_FOLK_NO_PLACE');
    const rec = state.recordAt(folk.place);
    const pos = state.position();
    if (rec === undefined || pos === undefined) return '';
    const d = hexDistance(pos, folk.place);
    if (d === 0) return line('MOD_VOY_FOLK_AT_HERE', { here: here(rec).html }).text;
    return line('MOD_VOY_FOLK_AT', { here: here(rec).html, where: whereIs(pos, rec, d) }).text;
  };
  /** Worker Folks' guarded lines (the Shop's hire line) follow the player's hex and the rules. */
  const refreshFolks = () => { try { if (state.folksGuarded) state.folksApi?.()?.refresh(); } catch (e) { log('folks refresh failed', e); } };

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
      // Gated skills, plus Astrology (no rule of its own; ungated skills pass allowedAt, so only its zones stop it).
      const ids = new Set([...rules.gatedSkillIds(), ...(zonesOn() ? Object.keys(state.zoneTable?.skills ?? {}) : [])]);
      for (const id of ids) {
        const skill = game.skills.getObjectByID(id);
        if (skill === undefined || !skill.isActive || game.activeAction !== skill) continue;
        if (rules.allowedAt(id, rec, state.ruleOpts())) {
          // The skill works here, but what it is doing may be outside its zone (an iron rock on a copper hex).
          const off = runningActions(skill).find((a) => zoneLocked(a) !== undefined);
          if (off !== undefined && skill.stop()) {
            log(`stopped ${off.id} (${cause}): outside its zone`);
            try { game.notifications.createErrorNotification('voyage:stopped', templateLangString('MOD_VOY_ZONE_STOPPED', { name: off.name ?? off.id })); } catch {}
          }
          continue;
        }
        if (skill.stop()) {
          log(`stopped ${id} (${cause}) at (${rec?.q},${rec?.r}) ${rec?.t}`);
          try { game.notifications.createErrorNotification('voyage:stopped', templateLangString('MOD_VOY_GATE_STOPPED', { name: skillLabel(id, skill.name) })); } catch {}
        }
      }
      const cm = game.combat;
      if (cm?.isActive && cm.selectedArea !== undefined && combatLocked(cm.selectedArea) !== undefined) {
        const name = cm.selectedArea.name ?? cm.selectedArea.id;
        if (cm.stop()) {
          log(`stopped combat in ${name} (${cause})`);
          const text = templateLangString(cause === 'move' ? 'MOD_VOY_GATE_FIGHT_LEFT' : 'MOD_VOY_GATE_FIGHT_OUT_OF_REACH', { name });
          try { game.notifications.createErrorNotification('voyage:stopped', text); } catch {}
        }
      }
    } catch (e) { console.error('[Voyage] stop check failed open', e); }
  };
  const onMoved = () => {
    stopWhatDoesNotFit('move');
    refreshRates();
    dimSidebar();
    refreshFolks();
  };
  ctx.patch(WorldMap, 'setPlayerPosition').after(function () {
    try { if (game.cartography?.activeMap === this) setTimeout(onMoved, 0); } catch {}
  });
  // Deferred: settings handlers run inside the loader's onChange, before it stores the value.
  state.listeners.push(() => setTimeout(() => stopWhatDoesNotFit('rules'), 0), refreshRates, dimSidebar, () => setTimeout(refreshFolks, 0));
  // A level gained can open a zoned skill here (build .280): the sidebar follows at once.
  ctx.patch(Skill, 'onLevelUp').after(function () { try { if (state.zoneTable?.skills?.[this.id] !== undefined) setTimeout(dimSidebar, 0); } catch {} });
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
      const locked = lockedFor(skillId);
      if (locked === undefined) return original(action);
      if (locked.folk !== undefined) { toastFolk(folkWorkText(skillId, locked)); return true; }
      showLocked(action, skillId, locked);
      if (ENTRY_POINTS.some((ep) => ep.skillId === skillId)) console.warn(`[Voyage] backstop refused ${skillId}: a start path bypassed its entry point`);
      return true;
    } catch (e) {
      console.error('[Voyage] gate failed open', e);
      return original(action);
    }
  });
}
