// Voyage tasks (phase 4): the harbour board's Notices tab. Each port posts NOTICES a season (with the
// cargo, every 72 hours): set foot on a place you have not found, or bring goods gathered after you take the task to a
// port you know. One task at a time, Slayer style; Drop it is free, but the next Take waits an hour. The rules are pure
// (tasks-model.mjs); this module reads the game and draws.
//
// The save: `record.tasks` (v14), `{ boards: { [poi]: { s: season, list } }, cur, wait }`.

/** The skills whose gathered goods a Bring task may ask for: their actions each have one product. */
const BRING_SKILLS = ['melvorD:Mining', 'melvorD:Woodcutting', 'melvorD:Fishing'];
const NO_TASKS = ['FakePort'];
const PIN = '<svg aria-hidden="true" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M24 44s14-13 14-24a14 14 0 0 0-28 0c0 11 14 24 14 24z"></path><circle cx="24" cy="20" r="5"></circle></svg>';

export function install(ctx, { state, TM, CM, M, shipModel, terrainMod, stranded, hexes, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const qty = (n) => numberWithCommas(n);
  const skill = () => state.voyageSkill?.();
  const usable = () => { const s = skill(); return s !== undefined && s.futureRaw === undefined; };
  const notify = (text, kind = 'success') => { try { notifyPlayer(skill(), text, kind); } catch {} };
  const liveHex = (q, r) => { try { return game.cartography.activeMap?.getHex(new HexCoords(q, r)); } catch { return undefined; } };
  const portName = (poi) => state.cargo?.portName?.(poi) ?? poi.replace(/([a-z])([A-Z])/g, '$1 $2');
  const byKey = new Map(hexes.map((h) => [`${h.q},${h.r}`, h]));
  const ports = hexes.filter((h) => h.cloud !== true && (h.f ?? []).includes('port') && !NO_TASKS.includes(h.poi)).map((h) => ({ poi: h.poi, q: h.q, r: h.r }));
  const portRec = new Map(ports.map((p) => [p.poi, p]));
  const knownPort = (p) => liveHex(p.q, p.r)?.pointOfInterest?.isDiscovered === true;

  // ---- the save ------------------------------------------------------------------------------------------------
  let cleanedFor;
  const data = () => {
    if (!usable()) return undefined;
    const rec = skill().record;
    if (cleanedFor !== rec) { rec.tasks = TM.cleanTasks(rec.tasks); cleanedFor = rec; }
    return rec.tasks;
  };
  const changed = () => { const s = skill(); if (s !== undefined) s.renderQueue.page = true; state.onSettingsChange(); };

  // ---- what a board may ask --------------------------------------------------------------------------------------
  /** Island tiers by landmass (ship-model ISLANDS): a place on a bigger hull's island waits for that hull. */
  const islandTier = (() => {
    const byLandmass = new Map();
    return (rec) => {
      if (state.terrain === undefined || rec === undefined) return 1;
      if (byLandmass.size === 0) {
        for (const island of shipModel.ISLANDS) {
          const a = state.terrain.poi(island.anchor);
          if (a !== undefined) byLandmass.set(state.terrain.landmass(a.q, a.r), island.tier);
        }
      }
      return shipModel.isSea(rec) ? 1 : byLandmass.get(state.terrain.landmass(rec.q, rec.r)) ?? 1;
    };
  })();
  const myTier = () => Math.max(1, shipModel.tierOf(state.ship?.vessel?.('boat')), shipModel.tierOf(state.ship?.vessel?.('ship')));
  /** Places not found yet that your hulls can land on: [{ poi, q, r }] (the table's POI key). */
  const places = () => {
    const out = [];
    const tier = myTier();
    for (const h of hexes) {
      if (h.poi === undefined || h.cloud === true || islandTier(h) > tier) continue;
      const poi = liveHex(h.q, h.r)?.pointOfInterest;
      if (poi === undefined || poi.isDiscovered || poi.hidden !== undefined) continue;
      out.push({ poi: h.poi, q: h.q, r: h.r });
    }
    return out;
  };
  /** Goods you could gather now: [{ id, price, interval, zone }], zone = the hexes where they can be had. */
  const goods = () => {
    const out = [];
    for (const id of BRING_SKILLS) {
      const sk = game.skills.getObjectByID(id);
      if (sk === undefined || sk.isUnlocked === false) continue;
      sk.actions.forEach((a) => {
        const item = a.product;
        if (item === undefined || (a.level ?? 1) > sk.level || (a.abyssalLevel ?? 0) > 0 || (a.realm !== undefined && a.realm.id !== 'melvorD:Melvor')) return;
        if (item.sellsFor?.currency !== game.gp) return;
        const zone = (state.zoneCandidates?.(a.id) ?? []).map((rec) => ({ q: rec.q, r: rec.r }));
        const interval = a.baseInterval ?? (a.baseMinInterval !== undefined ? (a.baseMinInterval + a.baseMaxInterval) / 2 : sk.baseInterval ?? 3000);
        out.push({ id: item.id, price: item.sellsFor.quantity, interval, zone });
      });
    }
    return out;
  };
  const seedOf = () => { try { return game.characterName ?? 'captain'; } catch { return 'captain'; } };
  /**
   * What sailing or walking from the port `from` to `to` ({ q, r }) costs in GP by the game's own travel prices: the
   * cheapest road by the trader's search (src/stranded.mjs), the ship rules as travel has them, fog ignored. Null when
   * there is no way for your hulls (the place is not posted); undefined when it can't tell (the task pays its floor).
   */
  const tripGp = (from, to) => {
    try {
      const cart = game.cartography;
      const map = cart.activeMap;
      const a = map.getHex(new HexCoords(from.q, from.r));
      const b = map.getHex(new HexCoords(to.q, to.r));
      if (a === undefined || b === undefined || stranded === undefined) return undefined;
      const neighbours = (hex) => {
        const out = [];
        HexCoords.axialDirVectors.forEach((_, i) => {
          const n = map.getHex(HexCoords.axialNeighbor(hex, i));
          if (n !== undefined && (state.ship?.allows?.(hex, n) ?? true)) out.push(n);
        });
        return out;
      };
      const mult = cart.travelCostMultiplier;
      const found = stranded.cheapestRoute(a, { neighbours, stepCost: (h) => h.getCombinedCost(mult), isGoal: (h) => h === b, key: (h) => `${h.q},${h.r}` });
      if (found === undefined) return null;
      return cart.getTravelCosts(found.path).getCurrencyQuantityArray().reduce((sum, { currency, quantity }) => sum + (currency === game.gp ? quantity : 0), 0);
    } catch (e) { log('task trip cost failed', e); return undefined; }
  };
  /** A port's notices this season, posted on the first look. */
  const board = (poi) => {
    const d = data();
    const p = portRec.get(poi);
    if (d === undefined || p === undefined) return [];
    const s = M.seasonOf(Date.now());
    const b = d.boards[poi];
    if (b !== undefined && b.s === s) return b.list;
    const list = TM.makeNotices(p, s, { places: places(), goods: goods(), ports: ports.filter(knownPort), costOf: (place) => tripGp(p, place) }, M.rng(M.hash(`${seedOf()}|${poi}|${s}|tasks`)));
    d.boards[poi] = { s, list };
    changed();
    return list;
  };

  // ---- the task --------------------------------------------------------------------------------------------------
  const found = (id) => { try { return game.stats.itemFindCount(game.items.getObjectByID(id)); } catch { return 0; } };
  const bankQty = (id) => { try { return game.bank.getQty(game.items.getObjectByID(id)); } catch { return 0; } };
  const here = () => state.cargo?.portHere?.()?.poi;
  const pay = (task, why) => {
    game.gp.add(task.gp);
    try { skill().addXP(task.xp); } catch (e) { log('task XP failed', e); }
    let extra = '';
    if (Math.random() < CM.TASK_RUMOUR) {
      const item = state.charts?.giveRumour?.();
      if (item !== undefined) extra = ` ${t('MOD_VOY_TASK_AND_RUMOUR', { name: item.name })}`;
    }
    notify(`${t(why, { gp: qty(task.gp), xp: qty(task.xp) })}${extra}`);
    log(`task ${task.id} done: ${task.gp} GP, ${task.xp} XP${extra}`);
  };
  const take = (id, poi) => {
    const d = data();
    if (d === undefined || here() !== poi || d.cur !== null) return false;
    const wait = TM.waitLeft(d.wait, Date.now());
    if (wait > 0) { notify(t('MOD_VOY_TASK_WAIT', { m: `${Math.ceil(wait / 60000)}` }), 'danger'); return false; }
    const list = board(poi);
    const n = list.find((x) => x.id === id);
    if (n === undefined) return false;
    d.cur = TM.takeTask(n, poi, n.k === 'bring' ? found(n.item) : 0, Date.now());
    d.boards[poi].list = list.filter((x) => x.id !== id);
    changed();
    notify(t('MOD_VOY_TASK_TAKEN'), 'info');
    try { state.journal?.learn('notices'); } catch {}
    log(`task ${id} taken at ${poi}`);
    checkReach();
    return true;
  };
  const handIn = (poi) => {
    const d = data();
    const cur = d?.cur;
    if (cur == null || here() !== poi || !TM.canHandIn(cur, found(cur.item), bankQty(cur.item), poi)) return false;
    game.bank.removeItemQuantity(game.items.getObjectByID(cur.item), cur.n, false);
    d.cur = null;
    changed();
    pay(cur, 'MOD_VOY_TASK_HANDED_IN');
    return true;
  };
  let dropAsk = false;
  const drop = () => {
    const d = data();
    if (d?.cur == null) return false;
    log(`task ${d.cur.id} dropped`);
    d.cur = null;
    d.wait = Date.now() + TM.WAIT_MS;
    changed();
    notify(t('MOD_VOY_TASK_DROPPED'), 'info');
    return true;
  };
  /** A Reach task is done the moment you stand on its place. */
  const checkReach = () => {
    const d = data();
    const cur = d?.cur;
    if (cur == null || cur.k !== 'reach') return;
    const pos = state.position?.();
    if (pos === undefined || pos.q !== cur.q || pos.r !== cur.r) return;
    d.cur = null;
    changed();
    pay(cur, 'MOD_VOY_TASK_REACHED');
  };
  /** The goods of a Bring task all gathered: said once. */
  let toldDone;
  const checkGathered = () => {
    const cur = data()?.cur;
    if (cur == null || cur.k !== 'bring' || toldDone === cur.id) return;
    if (TM.progressOf(cur, found(cur.item)) < cur.n) return;
    toldDone = cur.id;
    notify(t('MOD_VOY_TASK_GATHERED', { port: portName(cur.to) }), 'info');
  };
  // Where travel, portals and the dev teleport all land ('travel' fires before the position changes, gate.mjs).
  try { ctx.patch(WorldMap, 'setPlayerPosition').after(() => { setTimeout(checkReach, 0); }); } catch (e) { log('task travel hook failed', e); }
  ctx.onCharacterLoaded(() => {
    cleanedFor = undefined;
    setTimeout(checkReach, 0);
  });
  try {
    ctx.patch(GatheringSkill, 'addActionRewards').after(function () {
      try { if (BRING_SKILLS.includes(this.id)) checkGathered(); } catch (e) { log('task check failed', e); }
    });
  } catch (e) { log('task gather hook failed', e); }

  // ---- drawing -------------------------------------------------------------------------------------------------
  const icon = (src) => (src ? `<img class="voyage-skill-name-icon" src="${src}" alt="">` : '');
  const button = (cls, label, attrs, why) => (why === undefined
    ? `<button type="button" class="btn ${cls}" ${attrs}>${esc(label)}</button>`
    : `<button type="button" class="btn btn-outline-secondary" disabled title="${esc(why)}">${esc(label)}</button>`);
  const dirWord = (dir) => (dir ? getLangString(`MOD_VOY_DIR_${dir}`) : '');
  /** "about 18 hexes south-east" from where you stand, inside a sentence; `line`: on a line of its own, "About ...". */
  const way = (to, line = false) => {
    const pos = state.position?.();
    if (pos === undefined) return '';
    const d = TM.hexDist(pos, to);
    return d === 0 ? t('MOD_VOY_TASK_HERE') : t(line ? 'MOD_VOY_TASK_WAY_LINE' : 'MOD_VOY_TASK_WAY', { n: `${d}`, dir: dirWord(terrainMod.directionLabel(pos, to)) });
  };
  const art = (n) => {
    if (n.k === 'reach') return `<span class="voyage-cargo-art voyage-task-pin">${PIN}</span>`;
    const item = game.items.getObjectByID(n.item);
    return `<span class="voyage-cargo-art"><img class="voyage-cargo-box" src="${item?.media ?? ''}" alt=""></span>`;
  };
  const what = (n) => {
    if (n.k === 'reach') return `<b>${esc(t('MOD_VOY_TASK_REACH'))}</b>`;
    const item = game.items.getObjectByID(n.item);
    return t('MOD_VOY_TASK_BRING', { n: qty(n.n), item: `<b>${esc(item?.name ?? n.item)}</b>`, port: `<b>${esc(portName(n.to))}</b>` });
  };
  const payBlock = (n) => `<div class="voyage-cargo-pay"><div>${icon(game.gp.media)}<b class="text-success">${qty(n.gp)}</b> GP</div>` +
    `<div>${icon(skill()?.media)}<b class="text-success">${qty(n.xp)}</b> <span data-no-skill-names>${esc(t('MOD_VOY_CARGO_XP'))}</span></div></div>`;
  const row = (n, lines, act, cls = '') => `<div class="voyage-cargo-row ${cls}">${art(n)}<div class="voyage-cargo-mid">${lines.join('')}</div>${payBlock(n)}<div class="voyage-cargo-act">${act}</div></div>`;

  const curRow = (cur, poi) => {
    const lines = [`<div>${what(cur)}</div>`];
    const acts = [];
    if (cur.k === 'reach') {
      lines.push(`<div>${esc(way(cur, true))}</div>`, `<div class="text-muted">${esc(t('MOD_VOY_TASK_REACH_NOTE'))}</div>`);
    } else {
      const got = TM.progressOf(cur, found(cur.item));
      const pct = Math.round((100 * got) / cur.n);
      lines.push(`<div class="voyage-task-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${cur.n}" aria-valuenow="${got}"><div style="width:${pct}%"></div></div>`);
      lines.push(`<div class="text-muted">${esc(t('MOD_VOY_TASK_GOT', { got: qty(got), n: qty(cur.n) }))}</div>`);
      if (poi === cur.to) {
        const bank = bankQty(cur.item);
        const why = got < cur.n ? t('MOD_VOY_TASK_NOT_YET') : bank < cur.n ? t('MOD_VOY_TASK_NOT_IN_BANK', { n: qty(cur.n) }) : undefined;
        if (why !== undefined) lines.push(`<div class="text-warning">${esc(why)}</div>`);
        acts.push(button('btn-success', t('MOD_VOY_TASK_HAND_IN'), 'data-task="hand-in"', why));
      } else lines.push(`<div class="text-muted">${esc(t('MOD_VOY_TASK_HAND_AT', { port: portName(cur.to) }))}</div>`);
    }
    if (dropAsk) {
      lines.push(`<div class="text-warning">${esc(t('MOD_VOY_TASK_DROP_SURE'))}</div>`);
      // A pair: Keep it first, Drop it last.
      acts.push(button('btn-outline-info', t('MOD_VOY_CARGO_DROP_NO'), 'data-task="drop-no"'), button('btn-danger', t('MOD_VOY_CARGO_DROP_YES'), 'data-task="drop-yes"'));
    } else acts.push(button('btn-outline-danger btn-sm', t('MOD_VOY_CARGO_DROP'), 'data-task="drop"'));
    return row(cur, lines, acts.join(''), 'voyage-task-cur');
  };
  const noticeRow = (n, poi, why) => {
    const lines = [`<div>${what(n)}</div>`];
    if (n.k === 'reach') lines.push(`<div class="text-muted">${esc(t('MOD_VOY_TASK_REACH_LINE', { way: way(n) }))}</div>`);
    else lines.push(`<div class="text-muted">${esc(t(n.to === poi ? 'MOD_VOY_TASK_BRING_HERE' : 'MOD_VOY_TASK_BRING_THERE', { port: portName(n.to) }))}</div>`);
    return row(n, lines, button('btn-success', t('MOD_VOY_TASK_TAKE'), `data-task="take" data-id="${esc(n.id)}"`, why));
  };
  /** The Notices tab of the port `poi`'s harbour board. */
  const html = (poi) => {
    const d = data();
    if (d === undefined) return `<div class="text-warning">${esc(t('MOD_VOY_PAGE_NO_SHIP'))}</div>`;
    if (NO_TASKS.includes(poi)) return `<div class="voyage-cargo-empty">${esc(t('MOD_VOY_CARGO_FAKE'))}</div>`;
    let out = '';
    if (d.cur !== null) out += `<div class="voyage-cargo-head">${esc(t('MOD_VOY_TASK_YOURS'))}</div>${curRow(d.cur, poi)}`;
    out += `<div class="voyage-cargo-head">${esc(t('MOD_VOY_TASK_POSTED'))}</div>`;
    const list = board(poi);
    const wait = TM.waitLeft(d.wait, Date.now());
    const why = d.cur !== null ? t('MOD_VOY_TASK_ONE') : wait > 0 ? t('MOD_VOY_TASK_WAIT', { m: `${Math.ceil(wait / 60000)}` }) : undefined;
    out += list.length === 0 ? `<div class="voyage-cargo-empty">${esc(t('MOD_VOY_TASK_NONE'))}</div>` : list.map((n) => noticeRow(n, poi, why)).join('');
    if (why !== undefined && list.length > 0) out += `<div class="text-warning text-center">${esc(why)}</div>`;
    return `${out}<div class="voyage-cargo-foot text-muted">${esc(t('MOD_VOY_TASK_FOOT', { when: state.cargo?.untilNext?.() ?? '' }))}</div>`;
  };
  const onClick = (b, poi) => {
    const w = b.dataset.task;
    if (w === 'take') take(b.dataset.id, poi);
    else if (w === 'hand-in') handIn(poi);
    else if (w === 'drop') dropAsk = true;
    else if (w === 'drop-no') dropAsk = false;
    else if (w === 'drop-yes') { dropAsk = false; drop(); }
  };
  /** The task on the Voyage page's Hold block, beside the cargo runs: one line, or ''. */
  const errandHtml = () => {
    const cur = data()?.cur;
    if (cur == null) return '';
    const status = cur.k === 'reach' ? way(cur, true)
      : t('MOD_VOY_TASK_GOT', { got: qty(TM.progressOf(cur, found(cur.item))), n: qty(cur.n) });
    return `<div class="voyage-errand">${art(cur).replace('voyage-cargo-art', 'voyage-cargo-art voyage-cargo-art-sm')}<div class="voyage-cargo-mid"><div>${what(cur)}</div><div class="text-muted">${esc(status)}</div></div></div>`;
  };
  const api = { html, onClick, errandHtml, resetAsk: () => { dropAsk = false; }, has: () => data()?.cur != null };
  state.tasks = api;
  return api;
}
