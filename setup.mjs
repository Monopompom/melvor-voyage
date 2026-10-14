// Voyage: Far Shores — entry point for the Melvor Idle v1.3.1 mod loader.
// Game-facing code lives in src/*.mjs and is loaded through ctx.loadModule (relative ES imports do not
// resolve inside the loader's resource URLs). src/terrain.mjs and src/rules.mjs are pure and covered by
// Node tests in tests/.
//
// Phase 1 (vertical slice): load the terrain table, tint surveyed hexes, gate Woodcutting off forest
// with a toast, and show a "You are here" panel on the map. Travel is vanilla and instant.

/** Bumped on every zip build so the console shows which build is running. */
export const BUILD = '2026-10-14.1';
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

  const section = ctx.settings.section('Voyage');
  section.add([
    { type: 'switch', name: 'overlay', label: 'Terrain overlay', hint: 'Tint surveyed hexes by terrain on the Cartography map.', default: true,
      onChange: () => state.onSettingsChange() },
    { type: 'switch', name: 'rules', label: 'Voyage rules', hint: 'Off: no skill is locked by location; the overlay and the panel stay.', default: true,
      onChange: () => state.onSettingsChange() },
  ]);

  /** Shared runtime state. mode: 'dormant' until the save is checked, then 'strict' or 'relaxed' (table mismatch). */
  const state = {
    mode: 'dormant',
    terrain: undefined,
    reasons: [],
    listeners: [],
    settings: {
      overlay: () => section.get('overlay') !== false,
      rules: () => section.get('rules') !== false,
    },
    onSettingsChange() { this.listeners.forEach((fn) => { try { fn(); } catch (e) { log(e); } }); },
    /** The player's hex on the active map, or undefined. Never cached: position is read live. */
    position() {
      try {
        const map = game.cartography?.activeMap ?? game.cartography?.worldMaps.getObjectByID(table.meta.mapId);
        return map?.playerPosition;
      } catch { return undefined; }
    },
    recordAt(hex) { return hex && this.terrain ? this.terrain.get(hex.q, hex.r) : undefined; },
  };

  ctx.loadStylesheet('css/voyage.css');
  const overlay = await ctx.loadModule('src/overlay.mjs');
  const gate = await ctx.loadModule('src/gate.mjs');
  const herePanel = await ctx.loadModule('src/here-panel.mjs');
  overlay.install(ctx, { state, terrainMod, log });
  gate.install(ctx, { state, rules, terrainMod, log });
  herePanel.install(ctx, { state, rules, terrainMod, log });

  ctx.onCharacterLoaded(() => {
    try {
      const map = game.cartography?.worldMaps.getObjectByID(table.meta.mapId);
      const live = [];
      map?.forEach((hex) => live.push({ q: hex.q, r: hex.r, isWater: hex.isWater }));
      const check = terrainMod.checkTable(table, { mapId: map?.id, hexes: live });
      state.terrain = terrainMod.createTerrain(table);
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
