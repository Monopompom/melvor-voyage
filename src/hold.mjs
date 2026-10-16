// The ship's hold (build .72; the user: early bank space is hard to manage, and loot sells only at a market). Bank
// items go into the hold and come back out at the ship: standing on it or next to it. Stowing is in the bank's
// selected-item panel, under Sell; taking out is on the Voyage page. The rules are pure (ship-model.mjs holdSlots,
// atShip, stow, takeOut); the hold lives in the Voyage save (`record.hold`, save v5).
//
// The items are in the mod's save data: removing the mod loses them, which the "?" and the README say.

export function install(ctx, { state, shipModel, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const skill = () => state.voyageSkill?.();
  const usable = () => { const s = skill(); return s !== undefined && s.futureRaw === undefined; };
  const ship = () => state.ship?.ship();
  const hold = () => (usable() ? skill().record.hold : []);
  const slots = () => (usable() ? shipModel.holdSlots(ship(), skill().level) : 0);
  const hullName = () => state.ship?.hullName?.(ship()) ?? t('MOD_VOY_SHIP_BOAT');
  const changed = () => {
    const s = skill();
    if (s !== undefined) s.renderQueue.page = true;
    state.onSettingsChange();
  };

  /** Why the hold can't be reached now, or undefined. */
  const blocker = () => {
    if (!usable()) return t(skill()?.futureRaw !== undefined ? 'MOD_VOY_PAGE_FUTURE_SAVE' : 'MOD_VOY_PAGE_NO_SHIP');
    const s = ship();
    if (s == null) return t('MOD_VOY_HOLD_NO_SHIP');
    const p = state.position();
    const rec = p === undefined ? undefined : state.ship.recOf(p);
    if (!shipModel.atShip(rec, s)) return t('MOD_VOY_HOLD_AWAY', { hull: hullName(), where: state.ship.whereIs(s) });
    return undefined;
  };
  const write = (next) => { skill().record.hold = next; changed(); };

  /** Moves `qty` of a bank item into the hold. Returns how many went in, or 0 with a notice saying why. */
  const stowItem = (item, qty) => {
    const why = blocker();
    if (why !== undefined) { notifyPlayer(skill(), why, 'danger'); return 0; }
    const n = Math.min(Math.floor(qty), game.bank.getQty(item));
    if (!(n > 0)) { notifyPlayer(skill(), t('MOD_VOY_HOLD_AMOUNT'), 'danger'); return 0; } // empty or 0 in the box
    const next = shipModel.stow(hold(), item.id, n, slots());
    if (next === undefined) { notifyPlayer(skill(), t('MOD_VOY_HOLD_FULL', { hull: hullName() }), 'danger'); return 0; }
    game.bank.removeItemQuantity(item, n, false);
    write(next);
    log(`stowed ${n} ${item.id}`);
    return n;
  };
  /** Moves up to `qty` of an item from the hold to the bank. A full bank takes nothing new. */
  const takeItem = (item, qty) => {
    const why = blocker();
    if (why !== undefined) { notifyPlayer(skill(), why, 'danger'); return 0; }
    const { hold: next, taken } = shipModel.takeOut(hold(), item.id, qty);
    if (taken <= 0) return 0;
    if (!game.bank.addItem(item, taken, false, false, false, true, 'voyage:Hold')) {
      notifyPlayer(skill(), t('MOD_VOY_HOLD_BANK_FULL'), 'danger');
      return 0;
    }
    write(next);
    log(`took ${taken} ${item.id} from the hold`);
    return taken;
  };
  /** The hold for the page: [{ item, qty }] for items the game knows (an expansion switched off keeps its entries). */
  const contents = () => hold().map((e) => ({ item: game.items.getObjectByID(e.id), qty: e.qty })).filter((e) => e.item !== undefined);

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
  ctx.patch(BankSelectedItemMenuElement, 'setItem').after(function (_r, bankItem) {
    try {
      let box = this.querySelector('.voyage-hold-stow');
      const s = usable() ? ship() : undefined;
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
      const why = blocker();
      const used = hold().length;
      const full = used >= slots() && !hold().some((e) => e.id === item.id);
      const icon = ctx.getResourceUrl(shipModel.HULLS[s.hull]?.media ?? 'assets/hull_dinghy.png');
      let html = `<div class="${headClass}"><h5 class="${titleClass} voyage-hold-title"><img class="skill-icon-xxs mr-1" src="${icon}" alt="">${esc(t('MOD_VOY_HOLD_TITLE', { hull: hullName() }))}</h5>` +
        `<div class="block-options"><span class="${full ? `${countClass.replace('text-combat-smoke', '')} text-warning` : countClass}">${esc(t('MOD_VOY_HOLD_SLOTS', { used: `${used}`, slots: `${slots()}` }))}</span></div></div>` +
        `<div class="${bodyClass} voyage-hold-stow-body">`;
      if (why !== undefined || full) {
        html += `<div class="text-warning py-2">${esc(why ?? t('MOD_VOY_HOLD_FULL', { hull: hullName() }))}</div>`;
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
      box.querySelectorAll('[data-hold-preset]').forEach((b) => b.addEventListener('click', () => { if (input) input.value = b.dataset.holdPreset; }));
      // Redraw after a part stow: the slot count and the amount follow (it kept "0 / 6 slots", 16 Oct 2026). A whole
      // stack stowed leaves the bank, and the game moves the menu on by itself.
      const menu = this;
      box.querySelector('.voyage-hold-stow-go')?.addEventListener('click', () => {
        if (stowItem(item, Number(input?.value)) <= 0) return;
        const left = game.bank.items.get(item);
        if (left !== undefined && left.quantity > 0) { try { menu.setItem(left, game.bank); } catch (e) { log('stow redraw failed', e); } }
      });
    } catch (e) { log('hold stow block failed', e); }
  });

  const api = { hold, slots, contents, blocker, stow: stowItem, take: takeItem };
  state.hold = api;
  return api;
}
