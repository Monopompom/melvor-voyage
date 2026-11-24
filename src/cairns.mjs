// Cairns (round 5), game side: a Folk that dies on the road leaves everything it had (its load or room, its purse, its
// gear) on the hex where it fell, kept in Voyage's save until you collect it. Worker Folks hands the goods over through
// its death keeper (API v13): asked only for a Folk walking (a courier, a Folk walking alone). A band's kill leaves the
// band guarding its cairn. The rules are in cairn-model.mjs. Without API v13 nothing is kept here and Worker Folks'
// own rule stands (the gear to the bank, the rest lost).
//
// Collecting (build .711): standing on a cairn's hex or next to it, its row in the Here panel has Collect. The bank takes
// what it has room for (the rest stays in the cairn), the purse goes whole to yours. A guarded cairn's Collect opens its
// band's fight at the ground and tier where the Folk fell: a win, their flight or a toll paid hands it over; Run, a
// draw or a loss leaves it guarded (a loss costs what any lost fight does).

const DEATH_KEEPER_API = 13;
/** How far from a cairn you can collect it: its hex or the next one. */
export const CAIRN_REACH = 1;
/** Why Collect waits, by `collectWhy`. */
export const CAIRN_WHY = { moving: 'MOD_VOY_CAIRN_WHY_MOVING', band: 'MOD_VOY_CAIRN_WHY_BAND' };

