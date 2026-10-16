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
  ctx.patch(BankSelectedItemMenuElement, 'setItem').after(function (_r, bankItem) {
    try {
      let box = this.querySelector('.voyage-hold-stow');
      const s = usable() ? ship() : undefined;
      if (s == null || bankItem?.item === undefined) { box?.classList.add('d-none'); return; }
      const sell = this.sellItemButton?.closest('.block');
      if (box === null) {
        box = document.createElement('div');
        if (sell) sell.after(box); else this.selectedItemContainer?.append(box);
      }
      box.className = `${sell?.className ?? 'block block-rounded bg-combat-inner-dark'} voyage-hold-stow voyage-ui`;
      box.classList.remove('d-none');
      const headClass = sell?.querySelector('.block-header')?.className ?? 'block-header block-header-default';
      const inputClass = this.customSellQuantity?.className ?? 'form-control';
      const presetClass = (this.sellAllButton?.className ?? 'btn btn-info').replace('btn-success', 'btn-info');
      const mainClass = (this.sellItemButton?.className ?? 'btn btn-danger').replace('btn-danger', 'btn-success');
      const item = bankItem.item;
      const why = blocker();
      const used = hold().length;
      const full = used >= slots() && !hold().some((e) => e.id === item.id);
      const icon = ctx.getResourceUrl(shipModel.HULLS[s.hull]?.media ?? 'assets/hull_dinghy.png');
      let html = `<div class="${headClass}"><h3 class="block-title"><img class="skill-icon-xs mr-2" src="${icon}" alt="">${esc(t('MOD_VOY_HOLD_TITLE', { hull: hullName() }))}</h3>` +
        `<div class="block-options font-w600 ${full ? 'text-warning' : ''}">${esc(t('MOD_VOY_HOLD_SLOTS', { used: `${used}`, slots: `${slots()}` }))}</div></div>` +
        '<div class="block-content voyage-hold-stow-body">';
      if (why !== undefined || full) {
        html += `<div class="text-warning py-2">${esc(why ?? t('MOD_VOY_HOLD_FULL', { hull: hullName() }))}</div>`;
      } else {
        const q = bankItem.quantity;
        html += '<div class="voyage-hold-row">' +
          `<input type="number" min="1" max="${q}" inputmode="numeric" class="${inputClass} voyage-hold-qty" value="${q}" aria-label="${esc(t('MOD_VOY_PAGE_AMOUNT'))}">` +
          '<div class="voyage-hold-presets">' +
          (q > 1 ? `<button type="button" class="${presetClass}" data-hold-preset="${q - 1}">${esc(t('MOD_VOY_HOLD_ALL_BUT_ONE'))}</button>` : '') +
          `<button type="button" class="${presetClass}" data-hold-preset="${q}">${esc(t('MOD_VOY_PAGE_STORES_LOAD_ALL'))}</button></div></div>` +
          `<div class="voyage-hold-main"><button type="button" class="${mainClass} voyage-hold-stow-go">${esc(t('MOD_VOY_HOLD_STOW'))}</button></div>`;
      }
      box.innerHTML = `${html}</div>`;
      const input = box.querySelector('.voyage-hold-qty');
      box.querySelectorAll('[data-hold-preset]').forEach((b) => b.addEventListener('click', () => { if (input) input.value = b.dataset.holdPreset; }));
      box.querySelector('.voyage-hold-stow-go')?.addEventListener('click', () => stowItem(item, Number(input?.value)));
    } catch (e) { log('hold stow block failed', e); }
  });

  const api = { hold, slots, contents, blocker, stow: stowItem, take: takeItem };
  state.hold = api;
  return api;
}
