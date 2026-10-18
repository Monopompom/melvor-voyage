// Cargo runs (phase 4): the harbour board at each port and the runs you carry. Ports post requests
// for game goods packed in a Sack or a Crate (Crafting); Load packs them from the bank into the hold of a vessel moored
// here, Deliver hands them over at the port that wants them for GP and Voyage XP. The rules are pure
// (cargo-model.mjs); this module reads the game (items found, dungeons cleared, the bank) and draws the board, the
// Errands block on the Voyage page and the Here panel's harbour line.
//
// The save: `record.cargo` (v13), `{ boards: { [poi]: { s: season, reqs } }, runs }`; packed cargo sits in the vessel
// holds as `{ id, qty: 50, cargo: run id, c: 'sack' | 'crate' }`, one entry a slot.

const SWAL_CLASS = { popup: 'voyage-ui voyage-board-popup', confirmButton: 'btn btn-success m-1', cancelButton: 'btn btn-outline-info m-1' };
const CONTAINER_ITEM = { sack: 'voyage:Sack', crate: 'voyage:Crate' };
const CONTAINER_ART = { sack: 'assets/sack.webp', crate: 'assets/crate.webp' };
/** Request table weights: the trades the game gives little reason to work count double (the user,
 * 18 Oct 2026: push players back to those skills); every other trade once, Astrology's dusts too. */
const HEAVY_SKILLS = ['melvorD:Smithing', 'melvorD:Crafting', 'melvorD:Farming', 'melvorD:Firemaking'];
// Build .204: the real ids (Charcoal comes with Throne of the Herald; without it the item is missing and skipped).
const FIREMAKING_GOODS = ['melvorTotH:Charcoal', 'melvorF:Ash'];
const DUSTS = ['melvorF:Stardust', 'melvorF:Golden_Stardust'];
/** Goods that go in sacks: crops and herbs (Farming), runes, ash and stardust. Everything else: crates. */
const SOFT_SKILLS = ['melvorD:Farming'];

