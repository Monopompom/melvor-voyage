// The Voyage skill page: ship, hold, stores, travels and the compass stages, plus "Show map". The
// ship block builds the first dinghy and says where the ship is (phase 3b, src/ship.mjs). The container is inserted
// on interfaceAvailable because the game calls skill.initMenus() right after that hook and SkillHeaderElement looks
// for <skill-header data-skill-id> then.

// Modal buttons: confirm green, cancel blue outline (the game's default cancel is red; grey means disabled).
const SWAL_CLASS = { popup: 'voyage-ui', confirmButton: 'btn btn-success m-1', cancelButton: 'btn btn-outline-info m-1' };

export const CONTAINER_ID = 'voyage-container';
export const PAGE_ID = 'voyage:Voyage';
const CARTOGRAPHY_PAGE_ID = 'melvorAoD:Cartography';

export function install(ctx, { state, model, shipModel, storesModel, pageLayout, helpLayout, helpHtml, HELP_WIDTH, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const part = (name) => document.querySelector(`#${CONTAINER_ID} [data-voyage="${name}"]`);
  const skill = () => { try { return game.skills.getObjectByID(model.SKILL_ID); } catch { return undefined; } };
  const pageOf = (id) => { try { return game.pages.getObjectByID(id); } catch { return undefined; } };

  /**
   * Amounts typed into the action blocks, per block: { item, n }. Kept across redraws (the page redraws as GP, logs
   * or the bank change) and dropped when another item is picked.
   */
  const amounts = {};
  const amountFor = (action, itemId, fallback, max) => {
    const a = amounts[action];
    const n = a !== undefined && a.item === itemId ? a.n : fallback;
    return Math.max(1, Math.min(max, Math.floor(n)));
  };

  ctx.onInterfaceAvailable(() => {
    try {
      if (document.getElementById(CONTAINER_ID) !== null) return;
      const template = document.getElementById('voyage-page-template');
      if (template === null) { console.error('[Voyage] page template missing'); return; }
      // Two elements share id="main-container": anchor on a known page container instead.
      const anchor = document.getElementById('township-container') ?? document.getElementById('thieving-container');
      const fragment = document.importNode(template.content, true);
      if (anchor !== null) anchor.after(fragment); else document.querySelector('main')?.append(fragment);
      const container = document.getElementById(CONTAINER_ID);
      const button = part('show-map');
      const map = pageOf(CARTOGRAPHY_PAGE_ID);
      if (button !== null) {
        if (map === undefined) button.classList.add('d-none');
        else button.onclick = () => showMap(false); // the map as it was left (user feedback, build .50)
      }
      // The "?" next to each block title: that block's chapter in the Captain's Journal (phase 4), else its popup.
      container?.querySelectorAll('[data-voyage-help]').forEach((b) => {
        // Named for its block: six "How this works" read the same to a screen reader (.308, scan A-17).
        const name = b.closest('h5, h6')?.querySelector('lang-string, span')?.textContent.trim() ?? '';
        b.setAttribute('aria-label', name === '' ? t('MOD_VOY_HELP_BUTTON') : t('MOD_VOY_HELP_BUTTON_OF', { name }));
        b.onclick = () => { if (state.journal !== undefined) state.journal.open({ chapter: b.dataset.voyageHelp }); else showHelp(b.dataset.voyageHelp); };
      });
      // The status row's second line (compass and travels, build .146) folds; the time stays. Open or closed is a
      // per-browser choice.
      const toggle = part('status-toggle');
      const more = part('status-more');
      if (toggle !== null && more !== null) {
        const STATUS_KEY = 'voyage-status-open';
        const show = (open) => {
          toggle.setAttribute('aria-expanded', `${open}`);
          toggle.querySelector('i')?.classList.replace(open ? 'fa-caret-right' : 'fa-caret-down', open ? 'fa-caret-down' : 'fa-caret-right');
          more.classList.toggle('d-none', !open);
        };
        show((() => { try { return localStorage.getItem(STATUS_KEY) !== '0'; } catch { return true; } })());
        toggle.onclick = () => {
          const open = toggle.getAttribute('aria-expanded') !== 'true';
          show(open);
          try { localStorage.setItem(STATUS_KEY, open ? '1' : '0'); } catch {}
        };
      }
      // The blocks move and fold (build .203).
      try {
        if (container !== null && pageLayout !== undefined) state.pageLayout = pageLayout.mod.install(ctx, { container, L: pageLayout.L, t, tips: state.tips, log });
      } catch (e) { log('page layout failed', e); }
      // Delegated listeners: the blocks are re-rendered as innerHTML.
      part('ship')?.addEventListener('click', (e) => {
        state.planner?.onClick(e); // Navigator's Charts, in the Shipwright row (build .205)
        const target = e.target instanceof Element ? e.target.closest('[data-voyage-action]') : null;
        if (target === null) return;
        const kind = target.dataset.kind ?? 'boat';
        if (target.dataset.voyageAction === 'build') { if (state.ship?.build()) render(); }
        else if (target.dataset.voyageAction === 'shipwright') { shipwrightOpen(!shipwrightOpen()); render(); }
        else if (target.dataset.voyageAction === 'upgrade') { if (state.ship?.upgrade(target.dataset.kind === 'ship' ? 'ship' : 'boat')) render(); }
        else if (target.dataset.voyageAction === 'buy') { if (state.ship?.buy()) render(); }
        else if (target.dataset.voyageAction === 'find') showMap(true, kind);
      });
      // The land and sign squares (build .162): the shop and the sign's place on the map (planting and picking it up: the
      // Here panel, builds .166 and .169).
      part('land-col')?.addEventListener('click', (e) => {
        const target = e.target instanceof Element ? e.target.closest('[data-voyage-land]') : null;
        if (target === null || state.land === undefined) return;
        const what = target.dataset.voyageLand;
        if (what === 'shop') state.land.openShop();
        else if (what === 'locate') { const poi = state.land.signPoi(); if (poi !== undefined) showMap(false, 'boat', poi.hex); }
      });
      // Plan a voyage (build .119): src/planner.mjs draws and handles its block.
      part('plan')?.addEventListener('click', (e) => state.planner?.onClick(e));
      part('hold')?.addEventListener('click', (e) => {
        // The runs you carry sit under the hold (build .205): their board and plan buttons, and their "?".
        if (e.target instanceof Element && e.target.closest('[data-errands-help]') !== null) { if (state.journal !== undefined) state.journal.open({ guide: state.cargo?.count?.() === 0 ? 'board' : 'cargo' }); return; }
        state.cargo?.onPageClick(e);
        const target = e.target instanceof Element ? e.target.closest('[data-voyage-action], [data-voyage-preset]') : null;
        if (target === null) return;
        const kind = target.closest('[data-hold-kind]')?.dataset.holdKind ?? 'boat';
        if (target.dataset.voyagePreset !== undefined) { preset(target, `take-${kind}`); return; }
        if (target.dataset.voyageAction === 'hold-pick') { holdPicked[kind] = target.dataset.item; render(); }
        else if (target.dataset.voyageAction === 'hold-fold') { holdOpen[target.dataset.kind] = target.getAttribute('aria-expanded') !== 'true'; render(); }
        else if (target.dataset.voyageAction === 'take') {
          const item = game.items.getObjectByID(holdPicked[kind] ?? '');
          const n = typed(`take-${kind}`);
          if (item !== undefined && n > 0 && state.hold?.take(item, n, kind) > 0) { delete amounts[`take-${kind}`]; render(); }
        } else if (target.dataset.voyageAction === 'sell') {
          const item = game.items.getObjectByID(holdPicked[kind] ?? '');
          const n = typed(`take-${kind}`);
          if (item !== undefined && n > 0) state.hold?.sell(item, n, kind, () => { delete amounts[`take-${kind}`]; render(); });
        }
      });
      part('stores')?.addEventListener('click', (e) => {
        const target = e.target instanceof Element ? e.target.closest('[data-voyage-action], [data-voyage-preset]') : null;
        if (target === null) return;
        if (target.dataset.voyagePreset !== undefined) { preset(target, 'load'); return; }
        const action = target.dataset.voyageAction;
        if (action === 'pick') { picked = target.dataset.item; render(); return; }
        if (action === 'repair') { if (state.ship?.repair(target.dataset.kind ?? 'boat')) render(); return; }
        if (action === 'load') {
          const item = game.items.getObjectByID(picked ?? '');
          const n = typed('load');
          if (item === undefined || n <= 0) return;
          if (state.stores?.load(item, n) !== undefined) { delete amounts.load; render(); }
        }
      });
      // Typing keeps the amount and updates the main button's preview ("Load (+120 HP)").
      container?.addEventListener('input', (e) => {
        const input = e.target instanceof HTMLInputElement ? e.target : null;
        const action = input?.dataset.voyageAmount;
        if (action === undefined) return;
        amounts[action] = { item: input.dataset.item, n: Number(input.value) || 0 };
        refreshMain(action);
      });
      // A redraw waits while you type (focus in an amount box); it runs when the box loses focus.
      container?.addEventListener('focusout', () => { if (deferred) { deferred = false; setTimeout(render, 0); } });
    } catch (e) { console.error('[Voyage] page insert failed', e); }
  });

  /** The amount box of an action block, clamped to 1..max; 0 when there is none or it is empty. */
  const typed = (action) => {
    const input = document.querySelector(`#${CONTAINER_ID} [data-voyage-amount="${action}"]`);
    if (input === null) return 0;
    const max = Number(input.max) || 0;
    const n = Math.floor(Number(input.value) || 0);
    return n <= 0 ? 0 : Math.min(max, n);
  };
  /** A blue preset puts its amount in the box (it never acts on its own). */
  const preset = (button, action) => {
    const input = document.querySelector(`#${CONTAINER_ID} [data-voyage-amount="${action}"]`);
    if (input === null) return;
    input.value = button.dataset.voyagePreset;
    amounts[action] = { item: input.dataset.item, n: Number(input.value) };
    refreshMain(action);
  };
  /** The load preview: what the typed amount adds to the stores. */
  let loadPreview;
  const refreshMain = (action) => {
    if (action !== 'load' || loadPreview === undefined) return;
    const btn = document.querySelector(`#${CONTAINER_ID} [data-voyage-action="load"]`);
    const n = typed('load');
    if (btn !== null) btn.textContent = n > 0 ? `${t('MOD_VOY_PAGE_STORES_LOAD')} (${loadPreview(n)})` : t('MOD_VOY_PAGE_STORES_LOAD');
    if (btn !== null) btn.disabled = n <= 0;
  };

  /**
   * Opens the map. `onShip`: centred on the moored vessel `kind` ('boat' or 'ship', the ship block's buttons);
   * otherwise as it was left.
   */
  const showMap = (onShip, kind = 'boat', at = undefined) => {
    const map = pageOf(CARTOGRAPHY_PAGE_ID);
    if (map === undefined) return;
    state.openPage(map);
    const hex = at ?? (!onShip || state.ship?.inVessel?.() === kind ? undefined : state.ship?.hex(kind));
    if (hex !== undefined) setTimeout(() => { try { state.ship.centreOn(hex); } catch (e) { log('map centre failed', e); } }, 100);
  };

  const qty = (n) => numberWithCommas(n);
  /** A cost: icon, amount and what you have; red with the words when short (never colour alone). */
  const costIcon = (media, need, have, title, itemId) =>
    `<span class="voyage-cost ${have >= need ? '' : 'text-danger'}" title="${esc(title)}"${itemId ? ` data-tip-item="${esc(itemId)}"` : ` data-tip-media="${esc(media)}"`}><img class="mr-1" src="${media}" alt="${esc(title)}">${qty(need)}${itemId ? ` ${esc(title)}` : ''}` + // the item named, not tooltip-only (.309, scan C-10)
    ` <span class="${have >= need ? 'text-muted' : ''} ml-1">(${t('MOD_VOY_PAGE_HAVE', { count: qty(have) })})</span></span>`;
  /** A grey section band inside a block. */
  const section = (html) => `<div class="voyage-section">${html}</div>`;
  /**
   * An action block, one row (the user, build .157): the amount box and its blue presets on the left, the
   * green main button on the right. Too narrow for one line, the button drops under them and fills the line.
   */
  /** `before`: a second action ahead of the main one ({ action, label, cls }), as the hold's red Sell (build .265). */
  const actionBlock = ({ action, amount = action, itemId, max, value, presets, main, before }) =>
    '<div class="voyage-action"><div class="voyage-hold-row">' +
    `<input type="number" min="1" max="${max}" value="${value}" inputmode="numeric" class="form-control voyage-hold-qty" data-voyage-amount="${amount}" data-item="${esc(itemId)}" aria-label="${esc(t('MOD_VOY_PAGE_AMOUNT'))}">` +
    `<div class="voyage-hold-presets">${presets.filter((p) => p.n > 0).map((p) => `<button type="button" class="btn btn-sm btn-info" data-voyage-preset="${p.n}">${esc(p.label)}</button>`).join('')}</div>` +
    (before === undefined
      ? `<button type="button" class="btn btn-success voyage-hold-go" data-voyage-action="${action}">${esc(main)}</button>`
      : `<div class="voyage-hold-gos"><button type="button" class="btn ${before.cls} voyage-hold-before" data-voyage-action="${before.action}">${esc(before.label)}</button>` +
        `<button type="button" class="btn btn-success voyage-hold-go" data-voyage-action="${action}">${esc(main)}</button></div>`) +
    '</div></div>';
  /** Item chips (bank-style), the picked one filled blue; the name is in a line under them for touch. */
  const chips = (items, pickedId, action, title) =>
    `<div class="voyage-store-items">${items.map((x) => `<button type="button" class="btn btn-sm voyage-store-item ${x.item.id === pickedId ? 'btn-info' : 'btn-outline-info'}" ` +
      `data-voyage-action="${action}" data-item="${esc(x.item.id)}" data-tip-item="${esc(x.item.id)}" title="${esc(title(x))}" aria-label="${esc(title(x))}" aria-pressed="${x.item.id === pickedId}">` +
      `<img src="${x.item.media}" alt=""><small>${numberWithCommas(x.qty)}</small></button>`).join('')}</div>`;

  const shipHtml = () => {
    const api = state.ship;
    const ship = api?.boat();
    if (api === undefined || ship === undefined) return `<div class="text-warning">${t('MOD_VOY_PAGE_NO_SHIP')}</div>`;
    const icon = (hull) => `<img class="voyage-hull-icon mr-2" src="${ctx.getResourceUrl(hull.media)}" alt="">`;
    if (ship === null) {
      const hull = shipModel.HULLS.dinghy;
      const b = shipModel.dinghyBuild(api.canFish?.() !== false);
      const costs = [costIcon(game.gp.media, b.gp, game.gp.amount, game.gp.name)];
      for (const { id, quantity } of b.items) {
        const item = game.items.getObjectByID(id);
        if (item !== undefined) costs.push(costIcon(item.media, quantity, game.bank.getQty(item), item.name, item.id));
      }
      const why = api.buildBlocker();
      // No dead disabled button: the reason stands where the button would be.
      return section(`<div class="d-flex align-items-center">${icon(hull)}<div><div>${t('MOD_VOY_PAGE_NO_SHIP_YET')}</div>` +
          `<small class="text-muted">${esc(t(shipModel.hullBlurbKey(hull.id)))}</small></div></div>`) +
        section(`<div class="voyage-big-head mt-0">${t('MOD_VOY_PAGE_BUILD_COST')}</div><div class="d-flex flex-wrap align-items-center">${costs.join('')}</div>` + // one sub-heading look (.309, scan A-19)
          (why
            ? `<div class="text-warning mt-2">${esc(why)}</div>`
            : `<div class="voyage-hold-main"><button type="button" class="btn btn-success" data-voyage-action="build">${t('MOD_VOY_PAGE_BUILD_BUTTON')}</button></div>` +
              `<small class="d-block text-center text-muted mt-1">${t('MOD_VOY_PAGE_BUILD_HINT')}${api.canFish?.() !== false ? ` ${t('MOD_VOY_PAGE_BUILD_HINT_HAT')}` : ''}</small>`));
    }
    // The hull's wear is in Stores (build .205: what a sail costs); what you can buy is in the Shipwright row.
    return vesselRow('boat') + (api.big() != null ? `<div class="voyage-big-head"><img class="voyage-hull-icon mr-2" src="${ctx.getResourceUrl(shipModel.HULLS[api.vessel('ship').hull].media)}" alt="">${esc(t('MOD_VOY_PAGE_BIG_HEAD'))}</div>${vesselRow('ship')}` : '') + shipwrightHtml();
  };
  /** The Shipwright row folds open (closed by default), per browser. */
  const SHIPWRIGHT_KEY = 'voyage-shipwright-open';
  const shipwrightOpen = (set) => {
    if (set !== undefined) { try { localStorage.setItem(SHIPWRIGHT_KEY, set ? '1' : '0'); } catch {} return set; }
    try { return localStorage.getItem(SHIPWRIGHT_KEY) === '1'; } catch { return false; }
  };
  /**
   * The Shipwright (build .205, the user: one folded row for what you buy): the next hull of each vessel, the brig
   * while you have none, and Navigator's Charts. Folded, it says how many are ready to buy now.
   */
  const shipwrightHtml = () => {
    const api = state.ship;
    const offers = [];
    const up = api.upgradeInfo?.('boat');
    if (up !== undefined) offers.push({ html: upgradeHtml('boat'), ready: up.blocker === undefined });
    if (api.big() != null) {
      const big = api.upgradeInfo?.('ship');
      if (big !== undefined) offers.push({ html: upgradeHtml('ship'), ready: big.blocker === undefined });
    } else {
      const buy = api.buyInfo?.();
      if (buy !== undefined) offers.push({ html: bigHtml(), ready: buy.blocker === undefined });
    }
    const nav = state.planner?.open?.() === true && state.planner.owned?.() !== true ? state.planner.navHtml?.() ?? '' : '';
    if (nav !== '') offers.push({ html: nav, ready: state.planner.navReady?.() === true });
    if (offers.length === 0) return '';
    const open = shipwrightOpen();
    const ready = offers.filter((o) => o.ready).length;
    const note = ready > 0
      ? `<span class="text-success">${esc(t(ready === 1 ? 'MOD_VOY_PAGE_SHIPWRIGHT_READY_ONE' : 'MOD_VOY_PAGE_SHIPWRIGHT_READY', { n: `${ready}` }))}</span>`
      : `<span class="text-muted">${esc(t(offers.length === 1 ? 'MOD_VOY_PAGE_SHIPWRIGHT_OFFER_ONE' : 'MOD_VOY_PAGE_SHIPWRIGHT_OFFER', { n: `${offers.length}` }))}</span>`;
    return `<div class="voyage-shipwright"><button type="button" class="voyage-shipwright-head" data-voyage-action="shipwright" aria-expanded="${open}">` +
      `<i class="fa ${open ? 'fa-caret-down' : 'fa-caret-right'}" aria-hidden="true"></i><b class="voyage-big-head my-0">${esc(t('MOD_VOY_PAGE_SHIPWRIGHT'))}</b>${note}</button>` +
      (open ? `<div class="voyage-shipwright-body">${offers.map((o) => o.html).join('')}</div>` : '') + '</div>';
  };
  /** A vessel's line: its name, where it is, and Find it on the map while you are not in it. */
  const vesselRow = (kind) => {
    const api = state.ship;
    const v = api.vessel(kind);
    const hull = shipModel.HULLS[v.hull];
    const where = api.inVessel() === kind ? t('MOD_VOY_PAGE_ABOARD')
      : kind === 'boat' && v.aboard === true ? t('MOD_VOY_PAGE_ON_BIG', { hull: esc(api.hullName(api.big())) })
        : t(kind === 'ship' ? 'MOD_VOY_PAGE_AT_ANCHOR' : 'MOD_VOY_PAGE_MOORED', { where: esc(api.whereIs(v)) });
    const off = !api.enabled() && kind === 'boat' ? `<div class="text-warning">${t(game.tutorial?.complete === false ? 'MOD_VOY_PAGE_TUTORIAL' : 'MOD_VOY_PAGE_RULES_OFF')}</div>` : '';
    const find = api.inVessel() === kind || (kind === 'boat' && v.aboard === true) ? ''
      : `<button type="button" class="btn btn-sm btn-outline-info" data-voyage-action="find" data-kind="${kind}">${t('MOD_VOY_PAGE_FIND_SHIP')}</button>`;
    return section(`<div class="voyage-row"><div class="d-flex align-items-center"><img class="voyage-hull-icon mr-2" src="${ctx.getResourceUrl(hull.media)}" alt="">` +
      `<div><div><b>${esc(t(shipModel.hullNameKey(hull.id)))}</b>: ${where}</div>${off}</div></div>${find}</div>`);
  };
  /**
   * The big ship (build .150): bought at a port, shown from the start with what it
   * costs and why it can't be bought yet, like the longboat; once owned, nothing here (its line is in the Ship block,
   * its hull in Stores, build .205).
   */
  const bigHtml = () => {
    const api = state.ship;
    if (api.big() != null) return '';
    const info = api.buyInfo?.();
    if (info === undefined) return '';
    const { hull, spec, blocker } = info;
    const costs = [costIcon(game.gp.media, spec.gp, game.gp.amount, game.gp.name)];
    for (const { id, quantity } of spec.items) {
      const item = game.items.getObjectByID(id);
      if (item !== undefined) costs.push(costIcon(item.media, quantity, game.bank.getQty(item), item.name, item.id));
    }
    return section(`<div class="d-flex align-items-center"><img class="voyage-hull-icon mr-2" src="${ctx.getResourceUrl(hull.media)}" alt="">` +
        `<div><div class="voyage-big-head my-0">${esc(t('MOD_VOY_PAGE_BRIG_COST'))}</div><small class="text-muted">${esc(t(shipModel.hullBlurbKey(hull.id)))}</small></div></div>` +
      `<div class="d-flex flex-wrap align-items-center mt-2">${costs.join('')}</div>` +
      (blocker !== undefined
        ? `<div class="text-warning mt-2">${esc(blocker)}</div>`
        : `<div class="voyage-hold-main"><button type="button" class="btn btn-success" data-voyage-action="buy">${esc(t('MOD_VOY_PAGE_BRIG_BUTTON'))}</button></div>` +
          `<small class="d-block text-center text-muted mt-1">${esc(t('MOD_VOY_PAGE_BRIG_HINT'))}</small>`));
  };

  /**
   * The next hull (phase 4, build .142): shown from the start with the reason it can't be built yet, so the longboat
   * is a goal before it is a button. `kind` 'ship': the brig's galleon (.152).
   */
  const upgradeHtml = (kind = 'boat') => {
    const info = state.ship?.upgradeInfo?.(kind);
    if (info === undefined) return '';
    const { hull, upgrade, blocker } = info;
    const word = t(shipModel.tierNameKey(hull.tier));
    const costs = [costIcon(game.gp.media, upgrade.gp, game.gp.amount, game.gp.name)];
    for (const { id, quantity } of upgrade.items) {
      const item = game.items.getObjectByID(id);
      if (item !== undefined) costs.push(costIcon(item.media, quantity, game.bank.getQty(item), item.name, item.id));
    }
    const old = state.ship.hullName(state.ship.vessel(kind));
    return section(`<div class="d-flex align-items-center"><img class="voyage-hull-icon mr-2" src="${ctx.getResourceUrl(hull.media)}" alt="">` +
        `<div><div class="voyage-big-head my-0">${esc(t('MOD_VOY_PAGE_UPGRADE_COST', { hull: word }))}</div><small class="text-muted">${esc(t(shipModel.hullBlurbKey(hull.id)))}</small></div></div>` +
      `<div class="d-flex flex-wrap align-items-center mt-2">${costs.join('')}</div>` +
      (blocker !== undefined
        ? `<div class="text-warning mt-2">${esc(blocker)}</div>`
        : `<div class="voyage-hold-main"><button type="button" class="btn btn-success" data-voyage-action="upgrade" data-kind="${kind}">${esc(t('MOD_VOY_PAGE_UPGRADE_BUTTON', { hull: word }))}</button></div>` +
          `<small class="d-block text-center text-muted mt-1">${esc(t('MOD_VOY_PAGE_UPGRADE_HINT', { old }))}</small>`));
  };

  /**
   * The hold's slots as crates (build .133, the user: "sockets waiting for cargo"): one recessed cell per slot with a
   * crate drawn side-on, an empty one waiting, a stowed item sitting inside its crate with its count. A filled crate
   * picks the item, as the chips did.
   */
  const CRATE_SVG = '<svg class="voyage-crate-art" viewBox="0 0 48 40" aria-hidden="true" fill="none" stroke="currentColor" stroke-linejoin="round">'
    + '<rect x="2.5" y="4.5" width="43" height="33" rx="2" stroke-width="2.2"/>'
    + '<path d="M8.5 5v32M39.5 5v32" stroke-width="2"/>'
    + '<path d="M8.5 15.5h31M8.5 26.5h31" stroke-width="1.2" opacity=".7"/>'
    + '<path d="M9.5 36 38.5 6" stroke-width="2"/>'
    + '<circle cx="5.5" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="42.5" cy="8" r=".9" fill="currentColor" stroke="none"/>'
    + '<circle cx="5.5" cy="34" r=".9" fill="currentColor" stroke="none"/><circle cx="42.5" cy="34" r=".9" fill="currentColor" stroke="none"/></svg>';
  const holdOpen = {};
  const crates = (items, slots, pickedId, kind) => {
    const cells = [];
    // Used crates, the rest of their row, and at most one row of empties; the other empty slots fold behind a line,
    // so an empty galleon's hold is one row, not six (.309, scan A-16/A2-15).
    const PER_ROW = 6;
    const empty = Math.max(0, slots - items.length);
    const fill = (PER_ROW - items.length % PER_ROW) % PER_ROW;
    const open = holdOpen[kind] === true;
    const shown = open ? empty : Math.min(empty, fill === 0 ? PER_ROW : fill);
    const hidden = empty - shown;
    for (let i = 0; i < items.length + shown; i++) {
      const x = items[i];
      if (x === undefined) { cells.push(`<div class="voyage-crate" role="img" aria-label="${esc(t('MOD_VOY_HOLD_CRATE_EMPTY'))}">${CRATE_SVG}</div>`); continue; }
      // Packed cargo (phase 4): a sealed sack or crate with its goods on it, not picked or taken out.
      const seal = state.cargo?.sealOf(x.entry);
      if (seal !== undefined) {
        const label = t(seal.c === 'sack' ? 'MOD_VOY_HOLD_SEALED_SACK' : 'MOD_VOY_HOLD_SEALED_CRATE', { item: x.item.name, n: numberWithCommas(x.qty), port: seal.port ?? '?' });
        cells.push(`<div class="voyage-crate voyage-crate-sealed" role="img" data-tip-item="${esc(x.item.id)}" title="${esc(label)}" aria-label="${esc(label)}">${state.cargo.art(seal.c, x.item, 'voyage-cargo-art voyage-cargo-art-cell')}</div>`);
        continue;
      }
      const label = `${x.item.name}: ${numberWithCommas(x.qty)}`;
      cells.push(`<button type="button" class="voyage-crate voyage-crate-full${x.item.id === pickedId ? ' voyage-crate-picked' : ''}" data-voyage-action="hold-pick" data-item="${esc(x.item.id)}" data-tip-item="${esc(x.item.id)}" title="${esc(label)}" aria-label="${esc(label)}" aria-pressed="${x.item.id === pickedId}">`
        + `${CRATE_SVG}<img src="${x.item.media}" alt=""><span class="voyage-crate-qty">${numberWithCommas(x.qty)}</span></button>`);
    }
    const fold = hidden > 0
      ? `<button type="button" class="voyage-hold-fold" data-voyage-action="hold-fold" data-kind="${kind}" aria-expanded="false"><i class="fa fa-caret-right mr-1" aria-hidden="true"></i>${esc(t('MOD_VOY_HOLD_MORE_SLOTS', { n: `${hidden}` }))}</button>`
      : open && empty > PER_ROW ? `<button type="button" class="voyage-hold-fold" data-voyage-action="hold-fold" data-kind="${kind}" aria-expanded="true"><i class="fa fa-caret-down mr-1" aria-hidden="true"></i>${esc(t('MOD_VOY_HOLD_FOLD_SLOTS'))}</button>` : '';
    return `<div class="voyage-crates">${cells.join('')}</div>${fold}`;
  };

  /**
   * The hold (build .72; its own block since build .86): what it carries, and taking things back to the bank. One per
   * vessel (build .150): `kind` 'boat' or 'ship'.
   */
  const holdPicked = {};
  const holdHtml = (kind) => {
    const h = state.hold;
    if (h === undefined) return '';
    const all = h.contents(kind);
    const why = h.blocker(kind);
    // Packed cargo sits in the grid but is never picked: it leaves the hold only where it is going.
    const items = all.filter((x) => x.entry?.cargo === undefined);
    const sealed = items.length < all.length ? `<div class="mt-2">${esc(t('MOD_VOY_HOLD_SEALED_NOTE'))}</div>` : '';
    if (items.length === 0) return crates(all, h.slots(kind), undefined, kind) + (sealed || `<div class="voyage-section voyage-empty text-muted mt-2">${t('MOD_VOY_HOLD_EMPTY')}</div>`); // the one empty-state form: a band, centred, muted (.309, scan A-21)
    if (!items.some((x) => x.item.id === holdPicked[kind])) holdPicked[kind] = items[0].item.id;
    const sel = items.find((x) => x.item.id === holdPicked[kind]);
    let html = crates(all, h.slots(kind), holdPicked[kind], kind) + sealed +
      `<div class="mt-2">${esc(t('MOD_VOY_PAGE_HOLD_SELECTED', { item: sel.item.name, count: numberWithCommas(sel.qty) }))}</div>`;
    if (why !== undefined) return `${html}<div class="text-warning mt-2">${esc(why)}</div>`;
    html += actionBlock({
      action: 'take', amount: `take-${kind}`, itemId: sel.item.id, max: sel.qty, value: amountFor(`take-${kind}`, sel.item.id, sel.qty, sel.qty),
      presets: [{ n: sel.qty - 1, label: t('MOD_VOY_HOLD_ALL_BUT_ONE') }, { n: sel.qty, label: t('MOD_VOY_PAGE_STORES_LOAD_ALL') }],
      main: t('MOD_VOY_HOLD_TAKE'),
      // Sell from the hold (build .265): red as the bank's Sell; where no trade is, the bank's own refusal says why.
      before: { action: 'sell', label: t('MOD_VOY_HOLD_SELL'), cls: 'btn-danger' },
    });
    return html;
  };

  /** Hull condition and repairs (phase 3d), for the vessel `kind`; in Stores since build .205. `named`: two vessels, so
   * the line says whose hull. */
  const hullHtml = (kind = 'boat', named = false) => {
    const info = state.ship?.repairInfo?.(kind);
    if (info === undefined) return '';
    const label = named ? esc(t('MOD_VOY_PAGE_HULL_OF', { hull: t(shipModel.hullNameKey(state.ship.vessel(kind).hull)) })) : t('MOD_VOY_PAGE_HULL_LABEL');
    const c = info.cond;
    const cls = c <= 0 ? 'bg-danger' : c < storesModel.WORN ? 'bg-warning' : 'bg-success';
    const pitch = game.items.getObjectByID('voyage:Pitch');
    const logs = game.items.getObjectByID('melvorD:Normal_Logs');
    // Any logs count, the cheapest first, so the tooltip names any logs, not Normal Logs; the rate is in the line under
    // the costs (the user, build .176: the tooltip only names the item).
    const costs = [costIcon(logs?.media ?? '', info.plan.full.logs, info.logs, t('MOD_VOY_PAGE_HULL_LOGS'), logs?.id)];
    if (pitch !== undefined) costs.push(costIcon(pitch.media, info.plan.full.pitch, info.pitch, pitch.name, pitch.id));
    const action = info.blocker === undefined
      ? `<div class="voyage-hold-main"><button type="button" class="btn btn-success" data-voyage-action="repair" data-kind="${kind}">${t('MOD_VOY_PAGE_HULL_REPAIR', { cond: `${info.plan.to}` })}</button></div>`
      : (c < 100 ? `<div class="text-warning mt-2">${esc(info.blocker)}</div>` : '');
    return section(`<div class="d-flex align-items-center"><img class="voyage-hull-icon mr-2" src="${ctx.getResourceUrl('assets/hull_condition.webp')}" alt="">` +
      `<div class="flex-grow-1"><div><b>${label}</b> <span class="${c <= 0 ? 'text-danger' : c < storesModel.WORN ? 'text-warning' : ''}">${c}%</span></div>` +
      `<div class="progress voyage-hull-bar"><div class="progress-bar ${cls}" style="width:${c}%"></div></div></div></div>` +
      (c < 100 ? `<div class="d-flex flex-wrap align-items-center mt-2">${costs.join('')}</div>` : '') + action);
  };

  /** The item picked in the stores block (an id), kept while the page lives. */
  let picked;
  const PLACE_KEY = { port: 'MOD_VOY_STORES_PLACE_PORT', town: 'MOD_VOY_STORES_PLACE_TOWN', market: 'MOD_VOY_STORES_PLACE_MARKET', farm: 'MOD_VOY_STORES_PLACE_FARM' };
  const pct = (x) => `${Math.round(x * 100)}%`;

  /**
   * The status row at the top of the page, under the skill header (user feedback, build .72): day or night and when it
   * turns, for now; other status items join it later. Each item is a chip; the row hides when it has none.
   */
  const statusItems = () => {
    const items = [];
    const tod = state.stores?.enabled() ? state.stores.timeOfDay?.() : undefined;
    if (tod !== undefined) {
      const now = tod.season ? t('MOD_VOY_PANEL_NIGHT_SEASON') : t(tod.night ? 'MOD_VOY_PANEL_NIGHT' : 'MOD_VOY_PANEL_DAY', { time: tod.until });
      items.push(`<span class="voyage-status-item ${tod.night ? 'text-info' : ''}"><i class="fa fa-${tod.night ? 'moon' : 'sun'} mr-1"></i>${esc(now)}</span>`);
    }
    return items;
  };
  /**
   * The season (phase 5c-1, the canvas's board 4): the year's four seasons with this one ringed and its time left, then
   * what it does in a sentence. A rare season names itself in the sentence. Nothing with the setting "Weather" off.
   */
  const seasonHtml = () => {
    const s = state.weather?.season?.();
    if (s === undefined) return '';
    const year = ['spring', 'summer', 'fall', 'winter'];
    // Build .296 (the user: "delete 'The north stays cold…', there is an entry in the Journal"): the season's sentence
    // and the calendar note moved to the band's tooltip; the time left sits on its own short line in the ringed cell
    // ("72h 0m", the compact time, builds .298 and .301, the hourglass before it), so the cell no longer wraps on a phone.
    const full = s.msLeft === undefined ? '' : (state.clock?.duration?.(s.msLeft) ?? '');
    const short = full;
    const left = short === '' ? '' : `<span class="voyage-season-left">${helpLayout.withTime('MOD_VOY_WX_PAGE_LEFT', { time: short })}</span>`;
    const icon = s.media ? `<img class="voyage-wx-icon mr-1" src="${esc(s.media)}" alt="">` : '';
    const cells = year.map((k, i) => {
      const now = s.key === k;
      return `<span class="voyage-season-cell${now ? ' voyage-season-now text-info' : ''}"><span class="voyage-season-name">${now ? icon : ''}${esc(state.weather.seasonName?.(i) ?? k)}</span>${now ? left : ''}</span>`;
    }).join('');
    // A rare season is none of the four: its name and time left on a line of their own under the year.
    const rare = year.includes(s.key) ? '' : `<div class="voyage-season-text voyage-season-mid text-info font-w600">${icon}${esc(s.name)}${short === '' ? '' : ` · ${helpLayout.withTime('MOD_VOY_WX_PAGE_LEFT', { time: short })}`}</div>`;
    const from = s.noTown ? t('MOD_VOY_WX_NO_TOWN') : t('MOD_VOY_WX_PAGE_FROM_TOWN');
    const tip = `${t(`MOD_VOY_WX_PAGE_${s.key.toUpperCase()}`)} ${from}`;
    // The wind (phase 5c-2): where it blows from and when it turns, with Timed travel on; centred under the year (.296).
    const w = state.weather?.wind?.();
    const wind = w === undefined ? '' : `<div class="voyage-season-text voyage-season-mid" title="${esc(t('MOD_VOY_WX_WIND_HINT_SHORT'))}"><i class="fa fa-long-arrow-alt-up voyage-wind-arrow mr-2" style="transform:rotate(${w.toward * 60}deg)" aria-hidden="true"></i>`
      + `${esc(t('MOD_VOY_WX_WIND_FROM', { side: w.word }))} · <span class="text-muted voyage-keep">${helpLayout.withTime('MOD_VOY_WX_WIND_TURNS', { time: state.clock?.duration?.(w.msLeft) ?? '' })}</span></div>`;
    return `<div class="voyage-season"><div class="voyage-season-year" title="${esc(tip)}">${cells}</div>${rare}${wind}</div>`;
  };
  /**
   * The Travels stats (build .146): read from what the save and the map already keep, so
   * nothing new is saved. A row whose source is missing is left out.
   */
  const travelStats = (rec) => {
    const j = rec.journal ?? {};
    const rows = [];
    // Build .155 (the user: "coloring, bolding, icons"): an icon per row, the value bold, a thin bar under an "n of all".
    const img = (src) => `<img class="voyage-stat-icon" src="${src}" alt="">`;
    const fa = (cls) => `<i class="fa ${cls} voyage-stat-icon voyage-stat-fa" aria-hidden="true"></i>`;
    const row = (icon, key, value, cls = '', share) => rows.push(`<div class="voyage-stat"><span class="voyage-stat-label">${icon}${esc(t(key))}</span><span class="font-w600 ${cls}">${value}</span>` +
      (share === undefined ? '' : `<span class="voyage-stat-bar ${cls}" aria-hidden="true"><span style="width:${Math.round(Math.min(1, share) * 100)}%"></span></span>`) + '</div>');
    const of = (n, all) => `${numberWithCommas(n)} <small class="text-muted font-w400">${esc(t('MOD_VOY_PAGE_STAT_OF_ALL', { all: numberWithCommas(all) }))}</small>`;
    // The balance pass: hexes ever entered (each paid discovery XP once) and the level's travel cut.
    try {
      const open = [...(state.terrain?.all() ?? [])].filter((h) => h.cloud !== true).length;
      const seen = model.visitedCount(rec.visited);
      if (open > 0) row(img(game.cartography.media), 'MOD_VOY_PAGE_STAT_VISITED', of(seen, open), 'voyage-stat-sea', seen / open);
    } catch {}
    try {
      const map = game.cartography.activeMap;
      const all = map?.pointsOfInterest?.size;
      const found = map === undefined ? 0 : [...map.discoveredPOIs].length;
      if (map !== undefined && all > 0) row(fa('fa-landmark'), 'MOD_VOY_PAGE_STAT_DISCOVERIES', of(found, all), 'voyage-stat-gold', found / all);
    } catch {}
    row(img(ctx.getResourceUrl('assets/chart_mining.webp')), 'MOD_VOY_PAGE_STAT_CHARTS', numberWithCommas((j.charted ?? []).length));
    const cut = model.travelDiscount(skill()?.level ?? 1);
    if (cut > 0) { try { row(img(game.gp.media), 'MOD_VOY_PAGE_STAT_DISCOUNT', t('MOD_VOY_PAGE_STAT_DISCOUNT_VALUE', { pct: `${cut}` }), 'text-success'); } catch {} }
    return `<div class="voyage-stats">${rows.join('')}</div>`;
  };
  /** The Travels head: the hexes behind you, large, with on foot and under sail as two coloured chips. */
  const travelHead = (rec) => {
    const total = rec.landHexes + rec.waterHexes;
    return `<div class="voyage-travel-head"><span class="voyage-travel-total">${numberWithCommas(total)}</span><span class="voyage-travel-label">${esc(t('MOD_VOY_PAGE_HEXES_BEHIND'))}</span></div>` +
      `<div class="voyage-travel-split">` +
      `<span class="voyage-travel-chip voyage-travel-foot"><i class="fa fa-shoe-prints mr-1" aria-hidden="true"></i>${esc(t('MOD_VOY_PAGE_HEXES_ON_FOOT', { n: numberWithCommas(rec.landHexes) }))}</span>` +
      `<span class="voyage-travel-chip voyage-travel-sail"><i class="fa fa-ship mr-1" aria-hidden="true"></i>${esc(t('MOD_VOY_PAGE_HEXES_UNDER_SAIL', { n: numberWithCommas(rec.waterHexes) }))}</span></div>`;
  };
  /**
   * The Crossroads Sign's square (build .162): one of not bought, carried or planted. Build .165 (the user): only the
   * portrait and the name show. Build .167 (the user): the portrait's tooltip says only "In the shop from level 35",
   * "Look for a special place..." while carried, or the place and its coords with its buffs under, one per line.
   */
  const signTile = (L) => {
    const face = (lines) => `<div class="voyage-land-face" data-tip-lines="${esc(JSON.stringify(lines))}"><div class="voyage-land-ring voyage-sign-ring"><img src="${L.signMedia()}" alt=""></div>` +
      `<div class="voyage-land-name">${esc(L.signName())}</div></div>`;
    const plain = (lines) => lines.map((l) => (typeof l === 'string' ? l : l.text)).join('. ');
    if (!L.signOwned()) {
      const lines = [t('MOD_VOY_PAGE_SIGN_IN_SHOP', { level: `${state.landModel?.SIGN.level ?? 35}` })];
      return `<button type="button" class="voyage-land-body voyage-land-btn voyage-sign-off" data-voyage-land="shop" aria-label="${esc(`${L.signName()}. ${plain(lines)}. ${t('MOD_VOY_PAGE_SIGN_SHOP')}`)}">${face(lines)}</button>`;
    }
    const poi = L.signPoi();
    if (poi === undefined) {
      const lines = [t('MOD_VOY_PAGE_SIGN_LOOK')];
      // No Plant here on the page (the user, build .169): the Here panel has it on a place with buffs.
      return `<div class="voyage-land-body" role="group" aria-label="${esc(`${L.signName()}. ${plain(lines)}`)}">${face(lines)}</div>`;
    }
    // The game's display coords, as the hex tooltip and the Here panel show them, centred (the user, build .168); the
    // buffs under it in the game's colours.
    const at = (() => { try { const o = poi.hex.to_oddq(); return `(${o.col}, ${o.row})`; } catch { return `(${poi.hex.q}, ${poi.hex.r})`; } })();
    const lines = [{ text: `${poi.name} ${at}`, cls: 'text-center' }, ...L.signBuffSpans().map((b) => ({ text: b.textContent, cls: b.className || 'text-success' }))];
    // No Pick up here (the user, build .166): it is picked up from the Here panel on its hex.
    return `<div class="voyage-land-body" role="group" aria-label="${esc(`${L.signName()}. ${plain(lines)}`)}">` +
      `<button type="button" class="btn btn-sm voyage-sign-locate" data-voyage-land="locate" title="${esc(t('MOD_VOY_PAGE_SIGN_LOCATE'))}" aria-label="${esc(t('MOD_VOY_PAGE_SIGN_LOCATE'))}"><i class="fa fa-map-marker-alt"></i></button>` +
      `${face(lines)}</div>`;
  };
  /** Rounded percentage of a cut: 0.245 -> 24.5. */
  const cutOf = (factor) => Math.round((1 - factor) * 1000) / 10;
  const clock = (h) => `${String(h).padStart(2, '0')}:00`;

  /**
   * The rules behind each block (user feedback, build .68: the page had too much text). Shown in a popup from the
   * block title's "?", which opens them as the Captain's Journal's "How it works" chapters (src/journal.mjs, phase 4); the
   * popup stays for a build where the journal failed to load.
   *
   * Help layout (build .87 user feedback): one grey band per idea, each with a short heading;
   * one sentence per paragraph; numbers in tables, not in sentences; the player's own skill bonuses together in a
   * "Your skills" band with the skill icon and the bonus in green. A section is { head?, warn?, body: [...] }; a body
   * item is a paragraph string, { text, cls } for a coloured one, or { table: { cols, rows } }, where a row is
   * { cells: [label, ...values], cls?: [per-value class], icon? }.
   */
  const skillName = (id, fallback) => { try { return game.skills.getObjectByID(id)?.name ?? fallback; } catch { return fallback; } };
  const terrainList = (classes) => classes.map((c) => t(`MOD_VOY_TERRAIN_${c}`)).join(', ');

  /** Terrains grouped by what a hex costs, land first (cheapest first), then the sea. */
  const costRows = () => {
    const groups = new Map();
    for (const [cls, c] of Object.entries(storesModel.HEX_COST)) {
      const key = `${c.rations}|${c.fuel}`;
      if (!groups.has(key)) groups.set(key, { ...c, classes: [] });
      groups.get(key).classes.push(cls);
    }
    const sea = (g) => g.classes.every((c) => c === 'water' || c === 'shoal');
    return [...groups.values()]
      .sort((a, b) => (sea(a) - sea(b)) || (a.fuel - b.fuel) || (a.rations - b.rations))
      .map((g) => {
        const heavy = g.rations > 1 || g.fuel > 1;
        return {
          cells: [sea(g) ? t('MOD_VOY_HELP_AT_SEA') : terrainList(g.classes), t('MOD_VOY_UNIT_HP', { n: qty(g.rations * storesModel.RATION_HP) }), g.fuel > 0 ? `${g.fuel}` : t('MOD_VOY_HELP_NONE')],
          cls: heavy ? ['text-warning', 'text-warning'] : ['', ''],
        };
      });
  };
  const HELP_PLACE_KEY = { port: 'MOD_VOY_HELP_PLACE_PORT', town: 'MOD_VOY_HELP_PLACE_TOWN', market: 'MOD_VOY_HELP_PLACE_MARKET', farm: 'MOD_VOY_HELP_PLACE_FARM' };
  const loadRows = () => [
    ...storesModel.LOAD_PLACES.map((p) => ({
      cells: [t(HELP_PLACE_KEY[p.id] ?? 'MOD_VOY_HELP_PLACE_FARM'), pct(p.food), pct(p.fuel)],
      cls: [p.food >= 1 ? 'text-success' : '', p.fuel >= 1 ? 'text-success' : ''],
    })),
    { cells: [t('MOD_VOY_HELP_PLACE_WILD'), t('MOD_VOY_HELP_NONE'), t('MOD_VOY_HELP_NONE')], cls: ['text-danger', 'text-danger'] },
  ];
  // The skill's icon comes from the popup's skill-name pass, so the row carries only the name.
  const skillRow = (id, fallback, level, text) => ({
    cells: [t('MOD_VOY_HELP_SKILL_LEVEL', { skill: skillName(id, fallback), level: `${level}` }), text],
    cls: ['text-success'],
  });

  const helpSections = (topic) => {
    const R = shipModel.REPAIR;
    const st = state.stores;
    const xpCols = [t('MOD_VOY_HELP_COL_HEX'), t('MOD_VOY_HELP_COL_XP')];
    if (topic === 'ship') {
      const s = state.ship?.boat();
      const hull = shipModel.HULLS[s?.hull ?? 'dinghy'];
      return [
        { body: [t(shipModel.hullBlurbKey(hull.id))] },
        { head: t('MOD_VOY_HELP_HEAD_WEAR'), body: [
          { table: { cols: [t('MOD_VOY_HELP_COL_HEX'), t('MOD_VOY_HELP_COL_WEAR')], rows: [
            { cells: [t('MOD_VOY_HELP_SEA_HEX'), `${storesModel.WEAR.near}%`] },
            { cells: [t('MOD_VOY_HELP_DEEP_HEX'), `${storesModel.WEAR.deep}%`], cls: ['text-warning'] },
          ] } },
          { text: t('MOD_VOY_HELP_WORN', { worn: `${storesModel.WORN}` }), cls: 'text-warning' },
          { text: t('MOD_VOY_HELP_WORN_THROUGH'), cls: 'text-danger' },
        ] },
        { head: t('MOD_VOY_HELP_HEAD_REPAIR'), body: [
          t('MOD_VOY_HELP_REPAIR', { step: `${R.step}`, logs: `${R.logs}`, pitch: `${R.pitch}` }),
          t('MOD_VOY_HELP_REPAIR_LOGS'),
          t('MOD_VOY_HELP_PITCH', { chance: `${shipModel.pitchChance(1)}` }),
        ] },
      ];
    }
    if (topic === 'hold') {
      return [
        { head: t('MOD_VOY_HELP_HEAD_SLOTS'), body: [
          t('MOD_VOY_HELP_HOLD_SLOTS'),
          { table: { cols: [t('MOD_VOY_HELP_COL_SHIP'), t('MOD_VOY_HELP_COL_SLOTS')], rows: [
            ...Object.entries(shipModel.HOLD_SLOTS).map(([id, n]) => ({ cells: [t(shipModel.hullNameKey(id)), `${n}`] })),
            // Build .134: a row of six crates at each of HOLD_ROW_LEVELS.
            ...shipModel.HOLD_ROW_LEVELS.map((level) => ({ cells: [t('MOD_VOY_HELP_HOLD_AT_LEVEL', { level: `${level}` }), `+${shipModel.HOLD_ROW}`], cls: ['text-success'] })),
          ] } },
        ] },
        { head: t('MOD_VOY_HELP_HEAD_STOW'), body: [t('MOD_VOY_HELP_HOLD_WHERE'), t('MOD_VOY_HELP_HOLD_SELL')] },
        { head: t('MOD_VOY_HELP_HEAD_CARGO'), body: [t('MOD_VOY_HELP_HOLD_CARGO')] },
        { head: t('MOD_VOY_HELP_HEAD_REMOVING'), warn: true, body: [{ text: t('MOD_VOY_HELP_HOLD_SAVE'), cls: 'text-warning' }] },
      ];
    }
    if (topic === 'stores') {
      const out = [{ head: t('MOD_VOY_HELP_HEAD_COSTS'), body: [
        { table: { cols: [t('MOD_VOY_HELP_COL_TERRAIN'), t('MOD_VOY_HELP_COL_FOOD'), t('MOD_VOY_HELP_COL_FUEL')], rows: costRows() } },
        t('MOD_VOY_HELP_FUEL_WHY'),
      ] }];
      if (st !== undefined) {
        const cap = st.capacity();
        out.push({ head: t('MOD_VOY_HELP_HEAD_ROOM'), body: [
          { table: { cols: [t('MOD_VOY_HELP_COL_STORE'), t('MOD_VOY_HELP_COL_ROOM')], rows: [
            { cells: [t('MOD_VOY_HELP_COL_FOOD'), t('MOD_VOY_UNIT_HP', { n: st.hp(cap.food) })] },
            { cells: [t('MOD_VOY_HELP_COL_FUEL'), st.fuelText(cap.fuel)] },
          ] } },
          t('MOD_VOY_HELP_ROOM_LEVEL', { level: `${skill()?.level ?? 1}`, food: `${storesModel.CAPACITY.foodPerLevel}`, fuel: `${storesModel.CAPACITY.fuelPerLevel}` }),
        ] });
      }
      out.push({ head: t('MOD_VOY_HELP_HEAD_LOADING'), body: [
        t('MOD_VOY_HELP_LOAD_WHERE'),
        { table: { cols: [t('MOD_VOY_HELP_COL_PLACE'), t('MOD_VOY_HELP_COL_FOOD'), t('MOD_VOY_HELP_COL_FUEL')], rows: loadRows() } },
      ] });
      const night = st?.timeOfDay?.() !== undefined;
      if (!night) out.push({ head: t('MOD_VOY_HELP_HEAD_NIGHT'), body: [t('MOD_VOY_PAGE_NIGHT_OFF')] });
      else {
        const hours = storesModel.nightHours(st.shift());
        out.push({ head: t('MOD_VOY_HELP_HEAD_NIGHT'), body: [
          t('MOD_VOY_HELP_NIGHT_HOURS', { start: clock(hours.start), end: clock(hours.end) }),
          t('MOD_VOY_HELP_NIGHT_LIGHT'),
          { table: { cols: [t('MOD_VOY_HELP_COL_HEX'), t('MOD_VOY_HELP_COL_LIGHT')], rows: [
            { cells: [t('MOD_VOY_HELP_LAND_HEX'), `${storesModel.LIGHT.land}`] },
            { cells: [t('MOD_VOY_HELP_SEA_HEX'), `${storesModel.LIGHT.sea}`] },
          ] } },
          { text: t('MOD_VOY_HELP_NIGHT_XP', { bonus: `${Math.round(model.STAR_XP * 100)}` }), cls: 'text-success' },
          t('MOD_VOY_HELP_NIGHT_STARS'),
        ] });
      }
      if (st !== undefined) {
        const rows = [skillRow('melvorD:Firemaking', 'Firemaking', st.fmLevel(), t('MOD_VOY_HELP_BUFF_FUEL', { cut: `${cutOf(storesModel.fuelFactor(st.fmLevel()))}` }))];
        if (night) rows.push(skillRow('melvorD:Astrology', 'Astrology', st.astroLevel(), t('MOD_VOY_HELP_BUFF_LIGHT', { cut: `${cutOf(storesModel.lightFactor(st.astroLevel()))}` })));
        out.push({ head: t('MOD_VOY_HELP_HEAD_SKILLS'), body: [
          { table: { cols: [t('MOD_VOY_HELP_COL_SKILL'), t('MOD_VOY_HELP_COL_BONUS')], rows } },
          t('MOD_VOY_HELP_SKILLS_PER_LEVEL', { cut: `${Math.round(storesModel.FIREMAKING_CUT * 1000) / 10}` }),
        ] });
      }
      return out;
    }
    if (topic === 'travels') {
      return [
        { head: t('MOD_VOY_HELP_HEAD_XP'), body: [
          { table: { cols: xpCols, rows: [
            { cells: [t('MOD_VOY_HELP_LAND_HEX'), `${model.XP_PER_HEX.land}`] },
            { cells: [t('MOD_VOY_HELP_WATER_HEX'), `${model.XP_PER_HEX.water}`] },
            { cells: [t('MOD_VOY_HELP_LIT_HEX'), `+${Math.round(model.STAR_XP * 100)}%`], cls: ['text-success'] },
            { cells: [t('MOD_VOY_HELP_FIRST_HEX'), `+${model.DISCOVERY_XP}`], cls: ['text-success'] },
          ] } },
          t('MOD_VOY_HELP_XP_FAST_TRAVEL'),
        ] },
        { head: t('MOD_VOY_HELP_HEAD_DISCOUNT'), body: [
          t('MOD_VOY_HELP_DISCOUNT', { per: `${model.TRAVEL_DISCOUNT_PER_LEVEL}`, pct: `${model.travelDiscount(skill()?.level ?? 1)}`, max: `${model.travelDiscount(99)}` }),
        ] },
        { head: t('MOD_VOY_HELP_HEAD_NO_XP'), body: [
          { text: t('MOD_VOY_HELP_NO_XP_HUNGRY'), cls: 'text-warning' },
          { text: t('MOD_VOY_HELP_NO_XP_REACH'), cls: 'text-warning' },
        ] },
      ];
    }
    if (topic === 'compass') {
      return [
        { body: [t('MOD_VOY_HELP_COMPASS_BANK'), t('MOD_VOY_HELP_COMPASS_POINTS')] },
        { head: t('MOD_VOY_HELP_HEAD_COMPASS_SEE'), body: [t('MOD_VOY_HELP_COMPASS_REFUSED'), t('MOD_VOY_HELP_COMPASS_PANEL')] },
      ];
    }
    return [];
  };

  const TITLE_KEY = { ship: 'MOD_VOY_PAGE_SHIP_TITLE', hold: 'MOD_VOY_HOLD_LABEL', stores: 'MOD_VOY_PAGE_STORES_TITLE', travels: 'MOD_VOY_PAGE_TRAVELS_TITLE', compass: 'MOD_VOY_PAGE_COMPASS_TITLE' };
  const showHelp = (topic) => {
    try {
      SwalLocale.fire({
        didRender: state.popupDidRender,
        title: t(TITLE_KEY[topic]),
        html: helpHtml(helpSections(topic)),
        width: HELP_WIDTH,
        confirmButtonText: t('MOD_VOY_BUTTON_GOT_IT'),
        customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass(SWAL_CLASS) : SWAL_CLASS,
      });
    } catch (e) { log('help popup failed', e); }
  };

  const storesHtml = () => {
    const api = state.stores;
    const have = api?.stores();
    loadPreview = undefined;
    if (api === undefined || have === undefined) return `<div class="text-warning">${t('MOD_VOY_PAGE_NO_SHIP')}</div>`;
    const cap = api.capacity();
    // What you carry against what fits: 600 / 620 HP, 15 / 15.5 fuel. Amber when low, red when empty.
    // Red when empty, amber when low or over the limit (.308, A-10), and the word beside the colour (B-20/B-47).
    const level = (kind) => (have[kind] <= 0 ? 'text-danger' : have[kind] < storesModel.LOW[kind] || have[kind] > cap[kind] ? 'text-warning' : '');
    const word = (kind) => (have[kind] <= 0 ? ` <small>(${esc(t('MOD_VOY_PAGE_STORES_EMPTY_WORD'))})</small>` : have[kind] < storesModel.LOW[kind] ? ` <small>(${esc(t('MOD_VOY_PAGE_STORES_LOW_WORD'))})</small>` : '');
    const of = (n) => `<small class="text-muted">/ ${n}</small>`;
    const carried = `<span class="voyage-stores-icons"><img src="${ctx.getResourceUrl('assets/ration.webp')}" alt="" title="${esc(t('MOD_VOY_HELP_COL_FOOD'))}"><span class="${level('food')}">${api.hp(have.food)}${word('food')}</span> ${of(api.hp(cap.food))} ${esc(t('MOD_VOY_UNIT_HP', { n: '' })).trim()} ` +
      `<img src="${ctx.getResourceUrl('assets/fuel.webp')}" alt="" title="${esc(t('MOD_VOY_HELP_COL_FUEL'))}"><span class="${level('fuel')}">${api.fuelText(have.fuel)}${word('fuel')}</span> ${of(api.fuelText(cap.fuel))} ${esc(t('MOD_VOY_PAGE_STORES_FUEL_WORD'))}</span>`;
    let html = section(`<div class="d-flex align-items-center"><img class="voyage-hull-icon mr-2" src="${ctx.getResourceUrl('assets/ship_stores.webp')}" alt=""><b>${carried}</b></div>` +
      (api.enabled() ? '' : `<div class="text-warning">${t(game.tutorial?.complete === false ? 'MOD_VOY_PAGE_TUTORIAL' : 'MOD_VOY_PAGE_STORES_OFF')}</div>`)); // (.308, C-01)
    // What a sail costs (build .205, the user): food, fuel and the hull's wear, in one block.
    const big = state.ship?.big?.() != null;
    html += hullHtml('boat', big) + (big ? hullHtml('ship', true) : '');
    const rates = api.loadingHere();
    if (rates === undefined) return `${html}${section(`<div class="text-warning">${t('MOD_VOY_PAGE_STORES_NO_LOADING')}</div>`)}`;
    let load = `<div>${t('MOD_VOY_PAGE_STORES_LOADING', { place: esc(t(PLACE_KEY[rates.place])), food: pct(rates.food), fuel: pct(rates.fuel) })}</div>`;
    const items = api.loadable().filter((x) => rates[x.kind] > 0);
    const unit = (x) => `${x.item.name}, ${x.kind === 'food' ? t('MOD_VOY_PAGE_STORES_UNIT_FOOD', { hp: `${x.unit}` }) : t('MOD_VOY_PAGE_STORES_UNIT_FUEL', { fuel: `${x.unit}` })}`;
    if (items.length > 0 && !items.some((x) => x.item.id === picked)) picked = items[0].item.id;
    // Two wells, food | fuel, four chip rows tall, scrolling past that (build .149, the user; DESIGN "The Stores
    // picker"). An empty well says why in its middle.
    const well = (kind) => {
      const mine = items.filter((x) => x.kind === kind);
      const why = rates[kind] <= 0 ? 'MOD_VOY_PAGE_STORES_NOT_HERE' : kind === 'food' ? 'MOD_VOY_PAGE_STORES_NO_FOOD' : 'MOD_VOY_PAGE_STORES_NO_FUEL';
      const icon = `<img class="voyage-store-col-icon" src="${ctx.getResourceUrl(kind === 'food' ? 'assets/ration.webp' : 'assets/fuel.webp')}" alt="">`;
      return `<div class="voyage-store-col"><div class="voyage-store-col-head">${icon}${esc(t(kind === 'food' ? 'MOD_VOY_PAGE_STORES_FOOD' : 'MOD_VOY_PAGE_STORES_FUEL'))}</div>` +
        (mine.length === 0
          ? `<div class="voyage-store-well voyage-store-well-empty"><span>${esc(t(why))}</span></div>`
          : `<div class="voyage-store-well">${chips(mine, picked, 'pick', unit)}</div>`) + '</div>';
    };
    load += `<div class="voyage-store-cols mt-2">${well('food')}${well('fuel')}</div>`;
    if (items.length === 0) return html + section(load);
    const sel = items.find((x) => x.item.id === picked);
    const rate = rates[sel.kind];
    // The limit (build .66): no more items than it takes to fill the room left.
    const room = Math.max(0, cap[sel.kind] - have[sel.kind]);
    const most = storesModel.loadCount(sel.unit, rate, sel.qty, room);
    load += `<div class="mt-2">${esc(t('MOD_VOY_PAGE_SELECTED', { item: unit(sel), count: numberWithCommas(sel.qty) }))}</div>`;
    if (most <= 0) return html + section(`${load}<div class="mt-2 text-warning">${t(sel.kind === 'food' ? 'MOD_VOY_PAGE_STORES_FULL_FOOD' : 'MOD_VOY_PAGE_STORES_FULL_FUEL')}</div>`);
    loadPreview = (n) => {
      const v = Math.min(room, storesModel.loadAmount(sel.unit, Math.min(n, most), rate));
      return `+${sel.kind === 'food' ? t('MOD_VOY_UNIT_HP', { n: api.hp(v) }) : t('MOD_VOY_UNIT_FUEL', { n: api.fuelText(storesModel.roundFuel(v)) })}`; // units on both (.308, A-11/A2-18)
    };
    const value = amountFor('load', sel.item.id, most, most);
    load += actionBlock({
      action: 'load', itemId: sel.item.id, max: most, value,
      presets: [10, 100].filter((n) => n < most).map((n) => ({ n, label: numberWithCommas(n) }))
        .concat([{ n: most, label: t(most < sel.qty ? 'MOD_VOY_PAGE_STORES_LOAD_FILL' : 'MOD_VOY_PAGE_STORES_LOAD_ALL') }]),
      main: `${t('MOD_VOY_PAGE_STORES_LOAD')} (${loadPreview(value)})`,
    });
    return html + section(load);
  };

  /** True while you type in one of this part's amount boxes: its redraw waits for the box to lose focus. */
  let deferred = false;
  const typing = (el) => {
    const a = document.activeElement;
    if (el === null || !(a instanceof HTMLInputElement) || !el.contains(a)) return false;
    deferred = true;
    return true;
  };

  /**
   * The runs you carry (phase 4 canvas; their own Errands block until build .205, the user: "into Hold"): under the
   * holds, each with where to go next, the runs with nothing aboard yet too. Shown while you hold a run.
   */
  const errandsHtml = () => {
    if (state.cargo?.has() !== true) return '';
    let body = '';
    try { body = state.cargo.errandsHtml(); } catch (e) { log('errands render failed', e); }
    return `<div class="voyage-hold-errands"><div class="voyage-hold-part-head"><span>${esc(t('MOD_VOY_CARGO_ERRANDS'))}` +
      `<button type="button" class="btn btn-sm voyage-help" data-errands-help="1" aria-label="${esc(t('MOD_VOY_HELP_BUTTON'))}"><i class="fa fa-question-circle"></i></button></span>` +
      `<span>${esc(t('MOD_VOY_CARGO_RUNS_COUNT', { n: `${state.cargo.count()}`, max: `${state.cargo.max}` }))}</span></div>${body}</div>`;
  };

  /** Where the keyboard focus is inside the page, as a selector and index, so a redraw can put it back (.308, scan C-26). */
  const focusKey = () => {
    const el = document.activeElement;
    const root = document.getElementById(CONTAINER_ID);
    if (!(el instanceof Element) || root === null || !root.contains(el)) return undefined;
    const sel = `${el.tagName.toLowerCase()}${[...el.classList].map((c) => `.${CSS.escape(c)}`).join('')}`;
    return { el, sel, idx: [...root.querySelectorAll(sel)].indexOf(el) };
  };
  const refocus = (k) => {
    if (k === undefined || k.el.isConnected) return;
    try { document.getElementById(CONTAINER_ID)?.querySelectorAll(k.sel)[k.idx]?.focus({ preventScroll: true }); } catch {}
  };
  const render = () => {
    const s = skill();
    if (s === undefined || document.getElementById(CONTAINER_ID) === null) return;
    const focused = focusKey();
    const level = s.level;
    const rec = s.record;

    const status = part('status');
    if (status !== null) {
      const items = statusItems();
      status.innerHTML = items.join('');
      status.classList.toggle('d-none', items.length === 0);
    }
    const planBlock = part('plan-block');
    // From Voyage level PLAN_LEVEL (build .133): before it the block is not there.
    const planOpen = state.planner?.open?.() === true;
    planBlock?.classList.toggle('d-none', !planOpen);
    const plan = part('plan');
    if (plan !== null && planOpen) {
      try { plan.innerHTML = state.planner.html(); } catch (e) { log('planner render failed', e); }
    }
    const ship = part('ship');
    if (ship !== null && !typing(ship)) ship.innerHTML = shipHtml();
    const holdBlock = part('hold-block');
    const holdKinds = state.hold?.kinds?.() ?? [];
    const hasShip = holdKinds.length > 0;
    holdBlock?.classList.toggle('d-none', !hasShip && state.cargo?.has() !== true);
    if (hasShip || state.cargo?.has() === true) {
      // One vessel: its count in the block's header. Two (build .150): each hold under its own heading and count.
      const slotLine = (kind) => {
        const used = state.hold.hold(kind).length;
        const max = state.hold.slots(kind);
        return { text: t('MOD_VOY_HOLD_SLOTS', { used: `${used}`, slots: `${max}` }), full: used >= max };
      };
      const slotsEl = part('hold-slots');
      if (slotsEl !== null) {
        const one = holdKinds.length === 1 ? slotLine(holdKinds[0]) : undefined;
        slotsEl.textContent = one?.text ?? '';
        slotsEl.className = `font-w600 ${one?.full ? 'text-warning' : ''}`;
        slotsEl.title = one?.full ? t('MOD_VOY_HOLD_FULL_PAGE') : '';
      }
      const hold = part('hold');
      if (hold !== null && !typing(hold)) {
        hold.innerHTML = (holdKinds.length === 1
          ? `<div data-hold-kind="${holdKinds[0]}">${holdHtml(holdKinds[0])}</div>`
          : holdKinds.map((kind) => {
            const line = slotLine(kind);
            const v = state.ship.vessel(kind);
            return `<div class="voyage-hold-part" data-hold-kind="${kind}"><div class="voyage-hold-part-head"><span><img class="voyage-hold-part-icon mr-1" src="${ctx.getResourceUrl(shipModel.HULLS[v.hull].media)}" alt="">${esc(t(shipModel.hullNameKey(v.hull)))}</span>` +
              `<span class="font-w600 ${line.full ? 'text-warning' : ''}">${esc(line.text)}</span></div>${holdHtml(kind)}</div>`;
          }).join('')) + errandsHtml();
      }
    }
    const storesPart = part('stores');
    if (storesPart !== null && !typing(storesPart)) {
      // The wells scroll (build .149): a redraw keeps where each was, so picking a chip low down doesn't jump to the top.
      const scrolled = [...storesPart.querySelectorAll('.voyage-store-well')].map((w) => w.scrollTop);
      storesPart.innerHTML = storesHtml();
      storesPart.querySelectorAll('.voyage-store-well').forEach((w, i) => { if (scrolled[i]) w.scrollTop = scrolled[i]; });
    }

    const travels = part('travels');
    if (travels !== null) {
      const ticon = part('travels-icon');
      // The Travels title's icon: the biggest vessel you own (the dinghy's when you have none yet).
      try { const v = state.ship?.big?.() ?? state.ship?.boat?.(); if (ticon !== null) ticon.src = ctx.getResourceUrl(shipModel.HULLS[v?.hull ?? 'dinghy'].media); } catch {}
      travels.innerHTML =
        // One grey band, like the compass stages beside it (the user, build .146: "and grayish box").
        section(travelHead(rec) + travelStats(rec)) +
        (s.futureRaw !== undefined ? `<div class="text-warning">${t('MOD_VOY_PAGE_FUTURE_SAVE')}</div>` : '');
    }

    // The season and the wind across Compass & Travels, at its top under the clock bar (the user, build .297).
    const seasonRow = part('season');
    if (seasonRow !== null) {
      const html = seasonHtml();
      seasonRow.classList.toggle('d-none', html === '');
      seasonRow.innerHTML = html === '' ? '' : section(html);
    }

    const compass = part('compass');
    if (compass !== null) {
      const icon = part('compass-icon');
      try { const it = game.items.getObjectByID('voyage:Wayfinder_Compass'); if (icon !== null && it !== undefined) icon.src = it.media; } catch {}
      // Build .157 (the user: "icons, bolding, styling"), in the Travels look: how many readings work, large in gold;
      // chips for the bank and the next stage; a row per stage with an icon, its level on the right (green when
      // reached, muted with a lock when not).
      // Stage texts: MOD_VOY_PAGE_COMPASS_STAGE_<n>, n = 1.. in model.COMPASS_STAGES order (English kept there).
      const stageIcons = ['fa-thermometer-half', 'fa-ruler-horizontal', 'fa-map-marker-alt'];
      const reachedCount = model.COMPASS_STAGES.filter((stage) => level >= stage.level).length;
      const rows = model.COMPASS_STAGES.map((stage, i) => {
        const reached = level >= stage.level;
        const lvl = esc(t('MOD_VOY_PAGE_COMPASS_LEVEL', { level: `${stage.level}` }));
        const value = reached
          ? `<span class="font-w600 text-success text-nowrap"><i class="fa fa-check mr-1" aria-hidden="true"></i>${lvl}</span>`
          : `<span class="font-w600 text-muted text-nowrap"><i class="fa fa-lock mr-1" aria-hidden="true"></i>${lvl}</span>`;
        return `<div class="voyage-stat${reached ? '' : ' voyage-stat-locked'}"><span class="voyage-stat-label"><i class="fa ${stageIcons[i] ?? 'fa-compass'} voyage-stat-icon voyage-stat-fa" aria-hidden="true"></i>` +
          `<span>${esc(t(`MOD_VOY_PAGE_COMPASS_STAGE_${i + 1}`))}</span></span>${value}</div>`;
      });
      const owned = state.compass?.owned?.() === true;
      // Never had one yet: no warning chip, and the note says "a compass", not "another" (.308, scan C-02).
      const everHad = owned || reachedCount > 0 || state.compass?.everOwned?.() === true;
      const next = model.nextCompassStage(level);
      const head = `<div class="voyage-travel-head"><span class="voyage-travel-total">${reachedCount} / ${model.COMPASS_STAGES.length}</span><span class="voyage-travel-label">${esc(t('MOD_VOY_PAGE_COMPASS_READINGS'))}</span></div>` +
        '<div class="voyage-travel-split">' +
        (owned
          ? `<span class="voyage-travel-chip voyage-chip-ok"><i class="fa fa-check mr-1" aria-hidden="true"></i>${esc(t('MOD_VOY_PAGE_COMPASS_IN_BANK'))}</span>`
          : everHad ? `<span class="voyage-travel-chip voyage-chip-warn"><i class="fa fa-exclamation-triangle mr-1" aria-hidden="true"></i>${esc(t('MOD_VOY_PAGE_COMPASS_NOT_IN_BANK'))}</span>` : '') +
        (next === undefined ? '' : `<span class="voyage-travel-chip voyage-chip-next"><i class="fa fa-arrow-up mr-1" aria-hidden="true"></i>${esc(t('MOD_VOY_PAGE_COMPASS_NEXT', { level: `${next.level}` }))}</span>`) +
        '</div>';
      // Without the compass, where to get another sits at the bottom of the band (the user, build .148).
      const note = owned ? '' : `<div class="voyage-compass-note${everHad ? ' text-warning' : ''}">${esc(t(everHad ? 'MOD_VOY_PAGE_COMPASS_SHOP' : 'MOD_VOY_PAGE_COMPASS_SHOP_FIRST'))}</div>`;
      compass.innerHTML = section(`${head}<div class="voyage-stats">${rows.join('')}</div>${note}`);
    }

    // The land tile between Compass and Travels (build .160, the user): a round portrait of how you travel on land,
    // the mount once bought (build .162). A tap opens the shop while a better mount is for sale.
    const land = part('land');
    const L = state.land;
    if (land !== null) {
      const m = L?.mount();
      const name = m === undefined ? t('MOD_VOY_PAGE_LAND_ON_FOOT') : L.nameOf(m);
      const next = L?.next();
      // Build .165 (the user): one portrait, the mount bought last. Build .167: its tooltip is only what it gives, in green.
      // Phase 5a: with timed travel the mount gives speed, not a GP cut.
      const lines = state.timed?.() === true
        ? [m === undefined || !(m.speed > 1) ? t('MOD_VOY_PAGE_LAND_NO_SPEED') : { text: t('MOD_VOY_PAGE_LAND_SPEED', { speed: `${m.speed}` }), cls: 'text-success' }]
        : [m === undefined || m.cut === 0 ? t('MOD_VOY_PAGE_LAND_NO_CUT') : { text: t('MOD_VOY_PAGE_LAND_CUT', { pct: `${Math.round(m.cut * 100)}` }), cls: 'text-success' }];
      const tipText = lines.map((l) => (typeof l === 'string' ? l : l.text)).join('. ');
      const inner = `<div class="voyage-land-face" data-tip-lines="${esc(JSON.stringify(lines))}"><div class="voyage-land-ring"><img src="${m === undefined ? ctx.getResourceUrl('assets/marker_traveller_figure.webp') : L.mediaOf(m)}" alt=""></div>` +
        `<div class="voyage-land-name"><small class="voyage-land-kicker text-muted">${esc(t('MOD_VOY_PAGE_LAND_KICKER'))}</small>${esc(name)}</div></div>`;
      const shopHint = next === undefined ? '' : `. ${t('MOD_VOY_PAGE_LAND_NEXT', { name: L.nameOf(next), level: `${next.level}` })}. ${t('MOD_VOY_PAGE_LAND_SHOP')}`;
      const label = `${t('MOD_VOY_PAGE_LAND_TIP', { mount: name })}. ${tipText}${shopHint}`;
      land.innerHTML = next === undefined
        ? `<div class="voyage-land-body" role="group" aria-label="${esc(label)}">${inner}</div>`
        : `<button type="button" class="voyage-land-body voyage-land-btn" data-voyage-land="shop" aria-label="${esc(label)}">${inner}</button>`;
    }
    // The sign tile under it (build .162, the user): to the shop while not bought; carried; planted, a
    // button that finds it on the map (where and its buffs: the tooltip). Planting and picking up: the Here panel.
    const sign = part('sign');
    if (sign !== null) {
      sign.classList.toggle('d-none', L === undefined);
      if (L !== undefined) sign.innerHTML = signTile(L);
    }
    try { state.tips?.apply(document.getElementById(CONTAINER_ID)); } catch (e) { log('tooltips failed', e); }
    refocus(focused);
  };

  /** What the page depends on beyond the skill's own events. Cheap: read every frame while the page is open. */
  const signature = () => {
    const p = state.position();
    let logs = 0;
    for (const { id } of shipModel.DINGHY_BUILD.items) { const it = game.items.getObjectByID(id); if (it !== undefined) logs += game.bank.getQty(it); }
    const st = state.stores?.stores();
    const pickedQty = picked === undefined ? 0 : game.bank.getQty(game.items.getObjectByID(picked));
    const sh = state.ship?.boat();
    const bg = state.ship?.big?.();
    const held = [...(sh?.hold ?? []), ...(bg?.hold ?? [])];
    const pitch = game.items.getObjectByID('voyage:Pitch');
    let allLogs = 0;
    try { game.firemaking.actions.forEach((a) => { if (a.log !== undefined) allLogs += game.bank.getQty(a.log); }); } catch {}
    return `${held.length}:${held.reduce((n, e) => n + e.qty, 0)}|${sh?.q},${sh?.r},${sh?.cond},${sh?.aboard}|${bg?.q},${bg?.r},${bg?.cond}|${pitch === undefined ? 0 : game.bank.getQty(pitch)}|${allLogs}|${game.gp.amount}|${logs}|${p?.q},${p?.r}|${state.compass?.owned?.()}|${state.active()}|${st?.food},${st?.fuel}|${game.bank.items.size}|${pickedQty}|${skill()?.level}|${state.stores?.night?.()}|${state.planner?.signature?.()}|${state.land?.tier?.()}|${state.land?.signOwned?.()}|${state.land?.signPoi?.()?.id}|${state.land?.signAction?.()}|${state.cargo?.count?.()}`;
  };

  return { render, signature, helpSections };
}
