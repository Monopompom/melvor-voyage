// Pilotage in play (4.36, round 3): counts the hexes you travel in each sea and land region, says when a level brings
// something (online a notice, offline a Welcome Back line), and answers the level, the speed and the unlocks of the
// hex you ask about. The rules are pure (pilotage-model.mjs); this module reads the move and the save.
//
// The save: `record.pilotage` (v32), { [area]: hexes travelled there }.

export function install(ctx, { state, P, CM, hexes, terrainMod, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const skill = () => state.voyageSkill?.();
  const offlineNow = () => { try { return game._isInOnlineLoop === false; } catch { return false; } };

  // ---- the areas: drawn once from the table ------------------------------------------------------------------------
  let map;
  const areaMap = () => {
    if (map === undefined) {
      try { map = P.areas(hexes, CM.seas(hexes, P.SKIP)); } catch (e) { log('pilotage areas failed', e); map = new Map(); }
    }
    return map;
  };
  /** The area of a hex ({ q, r }), or undefined (cloud, off the table). */
  const areaAt = (hex) => (hex == null ? undefined : areaMap().get(`${hex.q},${hex.r}`));
  const seedOf = new Map(hexes.filter((h) => typeof h.poi === 'string').map((h) => [h.poi, h]));
  /** The place's name as the game shows it once found, else from its id. */
  const placeName = (poi) => {
    const rec = seedOf.get(poi);
    if (rec !== undefined && Array.isArray(rec.f) && rec.f.includes('capital')) return t('MOD_VOY_PILOT_CAPITAL');
    try {
      const hex = rec === undefined ? undefined : game.cartography?.activeMap?.getHex(new HexCoords(rec.q, rec.r));
      const p = hex?.pointOfInterest;
      if (p !== undefined && p.isDiscovered) return p.name;
    } catch {}
    return terrainMod.areaLabel(poi);
  };
  /** "Vibrant Port waters", "Old Village lands". */
  const nameOf = (area) => {
    const m = /^(sea|land)_(\w+)$/.exec(area ?? '');
    if (m === null) return '';
    return t(m[1] === 'sea' ? 'MOD_VOY_PILOT_SEA' : 'MOD_VOY_PILOT_LAND', { place: placeName(m[2]) });
  };

  // ---- the record ----------------------------------------------------------------------------------------------------
  /** The save's record, cleaned in place (callers may hold it); undefined with no skill or a newer save's record. */
  const rec = () => {
    const s = skill();
    if (s === undefined || s.futureRaw !== undefined || s.record == null) return undefined;
    const cur = s.record.pilotage;
    const clean = P.cleanPilotage(cur);
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) { s.record.pilotage = clean; return clean; }
    for (const k of Object.keys(cur)) if (!(k in clean)) delete cur[k];
    return Object.assign(cur, clean);
  };
  const hexesIn = (area) => rec()?.[area] ?? 0;
  const levelIn = (area) => (area === undefined ? 1 : P.levelOf(hexesIn(area)));
  const levelAt = (hex) => levelIn(areaAt(hex));
  /** Every hex within `n` steps of `hex`, itself included. */
  const near = (hex, n) => {
    const out = [];
    for (let dq = -n; dq <= n; dq++) for (let dr = Math.max(-n, -dq - n); dr <= Math.min(n, -dq + n); dr++) out.push({ q: hex.q + dq, r: hex.r + dr });
    return out;
  };

  // ---- what a level says -------------------------------------------------------------------------------------------
  const lineFor = (area, level) => {
    const vars = { area: nameOf(area), level: `${level}` };
    if (level === P.UNLOCKS.forecast) return t(area.startsWith('land_') ? 'MOD_VOY_PILOT_UNLOCK_FORECAST_LAND' : 'MOD_VOY_PILOT_UNLOCK_FORECAST', vars);
    if (level === P.UNLOCKS.bandTier) return t('MOD_VOY_PILOT_UNLOCK_BAND', vars);
    if (level === P.UNLOCKS.gold) return t('MOD_VOY_PILOT_UNLOCK_GOLD', vars);
    if (P.SPEED_LEVELS.includes(level)) return t('MOD_VOY_PILOT_UNLOCK_SPEED', { ...vars, pct: `${Math.round((1 - P.speedFactor(level)) * 100)}` });
    return t('MOD_VOY_PILOT_LEVEL', vars);
  };
  const away = [];
  const say = (text) => {
    if (offlineNow()) { away.push(text); return; }
    try { notifyPlayer(skill() ?? game.attack, text, 'success'); } catch {}
  };
  try {
    ctx.patch(OfflineProgressElement, 'setMessages').after(function () {
      try {
        const lines = away.splice(0);
        if (lines.length === 0 || this.messageContainer == null) return;
        for (const text of lines) {
          const h = document.createElement('h5');
          h.className = 'font-w600 mb-1';
          h.innerHTML = `<img class="skill-icon-xs mr-1" src="${esc(ctx.getResourceUrl('assets/icon.svg'))}" alt=""><span>${esc(text)}</span>`;
          this.messageContainer.append(h);
        }
      } catch (e) { log('pilotage offline lines failed', e); }
    });
  } catch (e) { log('pilotage offline summary not patched', e); }

  // ---- counting a move -----------------------------------------------------------------------------------------------
  /**
   * A paid move landed: `steps` as the skill's XP reads them, `entered` the hexes stepped onto (start left out, cloud
   * left out). A fast-travel move teaches nothing; every other hex counts in its area, by sea or on foot.
   */
  let stamp = 0;
  const moved = (steps, entered) => {
    const r = rec();
    if (r === undefined || !Array.isArray(entered) || entered.length === 0) return;
    if ((steps ?? []).some((s) => s?.fastTravel)) return;
    const count = new Map();
    for (const hex of entered) { const a = areaAt(hex); if (a !== undefined) count.set(a, (count.get(a) ?? 0) + 1); }
    let changed = false;
    for (const [area, n] of count) {
      const d = P.addHexes(r, area, n);
      if (d === undefined) continue;
      if (d.after !== d.before) changed = true;
      for (const level of P.noticeLevels(d.before, d.after)) say(lineFor(area, level));
      if (d.after !== d.before) log(`pilotage ${area}: ${d.before} → ${d.after} (${r[area]} hexes)`);
    }
    if (changed) { stamp += 1; const s = skill(); if (s !== undefined) s.renderQueue.page = true; try { state.herePanel?.render?.(); } catch {} }
  };

  const api = {
    areaAt, nameOf, levelAt, levelIn, hexesIn, moved,
    hexesFor: P.hexesFor,
    unlocks: P.unlockTable,
    stormShore: P.STORM_SHORE,
    /** Bumped when a level changes: the map's storm tracks redraw. */
    stamp: () => stamp,
    /** The share of a hex's time left for you on `hex`: 1, down to 0.9 at 99. */
    speedAt: (hex) => P.speedFactor(levelAt(hex)),
    seesForecast: (hex) => P.seesForecast(levelAt(hex)),
    /** A storm's eye on `hex` shows its track: an area at 20 or more within STORM_SHORE hexes (a sea's own, a land's shore). */
    seesStormAt: (hex) => hex != null && near(hex, P.STORM_SHORE).some((h) => P.seesForecast(levelAt(h))),
    seesBandTier: (hex) => P.seesBandTier(levelAt(hex)),
    /** Every area with its level, seas first then lands, each by name: [{ area, name, level, hexes, into, need, next }]. */
    all: () => {
      const keys = [...new Set(areaMap().values())];
      return keys.map((area) => {
        const n = hexesIn(area);
        const p = P.progress(n);
        return { area, name: nameOf(area), level: p.level, hexes: n, into: p.into, need: p.need, next: P.nextUnlock(p.level), gold: P.isGold(p.level), sea: area.startsWith('sea_') };
      }).sort((a, b) => (a.sea === b.sea ? a.name.localeCompare(b.name) : a.sea ? -1 : 1));
    },
  };
  state.pilotage = api;
  return api;
}
