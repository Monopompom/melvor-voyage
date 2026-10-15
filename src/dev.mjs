// Console helpers for development builds only (setup.mjs loads this when DEV is true; the release
// build leaves it out of player zips). Exposed as `voyageDev` on window.

export function install(ctx, { state, terrainMod, rules, model, log }) {
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
      state.ship?.loaded(); // on the sea you are aboard: the ship comes along
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
    /** The wandering trader's verdict for the player's hex: stranded or not, and why. */
    stranded() {
      const v = state.trader?.verdict();
      if (v === undefined) return 'trader not loaded';
      return { stranded: v.stranded, reason: v.reason, road: v.road ? { gp: v.road.gp, itemsOwned: v.road.itemsOwned, hexes: v.road.path.length - 1 } : undefined, traderHere: state.trader.present() };
    },
    /** Spends all GP (to test the trader). */
    broke() { const gp = game.gp.amount; if (gp > 0) game.gp.remove(gp); return `removed ${gp} GP`; },
    /**
     * Prepares the Township trader check: Township level 15 (tier 2), and the GP and
     * Township resources for one Trading Post in the current town biome, plus 1,000 of each resource for conversions.
     * Does NOT build anything: build the Trading Post yourself on a town or port hex, which tests the Township gate too.
     * Needs the town created first (Township page, pick a worship).
     */
    townshipTrader() {
      const t = game.township;
      if (t === undefined) return 'Township not loaded';
      if (!t.townData.townCreated) return 'Create the town first: open Township and confirm a worship, then run this again.';
      const notes = [];
      if (t.level < 15) { t.setXP(exp.levelToXP(15) + 1); notes.push('Township level 15'); }
      const post = t.buildings.getObjectByID('melvorF:Trading_Post');
      const biome = t.currentTownBiome;
      const costs = post === undefined ? [] : t.getBuildingCostsForBiome(post, biome);
      if (costs.length === 0) notes.push(`no Trading Post cost in ${biome?.name ?? 'the current biome'}: switch to Grasslands in Township`);
      const want = new Map();
      t.resources.forEach((res) => { if (res.id !== 'melvorF:GP' && res.storageType === 'Normal') want.set(res, 1000); });
      for (const { resource, quantity } of costs) {
        if (resource.id === 'melvorF:GP') {
          const gp = quantity + 100000;
          if (game.gp.amount < gp) { game.gp.add(gp - game.gp.amount); notes.push(`GP topped up to ${numberWithCommas(gp)}`); }
          continue;
        }
        want.set(resource, (want.get(resource) ?? 0) + quantity);
      }
      const capped = [];
      want.forEach((amount, res) => {
        const max = t.getMaxResourceAmount(res);
        const target = Math.min(Math.max(res.amount, amount), max);
        if (target < amount) capped.push(`${res.name} capped at ${numberWithCommas(Math.floor(max))}`);
        res.amount = target;
      });
      t.renderQueue.resourceAmounts = true;
      notes.push(`resources set: ${[...want.keys()].map((r) => r.name).join(', ')}`);
      if (capped.length > 0) notes.push(`storage too small (build storage or raise caps): ${capped.join('; ')}`);
      const pos = state.position();
      const rec = pos ? state.recordAt(pos) : undefined;
      const inTown = rec ? rules.allowedAt('melvorD:Township', rec, state.ruleOpts()) : false;
      notes.push(inTown ? 'you are on a town/port hex: build the Trading Post now' : 'not on a town/port hex: voyageDev.teleport(13, 17) (Old Village) before building');
      return notes.join('\n');
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
    /**
     * Sets the Voyage skill level (compass stages: 10 adds the hex count, 25 the place name), or shows the skill's
     * record when called without a level. voyageDev.voyage(25)
     */
    voyage(level) {
      const s = state.voyageSkill?.();
      if (s === undefined) return 'Voyage skill not registered';
      if (level !== undefined) {
        s.setXP(exp.levelToXP(Math.max(1, Math.min(level, s.maxLevelCap))) + 1);
        s.renderQueue.page = true;
        state.onSettingsChange();
      }
      return { level: s.level, xp: Math.floor(s.xp), record: { ...s.record }, futureSave: s.futureRaw !== undefined };
    },
    /**
     * Sets any skill's level: `level('Cartography', 60)`. The skill is a name or an id ('melvorAoD:Cartography');
     * without a level it reports the current one. Capped at the skill's current level cap. Raising Cartography lifts the
     * survey requirements on the map, so `reveal()` then works without `force`.
     */
    level(skill = 'Cartography', level) {
      const key = String(skill).toLowerCase();
      const s = game.skills.getObjectByID(skill) ?? game.skills.find((k) => k.localID.toLowerCase() === key || k.name.toLowerCase() === key);
      if (s === undefined) return `no skill "${skill}"`;
      if (level !== undefined) {
        // setXP clamps to the current level cap (gamemode caps included) and runs onLevelUp, which fires the
        // level requirement handlers the map listens to
        s.setXP(exp.levelToXP(Math.max(1, Math.min(level, s.maxLevelCap))) + 1);
        state.onSettingsChange();
      }
      return `${s.name}: level ${s.level}`;
    },
    /** The ship: where it is, whether you are aboard, and why the dinghy can't be built (if so). */
    ship() {
      const sh = state.ship;
      if (sh === undefined) return 'ship module not loaded';
      const s = sh.ship();
      return { ship: s === undefined ? 'skill missing' : s, aboard: sh.aboard(), rules: sh.enabled(), where: s ? sh.whereIs(s) : undefined, launchSpot: sh.launchSpot(), buildBlocker: sh.buildBlocker() };
    },
    /** A free dinghy: under you on the sea, else next to your coast hex. `false` removes the ship. */
    giveShip(give = true) {
      const sh = state.ship;
      if (sh?.ship() === undefined) return 'Voyage skill missing';
      if (give === false) { sh.setShip(null, 'removed (dev)'); return 'ship removed'; }
      const pos = state.position();
      const rec = pos ? sh.recOf(pos) : undefined;
      const spot = rec && (rec.t === 'water' || rec.t === 'shoal') ? rec : sh.launchSpot();
      if (spot === undefined) return 'stand on a coast hex (or on the sea)';
      sh.setShip({ hull: 'dinghy', q: spot.q, r: spot.r }, 'given (dev)');
      const h = map()?.getHex(new HexCoords(spot.q, spot.r));
      return `dinghy at ${h ? display(h) : `q ${spot.q}, r ${spot.r}`}`;
    },
    /** Builds-dinghy materials: 500 GP and 50 Normal Logs on top of what you have. */
    shipMaterials() {
      game.gp.add(500);
      game.bank.addItemByID('melvorD:Normal_Logs', 50, false, true, true);
      return 'added 500 GP and 50 Normal Logs';
    },
    /** Forgets the ship and the one-time check, so the next load runs the existing-character placement again. */
    resetShipCheck() {
      const s = state.voyageSkill?.();
      if (s === undefined) return 'Voyage skill missing';
      s.record.ship = null;
      s.record.shipChecked = false;
      return 'ship cleared; save and reload to rerun the first-load placement';
    },
    /** What the stuck-game watchdog knows: loop state, who stopped the loop last, recent errors. */
    watchdog() { return watchdog.report(); },
    state,
  };
  const watchdog = installWatchdog(ctx, log);
  window.voyageDev = api;
  log('voyageDev ready: watchdog(), reveal(radius, force), revealAll(force), teleport(col, row) in display coords, here(), nearest(skillId), saveCheck(), stranded(), broke(), townshipTrader(), voyage(level), level(skill, level), ship(), giveShip(false?), shipMaterials(), resetShipCheck()');
}

