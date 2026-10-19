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
  /** A locked tooltip's first row: the skill's icon, "Fishing is locked here." in bold red (build .282). */
  const lockedHead = (skill, name) => ({ text: templateLangString('MOD_VOY_PANEL_SKILL_LOCKED', { skill: name, hint: '' }).trim(), media: skill.media, cls: 'text-danger font-w600' });
  /** A skill's icon button; `lines` (tips.mjs data-tip-lines, build .282) styles its tooltip row by row. */
  const skillIcon = (skill, tip, inner, extra = '', lines) =>
    `<button type="button" class="voyage-skill-btn ${extra}" data-voyage-skill="${esc(skill.id)}" data-tip="${esc(tip)}"${lines === undefined ? ` title="${esc(tip)}"` : ` data-tip-lines="${esc(JSON.stringify(lines))}"`} aria-label="${esc(tip)}">${inner}</button>`;
  const showSkillTip = (button) => {
    try {
      const skill = game.skills.getObjectByID(button.dataset.voyageSkill);
      SwalLocale.fire({
        didRender: state.popupDidRender,
        title: skill?.name ?? '',
        html: helpLayout.msgHtml((button.dataset.tip ?? '').split('\n').map(esc)),
        confirmButtonText: getLangString('MOD_VOY_BUTTON_OK'),
        customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass(SWAL_CLASS) : SWAL_CLASS,
      });
    } catch (e) { log('skill popup failed', e); }
  };

  /**
   * The game page a skill is trained on, or undefined: the page whose `action` is the skill (the game's own), else one
   * that lists it in `skills` (a mod's page, Hiring's; build .269, the user: "click on our Hiring does not open the
   * skill page").
   */
  const skillPage = (id) => {
    try {
      const skill = game.skills.getObjectByID(id);
      if (skill === undefined) return undefined;
      return game.pages.find((p) => p.action === skill) ?? game.pages.find((p) => p.skills?.includes(skill) === true);
    } catch { return undefined; }
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
        // Nothing here for your level: locked, not "works" (build .277, the user: "it says I can fish here … all of
        // them are locked. fishing 11"; a river's fish start at 20). The tooltip says from which level.
        if (here.length === 0) {
          const later = state.zoneActionsHere(id, { later: true });
          const first = later[0]?.level ?? 1;
          const names = later.filter((a) => (a.level ?? 1) === first).map((a) => a.name).join(', ');
          // The level it opens at, red under the icon as the amber "80%" in Works (build .280, the user: "show red
          // 'lvl' as '80%'").
          const lvl = later.length > 0 ? `<small class="text-danger">${esc(templateLangString('MOD_VOY_PANEL_ZONE_LVL', { level: `${first}` }))}</small>` : '';
          // Styled as the other locked tooltips (build .282): the verdict, then from which level.
          const lines = [lockedHead(skill, name), later.length > 0 ? templateLangString('MOD_VOY_PANEL_ZONE_FROM', { level: `${first}`, names }) : getLangString('MOD_VOY_PANEL_ZONE_NONE_HERE')];
          locked.push(skillIcon(skill, later.length > 0
            ? templateLangString('MOD_VOY_PANEL_ZONE_LATER', { skill: name, level: `${first}`, names })
            : templateLangString('MOD_VOY_PANEL_ZONE_NEVER', { skill: name }), `<img class="skill-icon-xs voyage-skill-locked" src="${skill.media}" alt="">${lvl}`, lvl === '' ? '' : 'voyage-skill-rate', lines));
          continue;
        }
        zoneNote = here.slice(0, 8).map((a) => a.name).join(', ') + (here.length > 8 ? ', …' : '');
      }
      // One sentence each (build .279, the user: "Thieving: works here Here: Man." read badly): "Thieving works here:
      // Man.", "Woodcutting works here at 80%: Normal Tree, Oak Tree."
      const pct = `${Math.round(rate * 100)}`;
      const worksTip = (full) => (zoneNote === ''
        ? templateLangString(full ? 'MOD_VOY_PANEL_SKILL_WORKS' : 'MOD_VOY_PANEL_SKILL_WORKS_AT', { skill: name, percent: pct })
        : templateLangString(full ? 'MOD_VOY_PANEL_SKILL_WORKS_LIST' : 'MOD_VOY_PANEL_SKILL_WORKS_AT_LIST', { skill: name, percent: pct, names: zoneNote }));
      if (rate >= 1) { works.push(skillIcon(skill, worksTip(true), `<img class="skill-icon-xs" src="${skill.media}" alt="">`)); continue; }
      if (rate > 0) { works.push(skillIcon(skill, worksTip(false), `<img class="skill-icon-xs" src="${skill.media}" alt=""><small class="text-warning">${pct}%</small>`, 'voyage-skill-rate')); continue; }
      // Tooltip in sentences: "Fishing is locked here. Needs water. Nearest known: 1 hex SW." The compass reading only
      // shows when no place is known; a known one already gives distance and direction.
      const noun = getLangString(rules.ruleNounKey(id));
      const sentences = [templateLangString('MOD_VOY_PANEL_NEEDS', { noun })];
      // The tooltip's rows, styled (build .282, the user: "needs styling"): locked in red with the skill's icon, the
      // need plain, none known dimmed, the compass with its icon and its warmth word in colour.
      const lines = [lockedHead(skill, name), sentences[0]];
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
        lines.push({ text: sentences[sentences.length - 1], cls: 'text-info' });
      } else {
        sentences.push(getLangString('MOD_VOY_PANEL_NONE_KNOWN'));
        lines.push({ text: sentences[sentences.length - 1], cls: 'voyage-tip-dim' });
        const reading = state.compass?.readingFor(id, pos);
        const said = state.compass?.describe(reading);
        if (said !== undefined) {
          sentences.push(said.text);
          lines.push({ text: said.text, item: 'voyage:Wayfinder_Compass', mark: said.word === undefined ? undefined : { text: said.word, cls: `voyage-compass-${reading.word}` } });
        }
      }
      // A row each (build .281, the user: "break that tooltip text onto 3 rows", "or even 4"): locked, what it needs,
      // the nearest known (or none known), the compass. The tooltip keeps line breaks (tips.mjs, pre-line).
      const hint = sentences.join('\n');
      locked.push(skillIcon(skill, templateLangString('MOD_VOY_PANEL_SKILL_LOCKED', { skill: name, hint }), `<img class="skill-icon-xs voyage-skill-locked" src="${skill.media}" alt="">`, '', lines));
    }
    // Zoned skills without a terrain rule (Astrology): works where one of your constellations shows, else locked.
    for (const id of off ? [] : state.zonedUngated?.() ?? []) {
      const skill = game.skills.getObjectByID(id);
      if (skill === undefined) continue;
      const here = state.zoneActionsHere(id);
      if (here.length > 0) {
        const names = here.slice(0, 8).map((a) => a.name).join(', ') + (here.length > 8 ? ', …' : '');
        works.push(skillIcon(skill, templateLangString('MOD_VOY_PANEL_SKILL_WORKS_LIST', { skill: skill.name, names }), `<img class="skill-icon-xs" src="${skill.media}" alt="">`));
      } else {
        locked.push(skillIcon(skill, templateLangString('MOD_VOY_PANEL_SKY_NONE', { skill: skill.name }), `<img class="skill-icon-xs voyage-skill-locked" src="${skill.media}" alt="">`, '', [lockedHead(skill, skill.name), getLangString('MOD_VOY_PANEL_SKY_NONE_ROW')]));
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
  const strandedRow = (text, hint, cls, button = getLangString('MOD_VOY_PANEL_STRANDED_BUTTON'), icon = 'exclamation-triangle') =>
    `<div class="voyage-here-ship voyage-here-stranded" title="${esc(hint)}"><span class="text-warning"><i class="fa fa-${icon} mr-1"></i>${esc(text)}</span>` +
    `<button type="button" class="btn btn-sm btn-warning voyage-row-btn ${cls}">${esc(button)}</button></div>`;
  /**
   * Stranded rows, right under "You are here" (user feedback, build .60): out of GP with the road out unaffordable
   * (Adventure starts with every skill locked), and the stores short of any way to easier ground or a place to load.
   * Each is a row of its own with a button, even where trade works or is not gated (a small link was easy to miss).
   */
  const strandedLines = (status) => {
    // Adrift at sea (5b part two) first, in the same amber row; the trader's rows stay ashore. Under it, what still works.
    const adrift = state.adrift?.chip?.();
    if (adrift !== undefined) {
      return strandedRow(adrift.row, adrift.tip, 'voyage-adrift-link', getLangString('MOD_VOY_ADRIFT_PANEL_BUTTON'), 'water')
        + `<div class="voyage-here-ship text-muted"><span><i class="fa fa-fish mr-1"></i>${esc(getLangString('MOD_VOY_ADRIFT_PANEL_ONLY'))}</span></div>`;
    }
    let out = status === 'stranded' ? strandedRow(getLangString('MOD_VOY_PANEL_STRANDED'), getLangString('MOD_VOY_PANEL_STRANDED_HINT'), 'voyage-trader-link') : '';
    try {
      const api = state.stores;
      if (api?.enabled() && api.rescue() !== undefined) {
        out += strandedRow(getLangString('MOD_VOY_PANEL_HUNGRY'), getLangString('MOD_VOY_PANEL_HUNGRY_HINT'), 'voyage-rescue-link');
      }
    } catch (e) { log('provisions status failed', e); }
    return out;
  };

  /** At a port: the harbour board's button (cargo runs, phase 4) and what waits here. */
  const harbourLine = () => {
    try { return state.cargo?.panelLine() ?? ''; } catch (e) { log('harbour line failed', e); return ''; }
  };
  /** Trade status on its own line under the terrain line; empty while trade is not gated. */
  const tradeLine = (status) => {
    if (!state.active() || !state.settings.trade()) return '';
    // "Trade: OK" / "Trade: not here", laid out like the "Combat:" and "Works:" rows (label muted, same size as the value).
    const label = `<span class="voyage-here-label">${esc(getLangString('MOD_VOY_PANEL_TRADE_LABEL'))}</span> `;
    // "OK" opens the bank, where the selling is (build .267).
    if (!state.tradeLocked?.()) return `<div class="voyage-here-place">${label}<button type="button" class="voyage-here-link voyage-bank-link text-success" title="${esc(getLangString('MOD_VOY_PANEL_TRADE_OK_HINT'))}">${esc(getLangString('MOD_VOY_PANEL_TRADE_OK'))}</button></div>`;
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

  /**
   * Where your vessels are (phase 3b): aboard, or moored with a link that centres the map on it. With the big ship
   * (build .150) one line each; the small boat riding aboard the big ship has none of its own.
   */
  const shipLine = () => {
    const sh = state.ship;
    if (sh?.boat() == null || !sh.enabled()) return '';
    const kinds = sh.big?.() != null ? ['ship', 'boat'] : ['boat'];
    return kinds.map((kind) => {
      const v = sh.vessel(kind);
      if (v == null || (kind === 'boat' && v.aboard === true)) return '';
      const name = sh.hullName?.(v) ?? getLangString('MOD_VOY_SHIP_BOAT');
      // Hull condition (3d), only once it is worn: amber below 50%, red when worn through.
      const c = sh.cond?.(kind) ?? 100;
      const hull = c >= 100 ? '' : ` <span class="voyage-keep ${c <= 0 ? 'text-danger' : c < 50 ? 'text-warning' : 'text-muted'}">(${esc(templateLangString('MOD_VOY_PANEL_HULL', { cond: `${c}` }))})</span>`;
      if (sh.inVessel() === kind) return `<div class="voyage-here-ship text-info"><span><i class="fa fa-ship mr-1"></i>${esc(templateLangString('MOD_VOY_PANEL_ABOARD', { hull: name }))}${hull}</span></div>`;
      return `<div class="voyage-here-ship"><span><i class="fa fa-anchor mr-1"></i>${esc(templateLangString('MOD_VOY_PANEL_MOORED', { hull: name, where: sh.whereIs(v, true) }))}${hull}</span>` +
        `<button type="button" class="btn btn-sm btn-outline-info voyage-row-btn voyage-find-ship" data-kind="${kind}">${esc(getLangString('MOD_VOY_PANEL_SHOW_SHIP'))}</button></div>`;
    }).join('');
  };

  /**
   * A hull upgrade ready to build where you stand (build .183, the user: the map gave no sign of it): at a port, with
   * the hull at the quay, the level and every material. One line per vessel; the button opens the Voyage page at the
   * upgrade, where the build itself is.
   */
  const shipyardLine = () => {
    const sh = state.ship;
    if (sh?.boat() == null || !sh.enabled()) return '';
    return ['boat', 'ship'].map((kind) => {
      const info = sh.upgradeInfo?.(kind);
      if (info === undefined || info.blocker !== undefined) return '';
      const hull = sh.hullName({ hull: info.id });
      return `<div class="voyage-here-ship"><span><i class="fa fa-hammer mr-1"></i>${esc(templateLangString('MOD_VOY_PANEL_SHIPYARD_READY', { hull }))}</span>` +
        `<button type="button" class="btn btn-sm btn-outline-info voyage-row-btn voyage-shipyard-link" title="${esc(getLangString('MOD_VOY_PANEL_SHIPYARD_HINT'))}">${esc(getLangString('MOD_VOY_PANEL_SHIPYARD_BUTTON'))}</button></div>`;
    }).join('');
  };

  /**
   * The Crossroads Sign on this hex (build .162): "Plant here" on a place with buffs while it is
   * carried, "Pick up" where it stands. Nothing anywhere else.
   */
  const signLine = () => {
    const L = state.land;
    if (L === undefined) return '';
    const act = L.signAction();
    if (act !== 'place' && act !== 'pickup') return '';
    const text = getLangString(act === 'place' ? 'MOD_VOY_PANEL_SIGN_CAN_PLACE' : 'MOD_VOY_PANEL_SIGN_HERE');
    const btn = act === 'place'
      ? `<button type="button" class="btn btn-sm btn-success voyage-row-btn voyage-sign-place">${esc(getLangString('MOD_VOY_PAGE_SIGN_PLACE'))}</button>`
      : `<button type="button" class="btn btn-sm btn-outline-info voyage-row-btn voyage-sign-pickup">${esc(getLangString('MOD_VOY_PAGE_SIGN_PICKUP'))}</button>`;
    return `<div class="voyage-here-ship"><span><span class="voyage-here-label">${esc(getLangString('MOD_VOY_PANEL_SIGN_LABEL'))}</span> ${esc(text)}</span>${btn}</div>`;
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

  /** Under way (phase 5a): where to and the time left, as of the hex entered last. */
  const wayFill = (way) => `<span class="voyage-way-fill" data-voyage-way="fill" style="width:${(way.frac * 100).toFixed(1)}%" aria-hidden="true"></span>`;
  // The bars and times move twice a second while under way, between the panel's own redraws.
  setInterval(() => {
    try {
      const fills = document.querySelectorAll('[data-voyage-way="fill"]');
      if (fills.length === 0) return;
      const way = state.clock?.chip?.();
      if (way === undefined) return;
      const w = `${(way.frac * 100).toFixed(1)}%`;
      fills.forEach((f) => { if (f.style.width !== w) f.style.width = w; });
      const left = templateLangString('MOD_VOY_PANEL_UNDERWAY_LEFT', { left: way.text });
      document.querySelectorAll('[data-voyage-way="left"]').forEach((x) => { if (x.textContent !== left) x.textContent = left; });
      document.querySelectorAll('[data-voyage-way="chip"]').forEach((x) => { if (x.textContent !== way.text) x.textContent = way.text; });
    } catch {}
  }, 500);
  const underwayLine = () => {
    const way = state.clock?.chip?.();
    if (way === undefined) return '';
    // Where to in blue, the time left in the plain text colour on the right, as the stores line's values (the user,
    // build .246: "show in diff color").
    const to = templateLangString(way.tow ? 'MOD_VOY_PANEL_TOW_TO' : 'MOD_VOY_PANEL_UNDERWAY_TO', { name: way.name ?? '' });
    // A travel bar (the user, 19 Oct 2026: "a horizontal fill bar with running overlay"): the line fills as the voyage
    // goes; wayFill moves it between redraws.
    return `<div class="voyage-here-ship voyage-way" title="${esc(way.tip)}">${wayFill(way)}<span class="text-info"><i class="fa fa-${way.tow ? 'anchor' : 'route'} mr-1"></i>${esc(to)}</span>`
      + `<span class="voyage-here-left" data-voyage-way="left">${esc(templateLangString('MOD_VOY_PANEL_UNDERWAY_LEFT', { left: way.text }))}</span></div>`;
  };

  /** The ship and stores lines in one band with its own background (user feedback, build .58). */
  // Night first (the user, build .228), then the boat, then the voyage under way (the user, build .233).
  const shipBox = () => {
    const inner = nightLine() + shipLine() + underwayLine() + shipyardLine() + storesLine();
    return inner === '' ? '' : `<div class="voyage-here-shipbox">${inner}</div>`;
  };

  /**
   * The mini panel: the folded panel as one short strip, as wide as its content. The terrain, then
   * chips chosen by the situation, in priority order, at most MINI_CHIPS of them besides a stranded warning.
   */
  const MINI_CHIPS = 5;
  const chip = (inner, tip, cls = '', btn = '', attrs = '') => btn === ''
    ? `<span class="voyage-chip ${cls}" title="${esc(tip)}" aria-label="${esc(tip)}">${inner}</span>`
    : `<button type="button" class="voyage-chip voyage-chip-btn ${cls} ${btn}" title="${esc(tip)}" aria-label="${esc(tip)}"${attrs}>${inner}</button>`;
  const miniChips = (pos, status) => {
    const out = [];
    const st = state.stores;
    const on = st?.enabled?.() === true;
    // 1b. Under way (phase 5a): the time left, as of the hex entered last.
    const way = state.clock?.chip?.();
    // Each chip's tap hint is a row of its own in the tooltip (build .283, the user: "Tap to open - move on separate row").
    // The strip's chips go where they are about (build .267, the user: "maybe every skill icon can open respective
    // skill page?"): under way to its block on the Voyage page, the stores to Stores, the hull to the vessel.
    if (way !== undefined) out.push(chip(`${wayFill(way)}<i class="fa fa-${way.tow ? 'anchor' : 'route'} mr-1"></i><span data-voyage-way="chip">${esc(way.text)}</span>`, `${way.tip}\n${getLangString('MOD_VOY_MINI_WAY_HINT')}`, 'text-info voyage-way', 'voyage-chip-link voyage-way-link'));
    // 2. Stores, coloured like the panel's line: Stock up itself where you can stock up (the user: "move Stock up
    // button onto the Stores stats"), ringed blue with a plus then.
    const have = on ? st.stores() : undefined;
    if (have !== undefined) {
      const low = have.food <= 0 || have.fuel <= 0 ? 'text-danger' : have.food < storesModel.LOW.food || have.fuel < storesModel.LOW.fuel ? 'text-warning' : '';
      const cap = st.capacity();
      const load = st.loadingHere() !== undefined && (have.food < cap.food || have.fuel < cap.fuel);
      out.push(chip(st.icons(have.food, have.fuel, false) + (load ? '<i class="fa fa-plus-circle text-info ml-1" aria-hidden="true"></i>' : ''),
        `${st.amounts(have.food, have.fuel)}.\n${getLangString(load ? 'MOD_VOY_MINI_LOAD_HINT' : 'MOD_VOY_MINI_STORES_HINT')}`, `${low}${load ? ' voyage-chip-load' : ''}`, 'voyage-chip-link voyage-load-link'));
    }
    // 3. Hull, once worn.
    const sh = state.ship;
    if (sh?.boat?.() != null && sh.enabled()) {
      // The more worn of your vessels (build .150: the big ship has its own hull).
      const kind = sh.big?.() != null && (sh.cond?.('ship') ?? 100) < (sh.cond?.('boat') ?? 100) ? 'ship' : 'boat';
      const c = sh.cond?.(kind) ?? 100;
      if (c < 100) {
        // The name starts the tooltip, so it takes a capital (build .270, the user: "ship name - capitalize").
        const named = sh.hullName?.(sh.vessel(kind)) ?? getLangString('MOD_VOY_SHIP_BOAT');
        const tip = `${named.charAt(0).toUpperCase()}${named.slice(1)}: ${templateLangString('MOD_VOY_PANEL_HULL', { cond: `${c}` })}`;
        out.push(chip(`<i class="fa fa-ship mr-1"></i>${c}%`, `${tip}.\n${getLangString('MOD_VOY_MINI_HULL_HINT')}`, c <= 0 ? 'text-danger' : c < 50 ? 'text-warning' : '', 'voyage-chip-link voyage-find-ship', ` data-kind="${kind}"`));
      }
    }
    // 4. Night only: fuel buys light then.
    const tod = on ? st.timeOfDay?.() : undefined;
    if (tod?.night) {
      const hint = templateLangString('MOD_VOY_PANEL_NIGHT_HINT', { land: `${storesModel.LIGHT.land}`, sea: `${storesModel.LIGHT.sea}`, bonus: `${Math.round(model.STAR_XP * 100)}` });
      out.push(chip(`<i class="fa fa-moon mr-1"></i>${esc(tod.until)}`, `${templateLangString('MOD_VOY_PANEL_NIGHT', { time: tod.until })}. ${hint}`, 'text-info'));
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
    // 7. What works here: four icons, then +N. Combat first when an area is in reach (build .278, the user: "we need
    // some indication that combat available at the place"): the Combat icon, its areas in the tooltip, a tap opens the
    // first as the panel's Combat button does. In the skills chip, so the chip limit never drops it.
    const { works, off } = skillLists(pos);
    if (!off) {
      let fight = '';
      try {
        const areas = state.settings.combat() ? state.combatHere?.() ?? [] : [];
        if (areas.length > 0) {
          // Several in reach: the tap unfolds the panel, its Combat row has a button each (build .280, the user's pick).
          const one = areas.length === 1;
          const tip = `${templateLangString('MOD_VOY_MINI_COMBAT', { areas: areas.map((a) => a.name).join(', ') })}\n${getLangString(one ? 'MOD_VOY_MINI_COMBAT_HINT' : 'MOD_VOY_MINI_COMBAT_PICK')}`;
          const media = game.pages.getObjectByID('melvorD:Combat')?.media ?? '';
          fight = `<button type="button" class="voyage-skill-btn voyage-fight-chip"${one ? ` data-area="${esc(areas[0].id)}"` : ''} title="${esc(tip)}" aria-label="${esc(tip)}"><img class="skill-icon-xs" src="${esc(media)}" alt=""></button>`;
        }
      } catch (e) { log('combat chip failed', e); }
      out.push(works.length === 0
        // The Combat icon beside the "nothing" chip, not in it: one tooltip each (build .283).
        ? `${fight === '' ? '' : `<span class="voyage-chip voyage-chip-skills">${fight}</span>`}${chip(`<span class="text-danger">${esc(getLangString('MOD_VOY_MINI_WORKS_NONE'))}</span>`, getLangString('MOD_VOY_PANEL_WORKS_NONE'))}`
        : `<span class="voyage-chip voyage-chip-skills">${fight}${works.slice(0, 4).join('')}${works.length > 4 ? `<small class="text-muted">+${works.length - 4}</small>` : ''}</span>`);
    }
    return out.slice(0, MINI_CHIPS);
  };
  /** The stranded or hungry warning, or the wandering trader on your hex: the strip's first chips, and beside the phone square. */
  const warnChips = (status) => {
    const warn = [];
    // Adrift (5b part two): the amber slot, first; the trader's warnings stay ashore.
    const adrift = state.adrift?.chip?.();
    if (adrift !== undefined) warn.push(chip(`<i class="fa fa-water mr-1"></i>${esc(adrift.text)}`, adrift.tip, 'btn btn-sm btn-warning', 'voyage-adrift-link'));
    else if (status === 'stranded') warn.push(chip(`<i class="fa fa-exclamation-triangle mr-1"></i>${esc(getLangString('MOD_VOY_PANEL_STRANDED_BUTTON'))}`, getLangString('MOD_VOY_PANEL_STRANDED_HINT'), 'btn btn-sm btn-warning', 'voyage-trader-link'));
    else {
      try { if (state.stores?.enabled() && state.stores.rescue() !== undefined) warn.push(chip(`<i class="fa fa-exclamation-triangle mr-1"></i>${esc(getLangString('MOD_VOY_PANEL_STRANDED_BUTTON'))}`, getLangString('MOD_VOY_PANEL_HUNGRY_HINT'), 'btn btn-sm btn-warning', 'voyage-rescue-link')); } catch {}
    }
    // The wandering trader on your hex: he comes with being stranded, so he stands with its warning (seen on .123:
    // as the last chip he fell off a full strip).
    if (status === 'here' && state.settings.trade()) warn.push(chip('<i class="fa fa-store"></i>', getLangString('MOD_VOY_PANEL_TRADER_HERE_HINT'), 'voyage-chip-plain text-warning', 'voyage-chip-tip'));
    return warn;
  };
  /**
   * The square (the user, 18 Oct 2026, on a 375 x 667 phone: "one more level of collapsing if user with the
   * phone/touchscreen holds ones finger on the grasslands"): press and hold the strip's caret and the strip
   * shrinks to one small square with a captain's cap at the map's top left; a tap on it brings the strip back. A dot
   * on it says the stores or the hull need a look (amber low, red empty); a stranded warning stays beside it.
   */
  const PHONE = '(max-width: 767.98px)';
  const phone = () => window.matchMedia?.(PHONE).matches === true;
  // The Voyage skill's own icon, the captain (the user, 18 Oct 2026).
  const captainIcon = () => `<img class="voyage-tuck-icon" src="${ctx.getResourceUrl('assets/icon.webp')}" alt="">`;
  /** '' when all is well, 'warn' or 'bad' for the square's dot: stores low or empty, hull below half or at 0. */
  const tuckAlert = () => {
    let level = '';
    const raise = (l) => { if (l === 'bad' || (l === 'warn' && level === '')) level = l; };
    try {
      const st = state.stores;
      const have = st?.enabled?.() === true ? st.stores() : undefined;
      if (have !== undefined) raise(have.food <= 0 || have.fuel <= 0 ? 'bad' : have.food < storesModel.LOW.food || have.fuel < storesModel.LOW.fuel ? 'warn' : '');
      const sh = state.ship;
      if (sh?.boat?.() != null && sh.enabled()) for (const kind of ['boat', 'ship']) {
        if (kind === 'ship' && sh.big?.() == null) continue;
        const c = sh.cond?.(kind) ?? 100;
        raise(c <= 0 ? 'bad' : c < 50 ? 'warn' : '');
      }
    } catch (e) { log('square alert failed', e); }
    return level;
  };
  const tuckHtml = (tip, status) => {
    const alert = tuckAlert();
    const label = `${getLangString('MOD_VOY_PANEL_YOU_ARE_HERE')}: ${tip}.${alert === '' ? '' : ` ${getLangString(alert === 'bad' ? 'MOD_VOY_PANEL_TUCK_BAD' : 'MOD_VOY_PANEL_TUCK_WARN')}`} ${getLangString('MOD_VOY_PANEL_UNTUCK')}`;
    return `<div class="voyage-tuck-row"><button type="button" class="voyage-panel-toggle voyage-tuck" aria-expanded="false" title="${esc(label)}" aria-label="${esc(label)}">`
      + `${captainIcon()}${alert === '' ? '' : `<span class="voyage-tuck-dot voyage-tuck-${alert}" aria-hidden="true"></span>`}</button>${warnChips(status).join('')}</div>`;
  };
  const miniHtml = (pos, d, tip, status) => {
    const swatch = d.css ? `<span class="voyage-swatch" style="background:${d.css}"></span>` : '';
    const warn = warnChips(status);
    const unfold = getLangString('MOD_VOY_PANEL_UNFOLD');
    const hold = getLangString('MOD_VOY_PANEL_HOLD_TUCK');
    // The caret is its own button (the user, 18 Oct 2026): a tap unfolds, a press and hold on a touchscreen shrinks the
    // strip to the square. The terrain name unfolds too and keeps its tooltip.
    return `<div class="voyage-mini-row"><button type="button" class="voyage-panel-toggle voyage-mini-caret" data-tip-touch="off" aria-expanded="false" aria-label="${esc(`${unfold}. ${hold}`)}"><i class="fa fa-caret-right"></i></button>` +
      `<button type="button" class="voyage-panel-toggle voyage-mini-toggle" aria-expanded="false" title="${esc(`${tip}.\n${unfold}`)}" aria-label="${esc(`${tip}. ${unfold}`)}">` +
      `${swatch}${esc(d.label)}</button>${warn.join('')}${miniChips(pos, status).join('')}</div>`;
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
  const TUCK_KEY = 'voyage-panel-tucked';
  // The square remembers what it was shrunk from (the user, build .208): '1' the strip, 'open' the open panel; a tap on
  // it gives that back.
  let tuckFrom = (() => { try { const v = localStorage.getItem(TUCK_KEY); return v === 'open' ? 'open' : v === '1' ? 'strip' : undefined; } catch { return undefined; } })();
  let panelTucked = tuckFrom !== undefined;
  const setTucked = (on, from = 'strip') => {
    panelTucked = on;
    tuckFrom = on ? from : undefined;
    try { localStorage.setItem(TUCK_KEY, on ? (from === 'open' ? 'open' : '1') : '0'); } catch {}
  };
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
    capHeight();
  };

  /**
   * On a phone the open panel stops a little past the middle of the map and scrolls inside (the user, 18 Oct 2026:
   * it ran to the bottom of a 375 x 667 screen). Measured from the map's visible height, again on every resize.
   */
  const CAP = 0.55;
  const capHeight = () => {
    try {
      const panel = document.getElementById(PANEL_ID);
      if (!panel) return;
      const map = typeof cartographyMap !== 'undefined' ? cartographyMap?.bottomLeftOverlay?.parentElement : undefined;
      const on = panel.classList.contains('voyage-here-top') && !panel.classList.contains('voyage-mini') && !panel.classList.contains('voyage-tucked') && phone() && map != null;
      panel.classList.toggle('voyage-capped', on);
      if (!on) { panel.style.maxHeight = ''; return; }
      const m = map.getBoundingClientRect();
      const bottom = Math.min(m.bottom, window.innerHeight);
      const limit = m.top + (bottom - m.top) * CAP - panel.getBoundingClientRect().top;
      panel.style.maxHeight = `${Math.max(160, Math.round(limit))}px`;
    } catch (e) { log('panel height failed', e); }
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

  const HOLD_MS = 500;
  let holdUntil = 0;
  const ensurePanel = () => {
    if (typeof cartographyMap === 'undefined' || cartographyMap === null) return undefined;
    let panel = document.getElementById(PANEL_ID);
    if (panel !== null) return panel;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'voyage-ui block block-rounded bg-combat-inner-dark p-2 mb-2';
    panel.addEventListener('click', (e) => {
      if (e.target instanceof Element && e.target.closest('.voyage-trader-link')) { e.preventDefault(); state.trader?.offer(); }
      if (e.target instanceof Element && e.target.closest('.voyage-harbour-link')) { e.preventDefault(); state.cargo?.open(); }
      if (e.target instanceof Element && e.target.closest('.voyage-rescue-link')) { e.preventDefault(); state.stores?.offer(); }
      if (e.target instanceof Element && e.target.closest('.voyage-adrift-link')) { e.preventDefault(); state.adrift?.explain(); }
      if (e.target instanceof Element && e.target.closest('.voyage-sign-place')) { e.preventDefault(); state.land?.place(); render(); return; }
      if (e.target instanceof Element && e.target.closest('.voyage-sign-pickup')) { e.preventDefault(); state.land?.pickup(); render(); return; }
      if (e.target instanceof Element && e.target.closest('.voyage-locked-toggle')) {
        lockedOpen = !lockedOpen;
        try { localStorage.setItem(LOCKED_KEY, lockedOpen ? '1' : '0'); } catch {}
        render();
        return;
      }
      // A skill icon opens the skill's page (build .267, the user); what it finds here is its tooltip (press and hold
      // on touch). A skill with no page of its own keeps the popup.
      const skillBtn = e.target instanceof Element ? e.target.closest('.voyage-skill-btn:not(.voyage-fight-chip)') : null;
      if (skillBtn !== null) {
        const page = skillPage(skillBtn.dataset.voyageSkill);
        if (page !== undefined) state.openPage(page); else showSkillTip(skillBtn);
        return;
      }
      if (e.target instanceof Element && e.target.closest('.voyage-way-link')) {
        e.preventDefault();
        try {
          state.openPage(game.pages.getObjectByID('voyage:Voyage'));
          state.pageLayout?.unfold('underway-block');
          setTimeout(() => document.querySelector('#voyage-container [data-voyage="underway-block"]')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 100);
        } catch (err) { log('Under way link failed', err); }
        return;
      }
      if (e.target instanceof Element && e.target.closest('.voyage-bank-link')) {
        e.preventDefault();
        try { state.openPage(game.pages.getObjectByID('melvorD:Bank')); } catch (err) { log('bank link failed', err); }
        return;
      }
      if (e.target instanceof Element && e.target.closest('.voyage-works-toggle')) {
        worksOpen = !worksOpen;
        try { localStorage.setItem(WORKS_KEY, worksOpen ? '1' : '0'); } catch {}
        render();
        return;
      }
      if (e.target instanceof Element && e.target.closest('.voyage-mini-caret, .voyage-open-caret, .voyage-mini-toggle, .voyage-tuck') && Date.now() < holdUntil) { e.preventDefault(); return; } // the hold just tucked it: its lift is no tap
      if (e.target instanceof Element && e.target.closest('.voyage-tuck')) {
        const back = tuckFrom;
        setTucked(false);
        if (back === 'open') { panelOpen = true; try { localStorage.setItem(PANEL_KEY, '1'); } catch {} }
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
      const findShip = e.target instanceof Element ? e.target.closest('.voyage-find-ship') : null;
      if (findShip !== null) {
        e.preventDefault();
        try { const hex = state.ship?.hex(findShip.dataset.kind ?? 'boat'); if (hex !== undefined) state.ship.centreOn(hex); } catch (err) { log('find ship failed', err); }
      }
      const fight = e.target instanceof Element ? e.target.closest('.voyage-fight-link, .voyage-fight-chip') : null;
      if (fight !== null && fight.dataset.area === undefined) {
        e.preventDefault();
        panelOpen = true;
        try { localStorage.setItem(PANEL_KEY, '1'); } catch {}
        render();
        return;
      }
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
      if (e.target instanceof Element && e.target.closest('.voyage-shipyard-link')) {
        e.preventDefault();
        try {
          state.openPage(game.pages.getObjectByID('voyage:Voyage'));
          setTimeout(() => document.querySelector('#voyage-container [data-voyage-action="upgrade"]')?.scrollIntoView({ block: 'center' }), 100);
        } catch (err) { log('shipyard link failed', err); }
        return;
      }
      // Stock up (the open panel's stores row and the strip's chip; build .266, the user: "open skill page and scroll
      // to block"): the Voyage page at its Stores block, opened if it was folded.
      if (e.target instanceof Element && e.target.closest('.voyage-load-link')) {
        e.preventDefault();
        try {
          state.openPage(game.pages.getObjectByID('voyage:Voyage'));
          state.pageLayout?.unfold('stores-block');
          setTimeout(() => document.querySelector('#voyage-container [data-voyage="stores-block"]')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 100);
        } catch (err) { log('Stock up link failed', err); }
        return;
      }
      if (e.target instanceof Element && e.target.closest('.voyage-manage-link')) {
        e.preventDefault();
        try { state.openPage(game.pages.getObjectByID('voyage:Voyage')); } catch (err) { log('Manage voyage link failed', err); }
      }
    });
    // Press and hold the strip's caret, or the open panel's "You are here" (touch only; the user, 18 Oct 2026), to
    // shrink it to the square. A tap on the square gives back what it was shrunk from (build .208).
    let holdTimer = 0;
    let holdAt = undefined;
    const stopHold = () => { clearTimeout(holdTimer); holdTimer = 0; holdAt = undefined; };
    panel.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || !(e.target instanceof Element) || e.target.closest('.voyage-mini-caret, .voyage-open-caret') === null) return;
      stopHold();
      holdAt = { x: e.clientX, y: e.clientY };
      holdTimer = setTimeout(() => {
        holdTimer = 0;
        holdUntil = Date.now() + 800;
        try { navigator.vibrate?.(15); } catch {}
        const from = panelOpen ? 'open' : 'strip';
        if (panelOpen) { panelOpen = false; try { localStorage.setItem(PANEL_KEY, '0'); } catch {} }
        setTucked(true, from);
        render();
      }, HOLD_MS);
    });
    panel.addEventListener('pointermove', (e) => { if (holdAt !== undefined && Math.hypot(e.clientX - holdAt.x, e.clientY - holdAt.y) > 10) stopHold(); });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) panel.addEventListener(type, stopHold);
    panel.addEventListener('contextmenu', (e) => { if (e.target instanceof Element && e.target.closest('.voyage-mini-caret, .voyage-open-caret, .voyage-tuck')) e.preventDefault(); });
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

  const draw = () => {
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
      // The place's name and its coordinates move to the next line as one, never split (build .286, the user: "if name +
      // cords don't fit in line it goes on next line as whole"); a name wider than the panel still wraps inside.
      const where = `${place ? ' · ' : ' '}<span class="voyage-keep">${place ? `${place} ` : ''}${coordsOf(pos)}</span>`;
      const swatch = d.css ? `<span class="voyage-swatch" style="background:${d.css}"></span>` : '';
      const features = d.features.length > 0 ? ` · ${esc(d.features.join(', '))}` : '';
      const mode = state.mode === 'relaxed' ? `<div><small class="text-warning">${esc(getLangString('MOD_VOY_PANEL_TABLE_MISMATCH'))}</small></div>` : '';
      const status = traderStatus();
      const tucked = !panelOpen && panelTucked;
      panel.classList.toggle('voyage-mini', !panelOpen && !tucked);
      panel.classList.toggle('voyage-tucked', tucked);
      if (!panelOpen) {
        const tip = `${d.label}${d.features.length > 0 ? ` · ${d.features.join(', ')}` : ''}${place ? ` · ${[poi, d.area].filter(Boolean).join(', ')}` : ''} ${coordsOf(pos)}`;
        panel.innerHTML = tucked ? tuckHtml(tip, status) : miniHtml(pos, d, tip, status) + mode;
        placeUnderBar();
        return;
      }
      panel.innerHTML =
        `<div class="voyage-here-head"><button type="button" class="voyage-panel-toggle voyage-open-caret" data-tip-touch="off" aria-expanded="${panelOpen}" title="${esc(getLangString(panelOpen ? 'MOD_VOY_PANEL_FOLD' : 'MOD_VOY_PANEL_UNFOLD'))}" aria-label="${esc(`${getLangString(panelOpen ? 'MOD_VOY_PANEL_FOLD' : 'MOD_VOY_PANEL_UNFOLD')}. ${getLangString('MOD_VOY_PANEL_HOLD_TUCK')}`)}">` +
        `<i class="fa fa-caret-${panelOpen ? 'down' : 'right'} mr-1"></i>${esc(getLangString('MOD_VOY_PANEL_YOU_ARE_HERE'))}</button>${manageLink()}</div>` +
        strandedLines(status) +
        `<div>${swatch}${esc(d.label)}<small class="text-muted">${features}${where}</small></div>` +
        shipBox() +
        tradeLine(status) +
        harbourLine() +
        fightLine() +
        signLine() +
        mode +
        `<div class="voyage-skills">${skillRows(pos, rec)}</div>` +
        (state.settings.overlay() ? legendBlock() : '');
      placeUnderBar();
      alignRowButtons(true);
    } catch (e) { log('here panel failed', e); }
  };
  /** Draws the panel, then gives its titles Melvor's tooltips (build .160). */
  const render = () => {
    draw();
    try { state.tips?.apply(document.getElementById(PANEL_ID)); } catch (e) { log('tooltips failed', e); }
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
  // A level gained can open a zoned skill here (build .280): Works and Locked follow at once.
  ctx.patch(Skill, 'onLevelUp').after(function () { try { if (state.zoneTable?.skills?.[this.id] !== undefined) setTimeout(render, 0); } catch {} });
  ctx.onCharacterLoaded(() => {
    try { game.cartography?.on('travel', () => setTimeout(render, 0)); } catch (e) { log('travel hook failed', e); }
  });
  state.listeners.push(render);
  return { render };
}