export function install(ctx, { state, C, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const now = () => state.gameNow?.() ?? state.clockNow?.() ?? Date.now();
  const record = () => { const s = state.voyageSkill?.(); return s !== undefined && s.futureRaw === undefined ? s.record : undefined; };
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hexDist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
  const count = (n) => { try { return numberWithCommas(n); } catch { return `${n}`; } };
  const hexText = (h) => { try { const o = new HexCoords(h.q, h.r).to_oddq(); return `(${o.col}, ${o.row})`; } catch { return `(${h.q}, ${h.r})`; } };

  /** The save's cairns, cleaned once per list read from the save. */
  let cleaned;
  const list = () => {
    const r = record();
    if (r === undefined) return undefined;
    if (r.cairns !== cleaned) { r.cairns = C.cleanCairns(r.cairns); cleaned = r.cairns; }
    return r.cairns;
  };
  const setList = (next) => { const r = record(); if (r !== undefined) { r.cairns = next; cleaned = next; } };

  /** One stack into the bank: how many it took (all or none; `shown` the game's own item notice). */
  const bankTake = (id, qty, shown) => {
    const item = game.items.getObjectByID(id);
    try { return item !== undefined && game.bank.addItem(item, qty, false, true, false, shown, 'Voyage') === true ? qty : 0; } catch (e) { log(`cairn: ${id} not banked`, e); return 0; }
  };
  const payPurse = (purse) => {
    for (const p of purse) {
      try { (p.id === 'melvorD:GP' ? game.gp : game.currencies.getObjectByID(p.id))?.add(p.amount); } catch (e) { log(`cairn: ${p.id} not paid`, e); }
    }
  };
  const notice = (key, vars) => {
    try { game.notifications.createInfoNotification('voyage:cairn', t(key, vars), state.voyageSkill?.()?.media); } catch {}
  };
  const changed = () => {
    try { state.markers?.refresh?.(); } catch {}
    try { state.herePanel?.render?.(); } catch {}
  };

  /** A cairn pushed out past CAIRNS_MAX: its goods to the bank as far as it has room, its purse to yours. */
  const toBank = (cairn) => {
    let lost = 0;
    for (const x of cairn.items) if (bankTake(x.id, x.qty, false) === 0) lost += 1;
    payPurse(cairn.purse);
    log(`cairn ${cairn.id} (${cairn.name}) went to the bank, the oldest past ${C.CAIRNS_MAX}${lost > 0 ? `; ${lost} stacks had no room` : ''}`);
    notice(lost > 0 ? 'MOD_VOY_CAIRN_BANKED_LOST' : 'MOD_VOY_CAIRN_BANKED', { name: cairn.name, n: `${C.CAIRNS_MAX}` });
  };

  /**
   * Worker Folks' death keeper: a walking Folk died with `gear`, `room` and `purse`. True when a cairn holds it all on
   * the hex it fell on: a courier on a packet on the sea hex the packet had reached (Worker Folks still has it at the
   * port it boarded at; the user, 24 Nov 2026: "why not at the sea hex itself?"), so its pirates are met at sea. A
   * band's kill: that band guards it.
   */
  const keep = (view, { gear, room, purse, cause }) => {
    if (state.folksGuarded !== true || list() === undefined) return false;
    let sea;
    try { sea = state.couriers?.seaHexOf?.(view?.id); } catch {}
    const hex = sea ?? view?.place;
    if (hex == null || !Number.isInteger(hex.q) || !Number.isInteger(hex.r)) return false;
    const guard = cause === 'band' ? state.encounters?.killer?.() : undefined;
    const cairn = C.makeCairn({ folkId: view.id, name: view.name, hex, at: now(), cause: cause ?? 'other', guard, gear, room, purse });
    // Nothing to keep: Worker Folks' plain death line.
    if (cairn === undefined) return false;
    const { cairns, dropped } = C.addCairn(list(), cairn);
    setList(cairns);
    log(`cairn: ${view.name} left ${cairn.items.length} stacks and ${cairn.purse.length} purses at (${hex.q},${hex.r})${cairn.guard ? `, guarded by ${cairn.guard.band}` : ''}`);
    for (const d of dropped) toBank(d);
    changed();
    return true;
  };
  /** The frozen slot's and the death notice's line: where its cairn stands, and who guards it ('' once collected). */
  const textFor = (folkId) => {
    const c = C.cairnOf(list() ?? [], folkId);
    if (c === undefined) return '';
    const at = hexText(c);
    return c.guard === undefined ? t('MOD_VOY_CAIRN_LEFT', { hex: at })
      : t('MOD_VOY_CAIRN_LEFT_GUARDED', { hex: at, band: state.encounters?.bandName?.(c.guard.band) ?? c.guard.band });
  };

  // ---- collecting (build .711) ---------------------------------------------------------------------------------------
  const find = (id) => (list() ?? []).find((c) => c.id === id);
  /** The cairns you can collect from where you stand (your hex and the next ones), nearest first. */
  const near = () => {
    const pos = state.position?.();
    if (pos == null || state.active?.() === false) return [];
    return C.cairnsNear(list() ?? [], pos, CAIRN_REACH, hexDist);
  };
  /** Why Collect waits ('' when it can go): under way, a band waiting for an answer, Voyage's rules off (no row then). */
  const collectWhy = () => {
    if (state.active?.() === false) return 'off';
    if (state.encounters?.fightOpen?.() === true) return 'band';
    if (state.clock?.running?.() === true) return 'moving';
    return '';
  };
  /** Takes what the bank has room for and the whole purse; what is left stays in the cairn, unguarded. */
  const collectNow = (c) => {
    const r = C.collect(c, (id, qty) => bankTake(id, qty, true));
    payPurse(r.purse);
    const left = r.left === undefined ? undefined : (({ guard, ...rest }) => rest)(r.left);
    setList(C.replaceCairn(list() ?? [], c.id, left));
    log(`cairn ${c.id} (${c.name}) collected: ${r.taken.length} stacks, ${r.purse.length} purses${left ? `; ${left.items.length} stacks left for want of bank room` : ''}`);
    notice(left === undefined ? 'MOD_VOY_CAIRN_COLLECTED' : 'MOD_VOY_CAIRN_COLLECTED_PART', { name: c.name });
    changed();
    return r;
  };
  /** Collect: a guarded cairn opens its band's fight, an unguarded one is taken now. */
  const collect = (id) => {
    const c = find(id);
    if (c === undefined || collectWhy() !== '' || !near().some((x) => x.id === id)) return false;
    if (c.guard !== undefined) return state.encounters?.guardFight?.(c) === true;
    collectNow(c);
    return true;
  };
  /** The guard's fight is over (encounters.mjs close): beaten, the cairn is yours; else it stays guarded. */
  const guardDone = (id, beaten) => {
    const c = find(id);
    if (c === undefined) return;
    if (!beaten) { log(`cairn ${id}: still guarded by ${c.guard?.band}`); changed(); return; }
    const { guard, ...free } = c;
    setList(C.replaceCairn(list() ?? [], id, free));
    collectNow(free);
  };

  /** For voyageDev.cairn: a cairn added as the death keeper would (the cap and the bank as for a real one). */
  const put = (c) => {
    if (c === undefined || list() === undefined) return false;
    const { cairns, dropped } = C.addCairn(list(), c);
    setList(cairns);
    for (const d of dropped) toBank(d);
    changed();
    return true;
  };

  /** What a cairn holds, for its row's tooltip: up to ten stacks by name, then how many more, and the purse. */
  const TIP_ITEMS = 10;
  const holds = (c) => {
    const name = (id) => { try { return game.items.getObjectByID(id)?.name ?? id; } catch { return id; } };
    const cur = (id) => { try { return (id === 'melvorD:GP' ? game.gp : game.currencies.getObjectByID(id))?.name ?? id; } catch { return id; } };
    const lines = c.items.slice(0, TIP_ITEMS).map((x) => `${name(x.id)} ×${count(x.qty)}`);
    if (c.items.length > TIP_ITEMS) lines.push(t('MOD_VOY_CAIRN_MORE', { n: `${c.items.length - TIP_ITEMS}` }));
    for (const p of c.purse) lines.push(`${cur(p.id)}: ${count(p.amount)}`);
    return lines.join('\n');
  };
  /** The Here panel's rows: a cairn on your hex or the next one, who left it, its guard and Collect. */
  const panelHtml = () => {
    if (state.folksGuarded !== true) return '';
    const cs = near();
    if (cs.length === 0) return '';
    const why = collectWhy();
    return cs.map((c) => {
      const guard = c.guard === undefined ? ''
        : ` <span class="text-warning voyage-keep"><i class="fa fa-shield-alt mr-1" aria-hidden="true"></i>${esc(t('MOD_VOY_CAIRN_GUARD', { band: state.encounters?.bandName?.(c.guard.band) ?? c.guard.band }))}</span>`;
      const label = esc(getLangString('MOD_VOY_CAIRN_COLLECT'));
      const btn = why === ''
        ? `<button type="button" class="btn btn-sm btn-success voyage-row-btn voyage-cairn-btn" data-cairn="${esc(c.id)}"${c.guard === undefined ? '' : ` title="${esc(getLangString('MOD_VOY_CAIRN_COLLECT_GUARDED'))}"`}>${label}</button>`
        : `<button type="button" class="btn btn-sm btn-outline-secondary disabled voyage-row-btn voyage-cairn-btn" data-cairn="${esc(c.id)}" aria-disabled="true" title="${esc(getLangString(CAIRN_WHY[why]))}">${label}</button>`;
      return `<div class="voyage-here-ship voyage-cairn-row"><span><span class="voyage-here-label">${esc(getLangString('MOD_VOY_CAIRN_LABEL'))}</span> `
        + `<span class="voyage-keep" title="${esc(holds(c))}"><i class="fa fa-monument mr-1" aria-hidden="true"></i>${esc(t('MOD_VOY_CAIRN_OF', { name: c.name }))} <small class="text-muted">${esc(hexText(c))}</small></span>${guard}</span>${btn}</div>`;
    }).join('');
  };
  const click = (btn) => {
    if (btn?.getAttribute?.('aria-disabled') === 'true') return;
    const id = btn?.dataset?.cairn;
    if (id) collect(id);
  };

  let registered = false;
  const register = () => {
    if (registered) return;
    const a = state.folksApi?.();
    if (a === undefined || !(a.version >= DEATH_KEEPER_API) || typeof a.registerDeathKeeper !== 'function') return;
    try {
      a.registerDeathKeeper({ keep, textFor, heldIds: () => C.heldIds(list() ?? []) });
      registered = true;
      log('cairns: the death keeper is registered with Worker Folks');
    } catch (e) { console.error('[Voyage] cairns failed to register', e); }
  };
  ctx.onCharacterSelectionLoaded(register);
  ctx.onCharacterLoaded(register);

  return {
    /** The save's cairns, oldest first (cairn-model shape). */
    all: () => list() ?? [],
    registered: () => registered,
    /** How many cairns a save keeps, for the Journal. */
    max: C.CAIRNS_MAX,
    keep, textFor,
    near, collectWhy, collect, guardDone, panelHtml, click, put,
  };
}
