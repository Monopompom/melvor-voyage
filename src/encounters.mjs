// Encounters (design 4.33): bandits and pirates met on the road, played as a card game. The rules are pure
// (src/encounter-model.mjs the fight, src/encounter-rules-model.mjs the tiers and stakes, src/encounter-loot-model.mjs
// the loot); this module reads the game for them: your levels (a card's skill tilt, the loot grade), the items the
// game has, and the texts, which the models give as language keys with their numbers. It rolls for a band on each hex
// entered, keeps the open encounter in the save (a reload comes back to the same fight), settles it in GP, items and
// Battered, and holds a timed voyage until it is over. Offline nobody stops: the bands met wait in the save and fold
// into one encounter on your return. What your GP can't cover is owed to that band, paid off wherever you can trade.
// The popup itself is src/encounter-fight.mjs.

export function install(ctx, { state, E, R, L, D, F, EM, S, terrainMod, shortNumber, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const offlineNow = () => { try { return game._isInOnlineLoop === false; } catch { return false; } };

  /**
   * A model text as words: a number in the game's short form, a language key read, a list read "a, b or c", a
   * `{ key, vars }` filled in (its vars read the same way).
   */
  const text = (x) => {
    if (x === null || x === undefined) return '';
    if (typeof x === 'number') return shortNumber(Math.round(x));
    if (typeof x === 'string') return x.startsWith('MOD_VOY_') ? t(x) : x;
    if (Array.isArray(x)) {
      const words = x.map(text);
      if (words.length < 2) return words[0] ?? '';
      return t('MOD_VOY_ENC_OR', { a: words.slice(0, -1).join(', '), b: words[words.length - 1] });
    }
    if (typeof x === 'object' && typeof x.key === 'string') {
      const vars = {};
      for (const [k, v] of Object.entries(x.vars ?? {})) vars[k] = text(v);
      return t(x.key, vars);
    }
    return String(x);
  };
  /** A fight log line as words. */
  const line = (entry) => text({ key: entry.key, vars: entry.vars });
  const k = (key, vars = {}, gp) => ({ key, vars, ...(gp === undefined ? {} : { gp: Math.round(gp) }) });

  // ---- your levels ---------------------------------------------------------------------------------------------------
  /** Every skill's level by the model's names (its local id: Attack, Cartography, Voyage, …). */
  const levels = () => {
    const out = {};
    try { for (const s of game.skills.allObjects) if (Number.isFinite(s.level)) out[s.localID] = s.level; } catch (e) { log('encounters: levels failed', e); }
    return out;
  };
  /** How each card's skill tilts it (±1 against your average level). */
  const tilt = () => R.tiltOf(levels());
  /** The loot grade, 1 to 5, from your five best skills. */
  const grade = () => R.gradeOf(Object.values(levels()));
  /** Whether the game has an item (an expansion's items are missing without it). */
  const has = (id) => { try { return game.items.getObjectByID(id) !== undefined; } catch { return false; } };

  // ---- the save ------------------------------------------------------------------------------------------------------
  const skill = () => state.voyageSkill?.();
  const record = () => { const s = skill(); return s !== undefined && s.futureRaw === undefined ? s.record : undefined; };
  // The save's `enc`, cleaned once per record and kept on it from then on (so a write never lands on a stale copy).
  const cleaned = new WeakSet();
  const enc = () => {
    const r = record();
    if (r === undefined) return undefined;
    if (!cleaned.has(r)) {
      const raw = r.enc;
      // The deck's presets and charm slots (slice 3) are cleaned by the deck model beside the rest.
      r.enc = { ...R.cleanEnc(raw, E), presets: D.cleanPresets(raw?.presets, E), charms: D.cleanCharms(raw?.charms, E) };
      cleaned.add(r);
    }
    return r.enc;
  };
  const redraw = () => { const s = skill(); if (s !== undefined) s.renderQueue.page = true; try { state.onSettingsChange(); } catch {} };
  const notify = (msg, kind = 'info') => {
    try {
      if (kind === 'danger') game.notifications.createErrorNotification('voyage:enc', msg);
      else game.notifications.createInfoNotification('voyage:enc', msg, ctx.getResourceUrl('assets/icon.svg'));
    } catch {}
  };

  // ---- where a band can be met ---------------------------------------------------------------------------------------
  const hexDist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
  /**
   * The place a step enters: { where, tier, ground } or undefined where no band waits. At sea only the big ship's
   * deep-sea hexes (as the pirates were); on land every hex by its ground. Hops and free steps meet nobody.
   */
  const placeOf = (step, hex) => {
    if (step == null || hex == null || step.fastTravel === true || step.free === true) return undefined;
    const rec = state.recordAt?.(hex);
    if (rec === undefined || rec.cloud === true) return undefined;
    if (step.sea === true) {
      if (step.vessel !== 'ship' || step.deep !== true) return undefined;
      let edge = false;
      try { edge = (state.terrain?.neighbours?.(rec.q, rec.r) ?? []).some((x) => x?.cloud === true); } catch {}
      const sea = state.charts?.seaAt?.(hex);
      return { where: 'sea', tier: R.seaTier(sea, edge), ground: sea ?? '' };
    }
    return { where: 'land', tier: R.landTier(rec.t, hexDist(rec, R.HIDEOUT_HEX)), ground: rec.t ?? '' };
  };
  // The dev console's voyageDev.encounter('force'): the next hex that can meet a band does (once).
  let forced = false;
  /** Whether a ground of the save (a chart sea's port or a land ground) is a sea. */
  const isSea = (ground) => R.SEA_TIER[ground] !== undefined;
  /** A band with its ground, as a debt names it: "Highwaymen of the Highlands", "Corsairs of the Frost Drift sea". */
  const debtName = (band, ground) => {
    if (isSea(ground)) {
      let sea = ground;
      try { sea = state.charts?.seaName?.(ground) ?? ground; } catch {}
      return t('MOD_VOY_ENC_DEBT_WHO_SEA', { band: t(E.bandKey(band)), sea });
    }
    let name = ground;
    try { name = getLangString(terrainMod.classKey(ground)); } catch {}
    return t('MOD_VOY_ENC_DEBT_WHO_LAND', { band: t(E.bandKey(band)), ground: name });
  };

  // ---- your kit: the deck, the charms, the ship (slice 3) ----------------------------------------------------------
  /** Whether you own a game item: in the bank or worn in any equipment set. */
  const ownsItem = (id) => {
    try {
      const it = game.items.getObjectByID(id);
      if (it === undefined) return false;
      if (game.bank.getQty(it) > 0) return true;
      return game.combat.player.equipmentSets.some((set) => set.equipment.checkForItem(it));
    } catch { return false; }
  };
  /** How many of a game item the bank holds. */
  const bankQty = (id) => { try { const it = game.items.getObjectByID(id); return it === undefined ? 0 : game.bank.getQty(it); } catch { return 0; } };
  // Cooking's perfect cook is a setting a player can turn off, so the Hot Meal's perfect cook is the Hot Meal itself (the
  // game wants one). Left alone, its Cooking menu would count each meal twice and the bank would offer the meal as a
  // downgrade of itself.
  const HOT_MEAL = 'voyage:Hot_Meal';
  try {
    ctx.patch(CookingMenuElement, 'updateQuantities').after(function (_r, recipe, g) {
      if (recipe?.product?.id !== HOT_MEAL || recipe.perfectItem !== recipe.product) return;
      const q = g.bank.getQty(recipe.product);
      this.productQty = q;
      this.productCount.textContent = formatNumber(q);
      this.productTooltip?.setContent?.(this.getOwnedTooltipContent(q, 0));
    });
  } catch (e) { log('encounters: the Cooking count patch failed', e); }
  // Cooking makes the downgrade in its postDataRegistration, after the mods' setup; the bank draws its badge when a save
  // loads, so it goes right after Cooking makes it.
  const dropSelfDowngrade = () => {
    try {
      const it = game.items.getObjectByID(HOT_MEAL);
      const ups = it === undefined ? undefined : game.bank.itemUpgrades.get(it);
      if (ups === undefined) return;
      const keep = ups.filter((u) => !(u.isDowngrade && u.upgradedItem === it));
      if (keep.length > 0) game.bank.itemUpgrades.set(it, keep); else game.bank.itemUpgrades.delete(it);
    } catch (e) { log('encounters: the Hot Meal downgrade not removed', e); }
  };
  try { ctx.patch(Cooking, 'postDataRegistration').after(dropSelfDowngrade); } catch (e) { log('encounters: the Cooking data patch failed', e); }
  /** What decides which cards and charms are yours now (crafted cards: what the bank holds). */
  const have = () => ({ levels: levels(), owned: enc()?.owned ?? {}, trophies: enc()?.trophies ?? {}, ownsItem, qty: bankQty });
  /**
   * The deck a band meets: the one you carry, each card to what you hold now. The kept deck stays as you built it, so
   * crafted cards used up come back into it once the bank holds them again.
   */
  const deckNow = () => D.fitDeck(enc()?.deck ?? E.STARTER, have(), E);
  /** The crafted cards the kept deck names but the bank can't fill now: [{ id, short }]. */
  const shortSupplies = () => {
    const e = enc();
    if (e === undefined) return [];
    const fit = deckNow();
    const out = [];
    for (const id of new Set(e.deck)) {
      if (!E.SUPPLY(id)) continue;
      const short = e.deck.filter((x) => x === id).length - fit.filter((x) => x === id).length;
      if (short > 0) out.push({ id, short });
    }
    return out;
  };
  const charmsNow = () => D.charmsInPlay(enc()?.charms ?? [], have(), E);
  /** The big ship's cards at sea (none without one). */
  const shipNow = () => { try { return D.shipKit(state.ship?.big?.()?.hull); } catch { return D.shipKit(undefined); } };
  /** The kit is locked while a trip is under way or a band waits: set before you set off, kept until it is over. */
  const kitLocked = () => enc()?.fight != null || state.clock?.running?.() === true;

  // ---- how strong a band is ------------------------------------------------------------------------------------------
  /** The fight's options for your kit, before the band (the calibration's and the fight's). */
  const kitOpt = (where, tier) => {
    const e = enc();
    const ship = where === 'sea' ? shipNow() : D.shipKit(undefined);
    return { tier, where, deck: e === undefined ? E.STARTER.slice() : deckNow(), cannons: ship.cannons, hull: ship.hull, charms: charmsNow(), tilt: tilt(), gp: 50000, toll: 0 };
  };
  // The ship counts in the key on land too, so one key covers both grounds (a new hull measures again). Supplies don't
  // count (the measure leaves them out), so using one up measures nothing again.
  const cacheKey = (opt) => `${R.calKey({ ...opt, deck: opt.deck.filter((id) => !E.SUPPLY(id)) })}|${JSON.stringify(shipNow())}`;
  // Quick values for a ground and tier not measured in full yet (kept in memory, never saved).
  const quick = new Map();
  /** The strength a band of this ground and tier has against your kit: the saved measure, else a quick one. */
  const strengthFor = (where, tier) => {
    const e = enc();
    const opt = kitOpt(where, tier);
    const key = cacheKey(opt);
    if (e !== undefined && e.cal.key !== key) e.cal = { key, values: {} };
    const id = `${where}:${tier}`;
    const saved = e?.cal.values[id];
    if (saved !== undefined) return saved;
    const q = `${key}|${id}`;
    if (!quick.has(q)) {
      const t0 = performance.now();
      quick.set(q, E.calibrate(opt, 120, E.bandsOf(where), 7));
      log(`encounters: quick calibration ${id} ${quick.get(q).toFixed(3)} in ${Math.round(performance.now() - t0)} ms`);
    }
    return quick.get(q);
  };
  /**
   * The full measure, in slices of a few ms a frame while the game runs: every ground and tier for the kit you carry
   * now, saved, so a band met later needs no wait. Restarts when the kit changes.
   */
  let warming;
  const warm = () => {
    const e = enc();
    if (e === undefined || warming !== undefined || offlineNow()) return;
    const todo = [];
    for (const where of ['land', 'sea']) for (let tier = 1; tier <= 4; tier++) if (e.cal.values[`${where}:${tier}`] === undefined) todo.push([where, tier]);
    if (todo.length === 0) return;
    const [where, tier] = todo[0];
    const opt = kitOpt(where, tier);
    const key = cacheKey(opt);
    if (e.cal.key !== key) e.cal = { key, values: {} };
    const it = E.calibration(opt, 400, E.bandsOf(where), 9);
    const t0 = performance.now();
    warming = { key };
    const slice = () => {
      const now = enc();
      if (now === undefined || now.cal.key !== key) { warming = undefined; return; }
      const until = performance.now() + 8;
      for (;;) {
        const x = it.next();
        if (x.done) {
          now.cal.values[`${where}:${tier}`] = x.value;
          log(`encounters: calibrated ${where}:${tier} ${x.value.toFixed(3)} (${Math.round(performance.now() - t0)} ms spread over frames)`);
          warming = undefined;
          return;
        }
        if (performance.now() >= until) break;
      }
      setTimeout(slice, 40);
    };
    setTimeout(slice, 40);
  };

  // ---- meeting a band ------------------------------------------------------------------------------------------------
  /** The GP your holds would sell for (the toll at sea reads a quarter of it). */
  const holdWorth = () => { try { return state.events?.holdWorth?.() ?? 0; } catch { return 0; } };
  const seed = () => 1 + Math.floor(Math.random() * 0x7ffffffe);
  /** The toll band `b` asks at `p` from the GP you carry now (`{ toll, rule, gp, debt }`): ten points more if you owe it there. */
  const tollAt = (p, b, hexGp) => {
    const gp = Math.max(0, Math.floor(game.gp.amount));
    const debt = R.debtOf(enc()?.debts, b, p.ground);
    const tl = R.tollOf({ where: p.where, tier: p.tier, gp, hexGp, holdWorth: p.where === 'sea' ? holdWorth() : 0, debt: debt > 0 });
    let toll = tl.toll;
    try { toll = state.gear?.tollOf?.(toll) ?? toll; } catch {}
    return { toll, rule: tl.rule, gp, debt };
  };
  /** A band meets you at `p` ({ where, tier, ground }); `hexGp` the GP the game charges for the hex (the toll's floor). */
  const begin = (p, hexGp, band) => {
    const e = enc();
    if (e === undefined) return false;
    const b = band ?? R.pickBand(E.bandsOf(p.where), Math.random());
    const roll = R.bandRoll(Math.random());
    const { toll, rule, gp, debt } = tollAt(p, b, hexGp);
    const kit = kitOpt(p.where, p.tier);
    e.fight = {
      opt: { ...kit, band: b, seed: seed(), strength: strengthFor(p.where, p.tier) * roll, gp, toll, battered: e.battered, know: e.tricks.slice(), learn: true },
      actions: [], stage: 'meet', roll, rule, purse: R.purseOf(p.where, p.tier), ground: p.ground, debt,
    };
    e.calm = R.BREATHER;
    e.met += 1;
    log(`encounters: ${b} met (${p.where}, tier ${p.tier}, ${p.ground}), toll ${toll} GP`);
    view = undefined;
    open();
    redraw();
    return true;
  };
  /**
   * Met while you are away: the band's claim is kept for your return (the toll from the GP you carry now), and the trip
   * goes on as if you got away.
   */
  const meetAway = (p, hexGp, band) => {
    const e = enc();
    if (e === undefined) return;
    const b = band ?? R.pickBand(E.bandsOf(p.where), Math.random());
    const { toll } = tollAt(p, b, hexGp);
    e.away = R.awayAdd(e.away, { band: b, tier: p.tier, where: p.where, ground: p.ground, toll, purse: R.purseOf(p.where, p.tier) });
    e.calm = R.BREATHER;
    e.met += 1;
    log(`encounters: ${b} met while away (${p.where}, tier ${p.tier}, ${p.ground}), toll ${toll} GP, ${e.away.length} waiting`);
  };
  /**
   * A hex entered (`step` the move's step for it, `hex` the game's hex): the breather counts down, then the dice roll
   * (twice the odds on ground where you owe a band). True when a band is met and its popup opens; offline a band met
   * waits for your return and the trip goes on.
   */
  const roll = (step, hex, hexGp = 0) => {
    const e = enc();
    if (e === undefined || e.fight !== null) return false;
    if (e.calm > 0 && !forced) { e.calm -= 1; return false; }
    const p = placeOf(step, hex);
    if (p === undefined || p.tier < 1) return false;
    const m = forced ? { band: undefined } : R.meetOn(p.tier, Math.random(), R.creditors(e.debts, E.bandsOf(p.where), p.ground));
    if (m === undefined) return false;
    forced = false;
    if (offlineNow()) { meetAway(p, hexGp, m.band); return false; }
    return begin(p, hexGp, m.band);
  };
  /**
   * Back from away: the bands met fold into one encounter, led by the strongest, their claims summed (the three
   * biggest). Fight, Pay or Auto-resolve as ever; nobody to run from, the trip is long past them. A voyage under way
   * holds until it is answered.
   */
  const beginAway = () => {
    const e = enc();
    const fold = R.foldAway(e?.away);
    if (fold === undefined || e.fight !== null) return false;
    const { lead } = fold;
    const roll = R.bandRoll(Math.random());
    const gp = Math.max(0, Math.floor(game.gp.amount));
    const kit = kitOpt(lead.where, lead.tier);
    e.fight = {
      opt: { ...kit, band: lead.band, seed: seed(), strength: strengthFor(lead.where, lead.tier) * roll, gp, toll: fold.toll, battered: e.battered, know: e.tricks.slice(), learn: true },
      actions: [], stage: 'meet', roll, rule: 'gp', purse: fold.purse, ground: lead.ground, debt: R.debtOf(e.debts, lead.band, lead.ground),
      away: { n: fold.n, parts: e.away.slice() },
    };
    e.away = [];
    log(`encounters: ${fold.n} band(s) met while away, led by ${lead.band}; claims ${fold.toll} GP, purses ${fold.purse} GP`);
    try { state.clock?.holdForEncounter?.(); } catch (err) { log('encounters: voyage hold failed', err); }
    view = undefined;
    open();
    redraw();
    return true;
  };
  /** An instant move (timed travel off) landed: each hex of it rolls, at most one band a move, met on arrival. */
  const moved = (steps, path, gpPaid = 0) => {
    if (!Array.isArray(steps) || !Array.isArray(path) || steps.length === 0) return false;
    const hexGp = gpPaid / steps.length;
    for (let i = 0; i < steps.length; i++) if (roll(steps[i], path[path.length - 2 - i], hexGp)) return true;
    return false;
  };

  // ---- the fight -----------------------------------------------------------------------------------------------------
  // The fight in memory, rebuilt from the save on demand (a reload replays it from its seed and actions).
  let view;
  const fight = () => {
    const f = enc()?.fight;
    if (f == null) { view = undefined; return undefined; }
    if (view === undefined || view.f !== f) view = { f, s: f.stage === 'meet' ? undefined : E.replay(f.opt, f.actions) };
    return view;
  };
  /** Records an action and plays it. */
  const act = (a, i) => {
    const v = fight();
    if (v?.s === undefined || v.f.stage !== 'fight' || v.s.over) return;
    if (a === 'p') { if (!E.canPlay(v.s, i).ok) return; E.play(v.s, i); }
    else if (a === 't') { if (v.s.tossed || E.CARDS[v.s.hand[i]?.id]?.dead) return; E.toss(v.s, i); }
    else if (a === 'e') E.endRound(v.s);
    v.f.actions.push(a === 'e' ? ['e'] : [a, i]);
    harvest(v.s);
    if (v.s.over) over(v.s);
    render();
  };
  /** The plain strategy plays the rest of this round, then ends it. */
  const autoRound = () => {
    const v = fight();
    if (v?.s === undefined || v.f.stage !== 'fight' || v.s.over) return;
    E.aiRound(v.s, (a, i) => v.f.actions.push([a, i]));
    if (!v.s.over) { E.endRound(v.s); v.f.actions.push(['e']); }
    harvest(v.s);
    if (v.s.over) over(v.s);
    render();
  };
  /** Tricks found go into your trick book. */
  const harvest = (s) => {
    const e = enc();
    const fresh = s.found.filter((id) => !e.tricks.includes(id));
    for (const id of fresh) e.tricks.push(id);
    return fresh;
  };
  const trickLine = (id) => k('MOD_VOY_ENC_RES_TRICK', { name: E.trickKey(id), cards: E.TRICKS[id].seq.map(E.cardKey) });

  // ---- settling ------------------------------------------------------------------------------------------------------
  const gpNow = () => Math.max(0, game.gp.amount);
  /** Moves GP by `n` (never below none). */
  const gpBy = (n) => {
    const d = Math.round(n);
    if (d > 0) game.gp.add(d);
    else if (d < 0) game.gp.remove(Math.min(gpNow(), -d));
  };
  /**
   * What your GP couldn't cover is owed to the band, on the ground it was met (a folded encounter shares it out by the
   * bands' tolls). A line for the result.
   */
  const oweFor = (f, gp, lines) => {
    const e = enc();
    const n = Math.round(gp);
    if (e === undefined || !(n > 0)) return 0;
    const add = f.away !== undefined ? R.shareDebt(f.away.parts, n) : { [R.debtKey(f.opt.band, f.ground)]: n };
    e.debts = R.owe(e.debts, add);
    const who = Object.keys(add).map((key) => { const [band, ground] = key.split(':'); return debtName(band, ground); }).join(', ');
    lines.push(k('MOD_VOY_ENC_RES_OWED', { gp: n, who }));
    log(`encounters: ${n} GP owed (${Object.keys(add).join(', ')})`);
    return n;
  };
  const batter = (lines) => {
    const e = enc();
    e.battered = R.batteredAfterLoss(e.battered);
    lines.push(k('MOD_VOY_ENC_RES_BATTERED', { n: e.battered * E.BATTER }));
  };
  const dropCard = (lines, press) => {
    const c = L.rollCard(Math.random, press);
    if (c === undefined) return;
    const e = enc();
    e.owned[c] = Math.min(99, (e.owned[c] ?? 0) + 1);
    lines.push(k('MOD_VOY_ENC_RES_CARD', { name: E.cardKey(c) }));
  };
  let nextRare; // a dev hook's rare find for the next win
  const lootFor = (f, press) => {
    const opt = press ? { press: true } : {};
    if (nextRare !== undefined) { opt.rare = nextRare; nextRare = undefined; }
    return L.rollLoot(f.opt.band, f.opt.tier, grade(), Math.random, opt, Object.keys(enc().trophies), has);
  };
  const rareNext = (k) => { nextRare = k; };
  /** Your Resolve and their Nerve as the fight ended, for the result's bars (an auto-resolved fight has no actions to replay). */
  const endOf = (s) => ({ you: [Math.max(0, s.you.resolve), s.you.max], band: [Math.max(0, s.band.nerve), s.band.max], captain: s.phase === 'press' });
  /**
   * The crafted cards played and not yet taken from the bank are taken now (each no more than it holds), with a line
   * naming them. `f.usedDone` keeps what was taken, so Press on takes only its own.
   */
  const useUp = (s, lines) => {
    const f = enc().fight;
    const done = f.usedDone ?? {};
    const fresh = {};
    for (const [id, n] of Object.entries(s.used ?? {})) if (n > (done[id] ?? 0)) fresh[id] = n - (done[id] ?? 0);
    const taken = D.usedItems(fresh, bankQty);
    for (const x of taken) {
      try { game.bank.removeItemQuantity(game.items.getObjectByID(x.id), x.qty, true); } catch (err) { log(`encounters: ${x.id} not used up`, err); }
    }
    f.usedDone = { ...(s.used ?? {}) };
    if (taken.length > 0) lines.push(k('MOD_VOY_ENC_RES_USED', { what: taken.map((x) => t('MOD_VOY_ENC_SUPPLY_COUNT', { name: t(E.cardKey(x.card)), n: `${x.qty}` })).join(', ') }));
  };
  /** The fight ended: the result, GP settled at once, the purse and loot waiting for Take or Press on. */
  const over = (s, auto = false) => {
    const e = enc();
    const f = e.fight;
    if (s.over === 'presswin' || s.over === 'presslose') { pressed(s); return; }
    const lines = [];
    useUp(s, lines);
    const st = R.settle(s, { toll: f.opt.toll, purse: f.purse, gp: f.opt.gp });
    if (s.spent > 0) lines.push(k('MOD_VOY_ENC_RES_SPENT', {}, -s.spent));
    const keeps = E.BANDS[f.opt.band].keepGrabs === true;
    if (s.grabbed > 0) lines.push(k(s.over === 'win' ? 'MOD_VOY_ENC_RES_GRABBED_BACK' : s.over === 'fled' && !keeps ? 'MOD_VOY_ENC_RES_GRABBED_DROPPED' : 'MOD_VOY_ENC_RES_GRABBED', {}, -s.grabbed));
    for (const id of s.found) lines.push(trickLine(id));
    gpBy(st.now);
    const res = { tone: 'mid', lines, purse: 0, loot: [], press: false, banked: false, auto, done: 'fight', end: endOf(s), owed: 0 };
    if (s.over === 'win') {
      res.head = k(s.chaseFrom ? 'MOD_VOY_ENC_RES_WIN_CHASE' : 'MOD_VOY_ENC_RES_WIN');
      res.tone = 'good';
      res.purse = st.purse;
      res.loot = lootFor(f, false);
      res.press = !auto;
      dropCard(lines, false);
    } else if (s.over === 'fled') {
      res.head = k(keeps ? 'MOD_VOY_ENC_RES_FLED_GRABS' : 'MOD_VOY_ENC_RES_FLED');
      lines.push(k(keeps ? 'MOD_VOY_ENC_RES_HALF_PURSE' : 'MOD_VOY_ENC_RES_HALF_PURSE_GRABS', {}, st.now + s.spent + s.grabbed));
    } else if (s.over === 'draw') {
      res.head = k('MOD_VOY_ENC_RES_DRAW');
      lines.push(k('MOD_VOY_ENC_RES_DRAW_TAKE', { pct: `${Math.round(st.left * 100)}` }, -st.take));
      res.owed = oweFor(f, st.short, lines);
    } else {
      res.head = k('MOD_VOY_ENC_RES_LOSE');
      res.tone = 'bad';
      lines.push(k('MOD_VOY_ENC_RES_LOSE_TAKE', { pct: `${Math.round(st.left * 100)}`, stake: st.stake }, -st.take));
      res.owed = oweFor(f, st.short, lines);
      batter(lines);
    }
    f.stage = 'result';
    f.res = res;
    log(`encounters: ${f.opt.band} ${s.over}${auto ? ' (auto-resolve)' : ''}, GP ${Math.round(st.now)} now, purse ${res.purse}`);
  };
  /** Press on ended: the captain broke (the purse doubled, the stash) or held (half of both, and Battered). */
  const pressed = (s) => {
    const f = enc().fight;
    const r = f.res;
    for (const id of s.found) if (!r.lines.some((l) => l.key === 'MOD_VOY_ENC_RES_TRICK' && l.vars.name === E.trickKey(id))) r.lines.push(trickLine(id));
    useUp(s, r.lines);
    f.stage = 'result';
    r.end = endOf(s);
    if (s.over === 'presswin') {
      r.head = k('MOD_VOY_ENC_RES_PRESS_WIN');
      r.tone = 'good';
      dropCard(r.lines, true);
      r.loot = r.loot.concat(lootFor(f, true));
      bank(2);
    } else {
      r.head = k('MOD_VOY_ENC_RES_PRESS_LOSE');
      r.tone = 'mid';
      batter(r.lines);
      bank(0.5);
    }
  };
  /** The purse and the loot into your GP and bank (`mult`: Press on's doubling or halving). */
  const bank = (mult = 1) => {
    const e = enc();
    const r = e.fight?.res;
    if (r === undefined || r.banked) return;
    const got = Math.round(r.purse * mult);
    gpBy(got);
    r.lines.push(k(mult > 1 ? 'MOD_VOY_ENC_RES_PURSE_DOUBLED' : mult < 1 ? 'MOD_VOY_ENC_RES_PURSE_HALF' : 'MOD_VOY_ENC_RES_PURSE', {}, got));
    if (mult < 1) r.loot = L.halveHaul(r.loot);
    for (const x of r.loot) {
      if (x.trophy !== undefined) { e.trophies[x.trophy] = true; continue; }
      try { game.bank.addItemByID(x.id, x.qty, true, true); } catch (err) { log(`encounters: loot ${x.id} not banked`, err); }
    }
    r.banked = true;
    r.press = false;
  };
  /** Take the purse (no Press on). */
  const take = () => { bank(1); render(); };
  /** Press on: one more round against their captain. */
  const pressOn = () => {
    const v = fight();
    if (v?.s === undefined || v.f.res?.press !== true || v.f.res.banked) return;
    E.pressOn(v.s);
    v.f.actions.push(['o']);
    v.f.stage = 'fight';
    v.f.res.press = false;
    render();
  };

  // ---- the meet's answers --------------------------------------------------------------------------------------------
  const startFight = () => {
    const f = enc()?.fight;
    if (f == null || f.stage !== 'meet') return;
    f.stage = 'fight';
    f.actions = [];
    view = undefined;
    render();
  };
  const pay = () => {
    const f = enc()?.fight;
    if (f == null || f.stage !== 'meet') return;
    const paid = Math.min(f.opt.toll, Math.floor(gpNow()));
    gpBy(-paid);
    const lines = [k('MOD_VOY_ENC_RES_TOLL', {}, -paid)];
    // A toll you can't cover in full isn't refused: the rest is owed.
    const owed = oweFor(f, f.opt.toll - paid, lines);
    f.res = { head: k('MOD_VOY_ENC_RES_PAID'), tone: 'mid', lines, purse: 0, loot: [], press: false, banked: true, done: 'pay', owed };
    f.stage = 'result';
    log(`encounters: paid ${paid} GP`);
    render();
  };
  /** Running: at sea as the pirates' run was (hull wear, a fifth of the crates, a hex more); on land a hex more and some stores. */
  const run = () => {
    const f = enc()?.fight;
    if (f == null || f.stage !== 'meet' || f.away !== undefined) return;
    const lines = [];
    if (f.opt.where === 'sea') {
      const wear = EM.pirateRunWear(S.WEAR.deep);
      const to = EM.condAfterRun(state.ship?.cond?.('ship') ?? 0, wear);
      try { state.ship?.setCond?.(to, 'ship'); } catch (e) { log('encounters: hull wear failed', e); }
      let gone = [];
      try { gone = state.hold?.jettison?.(EM.pirateRunLoss(state.hold?.hold?.('ship')?.length ?? 0), 'ship') ?? []; } catch (e) { log('encounters: jettison failed', e); }
      lines.push(k('MOD_VOY_ENC_RES_RUN_HULL', { wear: `${wear}`, cond: `${to}` }));
      if (gone.length > 0) lines.push(k('MOD_VOY_ENC_RES_RUN_CRATES', { n: `${gone.length}` }));
    } else {
      const st = state.stores?.stores?.();
      if (st !== undefined && (st.food > 0 || st.fuel > 0)) {
        const food = Math.floor(st.food * R.RUN_LAND_DROP);
        const fuel = st.fuel * R.RUN_LAND_DROP;
        state.stores.set(st.food - food, st.fuel - fuel);
        lines.push(k('MOD_VOY_ENC_RES_RUN_STORES', { pct: `${Math.round(R.RUN_LAND_DROP * 100)}` }));
      }
    }
    if (state.clock?.running?.() === true) lines.push(k('MOD_VOY_ENC_RES_RUN_TIME'));
    f.res = { head: k('MOD_VOY_ENC_RES_RAN'), tone: 'mid', lines, purse: 0, loot: [], press: false, banked: true, done: 'run' };
    f.stage = 'result';
    log(`encounters: ran (${f.opt.where})`);
    render();
  };
  /** Auto-resolve: one real fight played the plain way, settled at once. */
  const autoResolve = () => {
    const f = enc()?.fight;
    if (f == null || f.stage !== 'meet') return;
    const s = E.autoFight(f.opt);
    harvest(s);
    over(s, true);
    view = undefined;
    render();
  };
  /** The result read: the encounter is over (a waiting voyage goes on). */
  const close = () => {
    const e = enc();
    const f = e?.fight;
    if (f == null || f.stage !== 'result') return;
    if (f.res?.banked !== true) bank(1);
    const done = f.res?.done ?? 'fight';
    e.fight = null;
    view = undefined;
    asking = false;
    try { Swal.close(); } catch {}
    try { state.clock?.encDone?.(done); } catch (err) { log('encounters: voyage hold failed', err); }
    redraw();
  };

  // ---- debts ---------------------------------------------------------------------------------------------------------
  /** What you owe, the biggest first: [{ key, band, ground, gp, name }]. */
  const debts = () => Object.entries(enc()?.debts ?? {})
    .map(([key, gp]) => { const [band, ground] = key.split(':'); return { key, band, ground, gp, name: debtName(band, ground) }; })
    .sort((a, b) => b.gp - a.gp);
  const debtTotal = () => debts().reduce((a, d) => a + d.gp, 0);
  /** Why debts can't be paid off now, or '' when they can: a port or market (where trade works), some GP, no band waiting. */
  const payOffWhy = () => {
    if (debtTotal() <= 0) return 'none';
    if (enc()?.fight != null) return 'band';
    try { if (state.tradeLocked?.() === true) return 'trade'; } catch {}
    if (gpNow() < 1) return 'gp';
    return '';
  };
  /** Pays your debts off with the GP you carry: the biggest first, each whole or as far as it goes. */
  const payOff = () => {
    const e = enc();
    if (e === undefined || payOffWhy() !== '') return 0;
    const r = R.payDebts(e.debts, gpNow());
    gpBy(-r.paid);
    e.debts = r.debts;
    const left = debtTotal();
    notify(t(left > 0 ? 'MOD_VOY_ENC_DEBT_PAID_PART' : 'MOD_VOY_ENC_DEBT_PAID', { gp: shortNumber(r.paid), left: shortNumber(left) }));
    log(`encounters: paid ${r.paid} GP of debts, ${left} left`);
    redraw();
    return r.paid;
  };

  // ---- shop cards ----------------------------------------------------------------------------------------------------
  /** The kinds of trade place in reach (port, market, city, capital), as trade itself reaches them; all with trade unlocked. */
  const kindsNow = () => {
    try {
      if (state.settings?.trade?.() === false) return D.TRADE_KINDS.slice();
      const rec = state.recordAt?.(state.position?.());
      return D.kindsHere(rec, rec === undefined ? [] : state.knownNeighbours?.(rec) ?? []);
    } catch { return []; }
  };
  /** Why a copy of a shop card can't be bought here and now, or '' (deck-model buyWhy). */
  const buyWhy = (id) => D.buyWhy(id, { owned: enc()?.owned ?? {}, kinds: kindsNow(), gp: gpNow(), qty: bankQty, grade: grade(), busy: enc()?.fight != null });
  /** Buys one copy of a shop card: its GP and goods at your grade, the copy yours for good. */
  const buyCard = (id) => {
    const e = enc();
    if (e === undefined || buyWhy(id) !== '') return false;
    const price = D.priceOf(id, grade());
    gpBy(-price.gp);
    for (const x of price.items) {
      try { game.bank.removeItemQuantity(game.items.getObjectByID(x.id), x.qty, true); } catch (err) { log(`encounters: ${x.id} not taken`, err); }
    }
    e.owned[id] = Math.min(D.COPIES.shop, (e.owned[id] ?? 0) + 1);
    notify(t('MOD_VOY_DECK_SHOP_BOUGHT', { name: t(E.cardKey(id)), n: `${e.owned[id]}`, max: `${D.COPIES.shop}` }));
    log(`encounters: bought ${id} (${e.owned[id]} of ${D.COPIES.shop}) for ${price.gp} GP and ${price.items.map((x) => `${x.qty} ${x.id}`).join(', ')}`);
    redraw();
    return true;
  };

  // ---- Battered and its cures ----------------------------------------------------------------------------------------
  const restPlace = (rec) => rec !== undefined && rec.cloud !== true && Array.isArray(rec.f) && ['port', 'city', 'capital'].some((x) => rec.f.includes(x));
  /** Patch up: 200 food from the stores cures Battered at once. */
  const canPatch = () => (enc()?.battered ?? 0) > 0 && (state.stores?.stores?.()?.food ?? 0) >= R.PATCH_FOOD;
  const patch = () => {
    const e = enc();
    const st = state.stores?.stores?.();
    if (!canPatch() || st === undefined) return false;
    state.stores.set(st.food - R.PATCH_FOOD, st.fuel);
    e.battered = 0;
    e.rest = 0;
    notify(t('MOD_VOY_ENC_PATCHED', { food: `${R.PATCH_FOOD}` }));
    log('encounters: patched up with food');
    render();
    redraw();
    return true;
  };
  let lastNow;
  /** Once a second (offline too): rest in a town or port heals Battered; the popup comes back if something closed it. */
  let ticks = 0;
  const tick = () => {
    ticks += 1;
    if (ticks < 20) return;
    ticks = 0;
    const e = enc();
    if (e === undefined) return;
    const now = state.gameNow?.() ?? Date.now();
    const dt = lastNow === undefined ? 0 : Math.max(0, Math.min(now - lastNow, 60000));
    lastNow = now;
    if (e.battered > 0 && state.clock?.running?.() !== true && restPlace(state.recordAt?.(state.position?.()))) {
      e.rest += dt;
      if (e.rest >= R.REST_MS) {
        e.battered = 0;
        e.rest = 0;
        log('encounters: rested, no longer Battered');
        if (!offlineNow()) notify(t('MOD_VOY_ENC_RESTED'));
        redraw();
      }
    }
    if (offlineNow()) return;
    if (e.fight !== null) open();
    else if (e.away.length > 0) beginAway();
    else if (state.clock?.running?.() !== true) warm();
  };

  // ---- the popup -----------------------------------------------------------------------------------------------------
  // The meet's odds: up to ODDS_N fights played the plain way (about ±3 points), never fewer than ODDS_MIN (about ±5).
  // Played inside the popup's first draw they made one long frame (build .481: up to a second, as a fight costs 0.4 ms
  // or 3 ms in game depending on how long ago the save loaded). Now they are played in slices of a few ms from the
  // moment the popup is asked for, in the wait before it opens; the popup shows what the slices got through, made up
  // to ODDS_MIN at once if they fell short, and the number stays as shown.
  const ODDS_N = 300;
  const ODDS_MIN = 100;
  let odds; // { id, it, tally, value }
  const oddsId = (f) => `${f.opt.seed}:${f.opt.gp}`;
  const oddsFor = (f) => {
    const id = oddsId(f);
    if (odds?.id !== id) odds = { id, it: E.oddsRun(f.opt, ODDS_N), tally: undefined, value: undefined };
    return odds;
  };
  /** Plays fights until `until` (one at least) or the last one. */
  const oddsStep = (run, until) => {
    while (run.value === undefined) {
      const x = run.it.next();
      if (x.done) run.value = x.value; else run.tally = x.value;
      if (performance.now() >= until) break;
    }
  };
  const prepOdds = () => {
    const f = enc()?.fight;
    if (f == null || f.stage !== 'meet') return;
    const run = oddsFor(f);
    const slice = () => {
      if (odds !== run || run.value !== undefined) return;
      oddsStep(run, performance.now() + 8);
      if (run.value === undefined) setTimeout(slice, 16);
    };
    setTimeout(slice, 0);
  };
  /** The meet's odds for `f`: the fights played so far, at least ODDS_MIN of them. */
  const oddsOf = (f) => {
    const run = oddsFor(f);
    while (run.value === undefined && (run.tally?.n ?? 0) < ODDS_MIN) oddsStep(run, 0);
    if (run.value === undefined) run.value = E.oddsOfTally(run.tally);
    return run.value;
  };

  let asking = false;
  const ui = { hint: false, toss: false };
  /** The popup on the open encounter (asked again by the tick if something else closed it). */
  const open = () => {
    if (asking || offlineNow() || enc()?.fight == null) return;
    asking = true;
    prepOdds();
    const go = () => {
      if (enc()?.fight == null) { asking = false; return; }
      F.popup({ api, onClosed: () => { asking = false; } });
    };
    try { if (state.whenNoModal) state.whenNoModal(go); else go(); } catch (e) { asking = false; log('encounters: popup failed', e); }
  };
  const render = () => { try { F.render?.(api); } catch (e) { log('encounters: render failed', e); } };
  /** A move or a set-off asked while a band waits: refused, with why. */
  const refuse = () => notify(t('MOD_VOY_ENC_FIRST'), 'danger');

  // ---- dev: the sims in game -----------------------------------------------------------------------------------------
  /**
   * The starter deck at fixed strength against every band, per tier (the Node test's numbers, run in the game's own
   * engine): { band: [win % at tiers 1 to 4] }. n fights each.
   */
  const sim = (n = 300) => {
    const out = {};
    for (const band of Object.keys(E.BANDS)) {
      const where = E.BANDS[band].where === 'sea' ? 'sea' : 'land';
      out[band] = [1, 2, 3, 4].map((tier) => {
        const o = E.odds({ band, tier, deck: E.STARTER, where, cannons: where === 'sea' ? 2 : 0, hull: where === 'sea', gp: 50000, toll: 500, know: [] }, n);
        return Math.round(100 * (o.win + o.fled));
      });
    }
    return out;
  };
  /** One seeded fight played the plain way, its log as words (to read the texts in game). */
  const sample = (band = 'highwaymen', tier = 1, sd = 1) => {
    const where = E.BANDS[band]?.where === 'sea' ? 'sea' : 'land';
    const s = E.autoFight({ band, tier, seed: sd, deck: E.STARTER, where, gp: 50000, toll: 2500, know: [], tilt: tilt() });
    return { over: s.over, rounds: s.round, log: s.log.map(line) };
  };
  /** Meets a band here and now (dev): `band` or a random one of the ground, `tier` 1 to 4, `where` land or sea. */
  const meetNow = (band, tier = 1, where) => {
    const w = where ?? (E.BANDS[band]?.where === 'sea' ? 'sea' : 'land');
    const e = enc();
    if (e === undefined || e.fight !== null) return 'an encounter is open already, or no save';
    if (band !== undefined && !E.bandsOf(w).includes(band)) return `${band} is not met ${w === 'sea' ? 'at sea' : 'on land'}`;
    const hexGp = 40 * tier;
    return begin({ where: w, tier: Math.max(1, Math.min(4, tier)), ground: w === 'sea' ? 'BeginningPort' : 'highlands' }, hexGp, band) ? `${band ?? 'a band'} met` : 'not met';
  };

  /** Bands met as if you were away (dev): `n` of them on the ground you stand on (a tier 1 at least), folded on the next tick. */
  const awayNow = (n = 3, where = 'land') => {
    const e = enc();
    if (e === undefined) return 'no save';
    for (let i = 0; i < n; i++) {
      const tier = 1 + Math.floor(Math.random() * 4);
      meetAway({ where, tier, ground: where === 'sea' ? 'BeginningPort' : 'highlands' }, 40 * tier);
    }
    return `${e.away.length} band(s) waiting`;
  };
  /** A debt (dev): `gp` owed to `band` on `ground`. */
  const oweNow = (gp = 1000, band = 'highwaymen', ground = 'highlands') => {
    const e = enc();
    if (e === undefined || E.BANDS[band] === undefined) return 'no save, or no such band';
    e.debts = R.owe(e.debts, { [R.debtKey(band, ground)]: gp });
    redraw();
    return e.debts;
  };

  const api = {
    text, line, levels, tilt, grade, has, sim, sample, E, R, L,
    debts, debtTotal, payOffWhy, payOff, debtName, awayNow, oweNow, kindsNow, buyWhy, buyCard, bankQty, deckNow, shortSupplies,
    /** The offline summary's line: how many bands wait on your return ('' for none). */
    awayNote: () => { const n = enc()?.away?.length ?? 0; return n === 0 ? '' : t(n === 1 ? 'MOD_VOY_ENC_AWAY_NOTE_ONE' : 'MOD_VOY_ENC_AWAY_NOTE', { n: `${n}` }); },
    enc, fight, ui, placeOf, roll, moved, act, autoRound, startFight, pay, run, autoResolve, take, pressOn, close,
    canPatch, patch, tick, open, refuse, warm, meetNow, rareNext, strengthFor, oddsOf,
    D, have, ownsItem, charmsNow, shipNow, kitLocked, redraw, notify,
    /** The hull wear a run at sea costs (%). */
    runWear: () => EM.pirateRunWear(S.WEAR.deep),
    /** Whether an encounter is open (a band met, its result not yet read). */
    fightOpen: () => enc()?.fight != null,
    force: () => { forced = true; return 'the next hex that can meet a band does'; },
    bandName: (id) => t(E.bandKey(id)),
    offline: offlineNow,
  };
  state.encounters = api;
  log(`encounters: models loaded (${Object.keys(E.CARDS).length} cards, ${Object.keys(E.BANDS).length} bands)`);
  return api;
}
