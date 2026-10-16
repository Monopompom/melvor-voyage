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

/** Bumped on every zip build so the console shows which build is running. */
export const BUILD = '2026-10-16.94';
/** Dev switch: true prints [Voyage] debug lines. Set to false for player builds. */
const DEV = true;

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
  // Items and shop entries (the compass). Registered before any character loads.
  try { await ctx.gameData.addPackage('data/package.json'); } catch (e) { console.error('[Voyage] data package failed; the compass is unavailable', e); }
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
    const category = game.shop.categories.getObjectByID('voyage:Voyage');
    if (category !== undefined) category._name = getLangString('MOD_VOY_SHOP_CATEGORY');
  } catch (e) { console.error('[Voyage] data names not translated', e); }

  // The Voyage skill (phase 3a): the class first, then the data (page, milestones) that references it. A failure here
  // leaves the skill out and everything else running.
  const model = await ctx.loadModule('src/voyage-model.mjs');
  const shipModel = await ctx.loadModule('src/ship-model.mjs');
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
        if (i >= 0 && m._milestoneID === undefined && '_name' in m) m._name = getLangString(`MOD_VOY_MILESTONE_${i + 1}`);
      });
    } catch (e) { console.error('[Voyage] milestone names not translated', e); }
    voyageSkillOk = true;
  } catch (e) { console.error('[Voyage] the Voyage skill failed to register; the rules still run', e); }

  // The loader calls a setting's onChange(newValue, oldValue) BEFORE it stores newValue, so section.get()
  // inside the handler still returns the old value. Each handler therefore records the new value itself.
  const section = ctx.settings.section('Voyage');
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
  const value = (name) => live[name] ?? section.get(name);
  const flag = (name) => value(name) !== false;
  // A hint may be a DOM node (the loader appends it): the Strictness hint puts each mode on its own line, and its
  // class lets css/voyage.css space the dropdown below it.
  const strictnessHint = document.createElement('span');
  strictnessHint.className = 'voyage-setting-hint';
  strictnessHint.append(getLangString('MOD_VOY_SETTING_STRICTNESS_HINT_STRICT'), document.createElement('br'), getLangString('MOD_VOY_SETTING_STRICTNESS_HINT_RELAXED'));
  section.add([
    { type: 'switch', name: 'overlay', label: getLangString('MOD_VOY_SETTING_OVERLAY'), hint: getLangString('MOD_VOY_SETTING_OVERLAY_HINT'), default: true, onChange: onChange('overlay') },
    { type: 'switch', name: 'rules', label: getLangString('MOD_VOY_SETTING_RULES'), hint: getLangString('MOD_VOY_SETTING_RULES_HINT'), default: true, onChange: onChange('rules') },
    { type: 'dropdown', name: 'strictness', label: getLangString('MOD_VOY_SETTING_STRICTNESS'), hint: strictnessHint,
      options: [{ value: 'strict', display: getLangString('MOD_VOY_SETTING_STRICTNESS_STRICT') }, { value: 'relaxed', display: getLangString('MOD_VOY_SETTING_STRICTNESS_RELAXED') }], default: 'strict', onChange: onChange('strictness') },
    { type: 'switch', name: 'zones', label: getLangString('MOD_VOY_SETTING_ZONES'), hint: getLangString('MOD_VOY_SETTING_ZONES_HINT'), default: true, onChange: onChange('zones') },
    { type: 'switch', name: 'combat', label: getLangString('MOD_VOY_SETTING_COMBAT'), hint: getLangString('MOD_VOY_SETTING_COMBAT_HINT'), default: true, onChange: onChange('combat') },
    { type: 'switch', name: 'trade', label: getLangString('MOD_VOY_SETTING_TRADE'), hint: getLangString('MOD_VOY_SETTING_TRADE_HINT'), default: true, onChange: onChange('trade') },
    { type: 'switch', name: 'provisions', label: getLangString('MOD_VOY_SETTING_PROVISIONS'), hint: getLangString('MOD_VOY_SETTING_PROVISIONS_HINT'), default: true, onChange: onChange('provisions') },
    { type: 'switch', name: 'night', label: getLangString('MOD_VOY_SETTING_NIGHT'), hint: getLangString('MOD_VOY_SETTING_NIGHT_HINT'), default: true, onChange: onChange('night') },
    { type: 'number', name: 'nightShift', label: getLangString('MOD_VOY_SETTING_NIGHT_SHIFT'), hint: getLangString('MOD_VOY_SETTING_NIGHT_SHIFT_HINT'), default: 0, min: -12, max: 12, onChange: onChange('nightShift') },
  ]);

  /** The game's offline loop (tab in the background, or back after a while): see state.onSettingsChange. */
  const offline = {
    held: 0,
    started: 0,
    active() { try { return game._isInOnlineLoop === false; } catch { return false; } },
  };
  ctx.patch(Game, 'enterOfflineLoop').after(function () {
    offline.held = 0;
    offline.started = performance.now();
    log(`offline loop entered: replaying ${Math.round((Date.now() - this.tickTimestamp) / 1000)} s, action ${this.activeAction?.id ?? 'none'}`);
  });
  ctx.patch(Game, 'exitOfflineLoop').after(function () {
    const held = offline.held;
    offline.held = 0;
    log(`offline loop left after ${Math.round(performance.now() - offline.started)} ms; ${held} held refresh(es)`);
    if (held > 0) setTimeout(() => state.onSettingsChange(), 0);
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
    /** Options for rules.rateAt: the strictness and a neighbour lookup for grace. */
    ruleOpts() {
      const terrain = this.terrain;
      return { strictness: this.settings.strictness(), neighbours: terrain ? (rec) => terrain.neighbours(rec.q, rec.r) : undefined };
    },
    /** The player's hex on the active map, or undefined. Never cached: position is read live. */
    position() {
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
    for (const fn of fns) { try { fn(); } catch (e) { console.error('[Voyage] after-tutorial step failed', e); } }
  };
  state.afterTutorial = (fn) => {
    let done = true;
    try { done = game.tutorial?.complete !== false; } catch {}
    if (done) fn(); else { tutorialWaiters.push(fn); log('waiting for the tutorial to end'); }
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
  const helpLayout = await ctx.loadModule('src/help-layout.mjs');
  // Every popup we open runs this on render: skill names get their icon and bold.
  state.popupDidRender = (await ctx.loadModule('src/skill-names.mjs')).didRender;
  const compassMod = await ctx.loadModule('src/compass.mjs');
  const traderMod = await ctx.loadModule('src/trader.mjs');
  const stranded = await ctx.loadModule('src/stranded.mjs');
  const voyagePage = await ctx.loadModule('src/voyage-page.mjs');
  const markers = await ctx.loadModule('src/markers.mjs');
  const shipMod = await ctx.loadModule('src/ship.mjs');
  const unlocks = await ctx.loadModule('src/unlocks.mjs');
  const storesModel = await ctx.loadModule('src/stores-model.mjs');
  const storesMod = await ctx.loadModule('src/stores.mjs');
  const holdMod = await ctx.loadModule('src/hold.mjs');
  // Pitch from Firemaking (3d). A failure leaves repairs short of Pitch, nothing else.
  try { (await ctx.loadModule('src/pitch.mjs')).install(ctx, { shipModel, log }); } catch (e) { console.error('[Voyage] Pitch failed', e); }
  knowledgeMod.install(ctx, { state, terrainMod, log });
  overlay.install(ctx, { state, terrainMod, log });
  state.zoneTable = zoneTable;
  gate.install(ctx, { state, rules, terrainMod, zones: zonesMod, helpLayout, log });
  compassMod.install(ctx, { state, rules, terrainMod, model, helpLayout, log });
  traderMod.install(ctx, { state, rules, terrainMod, stranded, helpLayout, log });
  herePanel.install(ctx, { state, rules, terrainMod, storesModel, model, helpLayout, log });
  /** The Voyage skill object, or undefined when it did not register. */
  const voyageSkill = () => { try { return voyageSkillOk ? game.skills.getObjectByID(model.SKILL_ID) : undefined; } catch { return undefined; } };
  state.voyageSkill = voyageSkill;
  unlocks.install(ctx, { state, log });
  // The ship keeps its state in the skill's save, so without the skill it stays inert and travel is vanilla.
  const ship = shipMod.install(ctx, { state, model, shipModel, terrainMod, helpLayout, log });
  state.markers = markers.install(ctx, { state, log });
  // Provisions (phase 3c): the stores every move draws on. Inert without the skill, like the ship.
  const stores = storesMod.install(ctx, { state, model, storesModel, shipModel, terrainMod, stranded, helpLayout, log });
  // The ship's hold (build .72): bank items kept aboard, reached at the ship.
  holdMod.install(ctx, { state, shipModel, log });
  const page = voyageSkillOk ? voyagePage.install(ctx, { state, model, shipModel, storesModel, helpHtml: helpLayout.helpHtml, HELP_WIDTH: helpLayout.HELP_WIDTH, log }) : undefined;
  const markPage = () => { const s = voyageSkill(); if (s !== undefined) s.renderQueue.page = true; };
  state.listeners.push(markPage);

  // XP per hex travelled (decided 15 Oct 2026), provisions (3c) and the ship following the move. movePlayer is the one
  // vanilla travel path; it returns early when the costs are not owned, so all three apply only to a move that really
  // landed. The stores are checked first: a move they can't pay is refused before the game takes any GP. Free moves
  // (ignoreCosts: game events, dev teleports) cost no provisions and give no XP but still carry the ship. The path
  // runs from the destination (index 0) back to the start. The steps are read before the move: the homeward rule
  // depends on the ship's reach where the move began.
  if (voyageSkillOk) {
    ctx.patch(Cartography, 'movePlayer').replace(function (original, path, ignoreCosts, ...rest) {
      const from = this.activeMap?.playerPosition;
      let planned;
      let steps;
      try {
        if (!ignoreCosts) planned = stores.planFor(path);
        steps = planned?.steps ?? (Array.isArray(path) ? ship.stepsOf(path) : undefined);
      } catch (e) { log('travel steps failed', e); }
      if (planned !== undefined && !planned.plan.ok) { stores.refuse(planned, path); return; }
      const result = original(path, ignoreCosts, ...rest);
      try {
        const dest = path?.[0];
        if (dest !== undefined && from !== dest && this.activeMap?.playerPosition === dest) {
          stores.afterMove(planned);
          if (!ignoreCosts && steps !== undefined) voyageSkill()?.onTravelled(steps);
          ship.afterMove(path);
        }
      } catch (e) { log('travel XP, stores or ship move failed', e); }
      return result;
    });
  }

  if (DEV) (await ctx.loadModule('src/dev.mjs')).install(ctx, { state, terrainMod, rules, model, log });

  ctx.onCharacterLoaded(() => {
    if (DEV) {
      for (const [name, v] of Object.entries(devSettings.read())) {
        try { if (section.get(name) !== v) { section.set(name, v); log(`dev setting restored for ${devSettingsKey()}: ${name} = ${v}`); } } catch (e) { log(`dev setting ${name} not restored`, e); }
      }
    }
    try {
      const map = game.cartography?.worldMaps.getObjectByID(table.meta.mapId);
      const liveHexes = [];
      map?.forEach((hex) => liveHexes.push({ q: hex.q, r: hex.r, isWater: hex.isWater }));
      const check = terrainMod.checkTable(table, { mapId: map?.id, hexes: liveHexes });
      state.terrain = terrainMod.createTerrain(table);
      const opts = () => state.ruleOpts();
      state.nearestFor = terrainMod.createNearestFinder(state.terrain, rules, state.knowledge, opts);
      state.anyNearestFor = terrainMod.createNearestFinder(state.terrain, rules, undefined, opts);
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
