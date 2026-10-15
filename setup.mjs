// Voyage: Far Shores — entry point for the Melvor Idle v1.3.1 mod loader.
// Game-facing code lives in src/*.mjs and is loaded through ctx.loadModule (relative ES imports do not
// resolve inside the loader's resource URLs). src/terrain.mjs and src/rules.mjs are pure and covered by
// Node tests in tests/.
//
// Phase 2 (map rules): the full tier table with Strict/Relaxed, combat placement with one-hex
// grace, the trade gate, Township in towns, sidebar dimming and the Wayfinder's Compass. Travel is vanilla.

/** Bumped on every zip build so the console shows which build is running. */
export const BUILD = '2026-10-15.24';
/** Dev switch: true prints [Voyage] debug lines. Set to false for player builds. */
const DEV = true;

export async function setup(ctx) {
  const log = DEV ? (...args) => console.log('[Voyage]', ...args) : () => {};
  console.info(`[Voyage] Far Shores — build ${BUILD}`);

  // Hard requirement: Atlas of Discovery. Without it the mod registers nothing and never throws.
  const hasAoD = () => {
    try { return Boolean(cloudManager.hasAoDEntitlementAndIsEnabled); } catch { return false; }
  };
  if (!hasAoD()) {
    console.warn('[Voyage] Atlas of Discovery is not enabled; Voyage stays dormant.');
    ctx.onInterfaceReady(() => {
      try { game.notifications.createErrorNotification('voyage:noaod', 'Voyage: Far Shores needs Atlas of Discovery and stays dormant.'); } catch {}
    });
    return;
  }

  const terrainMod = await ctx.loadModule('src/terrain.mjs');
  const rules = await ctx.loadModule('src/rules.mjs');
  const table = await ctx.loadData('data/hex_terrain.json');
  // Items and shop entries (the compass). Registered before any character loads.
  try { await ctx.gameData.addPackage('data/package.json'); } catch (e) { console.error('[Voyage] data package failed; the compass is unavailable', e); }

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
  strictnessHint.append('Strict: gathering needs terrain, crafting needs a workshop or town.', document.createElement('br'), 'Relaxed: only gathering is tied to terrain.');
  section.add([
    { type: 'switch', name: 'overlay', label: 'Terrain overlay', hint: 'Tint surveyed hexes by terrain on the Cartography map.', default: true, onChange: onChange('overlay') },
    { type: 'switch', name: 'rules', label: 'Voyage rules', hint: 'Off: nothing is locked by location; the overlay and the panel stay.', default: true, onChange: onChange('rules') },
    { type: 'dropdown', name: 'strictness', label: 'Strictness', hint: strictnessHint,
      options: [{ value: 'strict', display: 'Strict' }, { value: 'relaxed', display: 'Relaxed' }], default: 'strict', onChange: onChange('strictness') },
    { type: 'switch', name: 'combat', label: 'Combat needs its area', hint: 'Fight only on the area\'s hex or next to it. Dungeons and strongholds too.', default: true, onChange: onChange('combat') },
    { type: 'switch', name: 'trade', label: 'Trade only near markets', hint: 'Sell and buy only in or next to a town, port or market.', default: true, onChange: onChange('trade') },
  ]);

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
      trade: () => flag('trade'),
    },
    onSettingsChange() { this.listeners.forEach((fn) => { try { fn(); } catch (e) { log(e); } }); },
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

  ctx.loadStylesheet('css/voyage.css');
  const overlay = await ctx.loadModule('src/overlay.mjs');
  const gate = await ctx.loadModule('src/gate.mjs');
  const herePanel = await ctx.loadModule('src/here-panel.mjs');
  const knowledgeMod = await ctx.loadModule('src/knowledge.mjs');
  const compassMod = await ctx.loadModule('src/compass.mjs');
  const traderMod = await ctx.loadModule('src/trader.mjs');
  const stranded = await ctx.loadModule('src/stranded.mjs');
  knowledgeMod.install(ctx, { state, terrainMod, log });
  overlay.install(ctx, { state, terrainMod, log });
  gate.install(ctx, { state, rules, terrainMod, log });
  compassMod.install(ctx, { state, rules, terrainMod, log });
  traderMod.install(ctx, { state, rules, terrainMod, stranded, log });
  herePanel.install(ctx, { state, rules, terrainMod, log });
  if (DEV) (await ctx.loadModule('src/dev.mjs')).install(ctx, { state, terrainMod, rules, log });

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
          try { game.notifications.createErrorNotification('voyage:mismatch', 'Voyage: the map differs from the terrain table. Location rules are off until the mod is updated.'); } catch {}
        });
      }
      state.onSettingsChange();
    } catch (e) {
      console.error('[Voyage] load failed, staying dormant', e);
      state.mode = 'dormant';
    }
  });
}
