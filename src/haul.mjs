// Folks hold what they make, in the game (the haul, Worker Folks API 10). Worker Folks keeps each Folk's room: its haul
// (output), its stock (inputs) and its purse. Voyage answers one question for it, "does this Folk use the bank here?"
// (a bank place within a hex: a city, capital, port or market), and does the rest from where you stand: it collects every
// Folk within a hex as you arrive or as their rooms fill, empties a room when its Folk comes aboard or reaches a bank
// place, lets you restock from the Here panel, and marks a room that stopped on the map. Without Worker Folks 10 or with
// the setting off, every Folk works from the bank as before. The rules are pure (src/haul-model.mjs).

const SWAL_CLASS = { popup: 'voyage-ui', confirmButton: 'btn btn-outline-info m-1' };

export function install(ctx, { state, H, rules, terrainMod, shortNumber, decimal, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  /** Worker Folks' API with the room's hooks, once Voyage's guards are on; undefined otherwise. */
  const api = () => {
    const a = state.folksGuarded ? state.folksApi?.() : undefined;
    return a !== undefined && a.version >= H.HAUL_API && typeof a.registerBankAccess === 'function' && typeof a.room === 'function' ? a : undefined;
  };
  /** The haul applies: the API is there, the rules are on and the setting too. */
  const on = () => api() !== undefined && state.active?.() === true && state.settings.haul?.() !== false;
  const distance = (a, b) => terrainMod.hexDistance(a, b);
  const recordAt = (p) => state.recordAt(p);
  const neighboursOf = (rec) => (state.terrain === undefined ? [] : state.terrain.neighbours(rec.q, rec.r));
  const accessOf = (folk) => H.accessFor(folk, { on: on(), recordAt, neighboursOf, isTradePlace: rules.isTradePlace });
  const roomOf = (id) => { try { return api()?.room(id); } catch (e) { log('room read failed', e); return undefined; } };
  const offlineNow = () => { try { return game._isInOnlineLoop === false; } catch { return false; } };

  // ---- what came in: one notice online, one Welcome Back line offline ----------------------------------------------
  const itemName = (id) => { try { return game.items.getObjectByID(id)?.name ?? id; } catch { return id; } };
  const currencyText = (id, amount) => {
    try {
      const c = game.currencies.getObjectByID(id);
      if (c === game.gp) return t('MOD_VOY_HAUL_GP', { gp: shortNumber(amount) });
      return `${shortNumber(amount)} ${c?.name ?? id}`;
    } catch { return `${shortNumber(amount)}`; }
  };
  const SHOWN = 4;
  const listText = (m) => {
    const parts = [...m.purse.map((p) => currencyText(p.currencyId, p.amount)), ...m.items.map((s) => `${shortNumber(s.qty)} ${itemName(s.itemId)}`)];
    if (parts.length <= SHOWN) return parts.join(', ');
    return t('MOD_VOY_HAUL_AND_MORE', { list: parts.slice(0, SHOWN).join(', '), more: `${parts.length - SHOWN}` });
  };
  const leftText = (m) => m.left.map((s) => `${shortNumber(s.qty)} ${itemName(s.itemId)}`).join(', ');
  // On the Welcome Back the list reads as the game's own lines (the user, 6 Nov 2026): the amount (green for what came
  // in), the item's icon, its name, never split across lines; the comma rides with the one before it.
  const mediaOf = (id) => { try { return game.items.getObjectByID(id)?.media; } catch { return undefined; } };
  const piece = ([n, media, name], cls, comma) => `<span class="voyage-keep voyage-haul-piece"><span class="${cls}">${esc(shortNumber(n))}</span> `
    + `${media ? `<img class="skill-icon-xs" src="${esc(media)}" alt=""> ` : ''}${esc(name)}${comma ? ',' : ''}</span>`;
  const currencyPiece = (id, amount) => { try { const c = game.currencies.getObjectByID(id); return [amount, c?.media, c?.name ?? id]; } catch { return [amount, undefined, id]; } };
  const LIST_MARK = '@@voyage-list@@'; // stands in for the list in a translated line until the HTML goes in
  /** `text` escaped, each marker in `map` replaced by its HTML. */
  const fillHtml = (text, map) => Object.entries(map).reduce((h, [k, v]) => h.replace(k, () => v), esc(text));
  const listHtml = (purse, items, cls) => {
    const parts = [...purse.map((x) => currencyPiece(x.currencyId, x.amount)), ...items.map((x) => [x.qty, mediaOf(x.itemId), itemName(x.itemId)])];
    const shown = parts.slice(0, SHOWN);
    const html = shown.map((x, i) => piece(x, cls, i < shown.length - 1)).join(' ');
    if (parts.length <= SHOWN) return html;
    return fillHtml(t('MOD_VOY_HAUL_AND_MORE', { list: LIST_MARK, more: `${parts.length - SHOWN}` }), { [LIST_MARK]: html });
  };
  // The lines for some collections (or emptyings): what came in, then what the bank refused. `whoKey` holds the
  // language keys for one Folk and for several, and `names`, the Folks' names (one name: that Folk is named).
  // Each line has its text (notices) and its HTML (the Welcome Back).
  const linesFor = (m, whoKey) => {
    const names = [...new Set(whoKey.names ?? [])];
    const head = names.length === 1 ? t(whoKey.one, { name: names[0] }) : t(whoKey.many, { count: `${Math.max(1, names.length || m.folks)}` });
    const lines = [];
    if (m.items.length > 0 || m.purse.length > 0) {
      lines.push({ text: t('MOD_VOY_HAUL_IN', { who: head, list: listText(m) }), warn: false,
        html: () => fillHtml(t('MOD_VOY_HAUL_IN', { who: head, list: LIST_MARK }), { [LIST_MARK]: listHtml(m.purse, m.items, 'text-success') }) });
    }
    if (m.left.length > 0) {
      lines.push({ text: t('MOD_VOY_HAUL_LEFT', { list: leftText(m) }), warn: true,
        html: () => fillHtml(t('MOD_VOY_HAUL_LEFT', { list: LIST_MARK }), { [LIST_MARK]: listHtml([], m.left, '') }) });
    }
    return lines;
  };
  // Offline, every collection waits for the Welcome Back, where each kind (collected, emptied) is one summary.
  const away = new Map(); // whoKey.one -> { whoKey, results, names }
  // Standing by a working Folk collects each new stack as it comes: those collections are quiet (a notice every few
  // seconds would bury the others), and what the bank refused is said at most once a minute.
  let leftSaidAt = -Infinity;
  const tell = (results, whoKey, { quiet = false } = {}) => {
    const m = H.mergeCollected(results);
    if (H.emptySummary(m)) return;
    if (offlineNow()) {
      const e = away.get(whoKey.one) ?? { whoKey, results: [], names: [] };
      e.results.push(...results);
      e.names.push(...(whoKey.names ?? []));
      away.set(whoKey.one, e);
      return;
    }
    if (quiet) {
      if (m.left.length === 0 || Date.now() - leftSaidAt < 60000) return;
      leftSaidAt = Date.now();
      try { game.notifications.createErrorNotification('voyage:haul-left', t('MOD_VOY_HAUL_LEFT', { list: leftText(m) })); } catch {}
      return;
    }
    const lines = linesFor(m, whoKey);
    log(lines.map((l) => l.text).join(' '));
    try {
      for (const { text, warn } of lines) {
        if (!warn) game.notifications.createInfoNotification('voyage:haul', text, ctx.getResourceUrl('assets/icon.svg'));
        else game.notifications.createErrorNotification('voyage:haul-left', text);
      }
    } catch {}
  };
  try {
    ctx.patch(OfflineProgressElement, 'setMessages').after(function () {
      try {
        const kinds = [...away.values()];
        away.clear();
        if (kinds.length === 0 || this.messageContainer == null) return;
        for (const { whoKey, results, names } of kinds) {
          for (const { html, warn } of linesFor(H.mergeCollected(results), { ...whoKey, names })) {
            const h = document.createElement('h5');
            h.className = 'font-w600 mb-1';
            h.innerHTML = `<img class="skill-icon-xs mr-1" src="${esc(ctx.getResourceUrl('assets/icon.svg'))}" alt=""><span class="${warn ? 'text-warning' : ''}">${html()}</span>`;
            this.messageContainer.append(h);
          }
        }
      } catch (e) { log('haul offline lines failed', e); }
    });
  } catch (e) { log('haul offline summary not patched', e); }

  // ---- collecting where you stand ------------------------------------------------------------------------------------
  let collecting = false;
  /** Collects every Folk within a hex of you that holds something. */
  const collectHere = ({ quiet = false } = {}) => {
    const a = api();
    if (a === undefined || !on() || collecting) return;
    const pos = state.position();
    const folks = H.collectFrom(a.folks(), pos, { distance, rooms: roomOf });
    if (folks.length === 0) return;
    collecting = true;
    try {
      const results = [];
      for (const f of folks) { try { results.push(a.collect(f.id)); } catch (e) { log(`collect ${f.name} failed`, e); } }
      tell(results, { one: 'MOD_VOY_HAUL_FROM_ONE', many: 'MOD_VOY_HAUL_FROM_MANY', names: folks.map((f) => f.name) }, { quiet });
    } finally { collecting = false; }
  };
  // A room that changes while you stand by it is collected once the event is done (never inside Worker Folks' check).
  let soon = false;
  const collectSoon = (quiet = false) => {
    if (soon) return;
    soon = true;
    queueMicrotask(() => { soon = false; try { collectHere({ quiet }); } catch (e) { log('haul collect failed', e); } });
  };
  const nearYou = (folk) => { const pos = state.position(); return pos !== undefined && folk?.place != null && folk.travel === 'idle' && distance(pos, folk.place) <= H.REACH; };

  // ---- a Folk's room through its moves -------------------------------------------------------------------------------
  const seen = new Map(); // folk id -> { travel, access }
  const remember = (folk) => { if (folk?.id !== undefined) seen.set(folk.id, { travel: folk.travel, access: accessOf(folk) }); };
  const moved = (folk) => {
    const a = api();
    if (a === undefined || folk?.id === undefined) return;
    const before = seen.get(folk.id);
    const after = { travel: folk.travel, access: accessOf(folk) };
    seen.set(folk.id, after);
    if (H.lifeStep(before, after) !== 'empty') return;
    try { tell([a.emptyToBank(folk.id)], { one: 'MOD_VOY_HAUL_EMPTIED_ONE', many: 'MOD_VOY_HAUL_EMPTIED_MANY', names: [folk.name] }); } catch (e) { log(`empty ${folk.name} failed`, e); }
  };

  // ---- the setting, the rules and the marks -------------------------------------------------------------------------
  let wasOn;
  let marks = '';
  /** The map marks a room that stopped full or dry; redrawn only when one changes. */
  const markOf = (id) => H.roomMark(roomOf(id));
  const refreshMarks = () => {
    const a = api();
    const now = a === undefined || !on() ? '' : a.folks().map((f) => `${f.id}:${markOf(f.id) ?? ''}`).join('|');
    if (now === marks) return;
    marks = now;
    state.overlay?.folksChanged?.();
    try { state.herePanel?.render?.(); } catch {}
  };
  const settingsChanged = () => {
    const a = api();
    if (a === undefined) return;
    const now = on();
    if (now === wasOn) return;
    wasOn = now;
    try { a.refreshBankAccess?.(); } catch (e) { log('bank access refresh failed', e); }
    for (const f of a.folks()) remember(f);
    if (!now) {
      // Off: every room's haul to the bank at once (what finds no slot stays held, as the buffer has it).
      try {
        const all = a.emptyToBank() ?? [];
        // Named by the Folks that gave something, so one Folk reads as its name, never "1 Folks".
        const names = all.filter((r) => !H.emptySummary(H.mergeCollected([r]))).map((r) => a.folkById?.(r.id)?.name).filter((n) => typeof n === 'string');
        tell(all, { one: 'MOD_VOY_HAUL_EMPTIED_ONE', many: 'MOD_VOY_HAUL_EMPTIED_MANY', names });
      } catch (e) { log('empty all failed', e); }
    } else collectSoon();
    refreshMarks();
  };

  // Installed after gate.mjs, so this runs after its guards are registered on mods loaded and Voyage's Folks are on.
  ctx.onModsLoaded(() => {
    const a = api();
    if (a === undefined) { log('haul: Worker Folks API older than 10 or not loaded: Folks work from the bank'); return; }
    try {
      a.registerBankAccess((folk) => { try { return accessOf(folk); } catch (e) { console.error('[Voyage] bank access failed open', e); return 'bank'; } });
      a.on('folkMoved', ({ folk }) => moved(folk));
      for (const name of ['folkHired', 'folkAssigned']) a.on(name, ({ folk }) => remember(folk));
      for (const name of ['roomFull', 'roomDry']) a.on(name, ({ folk }) => { refreshMarks(); if (nearYou(folk)) { collectSoon(true); redrawModalSoon(); } });
      a.on('roomChanged', ({ folk }) => { refreshMarks(); if (nearYou(folk)) { if (H.hasHaul(roomOf(folk.id))) collectSoon(true); redrawModalSoon(); } });
      state.listeners.push(settingsChanged);
      log(`haul: bank access registered (Worker Folks API ${a.version})`);
    } catch (e) { console.error('[Voyage] the haul failed to hook Worker Folks; Folks work from the bank', e); }
  });
  ctx.onCharacterLoaded(() => setTimeout(() => {
    const a = api();
    if (a === undefined) return;
    wasOn = on();
    for (const f of a.folks()) remember(f);
    try { a.refreshBankAccess?.(); } catch {}
    refreshMarks();
    collectSoon();
  }, 0));

  // ---- the Here panel: a row for each Folk within a hex that works from its room -------------------------------------
  const hours = (ms) => decimal((Number(ms) || 0) / 3_600_000, 1);
  const stateWord = { full: 'MOD_VOY_HAUL_STATE_FULL', dry: 'MOD_VOY_HAUL_STATE_DRY' };
  /** The Folks within a hex that work from their room, nearest first, each with its room and whether it can be restocked. */
  const nearRooms = () => {
    const a = api();
    const pos = state.position();
    if (a === undefined || !on() || pos === undefined) return [];
    const rows = [];
    const folks = a.folks().filter((f) => nearYou(f)).sort((x, y) => distance(pos, x.place) - distance(pos, y.place) || x.slot - y.slot);
    for (const f of folks) {
      const room = roomOf(f.id);
      if (room === undefined || room.access !== 'room') continue;
      let plan;
      try { plan = a.restockPlan(f.id); } catch {}
      rows.push({ f, room, word: stateWord[room.state], canRestock: plan !== undefined && (plan.items ?? []).some((s) => s.qty > 0) });
    }
    return rows;
  };
  // One grid for every Folk's row, so the bars, the hours, the stop word and Restock line up in columns whatever the
  // name: the name takes what is left and runs when it is longer (as the harbour row's errand), Restock keeps the
  // right column like every row button and drops under its row when theirs do. A column no row uses is left out.
  // The hours line up too (the user, 6 Nov 2026): each number sits in a box as wide as the widest of its column,
  // right-aligned in even-width digits, so "0 h of 2 h" and "0 h of 12 h" fill the same space. `extra` is a last row
  // (the popup's Restock all), its button in the Restock column, so both buttons are one width.
  const rowsHtml = (rows, extra = '') => {
    const anyWord = rows.some((r) => r.word !== undefined);
    const anyBtn = rows.some((r) => r.canRestock) || extra !== '';
    const usedW = Math.max(1, ...rows.map((r) => hours(r.room.usedMs).length));
    const sizeW = Math.max(1, ...rows.map((r) => hours(r.room.sizeMs).length));
    const num = (text, w) => `<span class="voyage-haul-num" style="min-width:${w}ch">${esc(text)}</span>`;
    let html = '';
    for (const { f, room, word, canRestock } of rows) {
      const fill = t('MOD_VOY_HAUL_FILL', { used: hours(room.usedMs), size: hours(room.sizeMs) });
      const fillCell = esc(t('MOD_VOY_HAUL_FILL', { used: '\u0001', size: '\u0002' })).replace('\u0001', num(hours(room.usedMs), usedW)).replace('\u0002', num(hours(room.sizeMs), sizeW));
      const pct = Math.round(H.fillShare(room) * 100);
      const label = t('MOD_VOY_HAUL_LABEL', { name: f.name });
      html += `<div class="voyage-here-ship voyage-haul-row">`
        + `<span class="voyage-run" title="${esc(aboutFolk(f))}"><span class="voyage-run-text voyage-here-label">${esc(label)}</span></span>`
        + `<span class="voyage-haul-bar" role="img" aria-label="${esc(fill)}"><span class="voyage-haul-bar-in${word ? ' voyage-haul-bar-stop' : ''}" style="width:${pct}%"></span></span>`
        + `<small class="text-muted voyage-haul-fill" aria-label="${esc(fill)}">${fillCell}</small>`
        + (anyWord ? `<small class="text-warning voyage-haul-word">${word ? esc(t(word)) : ''}</small>` : '')
        + (canRestock ? `<button type="button" class="btn btn-sm btn-outline-info voyage-row-btn voyage-haul-btn" data-haul-act="restock" data-haul-folk="${esc(f.id)}">${esc(t('MOD_VOY_HAUL_RESTOCK'))}</button>` : '')
        + '</div>';
    }
    return `<div class="voyage-haul-rows${anyWord ? ' voyage-haul-w' : ''}${anyBtn ? ' voyage-haul-b' : ''}">${html}${extra}</div>`;
  };
  /** A haul row's tooltip: the Folk's name, rank and work, as the Folks here row had them ("Ada (Journeyman, Fishing)"). */
  const aboutFolk = (f) => {
    try { return `${f.name} (${t('MOD_VOY_PANEL_FOLK_WHAT', { tier: state.rankName(f.tier), what: state.folkDoing(f) })})`; } catch { return f.name; }
  };
  /** Up to this many Folks get their rows in the panel; more, and one row says how many and opens them all. */
  const PANEL_ROWS = 3;
  const panelHtml = () => {
    const rows = nearRooms();
    if (rows.length === 0) return '';
    if (rows.length <= PANEL_ROWS) return rowsHtml(rows);
    const stopped = rows.filter((r) => r.word !== undefined).length;
    return `<div class="voyage-here-ship voyage-haul-sum"><span><span class="voyage-here-label">${esc(t('MOD_VOY_HAUL_SUM_LABEL'))}</span> `
      + `${esc(t('MOD_VOY_HAUL_SUM', { count: `${rows.length}` }))}${stopped > 0 ? `, <span class="text-warning">${esc(t('MOD_VOY_HAUL_SUM_STOPPED', { count: `${stopped}` }))}</span>` : ''}</span>`
      + `<button type="button" class="btn btn-sm btn-outline-info voyage-row-btn voyage-haul-btn" data-haul-act="open">${esc(t('MOD_VOY_HAUL_SHOW'))}</button></div>`;
  };

  // ---- every Folk's room in a popup, once the panel would hold too many rows -----------------------------------------
  let modalBox; // the popup's content while it is open
  // The stopped first, then as the panel has them.
  const modalRows = () => { const rows = nearRooms(); return [...rows.filter((r) => r.word !== undefined), ...rows.filter((r) => r.word === undefined)]; };
  const modalHtml = (rows) => {
    if (rows.length === 0) return `<div class="text-center text-muted">${esc(t('MOD_VOY_HAUL_NONE'))}</div>`;
    const all = rows.some((r) => r.canRestock)
      ? `<div class="voyage-here-ship voyage-haul-row voyage-haul-all"><button type="button" class="btn btn-sm btn-outline-info voyage-row-btn" data-haul-act="all">${esc(t('MOD_VOY_HAUL_RESTOCK_ALL'))}</button></div>`
      : '';
    return rowsHtml(rows, all);
  };
  const redrawModal = () => {
    if (modalBox === undefined || !modalBox.isConnected) { modalBox = undefined; return; }
    try { modalBox.innerHTML = modalHtml(modalRows()); state.herePanel?.runLines?.(modalBox); } catch (e) { log('hauls popup redraw failed', e); }
  };
  let modalSoon = false;
  const redrawModalSoon = () => { if (modalBox === undefined || modalSoon) return; modalSoon = true; queueMicrotask(() => { modalSoon = false; redrawModal(); }); };
  const openModal = () => {
    const swalClass = typeof createSwalCustomClass === 'function' ? createSwalCustomClass(SWAL_CLASS) : SWAL_CLASS;
    SwalLocale.fire({
      didRender: state.popupDidRender,
      customClass: swalClass,
      title: t('MOD_VOY_HAUL_TITLE'),
      html: `<div class="voyage-haul-modal">${modalHtml(modalRows())}</div>`,
      confirmButtonText: t('MOD_VOY_HAUL_CLOSE'),
      didOpen: (el) => {
        modalBox = el.querySelector('.voyage-haul-modal') ?? undefined;
        if (modalBox === undefined) return;
        state.herePanel?.runLines?.(modalBox);
        modalBox.addEventListener('click', (e) => {
          const b = e.target instanceof Element ? e.target.closest('[data-haul-act]') : null;
          if (b === null) return;
          e.preventDefault();
          if (b.dataset.haulAct === 'all') restockAll(); else if (b.dataset.haulFolk) restock(b.dataset.haulFolk);
          afterAct();
        });
      },
      didClose: () => { modalBox = undefined; },
    });
  };
  const restock = (id) => {
    const a = api();
    const f = a?.folkById(id);
    if (a === undefined || f === undefined) return;
    let r;
    try { r = a.restock(id); } catch (e) { log('restock failed', e); return; }
    const notify = (text, ok) => { try { if (ok) game.notifications.createInfoNotification('voyage:haul', text, ctx.getResourceUrl('assets/icon.svg')); else game.notifications.createErrorNotification('voyage:haul', text); } catch {} };
    if (r?.ok) notify(t('MOD_VOY_HAUL_RESTOCKED', { name: f.name, actions: shortNumber(r.actions ?? 0) }), true);
    else notify(t(RESTOCK_WHY[r?.why] ?? RESTOCK_WHY.noInputs, { name: f.name }), false);
  };
  /** Worker Folks' reasons a restock is refused, in words. */
  const RESTOCK_WHY = { noSkill: 'MOD_VOY_HAUL_RESTOCK_WHY_NOSKILL', noInputs: 'MOD_VOY_HAUL_RESTOCK_WHY_NOINPUTS', noRoom: 'MOD_VOY_HAUL_RESTOCK_WHY_NOROOM', noBank: 'MOD_VOY_HAUL_RESTOCK_WHY_NOBANK', noStock: 'MOD_VOY_HAUL_RESTOCK_WHY_NOBANK' };
  /** Restock every Folk within a hex that can be: one notice for those restocked, one for those refused. */
  const restockAll = () => {
    const a = api();
    if (a === undefined) return;
    let done = 0;
    const refused = [];
    for (const { f, canRestock } of nearRooms()) {
      if (!canRestock) continue;
      let r;
      try { r = a.restock(f.id); } catch (e) { log('restock failed', e); }
      if (r?.ok) done += 1; else refused.push(f.name);
    }
    try {
      if (done > 0) game.notifications.createInfoNotification('voyage:haul', t('MOD_VOY_HAUL_RESTOCKED_ALL', { count: `${done}` }), ctx.getResourceUrl('assets/icon.svg'));
      if (refused.length > 0) game.notifications.createErrorNotification('voyage:haul-left', t('MOD_VOY_HAUL_RESTOCK_REFUSED', { names: refused.join(', ') }));
    } catch {}
  };
  const afterAct = () => {
    refreshMarks();
    try { state.herePanel?.render?.(); } catch {}
    redrawModal();
  };
  const click = (el) => {
    const id = el?.dataset?.haulFolk;
    if (el?.dataset?.haulAct === 'open') { openModal(); return; }
    if (el?.dataset?.haulAct === 'restock' && id) restock(id);
    afterAct();
  };

  /** The map's badge: 'full' or 'dry' when a Folk on this hex has stopped, else undefined. */
  const markAt = (q, r) => {
    const a = api();
    if (a === undefined || !on()) return undefined;
    for (const f of a.folks()) if (f.travel === 'idle' && f.place?.q === q && f.place?.r === r) { const m = markOf(f.id); if (m !== undefined) return m; }
    return undefined;
  };
  /** A word for a Folk's tooltip: "Haul full", "Out of inputs" or ''. */
  const folkWord = (f) => { const m = on() ? markOf(f.id) : undefined; return m === undefined ? '' : t(stateWord[m]); };

  // listed: the ids of the Folks the haul's rows show (the Folks here row leaves out those it would repeat).
  const listed = () => nearRooms().map((r) => r.f.id);
  const out = { on, rows: PANEL_ROWS, afterMove: () => { collectHere(); redrawModalSoon(); }, panelHtml, click, markAt, folkWord, accessOf, listed };
  state.haul = out;
  return out;
}
