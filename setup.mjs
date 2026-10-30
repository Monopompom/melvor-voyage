// Voyage: Far Shores — entry point for the Melvor Idle v1.3.1 mod loader.
// Game-facing code lives in src/*.mjs and is loaded through ctx.loadModule (relative ES imports do not
// resolve inside the loader's resource URLs). src/terrain.mjs and src/rules.mjs are pure and covered by
// Node tests in tests/.
//
// Phase 2 (map rules): the full tier table with Strict/Relaxed, combat placement with one-hex
// grace, the trade gate, Township in towns, sidebar dimming and the Wayfinder's Compass. Travel is vanilla.
//
// Phase 3a: the Voyage skill shell: a passive skill with its own page, save block, XP per hex
// travelled and the compass levels (4.17).
// Phase 3b: the ship (4.3): off the ship, land only; a dinghy built on the Voyage page; the ship waits where you step
// ashore; player and ship markers; a free dinghy for characters phase 2 left on the water or overseas.
// Phase 3c: provisions (4.4): stores of food and fuel loaded at ports, towns, markets and farms, paid per hex on top
// of the GP; the hunger floor on easy ground; always get ashore; fast travel between ports sails the ship.
// Build .66: a carry limit that grows with Voyage level, and a cooking fire (fuel) on every land hex.
// Phase 3d: hull wear (4.4): sailing wears the ship; repairs with logs and Pitch, a new Firemaking by-product.
// Phase 3e: night on the player's clock (4.23): spare fuel lights the way, lit hexes pay more Voyage XP.
// Build .72: the ship's hold: bank items stowed aboard and taken back at the ship.
// Phase 4 (build .105): the Captain's Journal (4.20): finds, misses, places and guide pages kept in the save, opened
// as a book from the skill minibar, the page header (.117), the map panel, the Voyage page's "?" and every lock popup.

/** Bumped on every zip build so the console shows which build is running. */
export const BUILD = '2026-10-30.471';
/** Dev switch: true prints [Voyage] debug lines. Set to false for player builds. */
const DEV = false;

