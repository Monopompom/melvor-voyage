// The Wayfinder's Compass: a free item that gives a vague reading (hot/warm/cold/freezing plus a
// direction) toward the nearest place a locked skill works, known or not. It never names a hex. Readings prefer
// the player's own landmass; when the only target is overseas the reading says so. Needs the item in the bank.
// Granted once per character with a starter purse and a one-time welcome popup; sellable for 1 GP and sold again by
// the shop (data/package.json). Hidden while the table is not trusted (relaxed mode) or rules are off.
// Grows with the Voyage skill (phase 3a): level 1 is temperature and direction, later levels add the hex count and
// then the name of the place (voyage-model.mjs COMPASS_LEVELS). Readings are memoised without the level; the level is
// applied when a reading is put into words (`describe`).
//
// "Once" is decided by the compass's own TimesFound stat, which lives in the game save. Character storage is only a
// second record: the loader saves it for mods installed through the Mod Manager, and a Creator Toolkit zip lost it
// on every reload (build .16 granted a compass and the popup on each load).

// Modal buttons: confirm green, cancel blue outline (the game's default cancel is red; grey means disabled).
const SWAL_CLASS = { popup: 'voyage-ui', confirmButton: 'btn btn-success m-1', cancelButton: 'btn btn-outline-info m-1' };

const ITEM_ID = 'voyage:Wayfinder_Compass';
const SAVE_KEY = 'save';
const SAVE_VERSION = 1;
/**
 * Starter purse, given with the compass. A new character has 0 GP and every trading place is two hexes from the
 * start. The cheapest way to trade costs 754 GP: survey "A New Start" (14,10), walk there, and it touches Old
 * Village and Farmers Market. 2,500 GP leaves room for a roundabout route: Old Village 1,090, Farmers Market 1,420,
 * Beginning Port 1,620, Harvest Haven Farm 2,213 by the cheapest path (AoD data, 15 Oct 2026).
 */
const STARTER_GP = 2500;

/** Reading words, coldest last; also the CSS class suffix (voyage-compass-<word>) and the key MOD_VOY_COMPASS_WORD_<WORD>. */
const WORDS = ['hot', 'warm', 'cold', 'freezing'];

