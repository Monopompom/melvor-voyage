// Weather (phase 5c-1; the canvas "Voyage 5c: Weather"): the game side. The rules are in
// weather-model.mjs.
//
// The season is Township's (`game.township.townData.season`), read as it is: 72 hours of game time, run offline too, a
// character with no town in Spring for ever. Each hex has its degrees; the bands turn them into fuel, rations and time
// on land (ship.mjs stepsOf puts `wx` on each step; stores-model and clock-model read it). Fall loads food better,
// Nightfall, Eclipse and Eternal Darkness are night all season, Lemon makes sea rations go further. In Winter the sea
// within two hexes of the Snowlands is ice: a layer over the terrain table (terrain.mjs setLayer), ground on foot, no
// ship enters, a ship caught in it waits for the thaw. The Voyage skill's passiveTick notices a season change, online
// and offline. The setting "Weather" off: none of it.

const SWAL_CLASS = { popup: 'voyage-ui', confirmButton: 'btn btn-success m-1' };

export function install(ctx, { state, W, shipModel, terrainMod, helpLayout, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const offlineNow = () => { try { return game._isInOnlineLoop === false; } catch { return false; } };
  const cart = () => game.cartography;
  const map = () => cart()?.activeMap;
  const hexAt = (q, r) => { try { return map()?.getHex(new HexCoords(q, r)); } catch { return undefined; } };
  const recOf = (hex) => (hex == null ? undefined : state.terrain?.get?.(hex.q, hex.r));
  const neighbours = (rec) => state.terrain?.neighbours?.(rec.q, rec.r) ?? [];
  const keyOf = (h) => terrainMod.hexKey(h.q, h.r);

  /** The setting "Weather" on and a character loaded. */
  const on = () => state.settings.weather?.() !== false && state.terrain !== undefined;
  const townData = () => { try { return game.township?.townData; } catch { return undefined; } };
  const seasonObj = () => townData()?.season;
  /** Township's season order, whatever the setting (Spring without a town). */
  const rawOrder = () => { const o = seasonObj()?.order; return Number.isInteger(o) ? o : W.SPRING; };
  /** The season the rules use: Township's, or undefined with the setting off. */
  const order = () => (on() ? rawOrder() : undefined);
  const seasonByOrder = (o) => { try { return game.township.seasons.allObjects.find((s) => s.order === o); } catch { return undefined; } };
  const seasonName = (o) => { const s = seasonByOrder(o); return s?.name ?? t(`MOD_VOY_WX_SEASON_${W.seasonKey(o).toUpperCase()}`); };
  const seasonMedia = (o) => seasonByOrder(o)?.media ?? '';

  // ---- what a step carries -------------------------------------------------------------------------------------------
  /** The weather on a terrain record entered (ship.mjs stepsOf): the effects, or undefined when nothing changes. */
  const stepWeather = (rec) => {
    const o = order();
    if (o === undefined || rec === undefined) return undefined;
    const wx = W.effectsOf(rec.t, o);
    return W.isPlain(wx) ? undefined : wx;
  };
  /** The effects on a record for the panel and the hex box (plain ones too), or undefined with the setting off. */
  const effectsAt = (rec) => { const o = order(); return o === undefined || rec === undefined ? undefined : W.effectsOf(rec.t, o); };

  // ---- the wind (phase 5c-2) ---------------------------------------------------------------------------------------
  // One wind over the sea from one of six sides, turning every 6 hours of game time by at most one side; it changes the
  // time of a sailed step only, so it needs Timed travel. The roll is seeded per character (the save's `wind`, rolled
  // here the first time) and follows game time (state.gameNow: the ticks run, offline and online alike; build .421).
  let windObj;
  let spareSeed;
  /** A forced side for checks (dev.mjs voyageDev.wind(side)); undefined: the seeded wind. */
  let forced;
  const windSeed = () => {
    const sk = state.voyageSkill?.();
    if (sk === undefined) return undefined;
    // A newer save kept as it is (futureRaw): a seed for this session only.
    if (sk.futureRaw !== undefined) { spareSeed ??= W.newWindSeed(); return spareSeed; }
    if (!(Number.isInteger(sk.record.wind) && sk.record.wind > 0)) sk.record.wind = W.newWindSeed();
    return sk.record.wind;
  };
  const windNow = () => {
    const seed = windSeed();
    if (seed === undefined) return undefined;
    if (windObj?.seed !== seed) windObj = W.createWind(seed);
    return windObj;
  };
  /** The wind applies: the setting on, Timed travel on, a character loaded. */
  const windOn = () => on() && state.timed?.() === true && windNow() !== undefined;
  /** The side the wind blows from at `ms` of game time. */
  const windAt = (ms) => (forced !== undefined ? forced : windNow()?.at(ms));
  /** The time factor of a sailed step (ship.mjs stepsOf: `dq`, `dr`, `vessel`) begun at `ms`; small boats feel half. */
  const windFactor = (step, ms) => {
    if (step == null) return 1;
    const from = windAt(ms);
    if (from === undefined) return 1;
    return W.windFactor(from, W.headingOf(step.dq ?? 0, step.dr ?? 0), (step.vessel ?? 'boat') === 'boat');
  };
  /**
   * The wind for the panel, strip and page: { from (a side index), side ("NW"), word ("north-west"), toward (the side it
   * blows to), msLeft (to the next turn) }, or undefined when it does not apply.
   */
  const wind = () => {
    if (!windOn()) return undefined;
    const now = state.gameNow?.() ?? state.clockNow?.() ?? Date.now();
    const from = windAt(now);
    if (from === undefined) return undefined;
    const side = W.WIND_SIDES[from];
    return { from, side, short: t(`MOD_VOY_DIR_SHORT_${side}`), word: t(`MOD_VOY_DIR_${side}`), toward: (from + 3) % 6, msLeft: W.nextWindTurnAt(now) - now };
  };

  // ---- storms (phase 5c-3) ------------------------------------------------------------------------------------------
  // Cells of seven hexes born on open sea, drifting with the wind a hex each half-hour for 3 to 6 hours, more often in
  // Fall and Winter (weather-model stormsAt). Seeded with the wind's seed, so online, offline and the Set off popup
  // agree. A sea hex beside a port is shelter, and ice is no sea. They need the setting, not Timed travel: with it off
  // they still wear a hull (no time to lose, no push).
  let stormGeo;
  /** Checks only (dev.mjs voyageDev.storm): a storm put down by hand, { k: -1, born, steps, q, r }. */
  let forcedStorm;
  /** The open sea storms are born on and the sheltered hexes, per terrain and ice (built once each). */
  const geo = () => {
    const tr = state.terrain;
    if (tr === undefined) return undefined;
    if (stormGeo?.tr === tr && stormGeo.ice === layered) return stormGeo;
    const all = [...tr.all()];
    const openSea = all.filter((rec) => shipModel.isSea(rec) && rec.cloud !== true && (Number.isInteger(rec.shore) ? rec.shore : 1) >= W.STORM_OPEN_SEA).map((rec) => ({ q: rec.q, r: rec.r }));
    const sheltered = new Set();
    for (const rec of all) {
      if (!terrainMod.hasFeature(rec, 'port')) continue;
      sheltered.add(keyOf(rec));
      for (const n of neighbours(rec)) sheltered.add(keyOf(n));
    }
    stormGeo = { tr, ice: layered, openSea, sheltered };
    return stormGeo;
  };
  const stormsOn = () => on() && windNow() !== undefined;
  const stormMemo = new Map();
  /** The storms at `ms`: [{ k, q, r, toward, ends, cells: [{ q, r }] }] (cells: its sea hexes, none sheltered). */
  const stormsAt = (ms) => {
    if (!stormsOn()) return [];
    const g = geo();
    if (g === undefined) return [];
    const epoch = Math.floor(ms / W.STORM_STEP_MS);
    const memoKey = `${epoch}|${rawOrder()}|${g.ice}|${forced ?? ''}|${forcedStorm?.born ?? ''}`;
    const hit = stormMemo.get(memoKey);
    if (hit !== undefined) return hit;
    const found = W.stormsAt(windNow().seed, ms, rawOrder(), g.openSea, windAt);
    const mine = W.stormPlace(forcedStorm, ms, windAt);
    if (mine !== undefined) found.push(mine);
    const out = found.map((st) => ({
      ...st,
      cells: W.stormHexes(st).filter((h) => { const rec = state.terrain.get(h.q, h.r); return rec !== undefined && shipModel.isSea(rec) && !g.sheltered.has(keyOf(h)); }),
    })).filter((st) => st.cells.length > 0);
    if (stormMemo.size > 64) stormMemo.clear();
    stormMemo.set(memoKey, out);
    return out;
  };
  /** The storm on hex (q, r) at `ms`, or undefined. */
  const stormAt = (q, r, ms = state.gameNow?.() ?? state.clockNow?.() ?? Date.now()) => stormsAt(ms).find((st) => st.cells.some((h) => h.q === q && h.r === r));
  /** A sea step's storm wear factor for ship.mjs stepsOf (the hex entered now), or undefined. */
  const stepStorm = (rec) => (rec !== undefined && shipModel.isSea(rec) && stormAt(rec.q, rec.r) !== undefined ? W.STORM_WEAR : undefined);
  /**
   * The schedule's storm (clock-model routeTicks `stormOf`): a sea step (`q`, `r`: the hex entered) entered at `ms` in
   * a storm takes ×1.5 the time, and some storms push you a hex downwind (one calm hex more).
   */
  const stormStep = (step, ms) => {
    if (step == null || step.fastTravel === true || step.sea !== true || !Number.isInteger(step.q)) return undefined;
    const st = stormAt(step.q, step.r, ms);
    if (st === undefined) return undefined;
    return { x: W.STORM_TIME, push: W.stormPush(windNow().seed, st.k, step.q, step.r), storm: st };
  };
  /** The storms near (q, r) now, nearest first: [{ storm, dist }] within `reach` hexes. */
  const stormsNear = (q, r, reach = 3) => {
    const now = state.gameNow?.() ?? state.clockNow?.() ?? Date.now();
    const out = [];
    for (const st of stormsAt(now)) {
      let best;
      for (const h of st.cells) { const d = terrainMod.hexDistance({ q, r }, h); if (best === undefined || d < best.d) best = { d, h }; }
      if (best === undefined || best.d > reach) continue;
      // Words for the panel and the strip: which way it lies, which way it drifts.
      const side = best.d === 0 ? undefined : W.headingOf(best.h.q - q, best.h.r - r);
      out.push({ storm: st, dist: best.d, side, sideWord: sideWord(side), driftWord: sideWord(st.toward), ends: st.ends });
    }
    return out.sort((a, b) => a.dist - b.dist);
  };
  /** A key that changes when the storms move (a half-hour) or come and go: the panel redraws on it. */
  const stormKey = () => {
    if (!stormsOn()) return '';
    const now = state.gameNow?.() ?? state.clockNow?.() ?? Date.now();
    return stormsAt(now).map((st) => `${st.k}:${st.q},${st.r}`).join('|');
  };

  // ---- the winter ice ------------------------------------------------------------------------------------------------
  let iceFor;
  let iceRecs = [];
  let iceKeys = new Set();
  let layered = false;
  /** The iced records of this terrain, built once from the table (the layer lifted while they are found). */
  const iceOf = () => {
    if (iceFor !== state.terrain) {
      iceFor = state.terrain;
      layered = false;
      state.terrain.setLayer(undefined);
      const found = W.iceHexes(state.terrain.all(), neighbours);
      iceRecs = found.map(W.icedRecord);
      iceKeys = new Set(found.map(keyOf));
    }
    return iceRecs;
  };
  /** Lays the ice or lifts it to match the season and the setting. True when it changed. */
  const syncIce = () => {
    if (state.terrain === undefined) return false;
    const recs = iceOf();
    const want = on() && W.iceOn(rawOrder());
    if (want === layered) return false;
    state.terrain.setLayer(want ? recs : undefined);
    layered = want;
    log(`ice ${want ? `laid: ${recs.length} hexes` : 'lifted'}`);
    // The path and an open hex box redraw: a hop's "frozen in" reason comes and goes with the ice (build .289).
    try { game.cartography.renderQueue.hexPath = true; game.cartography.renderQueue.hexOverview = true; } catch {}
    return true;
  };
  /** The vessels caught in the ice: [{ kind, v }]. */
  const frozenVessels = () => {
    const out = [];
    for (const kind of ['ship', 'boat']) {
      const v = state.ship?.vessel?.(kind);
      if (v == null || (kind === 'boat' && v.aboard === true)) continue;
      const rec = state.terrain?.get?.(v.q, v.r);
      if (rec?.ice === true) out.push({ kind, v });
    }
    return out;
  };
  const frozen = (v) => v != null && state.terrain?.get?.(v.q, v.r)?.ice === true;

  // ---- telling ---------------------------------------------------------------------------------------------------------
  let away = [];
  const tellAway = (html) => { if (away.length < 8) away.push(html); };
  const icon = (o) => { const m = seasonMedia(o); return m ? `<img class="skill-icon-xs mr-1" src="${esc(m)}" alt="">` : ''; };
  const info = (s) => `<span class="text-info">${esc(s)}</span>`;
  // Each message its own key: the game stacks notifications of one key and shows only the latest text (build .289).
  let noteN = 0;
  const notify = (text, media) => { try { game.notifications.createSuccessNotification(`voyage:weather:${noteN++}`, text, media || ctx.getResourceUrl('assets/icon.webp')); } catch {} };
  const placeWords = (rec) => {
    try {
      const hex = hexAt(rec.q, rec.r);
      const poi = hex?.pointOfInterest;
      if (poi !== undefined && poi.isDiscovered) return poi.name;
      const o = hex.to_oddq();
      return `(${o.col}, ${o.row})`;
    } catch { return ''; }
  };
  const tell = (o, text) => {
    if (offlineNow()) tellAway(icon(o) + text);
    else notify(text.replace(/<[^>]+>/g, ''), seasonMedia(o));
  };
  try {
    ctx.patch(OfflineProgressElement, 'setMessages').after(function () {
      try {
        const lines = takeAway();
        if (lines.length === 0 || this.messageContainer == null) return;
        for (const html of lines) { const h = document.createElement('h5'); h.className = 'font-w600 mb-1'; h.innerHTML = html; this.messageContainer.append(h); }
      } catch (e) { log('weather offline lines failed', e); }
    });
  } catch (e) { log('weather offline summary not patched', e); }
  // Each catch-up tells only its own lines: a catch-up the game gave no box (no action running) leaves nothing for the
  // next one (build .301). When there is no box, ours says what happened: a ship lying idle at sea in a storm, the season
  // turning (the game makes its Welcome Back box only for an action).
  try {
    ctx.patch(Game, 'enterOfflineLoop').after(function () { away = []; stormAway = undefined; });
    let exiting;
    ctx.patch(Game, 'exitOfflineLoop').before(function () { exiting = this._offlineInfo; });
    ctx.patch(Game, 'exitOfflineLoop').after(function () {
      const info = exiting;
      exiting = undefined;
      try {
        if (info == null || info.offlineProgress !== undefined) return;
        const lines = takeAway();
        if (lines.length === 0) return;
        const fire = () => SwalLocale.fire({
          title: t('MISC_STRING_3'),
          html: helpLayout.msgHtml(lines),
          imageUrl: ctx.getResourceUrl('assets/icon.webp'),
          ...helpLayout.MSG_IMAGE,
          didRender: state.popupDidRender,
          customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass(SWAL_CLASS) : SWAL_CLASS,
        });
        if (state.whenNoModal) state.whenNoModal(fire); else fire();
      } catch (e) { log('weather away box failed', e); }
    });
  } catch (e) { log('weather offline loop not patched', e); }

  // ---- the thaw under someone on foot ---------------------------------------------------------------------------------
  /**
   * On the sea and in no vessel (the ice thawed under you, or the setting went off): brought ashore for free by the
   * shortest way. Returns the record you landed on, or undefined.
   */
  const bringAshore = () => {
    if (state.ship?.enabled?.() !== true || state.ship.inVessel?.() !== undefined) return undefined;
    const here = map()?.playerPosition;
    const rec = recOf(here);
    if (rec === undefined || !shipModel.isSea(rec)) return undefined;
    const way = W.wayAshore(rec, neighbours);
    if (way === undefined) return undefined;
    const path = [];
    for (let i = way.length - 1; i >= 0; i--) { const h = hexAt(way[i].q, way[i].r); if (h === undefined) return undefined; path.push(h); }
    try { cart().movePlayer(path, true); } catch (e) { log('weather: the way ashore failed', e); return undefined; }
    if (map()?.playerPosition !== path[0]) return undefined;
    log(`brought ashore at (${path[0].q},${path[0].r}) after the thaw`);
    return way[way.length - 1];
  };

  /** The ice was laid or lifted: a voyage over it stops, and anyone left on the open sea on foot comes ashore. */
  const afterIce = (o, laid) => {
    try { state.clock?.iceChanged?.(iceKeys, t('MOD_VOY_WX_WHY_ICE')); } catch (e) { log('weather: voyage check failed', e); }
    if (laid) {
      for (const { kind, v } of frozenVessels()) {
        tell(o, t('MOD_VOY_WX_FROZEN_IN', { hull: esc(state.ship?.hullName?.(v) ?? ''), where: info(placeWords(v)) }));
        log(`${kind} frozen in at (${v.q},${v.r})`);
      }
      return;
    }
    const landed = bringAshore();
    if (landed !== undefined) tell(o, t('MOD_VOY_WX_ASHORE', { where: info(placeWords(landed)) }));
  };

  // ---- the season changing (the Voyage skill's passiveTick) -------------------------------------------------------------
  let lastOrder;
  const learn = () => { try { state.journal?.learn?.('weather'); } catch {} };
  const learnStorms = () => { try { state.journal?.learn?.('weather'); } catch {} };
  const onSeason = (prev, next) => {
    log(`season: ${W.seasonKey(prev)} -> ${W.seasonKey(next)}`);
    if (!on()) return;
    learn();
    const wasIce = layered;
    const changedIce = syncIce();
    let text = t('MOD_VOY_WX_CAME', { season: info(seasonName(next)) });
    if (changedIce) text += ` ${t(layered ? 'MOD_VOY_WX_FROZE' : 'MOD_VOY_WX_THAWED')}`;
    else if (W.allNight(next)) text += ` ${t('MOD_VOY_WX_ALL_NIGHT')}`;
    else if (W.seasonKey(next) === 'fall') text += ` ${t('MOD_VOY_WX_HARVEST')}`;
    else if (W.seasonKey(next) === 'lemon') text += ` ${t('MOD_VOY_WX_LEMON')}`;
    tell(next, text);
    if (changedIce) afterIce(next, layered && !wasIce);
    state.onSettingsChange();
  };
  // ---- storms meeting vessels ------------------------------------------------------------------------------------------
  // Offline, what the storms did is summed into one Welcome Back line each (sailed through, lying at sea).
  let stormAway;
  const awayStorm = () => (stormAway ??= { hexes: 0, wear: 0, pushes: 0, lying: {} });
  /** What this catch-up has to tell (the season lines, then the storms'), emptied as it is read. */
  function takeAway() {
    const lines = away;
    away = [];
    const a = stormAway;
    stormAway = undefined;
    if (a !== undefined) {
      const red = (x) => `<span class="text-danger">${x}</span>`;
      if (a.hexes > 0) lines.push(`${red(esc(t('MOD_VOY_STORM_AWAY_HEAD')))}: ${esc(t(a.pushes > 0 ? 'MOD_VOY_STORM_AWAY_PUSHED' : 'MOD_VOY_STORM_AWAY', { hexes: `${a.hexes}`, wear: `${a.wear}`, pushes: `${a.pushes}` }))}`);
      for (const [kind, w] of Object.entries(a.lying)) lines.push(`${red(esc(t('MOD_VOY_STORM_AWAY_LYING_HEAD')))}: ${esc(t('MOD_VOY_STORM_AWAY_LYING', { hull: state.ship?.hullName?.(state.ship?.vessel?.(kind)) ?? '', wear: `${w}` }))}`);
    }
    return lines;
  }
  const hullWords = (kind) => esc(state.ship?.hullName?.(state.ship?.vessel?.(kind)) ?? '');
  const sideWord = (side) => (Number.isInteger(side) ? t(`MOD_VOY_DIR_${W.WIND_SIDES[side]}`) : '');
  /**
   * A voyage stepped onto a stormy sea hex (voyage-clock.mjs): `wear` it cost, `push` (a side) when it pushed you a hex
   * downwind (the time is in the schedule already).
   */
  const sailedStorm = ({ wear, push }) => {
    // A free step (towed, or wear off) with no push: nothing happened worth a line.
    if (!(wear > 0) && push === undefined) return;
    learnStorms();
    if (offlineNow()) {
      const a = awayStorm();
      a.hexes += 1; a.wear += wear; if (push !== undefined) a.pushes += 1;
      return;
    }
    const text = push !== undefined ? t('MOD_VOY_STORM_PUSHED', { wear: `${wear}`, side: sideWord(push) }) : t('MOD_VOY_STORM_SAILED', { wear: `${wear}` });
    notify(text, ctx.getResourceUrl('assets/hull_condition.webp'));
  };
  let lastEpoch;
  /** Each half-hour of game time: a vessel lying at sea in a storm (not one under way) wears STORM_LYING_WEAR %. */
  let wearTicks = 0;
  const lyingWear = () => {
    // Once a second of ticks (build .401): the epochs are half-hours and every one since the last look is counted below,
    // so the clock need not be read twenty times a second (its read allocates).
    wearTicks += 1;
    if (wearTicks < 20) return;
    wearTicks = 0;
    const now = state.gameNow?.() ?? state.clockNow?.() ?? Date.now();
    const epoch = Math.floor(now / W.STORM_STEP_MS);
    if (lastEpoch === undefined || epoch < lastEpoch) { lastEpoch = epoch; return; }
    if (epoch === lastEpoch || state.ship?.enabled?.() !== true || !stormsOn()) { lastEpoch = epoch; return; }
    const from = Math.max(lastEpoch + 1, epoch - 400);
    lastEpoch = epoch;
    const underWay = state.clock?.running?.() === true ? state.ship.inVessel?.() : undefined;
    for (let e = from; e <= epoch; e++) {
      for (const kind of ['boat', 'ship']) {
        const v = state.ship.vessel?.(kind);
        if (v == null || kind === underWay || (kind === 'boat' && v.aboard === true && state.ship.big?.() != null)) continue;
        const rec = state.terrain?.get?.(v.q, v.r);
        if (rec === undefined || !shipModel.isSea(rec) || stormAt(v.q, v.r, e * W.STORM_STEP_MS) === undefined) continue;
        const cond = state.ship.cond?.(kind);
        if (!(cond > 0)) continue;
        state.ship.setCond(cond - W.STORM_LYING_WEAR, kind);
        learnStorms();
        if (offlineNow()) { const a = awayStorm(); a.lying[kind] = (a.lying[kind] ?? 0) + W.STORM_LYING_WEAR; }
        else notify(t('MOD_VOY_STORM_LYING', { hull: hullWords(kind), wear: `${W.STORM_LYING_WEAR}`, cond: `${Math.max(0, cond - W.STORM_LYING_WEAR)}` }), ctx.getResourceUrl('assets/hull_condition.webp'));
      }
    }
  };
  const tick = () => {
    if (state.terrain === undefined) return;
    try { lyingWear(); } catch (e) { log('storm wear failed', e); }
    const o = rawOrder();
    if (lastOrder === undefined) { lastOrder = o; return; }
    if (o === lastOrder) return;
    const prev = lastOrder;
    lastOrder = o;
    onSeason(prev, o);
  };
  // The setting switched: the ice follows at once (laid in Winter, lifted with the setting off).
  state.listeners.push(() => {
    try {
      if (state.terrain === undefined || iceFor !== state.terrain) return;
      const was = layered;
      if (syncIce()) { state.overlay?.refresh?.(); afterIce(rawOrder(), layered && !was); }
    } catch (e) { log('weather setting change failed', e); }
  });

  // ---- words for the panel, the strip, Travel Cost and the page -----------------------------------------------------------
  const times = (x) => `×${Number(x.toFixed(2))}`;
  /**
   * The effects of `wx` that apply with the settings as they are, one part each: { icon, x ("×1.5"), words ("fuel ×1.5") }.
   * `icon`: 'fuel', 'time', 'ration' or 'seaFood'.
   */
  const fxParts = (wx) => {
    const prov = state.stores?.enabled?.() === true;
    const timed = state.timed?.() === true;
    const out = [];
    if (prov && wx.fuel !== 1) out.push({ icon: 'fuel', x: times(wx.fuel), words: t('MOD_VOY_WX_FX_FUEL', { x: times(wx.fuel) }) });
    if (prov && wx.rations > 0) out.push({ icon: 'ration', x: `+${wx.rations}`, words: t('MOD_VOY_WX_FX_RATION', { n: `${wx.rations}` }) });
    if (timed && wx.time !== 1) out.push({ icon: 'time', x: times(wx.time), words: t('MOD_VOY_WX_FX_TIME', { x: times(wx.time) }) });
    if (prov && wx.seaFood !== 1) out.push({ icon: 'seaFood', x: times(wx.seaFood), words: t('MOD_VOY_WX_FX_SEA_FOOD', { x: times(wx.seaFood) }) });
    return out;
  };
  /** The effects in words ("fuel ×1.5, ×1.25 time"), for tooltips and notes; '' when none. */
  const fxWords = (wx) => fxParts(wx).map((f) => f.words).join(', ');
  const escHtml = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  /**
   * The effects as icons ("[fuel] ×1.5, [clock] ×1.25"; the user, build .290: "fuel icon x1.5, clock icon x1.25"), each
   * with its words as the tooltip; '' when none.
   */
  const fxHtml = (wx) => fxParts(wx).map((f) => {
    const img = (file) => `<img src="${escHtml(ctx.getResourceUrl(`assets/${file}`))}" alt="">`;
    const icon = f.icon === 'fuel' ? img('fuel.webp') : f.icon === 'time' ? '<i class="fa fa-clock" aria-hidden="true"></i>' : img('ration.webp');
    const gain = f.x.startsWith('\u00d7') && Number(f.x.slice(1)) < 1; // a smaller multiplier is a gain: green (.309, scan B-14)
    return `<span class="voyage-wx-fx${gain ? ' text-success' : ''}" title="${escHtml(f.words)}">${icon}${escHtml(f.x)}</span>`;
  }).join(', ');
  const degrees = (n) => `${n < 0 ? '\u2212' : ''}${Math.abs(n)}\u00b0`;
  /** The text colour of a band: blue for the cold ones, amber for scorching (Melvor's own theme classes). */
  const tone = (band) => (band === 'bitter' || band === 'cold' ? 'text-info' : band === 'scorching' ? 'text-warning' : '');
  /**
   * The weather on a record in words: { t, deg ("−20°"), band, tone, sea, head ("Bitter cold"; '' at sea), effect
   * ("Bitter cold: fuel ×1.5"), fx (the effects as icons, fxHtml) }, or undefined with the setting off. At sea the
   * effect is only what Lemon season does ('' otherwise).
   */
  const describe = (rec) => {
    const wx = effectsAt(rec);
    if (wx === undefined) return undefined;
    const sea = shipModel.isSea(rec);
    const fx = fxWords(wx);
    // At sea the band asks nothing, and the panel already says you are on the water (the user, build .289: "no need to
    // say at sea"): only what Lemon season does, else no effect at all.
    if (sea) return { t: wx.t, deg: degrees(wx.t), band: wx.band, tone: '', sea, head: '', effect: fx, fx: fxHtml(wx) };
    const head = t(`MOD_VOY_WX_BAND_${wx.band.toUpperCase()}`);
    return { t: wx.t, deg: degrees(wx.t), band: wx.band, tone: tone(wx.band), sea, head, effect: fx === '' ? head : `${head}: ${fx}`, fx: fxHtml(wx) };
  };
  /** When the season turns, in words: "Spring in 1 d 6 h: the ice thaws."; with no town, that Spring stays. */
  const nextParts = (s) => {
    if (s.noTown) return { key: 'MOD_VOY_WX_NO_TOWN' };
    if (s.msLeft === undefined) return undefined;
    const vars = { season: s.next.name, time: state.clock?.duration?.(s.msLeft) ?? `${Math.round(s.msLeft / 3600000)}h` };
    if (W.iceOn(s.next.order)) return { key: 'MOD_VOY_WX_NEXT_FREEZE', vars };
    if (W.iceOn(s.order)) return { key: 'MOD_VOY_WX_NEXT_THAW', vars };
    return { key: 'MOD_VOY_WX_NEXT', vars };
  };
  const nextWords = (s) => { const p = nextParts(s); return p === undefined ? '' : t(p.key, p.vars); };
  /** The same as HTML, its time behind the hourglass (build .301). */
  const nextHtml = (s) => {
    const p = nextParts(s);
    if (p === undefined) return '';
    return p.vars === undefined ? esc(t(p.key)) : helpLayout.withTime(p.key, p.vars);
  };
  /**
   * The way's weather for Travel Cost (stores.mjs): the coldest or hottest land hex where a band bites, or undefined:
   * { deg, tone, season, head (its band, "Bitter cold"; '' for Lemon's sea), fx (the effects as icons) }. `steps`:
   * ship.stepsOf steps (their `wx`).
   */
  const wayWords = (steps) => {
    const o = order();
    if (o === undefined || !Array.isArray(steps)) return undefined;
    let pick;
    for (const s of steps) {
      if (s.wx === undefined || s.sea || s.hop > 0 || s.wx.band === 'mild') continue;
      if (pick === undefined || Math.abs(s.wx.t - 10) > Math.abs(pick.t - 10)) pick = s.wx;
    }
    const sea = steps.find((s) => s.wx !== undefined && s.wx.seaFood !== 1);
    if (pick === undefined && sea === undefined) return undefined;
    const wx = pick ?? sea.wx;
    const fx = fxHtml(wx);
    if (fx === '') return undefined;
    return { deg: degrees(wx.t), tone: pick === undefined ? '' : tone(wx.band), season: seasonName(o), head: pick === undefined ? '' : t(`MOD_VOY_WX_BAND_${wx.band.toUpperCase()}`), fx };
  };

  const api = {
    on,
    // A line for this catch-up's Welcome Back (events.mjs: pirates, the stowaway), with the season's and the storms'.
    tellAway,
    describe,
    nextWords,
    nextHtml,
    wayWords,
    degrees,
    seasonName,
    seasonMedia,
    order,
    /** The memo key of anything priced or timed by the weather: '' with the setting off. */
    // The storms (5c-3) move each half-hour: the half-hour is in the key, so a planned step's storm wear stays current.
    key: () => (on() ? `${rawOrder()}|${Math.floor((state.gameNow?.() ?? state.clockNow?.() ?? Date.now()) / W.STORM_STEP_MS)}|${forcedStorm?.born ?? ''}` : ''),
    stepWeather,
    effectsAt,
    stormsOn,
    stormsAt,
    stormAt,
    stepStorm,
    stormStep,
    stormsNear,
    stormKey,
    sailedStorm,
    /** Checks only (dev.mjs voyageDev.storm): a storm on (q, r) from now for `hours` (3 to 6), or none with undefined. */
    forceStorm: (q, r, hours = 3) => {
      if (!Number.isInteger(q) || !Number.isInteger(r)) { forcedStorm = undefined; stormMemo.clear(); return undefined; }
      const now = state.gameNow?.() ?? state.clockNow?.() ?? Date.now();
      const born = Math.floor(now / W.STORM_STEP_MS) * W.STORM_STEP_MS;
      forcedStorm = { k: -1, born, steps: Math.max(1, Math.round(hours * 2)), q, r };
      stormMemo.clear();
      return forcedStorm;
    },
    windOn,
    windFactor,
    wind,
    /** The memo key of anything timed by the wind: '' when it does not apply. */
    windKey: () => (windOn() ? `${forced ?? ''}:${windNow()?.seed ?? ''}` : ''),
    /** Checks only (dev.mjs): force the wind's side (an index of WIND_SIDES), or undefined for the seeded wind. */
    forceWind: (side) => { forced = Number.isInteger(side) && side >= 0 && side < 6 ? side : undefined; },
    /** Night all season (Nightfall, Solar Eclipse, Eternal Darkness) with the setting on. */
    allNight: () => on() && W.allNight(rawOrder()),
    /** Loading rates with the Fall harvest (stores.mjs loadingAt). */
    harvest: (rates) => (on() ? W.harvestRates(rates, rawOrder()) : rates),
    frozen,
    frozenVessels,
    isIce: (rec) => rec?.ice === true,
    /**
     * The season for the panel, strip and page: { order, key, name, media, noTown, msLeft, next: { key, name, media },
     * ice }, or undefined with the setting off. msLeft is Township's hourly ticks still to run (undefined without a town).
     */
    season() {
      if (!on()) return undefined;
      const td = townData();
      const o = rawOrder();
      const created = td?.townCreated === true;
      const ticks = Number(td?.seasonTicksRemaining);
      const n = W.nextOrder(o, td?.previousSeason?.order);
      return {
        order: o, key: W.seasonKey(o), name: seasonName(o), media: seasonMedia(o), noTown: !created,
        msLeft: created && Number.isFinite(ticks) ? ticks * 3600000 : undefined,
        next: { order: n, key: W.seasonKey(n), name: seasonName(n), media: seasonMedia(n) },
        ice: layered,
      };
    },
    /** After a move that was paid (setup.mjs movePlayer): the guide page at the first step a band changed. */
    stepped(steps) { if (Array.isArray(steps) && steps.some((s) => s.wx !== undefined && !W.isPlain(s.wx))) learn(); },
    /** A character was loaded: the season as it is now, and the ice laid before the ship checks where everyone stands. */
    loaded() {
      lastOrder = state.terrain === undefined ? undefined : rawOrder();
      iceFor = undefined;
      try { if (state.terrain !== undefined) syncIce(); } catch (e) { log('weather load failed', e); }
    },
    tick,
  };
  state.weather = api;
  return api;
}
