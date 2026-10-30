// The ship's hold (build .72; the user: early bank space is hard to manage, and loot sells only at a market). Bank
// items go into the hold and come back out at the ship: standing on it or next to it. Stowing is in the bank's
// selected-item panel, under Sell; taking out is on the Voyage page. The rules are pure (ship-model.mjs holdSlots,
// atShip, stow, takeOut). Each vessel has its own hold in the Voyage save (`record.boat.hold`, `record.ship.hold`, save
// v10, build .150): a `kind` of 'boat' (the small boat) or 'ship' (the big ship). On the big ship with the boat aboard
// both are open (the user's decision).
//
// The items are in the mod's save data: removing the mod loses them, which the "?" and the README say.

export function install(ctx, { state, shipModel, helpLayout, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const skill = () => state.voyageSkill?.();
  const usable = () => { const s = skill(); return s !== undefined && s.futureRaw === undefined; };
  const vessel = (kind) => state.ship?.vessel?.(kind);
  const hold = (kind = defaultKind()) => (usable() ? vessel(kind)?.hold ?? [] : []);
  const slots = (kind = defaultKind()) => (usable() ? shipModel.holdSlots(vessel(kind), skill().level) : 0);
  const hullName = (kind = defaultKind()) => state.ship?.hullName?.(vessel(kind)) ?? t('MOD_VOY_SHIP_BOAT');
  /** The vessels you own, the big ship first. */
  const kinds = () => ['ship', 'boat'].filter((k) => vessel(k) != null);
  /** Within reach of a vessel's hold: on it or next to it (the boat aboard is where the big ship is). */
  const reachable = (kind) => {
    const v = vessel(kind);
    const p = state.position();
    return v != null && p !== undefined && shipModel.atShip(state.ship.recOf(p), v);
  };
  /** The hold meant when none is named: the vessel you are in, else one you can reach, else the small boat. */
  const defaultKind = () => {
    const inV = state.ship?.inVessel?.();
    if (inV !== undefined) return inV;
    return kinds().find(reachable) ?? (vessel('boat') != null ? 'boat' : 'ship');
  };
  const changed = () => {
    const s = skill();
    if (s !== undefined) s.renderQueue.page = true;
    state.onSettingsChange();
  };

  /** Why a vessel's hold can't be reached now, or undefined. */
  const blocker = (kind = defaultKind()) => {
    if (!usable()) return t(skill()?.futureRaw !== undefined ? 'MOD_VOY_PAGE_FUTURE_SAVE' : 'MOD_VOY_PAGE_NO_SHIP');
    const s = vessel(kind);
    if (s == null) return t('MOD_VOY_HOLD_NO_SHIP');
    if (!reachable(kind)) return t('MOD_VOY_HOLD_AWAY', { hull: hullName(kind), where: state.ship.whereIs(s) });
    return undefined;
  };
  const write = (kind, next) => { state.ship.setVessel(kind, { ...vessel(kind), hold: next }); changed(); };

  /** Moves `qty` of a bank item into the hold. Returns how many went in, or 0 with a notice saying why. */
  const stowItem = (item, qty, kind = defaultKind()) => {
    const why = blocker(kind);
    if (why !== undefined) { notifyPlayer(skill(), why, 'danger'); return 0; }
    const n = Math.min(Math.floor(qty), game.bank.getQty(item));
    if (!(n > 0)) { notifyPlayer(skill(), t('MOD_VOY_HOLD_AMOUNT'), 'danger'); return 0; } // empty or 0 in the box
    const next = shipModel.stow(hold(kind), item.id, n, slots(kind));
    if (next === undefined) { notifyPlayer(skill(), t('MOD_VOY_HOLD_FULL', { hull: hullName(kind) }), 'danger'); return 0; }
    game.bank.removeItemQuantity(item, n, false);
    write(kind, next);
    log(`stowed ${n} ${item.id}`);
    return n;
  };
  /** Moves up to `qty` of an item from the hold to the bank. A full bank takes nothing new. */
  const takeItem = (item, qty, kind = defaultKind()) => {
    const why = blocker(kind);
    if (why !== undefined) { notifyPlayer(skill(), why, 'danger'); return 0; }
    const { hold: next, taken } = shipModel.takeOut(hold(kind), item.id, qty);
    if (taken <= 0) return 0;
    if (!game.bank.addItem(item, taken, false, false, false, true, 'voyage:Hold')) {
      notifyPlayer(skill(), t('MOD_VOY_HOLD_BANK_FULL'), 'danger');
      return 0;
    }
    write(kind, next);
    log(`took ${taken} ${item.id} from the ${kind}'s hold`);
    return taken;
  };
  /**
   * Sells up to `qty` of an item straight from the hold (build .265, the user: "so I can sell from the boat"). The
   * bank's Sell rules hold: the same trade gate (the market here, the trader at half price, else the refusal with
   * the nearest market), the same price (Bank.getItemSalePrice, so the market's rate), the game's sale confirmation
   * when that setting is on, and the same statistics. `done` runs once the sale has gone through.
   */
  const SWAL_CLASS = { popup: 'voyage-ui', confirmButton: 'btn btn-danger m-1', cancelButton: 'btn btn-outline-info m-1' };
  const sellItem = (item, qty, kind = defaultKind(), done = undefined) => {
    const why = blocker(kind);
    if (why !== undefined) { notifyPlayer(skill(), why, 'danger'); return; }
    const aboard = hold(kind).find((e) => e.id === item.id && e.cargo === undefined)?.qty ?? 0;
    const n = Math.min(Math.floor(qty), aboard);
    if (!(n > 0)) { notifyPlayer(skill(), t('MOD_VOY_HOLD_AMOUNT'), 'danger'); return; }
    try {
      if (!game.tutorial.complete && game.tutorial.bannedItemSales.has(item)) { notifyPlayer(skill(), getLangString('MENU_TEXT_ITEM_SALE_LOCKED'), 'danger'); return; }
    } catch {}
    const sell = () => {
      const { hold: next, taken } = shipModel.takeOut(hold(kind), item.id, n);
      if (taken <= 0 || blocker(kind) !== undefined) return;
      const currency = item.sellsFor.currency;
      const price = game.bank.getItemSalePrice(item, taken);
      write(kind, next);
      currency.add(price);
      try {
        game.stats.General.add(GeneralStats.TotalItemsSold, taken);
        game.stats.Items.add(item, ItemStats.TimesSold, taken);
        if (currency === game.gp) game.stats.Items.add(item, ItemStats.GpFromSale, price);
      } catch (e) { log('hold sale stats failed', e); }
      (state.saleListeners ?? []).forEach((f) => { try { f(); } catch (e) { log('sale listener failed', e); } });
      if (price === 0 && currency === game.gp && item.sellsFor.quantity > 0) state.market?.soldForNothing?.(item, taken);
      log(`sold ${taken} ${item.id} from the ${kind}'s hold for ${price}`);
      done?.();
    };
    const confirmThenSell = () => {
      if (!game.settings.showSaleConfirmations) { sell(); return; }
      // The game's sale popup, in our message look: the item on top, the price amber after its coin.
      const { mark, msgHtml, MSG_IMAGE } = helpLayout;
      const currency = item.sellsFor.currency;
      const price = game.bank.getItemSalePrice(item, n);
      SwalLocale.fire({
        didRender: state.popupDidRender,
        customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass(SWAL_CLASS) : SWAL_CLASS,
        title: getLangString('BANK_STRING_23'),
        html: msgHtml([`${esc(numberWithCommas(n))} × ${mark.name(item.name)}`, mark.gp(currency.media, currency.formatAmount(numberWithCommas(price)))]),
        imageUrl: item.media,
        ...MSG_IMAGE,
        showCancelButton: true,
        confirmButtonText: getLangString('BANK_STRING_22'),
        cancelButtonText: t('MOD_VOY_HOLD_SELL_NOT_NOW'),
      }).then((r) => { if (r.value) sell(); });
    };
    state.guardTrade !== undefined ? state.guardTrade('sell', confirmThenSell) : confirmThenSell();
  };
  /**
   * The hold for the page: [{ item, qty, entry }] for items the game knows (an expansion switched off keeps its
   * entries). Packed cargo (phase 4) has `entry.cargo`: a sealed sack or crate, one a slot.
   */
  const contents = (kind = defaultKind()) => hold(kind).map((e) => ({ item: game.items.getObjectByID(e.id), qty: e.qty, entry: e })).filter((e) => e.item !== undefined);

  // ---- the bank: "Stow in the hold" under Sell -------------------------------------------------------------------
  // Built like the game's Sell block right above it (user feedback build .72): the same block, header band
  // and control classes, copied from the live Sell elements so it matches whatever the game's theme draws; an amount
  // box with blue presets in one row, then the green main action, centred.
  /**
   * Where the stow block goes so it lands under Sell, not beside it (user report, build .86: it sat to the right of
   * Sell and ran off the panel on every screen). Sell shares a flex row that doesn't wrap, so climb out of such rows
   * and go after the outermost one.
   */
  const belowOf = (sell) => {
    let el = sell;
    for (let i = 0; i < 4 && el.parentElement !== null; i++) {
      const css = getComputedStyle(el.parentElement);
      const row = css.display.includes('flex') && !css.flexDirection.startsWith('column') && css.flexWrap === 'nowrap';
      if (!row) break;
      el = el.parentElement;
    }
    return el;
  };
  /** The hold the bank stows into when two are open (build .150), picked in the block's header. */
  let stowKind;
  // The bank draws the block when you pick an item; a vessel built, moved or boarded since redraws it (the user, 19 Oct
  // 2026: "I had logs selected, then built a boat. And there were no Stow block until I clicked Logs again").
  // Walking redraws it only when the holds in reach change, so a Sell amount being typed is not reset every hex.
  let shown; // { menu, item, reach } the block was last drawn for
  let hooked = false;
  const reachNow = () => { try { return usable() ? kinds().filter(reachable).join() : ''; } catch { return ''; } };
  // One deferred redraw per burst of asks (build .401): a catch-up replays a voyage hex by hex inside one run of ticks,
  // and every hex asked for one. An unconditional ask in the burst makes the one redraw unconditional.
  let redrawQueued = false;
  let redrawAlways = false;
  const redraw = (onlyIfReachChanged = false) => {
    if (onlyIfReachChanged !== true) redrawAlways = true;
    if (redrawQueued) return;
    redrawQueued = true;
    setTimeout(() => {
      const always = redrawAlways;
      redrawQueued = false;
      redrawAlways = false;
      try {
        const bi = shown === undefined ? undefined : game.bank.items.get(shown.item);
        if (bi === undefined || bi.quantity <= 0 || !shown.menu.isConnected) return;
        if (!always && reachNow() === shown.reach) return;
        shown.menu.setItem(bi, game.bank);
      } catch (e) { log('stow redraw failed', e); }
    }, 0);
  };
  ctx.patch(WorldMap, 'setPlayerPosition').after(function () {
    try { if (game.cartography?.activeMap === this) redraw(true); } catch {}
  });
  ctx.patch(BankSelectedItemMenuElement, 'setItem').after(function (_r, bankItem) {
    try {
      if (bankItem?.item !== undefined) shown = { menu: this, item: bankItem.item, reach: reachNow() };
      if (!hooked && state.ship?.onChange !== undefined) { hooked = true; state.ship.onChange(() => redraw()); }
      let box = this.querySelector('.voyage-hold-stow');
      const open = usable() ? kinds().filter(reachable) : [];
      const kind = open.includes(stowKind) ? stowKind : (open[0] ?? defaultKind());
      const s = usable() ? vessel(kind) : undefined;
      if (s == null || bankItem?.item === undefined) { (box?.closest('.voyage-hold-stow-col') ?? box)?.classList.add('d-none'); return; }
      const sell = this.sellItemButton?.closest('.block');
      if (box === null) {
        box = document.createElement('div');
        // The game's row-deck makes each child a flex row; Sell's block sits in a col-12 for that. Straight in the row
        // ours put the header beside the controls, one word a line (user report, 16 Oct 2026).
        const col = document.createElement('div');
        col.className = 'col-12 voyage-hold-stow-col';
        col.append(box);
        if (sell) belowOf(sell).after(col); else this.selectedItemContainer?.append(col);
      }
      box.closest('.voyage-hold-stow-col')?.classList.remove('d-none');
      // Sell's look without its grid column: the stow block is always a full line of its own.
      const look = (sell?.className ?? 'block block-rounded bg-combat-inner-dark').split(/\s+/).filter((c) => !/^col(-|$)/.test(c)).join(' ');
      box.className = `${look} voyage-hold-stow voyage-ui`;
      box.classList.remove('d-none');
      const headClass = sell?.querySelector('.block-header')?.className ?? 'block-header block-header-default';
      // The header's title and count in Sell's own type (16 Oct 2026: a block-title h3 read small and letter-spaced).
      const titleClass = sell?.querySelector('.block-header > :first-child')?.className || 'font-size-sm font-w600 mb-0';
      const countClass = sell?.querySelector('.block-options span')?.className || 'font-w600 font-size-sm text-right text-combat-smoke';
      // The body copies Sell's own grid (user report, 16 Oct 2026: at 500px the stow block didn't look like Sell): its
      // body column, the row, the amount's column, the right-aligned presets and the centred main button.
      const grid = this.customSellQuantity?.closest('.row');
      const bodyClass = grid?.parentElement?.className || 'col-12 pt-2';
      const gridClass = grid?.className || 'row no-gutters';
      const qtyColClass = this.customSellQuantity?.parentElement?.className || 'col-12 col-xl-5 col-md-4';
      const presetColClass = this.sellAllButton?.parentElement?.className || 'col-12 col-xl-7 text-right col-md-3';
      const mainColClass = this.sellItemButton?.parentElement?.className || 'col-12 text-center';
      const inputClass = this.customSellQuantity?.className ?? 'form-control m-1';
      const presetClass = (this.sellAllButton?.className ?? 'btn btn-info').replace('btn-success', 'btn-info');
      const mainClass = (this.sellItemButton?.className ?? 'btn btn-danger').replace('btn-danger', 'btn-success');
      const item = bankItem.item;
      const why = blocker(kind);
      const used = hold(kind).length;
      const full = used >= slots(kind) && !hold(kind).some((e) => e.id === item.id && e.cargo === undefined);
      const icon = ctx.getResourceUrl(shipModel.HULLS[s.hull]?.media ?? 'assets/hull_dinghy.webp');
      let html = `<div class="${headClass}"><h5 class="${titleClass} voyage-hold-title"><img class="skill-icon-xxs mr-1" src="${icon}" alt="">${esc(t('MOD_VOY_HOLD_TITLE', { hull: hullName(kind) }))}</h5>` +
        `<div class="block-options"><span class="${full ? `${countClass.replace('text-combat-smoke', '')} text-warning` : countClass}">${esc(t('MOD_VOY_HOLD_SLOTS', { used: `${used}`, slots: `${slots(kind)}` }))}</span></div></div>` +
        `<div class="${bodyClass} voyage-hold-stow-body">`;
      // Two holds open (the boat aboard the big ship): pick which one, blue outline like other choices.
      if (open.length > 1) {
        html += `<div class="voyage-hold-pickers" role="group" aria-label="${esc(t('MOD_VOY_HOLD_WHICH'))}">${open.map((k) =>
          `<button type="button" class="btn btn-sm ${k === kind ? 'btn-info' : 'btn-outline-info'}" data-hold-kind="${k}" aria-pressed="${k === kind}">${esc(t(shipModel.hullNameKey(vessel(k).hull)))}</button>`).join('')}</div>`;
      }
      if (why !== undefined || full) {
        html += `<div class="text-warning py-2">${esc(why ?? t('MOD_VOY_HOLD_FULL', { hull: hullName(kind) }))}</div>`;
      } else {
        const q = bankItem.quantity;
        html += `<div class="${gridClass}"><div class="${qtyColClass}">` +
          `<input type="number" min="1" max="${q}" inputmode="numeric" class="${inputClass} voyage-hold-qty" value="${q}" aria-label="${esc(t('MOD_VOY_PAGE_AMOUNT'))}"></div>` +
          `<div class="${presetColClass} voyage-hold-presets">` +
          // A space between the buttons, as in Sell's markup: in a narrow panel "All" then wraps the same way.
          (q > 1 ? `<button type="button" class="${presetClass}" data-hold-preset="${q - 1}">${esc(t('MOD_VOY_HOLD_ALL_BUT_ONE'))}</button> ` : '') +
          `<button type="button" class="${presetClass}" data-hold-preset="${q}">${esc(t('MOD_VOY_PAGE_STORES_LOAD_ALL'))}</button></div>` +
          '<div class="col-12"><div class="dropdown-divider"></div></div>' +
          `<div class="${mainColClass}"><button type="button" class="${mainClass} voyage-hold-stow-go">${esc(t('MOD_VOY_HOLD_STOW'))}</button></div></div>`;
      }
      box.innerHTML = `${html}</div>`;
      const input = box.querySelector('.voyage-hold-qty');
      const menu0 = this;
      box.querySelectorAll('[data-hold-kind]').forEach((b) => b.addEventListener('click', () => {
        stowKind = b.dataset.holdKind;
        try { menu0.setItem(bankItem, game.bank); } catch (e) { log('stow redraw failed', e); }
      }));
      box.querySelectorAll('[data-hold-preset]').forEach((b) => b.addEventListener('click', () => { if (input) input.value = b.dataset.holdPreset; }));
      // Redraw after a part stow: the slot count and the amount follow (it kept "0 / 6 slots", 16 Oct 2026). A whole
      // stack stowed leaves the bank, and the game moves the menu on by itself.
      const menu = this;
      box.querySelector('.voyage-hold-stow-go')?.addEventListener('click', () => {
        if (stowItem(item, Number(input?.value), kind) <= 0) return;
        const left = game.bank.items.get(item);
        if (left !== undefined && left.quantity > 0) { try { menu.setItem(left, game.bank); } catch (e) { log('stow redraw failed', e); } }
      });
    } catch (e) { log('hold stow block failed', e); }
  });

  /** `k` crates overboard at random (a run from a band at sea; build .387): what went, [{ item, qty, cargo }]; nothing from a hold that can't be used. */
  const jettison = (k, kind = 'ship') => {
    if (!(k > 0) || !usable()) return [];
    const { hold: next, dropped } = shipModel.jettison(hold(kind), k);
    if (dropped.length === 0) return [];
    write(kind, next);
    log(`${dropped.length} crate(s) overboard from the ${kind}'s hold: ${dropped.map((e) => `${e.qty} ${e.id}`).join(', ')}`);
    return dropped.map((e) => ({ item: game.items.getObjectByID(e.id), qty: e.qty, cargo: e.cargo }));
  };
  const api = { hold, slots, contents, blocker, stow: stowItem, take: takeItem, sell: sellItem, jettison, kinds, reachable, defaultKind, hullName };
  state.hold = api;
  return api;
}
