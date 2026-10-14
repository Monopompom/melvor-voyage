// "You are here" panel in the map's bottom-left overlay (next to the survey overview), a terrain line in
// the hex overview that opens when a hex is selected, and a legend. Re-rendered on travel, on page
// visible and on settings changes. Everything is wrapped: a failing panel never touches the game.

const PANEL_ID = 'voyage-here';

export function install(ctx, { state, rules, terrainMod, log }) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const describe = (rec) => {
    if (rec === undefined) return { label: 'Uncharted', features: [] };
    const info = terrainMod.CLASS_INFO[rec.t];
    const features = (rec.f ?? []).map((f) => terrainMod.FEATURE_INFO[f]?.label ?? f);
    return { label: info?.label ?? rec.t, features, css: info?.css };
  };

  const poiNameOf = (hex) => {
    const poi = hex?.pointOfInterest;
    return poi !== undefined && poi.isDiscovered ? poi.name : undefined;
  };

  const coordsOf = (hex) => {
    try { const o = hex.to_oddq(); return `(${o.col}, ${o.row})`; } catch { return `(${hex.q}, ${hex.r})`; }
  };

  const skillLines = (pos, rec) => rules.gatedSkillIds().map((id) => {
    const skill = game.skills.getObjectByID(id);
    const icon = skill ? `<img class="skill-icon-xs mr-1" src="${skill.media}">` : '';
    const name = esc(skill?.name ?? id);
    if (!state.settings.rules() || state.mode !== 'strict') return `<div>${icon}${name}: <span class="text-success">anywhere</span> <small class="text-muted">(rules off)</small></div>`;
    if (rules.allowedAt(id, rec)) return `<div>${icon}${name}: <span class="text-success">works here</span></div>`;
    const near = terrainMod.nearest(state.terrain, pos, (r) => rules.allowedAt(id, r));
    let hint = '';
    if (near !== undefined) {
      const dir = terrainMod.directionLabel(pos, near.hex);
      let poi = '';
      try {
        const hex = game.cartography?.activeMap?.getHex(new HexCoords(near.hex.q, near.hex.r));
        const n = poiNameOf(hex);
        if (n !== undefined) poi = `, ${esc(n)}`;
      } catch {}
      hint = ` <small class="text-muted">nearest ${esc(rules.ruleNoun(id))}: ${near.distance} ${near.distance === 1 ? 'hex' : 'hexes'} ${dir}${poi}</small>`;
    }
    return `<div>${icon}${name}: <span class="text-danger">locked</span>${hint}</div>`;
  }).join('');

  const legend = () => Object.entries(terrainMod.CLASS_INFO)
    .filter(([cls]) => cls !== 'water')
    .map(([, info]) => `<span class="voyage-swatch" style="background:${info.css}"></span>${esc(info.label)}`)
    .join(' ');

  const ensurePanel = () => {
    if (typeof cartographyMap === 'undefined' || cartographyMap === null) return undefined;
    let panel = document.getElementById(PANEL_ID);
    if (panel !== null) return panel;
    const host = cartographyMap.bottomLeftOverlay;
    if (!host) return undefined;
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'voyage-ui block block-rounded bg-combat-inner-dark p-2 mb-2';
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
      const where = [poi ? esc(poi) : undefined, coordsOf(pos)].filter(Boolean).join(' ');
      const swatch = d.css ? `<span class="voyage-swatch" style="background:${d.css}"></span>` : '';
      const features = d.features.length > 0 ? ` <small class="text-muted">· ${esc(d.features.join(', '))}</small>` : '';
      const mode = state.mode === 'relaxed' ? '<div><small class="text-warning">Map differs from the terrain table: rules off.</small></div>' : '';
      panel.innerHTML =
        `<div class="font-w600">You are here</div>` +
        `<div>${swatch}${esc(d.label)}${features} <small class="text-muted">${where}</small></div>` +
        mode +
        `<div class="voyage-skills">${skillLines(pos, rec)}</div>` +
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
