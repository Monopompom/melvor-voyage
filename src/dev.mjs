// Console helpers for development builds only (setup.mjs loads this when DEV is true; the release
// build leaves it out of player zips). Exposed as `voyageDev` on window.

export function install(ctx, { state, terrainMod, rules, log }) {
  const cartography = () => game.cartography;
  const map = () => cartography()?.activeMap;

  /** Game display coords ("Coords: (col, row)" in the hex tooltip and the panel) <-> axial (q, r). */
  const fromDisplay = (col, row) => ({ q: col, r: row - (col - (col & 1)) / 2 });
  const display = (hex) => { const o = hex.to_oddq(); return `(${o.col}, ${o.row})`; };

  /**
   * Fully surveys one hex with the same bookkeeping the game does after a survey level-up. Hexes whose survey
   * requirements (Cartography level) are not met are skipped unless `force`: vanilla cannot survey them, and a
   * forced survey leaves the POI undiscovered behind a full survey bar.
   */
  const surveyFully = (hex, force = false) => {
    if (hex.isFullySurveyed) return false;
    if (!force && !game.checkRequirements(hex.requirements ?? [])) return false;
    const c = cartography();
    hex.setSurveyLevel(hex.maxSurveyLevel);
    c.renderQueue.hexProgress.add(hex);
    c.renderQueue.hexBackground.add(hex);
    c.onHexFullSurvey(hex);
    return true;
  };

  const api = {
    /**
     * Reveals every hex within `radius` of the player (default 6, enough for Wet Forest from A New Start) that your
     * Cartography level could survey; `force` reveals the rest too.
     */
    reveal(radius = 6, force = false) {
      const m = map();
      if (m === undefined) return 'no active map';
      let n = 0;
      let skipped = 0;
      m.getHexesInRange(m.playerPosition, radius).forEach((hex) => { if (surveyFully(hex, force)) n++; else if (!hex.isFullySurveyed) skipped++; });
      cartography().render();
      state.onSettingsChange();
      return `revealed ${n} hexes within ${radius}${skipped > 0 ? `; ${skipped} need a higher Cartography level (reveal(${radius}, true) forces them)` : ''}`;
    },
    /** Reveals the whole map (same level rule and `force`). Expect a burst of POI discovery prompts. */
    revealAll(force = false) {
      const m = map();
      if (m === undefined) return 'no active map';
      let n = 0;
      m.forEach((hex) => { if (surveyFully(hex, force)) n++; });
      cartography().render();
      state.onSettingsChange();
      return `revealed ${n} hexes`;
    },
    /** Moves the player for free (no path, no cost) to the game's display coords, as the hex tooltip shows them. */
    teleport(col, row) {
      const m = map();
      const { q, r } = fromDisplay(col, row);
      const hex = m?.getHex(new HexCoords(q, r));
      if (hex === undefined) return `no hex at (${col}, ${row})`;
      m.setPlayerPosition(hex);
      cartography().render();
      state.onSettingsChange();
      return `now at ${display(hex)} ${state.recordAt(hex)?.t ?? '?'}`;
    },
    /**
     * What the next game save will hold for mods: runs the loader's own encoder (`mod.encode`, the call
     * Game.encode makes) into a recording writer and lists each entry's settings sections and characterStorage keys.
     * Voyage is the entry with a "Voyage" settings section; Worker Folks has "Hiring" and "Wages".
     */
    saveCheck() {
      const out = [];
      const w = {
        writeArray(arr, fn) { arr.forEach((x) => fn(x, w)); return w; },
        writeUint32(v) { out.push(v); },
        writeString(v) { out.push(v); },
      };
      mod.encode(w); // eslint-disable-line no-undef -- the loader's global
      const entries = [];
      for (let i = 0; i + 2 < out.length; i += 3) {
        const settings = JSON.parse(out[i + 1]);
        const storage = JSON.parse(out[i + 2]);
        entries.push({
          modId: out[i],
          sections: Array.isArray(settings) ? settings.map((sec) => `${sec[0]}: ${sec[1].map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}`) : settings,
          storageKeys: Array.isArray(storage) ? storage.map(([k]) => k) : storage,
        });
      }
      const voyage = entries.find((e) => Array.isArray(e.sections) && e.sections.some((x) => x.startsWith('Voyage:')));
      console.table(entries);
      return voyage === undefined
        ? 'Voyage is NOT in the save: its settings and characterStorage are dropped on reload.'
        : `Voyage is in the save as mod id ${voyage.modId}: ${voyage.sections.join(' | ')}; storage keys: ${voyage.storageKeys}`;
    },
    /** Terrain record under the player. */
    here() {
      const pos = state.position();
      if (pos === undefined) return undefined;
      const rates = Object.fromEntries(rules.gatedSkillIds().map((id) => [id, state.rateAt?.(id) ?? 1]));
      return { coords: display(pos), ...state.recordAt(pos), mode: state.mode, rulesOn: state.settings.rules(), rates };
    },
    /** Nearest hex where a skill works, e.g. voyageDev.nearest('melvorD:Woodcutting'). */
    nearest(skillId) {
      const pos = state.position();
      if (pos === undefined || state.terrain === undefined) return undefined;
      const near = state.nearestFor(skillId, pos);
      if (near === undefined) return undefined;
      const hex = map()?.getHex(new HexCoords(near.hex.q, near.hex.r));
      return { coords: hex ? display(hex) : undefined, ...near.hex, distance: near.distance, dir: terrainMod.directionLabel(pos, near.hex) };
    },
    state,
  };
  window.voyageDev = api;
  log('voyageDev ready: reveal(radius, force), revealAll(force), teleport(col, row) in display coords, here(), nearest(skillId), saveCheck()');
}
