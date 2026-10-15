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

const DIRECTION_WORDS = { N: 'north', NE: 'north-east', E: 'east', SE: 'south-east', S: 'south', SW: 'south-west', W: 'west', NW: 'north-west' };

export function install(ctx, { state, rules, terrainMod, model, log }) {
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
    return terrainMod.CLASS_INFO[rec.t]?.label;
  };

  /**
   * A reading in words for the player's Voyage level: { text, html }. Level 1: "Compass: Warm, pointing north-east."
   * Level 10 adds "4 hexes away", level 25 the place: "Compass: Warm, pointing north-east, 4 hexes away (Wet Forest)."
   */
  const describe = (reading) => {
    if (reading === undefined) return undefined;
    const detail = model.compassDetail(voyageLevel());
    const dir = DIRECTION_WORDS[reading.dir] ?? reading.dir;
    const steps = detail.steps ? `, ${reading.distance} ${reading.distance === 1 ? 'hex' : 'hexes'} away` : '';
    const name = detail.name ? placeName(reading.target) : undefined;
    const place = name ? ` (${name})` : '';
    const across = reading.across ? ', across the water' : '';
    const word = reading.word.charAt(0).toUpperCase() + reading.word.slice(1);
    const tail = `, pointing ${dir}${steps}${place}${across}.`;
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    return { text: `Compass: ${word}${tail}`, html: `<span class="voyage-compass-line">Compass: <b class="voyage-compass-${reading.word}">${word}</b>${esc(tail)}</span>` };
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

  const popup = (it, purse) => {
    try {
      const gp = purse > 0 ? `<div>You also have <b>${numberWithCommas(purse)} GP</b> for the road.</div>` : '';
      SwalLocale.fire({
        title: `<img class="voyage-title-icon" src="${it.media}">Far Shores`,
        width: '43em', // a third wider than the 32em default: the welcome has four paragraphs
        html: '<div class="text-left voyage-locked"><div class="voyage-locked-lines">' +
          '<div>Skills now work only where the land allows: trees for Woodcutting, water for Fishing, a town for crafting.</div>' +
          '<div><b>Cartography is how you find your way.</b> Survey the hexes around you to learn what is there; the map, the hints and travel all open up as you survey.</div>' +
          '<div><b>Get to a trading place first.</b> You can sell and buy only in a town, port or market, or next to one, and a new journey does not start next to one. Survey toward the nearest and travel there.</div>' +
          gp +
          '<div>The <b>Wayfinder\'s Compass</b> works while it is in your bank. When you try a skill that doesn\'t work where you stand on the map (Mining, Woodcutting, Smithing and the like) and you don\'t know where it works, the compass tells you how close the nearest place is (<b class="voyage-compass-hot">Hot</b>, <b class="voyage-compass-warm">Warm</b>, <b class="voyage-compass-cold">Cold</b>, <b class="voyage-compass-freezing">Freezing</b>) and which way to walk. Levelling the <b>Voyage</b> skill makes it sharper. If you lose it, the shop has another.</div>' +
          '</div></div>',
        icon: 'info',
        confirmButtonText: 'Got it',
        customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass({ popup: 'voyage-ui' }) : { popup: 'voyage-ui' },
      });
    } catch (e) { log('welcome popup failed', e); }
  };

  /** True when this character has ever had the compass: the game save remembers it even when storage does not. */
  const everFound = (it) => { try { return game.stats.itemFindCount(it) > 0; } catch { return false; } };

  ctx.onInterfaceReady(() => {
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
  });
}
