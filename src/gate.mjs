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
 * are refused without a modal (they are called in loops by the listed ones). With an `unattended` list, a call made
 * outside the player's input (another mod on a timer, such as SEMI Auto Township repairing after every hourly
 * Township tick) runs as vanilla for the listed methods and is refused without a modal for the rest; the player's
 * own clicks are gated as usual (the user, 26 Oct 2026).
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
    // repairBuilding is the per-building Repair button (the game calls it nowhere else), so it gets the popup too.
    methods: ['buildBuilding', 'repairBuilding', 'repairAllBuildings', 'repairAllBuildingsInCurrentBiome', 'repairAllBuildingsFromStorageType'],
    quiet: ['processConversionToTownship', 'processConversionFromTownship'],
    unattended: ['repairAllBuildings', 'repairAllBuildingsInCurrentBiome', 'repairAllBuildingsFromStorageType', 'repairBuilding'] },
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
    const comma = getLangString('MOD_VOY_GATE_LIST_SEP'); // "City, Capital or Port", not "or ... or" (build .386)
    const seq = (xs) => (xs.length <= 2 ? xs.join(sep) : `${xs.slice(0, -1).join(comma)}${sep}${xs[xs.length - 1]}`);
    // One name once: Mining's Snowlands-with-mountain combo adds a "mountain" feature labelled like the Mountain
    // class, so the lock popup read "... or Rock or Mountain" after "Mountain or Highlands" (16 Oct 2026).
    const parts = list.filter((p, i) => list.findIndex((o) => o.text === p.text) === i);
    return { text: seq(parts.map((p) => p.text)), html: seq(parts.map((p) => p.html)) };
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
    // A Folk picked for this skill while busy on another moves to your hex when it starts, unless it goes back to its
    // kept job; a Folk with you is put down on your hex too.
    const moves = folk.travel === 'with' || (folk.skillId !== skillId && !keptJob(folk, skillId));
    const locked = lockedAt(skillId, moves ? state.position() : folk.place);
    return locked === undefined ? undefined : { ...locked, folk };
  };
  // A Folk's kept job (crew-model.mjs): the job it lost to you taking the skill back, which you may give it again from
  // anywhere. Kept in the Voyage save; without the skill or the crew model there is none and the walk rule holds.
  const jobsRecord = () => {
    const r = state.voyageSkill?.()?.record;
    return r !== null && typeof r === 'object' && r.jobs !== null && typeof r.jobs === 'object' ? r : undefined;
  };
  const keptJob = (folk, skillId) => {
    const r = jobsRecord();
    return r !== undefined && state.crewModel?.keptJob(r.jobs, folk, skillId) === true;
  };
  const updateJobs = (fn) => {
    const r = jobsRecord();
    if (r !== undefined && state.crewModel !== undefined) r.jobs = fn(state.crewModel, r.jobs);
  };
  /** A Folk's refusal is a toast with the reason, never the lock popup (its own Worker box says it before the click). */
  const toastFolk = (text) => { try { game.notifications.createErrorNotification('voyage:folk', text); } catch {} };
  /**
   * Cartography is yours alone (rules.FOLK_NEVER): { reason } for a Folk given it, else undefined. With Voyage loaded,
   * the rules on or off (the user, 23 Oct 2026); Worker Folks alone hands it out as any other skill.
   */
  const yoursAlone = (folk, skillId) => {
    if (folk === undefined || !rules.folkNever(skillId)) return undefined;
    return { reason: line('MOD_VOY_FOLK_YOURS_ALONE', { name: esc(folk.name), skill: esc(skillLabel(skillId, game.skills.getObjectByID(skillId)?.name ?? skillId)) }).text };
  };
  /** The skills a Folk may be offered here: Worker Folks' list without those that are yours alone. */
  state.folkSkillAllowed = (skillId) => yoursAlone({ name: '' }, skillId) === undefined;
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
    let where;
    if (near !== undefined) {
      const terms = rules.ruleTerms(skillId);
      const matchOf = (hex) => (terms.classes.includes(hex.t) ? biome(hex.t)
        : terms.features.some((f) => terrainMod.hasFeature(hex, f)) ? feature(terms.features.find((f) => terrainMod.hasFeature(hex, f)))
          : hex.poi && terms.pois.includes(hex.poi) ? placeName(hex.poi)
            : hex.area && terms.areas.includes(hex.area) ? placeName(hex.area) : undefined);
      const match = matchOf(near.hex);
      where = whereIs(pos, near.hex, near.distance);
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
    // `need` and `where` as plain text, for a short line elsewhere (the Shop's hire card, build .386).
    return { name, lines, need: n.text, where: where === undefined ? undefined : unesc(where.replace(/<[^>]*>/g, '')) };
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

  /**
   * True while the browser is dispatching the player's own click, tap or key press (`window.event`). A timer, the
   * game loop (setInterval) or another mod's polling runs outside any event, even a second after a click. User
   * activation (`navigator.userActivation`) lasts seconds after a click, so a timer firing then passed for the
   * player; it is only the fallback where `window.event` is missing.
   */
  const INPUT_EVENTS = new Set(['click', 'dblclick', 'auxclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup',
    'touchstart', 'touchend', 'keydown', 'keyup', 'keypress', 'submit', 'change', 'input']);
  const playerInput = () => {
    if (!('event' in window)) return navigator.userActivation?.isActive ?? true;
    const ev = window.event;
    return ev !== undefined && ev.isTrusted === true && INPUT_EVENTS.has(ev.type);
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
      const unattended = ep.unattended?.includes(method) === true;
      ctx.patch(cls, method).replace(function (original, ...args) {
        try {
          const id = ep.skillId ?? this.id;
          const byPlayer = ep.unattended === undefined || playerInput();
          if ((byPlayer || !unattended) && rules.isGated(id) && (ep.when === 'always' || !this.isActive)) {
            const locked = lockedFor(id);
            if (locked !== undefined) {
              if (!byPlayer) log(`refused ${id}.${method} without a click behind it, quietly`);
              if (quiet || !byPlayer) return undefined;
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
        // Only where the rate moved since the game last asked (build .401): a dirtied page recomputes every recipe's
        // interval through the patch above.
        const last = lastRate.get(id);
        if (last !== undefined && last === intervalRate(id)) continue;
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
  /**
   * Worker Folks' box on a page whose skill is yours alone (rules.FOLK_NEVER) is hidden (the user, 22 Oct 2026: the
   * whole strip, not greyed tiles), the rules on or off (23 Oct 2026). The box is mounted on character load, before
   * this first runs on interface ready; on Cartography it sits in Worker Folks' own gutter.
   */
  const hideFolkBoxes = () => {
    try {
      for (const id of rules.FOLK_NEVER) {
        const box = document.querySelector(`[data-wf-skill="${id}"]`);
        if (box === null) continue;
        (box.closest('.wf-ctrl-gutter') ?? box).classList.add('voyage-folk-box-hidden');
      }
    } catch (e) { log('folk box hide failed', e); }
  };
  const dimSidebar = () => {
    hideFolkBoxes();
    try {
      if (typeof sidebar === 'undefined') return;
      // sidebar.category(id) CREATES a missing category, so walk the existing ones instead.
      for (const cat of sidebar.categories()) {
        if (cat.id === 'Combat') continue;
        for (const item of cat.items()) {
          const id = item.id;
          const zonedOnly = state.zonedUngated?.()?.includes(id) === true;
          if (!item.rootEl) continue;
          // Archaeology: dimmed where no dig site the game lists for you is in reach (off with the rules, as Astrology).
          if (id === ARCHAEOLOGY) {
            const dim = state.digLockedHere();
            item.rootEl.classList.toggle('voyage-dim', dim);
            const tip = dim ? templateLangString('MOD_VOY_GATE_SIDEBAR_LOCKED', { need: getLangString('MOD_VOY_DIG_NOUN') }) : '';
            if (state.tips !== undefined) state.tips.set(item.rootEl, tip, { placement: 'right' }); else item.rootEl.title = tip;
            continue;
          }
          if (!rules.isGated(id) && !zonedOnly) {
            // Astrology is zoned only while the rules and zones are on: when they go off, its dim and tip go too.
            if (item.rootEl.classList.contains('voyage-dim')) {
              item.rootEl.classList.remove('voyage-dim');
              if (state.tips !== undefined) state.tips.set(item.rootEl, '', { placement: 'right' }); else item.rootEl.title = '';
            }
            continue;
          }
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
  /**
   * Every hex where the action works (skill rule and zone), memoised per action. Each entry is a pass over all 944
   * hexes with the zone's terms, so the memo is emptied only when what it depends on moves (build .401): the strictness,
   * the terrain's version (ice, the weather's layer, a tent), the knowledge version (the rules read known neighbours),
   * the zones setting. A listener call (a move, the stores, a survey) no longer empties it.
   */
  const zoneHexes = new Map();
  let zoneStamp;
  const zoneCandidates = (actionId) => {
    const z = zoneIndex.get(actionId);
    if (z === undefined || state.terrain === undefined) return [];
    const opts = state.ruleOpts();
    const stamp = `${opts.strictness}|${state.terrain.version}|${state.knowledge?.version}|${zonesOn()}`;
    if (stamp !== zoneStamp) { zoneStamp = stamp; zoneHexes.clear(); }
    let list = zoneHexes.get(actionId);
    if (list === undefined) {
      list = [];
      for (const rec of state.terrain.all()) {
        if (rec.cloud === true || !rules.allowedAt(z.skillId, rec, opts) || !allowsHere(z, rec)) continue;
        list.push(rec);
      }
      zoneHexes.set(actionId, list);
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

  // ---------------------------------------------------------------------------------------------------- dig sites
  // Archaeology (the user, 23 Oct 2026): a dig site is dug only at its own POI or one hex away once that hex is known,
  // as a combat area is fought (rules.digAllowedAt). The game links the two (digSite.poi, the dig site's POI); the POI
  // is tagged on its hex in the table (`poi`). A dig site whose POI is not on the map is dug anywhere (fail open), as an
  // unplaced area. Strict and Relaxed alike. The game itself lists a dig site only once its POI is discovered.
  const ARCHAEOLOGY = rules.ARCHAEOLOGY_ID;
  const warnedUndug = new Set();
  /** The table hex of a dig site's POI, as a list: empty when the site or its POI is not on the map. */
  const digPlaces = (site) => {
    const name = site?.poi?.localID;
    const rec = typeof name === 'string' ? state.terrain?.poi(name) : undefined;
    return rec === undefined ? [] : [rec];
  };
  /** undefined when the site may be dug from `pos` (or the gate is off); otherwise { pos, rec, site, nearest }. */
  const digLockedAt = (site, pos) => {
    if (!on() || site === undefined || site === null || pos === undefined || pos === null) return undefined;
    const res = rules.digAllowedAt(digPlaces(site), pos, knownPlace);
    if (res.unplaced) {
      if (!warnedUndug.has(site.id)) { warnedUndug.add(site.id); log(`dig site ${site.id} is not placed on the map: dug anywhere`); }
      return undefined;
    }
    return res.allowed ? undefined : { pos, rec: state.recordAt(pos), site, nearest: res.nearest };
  };
  /** digLockedAt your hex, or for a dig a Folk would do, where it stands ({ ..., folk }), as lockedFor judges a skill. */
  const digLockedFor = (site) => {
    const folk = folkActor(ARCHAEOLOGY);
    if (folk === undefined) return digLockedAt(site, state.position());
    const moves = folk.travel === 'with' || (folk.skillId !== ARCHAEOLOGY && !keptJob(folk, ARCHAEOLOGY));
    const locked = digLockedAt(site, moves ? state.position() : folk.place);
    return locked === undefined ? undefined : { ...locked, folk };
  };
  /** The dig sites the game lists for you (discovered, at your level), in its order. */
  const openDigSites = () => {
    const arch = game.archaeology;
    if (arch === undefined || !arch.isUnlocked) return [];
    return arch.actions.allObjects.filter((site) => site.isDiscovered && (site.level ?? 1) <= arch.level);
  };
  /** The dig sites you may dig from `pos` (placed on the map, in reach); empty while the gate is off. */
  const digSitesAt = (pos) => (on() && pos !== undefined ? openDigSites().filter((site) => digLockedAt(site, pos) === undefined) : []);
  /** The nearest known POI of a dig site the game lists for you: { hex, distance, site }, or undefined. */
  const digNearest = (pos, sites = openDigSites()) => {
    let best;
    for (const site of sites) {
      for (const h of digPlaces(site)) {
        if (!knownPlace(h)) continue;
        const d = hexDistance(pos, h);
        if (best === undefined || d < best.distance) best = { hex: h, distance: d, site };
      }
    }
    return best;
  };
  const folkDigText = (site, { folk }) => line('MOD_VOY_FOLK_DIG_NEEDS', { name: esc(folk.name), site: esc(site.name ?? site.id) }).text;
  const showLockedDig = (site, { pos, nearest }) => {
    const name = site.name ?? site.id;
    const lines = [line('MOD_VOY_GATE_DIG_STAND', { name: esc(name) })];
    const others = digSitesAt(pos);
    if (others.length > 0) lines.push(line('MOD_VOY_GATE_DIG_HERE', { names: esc(others.map((s) => s.name).join(', ')) }));
    if (nearest !== undefined && knownPlace(nearest.hex)) lines.push(line('MOD_VOY_GATE_AREA_WHERE', { where: whereIs(pos, nearest.hex, nearest.distance) }));
    else {
      lines.push(line('MOD_VOY_GATE_AREA_UNKNOWN', { name: esc(name) }));
      const compass = compassLine(state.compass?.readingTo(digPlaces(site), pos));
      if (compass !== undefined) lines.push(compass);
    }
    log(`refused digging ${site.id} at (${pos?.q},${pos?.r})`);
    modal(helpLayout.marked(templateLangString, 'MOD_VOY_GATE_AREA_TITLE', {}, { name: helpLayout.titleName(name) }), site.media, lines,
      { guide: 'dig', plan: () => state.planner?.forAction(ARCHAEOLOGY, site, digPlaces(site).filter(knownPlace)) });
  };
  // The Excavate button (archaeologyMenu: archaeology.startDigging(digSite)), checked before the game stops the dig
  // that runs. A click on the site being dug stops it, which always works. The idleChecker backstop below covers the rest.
  let ArchaeologyCls;
  try { ArchaeologyCls = Archaeology; } catch { log('entry point Archaeology absent (expansion not loaded)'); }
  if (typeof ArchaeologyCls?.prototype?.startDigging === 'function') {
    ctx.patch(ArchaeologyCls, 'startDigging').replace(function (original, site, ...rest) {
      try {
        if (!(this.isActive && this.currentDigSite === site)) {
          const locked = digLockedFor(site);
          if (locked !== undefined) {
            if (locked.folk !== undefined) toastFolk(folkDigText(site, locked)); else showLockedDig(site, locked);
            return undefined;
          }
        }
      } catch (e) { console.error('[Voyage] dig gate failed open', e); }
      return original(site, ...rest);
    });
  } else if (ArchaeologyCls !== undefined) console.warn('[Voyage] entry point Archaeology.startDigging not found; gated by the backstop only');
  /** The dig sites you may dig here, for the Here panel, the sidebar and the ship's clock. */
  state.digSitesHere = () => { try { return digSitesAt(state.position()); } catch (e) { log('dig sites here failed', e); return []; } };
  /** Archaeology is locked on your hex: the rules on, and no dig site the game lists for you in reach. */
  state.digLockedHere = () => { try { return on() && game.archaeology?.isUnlocked === true && digSitesAt(state.position()).length === 0; } catch { return false; } };
  /** The nearest known dig site POI from `pos`, for the lock tooltips. */
  state.digNearest = (pos) => { try { return pos === undefined ? undefined : digNearest(pos); } catch { return undefined; } };
  /** Every dig site POI the game lists for you, known or not (the compass's targets). */
  state.digTargets = () => { try { return openDigSites().flatMap(digPlaces); } catch { return []; } };
  /** True when this dig site can't be dug from your hex (the ship's clock asks quietly). */
  state.digLocked = (site) => { try { return digLockedAt(site, state.position()) !== undefined; } catch { return false; } };

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
        // A Merchant Folk on an outpost within a hex buys at its rate (travel traits, 6f-3).
        if (what === 'sell' && state.folkTraits?.outpostSale?.() !== undefined) return run();
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
    // One short line on the Shop's hire card (build .386; the full sentences wrapped one word a line at 375 px).
    return { reason: d.where === undefined ? templateLangString('MOD_VOY_GATE_HIRE_SHORT_NONE', { need: d.need }) : templateLangString('MOD_VOY_GATE_HIRE_SHORT', { need: d.need, where: d.where }) };
  };
  ctx.onModsLoaded(() => {
    const api = state.folksApi?.();
    if (api === undefined) return;
    // Every guard fails open: an error, the rules off or no hex means Worker Folks plays as without Voyage. `always`
    // is asked first, the rules on or off: Cartography is yours alone, wherever the Folk stands (rules.FOLK_NEVER).
    const guard = (what, fn, always) => (request) => {
      try {
        const r = request ?? {};
        return always?.(r) ?? (on() ? fn(r) : undefined);
      } catch (e) { console.error(`[Voyage] ${what} guard failed open`, e); return undefined; }
    };
    const yoursOnAssign = ({ action, folk, skillId }) => (action === 'assign' ? yoursAlone(folk, skillId) : undefined);
    api.registerGuard('staff', guard('staff', ({ action, folk, skillId }) => {
      if (action === 'hire') return hireRefusal();
      // A Folk arriving from a walk (6d) is given the work it was sent for: only the hex it reached has to allow it.
      if (action === 'assign' && arriving(folk)) {
        const locked = lockedAt(skillId, folk.place);
        return locked === undefined ? undefined : { reason: folkWorkText(skillId, { ...locked, folk }) };
      }
      const walking = walkingRefusal(folk);
      if (walking !== undefined) return walking;
      // Its kept job, given from anywhere: only its own hex has to allow it.
      if (action === 'assign' && keptJob(folk, skillId)) {
        const locked = lockedAt(skillId, folk.place);
        return locked === undefined ? undefined : { reason: folkWorkText(skillId, { ...locked, folk }) };
      }
      const far = farRefusal(folk);
      if (far !== undefined || action !== 'assign') return far;
      // Picking a Folk for a skill puts it on your hex (6b), so the skill must work here.
      const locked = lockedHere(skillId);
      return locked === undefined ? undefined : { reason: describe(game.skills.getObjectByID(skillId), skillId, locked).lines[0].text };
    }, yoursOnAssign));
    api.registerGuard('gear', guard('gear', ({ folk }) => walkingRefusal(folk) ?? farRefusal(folk)));
    api.registerGuard('work', guard('work', ({ folk, skillId, skill }) => walkingRefusal(folk) ?? workRefusal(folk, skillId, skill),
      ({ folk, skillId }) => yoursAlone(folk, skillId)));
    // A new Folk stands where it was hired; a Folk picked for a skill moves to your hex.
    const placeHere = (folk, why) => {
      const pos = state.position();
      if (pos === undefined || folk === undefined) return;
      api.setPlace(folk.id, { q: pos.q, r: pos.r });
      log(`${folk.name} placed at (${pos.q},${pos.r}): ${why}`);
    };
    api.on('folkHired', ({ folk }) => placeHere(folk, 'hired'));
    // A Folk with you picked for a skill steps ashore first (6c): it works where you stand.
    api.on('folkAssigned', ({ folk, previous, skillId }) => {
      const back = skillId !== null && keptJob(folk, skillId);
      updateJobs((CM, jobs) => CM.jobsAfterAssign(jobs, { folkId: folk.id, previous, skillId }));
      if (skillId === null) return;
      // Back on its kept job, or arriving from a walk (6d): it works on where it stands.
      if (arriving(folk)) { log(`${folk.name} arrives on ${skillId} at (${folk.place.q},${folk.place.r})`); return; }
      if (back) { log(`${folk.name} back on ${skillId} at (${folk.place.q},${folk.place.r})`); return; }
      if (folk.travel === 'with') api.setTravel(folk.id, 'idle');
      placeHere(folk, `picked for ${skillId}`);
    });
    // A Folk that moves, comes aboard, is fired or dies no longer keeps a job.
    for (const name of ['folkMoved', 'folkFired', 'folkDied']) api.on(name, ({ folk }) => { if (folk?.id !== undefined) updateJobs((CM, jobs) => CM.jobsWithout(jobs, folk.id)); });
    api.registerLocationText((folk) => { try { return on() ? folkWhere(folk) : ''; } catch (e) { log('folk location failed', e); return ''; } });
    // The map's badges and the Here panel's Folks line follow the crew (6b); one redraw per burst of events.
    let folksDirty = false;
    const folksChanged = () => {
      state.overlay?.folksChanged?.();
      if (folksDirty) return;
      folksDirty = true;
      setTimeout(() => {
        folksDirty = false;
        try { state.herePanel?.render?.(); } catch (e) { log('folks redraw failed', e); }
        // The Voyage page's Crew block (6c).
        try { const s = state.voyageSkill?.(); if (s !== undefined) s.renderQueue.page = true; } catch {}
      }, 0);
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
  // A Folk with you (6c) is always at hand.
  const farRefusal = (folk) => {
    if (folk === undefined || folk.travel === 'with' || folk.place === null || folk.place === undefined) return undefined;
    const pos = state.position();
    if (pos === undefined) return undefined;
    const d = hexDistance(pos, folk.place);
    if (d <= 1) return undefined;
    return { reason: line('MOD_VOY_FOLK_TOO_FAR', { name: esc(folk.name), where: whereIs(pos, state.recordAt(folk.place) ?? folk.place, d) }).text };
  };
  /**
   * Why a Folk may not work `skillId` where it stands (6b), resource zones included: the lock ({ pos, rec, folk })
   * from the skill rule, or with `offAction` the zoned action its hex refuses; undefined when it may.
   */
  const folkWorkLock = (folk, skillId, skill) => {
    // A Folk with you (6c) is put down on your hex to work: your hex is the one that counts.
    const place = folk?.travel === 'with' ? state.position() : folk?.place;
    if (folk === undefined || place === null || place === undefined) return undefined;
    const locked = lockedAt(skillId, place);
    if (locked !== undefined) return { ...locked, folk };
    // Archaeology: the dig site it is on (or about to start) must be in reach of its hex.
    if (skillId === ARCHAEOLOGY && skill?.currentDigSite !== undefined) {
      const dig = digLockedAt(skill.currentDigSite, place);
      if (dig !== undefined) return { ...dig, folk, offDig: dig.site };
    }
    const off = skill === undefined ? undefined : runningActions(skill).map((a) => [a, zoneLockedAt(a, place)]).find(([, z]) => z !== undefined);
    return off === undefined ? undefined : { ...off[1], folk, offAction: off[0] };
  };
  /** A Folk works only what its own hex allows (6b): the skill rule, then what it was on. */
  const workRefusal = (folk, skillId, skill) => {
    const lock = folkWorkLock(folk, skillId, skill);
    if (lock === undefined) return undefined;
    if (lock.offDig !== undefined) return { reason: folkDigText(lock.offDig, lock) };
    return { reason: lock.offAction === undefined ? folkWorkText(skillId, lock) : folkZoneText(lock.offAction, lock) };
  };
  /** The toast when a Folk's work is stopped where it stands: the skill rule's, or the zone's for what it was on. */
  const folkStoppedText = (skillId, lock) => (lock.offDig !== undefined
    ? line('MOD_VOY_FOLK_STOPPED_DIG', { name: esc(lock.folk.name), site: esc(lock.offDig.name ?? lock.offDig.id) }).text
    : lock.offAction === undefined
    ? line('MOD_VOY_FOLK_STOPPED_WORK', { name: esc(lock.folk.name), here: here(lock.rec).html, skill: esc(skillLabel(skillId, game.skills.getObjectByID(skillId)?.name ?? skillId)), need: need(skillId).html }).text
    : line('MOD_VOY_FOLK_STOPPED_ZONE', { name: esc(lock.folk.name), here: here(lock.rec).html, action: esc(lock.offAction.name ?? lock.offAction.id) }).text);
  /** A Folk walking alone (6d) takes no orders but Stop here until it arrives. */
  const walkingRefusal = (folk) => {
    if (folk?.travel !== 'walking' || arriving(folk)) return undefined;
    const w = state.walks?.describe?.(folk.id);
    return { reason: line('MOD_VOY_WALK_BUSY', { name: esc(folk.name), to: w === undefined ? '' : esc(w.to) }).text };
  };
  const arriving = (folk) => folk !== undefined && state.walks?.arriving?.() === folk.id;
  /** Why a Folk standing on `hex` can't do `action` of `skillId` there (6d's places), or undefined. Plain text. */
  state.folkWorkAt = (folk, skillId, action, hex) => {
    const yours = yoursAlone(folk, skillId);
    if (yours !== undefined) return yours.reason;
    const locked = lockedAt(skillId, hex);
    if (locked !== undefined) return folkWorkText(skillId, { ...locked, folk });
    if (skillId === ARCHAEOLOGY && action !== undefined && digLockedAt(action, hex) !== undefined) return folkDigText(action, { folk });
    const z = zoneLockedAt(action, hex);
    return z === undefined ? undefined : folkZoneText(action, { ...z, folk });
  };
  /** The land of a hex in a word or two, as the lock popups name it (6d's places): { text, html }. */
  state.landWords = (hex) => { const rec = state.recordAt(hex); return rec === undefined ? { text: '', html: '' } : here(rec); };
  /** The card's and Worker box's line: where the Folk stands, from you. */
  const folkWhere = (folk) => {
    if (folk.travel === 'with') return getLangString('MOD_VOY_FOLK_WITH_YOU');
    if (folk.travel === 'walking') {
      const w = state.walks?.describe?.(folk.id);
      if (w !== undefined) return line('MOD_VOY_WALK_CARD', { to: esc(w.to), left: esc(w.leftText) }).text;
    }
    if (folk.place === null) return getLangString('MOD_VOY_FOLK_NO_PLACE');
    // Putting a tent up (build .367): its skill is set aside until the tent stands.
    const tent = state.outposts?.builderText?.(folk.id);
    if (tent !== undefined) return tent;
    const rec = state.recordAt(folk.place);
    const pos = state.position();
    if (rec === undefined || pos === undefined) return '';
    const d = hexDistance(pos, folk.place);
    // A Folk on a standing outpost (6f-4): the card names the tent.
    const camp = state.outposts?.list?.().find((o) => o.q === folk.place.q && o.r === folk.place.r);
    const at = camp !== undefined ? (d === 0 ? line('MOD_VOY_FOLK_AT_OUTPOST_HERE', { name: `<b>${esc(camp.name)}</b>` }).text : line('MOD_VOY_FOLK_AT_OUTPOST', { name: `<b>${esc(camp.name)}</b>`, where: whereIs(pos, rec, d) }).text)
      : d === 0 ? line('MOD_VOY_FOLK_AT_HERE', { here: here(rec).html }).text : line('MOD_VOY_FOLK_AT', { here: here(rec).html, where: whereIs(pos, rec, d) }).text;
    const job = folk.skillId === null ? jobsRecord()?.jobs[folk.id] : undefined;
    if (job === undefined) return at;
    return `${at}. ${line('MOD_VOY_FOLK_JOB_KEPT', { skill: esc(skillLabel(job, game.skills.getObjectByID(job)?.name ?? job)) }).text}`;
  };
  /** Worker Folks' guarded lines (the Shop's hire line) follow the player's hex and the rules. */
  const refreshFolks = () => { try { if (state.folksGuarded) state.folksApi?.()?.refresh(); } catch (e) { log('folks refresh failed', e); } };

  // ---------------------------------------------------------------------------------------------------- moving
  // A gated skill (or fight) that does not fit the current hex stops, with a notice. Checked on every move
  // (WorldMap.setPlayerPosition is where travel, portals and the dev teleport land; the 'travel' event fires BEFORE the
  // position changes), and whenever the rules tighten: a settings change (rules back on, Strict, combat switch), the
  // tutorial ending, and the first interface load. Without the last three, a skill started while the rules were off
  // kept running when they came back on. The Folks at work are judged the same way, each where it stands (build .400).
  // Nothing is stopped before the interface is ready (build .408): the game replays the time away first, and the
  // checks queued while the character loads (the settings pass, a move) ran before that replay and threw the time
  // away of an action that no longer fit, such as a dig off its site after the update that locked Archaeology.
  let ready = false;
  const stopWhatDoesNotFit = (cause) => {
    try {
      if (!on() || !ready) return;
      stopFolksThatDoNotFit(cause);
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
      const arch = game.archaeology;
      if (arch?.isActive && game.activeAction === arch && digLockedAt(arch.currentDigSite, state.position()) !== undefined) {
        const name = arch.currentDigSite.name ?? arch.currentDigSite.id;
        if (arch.stop()) {
          log(`stopped digging ${name} (${cause})`);
          try { game.notifications.createErrorNotification('voyage:stopped', templateLangString(cause === 'move' ? 'MOD_VOY_GATE_DIG_STOPPED' : 'MOD_VOY_GATE_DIG_OUT_OF_REACH', { name })); } catch {}
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
  /**
   * A Folk at work is judged where it stands, as its start was (6b): the skill rule and the zone of what it is doing.
   * Until build .400 only your own action was stopped, so a Folk kept cutting out of zone when Resource zones came on
   * or Relaxed turned Strict, until its next start. Stopping its skill is what the Worker box's Stop button does: the
   * Folk keeps the skill and starts again on its next order. A Folk walking alone re-judges its work on arrival.
   */
  const stopFolksThatDoNotFit = (cause) => {
    const api = state.folksGuarded ? state.folksApi?.() : undefined;
    if (api === undefined) return;
    for (const f of api.folks()) {
      try {
        if (f.skillId === null || f.travel === 'walking' || (f.status !== 'working' && f.status !== 'overtime')) continue;
        const skill = game.skills.getObjectByID(f.skillId);
        // The Folk's run beside your action; your own run of the skill is judged on your hex, above.
        if (skill === undefined || !skill.isActive || game.activeAction === skill) continue;
        const lock = folkWorkLock(f, f.skillId, skill);
        if (lock === undefined || !skill.stop()) continue;
        log(`stopped ${f.name}'s ${f.skillId} (${cause}) at (${lock.pos.q},${lock.pos.r}): ${lock.offDig !== undefined ? `${lock.offDig.id} out of reach` : lock.offAction === undefined ? 'the skill rule' : `${lock.offAction.id} outside its zone`}`);
        toastFolk(folkStoppedText(f.skillId, lock));
      } catch (e) { console.error(`[Voyage] stop check for ${f?.name} failed open`, e); }
    }
  };
  const onMoved = () => {
    stopWhatDoesNotFit('move');
    refreshRates();
    dimSidebar();
    refreshFolks();
  };
  // One deferred pass per burst of moves (build .401): a catch-up replays a voyage hex by hex inside one run of ticks, and
  // every hex used to queue its own stop check, sidebar pass and Folk refresh; they all saw the same final hex anyway.
  let movePending = false;
  ctx.patch(WorldMap, 'setPlayerPosition').after(function () {
    try {
      if (game.cartography?.activeMap !== this || movePending) return;
      movePending = true;
      setTimeout(() => { movePending = false; onMoved(); }, 0);
    } catch {}
  });
  // Deferred: settings handlers run inside the loader's onChange, before it stores the value.
  state.listeners.push(() => setTimeout(() => stopWhatDoesNotFit('rules'), 0), refreshRates, dimSidebar, () => setTimeout(refreshFolks, 0));
  // A level gained can open a zoned skill here (build .280): the sidebar follows at once.
  ctx.patch(Skill, 'onLevelUp').after(function () { try { if (state.zoneTable?.skills?.[this.id] !== undefined || this.id === ARCHAEOLOGY) setTimeout(dimSidebar, 0); } catch {} });
  // The game awaits the end of its offline catch-up before the interface is ready.
  ctx.onInterfaceReady(() => setTimeout(() => { ready = true; stopWhatDoesNotFit('load'); dimSidebar(); }, 0));
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
      // Archaeology: the dig site it is about to start (startDigging sets it before start()).
      if (skillId === ARCHAEOLOGY) {
        const site = action.currentDigSite;
        const dig = site === undefined ? undefined : digLockedFor(site);
        if (dig !== undefined) {
          if (dig.folk !== undefined) toastFolk(folkDigText(site, dig)); else showLockedDig(site, dig);
          console.warn(`[Voyage] backstop refused digging ${site.id}: a start path bypassed startDigging`);
          return true;
        }
      }
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
