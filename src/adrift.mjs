// Adrift (phase 5b part two; the canvas "Stranded at sea"): the game side. The rules
// are in adrift-model.mjs.
//
// Aboard on a sea hex more than one hex from a coast your hull may land on, when the next hex can't be paid (under one
// ration, short of the GP, or a hull beyond its reach), you are Adrift: a state in the save (v16 `adrift`), checked
// once a second while nothing sails and at once when a voyage's step is refused. Three ways out:
//  - the drift: free, one hex every 30 min toward the coast, never onto a place; the Voyage skill's passiveTick runs it,
//    so it goes on while fishing and offline;
//  - a tow: a passing ship to the nearest port you know, for the way's travel cost and half again, sailed as a timed
//    voyage (voyage-clock.mjs, `tow` on the voyage) at 3 min a hex with free steps and no Stop here;
//  - fishing, the only skill that works: each catch may bring one of the map's own sea folk (RESCUES), played on the
//    next tick so a tow never stops Fishing inside its own action.
// Adrift replaces, at sea only, the sea hunger floor (ship.mjs `adrift` steps), the homeward rule's instant free moves
// (travel is refused while Adrift) and the trader's sea crossing (stores.mjs). It applies only with the rules and timed
// travel on; otherwise phase 4's floors stand and the state clears.

const SWAL_CLASS = { popup: 'voyage-ui', confirmButton: 'btn btn-success m-1', cancelButton: 'btn btn-outline-info m-1', denyButton: 'btn btn-outline-info m-1' };
const FISHING_ID = 'melvorD:Fishing';
const CARTOGRAPHY_ID = 'melvorAoD:Cartography';
/** The fake port of the Cursed Isle sells nothing and docks nobody (cargo-model NO_CARGO). */
const NO_PORTS = ['FakePort'];
/** The rescue popups' art: as big as the trader's (the user, build .210). */
const RESCUE_ART = { imageWidth: 112, imageHeight: 112, imageAlt: '' };

