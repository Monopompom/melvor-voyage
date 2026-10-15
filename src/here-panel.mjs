// "You are here" panel in the map's bottom-left overlay (next to the survey overview), a terrain line in
// the hex overview that opens when a hex is selected, and a legend. Re-rendered on travel, on page
// visible and on settings changes. Everything is wrapped: a failing panel never touches the game.

const PANEL_ID = 'voyage-here';

export function install(ctx, { state, rules, terrainMod, log }) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Display text comes from languages/<code>.json; the English labels in terrain.mjs/rules.mjs are for tests and logs.
  const classLabel = (cls) => (terrainMod.CLASS_INFO[cls] !== undefined ? getLangString(terrainMod.classKey(cls)) : cls);
  const featureLabel = (f) => (terrainMod.FEATURE_INFO[f] !== undefined ? getLangString(terrainMod.featureKey(f)) : f);

  const describe = (rec) => {
    if (rec === undefined) return { label: getLangString('MOD_VOY_PANEL_UNCHARTED'), features: [] };
    const info = rec.cloud === true ? terrainMod.CLOUD_INFO : terrainMod.CLASS_INFO[rec.t];
    const features = (rec.f ?? []).map(featureLabel);
    const label = rec.cloud === true
      ? templateLangString('MOD_VOY_PANEL_CLOUD_OVER', { cloud: getLangString(terrainMod.CLOUD_KEY), terrain: classLabel(rec.t).toLowerCase() })
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

  /** One icon per gated skill: full, penalised (with a % badge) or locked (dimmed); the tooltip says why. */
  const skillRows = (pos, rec) => {
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
      if (rate >= 1) { works.push(`<img class="skill-icon-xs" src="${skill.media}" title="${esc(templateLangString('MOD_VOY_PANEL_SKILL_WORKS', { skill: name }) + zoneNote)}">`); continue; }
      if (rate > 0) { works.push(`<span class="voyage-skill-rate" title="${esc(templateLangString('MOD_VOY_PANEL_SKILL_WORKS_AT', { skill: name, percent: `${Math.round(rate * 100)}` }) + zoneNote)}"><img class="skill-icon-xs" src="${skill.media}"><small>${Math.round(rate * 100)}%</small></span>`); continue; }
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
      locked.push(`<img class="skill-icon-xs voyage-skill-locked" src="${skill.media}" title="${esc(templateLangString('MOD_VOY_PANEL_SKILL_LOCKED', { skill: name, hint }))}">`);
    }
    // Zoned skills without a terrain rule (Astrology): works where one of your constellations shows, else locked.
    for (const id of off ? [] : state.zonedUngated?.() ?? []) {
      const skill = game.skills.getObjectByID(id);
      if (skill === undefined) continue;
      const here = state.zoneActionsHere(id);
      if (here.length > 0) {
        const names = here.slice(0, 8).map((a) => a.name).join(', ') + (here.length > 8 ? ', …' : '');
        works.push(`<img class="skill-icon-xs" src="${skill.media}" title="${esc(`${templateLangString('MOD_VOY_PANEL_SKILL_WORKS', { skill: skill.name })} ${templateLangString('MOD_VOY_PANEL_ZONE_HERE', { names })}`)}">`);
      } else {
        locked.push(`<img class="skill-icon-xs voyage-skill-locked" src="${skill.media}" title="${esc(templateLangString('MOD_VOY_PANEL_SKY_NONE', { skill: skill.name }))}">`);
      }
    }
    const note = off ? 'MOD_VOY_PANEL_RULES_OFF' : state.settings.strictness() === 'relaxed' ? 'MOD_VOY_PANEL_RELAXED' : undefined;
    const rulesNote = note !== undefined ? ` <small class="text-muted">${esc(getLangString(note))}</small>` : '';
    return `<div class="voyage-skillrow"><span class="voyage-here-label">${esc(getLangString('MOD_VOY_PANEL_WORKS'))}</span> ${works.join('') || `<span>${esc(getLangString('MOD_VOY_PANEL_WORKS_NONE'))}</span>`}${rulesNote}</div>` +
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
    return `<button type="button" class="btn btn-sm btn-info voyage-manage-link"><i class="fa fa-ship mr-1"></i>${esc(getLangString('MOD_VOY_PANEL_MANAGE'))}</button>`;
  };

  /** Trade status on its own line under the terrain line; empty while trade is not gated. */
  const tradeLine = () => {
    if (!state.active()) return '';
    let status;
    try { status = state.trader?.status(); } catch (e) { log('trader status failed', e); }
    // Stranded (nothing here earns GP and the road out is unaffordable; Adventure starts with every skill locked): a row
    // of its own with a button, like the boat line, even where trade works or is not gated (user feedback: a small
    // link was easy to miss).
    const stranded = status === 'stranded'
      ? `<div class="voyage-here-stranded" title="${esc(getLangString('MOD_VOY_PANEL_STRANDED_HINT'))}"><span class="text-warning"><i class="fa fa-exclamation-triangle mr-1"></i>${esc(getLangString('MOD_VOY_PANEL_STRANDED'))}</span>` +
        `<button type="button" class="btn btn-sm btn-warning voyage-trader-link">${esc(getLangString('MOD_VOY_PANEL_STRANDED_BUTTON'))}</button></div>`
      : '';
    if (!state.settings.trade()) return stranded;
    // "Trade: OK" / "Trade: not here", laid out like the "Combat:" and "Works:" rows (label muted, same size as the value).
    const label = `<span class="voyage-here-label">${esc(getLangString('MOD_VOY_PANEL_TRADE_LABEL'))}</span> `;
    if (!state.tradeLocked?.()) return `<div class="voyage-here-place">${label}<span class="text-success">${esc(getLangString('MOD_VOY_PANEL_TRADE_OK'))}</span></div>${stranded}`;
    const trader = status === 'here' ? ` <span class="text-warning" title="${esc(getLangString('MOD_VOY_PANEL_TRADER_HERE_HINT'))}">· ${esc(getLangString('MOD_VOY_PANEL_TRADER_HERE'))}</span>` : '';
    return `<div class="voyage-here-place">${label}<span class="text-danger" title="${esc(getLangString('MOD_VOY_PANEL_NO_TRADE_HINT'))}">${esc(getLangString('MOD_VOY_PANEL_NO_TRADE'))}</span>${trader}</div>${stranded}`;
  };

  /** "Combat: Golbin Village, …" or "Combat: not here": the areas combat works in from this hex (empty while combat is not gated). */
  const fightLine = () => {
    if (!state.active() || !state.settings.combat()) return '';
    const areas = state.combatHere?.() ?? [];
    const names = areas.length > 0
      ? areas.map((a) => `<a href="#" class="voyage-fight-link text-success" data-area="${esc(a.id)}">${esc(a.name)}</a>`).join(', ')
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
    if (page !== undefined) changePage(page);
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
    if (sh.aboard()) return `<div class="voyage-here-ship text-info"><i class="fa fa-ship mr-1"></i>${esc(templateLangString('MOD_VOY_PANEL_ABOARD', { hull: name }))}</div>`;
    return `<div class="voyage-here-ship"><span><i class="fa fa-anchor mr-1"></i>${esc(templateLangString('MOD_VOY_PANEL_MOORED', { hull: name, where: sh.whereIs(ship, true) }))}</span>` +
      `<button type="button" class="btn btn-sm btn-outline-info voyage-find-ship">${esc(getLangString('MOD_VOY_PANEL_SHOW_SHIP'))}</button></div>`;
  };

  // The legend folds away behind a "Legend" toggle; closed by default. The choice is a browser convenience kept in
  // localStorage (not the save), so it never needs a migration.
  const LEGEND_KEY = 'voyage-legend-open';
  const LOCKED_KEY = 'voyage-locked-open';
  let lockedOpen = (() => { try { return localStorage.getItem(LOCKED_KEY) === '1'; } catch { return false; } })();
  let legendOpen = (() => { try { return localStorage.getItem(LEGEND_KEY) === '1'; } catch { return false; } })();
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

  const ensurePanel = () => {
    if (typeof cartographyMap === 'undefined' || cartographyMap === null) return undefined;
    let panel = document.getElementById(PANEL_ID);
    if (panel !== null) return panel;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'voyage-ui block block-rounded bg-combat-inner-dark p-2 mb-2';
    panel.addEventListener('click', (e) => {
      if (e.target instanceof Element && e.target.closest('.voyage-trader-link')) { e.preventDefault(); state.trader?.offer(); }
      if (e.target instanceof Element && e.target.closest('.voyage-locked-toggle')) {
        lockedOpen = !lockedOpen;
        try { localStorage.setItem(LOCKED_KEY, lockedOpen ? '1' : '0'); } catch {}
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
      if (e.target instanceof Element && e.target.closest('.voyage-manage-link')) {
        e.preventDefault();
        try { const page = game.pages.getObjectByID('voyage:Voyage'); if (page !== undefined) changePage(page); } catch (err) { log('Manage voyage link failed', err); }
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
      panel.innerHTML =
        `<div class="d-flex justify-content-between align-items-center mb-1"><span class="font-w600">${esc(getLangString('MOD_VOY_PANEL_YOU_ARE_HERE'))}</span>${manageLink()}</div>` +
        `<div>${swatch}${esc(d.label)}<small class="text-muted">${features}${where}</small></div>` +
        shipLine() +
        tradeLine() +
        fightLine() +
        mode +
        `<div class="voyage-skills">${skillRows(pos, rec)}</div>` +
        (state.settings.overlay() ? legendBlock() : '');
    } catch (e) { log('here panel failed', e); }
  };

  // Terrain line in the hex overview (selected hex).
  ctx.patch(HexOverviewElement, 'displayHex').after(function (_ret, hex) {
    try {
      let line = this.querySelector('.voyage-overview');
      if (line === null) {
        line = document.createElement('div');
        line.className = 'voyage-overview voyage-ui font-size-sm mt-1';
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