export async function setup(ctx) {
  const log = DEV ? (...args) => console.log('[Voyage]', ...args) : () => {};
  console.info(`[Voyage] Far Shores — build ${BUILD}`);
  // Every player-facing text comes from languages/<code>.json (Translatable text); merged before anything reads it.
  const { mergeLang } = await ctx.loadModule('src/lang-merge.mjs');
  await (await ctx.loadModule('src/lang.mjs')).install(ctx, { mergeLang });

  // Hard requirement: Atlas of Discovery. Without it the mod registers nothing and never throws.
  const hasAoD = () => {
    try { return Boolean(cloudManager.hasAoDEntitlementAndIsEnabled); } catch { return false; }
  };
  if (!hasAoD()) {
    console.warn('[Voyage] Atlas of Discovery is not enabled; Voyage stays dormant.');
    ctx.onInterfaceReady(() => {
      try { game.notifications.createErrorNotification('voyage:noaod', getLangString('MOD_VOY_NOTICE_NO_AOD')); } catch {}
    });
    return;
  }

  const terrainMod = await ctx.loadModule('src/terrain.mjs');
  const rules = await ctx.loadModule('src/rules.mjs');
  const table = await ctx.loadData('data/hex_terrain.json');
  // Resource zones: where each ore, tree, fish, crop and thieving target is found. Without the table
  // the zones stay off and every action follows its skill's rule.
  let zonesMod;
  let zoneTable;
  try { zonesMod = await ctx.loadModule('src/zones.mjs'); zoneTable = await ctx.loadData('data/zones.json'); } catch (e) { console.error('[Voyage] zone table failed; resource zones are off', e); zonesMod = undefined; }

  // The Voyage skill (phase 3a): the class first, then the data (page, milestones) that references it. A failure here
  // leaves the skill out and everything else running.
  const model = await ctx.loadModule('src/voyage-model.mjs');
  const shipModel = await ctx.loadModule('src/ship-model.mjs');
  const outpostModel = await ctx.loadModule('src/outpost-model.mjs');
  let voyageSkillOk = false;
  try {
    await ctx.loadTemplates('ui/templates.html');
    const { createVoyageClass } = await ctx.loadModule('src/voyage-skill.mjs');
    const { Voyage } = createVoyageClass({ model, log });
    ctx.gameData.buildPackage((pkg) => { pkg.skills.add(Voyage); }).add();
    await ctx.gameData.addPackage('data/skill.json');
    // Milestone names: MOD_VOY_MILESTONE_<n>, n = 1.. in model.COMPASS_STAGES order (data/skill.json keeps the English).
    try {
      game.skills.getObjectByID(model.SKILL_ID)?.milestones.forEach((m) => {
        const i = model.COMPASS_STAGES.findIndex((stage) => stage.level === m.level);
        // Build .142: the longboat shares level 30 with a free chart, so it is found by its English name first.
        // Build .150: the brig (a purchase, not an upgrade) the same way.
        const up = Object.entries({ ...shipModel.UPGRADES, ...shipModel.BIG_SHIPS }).find(([, u]) => u.level === m.level && u.milestone === m._name);
        if (up !== undefined) {
          m._name = getLangString(`MOD_VOY_MILESTONE_${up[0].toUpperCase()}`);
          const url = ctx.getResourceUrl(shipModel.HULLS[up[0]].media);
          Object.defineProperty(m, 'media', { get: () => url, configurable: true });
        } else if (m._name === outpostModel.OUTPOST_MILESTONES.first || m._name === outpostModel.OUTPOST_MILESTONES.more) {
          // Phase 6e: one more tent pitched at a time at 30, 50, 70 and 90, matched by their English names.
          // Without Worker Folks they say so (the user, 26 Oct 2026): a tent needs a Folk. Read when the game reads the
          // name, since Worker Folks' guards register after this data does.
          const [key, noFolks] = m._name === outpostModel.OUTPOST_MILESTONES.first
            ? ['MOD_VOY_MILESTONE_OUTPOST_FIRST', 'MOD_VOY_MILESTONE_OUTPOST_FIRST_NO_FOLKS']
            : ['MOD_VOY_MILESTONE_OUTPOST', 'MOD_VOY_MILESTONE_OUTPOST_NO_FOLKS'];
          const folksOn = () => { try { return state.folksGuarded === true; } catch { return true; } };
          Object.defineProperty(m, '_name', { get: () => getLangString(folksOn() ? key : noFolks), configurable: true });
          const url = ctx.getResourceUrl('assets/tent.webp');
          Object.defineProperty(m, 'media', { get: () => url, configurable: true });
        } else if (i >= 0 && m._milestoneID === undefined && '_name' in m) m._name = getLangString(`MOD_VOY_MILESTONE_${i + 1}`);
        // The balance pass: 55 and 60 hold two milestones each, so these are matched by their English names too.
        else if (model.FREE_CHART_LEVELS.includes(m.level) && m._name === 'Journal: Chart one country') {
          m._name = getLangString('MOD_VOY_MILESTONE_CHART');
          // The game resolves a custom milestone's media against its own CDN (assets.getURI): the journal icon is ours.
          const url = ctx.getResourceUrl('assets/journal.webp');
          Object.defineProperty(m, 'media', { get: () => url, configurable: true });
        } else if (shipModel.HOLD_ROW_LEVELS.includes(m.level) && m._name === 'Hold: A new row of six crates') {
          // Build .134: the hold grows a row of six crates.
          m._name = getLangString('MOD_VOY_MILESTONE_HOLD');
          const url = ctx.getResourceUrl('assets/hull_dinghy.webp');
          Object.defineProperty(m, 'media', { get: () => url, configurable: true });
        } else if (m.level === model.PLAN_LEVEL && '_name' in m) {
          // Build .133: Plan a voyage opens.
          m._name = getLangString('MOD_VOY_MILESTONE_PLAN');
          const url = ctx.getResourceUrl('assets/icon.webp');
          Object.defineProperty(m, 'media', { get: () => url, configurable: true });
        } else if (m.level === model.NAVIGATOR_LEVEL && m._name === "Navigator's Charts: Sold at ports") {
          // Build .119: Navigator's Charts, Plan a voyage's Sail!.
          m._name = getLangString('MOD_VOY_MILESTONE_NAVIGATOR');
          const url = ctx.getResourceUrl('assets/icon.webp');
          Object.defineProperty(m, 'media', { get: () => url, configurable: true });
        }
      });
    } catch (e) { console.error('[Voyage] milestone names not translated', e); }
    voyageSkillOk = true;
  } catch (e) { console.error('[Voyage] the Voyage skill failed to register; the rules still run', e); }

  // Items and shop entries (the compass). Registered before any character loads, and after the skill (build .361):
  // the shop's Voyage-level requirements are resolved when this package registers, so the skill must be there first.
  try { await ctx.gameData.addPackage('data/package.json'); } catch (e) { console.error('[Voyage] data package failed; the compass is unavailable', e); }
  // Gear, relics and the Albatross: its data after the package it draws on (the Sack and the Crate).
  // A failure leaves the rest: no outfit in the shop, no relic set, no tablet.
  const gearModel = await ctx.loadModule('src/gear-model.mjs');
  const gearMod = await ctx.loadModule('src/gear.mjs');
  try { await gearMod.register(ctx, { G: gearModel, log }); } catch (e) { console.error('[Voyage] gear data failed; no outfit, relics or Albatross', e); }
  // Names that live in the data files come from the language file too (the English there is the fallback). The shop
  // purchase takes its name and description from the item.
  try {
    const compass = game.items.getObjectByID('voyage:Wayfinder_Compass');
    if (compass !== undefined) {
      compass._name = getLangString('MOD_VOY_ITEM_COMPASS_NAME');
      compass._customDescription = getLangString('MOD_VOY_ITEM_COMPASS_DESC');
      compass._modifiedDescription = undefined;
    }
    const pitch = game.items.getObjectByID('voyage:Pitch');
    if (pitch !== undefined) {
      pitch._name = getLangString('MOD_VOY_ITEM_PITCH_NAME');
      pitch._customDescription = getLangString('MOD_VOY_ITEM_PITCH_DESC');
      pitch._modifiedDescription = undefined;
    }
    // The six charts (build .116): MOD_VOY_ITEM_<ID>_NAME / _DESC.
    for (const id of ['Prospectors_Notes', 'Foresters_Survey', 'Anglers_Log', 'Farmers_Almanac', 'Fences_Ledger', 'Star_Chart']) {
      const it = game.items.getObjectByID(`voyage:${id}`);
      if (it === undefined) continue;
      it._name = getLangString(`MOD_VOY_ITEM_${id.toUpperCase()}_NAME`);
      it._customDescription = getLangString(`MOD_VOY_ITEM_${id.toUpperCase()}_DESC`);
      it._modifiedDescription = undefined;
    }
    // The two rumours (build .210) and the Starlit Chart (.214), src/charts.mjs; the Tent (phase 6e), src/outposts.mjs.
    for (const [id, name, desc] of [['Tavern_Tale', 'MOD_VOY_ITEM_TAVERN_TALE_NAME', 'MOD_VOY_ITEM_TAVERN_TALE_DESC'], ['Sailors_Rumour', 'MOD_VOY_ITEM_SAILORS_RUMOUR_NAME', 'MOD_VOY_ITEM_SAILORS_RUMOUR_DESC'], ['Starlit_Chart', 'MOD_VOY_ITEM_STARLIT_CHART_NAME', 'MOD_VOY_ITEM_STARLIT_CHART_DESC'], ['Tent', 'MOD_VOY_ITEM_TENT_NAME', 'MOD_VOY_ITEM_TENT_DESC']]) {
      const it = game.items.getObjectByID(`voyage:${id}`);
      if (it === undefined) continue;
      it._name = getLangString(name);
      it._customDescription = getLangString(desc);
      it._modifiedDescription = undefined;
    }
    const category = game.shop.categories.getObjectByID('voyage:Voyage');
    if (category !== undefined) category._name = getLangString('MOD_VOY_SHOP_CATEGORY');
  } catch (e) { console.error('[Voyage] data names not translated', e); }

  // The loader calls a setting's onChange(newValue, oldValue) BEFORE it stores newValue, so section.get()
  // inside the handler still returns the old value. Each handler therefore records the new value itself.
  // Four sections (build .387, the user; the alpha report: 17 entries in one 1,929 px list): Rules, Travel, Display,
  // Keys. The game stores a value under its section's name, so the split set the test saves back to the defaults
  // once (Voyage had no release). The names stay English: they key the save.
  const SECTION_OF = { rules: 'Rules', strictness: 'Rules', zones: 'Rules', combat: 'Rules', trade: 'Rules', provisions: 'Rules',
    timedTravel: 'Travel', weather: 'Travel', night: 'Travel', nightShift: 'Travel',
    overlay: 'Display', mapMotion: 'Display', bookOpening: 'Display', journalKey: 'Keys', centreKey: 'Keys', mapKey: 'Keys' };
  const sections = Object.fromEntries(['Rules', 'Travel', 'Display', 'Keys'].map((n) => [n, ctx.settings.section(n)]));
  const sectionOf = (name) => sections[SECTION_OF[name]] ?? sections.Rules;
  const live = {};
  // Dev builds only: a Creator Toolkit zip is not in the game save (confirmed with voyageDev.saveCheck(),
  // 15 Oct 2026), so its settings reset on every reload. A mirror in localStorage, one entry per character (save slot + character name), restores
  // them on character load. Player builds leave this out and rely on the game save.
  const devSettingsKey = () => {
    try { return `voyage-dev-settings:${currentCharacter}:${game.characterName}`; } catch { return undefined; }
  };
  const devSettings = {
    read() {
      const key = devSettingsKey();
      if (key === undefined) return {};
      try { return JSON.parse(localStorage.getItem(key) ?? '{}') ?? {}; } catch { return {}; }
    },
    write(name, v) {
      const key = DEV && state.mode !== 'dormant' ? devSettingsKey() : undefined; // only once a character is loaded
      if (key === undefined) return;
      try { localStorage.setItem(key, JSON.stringify({ ...this.read(), [name]: v })); } catch {}
    },
  };
  const onChange = (name) => (newValue) => { live[name] = newValue; devSettings.write(name, newValue); state.onSettingsChange(); };
  const value = (name) => live[name] ?? sectionOf(name).get(name);
  const flag = (name) => value(name) !== false;
  // A hint may be a DOM node (the loader appends it): the Strictness hint puts each mode on its own line, and its
  // class lets css/voyage.css space the dropdown below it.
  const strictnessHint = document.createElement('span');
  strictnessHint.className = 'voyage-setting-hint';
  strictnessHint.append(getLangString('MOD_VOY_SETTING_STRICTNESS_HINT_STRICT'), document.createElement('br'), getLangString('MOD_VOY_SETTING_STRICTNESS_HINT_RELAXED'));
  const entries = [
    { type: 'switch', name: 'rules', label: getLangString('MOD_VOY_SETTING_RULES'), hint: getLangString('MOD_VOY_SETTING_RULES_HINT'), default: true, onChange: onChange('rules') },
    { type: 'dropdown', name: 'strictness', label: getLangString('MOD_VOY_SETTING_STRICTNESS'), hint: strictnessHint,
      options: [{ value: 'strict', display: getLangString('MOD_VOY_SETTING_STRICTNESS_STRICT') }, { value: 'relaxed', display: getLangString('MOD_VOY_SETTING_STRICTNESS_RELAXED') }], default: 'strict', onChange: onChange('strictness') },
    { type: 'switch', name: 'zones', label: getLangString('MOD_VOY_SETTING_ZONES'), hint: getLangString('MOD_VOY_SETTING_ZONES_HINT'), default: true, onChange: onChange('zones') },
    { type: 'switch', name: 'combat', label: getLangString('MOD_VOY_SETTING_COMBAT'), hint: getLangString('MOD_VOY_SETTING_COMBAT_HINT'), default: true, onChange: onChange('combat') },
    { type: 'switch', name: 'trade', label: getLangString('MOD_VOY_SETTING_TRADE'), hint: getLangString('MOD_VOY_SETTING_TRADE_HINT'), default: true, onChange: onChange('trade') },
    { type: 'switch', name: 'provisions', label: getLangString('MOD_VOY_SETTING_PROVISIONS'), hint: getLangString('MOD_VOY_SETTING_PROVISIONS_HINT'), default: true, onChange: onChange('provisions') },
    { type: 'switch', name: 'timedTravel', label: getLangString('MOD_VOY_SETTING_TIMED'), hint: getLangString('MOD_VOY_SETTING_TIMED_HINT'), default: true, onChange: onChange('timedTravel') },
    { type: 'switch', name: 'weather', label: getLangString('MOD_VOY_SETTING_WEATHER'), hint: getLangString('MOD_VOY_SETTING_WEATHER_HINT'), default: true, onChange: onChange('weather') },
    { type: 'switch', name: 'night', label: getLangString('MOD_VOY_SETTING_NIGHT'), hint: getLangString('MOD_VOY_SETTING_NIGHT_HINT'), default: true, onChange: onChange('night') },
    { type: 'number', name: 'nightShift', label: getLangString('MOD_VOY_SETTING_NIGHT_SHIFT'), hint: getLangString('MOD_VOY_SETTING_NIGHT_SHIFT_HINT'), default: 0, min: -12, max: 12, onChange: onChange('nightShift') },
    { type: 'switch', name: 'overlay', label: getLangString('MOD_VOY_SETTING_OVERLAY'), hint: getLangString('MOD_VOY_SETTING_OVERLAY_HINT'), default: true, onChange: onChange('overlay') },
    { type: 'switch', name: 'mapMotion', label: getLangString('MOD_VOY_SETTING_MAP_MOTION'), hint: getLangString('MOD_VOY_SETTING_MAP_MOTION_HINT'), default: true, onChange: onChange('mapMotion') },
    { type: 'switch', name: 'bookOpening', label: getLangString('MOD_VOY_SETTING_BOOK_OPENING'), hint: getLangString('MOD_VOY_SETTING_BOOK_OPENING_HINT'), default: false, onChange: onChange('bookOpening') },
    { type: 'text', name: 'journalKey', label: getLangString('MOD_VOY_SETTING_JOURNAL_KEY'), hint: getLangString('MOD_VOY_SETTING_JOURNAL_KEY_HINT'), default: 'J', maxLength: 1, onChange: onChange('journalKey') },
    { type: 'text', name: 'centreKey', label: getLangString('MOD_VOY_SETTING_CENTRE_KEY'), hint: getLangString('MOD_VOY_SETTING_CENTRE_KEY_HINT'), default: 'G', maxLength: 1, onChange: onChange('centreKey') },
    { type: 'text', name: 'mapKey', label: getLangString('MOD_VOY_SETTING_MAP_KEY'), hint: getLangString('MOD_VOY_SETTING_MAP_KEY_HINT'), default: 'M', maxLength: 1, onChange: onChange('mapKey') },
  ];
  for (const name of Object.keys(sections)) sections[name].add(entries.filter((e) => SECTION_OF[e.name] === name));

  /** The game's offline loop (tab in the background, or back after a while): see state.onSettingsChange. */
  const offline = {
    held: 0,
    started: 0,
    active() { try { return game._isInOnlineLoop === false; } catch { return false; } },
  };
  ctx.patch(Game, 'enterOfflineLoop').after(function () {
    try {
      offline.held = 0;
      offline.started = performance.now();
      log(`offline loop entered: replaying ${Math.round((Date.now() - this.tickTimestamp) / 1000)} s, action ${this.activeAction?.id ?? 'none'}`);
    } catch (e) { console.error('[Voyage] offline entry hook failed open', e); }
  });
  ctx.patch(Game, 'exitOfflineLoop').after(function () {
    try {
      const held = offline.held;
      offline.held = 0;
      log(`offline loop left after ${Math.round(performance.now() - offline.started)} ms; ${held} held refresh(es)`);
      if (held > 0) setTimeout(() => state.onSettingsChange(), 0);
    } catch (e) { console.error('[Voyage] offline exit hook failed open', e); }
  });

  /** Shared runtime state. mode: 'dormant' until the save is checked, then 'strict' or 'relaxed' (table mismatch). */
  const state = {
    mode: 'dormant',
    terrain: undefined,
    reasons: [],
    listeners: [],
    settings: {
      overlay: () => flag('overlay'),
      rules: () => flag('rules'),
      strictness: () => (value('strictness') === 'relaxed' ? 'relaxed' : 'strict'),
      combat: () => flag('combat'),
      zones: () => flag('zones'),
      trade: () => flag('trade'),
      provisions: () => flag('provisions'),
      night: () => flag('night'),
      weather: () => flag('weather'),
      timedTravel: () => flag('timedTravel'),
      centreKey: () => String(value('centreKey') ?? '').trim().toUpperCase(),
      journalKey: () => String(value('journalKey') ?? '').trim().toUpperCase(),
      mapMotion: () => flag('mapMotion'),
      bookOpening: () => value('bookOpening') === true,
      mapKey: () => String(value('mapKey') ?? '').trim().toUpperCase(),
      nightShift: () => { const v = Number(value('nightShift')); return Number.isFinite(v) ? Math.max(-12, Math.min(12, Math.round(v))) : 0; },
    },
    onSettingsChange() {
      // Offline catch-up: the game replays the missed ticks behind its "offline progress" box, and a survey or a
      // trader leaving inside it would redraw the map, panel and sidebar and run the stop checks once per event.
      // Hold them; they run once when the game leaves the offline loop (patch below).
      if (offline.active()) { offline.held++; return; }
      this.listeners.forEach((fn) => { try { fn(); } catch (e) { log(e); } });
    },
    /** True while the gates apply: table trusted, rules on, not in Golbin Raid, tutorial done. */
    active() {
      try { return this.mode === 'strict' && this.settings.rules() && !game.isGolbinRaid && game.tutorial?.complete !== false; } catch { return false; }
    },
    /**
     * Options for rules.rateAt: the strictness and a neighbour lookup for grace. Grace comes only from a neighbour you
     * know (surveyed, or known to the mod by a visit, chart or rumour): you can't work by a town you have not found
     * (the user, 19 Oct 2026). `all`: every neighbour, for what a hex offers once known (the compass, the Random start).
     */
    ruleOpts({ all = false } = {}) {
      const terrain = this.terrain;
      return { strictness: this.settings.strictness(), neighbours: terrain ? (rec) => (all ? terrain.neighbours(rec.q, rec.r) : this.knownNeighbours(rec)) : undefined };
    },
    /** The neighbours of a record that you know (grace: trade, combat, loading, the market next door). */
    knownNeighbours(rec) {
      if (rec === undefined || this.terrain === undefined) return [];
      const k = this.knowledge;
      const all = this.terrain.neighbours(rec.q, rec.r);
      return k === undefined ? all : all.filter((n) => k.isKnown(n));
    },
    /** The player's hex on the active map, or undefined. Never cached: position is read live. */
    position() {
      // The Set off popup asks "what works there" as if you stood on the destination (voyage-clock.mjs).
      if (this.posOverride !== undefined) return this.posOverride;
      try {
        const map = game.cartography?.activeMap ?? game.cartography?.worldMaps.getObjectByID(table.meta.mapId);
        return map?.playerPosition;
      } catch { return undefined; }
    },
    recordAt(hex) { return hex && this.terrain ? this.terrain.get(hex.q, hex.r) : undefined; },
    /** nearest KNOWN hex where a gated skill works (indexed + memoised, see knowledge.mjs). */
    nearestFor: () => undefined,
    /** nearest hex where a gated skill works, known or not (the compass). */
    anyNearestFor: () => undefined,
    /** rate 0..1 of a gated skill on the player's hex; set by gate.mjs. */
    rateAt: () => 1,
  };

  // Things for after the tutorial (the user, 16 Oct 2026): the welcome popup with the compass and purse, and the free
  // unlock notice. Run now when the tutorial is done (or the mode has none); otherwise when it completes, once the
  // game's own "tutorial complete" box is closed (SwalLocale.fire would replace it).
  const tutorialWaiters = [];
  const runWhenNoModal = (fns, tries = 0) => {
    let open = false;
    try { open = typeof Swal !== 'undefined' && Swal.isVisible(); } catch {}
    if (open && tries < 600) { setTimeout(() => runWhenNoModal(fns, tries + 1), 500); return; }
    for (const fn of fns) { try { fn(); } catch (e) { console.error(`[Voyage] after-tutorial step ${fn?.name || typeof fn} failed`, e); } }
  };
  state.afterTutorial = (fn) => {
    // A new character's tutorial skip logged "fn is not a function" (16 Oct 2026): name the caller if it happens again.
    if (typeof fn !== 'function') { console.error(`[Voyage] afterTutorial wants a function, got ${typeof fn}`, new Error().stack); return; }
    let done = true;
    try { done = game.tutorial?.complete !== false; } catch {}
    if (done) fn(); else { tutorialWaiters.push(fn); log(`waiting for the tutorial to end: ${fn.name || 'step'}`); }
  };
  // A notification sent while a popup is open goes unseen (the kit's sat under the welcome, new character, 16 Oct
  // 2026): wait a moment for a popup about to open, then until none is.
  state.whenNoModal = (fn) => setTimeout(() => runWhenNoModal([fn]), 800);
  /**
   * Opens a game page from one of our buttons. The game's own toggle flips the phone menu, which is right for a menu
   * link but opens it from a page button, so ours pass false and close an open menu here (16 Oct 2026: "Go to map" from
   * a skill's lock popup, raised by a tap in the menu, opened the map under the still-open menu).
   */
  state.openPage = (page) => {
    if (page === undefined) return;
    changePage(page, -1, undefined, false, false);
    try {
      const narrow = !window.matchMedia('(min-width: 992px)').matches;
      if (narrow && document.getElementById('page-container')?.classList.contains('sidebar-o-xs')) One.layout('sidebar_close');
    } catch (e) { log('menu close failed', e); }
  };
  ctx.patch(Tutorial, 'completeTutorial').after(() => {
    const fns = tutorialWaiters.splice(0);
    if (fns.length > 0) setTimeout(() => runWhenNoModal(fns), 500);
  });

  ctx.loadStylesheet('css/voyage.css');
  const overlay = await ctx.loadModule('src/overlay.mjs');
  const gate = await ctx.loadModule('src/gate.mjs');
  const herePanel = await ctx.loadModule('src/here-panel.mjs');
  const knowledgeMod = await ctx.loadModule('src/knowledge.mjs');
  // Not a rule: restarts the game loop when the game's own focus event is missed (src/focus-fix.mjs).
  try { (await ctx.loadModule('src/focus-fix.mjs')).install(ctx, { log }); } catch (e) { console.error('[Voyage] focus fix failed', e); }
  // Melvor's tooltips for the page and the Here panel (build .160, the user).
  try { state.tips = (await ctx.loadModule('src/tips.mjs')).install(ctx, { log }); } catch (e) { console.error('[Voyage] tooltips failed', e); }
  try { (await ctx.loadModule('src/map-keys.mjs')).install(ctx, { key: () => value('centreKey'), journalKey: () => value('journalKey'), mapKey: () => value('mapKey'), openPage: (p) => state.openPage(p), journal: () => state.journal, log }); } catch (e) { console.error('[Voyage] map keys failed', e); }
  const helpLayout = await ctx.loadModule('src/help-layout.mjs');
  // Big GP, XP and bank counts in a short form (12.3K, 2.5M), rounded down, so a "You have" never reads as more;
  // fractions in the player's decimal mark.
  const { shortNumber, decimal } = await ctx.loadModule('src/number-format.mjs');
  // Every popup we open runs this on render: skill names get their icon and bold.
  const skillNamesMod = await ctx.loadModule('src/skill-names.mjs');
  state.popupDidRender = skillNamesMod.didRender;
  // Worker Folks' API (phase 6): undefined without Worker Folks or with one older than Voyage drives; said once.
  const folksLink = await ctx.loadModule('src/folks-link.mjs');
  let folksWarned = false;
  state.folksApi = () => folksLink.folksApi({ warn: (msg) => { if (!folksWarned) { folksWarned = true; console.warn(`[Voyage] ${msg}`); } } });
  state.rankName = folksLink.rankName;
  state.folkDoing = folksLink.folkDoing;
  state.skillNames = skillNamesMod.skillNames;
  const compassMod = await ctx.loadModule('src/compass.mjs');
  const traderMod = await ctx.loadModule('src/trader.mjs');
  const stranded = await ctx.loadModule('src/stranded.mjs');
  const voyagePage = await ctx.loadModule('src/voyage-page.mjs');
  const pageLayout = { mod: await ctx.loadModule('src/page-layout.mjs'), L: await ctx.loadModule('src/layout-model.mjs') };
  const markers = await ctx.loadModule('src/markers.mjs');
  const shipMod = await ctx.loadModule('src/ship.mjs');
  const unlocks = await ctx.loadModule('src/unlocks.mjs');
  const storesModel = await ctx.loadModule('src/stores-model.mjs');
  const storesMod = await ctx.loadModule('src/stores.mjs');
  const holdMod = await ctx.loadModule('src/hold.mjs');
  // Pitch from Firemaking (3d). A failure leaves repairs short of Pitch, nothing else.
  try { (await ctx.loadModule('src/pitch.mjs')).install(ctx, { shipModel, log }); } catch (e) { console.error('[Voyage] Pitch failed', e); }
  knowledgeMod.install(ctx, { state, terrainMod, log });
  state.overlay = overlay.install(ctx, { state, terrainMod, log });
  state.zoneTable = zoneTable;
  gate.install(ctx, { state, rules, terrainMod, zones: zonesMod, helpLayout, log });
  compassMod.install(ctx, { state, rules, terrainMod, model, helpLayout, log });
  traderMod.install(ctx, { state, rules, terrainMod, stranded, helpLayout, log });
  state.herePanel = herePanel.install(ctx, { state, rules, terrainMod, storesModel, model, helpLayout, shortNumber, log });
  /** The Voyage skill object, or undefined when it did not register. */
  const voyageSkill = () => { try { return voyageSkillOk ? game.skills.getObjectByID(model.SKILL_ID) : undefined; } catch { return undefined; } };
  state.voyageSkill = voyageSkill;
  unlocks.install(ctx, { state, log });
  // The ship keeps its state in the skill's save, so without the skill it stays inert and travel is vanilla.
  const ship = shipMod.install(ctx, { state, model, shipModel, terrainMod, helpLayout, log });
  // Careening (the flat mechanics) ends on the skill's passive tick, online and offline.
  { const s = voyageSkill(); if (s !== undefined) s.shipTick = () => ship.careenTick(); }
  state.markers = markers.install(ctx, { state, log });
  // Land upgrades and the Crossroads Sign (build .162). A failure leaves the game's prices and buffs.
  try {
    const landModel = await ctx.loadModule('src/land-model.mjs');
    (await ctx.loadModule('src/land.mjs')).install(ctx, { state, landModel, shipModel, log });
    state.landModel = landModel;
  } catch (e) { console.error('[Voyage] land upgrades failed to load; the rest runs', e); state.land = undefined; }
  // Provisions (phase 3c): the stores every move draws on. Inert without the skill, like the ship.
  const stores = storesMod.install(ctx, { state, model, storesModel, shipModel, terrainMod, stranded, helpLayout, shortNumber, log });
  // Gear, relics and the Albatross (4.31): the effects the stores, the clock, cargo and the pirates read, and the rolls
  // after a landed move. A failure: the gear's items do nothing.
  try { gearMod.install(ctx, { state, G: gearModel, log }); } catch (e) { console.error('[Voyage] gear failed to load; its effects are off', e); state.gear = undefined; }
  // The crew (phase 6c): Folks who go along with you, in berths, eating from the stores. A failure leaves them ashore.
  let crew;
  try {
    const crewModel = await ctx.loadModule('src/crew-model.mjs');
    crew = (await ctx.loadModule('src/crew.mjs')).install(ctx, { state, CM: crewModel, shipModel, terrainMod, helpLayout, log });
    state.crewModel = crewModel;
  } catch (e) { console.error('[Voyage] the crew failed to load; Folks stay ashore', e); state.crew = undefined; }
  // Folks walking alone (phase 6d): the road over known land and the walks in the save. A failure: nobody walks.
  try {
    state.walks = (await ctx.loadModule('src/walks.mjs')).install(ctx, { state, W: await ctx.loadModule('src/walk-model.mjs'), S: storesModel, C: await ctx.loadModule('src/clock-model.mjs'), helpLayout, log });
    const s = voyageSkill();
    if (s !== undefined) s.walks = state.walks;
  } catch (e) { console.error('[Voyage] walking failed to load; Folks stay put', e); state.walks = undefined; }
  // Outposts (phase 6e): a Tent pitched where a Folk works makes the hex a camp with a store. A failure: no tents.
  try {
    (await ctx.loadModule('src/outposts.mjs')).install(ctx, { state, O: outpostModel, terrainMod, helpLayout, log });
    state.outpostModel = outpostModel;
    // A tent's build steps run on the skill's passive tick, online and offline (build .396).
    { const s = voyageSkill(); if (s !== undefined) s.outpostTick = () => state.outposts?.passiveTick?.(); }
  } catch (e) { console.error('[Voyage] outposts failed to load; no tents', e); state.outposts = undefined; }
  // Shop entries only Folks can use (the user, 26 Oct 2026): without Worker Folks the Tent and Walking Orders sold and
  // did nothing. They stay registered, so a save that bought one loads as before; the shop hides them and a buy from
  // anywhere else is refused. The guards register on mods loaded, before the shop first draws. Each tab of the shop
  // decides what it lists (ShopTabMenu.shouldShowItem, not ShopMenu: build .413 patched that and it threw, so neither
  // patch took); each patch has its own try, so one failing leaves the other.
  const folksOnly = {
    [`voyage:${outpostModel.TENT.id}`]: () => state.folksGuarded === true,
    'voyage:Walking_Orders': () => state.folksGuarded === true && state.walks?.canWalk?.() === true,
  };
  const unusable = (p) => { const ok = folksOnly[p?.id]; return ok !== undefined && !ok(); };
  try {
    ctx.patch(ShopTabMenu, 'shouldShowItem').after(function (shown, p) { try { return unusable(p) ? 0 : undefined; } catch { return undefined; } });
  } catch (e) { console.error('[Voyage] Folks-only shop entries not hidden', e); }
  try {
    ctx.patch(Shop, 'buyItemOnClick').replace(function (original, p, ...rest) {
      try { if (unusable(p)) { log(`${p.id} refused: no Worker Folks to use it`); return undefined; } } catch {}
      return original(p, ...rest);
    });
  } catch (e) { console.error('[Voyage] Folks-only shop buys not refused', e); }
  // Travel traits (phase 6f): Voyage's ten traits in Worker Folks' slots (its API 5). A failure: no travel traits.
  try {
    const traits = (await ctx.loadModule('src/folk-traits.mjs')).install(ctx, { state, FT: await ctx.loadModule('src/folk-traits-model.mjs'), S: storesModel, log });
    const s = voyageSkill();
    if (s !== undefined) s.folkTraits = traits;
  } catch (e) { console.error('[Voyage] travel traits failed to load', e); state.folkTraits = undefined; }
  // The ship's hold (build .72): bank items kept aboard, reached at the ship.
  holdMod.install(ctx, { state, shipModel, helpLayout, log });
  // Events that ask (the flat mechanics): pirates on the open sea, a stowaway aboard. A failure: no events.
  try {
    const events = (await ctx.loadModule('src/events.mjs')).install(ctx, { state, EM: await ctx.loadModule('src/events-model.mjs'), S: storesModel, shipModel, helpLayout, rankName: folksLink.rankName, shortNumber, decimal, log });
    const s = voyageSkill();
    if (s !== undefined) s.events = events;
  } catch (e) { console.error('[Voyage] events failed to load', e); state.events = undefined; }
  // Encounters (4.33): bandits and pirates as a card game. A failure: no encounters.
  try {
    const F = (await ctx.loadModule('src/encounter-fight.mjs')).install(ctx, { state, log });
    const encounters = (await ctx.loadModule('src/encounters.mjs')).install(ctx, { state, E: await ctx.loadModule('src/encounter-model.mjs'), R: await ctx.loadModule('src/encounter-rules-model.mjs'), L: await ctx.loadModule('src/encounter-loot-model.mjs'), D: await ctx.loadModule('src/deck-model.mjs'), F, EM: await ctx.loadModule('src/events-model.mjs'), S: storesModel, terrainMod, shortNumber, log });
    const s = voyageSkill();
    if (s !== undefined) s.encounters = encounters;
    // The Deck block on the Voyage page (slice 3): the deck, presets, charms and the trick book.
    state.deck = (await ctx.loadModule('src/deck.mjs')).install(ctx, { state, F, log });
  } catch (e) { console.error('[Voyage] encounters failed to load', e); state.encounters = undefined; state.deck = undefined; }
  const page = voyageSkillOk ? voyagePage.install(ctx, { state, model, shipModel, storesModel, rules, pageLayout, helpLayout, helpHtml: helpLayout.helpHtml, HELP_WIDTH: helpLayout.HELP_WIDTH, shortNumber, decimal, log }) : undefined;
  // The Captain's Journal (phase 4): its "How it works" chapters are the page's "?" topics. A failure leaves the "?"
  // popups and everything else as they were.
  state.helpSections = page?.helpSections;
  try {
    const journalModel = await ctx.loadModule('src/journal-model.mjs');
    (await ctx.loadModule('src/journal.mjs')).install(ctx, { state, model, journalModel, shipModel, storesModel, rules, terrainMod, shortNumber, log });
  } catch (e) { console.error('[Voyage] the journal failed to load; the rest runs', e); state.journal = undefined; }
  // The journal's heat maps (build .114); without them the entries simply have no heat map button.
  try { (await ctx.loadModule('src/heatmap.mjs')).install(ctx, { state, terrainMod, log }); } catch (e) { log('heat maps failed to load', e); state.heatmap = undefined; }
  // Plan a voyage (build .119): the planner block on the Voyage page, Sail! and the action on arrival.
  if (voyageSkillOk) {
    try {
      const planModel = await ctx.loadModule('src/plan-model.mjs');
      (await ctx.loadModule('src/planner.mjs')).install(ctx, { state, model, planModel, storesModel, terrainMod, helpLayout, shortNumber, log });
    } catch (e) { console.error('[Voyage] the planner failed to load; the rest runs', e); state.planner = undefined; }
    // The ship's clock (phase 5a): travel takes time. A failure leaves phase 4's instant travel.
    try {
      const clockModel = await ctx.loadModule('src/clock-model.mjs');
      const clock = (await ctx.loadModule('src/voyage-clock.mjs')).install(ctx, { state, C: clockModel, storesModel, shipModel, rules, terrainMod, helpLayout, shortNumber, log });
      const s = voyageSkill();
      if (s !== undefined) s.clock = clock;
      // The route line on the map (build .272): what is left to sail, a light running along it, the walked part dim.
      try { (await ctx.loadModule('src/route-line.mjs')).install(ctx, { state, C: clockModel, log }); } catch (e) { log('route line failed to load', e); }
      // Folks walking alone on the map (6d): a boot badge where each stands, its road ahead dashed.
      try { (await ctx.loadModule('src/walk-line.mjs')).install(ctx, { state, C: clockModel, log }); } catch (e) { log('walk line failed to load', e); }
      // The pin moves under way (build .341): the traveller walks, the vessel rolls. A failure leaves it still.
      try { state.pinMotion = (await ctx.loadModule('src/pin-motion.mjs')).install(ctx, { state, M: await ctx.loadModule('src/pin-motion-model.mjs'), log }); } catch (e) { log('pin motion failed to load', e); }
      // Voyages into the fog (phase 5b): the voyage surveys its own way. A failure leaves known routes only.
      try {
        const fogModel = await ctx.loadModule('src/fog-model.mjs');
        (await ctx.loadModule('src/voyage-fog.mjs')).install(ctx, { state, F: fogModel, C: clockModel, log });
      } catch (e) { console.error('[Voyage] fog voyages failed to load; known routes only', e); state.fog = undefined; }
      // Adrift at sea (phase 5b part two): the drift, tows and the sea folk. A failure leaves phase 4's floors at sea.
      try {
        const adriftModel = await ctx.loadModule('src/adrift-model.mjs');
        const adrift = (await ctx.loadModule('src/adrift.mjs')).install(ctx, { state, A: adriftModel, C: clockModel, shipModel, terrainMod, helpLayout, shortNumber, log });
        if (s !== undefined) s.adrift = adrift;
      } catch (e) { console.error('[Voyage] Adrift failed to load; the old floors at sea stand', e); state.adrift = undefined; }
      // Weather (phase 5c-1): Township's season, degrees per hex, the bands, the harvest and the winter ice. A failure
      // leaves the year without weather.
      try {
        const weatherModel = await ctx.loadModule('src/weather-model.mjs');
        const weather = (await ctx.loadModule('src/weather.mjs')).install(ctx, { state, W: weatherModel, shipModel, terrainMod, helpLayout, decimal, log });
        if (s !== undefined) s.weather = weather;
      } catch (e) { console.error('[Voyage] weather failed to load; no seasons on the map', e); state.weather = undefined; }
    } catch (e) { console.error('[Voyage] the ship\'s clock failed to load; travel stays instant', e); state.clock = undefined; state.timed = () => false; }
  }
  // Markets with prices (phase 4): sale prices by market, the bank's Sell line, the journal's ledger.
  try {
    const marketModel = await ctx.loadModule('src/market-model.mjs');
    (await ctx.loadModule('src/market.mjs')).install(ctx, { state, MM: marketModel, rules, hexes: table.hexes, shortNumber, log });
  } catch (e) { console.error('[Voyage] market prices failed to load; the rest runs', e); state.market = undefined; }
  // Cargo runs (phase 4): the harbour board, the runs and the sealed cargo in the hold.
  if (voyageSkillOk) {
    try {
      const cargoModel = await ctx.loadModule('src/cargo-model.mjs');
      (await ctx.loadModule('src/cargo.mjs')).install(ctx, { state, M: cargoModel, shipModel, hexes: table.hexes, dungeonIds: table.meta.dungeons ?? {}, shortNumber, log });
      // The rest of phase 4: sea charts and rumours, Voyage tasks (the board's tabs), Random
      // start. Each fails on its own: the board then simply lacks that tab.
      const chartsModel = await ctx.loadModule('src/charts-model.mjs');
      try {
        (await ctx.loadModule('src/charts.mjs')).install(ctx, { state, CM: chartsModel, model, rules, terrainMod, helpLayout, hexes: table.hexes, shortNumber, log });
      } catch (e) { console.error('[Voyage] sea charts and rumours failed to load; the rest runs', e); state.charts = undefined; }
      try {
        const tasksModel = await ctx.loadModule('src/tasks-model.mjs');
        (await ctx.loadModule('src/tasks.mjs')).install(ctx, { state, TM: tasksModel, CM: chartsModel, M: cargoModel, shipModel, terrainMod, stranded, hexes: table.hexes, shortNumber, log });
      } catch (e) { console.error('[Voyage] Voyage tasks failed to load; the rest runs', e); state.tasks = undefined; }
      try {
        const startModel = await ctx.loadModule('src/start-model.mjs');
        (await ctx.loadModule('src/start.mjs')).install(ctx, { state, SM: startModel, M: cargoModel, rules, shipModel, hexes: table.hexes, log });
      } catch (e) { console.error('[Voyage] Random start failed to load; the rest runs', e); state.startChoice = undefined; }
    } catch (e) { console.error('[Voyage] cargo runs failed to load; the rest runs', e); state.cargo = undefined; }
  }
  const markPage = () => { const s = voyageSkill(); if (s !== undefined) s.renderQueue.page = true; };
  state.listeners.push(markPage);

  // XP per hex travelled (decided 15 Oct 2026), provisions (3c) and the ship following the move. movePlayer is the one
  // vanilla travel path; it returns early when the costs are not owned, so all three apply only to a move that really
  // landed. The stores are checked first: a move they can't pay is refused before the game takes any GP. Free moves
  // (ignoreCosts: game events, dev teleports) cost no provisions and give no XP but still carry the ship. The path
  // runs from the destination (index 0) back to the start. The steps are read before the move: the homeward rule
  // depends on the ship's reach where the move began.
  // Night sight (the flat mechanics): at night, on the sea hex a move ended on, the game's sight range is one more
  // when that hex was lit and one less when it was dark (stores-model nightSight). Day, land or another hex: as is.
  let nightSight;
  try {
    ctx.patch(WorldMap, 'sightRange').get(function (next) {
      const base = next();
      try {
        const ns = nightSight;
        const pos = this.playerPosition;
        if (ns === undefined || pos === undefined || pos.q !== ns.q || pos.r !== ns.r || state.stores?.night?.() !== true) return base;
        return Math.max(0, base + ns.d);
      } catch { return base; }
    });
  } catch (e) { log('night sight not patched', e); }
  if (voyageSkillOk) {
    ctx.patch(Cartography, 'movePlayer').replace(function (original, path, ignoreCosts, ...rest) {
      const from = this.activeMap?.playerPosition;
      // A band met (encounters.mjs) is answered first: no move while its popup waits (the clock's own steps aside).
      try { if (!ignoreCosts && state.clock?.stepping?.() !== true && state.encounters?.fightOpen?.() === true) { state.encounters.refuse(); state.encounters.open(); return; } } catch (e) { log('encounter check failed', e); }
      let planned;
      let steps;
      try {
        if (!ignoreCosts) planned = stores.planFor(path);
        steps = planned?.steps ?? (Array.isArray(path) ? ship.stepsOf(path) : undefined);
      } catch (e) { log('travel steps failed', e); }
      // Berths (phase 6c): a crew bigger than the vessel a step is sailed in stays put, the Provisions setting or not.
      let berths;
      try { if (!ignoreCosts && state.active()) berths = crew?.berthRefusal(steps); } catch (e) { log('berth check failed', e); }
      if (berths !== undefined) { crew.refuseBerths(berths); return; }
      // A vessel hauled out to careen (the flat mechanics) can't sail.
      let careen;
      try { if (!ignoreCosts && state.active()) careen = ship.careenRefusal(steps); } catch (e) { log('careen check failed', e); }
      if (careen !== undefined) { ship.refuseCareen(careen); return; }
      if (planned !== undefined && !planned.plan.ok) { stores.refuse(planned, path); return; }
      const gpBefore = game.gp.amount;
      // Night sight (the flat mechanics): set before the move, so the game draws the new hex's sight with it.
      const sightBefore = nightSight;
      try { if (!ignoreCosts) { const d = stores.sightOf(planned); const dest = path?.[0]; nightSight = d !== 0 && dest !== undefined ? { q: dest.q, r: dest.r, d } : undefined; } } catch (e) { log('night sight failed', e); }
      const result = original(path, ignoreCosts, ...rest);
      if (this.activeMap?.playerPosition !== path?.[0]) nightSight = sightBefore;
      try {
        const dest = path?.[0];
        if (dest !== undefined && from !== dest && this.activeMap?.playerPosition === dest) {
          stores.afterMove(planned);
          // A hungry hex costs more of the game's GP (the flat mechanics): its own share of what the move just took, by
          // each step's price (an instant move of many steps), as the Set off popup counts it.
          try {
            const hungry = planned?.plan.hungry ?? [];
            const n = steps?.length ?? 0;
            const gpOf = (a, b) => { try { return this.getTravelCosts([a, b]).getCurrencyQuantityArray().reduce((s, { currency, quantity }) => s + (currency === game.gp ? quantity : 0), 0); } catch { return 0; } };
            // Step i runs from path[n - i] to path[n - 1 - i] (the path from the destination back); a hop is one step
            // over many hexes, so only a path of one hex a step is priced step by step.
            // Charged as the Set off popup counts it (build .387, the user): each hungry step at its own price, by the
            // same pairs of path hexes the popup prices (voyage-clock routeInfo), a free or folded step included. Until
            // .387 it was the hungry steps' share of the GP the move took, so a free step paid nothing.
            const stepGp = (i) => { const a = path?.[path.length - 2 - i]; const b = path?.[path.length - 1 - i]; return a === undefined || b === undefined ? 0 : gpOf(a, b); };
            const extra = n > 0 ? Math.min(game.gp.amount, storesModel.hungryRouteGp(stepGp, hungry)) : 0;
            if (extra > 0) { game.gp.remove(extra); log(`${hungry.length} hungry hex(es): ${extra} GP more`); }
          } catch (e) { log('hungry surcharge failed', e); }
          // Hunger on the road (phase 6c): the hungry steps the stores just marked hurt the crew too.
          try { if (!ignoreCosts) crew?.afterMove(steps); } catch (e) { log('crew hunger failed', e); }
          // Travel traits (phase 6f): what the move teaches the Folks with you (a drift or a tow teaches nothing).
          try { if (!ignoreCosts) state.folkTraits?.moved?.(steps); } catch (e) { log('travel trait count failed', e); }
          if (!ignoreCosts && steps !== undefined) {
            // Discovery XP (the balance pass): the hexes stepped onto, start excluded, none under cloud.
            const entered = path.slice(0, -1).filter((hex) => !terrainMod.isCloud(state.terrain?.get?.(hex.q, hex.r)));
            const xpBefore = voyageSkill()?.xp ?? 0;
            const paid = voyageSkill()?.onTravelled(steps, entered);
            if (paid !== undefined) state.pace?.({ ...paid, gp: Math.max(0, gpBefore - game.gp.amount), xpBefore });
            state.weather?.stepped?.(steps);
            // Gear, relics and the Albatross (4.31): the relic and Lesser Relic rolls, the tablet charges and the mark rolls, one each per hex entered.
            try { state.gear?.afterMove?.(steps); } catch (e) { log('gear after move failed', e); }
            // Encounters (4.33): an instant move's hexes each roll for a band, met on arrival; a timed voyage's steps
            // roll in the clock, which holds for the answer.
            try { if (state.clock?.stepping?.() !== true) state.encounters?.moved?.(steps, path, Math.max(0, gpBefore - game.gp.amount)); } catch (e) { log('encounter roll failed', e); }
          }
          ship.afterMove(path);
        }
      } catch (e) { log('travel XP, stores or ship move failed', e); }
      return result;
    });
  }

  if (DEV) (await ctx.loadModule('src/dev.mjs')).install(ctx, { state, terrainMod, rules, model, journalModel: await ctx.loadModule('src/journal-model.mjs'), log });

  ctx.onCharacterLoaded(() => {
    if (DEV) {
      for (const [name, v] of Object.entries(devSettings.read())) {
        try { if (sectionOf(name).get(name) !== v) { sectionOf(name).set(name, v); log(`dev setting restored for ${devSettingsKey()}: ${name} = ${v}`); } } catch (e) { log(`dev setting ${name} not restored`, e); }
      }
    }
    try {
      const map = game.cartography?.worldMaps.getObjectByID(table.meta.mapId);
      const liveHexes = [];
      map?.forEach((hex) => liveHexes.push({ q: hex.q, r: hex.r, isWater: hex.isWater }));
      const check = terrainMod.checkTable(table, { mapId: map?.id, hexes: liveHexes });
      state.terrain = terrainMod.createTerrain(table);
      // The season's ice is laid before anything reads the sea (phase 5c-1).
      state.weather?.loaded?.();
      // The tents' camps over the table and the ice (phase 6e): after the ice, which is found from the table alone.
      state.outposts?.loaded?.();
      // Where you stand counts as visited, without XP (the balance pass; a new character or one moved by an event).
      try { const here = map?.playerPosition; if (here !== undefined && !terrainMod.isCloud(state.terrain.get(here.q, here.r))) voyageSkill()?.markHere(here); } catch (e) { log('visited mark failed', e); }
      const opts = () => state.ruleOpts();
      state.nearestFor = terrainMod.createNearestFinder(state.terrain, rules, state.knowledge, opts);
      state.anyNearestFor = terrainMod.createNearestFinder(state.terrain, rules, undefined, () => state.ruleOpts({ all: true }));
      state.mode = check.ok ? 'strict' : 'relaxed';
      state.reasons = check.reasons;
      log(`table ${table.meta.builtAt} (${table.meta.hexCount} hexes, hash ${table.meta.waterHash}): ${state.mode}`, check.reasons);
      if (!check.ok) {
        ctx.onInterfaceReady(() => {
          try { game.notifications.createErrorNotification('voyage:mismatch', getLangString('MOD_VOY_NOTICE_TABLE_MISMATCH')); } catch {}
        });
      }
      state.onSettingsChange();
    } catch (e) {
      console.error('[Voyage] load failed, staying dormant', e);
      state.mode = 'dormant';
    }
    // Voyage skill: XP once for the hexes travelled before it existed, then the page.
    try {
      const s = voyageSkill();
      if (s !== undefined) {
        if (page !== undefined) { s.pageRenderer = page.render; s.pageSignature = page.signature; }
        const xp = s.backfill(game.stats.Cartography.get(19 /* CartographyStats.HexesTravelled */));
        if (xp > 0) log(`Voyage backfill: ${xp} XP for earlier travels`);
        s.renderQueue.page = true;
      }
    } catch (e) {
      console.error('[Voyage] Voyage skill load failed', e);
    }
    // The ship: the one-time free dinghy for characters out on the water or overseas, then the markers.
    ship.loaded();
    // The one-time starter kit, after the tutorial.
    stores.loaded();
  });
}
