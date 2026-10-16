// "You are here" panel in the map's bottom-left overlay (next to the survey overview), a terrain line in
// the hex overview that opens when a hex is selected, and a legend. Re-rendered on travel, on page
// visible and on settings changes. Everything is wrapped: a failing panel never touches the game.

const PANEL_ID = 'voyage-here';
// Modal buttons: confirm green, cancel blue outline.
const SWAL_CLASS = { popup: 'voyage-ui', confirmButton: 'btn btn-success m-1', cancelButton: 'btn btn-outline-info m-1' };

export function install(ctx, { state, rules, terrainMod, storesModel, model, helpLayout, log }) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Display text comes from languages/<code>.json; the English labels in terrain.mjs/rules.mjs are for tests and logs.
  const classLabel = (cls) => (terrainMod.CLASS_INFO[cls] !== undefined ? getLangString(terrainMod.classKey(cls)) : cls);
  const featureLabel = (f) => (terrainMod.FEATURE_INFO[f] !== undefined ? getLangString(terrainMod.featureKey(f)) : f);

  const describe = (rec) => {
    if (rec === undefined) return { label: getLangString('MOD_VOY_PANEL_UNCHARTED'), features: [] };
    const info = rec.cloud === true ? terrainMod.CLOUD_INFO : terrainMod.CLASS_INFO[rec.t];
    const features = (rec.f ?? []).map(featureLabel);
    const label = rec.cloud === true
      ? templateLangString('MOD_VOY_PANEL_CLOUD_OVER', { cloud: getLangString(terrainMod.CLOUD_KEY), terrain: classLabel(rec.t) })
      : classLabel(rec.t);
    const places = [rec.area, rec.dungeon].filter(Boolean).map(terrainMod.areaLabel);
    return { label, features, css: info?.css, area: places.length > 0 ? places.join(', ') : undefined };
  };

  const poiNameOf = (hex) => {
    const poi = hex?.pointOfInterest;
    return poi !== undefined && poi.isDiscovered ? poi.name : undefined;
  };

  const coordsOf = (hex) => {
    try { const o = hex.to_oddq(); return `(${o.col}, ${o.row})`; } catch { return `(${hex.q}, ${hex.r})`; }
  };

  /**
   * A skill icon: a button, so a tap (no hover on touch) or a click opens what the tooltip says in a popup;
   * the tooltip stays for mouse users. `inner` is the icon (and the % badge).
   */
  const skillIcon = (skill, tip, inner, extra = '') =>
    `<button type="button" class="voyage-skill-btn ${extra}" data-voyage-skill="${esc(skill.id)}" data-tip="${esc(tip)}" title="${esc(tip)}" aria-label="${esc(tip)}">${inner}</button>`;
  const showSkillTip = (button) => {
    try {
      const skill = game.skills.getObjectByID(button.dataset.voyageSkill);
      SwalLocale.fire({
        didRender: state.popupDidRender,
        title: skill?.name ?? '',
        html: helpLayout.msgHtml([esc(button.dataset.tip ?? '')]),
        confirmButtonText: getLangString('MOD_VOY_BUTTON_OK'),
        customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass(SWAL_CLASS) : SWAL_CLASS,
      });
    } catch (e) { log('skill popup failed', e); }
  };

  /** A chip's tooltip in a popup, for touch (no hover). */
  const showTip = (text) => {
    try {
      SwalLocale.fire({
        didRender: state.popupDidRender,
        html: helpLayout.msgHtml([esc(text)]),
        confirmButtonText: getLangString('MOD_VOY_BUTTON_OK'),
        customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass(SWAL_CLASS) : SWAL_CLASS,
      });
    } catch (e) { log('tip popup failed', e); }
  };

  /** One icon per gated skill: full, penalised (with a % badge) or locked (dimmed); a tap or the tooltip says why. */
  const skillRows = (pos, rec) => skillRowsHtml(skillLists(pos));
  /** The working and locked skill icons for this hex: { works, locked, off }. */
  const skillLists = (pos) => {
    const works = [];
    const locked = [];
    const off = !state.active();
    for (const id of rules.gatedSkillIds()) {
      const skill = game.skills.getObjectByID(id);
      if (skill === undefined) continue;
      const labelKey = rules.ruleLabelKey(id);
      const name = labelKey !== undefined ? getLangString(labelKey) : skill.name;
      const rate = off ? 1 : state.rateAt(id);
      // Resource zones: which of the skill's ores, trees, fish, crops or targets work on this hex, at your level.
      let zoneNote = '';
      if (!off && rate > 0 && state.zonesOn?.() && state.zoneTable?.skills?.[id] !== undefined) {
        const here = state.zoneActionsHere(id);
        const names = here.slice(0, 8).map((a) => a.name).join(', ') + (here.length > 8 ? ', …' : '');
        zoneNote = ` ${here.length > 0 ? templateLangString('MOD_VOY_PANEL_ZONE_HERE', { names }) : getLangString('MOD_VOY_PANEL_ZONE_NONE')}`;
      }
      if (rate >= 1) { works.push(skillIcon(skill, templateLangString('MOD_VOY_PANEL_SKILL_WORKS', { skill: name }) + zoneNote, `<img class="skill-icon-xs" src="${skill.media}" alt="">`)); continue; }
      if (rate > 0) { works.push(skillIcon(skill, templateLangString('MOD_VOY_PANEL_SKILL_WORKS_AT', { skill: name, percent: `${Math.round(rate * 100)}` }) + zoneNote, `<img class="skill-icon-xs" src="${skill.media}" alt=""><small class="text-warning">${Math.round(rate * 100)}%</small>`, 'voyage-skill-rate')); continue; }
      // Tooltip in sentences: "Fishing: locked. Needs water. Nearest known: 1 hex SW." The compass reading only
      // shows when no place is known; a known one already gives distance and direction.
      const noun = getLangString(rules.ruleNounKey(id));
      const sentences = [templateLangString('MOD_VOY_PANEL_NEEDS', { noun })];
      const near = state.nearestFor(id, pos);
      if (near !== undefined) {
        const dir = getLangString(`MOD_VOY_DIR_SHORT_${terrainMod.directionLabel(pos, near.hex)}`);
        const hexes = templateLangString(near.distance === 1 ? 'MOD_VOY_HEXES_ONE' : 'MOD_VOY_HEXES_MANY', { count: `${near.distance}` });
        let n;
        try {
          const hex = game.cartography?.activeMap?.getHex(new HexCoords(near.hex.q, near.hex.r));
          n = poiNameOf(hex) ?? (near.hex.area ? terrainMod.areaLabel(near.hex.area) : undefined);
        } catch {}
        sentences.push(n !== undefined
          ? templateLangString('MOD_VOY_PANEL_NEAREST_KNOWN_AT', { hexes, dir, place: n })
          : templateLangString('MOD_VOY_PANEL_NEAREST_KNOWN', { hexes, dir }));
      } else {
        sentences.push(getLangString('MOD_VOY_PANEL_NONE_KNOWN'));
        const reading = state.compass?.describe(state.compass?.readingFor(id, pos));
        if (reading !== undefined) sentences.push(reading.text);
      }
      const hint = sentences.join(' ');
      locked.push(skillIcon(skill, templateLangString('MOD_VOY_PANEL_SKILL_LOCKED', { skill: name, hint }), `<img class="skill-icon-xs voyage-skill-locked" src="${skill.media}" alt="">`));
    }
    // Zoned skills without a terrain rule (Astrology): works where one of your constellations shows, else locked.
    for (const id of off ? [] : state.zonedUngated?.() ?? []) {
      const skill = game.skills.getObjectByID(id);
      if (skill === undefined) continue;
      const here = state.zoneActionsHere(id);
      if (here.length > 0) {
        const names = here.slice(0, 8).map((a) => a.name).join(', ') + (here.length > 8 ? ', …' : '');
        works.push(skillIcon(skill, `${templateLangString('MOD_VOY_PANEL_SKILL_WORKS', { skill: skill.name })} ${templateLangString('MOD_VOY_PANEL_ZONE_HERE', { names })}`, `<img class="skill-icon-xs" src="${skill.media}" alt="">`));
      } else {
        locked.push(skillIcon(skill, templateLangString('MOD_VOY_PANEL_SKY_NONE', { skill: skill.name }), `<img class="skill-icon-xs voyage-skill-locked" src="${skill.media}" alt="">`));
      }
    }
    return { works, locked, off };
  };
  const skillRowsHtml = ({ works, locked, off }) => {
    const note = off ? 'MOD_VOY_PANEL_RULES_OFF' : state.settings.strictness() === 'relaxed' ? 'MOD_VOY_PANEL_RELAXED' : undefined;
    const rulesNote = note !== undefined ? ` <small class="text-warning">${esc(getLangString(note))}</small>` : '';
    // Working skills fold behind "Works here: N" like the locked ones (user feedback, build .83: the rows ran long on a
    // phone); open by default, since this is what you can do here.
    return (works.length > 0
      ? `<div class="voyage-skillrow"><button type="button" class="voyage-legend-toggle voyage-works-toggle" aria-expanded="${worksOpen}">` +
        `<i class="fa fa-caret-${worksOpen ? 'down' : 'right'} mr-1"></i>${esc(templateLangString('MOD_VOY_PANEL_WORKS_COUNT', { count: `${works.length}` }))}</button>${rulesNote}</div>` +
        (worksOpen ? `<div class="voyage-skillrow voyage-locked-row">${works.join('')}</div>` : '')
      : `<div class="voyage-skillrow"><span class="voyage-here-label">${esc(getLangString('MOD_VOY_PANEL_WORKS'))}</span> <span>${esc(getLangString('MOD_VOY_PANEL_WORKS_NONE'))}</span>${rulesNote}</div>`) +
      // Locked skills fold away behind "Locked here: N" (user feedback, build .53: the full row was long and wrapped;
      // the sidebar dims them too). Open, the icons keep their tooltips (needs, nearest known, compass).
      (locked.length > 0
        ? `<div class="voyage-skillrow"><button type="button" class="voyage-legend-toggle voyage-locked-toggle" aria-expanded="${lockedOpen}">` +
          `<i class="fa fa-caret-${lockedOpen ? 'down' : 'right'} mr-1"></i>${esc(templateLangString('MOD_VOY_PANEL_LOCKED_COUNT', { count: `${locked.length}` }))}</button></div>` +
          (lockedOpen ? `<div class="voyage-skillrow voyage-locked-row">${locked.join('')}</div>` : '')
        : '');
  };

  /** "Manage voyage": the cross-link to the Voyage skill page; hidden when the page is not registered. */
  const manageLink = () => {
    try { if (game.pages.getObjectByID('voyage:Voyage') === undefined) return ''; } catch { return ''; }
    const journal = state.journal === undefined ? ''
      : `<button type="button" class="btn btn-sm voyage-journal-link" aria-label="${esc(getLangString('MOD_VOY_JOURNAL_OPEN'))}" title="${esc(getLangString('MOD_VOY_JOURNAL_TITLE'))}"><img src="${state.journal.iconUrl}" alt=""></button>`;
    return `<button type="button" class="btn btn-sm btn-outline-info voyage-manage-link"><i class="fa fa-ship mr-1"></i>${esc(getLangString('MOD_VOY_PANEL_MANAGE'))}</button>${journal}`;
  };

  /** The trader's status for this render: 'here', 'stranded' or undefined. */
  const traderStatus = () => {
    if (!state.active()) return undefined;
    try { return state.trader?.status(); } catch (e) { log('trader status failed', e); return undefined; }
  };
  // Built like the other panel rows (text, then its button; the buttons agree, alignRowButtons), build .86.
  const strandedRow = (text, hint, cls) =>
    `<div class="voyage-here-ship voyage-here-stranded" title="${esc(hint)}"><span class="text-warning"><i class="fa fa-exclamation-triangle mr-1"></i>${esc(text)}</span>` +
    `<button type="button" class="btn btn-sm btn-warning voyage-row-btn ${cls}">${esc(getLangString('MOD_VOY_PANEL_STRANDED_BUTTON'))}</button></div>`;
  /**
   * Stranded rows, right under "You are here" (user feedback, build .60): out of GP with the road out unaffordable
   * (Adventure starts with every skill locked), and the stores short of any way to easier ground or a place to load.
   * Each is a row of its own with a button, even where trade works or is not gated (a small link was easy to miss).
   */
  const strandedLines = (status) => {
    let out = status === 'stranded' ? strandedRow(getLangString('MOD_VOY_PANEL_STRANDED'), getLangString('MOD_VOY_PANEL_STRANDED_HINT'), 'voyage-trader-link') : '';
    try {
      const api = state.stores;
      if (api?.enabled() && api.rescue() !== undefined) {
        out += strandedRow(getLangString('MOD_VOY_PANEL_HUNGRY'), getLangString('MOD_VOY_PANEL_HUNGRY_HINT'), 'voyage-rescue-link');
      }
    } catch (e) { log('provisions status failed', e); }
    return out;
  };

  /** Trade status on its own line under the terrain line; empty while trade is not gated. */
  const tradeLine = (status) => {
    if (!state.active() || !state.settings.trade()) return '';
    // "Trade: OK" / "Trade: not here", laid out like the "Combat:" and "Works:" rows (label muted, same size as the value).
    const label = `<span class="voyage-here-label">${esc(getLangString('MOD_VOY_PANEL_TRADE_LABEL'))}</span> `;
    if (!state.tradeLocked?.()) return `<div class="voyage-here-place">${label}<span class="text-success">${esc(getLangString('MOD_VOY_PANEL_TRADE_OK'))}</span></div>`;
    const trader = status === 'here' ? ` <span class="text-warning" title="${esc(getLangString('MOD_VOY_PANEL_TRADER_HERE_HINT'))}">· ${esc(getLangString('MOD_VOY_PANEL_TRADER_HERE'))}</span>` : '';
    return `<div class="voyage-here-place">${label}<span class="text-danger" title="${esc(getLangString('MOD_VOY_PANEL_NO_TRADE_HINT'))}">${esc(getLangString('MOD_VOY_PANEL_NO_TRADE'))}</span>${trader}</div>`;
  };

  /** "Combat: Golbin Village, …" or "Combat: not here": the areas combat works in from this hex (empty while combat is not gated). */
  const fightLine = () => {
    if (!state.active() || !state.settings.combat()) return '';
    const areas = state.combatHere?.() ?? [];
    const names = areas.length > 0
      ? `<span class="voyage-fight-links">${areas.map((a) => `<button type="button" class="btn btn-sm btn-outline-info voyage-fight-link" data-area="${esc(a.id)}">${esc(a.name)}</button>`).join('')}</span>`
      : `<span class="text-danger">${esc(getLangString('MOD_VOY_PANEL_COMBAT_NONE'))}</span>`;
    return `<div class="voyage-here-place" title="${esc(getLangString('MOD_VOY_PANEL_COMBAT_HINT'))}"><span class="voyage-here-label">${esc(getLangString('MOD_VOY_PANEL_COMBAT_LABEL'))}</span> ${names}</div>`;
  };

  /**
   * A "Combat:" name opens the Combat page with the area's category open (Combat Areas, Slayer Areas, …) and the
   * area opened (its monster list shown, CombatAreaMenuElement.toggleOptions: what clicking the area does) and
   * scrolled into view: CombatAreaMenuManager.openCategory, as the game itself does for events. Switches realm first
   * when the area is in another one. Picking the monster stays with the player.
   */
  const openArea = (id) => {
    const area = game.combatAreas.getObjectByID(id);
    if (area === undefined) return;
    if (area.realm !== undefined && game.currentRealm !== area.realm && area.realm.isUnlocked) game.selectRealm(area.realm);
    const page = game.pages.getObjectByID('melvorD:Combat');
    state.openPage(page);
    let category;
    game.combatAreaCategories.forEach((c) => { if (category === undefined && c.areas.includes(area)) category = c; });
    if (category === undefined || typeof combatAreaMenus === 'undefined') return;
    combatAreaMenus.openCategory(category);
    setTimeout(() => {
      try {
        const el = combatAreaMenus.all.get(category)?.menuElems?.get(area);
        if (el === undefined) return;
        if (!el.isOpen) el.toggleOptions(area);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {}
    }, 50);
  };

  /** Where your boat is (phase 3b): aboard, or moored with a link that centres the map on it. */
  const shipLine = () => {
    const sh = state.ship;
    const ship = sh?.ship();
    if (ship == null || !sh.enabled()) return '';
    const name = sh.hullName?.(ship) ?? getLangString('MOD_VOY_SHIP_BOAT');
    // Hull condition (3d), only once it is worn: amber below 50%, red when worn through.
    const c = sh.cond?.() ?? 100;
    const hull = c >= 100 ? '' : ` <span class="${c <= 0 ? 'text-danger' : c < 50 ? 'text-warning' : 'text-muted'}">(${esc(templateLangString('MOD_VOY_PANEL_HULL', { cond: `${c}` }))})</span>`;
    if (sh.aboard()) return `<div class="voyage-here-ship text-info"><span><i class="fa fa-ship mr-1"></i>${esc(templateLangString('MOD_VOY_PANEL_ABOARD', { hull: name }))}${hull}</span></div>`;
    return `<div class="voyage-here-ship"><span><i class="fa fa-anchor mr-1"></i>${esc(templateLangString('MOD_VOY_PANEL_MOORED', { hull: name, where: sh.whereIs(ship, true) }))}${hull}</span>` +
      `<button type="button" class="btn btn-sm btn-outline-info voyage-row-btn voyage-find-ship">${esc(getLangString('MOD_VOY_PANEL_SHOW_SHIP'))}</button></div>`;
  };

  /** What the stores hold (phase 3c), and the loading rates when this is a place to load; the button opens the page. */
  const storesLine = () => {
    const api = state.stores;
    const have = api?.stores();
    if (have === undefined || !api.enabled()) return '';
    const rates = api.loadingHere();
    const load = rates === undefined ? ''
      : `<button type="button" class="btn btn-sm btn-outline-info voyage-row-btn voyage-manage-link voyage-load-link" title="${esc(templateLangString('MOD_VOY_PANEL_STORES_LOAD_HINT', { food: `${Math.round(rates.food * 100)}`, fuel: `${Math.round(rates.fuel * 100)}` }))}">${esc(getLangString('MOD_VOY_PANEL_STORES_LOAD'))}</button>`;
    // Amber when either runs low, red when either is empty (the same LOW the Voyage page uses).
    const low = have.food <= 0 || have.fuel <= 0 ? ' text-danger' : have.food < storesModel.LOW.food || have.fuel < storesModel.LOW.fuel ? ' text-warning' : '';
    return `<div class="voyage-here-ship"><span><span class="voyage-here-label">${esc(getLangString('MOD_VOY_PANEL_STORES_LABEL'))}</span> <span class="${low}">${api.icons(have.food, have.fuel)}</span></span>${load}</div>`;
  };

  /** Day or night (3e) and when it turns; the tooltip says what night does. Only while provisions apply. */
  const nightLine = () => {
    const api = state.stores;
    const tod = api?.enabled() ? api.timeOfDay?.() : undefined;
    if (tod === undefined) return '';
    const hint = templateLangString('MOD_VOY_PANEL_NIGHT_HINT', { land: `${storesModel.LIGHT.land}`, sea: `${storesModel.LIGHT.sea}`, bonus: `${Math.round(model.STAR_XP * 100)}` });
    const text = templateLangString(tod.night ? 'MOD_VOY_PANEL_NIGHT' : 'MOD_VOY_PANEL_DAY', { time: tod.until });
    return `<div class="voyage-here-ship voyage-here-time ${tod.night ? 'text-info' : 'text-muted'}" title="${esc(hint)}"><span><i class="fa fa-${tod.night ? 'moon' : 'sun'} mr-1"></i>${esc(text)}</span></div>`;
  };

  /** The ship and stores lines in one band with its own background (user feedback, build .58). */
  const shipBox = () => {
    const inner = nightLine() + shipLine() + storesLine();
    return inner === '' ? '' : `<div class="voyage-here-shipbox">${inner}</div>`;
  };

  /**
   * The mini panel: the folded panel as one short strip, as wide as its content. The terrain, then
   * chips chosen by the situation, in priority order, at most MINI_CHIPS of them besides a stranded warning.
   */
  const MINI_CHIPS = 5;
  const chip = (inner, tip, cls = '', btn = '') => btn === ''
    ? `<span class="voyage-chip ${cls}" title="${esc(tip)}" aria-label="${esc(tip)}">${inner}</span>`
    : `<button type="button" class="voyage-chip voyage-chip-btn ${cls} ${btn}" title="${esc(tip)}" aria-label="${esc(tip)}">${inner}</button>`;
  const miniChips = (pos, status) => {
    const out = [];
    const st = state.stores;
    const on = st?.enabled?.() === true;
    // 2. Stores, coloured like the panel's line.
    const have = on ? st.stores() : undefined;
    if (have !== undefined) {
      const low = have.food <= 0 || have.fuel <= 0 ? 'text-danger' : have.food < storesModel.LOW.food || have.fuel < storesModel.LOW.fuel ? 'text-warning' : '';
      out.push(chip(st.icons(have.food, have.fuel), st.amounts(have.food, have.fuel), low));
    }
    // 3. Hull, once worn.
    const sh = state.ship;
    if (sh?.ship?.() != null && sh.enabled()) {
      const c = sh.cond?.() ?? 100;
      if (c < 100) {
        const tip = `${sh.hullName?.(sh.ship()) ?? getLangString('MOD_VOY_SHIP_BOAT')}: ${templateLangString('MOD_VOY_PANEL_HULL', { cond: `${c}` })}`;
        out.push(chip(`<i class="fa fa-ship mr-1"></i>${c}%`, tip, c <= 0 ? 'text-danger' : c < 50 ? 'text-warning' : ''));
      }
    }
    // 4. Night only: fuel buys light then.
    const tod = on ? st.timeOfDay?.() : undefined;
    if (tod?.night) {
      const hint = templateLangString('MOD_VOY_PANEL_NIGHT_HINT', { land: `${storesModel.LIGHT.land}`, sea: `${storesModel.LIGHT.sea}`, bonus: `${Math.round(model.STAR_XP * 100)}` });
      out.push(chip(`<i class="fa fa-moon mr-1"></i>${esc(tod.until)}`, `${templateLangString('MOD_VOY_PANEL_NIGHT', { time: tod.until })}. ${hint}`, 'text-info'));
    }
    // 5. Load, on a place to load with room in the stores.
    if (have !== undefined && st.loadingHere() !== undefined) {
      const cap = st.capacity();
      if (have.food < cap.food || have.fuel < cap.fuel) out.push(chip(esc(getLangString('MOD_VOY_PANEL_STORES_LOAD')), getLangString('MOD_VOY_MINI_LOAD_HINT'), 'btn btn-sm btn-outline-info', 'voyage-manage-link'));
    }
    // 6. The planned voyage.
    const plan = state.planner?.summary?.();
    if (plan !== undefined) {
      // A small hexagon before the count reads as "hexes away" (the user, build .126); the tooltip says it in words.
      const hexIcon = '<svg class="voyage-chip-hex" viewBox="0 0 16 18" aria-hidden="true"><path d="M8 1.5 L14.5 5.25 V12.75 L8 16.5 L1.5 12.75 V5.25 Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
      const dist = plan.distance === undefined ? '' : `<span class="voyage-chip-dist">${hexIcon}${plan.distance}</span>`;
      const tip = templateLangString('MOD_VOY_MINI_PLAN_HINT', { name: plan.name, hexes: plan.distance === undefined ? '?' : templateLangString(plan.distance === 1 ? 'MOD_VOY_HEXES_ONE' : 'MOD_VOY_HEXES_MANY', { count: `${plan.distance}` }) });
      const icon = plan.media ? `<img class="voyage-chip-img" src="${esc(plan.media)}" alt="">` : '';
      out.push(chip(`<i class="fa fa-route mr-1"></i>${icon}<span class="voyage-chip-name">${esc(plan.name)}</span>${dist}`, tip, 'btn btn-sm btn-outline-info', 'voyage-mini-plan'));
    }
    // 7. What works here: four icons, then +N.
    const { works, off } = skillLists(pos);
    if (!off) {
      out.push(works.length === 0
        ? chip(`<span class="text-danger">${esc(getLangString('MOD_VOY_MINI_WORKS_NONE'))}</span>`, getLangString('MOD_VOY_PANEL_WORKS_NONE'))
        : `<span class="voyage-chip voyage-chip-skills">${works.slice(0, 4).join('')}${works.length > 4 ? `<small class="text-muted">+${works.length - 4}</small>` : ''}</span>`);
    }
    return out.slice(0, MINI_CHIPS);
  };
  const miniHtml = (pos, d, tip, status) => {
    const swatch = d.css ? `<span class="voyage-swatch" style="background:${d.css}"></span>` : '';
    const warn = [];
    if (status === 'stranded') warn.push(chip(`<i class="fa fa-exclamation-triangle mr-1"></i>${esc(getLangString('MOD_VOY_PANEL_STRANDED_BUTTON'))}`, getLangString('MOD_VOY_PANEL_STRANDED_HINT'), 'btn btn-sm btn-warning', 'voyage-trader-link'));
    else {
      try { if (state.stores?.enabled() && state.stores.rescue() !== undefined) warn.push(chip(`<i class="fa fa-exclamation-triangle mr-1"></i>${esc(getLangString('MOD_VOY_PANEL_STRANDED_BUTTON'))}`, getLangString('MOD_VOY_PANEL_HUNGRY_HINT'), 'btn btn-sm btn-warning', 'voyage-rescue-link')); } catch {}
    }
    // The wandering trader on your hex: he comes with being stranded, so he stands with its warning (seen on .123:
    // as the last chip he fell off a full strip).
    if (status === 'here' && state.settings.trade()) warn.push(chip('<i class="fa fa-store"></i>', getLangString('MOD_VOY_PANEL_TRADER_HERE_HINT'), 'voyage-chip-plain text-warning', 'voyage-chip-tip'));
    const unfold = getLangString('MOD_VOY_PANEL_UNFOLD');
    return `<div class="voyage-mini-row"><button type="button" class="voyage-panel-toggle voyage-mini-toggle" aria-expanded="false" title="${esc(`${tip}. ${unfold}`)}" aria-label="${esc(`${tip}. ${unfold}`)}">` +
      `<i class="fa fa-caret-right mr-1"></i>${swatch}${esc(d.label)}</button>${warn.join('')}${miniChips(pos, status).join('')}</div>`;
  };

  // The legend folds away behind a "Legend" toggle; closed by default. The choice is a browser convenience kept in
  // localStorage (not the save), so it never needs a migration.
  const LEGEND_KEY = 'voyage-legend-open';
  const LOCKED_KEY = 'voyage-locked-open';
  const WORKS_KEY = 'voyage-works-open';
  let worksOpen = (() => { try { return localStorage.getItem(WORKS_KEY) !== '0'; } catch { return true; } })();
  let lockedOpen = (() => { try { return localStorage.getItem(LOCKED_KEY) === '1'; } catch { return false; } })();
  let legendOpen = (() => { try { return localStorage.getItem(LEGEND_KEY) === '1'; } catch { return false; } })();
  // The whole panel folds behind "You are here" (open by default); folded it keeps the title, the terrain line and a
  // stranded warning.
  const PANEL_KEY = 'voyage-panel-open';
  let panelOpen = (() => { try { return localStorage.getItem(PANEL_KEY) !== '0'; } catch { return true; } })();
  const legendBlock = () =>
    `<div class="voyage-legend-wrap"><button type="button" class="voyage-legend-toggle" aria-expanded="${legendOpen}">` +
    `<i class="fa fa-caret-${legendOpen ? 'down' : 'right'} mr-1"></i>${esc(getLangString('MOD_VOY_PANEL_LEGEND'))}</button>` +
    (legendOpen ? `<div class="voyage-legend">${legend()}</div>` : '') + '</div>';

  const legend = () => [
    ...Object.entries(terrainMod.CLASS_INFO).filter(([cls]) => cls !== 'water').map(([cls, info]) => ({ css: info.css, label: classLabel(cls) })),
    { css: terrainMod.CLOUD_INFO.css, label: getLangString(terrainMod.CLOUD_KEY) },
  ]
    .map((info) => `<span class="voyage-legend-item"><span class="voyage-swatch" style="background:${info.css}"></span>${esc(info.label)}</span>`)
    .join('');

  /** Pushes the panel below any game control of the top bar that sits under the search bar (phone layout). */
  const placeUnderBar = () => {
    try {
      const panel = document.getElementById(PANEL_ID);
      const box = panel?.parentElement;
      const top = typeof cartographyMap !== 'undefined' ? cartographyMap?.topOverlay : undefined;
      if (!panel || !box || !top || !panel.classList.contains('voyage-here-top')) return;
      const b = box.getBoundingClientRect();
      let bottom = b.bottom;
      for (const el of top.querySelectorAll('button, input, select, a, .btn-group')) {
        if (box.contains(el) || el.contains(box) || el.closest('.dropdown-menu') !== null) continue; // open menus don't count
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue; // hidden
        if (r.right <= b.left || r.left >= b.right || r.bottom <= b.top) continue; // beside or above the search box
        bottom = Math.max(bottom, r.bottom);
      }
      const push = Math.round(bottom - b.bottom);
      panel.style.marginTop = push > 0 ? `${push + 6}px` : '';
    } catch (e) { log('panel placement failed', e); }
    moveMapControls();
    clearOfControls();
  };

  /** At phone width the panel spans the map and ran under the zoom buttons, hiding "Manage voyage" (16 Oct 2026, 500px): it stops short of them. */
  const clearOfControls = () => {
    try {
      const panel = document.getElementById(PANEL_ID);
      if (!panel || !panel.classList.contains('voyage-here-top')) return;
      panel.style.right = '';
      const p = panel.getBoundingClientRect();
      const lefts = [...document.querySelectorAll('.voyage-map-controls > *')].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => r.left);
      const left = Math.min(...lefts);
      if (Number.isFinite(left) && p.width > 0 && p.right > left - 4) panel.style.right = `${Math.ceil(p.right - left + 4)}px`;
    } catch (e) { log('panel gutter failed', e); }
  };

  /**
   * The map's own zoom and centre buttons (bottom-left overlay) sat on top of a tall panel and hid its lines. They
   * move to the map's right edge, under the top bar (the user, 16 Oct 2026: "move all the way to the right side"),
   * clear of the panel at every width and of the game's minibar in the bottom-right corner. The game keeps its
   * references to the buttons, so moving the nodes keeps their handlers. The hex overview stays bottom-left.
   */
  const moveMapControls = () => {
    try {
      if (typeof cartographyMap === 'undefined') return;
      const host = cartographyMap?.bottomLeftOverlay;
      const top = cartographyMap?.topOverlay;
      const map = host?.parentElement;
      if (!host || !map) return;
      let box = map.querySelector(':scope > .voyage-map-controls');
      if (box === null) {
        box = document.createElement('div');
        box.className = 'voyage-map-controls pointer-events-none';
        map.append(box);
      }
      for (const el of [...host.children].filter((c) => c.matches('.btn-group-vertical, button'))) box.append(el);
      box.style.top = top && top.parentElement === map ? `${top.offsetTop + top.offsetHeight}px` : '';
    } catch (e) { log('map controls move failed', e); }
  };

  /**
   * Row buttons (Manage voyage, Show, Load) agree on one layout: when any of them has to drop under its text, all of
   * them do and fill the line; otherwise all sit beside their text (user feedback, build .85: a full-width Show
   * above an inline Load looked broken). Measured with the stacked class off, so a wider panel can go back.
   */
  let rowsWidth = -1;
  const alignRowButtons = (force = false) => {
    try {
      const panel = document.getElementById(PANEL_ID);
      if (!panel) return;
      const width = panel.clientWidth;
      if (!force && width === rowsWidth) return;
      rowsWidth = width;
      panel.classList.remove('voyage-stacked');
      const wrapped = [...panel.querySelectorAll('.voyage-here-head > .btn, .voyage-here-ship > .btn')]
        .some((btn) => { const first = btn.parentElement.firstElementChild; return first !== btn && btn.offsetTop > first.offsetTop + 2; });
      panel.classList.toggle('voyage-stacked', wrapped);
    } catch (e) { log('row buttons failed', e); }
  };

  const ensurePanel = () => {
    if (typeof cartographyMap === 'undefined' || cartographyMap === null) return undefined;
    let panel = document.getElementById(PANEL_ID);
    if (panel !== null) return panel;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'voyage-ui block block-rounded bg-combat-inner-dark p-2 mb-2';
    panel.addEventListener('click', (e) => {
      if (e.target instanceof Element && e.target.closest('.voyage-trader-link')) { e.preventDefault(); state.trader?.offer(); }
      if (e.target instanceof Element && e.target.closest('.voyage-rescue-link')) { e.preventDefault(); state.stores?.offer(); }
      if (e.target instanceof Element && e.target.closest('.voyage-locked-toggle')) {
        lockedOpen = !lockedOpen;
        try { localStorage.setItem(LOCKED_KEY, lockedOpen ? '1' : '0'); } catch {}
        render();
        return;
      }
      const skillBtn = e.target instanceof Element ? e.target.closest('.voyage-skill-btn') : null;
      if (skillBtn !== null) { showSkillTip(skillBtn); return; }
      if (e.target instanceof Element && e.target.closest('.voyage-works-toggle')) {
        worksOpen = !worksOpen;
        try { localStorage.setItem(WORKS_KEY, worksOpen ? '1' : '0'); } catch {}
        render();
        return;
      }
      if (e.target instanceof Element && e.target.closest('.voyage-panel-toggle')) {
        panelOpen = !panelOpen;
        try { localStorage.setItem(PANEL_KEY, panelOpen ? '1' : '0'); } catch {}
        render();
        return;
      }
      if (e.target instanceof Element && e.target.closest('.voyage-legend-toggle')) {
        legendOpen = !legendOpen;
        try { localStorage.setItem(LEGEND_KEY, legendOpen ? '1' : '0'); } catch {}
        render();
        return;
      }
      if (e.target instanceof Element && e.target.closest('.voyage-find-ship')) {
        e.preventDefault();
        try { const hex = state.ship?.hex(); if (hex !== undefined) state.ship.centreOn(hex); } catch (err) { log('find ship failed', err); }
      }
      const fight = e.target instanceof Element ? e.target.closest('.voyage-fight-link') : null;
      if (fight !== null) {
        e.preventDefault();
        try { openArea(fight.dataset.area); } catch (err) { log('Combat link failed', err); }
      }
      if (e.target instanceof Element && e.target.closest('.voyage-mini-plan')) { e.preventDefault(); state.planner?.reopen?.(); return; }
      const tipChip = e.target instanceof Element ? e.target.closest('.voyage-chip-tip') : null;
      if (tipChip !== null) { showTip(tipChip.getAttribute('title') ?? ''); return; }
      if (e.target instanceof Element && e.target.closest('.voyage-journal-link')) {
        e.preventDefault();
        state.journal?.open();
      }
      if (e.target instanceof Element && e.target.closest('.voyage-manage-link')) {
        e.preventDefault();
        try { state.openPage(game.pages.getObjectByID('voyage:Voyage')); } catch (err) { log('Manage voyage link failed', err); }
      }
    });
    // Under the location search bar (top-left of the map), after its results drop-down so results still open
    // right below the input. Falls back to the bottom-left overlay if the search bar is not where we expect.
    const results = cartographyMap.searchResultsCont;
    const bar = cartographyMap.locationSearchBar;
    if (results?.parentElement && bar && results.parentElement.contains(bar)) {
      // Absolutely positioned below the search box so the box's own dark background does not grow around
      // the panel; the results drop-down still pushes the panel down because it sits at the box's bottom edge.
      const box = results.parentElement;
      if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
      box.append(panel);
      panel.classList.add('voyage-here-top');
      // On a phone the game wraps its Create / ? / filter buttons onto a row under the search bar, over the panel
      // (user report, build .83). Measure instead of guessing the game's layout: the panel goes below the lowest
      // top-bar control that overlaps it sideways; on a wide screen nothing overlaps and it stays under the bar.
      const top = cartographyMap.topOverlay;
      if (top && typeof ResizeObserver === 'function') {
        const watch = new ResizeObserver(() => requestAnimationFrame(placeUnderBar));
        watch.observe(top);
        watch.observe(box);
        new ResizeObserver(() => requestAnimationFrame(() => alignRowButtons())).observe(panel);
      }
      window.addEventListener('resize', () => requestAnimationFrame(placeUnderBar));
      return panel;
    }
    const host = cartographyMap.bottomLeftOverlay;
    if (!host) return undefined;
    host.prepend(panel);
    return panel;
  };

  const render = () => {
    try {
      const panel = ensurePanel();
      if (panel === undefined) return;
      if (state.mode === 'dormant') { panel.classList.add('d-none'); return; }
      panel.classList.remove('d-none');
      const pos = state.position();
      if (pos === undefined) { panel.innerHTML = `<div class="font-w600">${esc(getLangString('SKILL_NAME_Voyage'))}</div><small class="text-muted">${esc(getLangString('MOD_VOY_PANEL_NO_POSITION'))}</small>`; return; }
      const rec = state.recordAt(pos);
      const d = describe(rec);
      const poi = poiNameOf(pos);
      const place = [poi ? esc(poi) : undefined, d.area ? esc(d.area) : undefined].filter(Boolean).join(', ');
      const where = `${place ? ` · ${place}` : ''} ${coordsOf(pos)}`;
      const swatch = d.css ? `<span class="voyage-swatch" style="background:${d.css}"></span>` : '';
      const features = d.features.length > 0 ? ` · ${esc(d.features.join(', '))}` : '';
      const mode = state.mode === 'relaxed' ? `<div><small class="text-warning">${esc(getLangString('MOD_VOY_PANEL_TABLE_MISMATCH'))}</small></div>` : '';
      const status = traderStatus();
      panel.classList.toggle('voyage-mini', !panelOpen);
      if (!panelOpen) {
        const tip = `${d.label}${d.features.length > 0 ? ` · ${d.features.join(', ')}` : ''}${place ? ` · ${[poi, d.area].filter(Boolean).join(', ')}` : ''} ${coordsOf(pos)}`;
        panel.innerHTML = miniHtml(pos, d, tip, status) + mode;
        placeUnderBar();
        return;
      }
      panel.innerHTML =
        `<div class="voyage-here-head"><button type="button" class="voyage-panel-toggle" aria-expanded="${panelOpen}" title="${esc(getLangString(panelOpen ? 'MOD_VOY_PANEL_FOLD' : 'MOD_VOY_PANEL_UNFOLD'))}">` +
        `<i class="fa fa-caret-${panelOpen ? 'down' : 'right'} mr-1"></i>${esc(getLangString('MOD_VOY_PANEL_YOU_ARE_HERE'))}</button>${manageLink()}</div>` +
        strandedLines(status) +
        `<div>${swatch}${esc(d.label)}<small class="text-muted">${features}${where}</small></div>` +
        shipBox() +
        tradeLine(status) +
        fightLine() +
        mode +
        `<div class="voyage-skills">${skillRows(pos, rec)}</div>` +
        (state.settings.overlay() ? legendBlock() : '');
      placeUnderBar();
      alignRowButtons(true);
    } catch (e) { log('here panel failed', e); }
  };

  // Terrain line in the hex overview (selected hex).
  ctx.patch(HexOverviewElement, 'displayHex').after(function (_ret, hex) {
    try {
      let line = this.querySelector('.voyage-overview');
      if (line === null) {
        line = document.createElement('div');
        line.className = 'voyage-overview voyage-ui mt-1';
        this.poiInfo?.after(line) ?? this.append(line);
      }
      if (state.mode === 'dormant' || !hex.isFullySurveyed) { line.classList.add('d-none'); return; }
      const d = describe(state.recordAt(hex));
      const swatch = d.css ? `<span class="voyage-swatch" style="background:${d.css}"></span>` : '';
      const features = d.features.length > 0 ? ` <span class="text-muted">· ${esc(d.features.join(', '))}</span>` : '';
      line.innerHTML = `${swatch}${esc(d.label)}${features}`;
      line.classList.remove('d-none');
    } catch (e) { log('overview line failed', e); }
  });

  ctx.patch(Cartography, 'onPageVisible').after(() => { setTimeout(render, 0); });
  ctx.onCharacterLoaded(() => {
    try { game.cartography?.on('travel', () => setTimeout(render, 0)); } catch (e) { log('travel hook failed', e); }
  });
  state.listeners.push(render);
  return { render };
}
