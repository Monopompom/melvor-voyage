// The Voyage skill page: ship, hold, stores, travels and the compass stages, plus "Show map". The
// ship block builds the first dinghy and says where the ship is (phase 3b, src/ship.mjs). The container is inserted
// on interfaceAvailable because the game calls skill.initMenus() right after that hook and SkillHeaderElement looks
// for <skill-header data-skill-id> then.

// Modal buttons: confirm green, cancel blue outline (the game's default cancel is red; grey means disabled).
const SWAL_CLASS = { popup: 'voyage-ui', confirmButton: 'btn btn-success m-1', cancelButton: 'btn btn-outline-info m-1' };

export const CONTAINER_ID = 'voyage-container';
export const PAGE_ID = 'voyage:Voyage';
const CARTOGRAPHY_PAGE_ID = 'melvorAoD:Cartography';

export function install(ctx, { state, model, shipModel, storesModel, helpHtml, HELP_WIDTH, log }) {
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
      // The "?" next to each block title: that block's rules in a popup.
      container?.querySelectorAll('[data-voyage-help]').forEach((b) => {
        b.setAttribute('aria-label', t('MOD_VOY_HELP_BUTTON'));
        b.onclick = () => showHelp(b.dataset.voyageHelp);
      });
      // Delegated listeners: the blocks are re-rendered as innerHTML.
      part('ship')?.addEventListener('click', (e) => {
        const target = e.target instanceof Element ? e.target.closest('[data-voyage-action]') : null;
        if (target === null) return;
        if (target.dataset.voyageAction === 'build') { if (state.ship?.build()) render(); }
        else if (target.dataset.voyageAction === 'repair') { if (state.ship?.repair()) render(); }
        else if (target.dataset.voyageAction === 'find') showMap(true);
      });
      part('hold')?.addEventListener('click', (e) => {
        const target = e.target instanceof Element ? e.target.closest('[data-voyage-action], [data-voyage-preset]') : null;
        if (target === null) return;
        if (target.dataset.voyagePreset !== undefined) { preset(target, 'take'); return; }
        if (target.dataset.voyageAction === 'hold-pick') { holdPicked = target.dataset.item; render(); }
        else if (target.dataset.voyageAction === 'take') {
          const item = game.items.getObjectByID(holdPicked ?? '');
          const n = typed('take');
          if (item !== undefined && n > 0 && state.hold?.take(item, n) > 0) { delete amounts.take; render(); }
        }
      });
      part('stores')?.addEventListener('click', (e) => {
        const target = e.target instanceof Element ? e.target.closest('[data-voyage-action], [data-voyage-preset]') : null;
        if (target === null) return;
        if (target.dataset.voyagePreset !== undefined) { preset(target, 'load'); return; }
        const action = target.dataset.voyageAction;
        if (action === 'pick') { picked = target.dataset.item; render(); return; }
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

  /** Opens the map. `onShip`: centred on the moored ship (the ship block's button); otherwise as it was left. */
  const showMap = (onShip) => {
    const map = pageOf(CARTOGRAPHY_PAGE_ID);
    if (map === undefined) return;
    state.openPage(map);
    const hex = !onShip || state.ship?.aboard() ? undefined : state.ship?.hex();
    if (hex !== undefined) setTimeout(() => { try { state.ship.centreOn(hex); } catch (e) { log('map centre failed', e); } }, 100);
  };

  const qty = (n) => numberWithCommas(n);
  /** A cost: icon, amount and what you have; red with the words when short (never colour alone). */
  const costIcon = (media, need, have, title) =>
    `<span class="voyage-cost ${have >= need ? '' : 'text-danger'}" title="${esc(title)}"><img class="mr-1" src="${media}" alt="${esc(title)}">${qty(need)}` +
    ` <span class="${have >= need ? 'text-muted' : ''} ml-1">(${t('MOD_VOY_PAGE_HAVE', { count: qty(have) })})</span></span>`;
  /** A grey section band inside a block. */
  const section = (html) => `<div class="voyage-section">${html}</div>`;
  /**
   * An action block like the bank's Sell / Stow: amount box and blue presets on one row, then one green
   * main button, centred.
   */
  const actionBlock = ({ action, itemId, max, value, presets, main }) =>
    '<div class="voyage-action">' +
    '<div class="voyage-hold-row">' +
    `<input type="number" min="1" max="${max}" value="${value}" inputmode="numeric" class="form-control voyage-hold-qty" data-voyage-amount="${action}" data-item="${esc(itemId)}" aria-label="${esc(t('MOD_VOY_PAGE_AMOUNT'))}">` +
    `<div class="voyage-hold-presets">${presets.filter((p) => p.n > 0).map((p) => `<button type="button" class="btn btn-sm btn-info" data-voyage-preset="${p.n}">${esc(p.label)}</button>`).join('')}</div></div>` +
    `<div class="voyage-hold-main"><button type="button" class="btn btn-success" data-voyage-action="${action}">${esc(main)}</button></div></div>`;
  /** Item chips (bank-style), the picked one filled blue; the name is in a line under them for touch. */
  const chips = (items, pickedId, action, title) =>
    `<div class="voyage-store-items">${items.map((x) => `<button type="button" class="btn btn-sm voyage-store-item ${x.item.id === pickedId ? 'btn-info' : 'btn-outline-info'}" ` +
      `data-voyage-action="${action}" data-item="${esc(x.item.id)}" title="${esc(title(x))}" aria-label="${esc(title(x))}" aria-pressed="${x.item.id === pickedId}">` +
      `<img src="${x.item.media}" alt=""><small>${numberWithCommas(x.qty)}</small></button>`).join('')}</div>`;

  const shipHtml = () => {
    const api = state.ship;
    const ship = api?.ship();
    if (api === undefined || ship === undefined) return `<div class="text-warning">${t('MOD_VOY_PAGE_NO_SHIP')}</div>`;
    const icon = (hull) => `<img class="voyage-hull-icon mr-2" src="${ctx.getResourceUrl(hull.media)}" alt="">`;
    if (ship === null) {
      const hull = shipModel.HULLS.dinghy;
      const b = shipModel.DINGHY_BUILD;
      const costs = [costIcon(game.gp.media, b.gp, game.gp.amount, game.gp.name)];
      for (const { id, quantity } of b.items) {
        const item = game.items.getObjectByID(id);
        if (item !== undefined) costs.push(costIcon(item.media, quantity, game.bank.getQty(item), item.name));
      }
      const why = api.buildBlocker();
      // No dead disabled button: the reason stands where the button would be.
      return section(`<div class="d-flex align-items-center">${icon(hull)}<div><div>${t('MOD_VOY_PAGE_NO_SHIP_YET')}</div>` +
          `<small class="text-muted">${esc(t(shipModel.hullBlurbKey(hull.id)))}</small></div></div>`) +
        section(`<div class="d-flex flex-wrap align-items-center"><span class="mr-2">${t('MOD_VOY_PAGE_BUILD_COST')}</span>${costs.join('')}</div>` +
          (why
            ? `<div class="text-warning mt-2">${esc(why)}</div>`
            : `<div class="voyage-hold-main"><button type="button" class="btn btn-success" data-voyage-action="build">${t('MOD_VOY_PAGE_BUILD_BUTTON')}</button></div>` +
              `<small class="d-block text-center text-muted mt-1">${t('MOD_VOY_PAGE_BUILD_HINT')}</small>`));
    }
    const hull = shipModel.HULLS[ship.hull];
    const where = api.aboard() ? t('MOD_VOY_PAGE_ABOARD') : t('MOD_VOY_PAGE_MOORED', { where: esc(api.whereIs(ship)) });
    const off = !api.enabled() ? `<div class="text-warning">${t('MOD_VOY_PAGE_RULES_OFF')}</div>` : '';
    const find = api.aboard() ? '' : `<button type="button" class="btn btn-sm btn-outline-info" data-voyage-action="find">${t('MOD_VOY_PAGE_FIND_SHIP')}</button>`;
    return section(`<div class="voyage-row"><div class="d-flex align-items-center">${icon(hull)}<div><div><b>${esc(t(shipModel.hullNameKey(hull.id)))}</b>: ${where}</div>${off}</div></div>${find}</div>`) +
      hullHtml();
  };

  /** The hold (build .72; its own block since build .86): what it carries, and taking things back to the bank. */
  let holdPicked;
  const holdHtml = () => {
    const h = state.hold;
    if (h === undefined) return '';
    const items = h.contents();
    const why = h.blocker();
    if (items.length === 0) return `<div>${t('MOD_VOY_HOLD_EMPTY')}</div>`;
    if (!items.some((x) => x.item.id === holdPicked)) holdPicked = items[0].item.id;
    const sel = items.find((x) => x.item.id === holdPicked);
    let html = chips(items, holdPicked, 'hold-pick', (x) => x.item.name) +
      `<div class="mt-2">${esc(t('MOD_VOY_PAGE_HOLD_SELECTED', { item: sel.item.name, count: numberWithCommas(sel.qty) }))}</div>`;
    if (why !== undefined) return `${html}<div class="text-warning mt-2">${esc(why)}</div>`;
    html += actionBlock({
      action: 'take', itemId: sel.item.id, max: sel.qty, value: amountFor('take', sel.item.id, sel.qty, sel.qty),
      presets: [{ n: sel.qty - 1, label: t('MOD_VOY_HOLD_ALL_BUT_ONE') }, { n: sel.qty, label: t('MOD_VOY_PAGE_STORES_LOAD_ALL') }],
      main: t('MOD_VOY_HOLD_TAKE'),
    });
    return html;
  };

  /** Hull condition and repairs (phase 3d). */
  const hullHtml = () => {
    const info = state.ship?.repairInfo?.();
    if (info === undefined) return '';
    const R = shipModel.REPAIR;
    const c = info.cond;
    const cls = c <= 0 ? 'bg-danger' : c < storesModel.WORN ? 'bg-warning' : 'bg-success';
    const pitch = game.items.getObjectByID('voyage:Pitch');
    const logs = game.items.getObjectByID('melvorD:Normal_Logs');
    const costTitle = t('MOD_VOY_PAGE_HULL_COST', { step: `${R.step}`, logs: `${R.logs}`, pitch: `${R.pitch}` });
    const costs = [costIcon(logs?.media ?? '', info.plan.full.logs, info.logs, costTitle)];
    if (pitch !== undefined) costs.push(costIcon(pitch.media, info.plan.full.pitch, info.pitch, pitch.name));
    const action = info.blocker === undefined
      ? `<div class="voyage-hold-main"><button type="button" class="btn btn-success" data-voyage-action="repair">${t('MOD_VOY_PAGE_HULL_REPAIR', { cond: `${info.plan.to}` })}</button></div>`
      : (c < 100 ? `<div class="text-warning mt-2">${esc(info.blocker)}</div>` : '');
    return section(`<div class="d-flex align-items-center"><img class="voyage-hull-icon mr-2" src="${ctx.getResourceUrl('assets/hull_condition.png')}" alt="">` +
      `<div class="flex-grow-1"><div><b>${t('MOD_VOY_PAGE_HULL_LABEL')}</b> <span class="${c <= 0 ? 'text-danger' : c < storesModel.WORN ? 'text-warning' : ''}">${c}%</span></div>` +
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
      const now = t(tod.night ? 'MOD_VOY_PANEL_NIGHT' : 'MOD_VOY_PANEL_DAY', { time: tod.until });
      items.push(`<span class="voyage-status-item ${tod.night ? 'text-info' : ''}"><i class="fa fa-${tod.night ? 'moon' : 'sun'} mr-1"></i>${esc(now)}</span>`);
    }
    return items;
  };
  /** Rounded percentage of a cut: 0.245 -> 24.5. */
  const cutOf = (factor) => Math.round((1 - factor) * 1000) / 10;
  const clock = (h) => `${String(h).padStart(2, '0')}:00`;

  /**
   * The rules behind each block (user feedback, build .68: the page had too much text). Shown in a popup from the
   * block title's "?"; they become the Captain's Journal's guide pages in phase 4.
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
          cells: [sea(g) ? t('MOD_VOY_HELP_AT_SEA') : terrainList(g.classes), `${qty(g.rations * storesModel.RATION_HP)} HP`, g.fuel > 0 ? `${g.fuel}` : t('MOD_VOY_HELP_NONE')],
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
      const s = state.ship?.ship();
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
            { cells: [t('MOD_VOY_HULL_NAME_DINGHY'), `${shipModel.HOLD_SLOTS.dinghy}`] },
            { cells: [t('MOD_VOY_HELP_HOLD_PER_LEVEL'), '+1'], cls: ['text-success'] },
          ] } },
        ] },
        { head: t('MOD_VOY_HELP_HEAD_STOW'), body: [t('MOD_VOY_HELP_HOLD_WHERE'), t('MOD_VOY_HELP_HOLD_SELL')] },
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
            { cells: [t('MOD_VOY_HELP_COL_FOOD'), `${st.hp(cap.food)} HP`] },
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
          ] } },
          t('MOD_VOY_HELP_XP_FAST_TRAVEL'),
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
    const level = (kind) => (have[kind] <= 0 ? 'text-danger' : have[kind] < storesModel.LOW[kind] ? 'text-warning' : '');
    const of = (n) => `<small class="text-muted">/ ${n}</small>`;
    const carried = `<span class="voyage-stores-icons"><img src="${ctx.getResourceUrl('assets/ration.png')}" alt=""><span class="${level('food')}">${api.hp(have.food)}</span> ${of(api.hp(cap.food))} HP ` +
      `<img src="${ctx.getResourceUrl('assets/fuel.png')}" alt=""><span class="${level('fuel')}">${api.fuelText(have.fuel)}</span> ${of(api.fuelText(cap.fuel))}</span>`;
    let html = section(`<div class="d-flex align-items-center"><img class="voyage-hull-icon mr-2" src="${ctx.getResourceUrl('assets/ship_stores.png')}" alt=""><b>${carried}</b></div>` +
      (api.enabled() ? '' : `<div class="text-warning">${t('MOD_VOY_PAGE_STORES_OFF')}</div>`));
    const rates = api.loadingHere();
    if (rates === undefined) return `${html}${section(`<div class="text-warning">${t('MOD_VOY_PAGE_STORES_NO_LOADING')}</div>`)}`;
    let load = `<div>${t('MOD_VOY_PAGE_STORES_LOADING', { place: esc(t(PLACE_KEY[rates.place])), food: pct(rates.food), fuel: pct(rates.fuel) })}</div>`;
    const items = api.loadable().filter((x) => rates[x.kind] > 0);
    if (items.length === 0) return html + section(`${load}<div class="text-warning mt-1">${t('MOD_VOY_PAGE_STORES_NOTHING')}</div>`);
    if (!items.some((x) => x.item.id === picked)) picked = items[0].item.id;
    const unit = (x) => `${x.item.name}: ${x.kind === 'food' ? t('MOD_VOY_PAGE_STORES_UNIT_FOOD', { hp: `${x.unit}` }) : t('MOD_VOY_PAGE_STORES_UNIT_FUEL', { fuel: `${x.unit}` })}`;
    const sel = items.find((x) => x.item.id === picked);
    const rate = rates[sel.kind];
    // The limit (build .66): no more items than it takes to fill the room left.
    const room = Math.max(0, cap[sel.kind] - have[sel.kind]);
    const most = storesModel.loadCount(sel.unit, rate, sel.qty, room);
    load += `<div class="mt-2">${chips(items, picked, 'pick', unit)}</div>` +
      `<div class="mt-2">${esc(t('MOD_VOY_PAGE_SELECTED', { item: unit(sel), count: numberWithCommas(sel.qty) }))}</div>`;
    if (most <= 0) return html + section(`${load}<div class="mt-2 text-warning">${t(sel.kind === 'food' ? 'MOD_VOY_PAGE_STORES_FULL_FOOD' : 'MOD_VOY_PAGE_STORES_FULL_FUEL')}</div>`);
    loadPreview = (n) => {
      const v = Math.min(room, storesModel.loadAmount(sel.unit, Math.min(n, most), rate));
      return sel.kind === 'food' ? `+${api.hp(v)} HP` : `+${api.fuelText(storesModel.roundFuel(v))}`;
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

  const render = () => {
    const s = skill();
    if (s === undefined || document.getElementById(CONTAINER_ID) === null) return;
    const level = s.level;
    const rec = s.record;

    const status = part('status');
    if (status !== null) {
      const items = statusItems();
      status.innerHTML = items.join('');
      status.classList.toggle('d-none', items.length === 0);
    }
    const ship = part('ship');
    if (ship !== null && !typing(ship)) ship.innerHTML = shipHtml();
    const holdBlock = part('hold-block');
    const hasShip = state.ship?.ship() != null && state.hold !== undefined;
    holdBlock?.classList.toggle('d-none', !hasShip);
    if (hasShip) {
      const slotsEl = part('hold-slots');
      if (slotsEl !== null) {
        const used = state.hold.hold().length;
        const max = state.hold.slots();
        slotsEl.textContent = t('MOD_VOY_HOLD_SLOTS', { used: `${used}`, slots: `${max}` });
        slotsEl.className = `font-w600 ${used >= max ? 'text-warning' : ''}`;
        slotsEl.title = used >= max ? t('MOD_VOY_HOLD_FULL_PAGE') : '';
      }
      const hold = part('hold');
      if (hold !== null && !typing(hold)) hold.innerHTML = holdHtml();
    }
    const storesPart = part('stores');
    if (storesPart !== null && !typing(storesPart)) storesPart.innerHTML = storesHtml();

    const travels = part('travels');
    if (travels !== null) {
      const total = rec.landHexes + rec.waterHexes;
      travels.innerHTML =
        `<div>${t('MOD_VOY_PAGE_HEXES_TRAVELLED', { total: numberWithCommas(total) })} <small class="text-muted">${t('MOD_VOY_PAGE_HEXES_SPLIT', { land: numberWithCommas(rec.landHexes), water: numberWithCommas(rec.waterHexes) })}</small></div>` +
        (s.futureRaw !== undefined ? `<div class="text-warning">${t('MOD_VOY_PAGE_FUTURE_SAVE')}</div>` : '');
    }

    const compass = part('compass');
    if (compass !== null) {
      const icon = part('compass-icon');
      try { const it = game.items.getObjectByID('voyage:Wayfinder_Compass'); if (icon !== null && it !== undefined) icon.src = it.media; } catch {}
      // Stage texts: MOD_VOY_PAGE_COMPASS_STAGE_<n>, n = 1.. in model.COMPASS_STAGES order (English kept there).
      const rows = model.COMPASS_STAGES.map((stage, i) => {
        const reached = level >= stage.level;
        const mark = reached ? '<i class="fa fa-check text-success mr-1"></i>' : '<i class="fa fa-lock text-muted mr-1"></i>';
        return `<div class="${reached ? '' : 'text-muted'}">${mark}<small>${t('MOD_VOY_PAGE_COMPASS_LEVEL', { level: `${stage.level}` })}</small> ${esc(t(`MOD_VOY_PAGE_COMPASS_STAGE_${i + 1}`))}</div>`;
      });
      const owned = state.compass?.owned?.() === true;
      const note = owned
        ? `<small class="text-muted">${t('MOD_VOY_PAGE_COMPASS_OWNED')}</small>`
        : `<div class="text-warning">${t('MOD_VOY_PAGE_COMPASS_MISSING')}</div>`;
      compass.innerHTML = section(`<div class="voyage-compass-stages">${rows.join('')}</div>`) + `<div class="mt-2">${note}</div>`;
    }
  };

  /** What the page depends on beyond the skill's own events. Cheap: read every frame while the page is open. */
  const signature = () => {
    const p = state.position();
    let logs = 0;
    for (const { id } of shipModel.DINGHY_BUILD.items) { const it = game.items.getObjectByID(id); if (it !== undefined) logs += game.bank.getQty(it); }
    const st = state.stores?.stores();
    const pickedQty = picked === undefined ? 0 : game.bank.getQty(game.items.getObjectByID(picked));
    const sh = state.ship?.ship();
    const held = state.hold?.hold() ?? [];
    const pitch = game.items.getObjectByID('voyage:Pitch');
    let allLogs = 0;
    try { game.firemaking.actions.forEach((a) => { if (a.log !== undefined) allLogs += game.bank.getQty(a.log); }); } catch {}
    return `${held.length}:${held.reduce((n, e) => n + e.qty, 0)}|${sh?.q},${sh?.r},${sh?.cond}|${pitch === undefined ? 0 : game.bank.getQty(pitch)}|${allLogs}|${game.gp.amount}|${logs}|${p?.q},${p?.r}|${state.compass?.owned?.()}|${state.active()}|${st?.food},${st?.fuel}|${game.bank.items.size}|${pickedQty}|${skill()?.level}|${state.stores?.night?.()}`;
  };

  return { render, signature };
}
