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

export function install(ctx, { state, W, shipModel, terrainMod, log }) {
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
        const lines = away;
        away = [];
        if (lines.length === 0 || this.messageContainer == null) return;
        for (const html of lines) { const h = document.createElement('h5'); h.className = 'font-w600 mb-1'; h.innerHTML = html; this.messageContainer.append(h); }
      } catch (e) { log('weather offline lines failed', e); }
    });
  } catch (e) { log('weather offline summary not patched', e); }

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
  const tick = () => {
    if (state.terrain === undefined) return;
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
    return `<span class="voyage-wx-fx" title="${escHtml(f.words)}">${icon}${escHtml(f.x)}</span>`;
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
  const nextWords = (s) => {
    if (s.noTown) return t('MOD_VOY_WX_NO_TOWN');
    if (s.msLeft === undefined) return '';
    const vars = { season: s.next.name, time: state.clock?.duration?.(s.msLeft) ?? `${Math.round(s.msLeft / 3600000)} h` };
    if (W.iceOn(s.next.order)) return t('MOD_VOY_WX_NEXT_FREEZE', vars);
    if (W.iceOn(s.order)) return t('MOD_VOY_WX_NEXT_THAW', vars);
    return t('MOD_VOY_WX_NEXT', vars);
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
    describe,
    nextWords,
    wayWords,
    degrees,
    seasonName,
    order,
    /** The memo key of anything priced or timed by the weather: '' with the setting off. */
    key: () => (on() ? `${rawOrder()}` : ''),
    stepWeather,
    effectsAt,
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