/**
 * Stuck-game watchdog (dev builds; user report 16 Oct 2026: after the window lost focus the game took no clicks and
 * ran no actions). The game stops its main loop and shows an invisible full-screen #interaction-blocker in
 * Game.stopMainLoop: on blur with "Pause on unfocus" (browser only; its focus handler restarts the loop) and on any
 * error inside the loop (the error box goes through the modal queue, which the offline catch-up pauses, so it can stay
 * hidden). The blocker goes when the loop runs again. This records who stopped the loop and every error, and when the
 * window is in front but the loop stays stopped (or the offline catch-up stops moving), shows a plain banner above
 * the blocker with what it found and a button to restart the loop.
 */
function installWatchdog(ctx, log) {
  const errors = [];
  let lastStop;
  let stuckSince;
  let offlineMark;
  let banner;
  const modsOf = (e) => { try { return mod.getModErrorFromError(e)?.mods?.map((m) => m.name) ?? []; } catch { return []; } };
  const record = (kind, e) => {
    const err = e instanceof Error ? e : new Error(String(e));
    errors.push({ at: new Date().toLocaleTimeString(), kind, message: err.message, mods: modsOf(err), stack: (err.stack ?? '').split('\n').slice(0, 6).join('\n') });
    if (errors.length > 10) errors.shift();
  };
  window.addEventListener('error', (ev) => record('error', ev.error ?? ev.message));
  window.addEventListener('unhandledrejection', (ev) => record('promise', ev.reason));
  ctx.patch(Game, 'showBrokenGame').before(function (error, title) { record(`broken game: ${title}`, error); });
  ctx.patch(Game, 'stopMainLoop').before(function () {
    if (!this.loopStarted) return;
    lastStop = {
      at: new Date().toLocaleTimeString(),
      focused: document.hasFocus(),
      visible: document.visibilityState,
      pauseOnUnfocus: this.settings?.pauseOnUnfocus,
      by: (new Error().stack ?? '').split('\n').slice(2, 8).join('\n'),
    };
    log('main loop stopped', lastStop);
  });

  const blockerOn = () => { const b = document.getElementById('interaction-blocker'); return b !== null && !b.classList.contains('d-none'); };
  const report = () => ({
    now: new Date().toLocaleTimeString(),
    loopStarted: game.loopStarted,
    blockerShown: blockerOn(),
    onlineLoop: game._isInOnlineLoop,
    offline: game._isInOnlineLoop === false ? { processedSeconds: Math.round((game._offlineInfo?.timeProcessed ?? 0) / 1000), tickRate: game._offlineInfo?.tickRate } : undefined,
    activeAction: game.activeAction?.id,
    focused: document.hasFocus(),
    visible: document.visibilityState,
    lastStop,
    errors,
  });
  const show = (why) => {
    const r = report();
    console.warn('[Voyage] watchdog:', why, r);
    if (banner === undefined) {
      banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483647;max-width:720px;width:calc(100% - 32px);'
        + 'background:#2b1d1d;color:#fff;border:2px solid #e05252;border-radius:8px;padding:12px 14px;font:14px/1.45 sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.6)';
      document.body.appendChild(banner);
    }
    const lines = [`<b>Voyage watchdog (dev build):</b> ${why}`];
    lines.push(`Loop running: ${r.loopStarted}; click blocker: ${r.blockerShown}; offline catch-up: ${r.onlineLoop === false ? `yes, ${r.offline?.processedSeconds}s done` : 'no'}; action: ${r.activeAction ?? 'none'}`);
    if (lastStop !== undefined) lines.push(`Loop stopped at ${lastStop.at} (window focused: ${lastStop.focused}, ${lastStop.visible}, pause on unfocus: ${lastStop.pauseOnUnfocus}).`);
    const e = errors[errors.length - 1];
    if (e !== undefined) lines.push(`Last error (${e.at}, ${e.kind}${e.mods.length ? `, mods: ${e.mods.join(', ')}` : ''}): ${e.message}`);
    else lines.push('No error was caught.');
    banner.innerHTML = lines.map((l) => `<div>${l.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]).replace(/&lt;(\/?)b&gt;/g, '<$1b>')}</div>`).join('')
      + '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">'
      + '<button data-w="restart" style="padding:4px 10px">Restart game loop</button>'
      + '<button data-w="copy" style="padding:4px 10px">Copy details</button>'
      + '<button data-w="close" style="padding:4px 10px">Dismiss</button></div>';
    banner.onclick = (ev) => {
      const w = ev.target?.dataset?.w;
      if (w === 'restart') { try { game.triggerOfflineLoop(); game.startMainLoop(); log('watchdog: main loop restarted'); } catch (err) { record('restart', err); } banner.remove(); banner = undefined; stuckSince = undefined; }
      if (w === 'copy') { try { navigator.clipboard.writeText(JSON.stringify(report(), null, 2)); ev.target.textContent = 'Copied'; } catch {} }
      if (w === 'close') { banner.remove(); banner = undefined; stuckSince = Date.now() + 60000; }
    };
  };
  // Only once the character is in (character select has no loop and no blocker worth reporting).
  ctx.onInterfaceReady(() => setInterval(() => {
    try {
      const inFront = document.visibilityState === 'visible' && document.hasFocus();
      // The loop is stopped while the window is in front: the vanilla focus handler should have restarted it.
      if (inFront && (!game.loopStarted || blockerOn())) {
        if (stuckSince === undefined) stuckSince = Date.now();
        else if (Date.now() - stuckSince > 6000 && banner === undefined) show('the game loop is stopped while the window is in front, so the game takes no clicks.');
      } else if (stuckSince !== undefined && stuckSince <= Date.now()) stuckSince = undefined;
      // The offline catch-up is running but no longer moves.
      if (game.loopStarted && game._isInOnlineLoop === false) {
        const done = game._offlineInfo?.timeProcessed ?? 0;
        if (offlineMark === undefined || offlineMark.done !== done) offlineMark = { done, since: Date.now() };
        else if (Date.now() - offlineMark.since > 10000 && banner === undefined) show('the offline catch-up has not moved for 10 seconds.');
      } else offlineMark = undefined;
    } catch {}
  }, 2000));
  return { report };
}