export function install(ctx, { state, M, shipModel, hexes, dungeonIds, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const qty = (n) => numberWithCommas(n);
  const skill = () => state.voyageSkill?.();
  const usable = () => { const s = skill(); return s !== undefined && s.futureRaw === undefined; };

  // ---- the map: lanes, regions, port names ---------------------------------------------------------------------
  let lanes;
  let regionMap;
  const lanesNow = () => (lanes ??= M.laneDistances(hexes));
  const regionsNow = () => (regionMap ??= M.regions(hexes));
  const portRec = new Map(M.portsOf(hexes).map((p) => [p.poi, p]));
  const gameHex = (p) => { try { return game.cartography.activeMap?.getHex(new HexCoords(p.q, p.r)); } catch { return undefined; } };
  /** A port's name as the game has it ("Frost Drift Port"); the table key spaced out when the game has none. */
  const portName = (poi) => {
    const p = portRec.get(poi);
    const name = p === undefined ? undefined : gameHex(p)?.pointOfInterest?.name;
    return name ?? poi.replace(/([a-z])([A-Z])/g, '$1 $2');
  };
  /** The port you stand on or next to: its table record, or undefined. */
  const portHere = () => {
    const pos = state.position?.();
    if (pos === undefined || state.terrain === undefined) return undefined;
    const rec = state.recordAt(pos);
    if (rec === undefined) return undefined;
    if (shipModel.isPort(rec)) return rec;
    return state.terrain.neighbours(rec.q, rec.r).find((x) => shipModel.isPort(x));
  };

  // ---- dungeons ------------------------------------------------------------------------------------------------
  const dungeonOf = (name) => { try { return game.dungeons.getObjectByID(dungeonIds[name]); } catch { return undefined; } };
  const cleared = (name) => {
    const d = dungeonOf(name);
    try { return d === undefined ? 0 : game.combat.getDungeonCompleteCount(d); } catch { return 0; }
  };
  const isOpen = (poi) => M.portOpen(poi, regionsNow(), cleared);
  /** The port posts requests: a real port on a sea lane, with a dungeon near it cleared. */
  const posts = (poi) => !M.NO_CARGO.includes(poi) && Object.keys(lanesNow()[poi] ?? {}).length > 0 && isOpen(poi);
  /** A port found on the map. Requests go only to these (the user, 18 Oct 2026: "only one port - no trades"). */
  const knownPort = (poi) => { const p = portRec.get(poi); return p !== undefined && gameHex(p)?.pointOfInterest?.isDiscovered === true; };
  /** The lanes from every port, to the found ports only. */
  const lanesKnown = () => Object.fromEntries(Object.entries(lanesNow()).map(([from, to]) => [from, Object.fromEntries(Object.entries(to).filter(([poi]) => knownPort(poi)))]));
  /** The port can trade: some found port lies FLOOR hexes or more off by lane. */
  const hasPartner = (poi) => Object.entries(lanesNow()[poi] ?? {}).some(([o, d]) => d >= M.FLOOR && !M.NO_CARGO.includes(o) && knownPort(o));

  // The second port found writes the trade guide page (the user, 18 Oct 2026: "trigger to the second port"); a
  // character that knows two already learns it quietly on load.
  const portsFound = () => [...portRec.keys()].filter((poi) => !M.NO_CARGO.includes(poi) && knownPort(poi)).length;
  const checkPorts = (quiet) => { try { if (usable() && portsFound() >= 2) state.journal?.learn('ports', quiet); } catch (e) { log('ports guide failed', e); } };
  ctx.onCharacterLoaded(() => {
    checkPorts(true);
    try { game.cartography?.on('poiDiscovered', () => setTimeout(() => checkPorts(false), 0)); } catch (e) { log('ports hook failed', e); }
  });

  // ---- the save ------------------------------------------------------------------------------------------------
  let cleanedFor;
  /** The cargo record, checked once a character load. */
  const data = () => {
    if (!usable()) return undefined;
    const rec = skill().record;
    if (cleanedFor !== rec) { rec.cargo = M.cleanCargo(rec.cargo); cleanedFor = rec; }
    return rec.cargo;
  };
  const changed = () => {
    const s = skill();
    if (s !== undefined) s.renderQueue.page = true;
    state.onSettingsChange();
  };

  // ---- the request table -----------------------------------------------------------------------------------------
  const made = (item) => { try { return game.stats.itemFindCount(item) > 0 || game.bank.getQty(item) > 0; } catch { return true; } };
  /** A recipe you could work now: within your level, no abyssal level, a summoning tablet only once its mark is found. */
  const workable = (sk, a) => {
    if (a.abyssalLevel > 0 || (a.realm !== undefined && a.realm.id !== 'melvorD:Melvor')) return false;
    if (typeof a.level === 'number' && a.level > sk.level) return false;
    if (sk.id === 'melvorD:Summoning' && typeof sk.getMarkCount === 'function' && sk.getMarkCount(a) <= 0) return false;
    return true;
  };
  /** The goods a port may ask for: what you could make now in the skills you have unlocked,
   * [{ id, weight, lean, soft, price, g }] (`g`: the trade they come from; `weight`: the trade's, shared among its goods
   * by byTrade; `lean`: NEW_LEAN for goods you have never had, so the boards lean towards them). */
  const candidates = () => {
    const out = new Map();
    // `lv`: your level in the trade, for the request's size (cargo-model sizeShare).
    const levelIn = (id) => { try { return game.skills.getObjectByID(id)?.level ?? 1; } catch { return 1; } };
    const add = (item, weight, soft, g) => {
      if (item === undefined || item.namespace === 'voyage' || item.sellsFor?.currency !== game.gp) return;
      const had = out.get(item.id);
      if (had !== undefined && had.weight >= weight) return;
      out.set(item.id, { id: item.id, weight, lean: made(item) ? 1 : M.NEW_LEAN, soft: soft || item.type === 'Rune', price: item.sellsFor.quantity, g, lv: levelIn(g) });
    };
    const unlocked = (id) => { const sk = game.skills.getObjectByID(id); return sk !== undefined && sk.isUnlocked !== false; };
    for (const sk of game.skills.allObjects) {
      if (sk.namespace === 'voyage' || sk.actions === undefined || sk.isUnlocked === false) continue;
      const weight = HEAVY_SKILLS.includes(sk.id) ? 2 : 1;
      const soft = SOFT_SKILLS.includes(sk.id);
      try {
        sk.actions.forEach((a) => {
          if (!workable(sk, a)) return;
          if (a.product !== undefined) add(a.product, weight, soft, sk.id);
          // Herblore makes the highest tier its mastery has reached.
          if (Array.isArray(a.potions)) add(a.potions[typeof sk.getPotionTier === 'function' ? sk.getPotionTier(a) : 0], weight, soft, sk.id);
        });
      } catch (e) { log(`cargo goods of ${sk.id} failed`, e); }
    }
    if (unlocked('melvorD:Firemaking')) FIREMAKING_GOODS.forEach((id) => add(game.items.getObjectByID(id), 2, id === 'melvorF:Ash', 'melvorD:Firemaking'));
    if (unlocked('melvorD:Astrology')) DUSTS.forEach((id) => add(game.items.getObjectByID(id), 1, true, 'melvorD:Astrology'));
    return M.byTrade([...out.values()].sort((a, b) => (a.id < b.id ? -1 : 1)));
  };

  // ---- holds ---------------------------------------------------------------------------------------------------
  const vessel = (kind) => state.ship?.vessel?.(kind);
  const holdOf = (kind) => vessel(kind)?.hold ?? [];
  const slotsOf = (kind) => state.hold?.slots(kind) ?? 0;
  /** The vessels whose holds you reach now (on or next to them), the big ship first. */
  const reachable = () => (usable() ? state.hold?.kinds().filter((k) => state.hold.reachable(k)) ?? [] : []);
  const freeOf = (kind) => Math.max(0, slotsOf(kind) - holdOf(kind).length);
  /** Your holds' slots combined, for request sizes (the user, 18 Oct 2026: "x3 of ships' cargo slots (combined)"; it
   * was the biggest hold until build .205). Never under the dinghy's 6. */
  const maxSlots = () => Math.max(6, (state.hold?.kinds() ?? []).reduce((n, k) => n + slotsOf(k), 0));
  const setHold = (kind, next) => state.ship.setVessel(kind, { ...vessel(kind), hold: next });
  /** Sacks or crates of a run in every hold, and in the ones you reach. */
  const packedIn = (run, kinds) => kinds.reduce((n, k) => n + M.inHold(holdOf(k), run.id), 0);
  const allKinds = () => state.hold?.kinds() ?? [];

  // ---- boards --------------------------------------------------------------------------------------------------
  const seedOf = () => { try { return game.characterName ?? 'captain'; } catch { return 'captain'; } };
  /** The boards posted this season: { [poi]: reqs }. */
  const thisSeason = (c, s) => Object.fromEntries(Object.entries(c.boards).filter(([, b]) => b.s === s).map(([poi, b]) => [poi, b.reqs]));
  /**
   * A port's board this season. The first look of a season posts every open port's board together, in a fixed order,
   * so the season's glut (cargo-model weigh) is the same whichever harbour you visit first (build .205). A port that
   * opens later, or finds a port to trade with, posts on its own first look, after all the rest. A port with nothing
   * to post tries again next time.
   */
  const board = (poi) => {
    const c = data();
    if (c === undefined) return [];
    const s = M.seasonOf(Date.now());
    const b = c.boards[poi];
    if (b !== undefined && b.s === s) return b.reqs;
    if (!posts(poi)) return [];
    const ports = c.posted === s ? [poi] : [...portRec.keys()].filter(posts);
    const fresh = M.postSeason(ports, s, candidates(), lanesKnown(), maxSlots(), seedOf(), { boards: thisSeason(c, s), recent: M.recentGoods(c.sent, s) });
    for (const [p, reqs] of Object.entries(fresh)) c.boards[p] = { s, reqs };
    if (c.posted !== s || Object.keys(fresh).length > 0) { c.posted = s; changed(); }
    return c.boards[poi]?.s === s ? c.boards[poi].reqs : [];
  };
  const untilNext = () => {
    const ms = (M.seasonOf(Date.now()) + 1) * M.SEASON_MS - Date.now();
    const h = Math.max(1, Math.ceil(ms / 3600000));
    return h >= 24 ? t('MOD_VOY_CARGO_IN_DAYS', { d: `${Math.floor(h / 24)}`, h: `${h % 24}` }) : t('MOD_VOY_CARGO_IN_HOURS', { h: `${h}` });
  };

  /** A dungeon clear: a chance of one more request at a port near it. */
  const restock = (dungeon) => {
    const c = data();
    if (c === undefined || dungeon === undefined) return;
    const name = Object.keys(dungeonIds).find((n) => dungeonIds[n] === dungeon.id);
    if (name === undefined || Math.random() >= M.RESTOCK) return;
    const ports = M.portsNear(name, regionsNow()).filter((p) => !M.NO_CARGO.includes(p) && Object.keys(lanesNow()[p] ?? {}).length > 0);
    if (ports.length === 0) return;
    const poi = ports[Math.floor(Math.random() * ports.length)];
    const reqs = board(poi);
    const s = M.seasonOf(Date.now());
    // The board's own trades and the season's goods weigh less, as when the boards were posted.
    const goods = candidates();
    const season = Object.values(thisSeason(c, s)).flatMap((list) => list.map((q) => q.item));
    const cut = M.weigh(goods, { board: reqs.map((q) => M.groupOfItem(goods, q.item)), season, recent: M.recentGoods(c.sent, s) });
    const req = M.makeRequest(poi, cut, lanesKnown(), maxSlots(), M.rng(Math.floor(Math.random() * 2 ** 32)), `${poi}.${s}.r${Date.now() % 1e7}`);
    if (req === undefined) return;
    if (c.boards[poi]?.s === s) c.boards[poi].reqs.push(req); else c.boards[poi] = { s, reqs: [...reqs, req] };
    changed();
    try { game.notifications.createInfoNotification('voyage:cargo', t('MOD_VOY_CARGO_RESTOCK', { port: portName(poi) }), ctx.getResourceUrl(CONTAINER_ART[req.c])); } catch {}
    log(`cargo restock at ${poi} after ${name}`);
  };

  // ---- actions -------------------------------------------------------------------------------------------------
  const containerItem = (c) => game.items.getObjectByID(CONTAINER_ITEM[c]);
  const bankQty = (item) => (item === undefined ? 0 : game.bank.getQty(item));
  const notify = (text, kind = 'danger') => { try { notifyPlayer(skill(), text, kind); } catch {} };

  /** Why `run` (or a request about to become one) can't load more now, or undefined; `k` is how many would. */
  const loadInfo = (run, poi) => {
    const goods = game.items.getObjectByID(run.item);
    const box = containerItem(run.c);
    const kinds = reachable();
    const free = kinds.reduce((n, k) => n + freeOf(k), 0);
    const have = bankQty(goods);
    const empties = bankQty(box);
    const k = M.loadable(run, have, empties, free);
    let why;
    let whyHtml;
    if (run.from !== poi) why = t('MOD_VOY_CARGO_LOAD_AT', { port: portName(run.from) });
    else if (kinds.length === 0) why = t('MOD_VOY_CARGO_NO_VESSEL');
    else if (empties <= 0) why = t(run.c === 'sack' ? 'MOD_VOY_CARGO_NEED_SACKS' : 'MOD_VOY_CARGO_NEED_CRATES');
    else if (have < M.PER_CONTAINER) {
      // The row shows the goods' icon before their name and the count in red ("a count ... red when the bank
      // holds too few"); the button's tooltip keeps the plain words.
      const vars = { n: qty(M.PER_CONTAINER), what: containerWord(run.c, 1) };
      why = t('MOD_VOY_CARGO_NEED_GOODS', { ...vars, item: goods?.name ?? run.item, have: qty(have) });
      whyHtml = t('MOD_VOY_CARGO_NEED_GOODS', { ...vars, item: `${goods === undefined ? '' : icon(goods.media)}${esc(goods?.name ?? run.item)}`, have: `<span class="text-danger font-w600">${qty(have)}</span>` });
    } else if (free <= 0) why = t('MOD_VOY_CARGO_HOLD_FULL');
    // A load short of the rest: the hold's room, the empty containers or the goods stop it (in that order on a tie).
    const limit = why !== undefined || k >= run.n - run.packed ? undefined
      : k === free ? 'space' : k === empties ? 'empties' : 'goods';
    return { k: why === undefined ? k : 0, why, whyHtml: whyHtml ?? (why === undefined ? undefined : esc(why)), limit, goods, box, kinds };
  };

  /** Packs `k` containers of a run into the holds you reach (the big ship's first). */
  const pack = (run, info) => {
    let left = info.k;
    for (const kind of info.kinds) {
      const n = Math.min(left, freeOf(kind));
      if (n <= 0) continue;
      setHold(kind, M.load(holdOf(kind), run, n));
      left -= n;
    }
    const k = info.k - left;
    game.bank.removeItemQuantity(info.goods, k * M.PER_CONTAINER, false);
    game.bank.removeItemQuantity(info.box, k, false);
    run.packed += k;
    return k;
  };

  /** Takes a request off this port's board and loads what fits. */
  const take = (reqId) => {
    const c = data();
    const poi = portHere()?.poi;
    if (c === undefined || poi === undefined) return false;
    if (c.runs.length >= M.MAX_RUNS) { notify(t('MOD_VOY_CARGO_MAX_RUNS', { n: `${M.MAX_RUNS}` })); return false; }
    const reqs = board(poi);
    const req = reqs.find((q) => q.id === reqId);
    if (req === undefined) return false;
    const run = M.takeRun(req, poi);
    const info = loadInfo(run, poi);
    if (info.why !== undefined || info.k <= 0) { notify(info.why ?? t('MOD_VOY_CARGO_HOLD_FULL')); return false; }
    const k = pack(run, info);
    c.boards[poi].reqs = reqs.filter((q) => q.id !== reqId);
    c.runs.push(run);
    changed();
    notify(t('MOD_VOY_CARGO_LOADED', { n: `${k}`, what: containerWord(run.c, k), port: portName(run.to) }), 'success');
    log(`cargo ${run.id}: took, loaded ${k}`);
    return true;
  };
  /** Loads more of a run you hold (its later loads), at the port that posted it. */
  const loadMore = (runId) => {
    const c = data();
    const run = c?.runs.find((r) => r.id === runId);
    const poi = portHere()?.poi;
    if (run === undefined || poi === undefined) return false;
    const info = loadInfo(run, poi);
    if (info.why !== undefined || info.k <= 0) { notify(info.why ?? t('MOD_VOY_CARGO_HOLD_FULL')); return false; }
    const k = pack(run, info);
    changed();
    notify(t('MOD_VOY_CARGO_LOADED', { n: `${k}`, what: containerWord(run.c, k), port: portName(run.to) }), 'success');
    return true;
  };
  /** Hands over every sack or crate of a run in the holds you reach, at the port that wants it. */
  const deliver = (runId) => {
    const c = data();
    const run = c?.runs.find((r) => r.id === runId);
    if (run === undefined || portHere()?.poi !== run.to) return false;
    let k = 0;
    let gp = 0;
    let xp = 0;
    for (const kind of reachable()) {
      const d = M.deliver(holdOf(kind), run);
      if (d.k <= 0) continue;
      setHold(kind, d.hold);
      k += d.k; gp += d.gp; xp += d.xp;
    }
    if (k <= 0) return false;
    run.done += k;
    // The good steps back on the boards for a while (cargo-model RECENT).
    c.sent = M.noteSent(c.sent, run.item, M.seasonOf(Date.now()));
    game.gp.add(gp);
    try { skill().addXP(xp); } catch (e) { log('cargo XP failed', e); }
    if (M.finished(run)) c.runs = c.runs.filter((r) => r !== run);
    // Now and then the port's sea chart comes with the pay.
    try { state.charts?.rollDelivery?.(run.to); } catch (e) { log('delivery chart failed', e); }
    changed();
    notify(t(M.finished(run) ? 'MOD_VOY_CARGO_DELIVERED_DONE' : 'MOD_VOY_CARGO_DELIVERED', { n: `${k}`, what: containerWord(run.c, k), gp: qty(gp), xp: qty(xp) }), 'success');
    log(`cargo ${run.id}: delivered ${k} for ${gp} GP, ${xp} XP`);
    return true;
  };
  /** What dropping a run fetches, and why it can't be dropped here: { gp, k, why }. */
  const dropInfo = (run) => {
    const near = packedIn(run, reachable());
    const all = packedIn(run, allKinds());
    const why = all > near ? t('MOD_VOY_CARGO_DROP_AWAY') : undefined;
    return { k: near, gp: Math.round(near * run.gp * M.SALE_SHARE), why };
  };
  /** Gives a run up at a harbour board: its packed cargo sells for SALE_SHARE of the pay, the rest is forgotten. */
  const drop = (runId) => {
    const c = data();
    const run = c?.runs.find((r) => r.id === runId);
    if (run === undefined || portHere() === undefined) return false;
    const info = dropInfo(run);
    if (info.why !== undefined) { notify(info.why); return false; }
    let gp = 0;
    for (const kind of reachable()) {
      const s = M.sellOff(holdOf(kind), run);
      if (s.k > 0) { setHold(kind, s.hold); gp += s.gp; }
    }
    if (gp > 0) game.gp.add(gp);
    c.runs = c.runs.filter((r) => r !== run);
    changed();
    notify(t('MOD_VOY_CARGO_DROPPED', { gp: qty(gp) }), 'info');
    log(`cargo ${run.id}: dropped for ${gp} GP`);
    return true;
  };

  // ---- drawing -------------------------------------------------------------------------------------------------
  const WORDS = { sack: ['MOD_VOY_CARGO_SACK', 'MOD_VOY_CARGO_SACKS'], crate: ['MOD_VOY_CARGO_CRATE', 'MOD_VOY_CARGO_CRATES'] };
  const containerWord = (c, n) => t(WORDS[c][n === 1 ? 0 : 1]);
  const PART_LOAD = { space: 'MOD_VOY_CARGO_LOADS_SPACE', empties: 'MOD_VOY_CARGO_LOADS_EMPTIES', goods: 'MOD_VOY_CARGO_LOADS_GOODS' };
  /** A load short of the rest, and what stops the rest: "2 crates fit in the hold now. ...". */
  const partLoad = (info, c) => t(PART_LOAD[info.limit], { k: `${info.k}`, what: containerWord(c, info.k) });
  const art = (c, item, cls = 'voyage-cargo-art') => `<span class="${cls}"><img class="voyage-cargo-box" src="${ctx.getResourceUrl(CONTAINER_ART[c])}" alt="">` +
    (item !== undefined ? `<img class="voyage-cargo-goods" src="${item.media}" alt="">` : '') + '</span>';
  /** "Ash × 100, in 2 sacks". */
  const whatLine = (q, item) => `<b>${esc(item?.name ?? q.item)}</b> <span class="text-muted">× ${qty(q.n * M.PER_CONTAINER)}, ${esc(t('MOD_VOY_CARGO_IN', { n: `${q.n}`, what: containerWord(q.c, q.n) }))}</span>`;
  /** A request's pay, or what a run still pays (its sacks or crates not yet delivered). */
  /** A small icon before a name or a value in a line of text (icon, then name). */
  const icon = (src) => (src ? `<img class="voyage-skill-name-icon" src="${src}" alt="">` : '');
  /** A request's pay, or what a run still pays (its sacks or crates not yet delivered): each value after its icon, in
   * green as a reward (the user, 18 Oct 2026: "icons, coloring"). */
  const payBlock = (q) => {
    const left = q.n - (q.done ?? 0);
    return `<div class="voyage-cargo-pay"><div>${icon(game.gp.media)}<b class="text-success">${qty(left * q.gp)}</b> GP</div>` +
      `<div>${icon(skill()?.media)}<b class="text-success">${qty(left * q.xp)}</b> <span data-no-skill-names>${esc(t('MOD_VOY_CARGO_XP'))}</span></div>` +
      (q.n > 1 ? `<div class="text-muted">${esc(t('MOD_VOY_CARGO_PER', { what: containerWord(q.c, 1) }))}</div>` : '') + '</div>';
  };
  const button = (cls, label, attrs, why) => (why === undefined
    ? `<button type="button" class="btn ${cls}" ${attrs}>${esc(label)}</button>`
    : `<button type="button" class="btn btn-outline-secondary" disabled title="${esc(why)}">${esc(label)}</button>`);
  const row = (artHtml, mid, pay, act, cls = '') => `<div class="voyage-cargo-row ${cls}">${artHtml}<div class="voyage-cargo-mid">${mid}</div>${pay}<div class="voyage-cargo-act">${act}</div></div>`;

  /** Pending "drop?" confirmation: the run id whose Drop was pressed once. */
  let dropAsk;
  const runRow = (run, poi) => {
    const item = game.items.getObjectByID(run.item);
    const aboard = packedIn(run, allKinds());
    const near = packedIn(run, reachable());
    const lines = [`<div>${whatLine(run, item)}</div>`];
    const acts = [];
    let cls = '';
    if (run.to === poi && near > 0) {
      cls = 'voyage-cargo-here';
      lines.push(`<div>${esc(t('MOD_VOY_CARGO_FOR_HERE', { port: portName(run.from) }))}</div>`);
      acts.push(button('btn-success', t('MOD_VOY_CARGO_DELIVER'), `data-cargo="deliver" data-run="${esc(run.id)}"`));
    } else {
      lines.push(`<div>${t('MOD_VOY_CARGO_TO', { port: `<b>${esc(portName(run.to))}</b>`, hexes: `${run.hexes}` })}</div>`);
      if (run.to === poi && aboard > 0) lines.push(`<div class="text-warning">${esc(t('MOD_VOY_CARGO_BRING_HOLD'))}</div>`);
      if (run.packed < run.n && run.from === poi) {
        const info = loadInfo(run, poi);
        if (info.limit !== undefined) lines.push(`<div class="text-info">${esc(partLoad(info, run.c))}</div>`);
        if (info.why !== undefined) lines.push(`<div class="text-warning">${info.whyHtml}</div>`);
        acts.push(button('btn-success', info.k > 0 ? t('MOD_VOY_CARGO_LOAD_N', { k: `${info.k}` }) : t('MOD_VOY_CARGO_LOAD'), `data-cargo="more" data-run="${esc(run.id)}"`, info.k > 0 ? undefined : info.why));
      }
    }
    lines.push(`<div class="text-muted">${esc(progress(run, aboard, run.from === poi))}</div>`);
    const d = dropInfo(run);
    if (dropAsk === run.id) {
      lines.push(`<div class="text-warning">${esc(d.why ?? t(d.k > 0 ? 'MOD_VOY_CARGO_DROP_SURE_SELL' : 'MOD_VOY_CARGO_DROP_SURE', { k: `${d.k}`, what: containerWord(run.c, d.k), gp: qty(d.gp) }))}</div>`);
      // A pair: Keep it first, Drop it last (build .209).
      acts.push(button('btn-outline-info', t('MOD_VOY_CARGO_DROP_NO'), 'data-cargo="drop-no"'));
      if (d.why === undefined) acts.push(button('btn-danger', t('MOD_VOY_CARGO_DROP_YES'), `data-cargo="drop-yes" data-run="${esc(run.id)}"`));
    } else {
      acts.push(button('btn-outline-danger btn-sm', t('MOD_VOY_CARGO_DROP'), `data-cargo="drop" data-run="${esc(run.id)}"`));
    }
    return row(art(run.c, item), lines.join(''), payBlock(run), acts.join(''), cls);
  };
  /** "2 of 10 delivered · 4 in the hold"; `atFrom`: you stand where the next load is, so that goes unsaid. */
  const progress = (run, aboard, atFrom = false) => {
    const parts = [];
    if (run.n > 1 || run.done > 0) parts.push(t('MOD_VOY_CARGO_DONE_OF', { done: `${run.done}`, n: `${run.n}` }));
    parts.push(aboard > 0 ? t('MOD_VOY_CARGO_ABOARD', { k: `${aboard}`, what: containerWord(run.c, aboard) }) : run.packed < run.n && !atFrom ? t('MOD_VOY_CARGO_TO_LOAD', { port: portName(run.from) }) : '');
    return parts.filter(Boolean).join(' · ');
  };
  const requestRow = (req, poi, full) => {
    const item = game.items.getObjectByID(req.item);
    const run = M.takeRun(req, poi);
    const info = loadInfo(run, poi);
    const why = full ? t('MOD_VOY_CARGO_MAX_RUNS', { n: `${M.MAX_RUNS}` }) : info.why;
    const lines = [`<div>${whatLine(req, item)}</div>`, `<div>${t('MOD_VOY_CARGO_TO', { port: `<b>${esc(portName(req.to))}</b>`, hexes: `${req.hexes}` })}</div>`];
    if (why === undefined && info.limit !== undefined) lines.push(`<div class="text-info">${esc(partLoad(info, req.c))}</div>`);
    if (why !== undefined) lines.push(`<div class="text-warning">${full ? esc(why) : info.whyHtml}</div>`);
    const label = why === undefined && info.k < req.n ? t('MOD_VOY_CARGO_LOAD_N', { k: `${info.k}` }) : t('MOD_VOY_CARGO_LOAD');
    return row(art(req.c, item), lines.join(''), payBlock(req), button('btn-success', label, `data-cargo="take" data-req="${esc(req.id)}"`, why));
  };

  /** The board's Cargo page for the port `poi`. */
  const boardHtml = (poi) => {
    const c = data();
    if (c === undefined) return `<div class="text-warning">${esc(t('MOD_VOY_PAGE_NO_SHIP'))}</div>`;
    const kinds = reachable();
    const free = kinds.reduce((n, k) => n + freeOf(k), 0);
    const slots = kinds.reduce((n, k) => n + slotsOf(k), 0);
    const holdText = kinds.length === 0 ? `<span class="text-warning">${esc(t('MOD_VOY_CARGO_NO_VESSEL'))}</span>`
      : `<span><b>${esc(t('MOD_VOY_CARGO_HOLD_LABEL', { hull: kinds.map((k) => state.hold.hullName(k)).join(' + ') }))}</b> ${esc(t('MOD_VOY_CARGO_FREE', { free: `${free}`, slots: `${slots}` }))}</span>`;
    const empties = `<span>${esc(t('MOD_VOY_CARGO_EMPTIES'))} <img class="voyage-cargo-mini" src="${ctx.getResourceUrl(CONTAINER_ART.sack)}" alt="${esc(t('MOD_VOY_CARGO_EMPTY_SACKS'))}" title="${esc(t('MOD_VOY_CARGO_EMPTY_SACKS'))}"><b>${qty(bankQty(containerItem('sack')))}</b>` +
      ` <img class="voyage-cargo-mini" src="${ctx.getResourceUrl(CONTAINER_ART.crate)}" alt="${esc(t('MOD_VOY_CARGO_EMPTY_CRATES'))}" title="${esc(t('MOD_VOY_CARGO_EMPTY_CRATES'))}"><b>${qty(bankQty(containerItem('crate')))}</b></span>`;
    const open = posts(poi);
    let html = `<div class="voyage-cargo-bar">${holdText}${empties}${open ? `<span class="text-muted">${esc(t('MOD_VOY_CARGO_NEXT', { when: untilNext() }))}</span>` : ''}</div>`;
    if (c.runs.length > 0) html += `<div class="voyage-cargo-head">${esc(t('MOD_VOY_CARGO_YOUR_RUNS', { n: `${c.runs.length}`, max: `${M.MAX_RUNS}` }))}</div>` + c.runs.map((r) => runRow(r, poi)).join('');
    html += `<div class="voyage-cargo-head">${esc(t('MOD_VOY_CARGO_WANTED'))}</div>`;
    if (M.NO_CARGO.includes(poi)) html += `<div class="voyage-cargo-empty">${esc(t('MOD_VOY_CARGO_FAKE'))}</div>`;
    else if (Object.keys(lanesNow()[poi] ?? {}).length === 0) html += `<div class="voyage-cargo-empty">${esc(t('MOD_VOY_CARGO_NO_LANE'))}</div>`;
    else if (!open) {
      const near = (regionsNow()[poi] ?? []).map((n) => dungeonOf(n)?.name).filter(Boolean);
      html += `<div class="voyage-cargo-empty">${esc(near.length > 0 ? t('MOD_VOY_CARGO_CLOSED', { dungeons: near.join(', ') }) : t('MOD_VOY_CARGO_CLOSED_NONE'))}</div>`;
    } else if (!hasPartner(poi) && board(poi).length === 0) html += `<div class="voyage-cargo-empty">${esc(t('MOD_VOY_CARGO_NO_PARTNER'))}</div>`;
    else {
      const reqs = board(poi);
      html += reqs.length === 0 ? `<div class="voyage-cargo-empty">${esc(t('MOD_VOY_CARGO_NONE_LEFT', { when: untilNext() }))}</div>`
        : reqs.map((q) => requestRow(q, poi, c.runs.length >= M.MAX_RUNS)).join('');
    }
    return `${html}<div class="voyage-cargo-foot text-muted">${esc(t('MOD_VOY_CARGO_FOOT'))}</div>`;
  };

  let openPoi;
  // The board's tabs (phase 4): Cargo, Notices (Voyage tasks, src/tasks.mjs), Sea charts (src/charts.mjs). The row
  // shows once a second tab exists; the tab picked stays while the board is open.
  const TABS = [
    { id: 'cargo', key: 'MOD_VOY_BOARD_TAB_CARGO', html: (poi) => boardHtml(poi) },
    { id: 'notices', key: 'MOD_VOY_BOARD_TAB_NOTICES', html: (poi) => state.tasks?.html(poi), on: () => state.tasks !== undefined },
    { id: 'charts', key: 'MOD_VOY_BOARD_TAB_CHARTS', html: (poi) => state.charts?.html(poi), on: () => state.charts !== undefined },
  ];
  let tab = 'cargo';
  const bodyHtml = (poi) => {
    const tabs = TABS.filter((x) => x.on === undefined || x.on());
    if (!tabs.some((x) => x.id === tab)) tab = 'cargo';
    const row = tabs.length < 2 ? '' : `<div class="voyage-board-tabs" role="tablist">${tabs.map((x) =>
      `<button type="button" role="tab" aria-selected="${x.id === tab}" class="btn btn-sm ${x.id === tab ? 'btn-info' : 'btn-outline-info'}" data-board-tab="${x.id}">${esc(t(x.key))}</button>`).join('')}</div>`;
    let inner;
    try { inner = tabs.find((x) => x.id === tab).html(poi) ?? ''; } catch (e) { log(`board tab ${tab} failed`, e); inner = ''; }
    return row + inner;
  };
  const redraw = () => {
    if (openPoi === undefined) return;
    const box = document.querySelector('.voyage-board-popup .voyage-cargo');
    if (box === null) { openPoi = undefined; return; }
    box.innerHTML = bodyHtml(openPoi);
    try { state.popupDidRender?.(box.closest('.swal2-popup')); } catch {}
    try { state.tips?.apply(box); } catch {}
  };
  const onBoardClick = (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-board-tab], [data-task], [data-chart]') : null;
    if (el !== null && !el.disabled) {
      if (el.dataset.boardTab !== undefined) { tab = el.dataset.boardTab; dropAsk = undefined; state.tasks?.resetAsk?.(); }
      else if (el.dataset.task !== undefined) state.tasks?.onClick(el, openPoi);
      else state.charts?.onClick(el, openPoi);
      redraw();
      return;
    }
    const b = e.target instanceof Element ? e.target.closest('[data-cargo]') : null;
    if (b === null || b.disabled) return;
    const what = b.dataset.cargo;
    const id = b.dataset.run;
    if (what === 'take') take(b.dataset.req);
    else if (what === 'more') loadMore(id);
    else if (what === 'deliver') deliver(id);
    else if (what === 'drop') dropAsk = id;
    else if (what === 'drop-no') dropAsk = undefined;
    else if (what === 'drop-yes') { dropAsk = undefined; drop(id); }
    redraw();
  };
  /** Opens the harbour board of the port you stand at. */
  const open = (startTab = 'cargo') => {
    const port = portHere();
    if (port === undefined || data() === undefined) return false;
    openPoi = port.poi;
    dropAsk = undefined;
    tab = typeof startTab === 'string' ? startTab : 'cargo';
    try { state.tasks?.resetAsk?.(); } catch {}
    // The guide page the first time a board is opened (journal.learn is quiet when it is known already).
    try { state.journal?.learn('cargo'); } catch {}
    try {
      SwalLocale.fire({
        didRender: state.popupDidRender,
        title: esc(portName(port.poi)),
        html: `<div class="voyage-cargo-sub text-muted">${esc(t('MOD_VOY_CARGO_BOARD'))}</div><div class="voyage-cargo text-left">${bodyHtml(port.poi)}</div>`,
        width: '48em',
        showConfirmButton: false,
        showCloseButton: true,
        customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass(SWAL_CLASS) : SWAL_CLASS,
        didOpen: (popup) => {
          popup.querySelector('.voyage-cargo')?.addEventListener('click', onBoardClick);
          try { state.tips?.apply(popup); } catch {}
        },
        willClose: () => { openPoi = undefined; },
      });
    } catch (e) { log('harbour board failed', e); return false; }
    return true;
  };

  // ---- the Errands block on the Voyage page (phase 4 canvas) ---------------------------------------------------
  const planTo = (poi) => {
    const p = portRec.get(poi);
    if (p === undefined) return;
    const target = { name: portName(poi), media: ctx.getResourceUrl(CONTAINER_ART.crate), hexes: [{ q: p.q, r: p.r }] };
    if (state.planner?.planTo?.(target)) return;
    const hex = gameHex(p);
    try { state.openPage(game.pages.getObjectByID('melvorAoD:Cartography')); } catch {}
    if (hex !== undefined) setTimeout(() => { try { state.ship.centreOn(hex); } catch (e) { log('map centre failed', e); } }, 100);
  };
  const errandsHtml = () => {
    const c = data();
    if (c === undefined) return '';
    const here = portHere()?.poi;
    const planLabel = state.planner?.open?.() ? t('MOD_VOY_CARGO_PLAN') : t('MOD_VOY_CARGO_SHOW');
    const rows = c.runs.map((run) => {
      const item = game.items.getObjectByID(run.item);
      const aboard = packedIn(run, allKinds());
      const toLoad = aboard === 0 && run.packed < run.n;
      const goTo = toLoad ? run.from : run.to;
      let line;
      let act;
      if (here === goTo) {
        line = `<div class="text-success">${esc(t(toLoad ? 'MOD_VOY_CARGO_HERE_LOAD' : 'MOD_VOY_CARGO_HERE_DELIVER'))}</div>`;
        act = `<button type="button" class="btn btn-sm btn-outline-info" data-cargo-page="board">${esc(t('MOD_VOY_CARGO_BOARD'))}</button>`;
      } else {
        line = `<div>${toLoad ? esc(t('MOD_VOY_CARGO_TO_LOAD', { port: portName(run.from) }))
          : `${t('MOD_VOY_CARGO_HEXES', { hexes: `${run.hexes}` })} · ${t('MOD_VOY_CARGO_PAYS', { gp: qty(aboard * run.gp), xp: qty(aboard * run.xp) })}`}</div>`;
        act = `<button type="button" class="btn btn-sm btn-outline-info" data-cargo-page="plan" data-poi="${esc(goTo)}">${esc(planLabel)}</button>`;
      }
      const prog = progress(run, aboard, toLoad);
      return `<div class="voyage-errand">${art(run.c, item, 'voyage-cargo-art voyage-cargo-art-sm')}<div class="voyage-cargo-mid">` +
        `<div>${t('MOD_VOY_CARGO_ERRAND', { item: `<b>${esc(item?.name ?? run.item)}</b>`, n: qty(run.n * M.PER_CONTAINER), k: `${run.n}`, what: containerWord(run.c, run.n), port: `<b>${esc(portName(run.to))}</b>` })}</div>` +
        `${line}<div class="text-muted">${esc(prog)}</div></div>${act}</div>`;
    });
    const task = state.tasks?.errandHtml?.() ?? '';
    if (task !== '') rows.unshift(task);
    if (rows.length === 0) rows.push(`<div class="text-muted">${esc(t('MOD_VOY_CARGO_NO_RUNS'))}</div>`);
    return rows.join('') + `<div class="voyage-cargo-foot text-muted">${esc(t('MOD_VOY_CARGO_ERRANDS_FOOT'))}</div>`;
  };
  const onPageClick = (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-cargo-page]') : null;
    if (b === null) return;
    if (b.dataset.cargoPage === 'board') open();
    else planTo(b.dataset.poi);
  };

  /** The Here panel's harbour line: at a port, its board's button and what waits here. */
  const panelLine = () => {
    const port = portHere();
    if (port === undefined || data() === undefined) return '';
    const c = data();
    const due = c.runs.filter((r) => r.to === port.poi && packedIn(r, allKinds()) > 0).length;
    const note = due > 0 ? `<span class="text-success">${esc(t('MOD_VOY_CARGO_PANEL_DUE', { n: `${due}` }))}</span>`
      : `<span class="text-muted">${esc(c.runs.length > 1 ? t('MOD_VOY_CARGO_PANEL_RUNS', { n: `${c.runs.length}` })
        : t(c.runs.length === 1 ? 'MOD_VOY_CARGO_PANEL_RUN' : !posts(port.poi) ? 'MOD_VOY_CARGO_PANEL_SHUT' : hasPartner(port.poi) || (c.boards[port.poi]?.reqs.length ?? 0) > 0 ? 'MOD_VOY_CARGO_PANEL_IDLE' : 'MOD_VOY_CARGO_PANEL_ALONE'))}</span>`;
    return `<div class="voyage-here-place voyage-harbour-line"><span><span class="voyage-here-label">${esc(t('MOD_VOY_CARGO_PANEL_LABEL'))}</span> ${note}</span>` +
      `<button type="button" class="btn btn-sm btn-outline-info voyage-harbour-link">${esc(t('MOD_VOY_CARGO_BOARD'))}</button></div>`;
  };
  /** Packed cargo in a hold entry, for the Hold block's sealed tiles: { run, port } or undefined. */
  const sealOf = (entry) => {
    if (!M.isCargo(entry)) return undefined;
    const run = data()?.runs.find((r) => r.id === entry.cargo);
    return { c: entry.c, port: run === undefined ? undefined : portName(run.to) };
  };

  ctx.onCharacterLoaded(() => {
    cleanedFor = undefined;
    try { game.combat.on('dungeonCompleted', (e) => { try { restock(e?.dungeon ?? e); } catch (err) { log('cargo restock failed', err); } }); } catch (e) { log('dungeon hook failed', e); }
  });

  /** For voyageDev.boardShares: `seasons` seasons of all open boards from today's goods, unsaved; each good's share. */
  const shares = (seasons) => {
    const goods = candidates();
    const open = [...portRec.keys()].filter(posts);
    const s0 = M.seasonOf(Date.now()) + 1000;
    const count = {};
    let all = 0;
    for (let s = s0; s < s0 + seasons; s++) {
      // Goods delivered lately count as they would today.
      const recent = M.recentGoods(data()?.sent, M.seasonOf(Date.now()));
      for (const reqs of Object.values(M.postSeason(open, s, goods, lanesKnown(), maxSlots(), seedOf(), { recent }))) for (const q of reqs) { count[q.item] = (count[q.item] ?? 0) + 1; all++; }
    }
    const rows = Object.entries(count).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ item: game.items.getObjectByID(id)?.name ?? id, n, share: `${Math.round((1000 * n) / all) / 10}%` }));
    try { console.table(rows); } catch {}
    return { ports: open.length, requests: all, goods: goods.length, top: rows.slice(0, 8) };
  };

  const api = { max: M.MAX_RUNS, shares, open, portHere, portName, untilNext, panelLine, errandsHtml, onPageClick, sealOf, art, has: () => (data()?.runs.length ?? 0) > 0 || state.tasks?.has?.() === true, count: () => data()?.runs.length ?? 0, redraw };
  state.cargo = api;
  return api;
}
