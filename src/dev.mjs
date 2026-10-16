// Console helpers for development builds only (setup.mjs loads this when DEV is true; the release
// build leaves it out of player zips). Exposed as `voyageDev` on window.

export function install(ctx, { state, terrainMod, rules, model, journalModel: jm, log }) {
  const cartography = () => game.cartography;
  const map = () => cartography()?.activeMap;

  /** Game display coords ("Coords: (col, row)" in the hex tooltip and the panel) <-> axial (q, r). */
  const fromDisplay = (col, row) => ({ q: col, r: row - (col - (col & 1)) / 2 });
  const display = (hex) => { const o = hex.to_oddq(); return `(${o.col}, ${o.row})`; };

  /** voyageDev.journal('all'): a late-game book (see there). Returns what went in. */
  const fillJournal = (j) => {
    if (state.terrain === undefined || state.zoneCandidates === undefined) return 'terrain or zones not loaded';
    const start = state.zoneTable?.start ?? { q: 0, r: 0 };
    const dist = (a) => terrainMod.hexDistance(start, a);
    const all = [...state.terrain.all()].filter((rec) => rec.cloud !== true).sort((a, b) => dist(a) - dist(b));
    const known = [];
    const out = { entries: 0, misses: 0, combat: 0, trade: 0, pages: 0 };
    for (const [skillId, sk] of Object.entries(state.zoneTable?.skills ?? {})) {
      for (const id of Object.keys(sk.actions ?? {})) {
        const hexes = state.zoneCandidates(id);
        for (const rec of hexes) jm.addFound(j, id, rec.q, rec.r, start, model.JOURNAL_LIMITS.found);
        if (j.found[id]?.length > 0) out.entries += 1;
        for (const h of j.found[id] ?? []) known.push(jm.parseHex(h));
        // Where the skill works but this zone says no: the first three from the start.
        const works = new Set(hexes.map((rec) => jm.hexStr(rec.q, rec.r)));
        let n = 0;
        for (const rec of all) {
          if (n >= 3) break;
          if (works.has(jm.hexStr(rec.q, rec.r)) || !rules.allowedAt(skillId, rec, state.ruleOpts())) continue;
          if (jm.addMiss(j, id, rec.q, rec.r, model.JOURNAL_LIMITS.missed)) { n += 1; out.misses += 1; }
        }
      }
    }
    for (const list of ['combatAreas', 'slayerAreas', 'dungeons', 'strongholds', 'abyssDepths']) {
      for (const area of game[list]?.allObjects ?? []) {
        const near = [...state.terrain.placesFor(area.id)].sort((a, b) => dist(a) - dist(b))[0];
        if (near !== undefined && jm.addPlace(j, 'combat', area.id, near.q, near.r)) { out.combat += 1; known.push(near); }
      }
    }
    for (const rec of all) {
      if (rules.isTradePlace(rec) && jm.addPlace(j, 'trade', jm.hexStr(rec.q, rec.r), rec.q, rec.r)) { out.trade += 1; known.push(rec); }
    }
    for (const id of model.JOURNAL_GUIDES) if (state.journal?.learn(id, true)) out.pages += 1;
    try { state.knowledge?.markMany(known.filter((h) => h !== undefined)); } catch (e) { log('journal fill: knowledge failed', e); }
    state.journal?.refresh?.();
    return out;
  };

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
      state.ship?.moved(); // on the sea you are aboard: the ship comes along (not loaded(): see ship.mjs)
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
    /** Plan a voyage (4.21) to the game's display coords: voyageDev.plan(col, row). Opens the planner block. */
    plan(col, row) {
      if (state.planner === undefined) return 'planner not loaded';
      const { q, r } = fromDisplay(col, row);
      // Named as a player's plan would be: the place there, else the hex (it said "Dev target", which read as nothing).
      let name = `Hex (${col}, ${row})`;
      try { const poi = map()?.getHex(new HexCoords(q, r))?.pointOfInterest; if (poi?.isDiscovered) name = poi.name; } catch {}
      return state.planner.planTo({ name, hexes: [{ q, r }] }) ? `planned: ${name}` : 'not planned';
    },
    /**
     * Plan a voyage to a combat, slayer or dungeon area by id, as its Plan voyage button does (build .130, to see the
     * On arrival refusals): voyageDev.planArea('melvorF:Holy_Isles', 0) preselects that area's first monster.
     */
    planArea(id, monsterIndex) {
      if (state.planner === undefined) return 'planner not loaded';
      const area = game.combatAreas.getObjectByID(id) ?? game.slayerAreas.getObjectByID(id) ?? game.dungeons.getObjectByID(id);
      if (area === undefined) return `no area ${id}`;
      const target = state.planner.forArea(area, monsterIndex === undefined ? undefined : area.monsters?.[monsterIndex]);
      return target !== undefined && state.planner.planTo(target) ? `planned: ${target.name}` : 'not planned (no known place)';
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
    /** The vessels: where each is, which you are in, and why the dinghy can't be built or the brig bought (if so). */
    ship() {
      const sh = state.ship;
      if (sh === undefined) return 'ship module not loaded';
      const s = sh.boat();
      const b = sh.big();
      return { boat: s === undefined ? 'skill missing' : s, ship: b, inVessel: sh.inVessel(), rules: sh.enabled(), where: s ? sh.whereIs(s) : undefined,
        shipWhere: b ? sh.whereIs(b) : undefined, launchSpot: sh.launchSpot(), buildBlocker: sh.buildBlocker(), buyBlocker: sh.buyInfo()?.blocker };
    },
    /** The welcome popup (compass, purse line with `voyageDev.welcome(500)`), in its current layout. */
    welcome(purse = 0) { if (state.compass?.welcome === undefined) return 'compass module not loaded'; state.compass.welcome(purse); return 'shown'; },
    /**
     * The Captain's Journal record. `voyageDev.journal('reset')` empties it (a new player's book; reload to see the
     * guide footers as new again), `voyageDev.journal('pages')` writes every guide page quietly, `voyageDev.journal('all')`
     * fills the book as a late-game player's would be: every zoned action found on every hex it works on now (the
     * record keeps the nearest to the start, JOURNAL_LIMITS.found), three misses each near the start, every combat area
     * and trading place on the map, every guide page. The hexes become known (the compass). `voyageDev.journal('notes')`
     * puts one of each chart in the bank (Prospector's Notes and the rest). Saved with the game.
     */
    journal(what) {
      const s = state.voyageSkill?.();
      if (s === undefined || s.futureRaw !== undefined) return 'Voyage skill missing';
      if (what === 'reset') s.record.journal = model.emptyJournal();
      else if (what === 'pages') for (const id of model.JOURNAL_GUIDES) state.journal?.learn(id, true);
      else if (what === 'all') return fillJournal(s.record.journal);
      else if (what === 'notes') {
        // One of each chart (build .116), into the bank.
        const got = [];
        for (const id of Object.values(jm.CHART_ITEMS)) {
          const item = game.items.getObjectByID(`voyage:${id}`);
          if (item !== undefined) { game.bank.addItem(item, 1, false, true, true, false, 'Voyage'); got.push(item.name); }
        }
        state.journal?.refresh?.();
        return got;
      }
      return JSON.parse(JSON.stringify(s.record.journal));
    },
    /**
     * The Old Man's letter (build .143) over the open journal, without paying anything. `voyageDev.golbin('reset')`
     * makes the next "goblin" search pay the purse again.
     */
    golbin(what) {
      const j = state.voyageSkill?.()?.record?.journal;
      if (what === 'reset') { if (j !== undefined) j.golbin = false; return 'the next "goblin" search pays again'; }
      if (!state.journal?.isOpen()) state.journal?.open({ tab: 'places' });
      state.journal?.golbinLetter();
      return { given: j?.golbin === true };
    },
    /** The first-load dinghy notice: 'overseas', 'sea' or 'far'. */
    dinghyNotice(kind = 'overseas') { if (state.ship?.demoNotice === undefined) return 'ship module not loaded'; state.ship.demoNotice(kind); return 'shown'; },
    /** The moored-dinghy marker: textures, ship record, sprite state. `voyageDev.marker(true)` redraws it first. */
    marker(redraw = false) {
      if (redraw) { try { state.markers?.refresh(); } catch (e) { return `refresh failed: ${e}`; } }
      return state.markers?.debug() ?? 'markers module not loaded';
    },
    /** A free dinghy: under you on the sea, else next to your coast hex. `false` removes the ship. */
    giveShip(give = true) {
      const sh = state.ship;
      if (sh?.boat() === undefined) return 'Voyage skill missing';
      if (give === false) { sh.setShip(null, 'removed (dev)'); return 'ship removed'; }
      const pos = state.position();
      const rec = pos ? sh.recOf(pos) : undefined;
      const spot = rec && (rec.t === 'water' || rec.t === 'shoal') ? rec : sh.launchSpot();
      if (spot === undefined) return 'stand on a coast hex (or on the sea)';
      sh.setShip({ hull: 'dinghy', q: spot.q, r: spot.r, cond: 100, hold: [], aboard: false }, 'given (dev)');
      const h = map()?.getHex(new HexCoords(spot.q, spot.r));
      return `dinghy at ${h ? display(h) : `q ${spot.q}, r ${spot.r}`}`;
    },
    /**
     * A free brig (build .150): under you on the sea, else at the quay of the port you stand on or next to; your boat
     * is hoisted aboard when it lies there. `false` removes it, leaving a boat aboard on the brig's hex.
     */
    giveBrig(give = true) {
      const sh = state.ship;
      if (sh?.boat() == null) return 'needs the small boat first: voyageDev.giveShip()';
      const boat = sh.boat();
      if (give === false) {
        const b = sh.big();
        if (b == null) return 'no brig';
        if (boat.aboard === true) sh.setVessel('boat', { ...boat, q: b.q, r: b.r, aboard: false }, 'brig removed (dev)');
        sh.setVessel('ship', null, 'removed (dev)');
        return 'brig removed';
      }
      const pos = state.position();
      const rec = pos ? sh.recOf(pos) : undefined;
      const quay = sh.buyInfo()?.quay;
      const spot = rec && (rec.t === 'water' || rec.t === 'shoal') ? rec : quay;
      if (spot === undefined) return 'stand on the sea, or on a port or next to one';
      sh.setVessel('ship', { hull: 'brig', q: spot.q, r: spot.r, cond: 100, hold: [] }, 'given (dev)');
      if (boat.aboard !== true && boat.q === spot.q && boat.r === spot.r) sh.setVessel('boat', { ...boat, aboard: true }, 'hoisted aboard (dev)');
      const h = map()?.getHex(new HexCoords(spot.q, spot.r));
      return `brig at ${h ? display(h) : `q ${spot.q}, r ${spot.r}`}`;
    },
    /** The brig's price on top of what you have: 150,000 GP, 400 Teak Logs, 100 Steel Bars, 75 Pitch. */
    brigMaterials() {
      game.gp.add(150000);
      for (const [id, q] of [['melvorD:Teak_Logs', 400], ['melvorD:Steel_Bar', 100], ['voyage:Pitch', 75]]) game.bank.addItemByID(id, q, false, true, true);
      return 'added 150,000 GP, 400 Teak Logs, 100 Steel Bars, 75 Pitch';
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
      s.record.boat = null;
      s.record.ship = null;
      s.record.shipChecked = false;
      return 'boat and ship cleared; save and reload to rerun the first-load placement';
    },
    /** Sets the stores (phase 3c), or reads them with no arguments. */
    stores(food, fuel) {
      const api = state.stores;
      if (api?.stores() === undefined) return 'Voyage skill missing';
      if (food !== undefined) api.set(food, fuel ?? api.stores().fuel);
      return { ...api.stores(), loading: api.loadingHere() ?? 'none here' };
    },
    /** Sets the hull condition (3d), 0 to 100, or reads it with no argument. `kind` 'boat' or 'ship' (the brig). */
    hull(cond, kind = 'boat') {
      const sh = state.ship;
      if (sh?.vessel(kind) == null) return `no ${kind}`;
      if (cond !== undefined) sh.setCond(cond, kind);
      return { cond: sh.cond(kind), repair: sh.repairInfo(kind) };
    },
    /** Puts Pitch (and logs for the repairs) in the bank: pitch(n, logs?). */
    pitch(n = 10, logs = 0) {
      try {
        const add = (id, q) => { const it = game.items.getObjectByID(id); if (it !== undefined && q > 0) game.bank.addItem(it, q, false, true, true, true, 'voyageDev'); };
        add('voyage:Pitch', n);
        add('melvorD:Normal_Logs', logs);
        return `added ${n} Pitch, ${logs} Normal Logs`;
      } catch (e) { return `failed: ${e}`; }
    },
    /** Forgets the starter kit, so the next load gives it again. */
    resetKit() {
      const s = state.voyageSkill?.();
      if (s === undefined) return 'Voyage skill missing';
      s.record.kitGiven = false;
      return 'kit cleared; save and reload to get it again';
    },
    /** What the stuck-game watchdog knows: loop state, who stopped the loop last, recent errors. */
    watchdog() { return watchdog.report(); },
    state,
  };
  const watchdog = installWatchdog(ctx, log);
  window.voyageDev = api;
  log('voyageDev ready: watchdog(), reveal(radius, force), revealAll(force), teleport(col, row) in display coords, here(), nearest(skillId), saveCheck(), stranded(), broke(), townshipTrader(), voyage(level), level(skill, level), ship(), giveShip(false?), giveBrig(false?), brigMaterials(), shipMaterials(), resetShipCheck(), stores(food, fuel), resetKit(), hull(cond, kind), pitch(n, logs)');
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