export function install(ctx, { state, rules, terrainMod, model, log }) {
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Player-facing text comes from languages/<code>.json (Translatable text).
  const hexes = (n) => templateLangString(n === 1 ? 'MOD_VOY_HEXES_ONE' : 'MOD_VOY_HEXES_MANY', { count: `${n}` });
  const dirWord = (dir) => (dir ? getLangString(`MOD_VOY_DIR_${dir}`) : '');
  const wordText = (w) => getLangString(`MOD_VOY_COMPASS_WORD_${w.toUpperCase()}`);
  const wordHtml = (w) => `<b class="voyage-compass-${w}">${esc(wordText(w))}</b>`;
  const load = () => {
    try {
      const raw = ctx.characterStorage.getItem(SAVE_KEY);
      if (raw && typeof raw === 'object' && raw.v === SAVE_VERSION) return raw;
    } catch (e) { log('storage read failed', e); }
    return { v: SAVE_VERSION, compassGiven: false };
  };
  const store = (save) => { try { ctx.characterStorage.setItem(SAVE_KEY, save); } catch (e) { log('storage write failed', e); } };

  const item = () => { try { return game.items.getObjectByID(ITEM_ID); } catch { return undefined; } };
  const owned = () => { try { const it = item(); return it !== undefined && game.bank.hasItem(it); } catch { return false; } };

  const word = (distance) => (distance <= 2 ? 'hot' : distance <= 5 ? 'warm' : distance <= 10 ? 'cold' : 'freezing');

  /** Reading toward the nearest of `candidates` passing `ok`, same landmass first. */
  const readingTo = (candidates, pos, ok = () => true) => {
    if (pos === undefined || state.terrain === undefined || candidates.length === 0) return undefined;
    const mass = state.terrain.landmass(pos.q, pos.r);
    const same = mass === undefined ? undefined : terrainMod.nearestIn(candidates, pos, (rec) => ok(rec) && state.terrain.landmass(rec.q, rec.r) === mass);
    const found = same ?? terrainMod.nearestIn(candidates, pos, ok);
    if (found === undefined) return undefined;
    return { word: word(found.distance), dir: terrainMod.directionLabel(pos, found.hex), distance: found.distance, target: found.hex, across: same === undefined && mass !== undefined };
  };

  const voyageLevel = () => { try { return game.skills.getObjectByID(model.SKILL_ID)?.level ?? 1; } catch { return 1; } };

  /** The target's name for the top compass stage: its POI (discovered or not), its area or dungeon, else its terrain. */
  const placeName = (rec) => {
    if (rec === undefined) return undefined;
    try {
      const poi = game.cartography?.activeMap?.getHex(new HexCoords(rec.q, rec.r))?.pointOfInterest;
      if (poi !== undefined) return poi.name;
    } catch {}
    if (rec.area) return terrainMod.areaLabel(rec.area);
    if (rec.dungeon) return terrainMod.areaLabel(rec.dungeon);
    return terrainMod.CLASS_INFO[rec.t] === undefined ? undefined : getLangString(terrainMod.classKey(rec.t));
  };

  /**
   * A reading in words for the player's Voyage level: { text, html }. Level 1: "Compass: Warm, pointing north-east."
   * Level 10 adds "4 hexes away", level 25 the place: "Compass: Warm, pointing north-east, 4 hexes away (Wet Forest)."
   */
  const describe = (reading) => {
    if (reading === undefined) return undefined;
    const detail = model.compassDetail(voyageLevel());
    const name = detail.name ? placeName(reading.target) : undefined;
    const parts = {
      dir: dirWord(reading.dir),
      steps: detail.steps ? templateLangString('MOD_VOY_COMPASS_STEPS', { hexes: hexes(reading.distance) }) : '',
      place: name ? templateLangString('MOD_VOY_COMPASS_PLACE', { name }) : '',
      across: reading.across ? getLangString('MOD_VOY_COMPASS_ACROSS') : '',
    };
    // The html escapes everything but the coloured word, which goes in through a marker.
    const MARK = '\u0001';
    const html = esc(templateLangString('MOD_VOY_COMPASS_READING', { ...parts, word: MARK })).replace(MARK, wordHtml(reading.word));
    return { text: templateLangString('MOD_VOY_COMPASS_READING', { ...parts, word: wordText(reading.word) }), html: `<span class="voyage-compass-line">${html}</span>` };
  };

  const memo = new Map();
  let memoKey = '';
  const readingFor = (skillId, pos) => {
    if (pos === undefined || state.terrain === undefined) return undefined;
    const key = `${state.settings.strictness()}`;
    if (key !== memoKey) { memo.clear(); memoKey = key; }
    const k = `${skillId}@${terrainMod.hexKey(pos.q, pos.r)}`;
    if (memo.has(k)) return memo.get(k);
    const opts = state.ruleOpts();
    const r = readingTo(terrainMod.candidatesFor(state.terrain, rules, skillId), pos, (rec) => rules.allowedAt(skillId, rec, opts));
    memo.set(k, r);
    return r;
  };

  const available = () => state.active() && owned();
  state.compass = {
    owned,
    available,
    readingFor: (skillId, pos) => (available() ? readingFor(skillId, pos) : undefined),
    readingTo: (hexes, pos) => (available() ? readingTo(hexes, pos) : undefined),
    describe,
  };
  state.listeners.push(() => memo.clear());

  /**
   * The first-steps paragraph. Where skills are bought (Adventure) every skill starts locked and there is nothing to
   * sell, so the first coins come from combat: name the nearest area that pays, with its road (user report, 15 Oct
   * 2026: a player who wanders off spends the purse before finding one). Elsewhere: get to a trading place.
   */
  const firstSteps = () => {
    const trade = getLangString('MOD_VOY_COMPASS_FIRST_TRADE');
    try {
      if (game.currentGamemode?.allowSkillUnlock !== true || !state.settings.combat()) return trade;
      const pos = state.position();
      const road = pos === undefined ? undefined : state.trader?.combatRoad(pos);
      if (road === undefined || road.area === undefined) return trade;
      const steps = road.path.length - 1;
      const dir = dirWord(terrainMod.directionLabel(pos, road.path[0]));
      const at = (() => { try { const o = road.path[0].to_oddq(); return `${o.col}, ${o.row}`; } catch { return `${road.path[0].q}, ${road.path[0].r}`; } })();
      return templateLangString('MOD_VOY_COMPASS_FIRST_COMBAT', { area: esc(road.area.name), at, hexes: hexes(steps), dir: esc(dir), gp: numberWithCommas(road.gp) });
    } catch (e) { log('first steps failed', e); return trade; }
  };

  const popup = (it, purse) => {
    try {
      const gp = purse > 0 ? ` ${templateLangString('MOD_VOY_COMPASS_WELCOME_PURSE', { gp: numberWithCommas(purse) })}` : '';
      SwalLocale.fire({
        title: `<img class="voyage-title-icon" src="${it.media}">${getLangString('MOD_VOY_COMPASS_WELCOME_TITLE')}`,
        width: '40em', // wider than the 32em default: three paragraphs (compacted on request, build .42)
        html: '<div class="text-left voyage-locked"><div class="voyage-locked-lines">' +
          `<div>${getLangString('MOD_VOY_COMPASS_WELCOME_LAND')}</div>` +
          `<div>${firstSteps()}${gp}</div>` +
          `<div>${templateLangString('MOD_VOY_COMPASS_WELCOME_COMPASS', { scale: WORDS.map(wordHtml).join(', ') })}</div>` +
          '</div></div>',
        icon: 'info',
        confirmButtonText: getLangString('MOD_VOY_BUTTON_GOT_IT'),
        customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass(SWAL_CLASS) : SWAL_CLASS,
      });
    } catch (e) { log('welcome popup failed', e); }
  };

  /** True when this character has ever had the compass: the game save remembers it even when storage does not. */
  const everFound = (it) => { try { return game.stats.itemFindCount(it) > 0; } catch { return false; } };

  // After the tutorial (setup.mjs afterTutorial): the purse and the welcome are for the map, which opens then.
  ctx.onInterfaceReady(() => state.afterTutorial(grant));
  function grant() {
    try {
      if (state.mode !== 'strict') return;
      const save = load();
      const it = item();
      if (it === undefined) { log('compass item missing; not granted'); return; }
      if (save.compassGiven || everFound(it) || owned()) {
        if (!save.compassGiven) { save.compassGiven = true; store(save); }
        return;
      }
      game.bank.addItem(it, 1, false, true, true, false, 'Voyage');
      const bankItem = game.bank.items.get(it);
      if (bankItem !== undefined && !bankItem.locked) game.bank.toggleItemLock(bankItem);
      let purse = 0;
      try { game.gp.add(STARTER_GP); purse = STARTER_GP; } catch (e) { log('starter purse failed', e); }
      save.compassGiven = true;
      store(save);
      log(`compass and ${purse} GP granted`);
      setTimeout(() => popup(it, purse), 500);
    } catch (e) { console.error('[Voyage] compass grant failed', e); }
  }
}
