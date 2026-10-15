// What the player knows about the map. The "nearest place" hints only ever point at KNOWN hexes, the same
// way vanilla Cartography only shows what you have surveyed.
//
// Known = fully surveyed on the live map, or marked known by the mod (phase 4: visited, rumours, charts).
// The mod-side set is empty in phase 1 and is not persisted yet; phase 4 puts it in the save with a version.
//
// `version` goes up whenever knowledge changes (a survey completes, a mark is added), so the memoised
// nearest finder can drop stale answers without being cleared by hand.

export function install(ctx, { state, terrainMod, log }) {
  const marked = new Set(); // hexKey -> known by the mod (phase 4)
  let version = 1;
  let cachedVersion = 0;
  let surveyed = new Set();

  /** Keys of every fully surveyed hex on the active map, rebuilt lazily when the version moves. */
  const surveyedKeys = () => {
    if (cachedVersion === version) return surveyed;
    const next = new Set();
    try {
      game.cartography?.activeMap?.forEach((hex) => { if (hex.isFullySurveyed) next.add(terrainMod.hexKey(hex.q, hex.r)); });
    } catch (e) { log('survey scan failed', e); }
    surveyed = next;
    cachedVersion = version;
    return surveyed;
  };

  const knowledge = {
    get version() { return version; },
    isKnown(rec) {
      if (rec === undefined) return false;
      const key = terrainMod.hexKey(rec.q, rec.r);
      return marked.has(key) || surveyedKeys().has(key);
    },
    /** Phase 4 hook: a rumour, chart or visit reveals a hex to the mod without surveying it. */
    mark(q, r) {
      const key = terrainMod.hexKey(q, r);
      if (marked.has(key)) return;
      marked.add(key);
      version++;
      state.onSettingsChange();
    },
    bump() { version++; },
  };
  state.knowledge = knowledge;

  ctx.onCharacterLoaded(() => {
    try {
      const cart = game.cartography;
      if (cart === undefined) return;
      cart.on('hexSurveyed', () => { version++; state.onSettingsChange(); });
      cart.on('poiDiscovered', () => { version++; state.onSettingsChange(); });
    } catch (e) { log('knowledge hooks failed', e); }
  });
  return knowledge;
}
