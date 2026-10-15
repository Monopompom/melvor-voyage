// "You are here" panel in the map's bottom-left overlay (next to the survey overview), a terrain line in
// the hex overview that opens when a hex is selected, and a legend. Re-rendered on travel, on page
// visible and on settings changes. Everything is wrapped: a failing panel never touches the game.

const PANEL_ID = 'voyage-here';

export function install(ctx, { state, rules, terrainMod, log }) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const describe = (rec) => {
    if (rec === undefined) return { label: 'Uncharted', features: [] };
    const info = rec.cloud === true ? terrainMod.CLOUD_INFO : terrainMod.CLASS_INFO[rec.t];
    const features = (rec.f ?? []).map((f) => terrainMod.FEATURE_INFO[f]?.label ?? f);
    const label = rec.cloud === true ? `${info.label} over ${(terrainMod.CLASS_INFO[rec.t]?.label ?? rec.t).toLowerCase()}` : info?.label ?? rec.t;
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
      const name = rules.ruleLabel(id, skill.name);
      const rate = off ? 1 : state.rateAt(id);
      if (rate >= 1) { works.push(`<img class="skill-icon-xs" src="${skill.media}" title="${esc(name)}: works here">`); continue; }
      if (rate > 0) { works.push(`<span class="voyage-skill-rate" title="${esc(name)}: works here at ${Math.round(rate * 100)}%"><img class="skill-icon-xs" src="${skill.media}"><small>${Math.round(rate * 100)}%</small></span>`); continue; }
      // Tooltip in sentences: "Fishing: locked. Needs water. Nearest known: 1 hex SW." The compass reading only
      // shows when no place is known; a known one already gives distance and direction.
      const noun = rules.ruleNoun(id);
      const sentences = [`Needs ${noun}.`];
      const near = state.nearestFor(id, pos);
      if (near !== undefined) {
        const dir = terrainMod.directionLabel(pos, near.hex);
        let poi = '';
        try {
          const hex = game.cartography?.activeMap?.getHex(new HexCoords(near.hex.q, near.hex.r));
          const n = poiNameOf(hex) ?? (near.hex.area ? terrainMod.areaLabel(near.hex.area) : undefined);
          if (n !== undefined) poi = ` (${n})`;
        } catch {}
        sentences.push(`Nearest known: ${near.distance} ${near.distance === 1 ? 'hex' : 'hexes'} ${dir}${poi}.`);
      } else {
        sentences.push('None known yet.');
        const reading = state.compass?.readingFor(id, pos);
        if (reading !== undefined) {
          const word = reading.word.charAt(0).toUpperCase() + reading.word.slice(1);
          sentences.push(`Compass: ${word}, ${reading.dir}${reading.across ? ', across the water' : ''}.`);
        }
      }
      const hint = sentences.join(' ');
      locked.push(`<img class="skill-icon-xs voyage-skill-locked" src="${skill.media}" title="${esc(name)}: locked. ${esc(hint)}">`);
    }
    const rulesNote = off ? ' <small class="text-muted">(rules off)</small>' : state.settings.strictness() === 'relaxed' ? ' <small class="text-muted">(relaxed)</small>' : '';
    return `<div class="voyage-skillrow"><small class="text-muted">Works:</small> ${works.join('') || '<small>none</small>'}${rulesNote}</div>` +
      (locked.length > 0 ? `<div class="voyage-skillrow"><small class="text-muted">Locked:</small> ${locked.join('')}</div>` : '');
  };

  /** Trade status on its own line under the terrain line; empty while trade is not gated. */
  const tradeLine = () => {
    if (!state.active() || !state.settings.trade()) return '';
    if (!state.tradeLocked?.()) return '<div class="voyage-here-place"><small class="text-success">Trade OK</small></div>';
    let trader = '';
    try {
      const status = state.trader?.status();
      if (status === 'here') trader = ' <small class="text-warning" title="Selling works here at half price until you can afford the road to a trading place.">· A wandering trader is here (half price)</small>';
      else if (status === 'stranded') trader = ' <small>· <a href="#" class="voyage-trader-link" title="You cannot afford the road to a trading place and nothing here earns GP.">Stranded? Look for a trader</a></small>';
    } catch (e) { log('trader status failed', e); }
    return `<div class="voyage-here-place"><small class="text-danger" title="Sell, buy and trade only in a town, port or market, or next to one.">No trade here</small>${trader}</div>`;
  };

  const legend = () => [...Object.entries(terrainMod.CLASS_INFO).filter(([cls]) => cls !== 'water').map(([, info]) => info), terrainMod.CLOUD_INFO]
    .map((info) => `<span class="voyage-swatch" style="background:${info.css}"></span>${esc(info.label)}`)
    .join(' ');

  const ensurePanel = () => {
    if (typeof cartographyMap === 'undefined' || cartographyMap === null) return undefined;
    let panel = document.getElementById(PANEL_ID);
    if (panel !== null) return panel;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'voyage-ui block block-rounded bg-combat-inner-dark p-2 mb-2';
    panel.addEventListener('click', (e) => {
      if (e.target instanceof Element && e.target.closest('.voyage-trader-link')) { e.preventDefault(); state.trader?.offer(); }
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
      if (pos === undefined) { panel.innerHTML = '<div class="font-w600">Voyage</div><small class="text-muted">No position yet.</small>'; return; }
      const rec = state.recordAt(pos);
      const d = describe(rec);
      const poi = poiNameOf(pos);
      const place = [poi ? esc(poi) : undefined, d.area ? esc(d.area) : undefined].filter(Boolean).join(', ');
      const where = `${place ? ` · ${place}` : ''} ${coordsOf(pos)}`;
      const swatch = d.css ? `<span class="voyage-swatch" style="background:${d.css}"></span>` : '';
      const features = d.features.length > 0 ? ` · ${esc(d.features.join(', '))}` : '';
      const mode = state.mode === 'relaxed' ? '<div><small class="text-warning">Map differs from the terrain table: rules off.</small></div>' : '';
      panel.innerHTML =
        `<div class="font-w600">You are here</div>` +
        `<div>${swatch}${esc(d.label)}<small class="text-muted">${features}${where}</small></div>` +
        tradeLine() +
        mode +
        `<div class="voyage-skills">${skillRows(pos, rec)}</div>` +
        (state.settings.overlay() ? `<div class="voyage-legend"><small>${legend()}</small></div>` : '');
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