export function install(ctx, { state, A, C, shipModel, terrainMod, helpLayout, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (n) => numberWithCommas(Math.floor(n));
  const res = (file) => ctx.getResourceUrl(`assets/${file}`);
  const skill = () => state.voyageSkill?.();
  const usable = () => { const s = skill(); return s !== undefined && s.futureRaw === undefined; };
  /** Adrift can apply: the rules (the gates) and timed travel on, the ship rules running. */
  const on = () => usable() && state.active() === true && state.timed?.() === true && state.ship?.enabled?.() === true;
  const offlineNow = () => { try { return game._isInOnlineLoop === false; } catch { return false; } };
  const cart = () => game.cartography;
  const map = () => cart()?.activeMap;
  const hexAt = (q, r) => { try { return map()?.getHex(new HexCoords(q, r)); } catch { return undefined; } };
  const recOf = (hex) => (hex == null ? undefined : state.terrain?.get?.(hex.q, hex.r));
  const keyOf = (h) => terrainMod.hexKey(h.q, h.r);
  const neighbours = (rec) => state.terrain?.neighbours?.(rec.q, rec.r) ?? [];
  const duration = (ms) => state.clock?.duration?.(ms) ?? `${Math.round(ms / 60000)} min`;
  const clockAt = (ms) => state.clock?.clockAt?.(ms) ?? '';
  const hexes = (n) => t(n === 1 ? 'MOD_VOY_CLOCK_HEX_ONE' : 'MOD_VOY_CLOCK_HEX_MANY', { count: `${n}` });
  const notify = (text, kind = 'success', media = res('icon.webp')) => {
    try {
      if (kind === 'danger') game.notifications.createErrorNotification('voyage:adrift', text);
      else game.notifications.createSuccessNotification('voyage:adrift', text, media);
    } catch {}
  };
  const { mark, marked } = helpLayout;
  const gpMark = (gp) => mark.gp(game.gp.media, num(gp), game.gp.amount < gp);
  const swal = (opts) => SwalLocale.fire({
    didRender: state.popupDidRender,
    customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass(SWAL_CLASS) : SWAL_CLASS,
    ...opts,
  });

  // ---- the state in the save ---------------------------------------------------------------------------------------
  let seen;
  const cur = () => {
    const s = skill();
    if (s === undefined || s.futureRaw !== undefined) return null;
    const raw = s.record.adrift ?? null;
    if (raw !== seen) { const a = A.cleanAdrift(raw); s.record.adrift = a; seen = a; }
    return s.record.adrift;
  };
  const setCur = (a) => { const s = skill(); if (s === undefined) return; s.record.adrift = a; seen = a; };
  const lastEnd = () => { const s = skill(); return s === undefined ? null : A.cleanAdriftEnd(s.record.adriftEnd); };
  const setEnd = (e) => { const s = skill(); if (s !== undefined) s.record.adriftEnd = e; };

  // ---- where you are -----------------------------------------------------------------------------------------------
  /** { hex, rec, kind ('boat'|'ship'), v (the vessel), tier } when you are aboard on the sea, else undefined. */
  const aboardAtSea = () => {
    const hex = state.position?.();
    const rec = recOf(hex);
    if (hex === undefined || rec === undefined || !shipModel.isSea(rec)) return undefined;
    const kind = state.ship?.inVessel?.();
    if (kind === undefined) return undefined;
    const v = state.ship.vessel(kind);
    return v == null ? undefined : { hex, rec, kind, v, tier: shipModel.tierOf(v) };
  };
  const geo = () => state.ship?.geo?.();
  const homeOf = (rec, tier) => geo()?.home(rec, tier) ?? Infinity;
  // The drift's own map (adrift-model driftIndex), one per hull tier, rebuilt with the terrain (a character load).
  let driftFor;
  let driftVersion;
  let driftMaps = new Map();
  const driftLeft = (tier) => {
    // The winter ice (phase 5c-1) changes the sea: counted again when the terrain's layer does.
    if (driftFor !== state.terrain || driftVersion !== state.terrain.version) { driftFor = state.terrain; driftVersion = state.terrain.version; driftMaps = new Map(); }
    let f = driftMaps.get(tier);
    if (f === undefined) {
      const seas = [...state.terrain.all()].filter(shipModel.isSea);
      f = A.driftIndex(seas, { neighbours, home: (r) => homeOf(r, tier), isPlace: shipModel.isPlace, key: keyOf });
      driftMaps.set(tier, f);
    }
    return f;
  };
  /** The drift's next hex from `rec` for hull tier `tier` (a terrain record), or undefined next to the coast. */
  const driftNext = (rec, tier) => A.driftTarget(rec, neighbours(rec).filter(shipModel.isSea), driftLeft(tier), shipModel.isPlace);
  /** GP the game charges for a path (Cartography.getTravelCosts, the cuts included), destination first. */
  const gpOf = (path) => {
    try { return cart().getTravelCosts(path).getCurrencyQuantityArray().reduce((sum, { currency, quantity }) => sum + (currency === game.gp ? quantity : 0), 0); } catch { return 0; }
  };

  /** Why you would be adrift here and now, or undefined (adrift-model causeOf). */
  const causeHere = () => {
    if (!on()) return undefined;
    const at = aboardAtSea();
    if (at === undefined || !(homeOf(at.rec, at.tier) > 1)) return undefined;
    const next = driftNext(at.rec, at.tier);
    const nextHex = next === undefined ? undefined : hexAt(next.q, next.r);
    const st = state.stores;
    return A.causeOf({
      applies: true,
      beyond: shipModel.beyondReach(at.rec, at.v, geo()),
      provisions: st?.enabled?.() === true,
      food: st?.stores?.().food ?? 0,
      gp: game.gp.amount,
      stepGp: nextHex === undefined ? 0 : gpOf([nextHex, at.hex]),
    });
  };
  const isAdrift = () => cur() !== null;
  const towing = () => state.clock?.towing?.() === true;

  // ---- free moves: the drift and the sea folk ------------------------------------------------------------------------
  // A drift or a rescue is no trip: nothing is found on the way, no travel event rolls and a discovery buff keeps its
  // moves (as a voyage's inner steps, voyage-clock.mjs). Installed after the clock's patches, so these run first.
  let moving = false;
  try {
    ctx.patch(Cartography, 'discoverPOI').replace(function (original, ...args) {
      if (moving || (towing() && state.clock?.stepping?.())) return undefined;
      return original(...args);
    });
    ctx.patch(Cartography, 'rollForTravelEvent').replace(function (original, ...args) {
      if (moving || (towing() && state.clock?.stepping?.())) return undefined;
      return original(...args);
    });
  } catch (e) { log('adrift free-move rules not patched', e); }
  const keepMoves = () => {
    try {
      const set = cart().activeDiscoveryModifiers;
      const was = [...set].map((d) => [d, d.movesLeft]);
      return () => {
        let changed = false;
        for (const [d, n] of was) { if (d.movesLeft !== n || !set.has(d)) { d.movesLeft = n; set.add(d); changed = true; } }
        if (changed) cart().computeProvidedStats(true);
      };
    } catch { return () => {}; }
  };
  /** Moves you (and the ship you are in) to `dest` for free: the setup.mjs movePlayer replace's ignoreCosts move. */
  const freeMove = (dest, from) => {
    if (dest === undefined || from === undefined || dest === from) return false;
    moving = true;
    const putBack = keepMoves();
    try { cart().movePlayer([dest, from], true); } catch (e) { log('adrift move failed', e); } finally { moving = false; }
    putBack();
    return map()?.playerPosition === dest;
  };

  // ---- the offline summary -------------------------------------------------------------------------------------------
  // What happened while away, told in the Welcome Back box under the game's own lines (OfflineProgressElement.setMessages
  // asks only the action the catch-up began with, which is Fishing while Adrift). Not saved: the box comes in the same
  // session as the catch-up.
  let away = { lines: [], drifted: 0 };
  const icon = () => { const m = skill()?.media; return m ? `<img class="skill-icon-xs mr-1" src="${esc(m)}" alt="">` : ''; };
  const pos = (s) => `<span class="text-success">${esc(s)}</span>`;
  const warn = (s) => `<span class="text-warning">${esc(s)}</span>`;
  const tellAway = (html) => { if (away.lines.length < 12) away.lines.push(html); };
  try {
    ctx.patch(OfflineProgressElement, 'setMessages').after(function () {
      try {
        const lines = [...away.lines];
        // The drift's count after the line that began it, and before the line that ended it ashore.
        if (away.drifted > 0) lines.splice(Math.min(lines.length > 0 ? 1 : 0, away.endAt ?? Infinity), 0, icon() + t('MOD_VOY_ADRIFT_OFFLINE_DRIFTED', { hexes: pos(hexes(away.drifted)) }));
        // A rescue's tow that docked while away: the game asked only the action the catch-up began on (Fishing).
        if (lines.length > 0) lines.push(...(state.clock?.offlineMessages?.({ endingOnly: true }) ?? []));
        const a = cur();
        if (a !== null) lines.push(icon() + t('MOD_VOY_ADRIFT_OFFLINE_STILL', { why: warn(whyWords(a.why)), left: pos(hexes(leftHexes())) }));
        away = { lines: [], drifted: 0 };
        if (lines.length === 0 || this.messageContainer == null) return;
        for (const html of lines) { const h = document.createElement('h5'); h.className = 'font-w600 mb-1'; h.innerHTML = html; this.messageContainer.append(h); }
      } catch (e) { log('adrift offline lines failed', e); }
    });
  } catch (e) { log('adrift offline summary not patched', e); }

  // ---- beginning and ending ----------------------------------------------------------------------------------------
  const whyWords = (why) => t(`MOD_VOY_ADRIFT_WHY_${String(why).toUpperCase()}`);
  const placeWords = (hex) => {
    try {
      const poi = hex.pointOfInterest;
      if (poi !== undefined && poi.isDiscovered) return poi.name;
      const rec = recOf(hex);
      const o = hex.to_oddq();
      return `${rec === undefined ? '' : `${getLangString(terrainMod.recKey(rec))} `}(${o.col}, ${o.row})`;
    } catch { return ''; }
  };
  /** Hexes still to drift from where you are. */
  const leftHexes = () => {
    const at = aboardAtSea();
    if (at === undefined) return 0;
    const n = driftLeft(at.tier)(at.rec);
    return Number.isFinite(n) ? n : 0;
  };
  /**
   * You are Adrift: why ('food' | 'gp' | 'hull'), `name` the voyage it ended ('' none). Anything but Fishing stops; the
   * guide page is written; the popup (online) tells the three ways out.
   */
  const begin = (why, name = '') => {
    const at = aboardAtSea();
    if (at === undefined || cur() !== null) return;
    const of = C.ticksOf(A.DRIFT_MS);
    setCur(A.cleanAdrift({ q: at.hex.q, r: at.hex.r, why, since: state.clockNow?.() ?? Date.now(), left: of, of, drifted: 0, fishMs: 0, caught: {}, name, pending: '' }));
    setEnd(null);
    try {
      const act = game.activeAction;
      if (act !== undefined && act !== game.fishing && act !== skill()) act.stop();
    } catch (e) { log('adrift stop failed', e); }
    try { state.journal?.learn?.('adrift'); } catch {}
    log(`adrift at (${at.hex.q},${at.hex.r}): ${why}${name ? ` (voyage to ${name})` : ''}, ${leftHexes()} hexes to drift`);
    if (offlineNow()) tellAway(icon() + t('MOD_VOY_ADRIFT_OFFLINE_BEGAN', { time: esc(clockAt(state.clockNow?.() ?? Date.now())), why: warn(whyWords(why)) }));
    else explain();
    changed();
  };
  /** The spell adrift ends: 'ashore' (next to the coast; `by` the rescue that did it) or 'clear' (it no longer applies). */
  const finish = (how, by = '') => {
    const a = cur();
    if (a === null) return;
    const here = map()?.playerPosition;
    setCur(null);
    setEnd(A.cleanAdriftEnd({ how, by, at: state.clockNow?.() ?? Date.now(), drifted: a.drifted, where: here === undefined ? '' : placeWords(here) }));
    // The voyage's own "adrift" ending is stale now: this note says how it ended.
    try { const s = skill(); if (s?.record.ending?.how === 'adrift') s.record.ending = { ...s.record.ending, closed: true, seen: true }; } catch {}
    log(`adrift ended: ${how}${by ? ` (${by})` : ''} after ${a.drifted} hexes`);
    if (how === 'ashore') {
      if (offlineNow()) { away.endAt = away.lines.length; tellAway(icon() + t('MOD_VOY_ADRIFT_OFFLINE_ASHORE', { where: esc(here === undefined ? '' : placeWords(here)) })); }
      else notify(t('MOD_VOY_ADRIFT_ASHORE_NOTE', { where: here === undefined ? '' : placeWords(here) }));
    }
    changed();
  };
  /** A tow begins: the spell adrift ends without a note (the voyage's ending tells the tow). */
  const towed = () => { setCur(null); setEnd(null); changed(); };

  // ---- the tick (the Voyage skill's passiveTick) -----------------------------------------------------------------------
  let n = 0;
  const tick = () => {
    if (!usable()) return;
    const a = cur();
    n++;
    if (a === null) {
      // Checked once a second (once every 10 s in a catch-up), never while a voyage sails: its refused step says so itself.
      if (n % (offlineNow() ? 200 : 20) !== 0 || state.clock?.running?.()) return;
      const why = causeHere();
      if (why !== undefined) begin(why);
      return;
    }
    if (game.activeAction === game.fishing) a.fishMs += C.TICK_MS;
    if (a.pending !== '') { const id = a.pending; a.pending = ''; play(id); return; }
    if (n % (offlineNow() ? 200 : 20) === 0) {
      if (state.clock?.running?.()) { towed(); return; }
      const here = map()?.playerPosition;
      if (!on() || here === undefined) { finish('clear'); return; }
      const why = causeHere();
      if (why === undefined) { const at = aboardAtSea(); finish(at !== undefined && homeOf(at.rec, at.tier) <= 1 ? 'ashore' : 'clear'); return; }
      if (why !== a.why) { a.why = why; changed(); }
    }
    a.left--;
    if (a.left > 0) return;
    a.left = a.of;
    driftOne(a, '');
  };
  /** One hex of drift toward the coast (the drift's timer, or the Sadge Kraken's shove). */
  const driftOne = (a, by) => {
    const at = aboardAtSea();
    if (at === undefined) { finish('clear'); return false; }
    const next = driftNext(at.rec, at.tier);
    if (next === undefined) { finish('ashore', by); return false; }
    if (!freeMove(hexAt(next.q, next.r), at.hex)) { log('adrift: the drift was refused'); return false; }
    a.drifted++;
    if (offlineNow()) away.drifted++;
    if (homeOf(next, at.tier) <= 1) finish('ashore', by);
    else changed();
    return true;
  };

  // ---- the ways to a port ----------------------------------------------------------------------------------------------
  /** Is the port of this terrain record known (its map place discovered)? */
  const known = (portRec) => { try { return hexAt(portRec.q, portRec.r)?.pointOfInterest?.isDiscovered === true; } catch { return false; } };
  /** The ports the hull may dock at: { rec, dock (a sea record beside it) }. */
  const ports = (tier) => {
    const out = [];
    for (const rec of state.terrain?.all?.() ?? []) {
      if (!shipModel.isPort(rec) || NO_PORTS.includes(rec.poi) || (geo()?.islandTier(rec) ?? 1) > tier) continue;
      const dock = shipModel.dockSpot(rec, neighbours(rec));
      if (dock !== undefined) out.push({ rec, dock });
    }
    return out;
  };
  /**
   * The sea way from where you are to a port: `which` 'known' (the nearest you know), 'any' (the nearest at all) or
   * 'bottle' (a random one within BOTTLE_RANGE sea hexes, known or not). { port (record), path (game hexes, destination
   * first), hexes, find (not known yet) } or undefined.
   */
  const wayTo = (which, roll = Math.random()) => {
    const at = aboardAtSea();
    if (at === undefined) return undefined;
    const list = ports(at.tier).filter((p) => which !== 'known' || known(p.rec));
    if (list.length === 0) return undefined;
    const goals = new Map(list.map((p) => [keyOf(p.dock), p.rec]));
    const o = { neighbours, isSea: shipModel.isSea, key: keyOf };
    let found;
    if (which === 'bottle') {
      const all = A.seaWay(at.rec, goals, { ...o, limit: A.BOTTLE_RANGE, all: true });
      found = all.length === 0 ? A.seaWay(at.rec, goals, o) : all[Math.min(all.length - 1, Math.floor(roll * all.length))];
    } else found = A.seaWay(at.rec, goals, o);
    if (found === undefined || found.path.length < 2) return undefined;
    const path = [];
    for (let i = found.path.length - 1; i >= 0; i--) { const h = hexAt(found.path[i].q, found.path[i].r); if (h === undefined) return undefined; path.push(h); }
    return { port: found.goal, path, hexes: path.length - 1, find: !known(found.goal) };
  };
  const portName = (rec) => { try { const poi = hexAt(rec.q, rec.r)?.pointOfInterest; return poi?.name ?? rec.poi; } catch { return rec.poi; } };
  // The paid tow, priced once per hex and purse (the way is a breadth-first search of the sea).
  let towMemo;
  const paidTow = () => {
    const a = cur();
    if (a === null) return undefined;
    const here = map()?.playerPosition;
    const key = `${here?.q},${here?.r}|${map()?.discoveredPOIs?.length ?? 0}`;
    if (towMemo?.key !== key) {
      const way = wayTo('known');
      towMemo = { key, value: way === undefined ? null : { ...way, gp: A.towPrice(gpOf(way.path)), ms: way.hexes * A.TOW_MS } };
    }
    return towMemo.value ?? undefined;
  };
  /** Starts a tow along `way` (wayTo), `kind` one of TOW_KINDS, `gp` paid. True when under way. */
  const startTow = (kind, way, gp = 0) => {
    if (way === undefined) return false;
    const ok = state.clock?.setOff?.({ path: way.path, name: portName(way.port), chain: [], tow: { kind, port: way.port.poi, find: way.find, gp } }) === true;
    if (ok) towed();
    log(`tow (${kind}) to ${way.port.poi}: ${way.hexes} hexes${gp > 0 ? `, ${gp} GP` : ''}${ok ? '' : ' REFUSED'}`);
    return ok;
  };
  const towMs = (kind) => (A.rescueOf(kind)?.ms ?? A.TOW_MS);
  /** A tow docked (voyage-clock.mjs arrive): the bottle's port is found on docking. */
  const onDocked = (tow) => {
    if (tow?.find !== true || tow.port === '') return;
    try {
      const rec = state.terrain?.poi?.(tow.port);
      const poi = rec === undefined ? undefined : hexAt(rec.q, rec.r)?.pointOfInterest;
      if (poi !== undefined && !poi.isDiscovered) { cart().discoverPOI(poi); log(`found ${tow.port} on docking`); }
    } catch (e) { log('port discovery on docking failed', e); }
  };

  /** Pay for a tow: asks first, with the price and the way (the page's green button). */
  const offerTow = () => {
    const tow = paidTow();
    if (tow === undefined || cur() === null) return;
    if (game.gp.amount < tow.gp) { notify(t('MOD_VOY_ADRIFT_TOW_SHORT', { gp: num(tow.gp), have: num(game.gp.amount) }), 'danger'); return; }
    const name = portName(tow.port);
    swal({
      title: t('MOD_VOY_ADRIFT_TOW_TITLE'),
      html: helpLayout.msgHtml([
        marked(t, 'MOD_VOY_ADRIFT_TOW_ASK', { hexes: hexes(tow.hexes) }, { name: mark.name(name), time: mark.time(duration(tow.ms)), gp: gpMark(tow.gp) }),
        esc(t('MOD_VOY_ADRIFT_TOW_RULES')),
      ]),
      imageUrl: hullArt(),
      ...helpLayout.MSG_IMAGE,
      showCancelButton: true,
      confirmButtonText: t('MOD_VOY_ADRIFT_TOW_PAY', { gp: num(tow.gp) }),
      cancelButtonText: t('MOD_VOY_ADRIFT_NOT_NOW'),
    }).then((r) => {
      if (!r.isConfirmed || cur() === null) return;
      const now = paidTow();
      if (now === undefined || game.gp.amount < now.gp) { notify(t('MOD_VOY_ADRIFT_TOW_SHORT', { gp: num(now?.gp ?? tow.gp), have: num(game.gp.amount) }), 'danger'); return; }
      game.gp.remove(now.gp);
      if (!startTow('pay', now, now.gp)) { game.gp.add(now.gp); notify(t('MOD_VOY_ADRIFT_TOW_FAILED'), 'danger'); return; }
      notify(t('MOD_VOY_ADRIFT_TOW_STARTED', { name: portName(now.port), gp: num(now.gp) }));
    });
  };

  // ---- the sea folk (fishing's rescues) ---------------------------------------------------------------------------------
  try {
    game.fishing.on('action', (ev) => {
      try {
        const a = cur();
        if (a === null) return;
        const id = ev?.rewardItem?.id;
        const qty = Number.isInteger(ev?.productQuantity) ? ev.productQuantity : 0;
        if (typeof id === 'string' && qty > 0) a.caught[id] = (a.caught[id] ?? 0) + qty;
        if (a.pending === '' && Math.random() < A.rescueChance(ev?.interval)) {
          a.pending = A.pickRescue(Math.random()).id;
          log(`a catch brought a rescue: ${a.pending}`);
        }
      } catch (e) { log('adrift catch failed', e); }
    });
  } catch (e) { log('fishing catches not heard; no rescues', e); }
  /** The rescue card's portrait. */
  const artOf = (r) => res(r.art ?? 'icon.webp');
  const hullArt = () => { const at = aboardAtSea(); return res(`hull_${at?.v?.hull ?? state.ship?.boat?.()?.hull ?? 'dinghy'}.webp`); };
  /** Tells a rescue: the message popup online, a Welcome Back line offline. */
  const tell = (r, vars, body, away) => {
    const key = `MOD_VOY_ADRIFT_RESCUE_${r.id.toUpperCase()}`;
    if (offlineNow()) { tellAway(icon() + esc(t(away ?? `${key}_OFFLINE`, vars))); return; }
    // Names bold, the time blue (message popup marks, build .259); the catch taken is a name too.
    const marks = {};
    for (const k of ['name', 'where', 'fish']) if (vars[k] !== undefined && vars[k] !== '') marks[k] = mark.name(vars[k]);
    if (vars.time !== undefined) marks.time = mark.time(vars.time);
    const lines = [marked(t, body ?? `${key}_BODY`, vars, marks)];
    const fire = () => swal({ title: t(`${key}_TITLE`), html: helpLayout.msgHtml(lines), imageUrl: artOf(r), ...RESCUE_ART, confirmButtonText: t('MOD_VOY_ADRIFT_RESCUE_OK') });
    if (state.whenNoModal) state.whenNoModal(fire); else fire();
  };
  /** The fishing line of the block: under a minute fished reads "not yet", not "1 min". */
  const fishKey = (fishing, ms) => (fishing
    ? (ms < 60000 ? 'MOD_VOY_ADRIFT_FISHING_NOW_NEW' : 'MOD_VOY_ADRIFT_FISHING_NOW')
    : (ms < 60000 ? 'MOD_VOY_ADRIFT_FISHING_NOT_YET' : 'MOD_VOY_ADRIFT_FISHING_NOT'));
  /** Plays a rescue rolled on a catch. */
  const play = (id) => {
    const r = A.rescueOf(id);
    const a = cur();
    if (r === undefined || a === null) return;
    log(`rescue: ${id}`);
    if (id === 'kraken') {
      const moved = driftOne(a, 'kraken');
      if (!moved) return;
      const left = leftHexes();
      if (left > 0) tell(r, { left: hexes(left) }); else tell(r, {}, 'MOD_VOY_ADRIFT_RESCUE_KRAKEN_ASHORE');
      return;
    }
    if (id === 'noodle') {
      const at = aboardAtSea();
      if (at === undefined) return;
      const near = [...state.terrain.all()].filter((c) => shipModel.isSea(c) && shipModel.hexDist(at.rec, c) <= A.NOODLE_RANGE);
      const spots = A.noodleSpots(at.rec, near, {
        home: (c) => homeOf(c, at.tier), dist: shipModel.hexDist, isPlace: shipModel.isPlace,
        surveyed: (c) => c.cloud !== true && hexAt(c.q, c.r)?.isFullySurveyed === true,
      });
      if (spots.length === 0) { play('kraken'); return; }
      const to = spots[Math.floor(Math.random() * spots.length)];
      const dest = hexAt(to.q, to.r);
      if (!freeMove(dest, at.hex)) return;
      tell(r, { where: placeWords(dest) });
      finish('ashore', 'noodle');
      return;
    }
    // The tows: the Friendly Fisherman and the Pushy Sailor to the nearest port you know (any port when you know none),
    // the bottle's ship home to a port within reach, known or not.
    const way = id === 'bottle' ? wayTo('bottle') : (wayTo('known') ?? wayTo('any'));
    if (way === undefined) { play('kraken'); return; }
    let fish = '';
    if (r.take) {
      const take = A.pushyTake(a.caught, (itemId) => { try { return game.bank.getQty(game.items.getObjectByID(itemId)); } catch { return 0; } });
      const parts = [];
      for (const [itemId, qty] of Object.entries(take)) {
        try {
          const item = game.items.getObjectByID(itemId);
          if (item === undefined) continue;
          game.bank.removeItemQuantity(item, qty, true);
          parts.push(`${num(qty)} ${item.name}`);
        } catch (e) { log('the sailor\'s share failed', e); }
      }
      fish = parts.join(', ');
    }
    if (!startTow(id, way)) return;
    const empty = r.take === true && fish === ''; // nothing of the catch left in the bank: he tows you all the same
    tell(r, { name: portName(way.port), hexes: hexes(way.hexes), time: duration(way.hexes * towMs(id)), fish },
      empty ? 'MOD_VOY_ADRIFT_RESCUE_PUSHY_EMPTY' : undefined, empty ? 'MOD_VOY_ADRIFT_RESCUE_PUSHY_EMPTY_OFFLINE' : undefined);
  };

  // ---- refusing what can't be done adrift ---------------------------------------------------------------------------
  /** The Adrift popup: why, then the three ways out. On travel refused, on the panel's button, and when it begins. */
  const explain = () => {
    const a = cur();
    if (a === null) return;
    const lines = [esc(t('MOD_VOY_ADRIFT_POPUP_WHY', { why: whyWords(a.why) }))];
    const left = leftHexes();
    lines.push(`<b>${esc(t('MOD_VOY_ADRIFT_WAY_DRIFT_HEAD'))}</b> ${marked(t, 'MOD_VOY_ADRIFT_WAY_DRIFT', { hexes: hexes(left) }, { time: mark.time(duration(Math.max(0, left - 1) * A.DRIFT_MS + a.left * C.TICK_MS)) })}`);
    const tow = paidTow();
    lines.push(`<b>${esc(t('MOD_VOY_ADRIFT_WAY_TOW_HEAD'))}</b> ${tow === undefined ? esc(t('MOD_VOY_ADRIFT_WAY_TOW_NONE')) : marked(t, 'MOD_VOY_ADRIFT_WAY_TOW', {}, { name: mark.name(portName(tow.port)), gp: gpMark(tow.gp) })}`);
    lines.push(`<b>${esc(t('MOD_VOY_ADRIFT_WAY_FISH_HEAD'))}</b> ${esc(t('MOD_VOY_ADRIFT_WAY_FISH'))}`);
    swal({
      title: t('MOD_VOY_ADRIFT_TITLE'),
      html: helpLayout.msgHtml(lines),
      imageUrl: hullArt(),
      ...helpLayout.MSG_IMAGE,
      showDenyButton: true,
      confirmButtonText: t('MOD_VOY_ADRIFT_DRIFT_ON'),
      denyButtonText: t('MOD_VOY_ADRIFT_GO_FISHING'),
    }).then((r) => { if (r.isDenied) goFishing(); });
  };
  const goFishing = () => { try { state.openPage(game.pages.getObjectByID(FISHING_ID)); } catch (e) { log('fishing page failed', e); } };
  /** Starting anything but Fishing while Adrift: refused, with why. */
  const refuseStart = (action) => {
    const what = action === game.combat ? t('MOD_VOY_CLOCK_ASK_COMBAT') : action?.name ?? t('MOD_VOY_CLOCK_ASK_THAT');
    swal({
      title: t('MOD_VOY_ADRIFT_ONLY_FISHING_TITLE'),
      html: helpLayout.msgHtml([esc(t('MOD_VOY_ADRIFT_ONLY_FISHING', { what }))]),
      imageUrl: hullArt(),
      ...helpLayout.MSG_IMAGE,
      showDenyButton: true,
      confirmButtonText: t('MOD_VOY_BUTTON_OK'),
      denyButtonText: t('MOD_VOY_ADRIFT_GO_FISHING'),
    }).then((r) => { if (r.isDenied) goFishing(); });
  };
  /** Under tow: nothing else starts and no other voyage sets off (no Stop here: you go where the tow goes). */
  const refuseUnderTow = () => {
    swal({
      title: t('MOD_VOY_ADRIFT_UNDER_TOW_TITLE'),
      html: helpLayout.msgHtml([marked(t, 'MOD_VOY_ADRIFT_UNDER_TOW_BODY', {}, { time: mark.time(duration(state.clock?.msLeft?.() ?? 0)) })]),
      imageUrl: hullArt(),
      ...helpLayout.MSG_IMAGE,
      confirmButtonText: t('MOD_VOY_BUTTON_OK'),
    });
  };
  // Installed after the clock's and the gate's, so it runs first. A skill the gate refuses here is left to the gate.
  ctx.patch(Game, 'idleChecker').replace(function (original, action) {
    try {
      const s = skill();
      if (this.isGolbinRaid || s === undefined || action === s) return original(action);
      if (cur() !== null && action !== game.fishing) {
        if (typeof action?.id === 'string' && state.skillLockedHere?.(action.id)) return original(action);
        if (!offlineNow()) refuseStart(action);
        return true;
      }
    } catch (e) { log('adrift start check failed', e); }
    return original(action);
  });
  // Travel while Adrift: refused with the popup (the map's Travel and the game's own moves; free moves pass).
  ctx.patch(Cartography, 'travelOnClick').replace(function (original) {
    try { if (cur() !== null && !this.game.isGolbinRaid) { explain(); return; } } catch (e) { log('adrift travel check failed', e); }
    return original();
  });
  ctx.patch(Cartography, 'movePlayer').replace(function (original, path, ignoreCosts, ...rest) {
    if (!ignoreCosts && !moving && cur() !== null && state.clock?.stepping?.() !== true) { log('adrift: a move refused'); if (!offlineNow()) explain(); return undefined; }
    return original(path, ignoreCosts, ...rest);
  });

  // ---- the page block, the panel and the chip ------------------------------------------------------------------------
  const changed = () => {
    const s = skill();
    if (s !== undefined) s.renderQueue.page = true;
    try { state.onSettingsChange(); } catch {}
  };
  /** What the page block shows changed when this does. */
  const sig = () => {
    const a = cur();
    if (a !== null) return `a|${a.why}|${a.drifted}|${map()?.playerPosition?.q},${map()?.playerPosition?.r}|${game.gp.amount >= (paidTow()?.gp ?? Infinity)}|${game.activeAction === game.fishing}`;
    const e = lastEnd();
    return e === null || e.closed ? '' : `e|${e.at}`;
  };
  const pct = (x) => `${Math.max(0, Math.min(100, Math.round(x * 1000) / 10))}%`;
  /** The Adrift block (amber; the Under way block's layout) or the last spell's note, or ''. */
  const blockHtml = () => {
    const a = cur();
    if (a === null) {
      const e = lastEnd();
      if (e === null || e.closed) return '';
      const by = e.by === '' ? '' : ` ${t(`MOD_VOY_ADRIFT_ENDED_BY_${e.by.toUpperCase()}`)}`;
      const text = e.how === 'ashore' ? t('MOD_VOY_ADRIFT_ENDED_ASHORE', { where: e.where, time: clockAt(e.at), hexes: hexes(e.drifted) }) : t('MOD_VOY_ADRIFT_ENDED_CLEAR', { time: clockAt(e.at) });
      return `<div class="voyage-clock-ended"><div class="voyage-clock-ended-text"><div>${esc(text + by)}</div></div>`
        + `<button type="button" class="btn btn-sm btn-outline-info" data-voyage-adrift-do="close">${esc(t('MOD_VOY_CLOCK_CLOSE'))}</button></div>`;
    }
    const at = aboardAtSea();
    const rec = at?.rec;
    const where = rec === undefined ? '' : getLangString(terrainMod.recKey(rec));
    const left = leftHexes();
    const fishing = game.activeAction === game.fishing;
    const tow = paidTow();
    const lines = [];
    if (where) lines.push(`<div class="voyage-clock-ground"><span class="voyage-swatch" style="background:${terrainMod.CLASS_INFO[rec.t]?.css ?? 'transparent'}"></span>${esc(where)}</div>`);
    lines.push(`<div class="text-warning"><i class="fa fa-fw fa-exclamation-triangle" aria-hidden="true"></i>${esc(whyWords(a.why))}</div>`);
    lines.push(`<div class="text-muted"><i class="fa fa-fw fa-route" aria-hidden="true"></i>${esc(t(a.drifted > 0 ? 'MOD_VOY_ADRIFT_LEFT_DRIFTED' : 'MOD_VOY_ADRIFT_LEFT', { hexes: hexes(left), drifted: hexes(a.drifted) }))}</div>`);
    lines.push(`<div class="${fishing ? 'text-info' : 'text-muted'}"><i class="fa fa-fw fa-fish" aria-hidden="true"></i>${esc(t(fishKey(fishing, a.fishMs), { time: duration(a.fishMs) }))}</div>`);
    // The times in the ways out stand out in blue, as the price does in amber (the user, 19 Oct 2026: "color
    // time too").
    const timeHtml = (ms) => `<b class="text-info">${esc(duration(ms))}</b>`;
    const towLine = tow === undefined
      ? `<div class="text-warning voyage-adrift-way"><i class="fa fa-fw fa-anchor" aria-hidden="true"></i>${esc(t('MOD_VOY_ADRIFT_WAY_TOW_NONE'))}</div>`
      // The price after the GP icon, amber as a cost and red when the coin on hand won't cover it (the
      // user, 19 Oct 2026: "add GP icon and color the price").
      : `<div class="voyage-adrift-way"><i class="fa fa-fw fa-anchor text-muted" aria-hidden="true"></i><span>${esc(t('MOD_VOY_ADRIFT_TOW_LINE', { name: portName(tow.port), hexes: hexes(tow.hexes), time: '\u0001', gp: '\u0000' }))
        .replace('\u0001', timeHtml(tow.ms)).replace('\u0000', `<img class="voyage-skill-name-icon" src="${esc(game.gp.media)}" alt=""><b class="${game.gp.amount < tow.gp ? 'text-danger' : 'text-warning'}">${num(tow.gp)}</b>`)}</span></div>`;
    const short = tow !== undefined && game.gp.amount < tow.gp;
    const payBtn = tow === undefined ? ''
      : short
        ? `<button type="button" class="btn btn-secondary" disabled title="${esc(t('MOD_VOY_ADRIFT_TOW_SHORT', { gp: num(tow.gp), have: num(game.gp.amount) }))}">${esc(t('MOD_VOY_ADRIFT_TOW_PAY_BTN'))}</button>`
        : `<button type="button" class="btn btn-success" data-voyage-adrift-do="tow">${esc(t('MOD_VOY_ADRIFT_TOW_PAY_BTN'))}</button>`; // the price is on the Tow line above (main buttons have one width)
    return `<div class="voyage-clock-top"><img class="voyage-clock-pic" src="${esc(hullArt())}" alt="">`
      + `<div><h5 class="font-w600 mb-0 text-warning"><i class="fa fa-water mr-1" aria-hidden="true"></i>${esc(t('MOD_VOY_ADRIFT_TITLE'))}</h5>`
      + `<div class="voyage-clock-facts">${lines.join('')}</div></div></div>`
      + '<div class="voyage-section voyage-clock-bars">'
      + `<div class="voyage-clock-bar-row"><span>${esc(t('MOD_VOY_ADRIFT_NEXT_HEX'))}</span><span class="text-muted" data-voyage-adrift="hex-time"></span></div>`
      + '<div class="progress voyage-clock-bar"><div class="progress-bar bg-warning" data-voyage-adrift="hex-bar"></div></div>'
      + `<div class="voyage-clock-bar-row"><span>${esc(t('MOD_VOY_ADRIFT_THE_DRIFT'))}</span><span data-voyage-adrift="left"></span></div>`
      + '<div class="progress voyage-clock-bar"><div class="progress-bar bg-success" data-voyage-adrift="bar"></div></div></div>'
      + `<div class="voyage-section"><div class="voyage-clock-head">${esc(t('MOD_VOY_ADRIFT_WAYS_HEAD'))}</div>`
      + `<div class="voyage-adrift-way"><i class="fa fa-fw fa-water text-muted" aria-hidden="true"></i><span>${esc(t('MOD_VOY_ADRIFT_DRIFT_LINE', { every: '\u0000' })).replace('\u0000', timeHtml(A.DRIFT_MS))}</span></div>`
      + towLine
      + `<div class="voyage-adrift-way"><i class="fa fa-fw fa-fish text-muted" aria-hidden="true"></i>${esc(t('MOD_VOY_ADRIFT_FISH_LINE'))}</div></div>`
      + '<div class="voyage-plan-buttons">'
      + `<button type="button" class="btn btn-outline-info" data-voyage-adrift-do="fish">${esc(t('MOD_VOY_ADRIFT_GO_FISHING'))}</button>${payBtn}</div>`
      + (short ? `<div class="text-muted voyage-clock-note text-right">${esc(t('MOD_VOY_ADRIFT_TOW_SHORT', { gp: num(tow.gp), have: num(game.gp.amount) }))}</div>` : '');
  };
  /** Moves the block's bars (every frame while the page is open). */
  const renderBars = (el) => {
    const a = cur();
    if (a === null || el == null) return;
    const set = (k, f) => { const x = el.querySelector(`[data-voyage-adrift="${k}"]`); if (x !== null) f(x); };
    const left = leftHexes();
    const ms = Math.max(0, left - 1) * A.DRIFT_MS + a.left * C.TICK_MS;
    set('hex-bar', (x) => { x.style.width = pct(1 - a.left / a.of); });
    set('hex-time', (x) => { const text = t('MOD_VOY_CLOCK_OF_TIME', { done: C.clockText((a.of - a.left) * C.TICK_MS), all: C.clockText(a.of * C.TICK_MS) }); if (x.textContent !== text) x.textContent = text; });
    set('bar', (x) => { x.style.width = pct(a.drifted / Math.max(1, a.drifted + left)); });
    set('left', (x) => { const text = t('MOD_VOY_ADRIFT_ASHORE_AT', { time: clockAt(Date.now() + ms), left: duration(ms) }); if (x.textContent !== text) x.textContent = text; });
  };
  document.addEventListener('click', (ev) => {
    const b = ev.target instanceof Element ? ev.target.closest('[data-voyage-adrift-do]') : null;
    if (b === null) return;
    const what = b.dataset.voyageAdriftDo;
    if (what === 'fish') goFishing();
    else if (what === 'tow') offerTow();
    else if (what === 'close') { const e = lastEnd(); if (e !== null) setEnd({ ...e, closed: true }); changed(); }
  });
  /** The Here panel's amber row and chip while Adrift: { text, tip } or undefined. */
  const chip = () => {
    const a = cur();
    if (a === null) return undefined;
    const left = leftHexes();
    const ms = Math.max(0, left - 1) * A.DRIFT_MS + a.left * C.TICK_MS;
    return { text: t('MOD_VOY_ADRIFT_TITLE'), row: t('MOD_VOY_ADRIFT_PANEL_ROW', { left: duration(ms) }), tip: t('MOD_VOY_ADRIFT_PANEL_TIP', { why: whyWords(a.why), left: duration(ms) }) };
  };

  // A setting turned off: the next check clears it (tick); the page and panel redraw now.
  state.listeners.push(() => { if (cur() !== null && !on()) finish('clear'); });

  const api = {
    /** Adrift may apply (settings): ship.mjs drops the sea's hunger floor for steps out of hexes more than one from the coast. */
    applies: on,
    isAdrift,
    /** Why you would be adrift where you stand, or undefined: the clock asks it when a voyage's step is refused. */
    cause: causeHere,
    begin, finish, explain, offerTow, onDocked, towMs, refuseUnderTow, tick, sig, blockHtml, renderBars, chip,
    /** The trader's sea crossing gives way to the drift (stores.mjs rescue). */
    here: () => cur() !== null || (on() && aboardAtSea() !== undefined && homeOf(aboardAtSea().rec, aboardAtSea().tier) > 1),
    /** For the dev console: play a rescue now. */
    play: (id) => { if (cur() !== null) play(id); },
    paidTow,
  };
  state.adrift = api;
  return api;
}
