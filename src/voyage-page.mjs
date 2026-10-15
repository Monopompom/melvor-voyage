// The Voyage skill page: ship, travels and the compass stages, plus "Show map". The ship block
// builds the first dinghy and says where the ship is (phase 3b, src/ship.mjs). The container is inserted on interfaceAvailable because the game calls
// skill.initMenus() right after that hook and SkillHeaderElement looks for <skill-header data-skill-id> then.

export const CONTAINER_ID = 'voyage-container';
export const PAGE_ID = 'voyage:Voyage';
const CARTOGRAPHY_PAGE_ID = 'melvorAoD:Cartography';

export function install(ctx, { state, model, shipModel, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const part = (name) => document.querySelector(`#${CONTAINER_ID} [data-voyage="${name}"]`);
  const skill = () => { try { return game.skills.getObjectByID(model.SKILL_ID); } catch { return undefined; } };
  const pageOf = (id) => { try { return game.pages.getObjectByID(id); } catch { return undefined; } };

  ctx.onInterfaceAvailable(() => {
    try {
      if (document.getElementById(CONTAINER_ID) !== null) return;
      const template = document.getElementById('voyage-page-template');
      if (template === null) { console.error('[Voyage] page template missing'); return; }
      // Two elements share id="main-container": anchor on a known page container instead.
      const anchor = document.getElementById('township-container') ?? document.getElementById('thieving-container');
      const fragment = document.importNode(template.content, true);
      if (anchor !== null) anchor.after(fragment); else document.querySelector('main')?.append(fragment);
      const button = part('show-map');
      const map = pageOf(CARTOGRAPHY_PAGE_ID);
      if (button !== null) {
        if (map === undefined) button.classList.add('d-none');
        else button.onclick = () => showMap(false); // the map as it was left (user feedback, build .50)
      }
      // One delegated listener: the ship block is re-rendered as innerHTML.
      part('ship')?.addEventListener('click', (e) => {
        const target = e.target instanceof Element ? e.target.closest('[data-voyage-action]') : null;
        if (target === null) return;
        if (target.dataset.voyageAction === 'build') { if (state.ship?.build()) render(); }
        else if (target.dataset.voyageAction === 'find') showMap(true);
      });
    } catch (e) { console.error('[Voyage] page insert failed', e); }
  });

  /** Opens the map. `onShip`: centred on the moored ship (the ship block's button); otherwise as it was left. */
  const showMap = (onShip) => {
    const map = pageOf(CARTOGRAPHY_PAGE_ID);
    if (map === undefined) return;
    changePage(map);
    const hex = !onShip || state.ship?.aboard() ? undefined : state.ship?.hex();
    if (hex !== undefined) setTimeout(() => { try { state.ship.centreOn(hex); } catch (e) { log('map centre failed', e); } }, 100);
  };

  const qty = (n) => numberWithCommas(n);
  const costIcon = (media, need, have, title) =>
    `<span class="voyage-cost ${have >= need ? '' : 'text-danger'}" title="${esc(title)}"><img class="skill-icon-xxs mr-1" src="${media}">${qty(need)}` +
    ` <small class="text-muted">(${qty(have)})</small></span>`;

  const shipHtml = () => {
    const api = state.ship;
    const ship = api?.ship();
    if (api === undefined || ship === undefined) return `<div>${t('MOD_VOY_PAGE_NO_SHIP')}</div>`;
    const icon = (hull) => `<img class="voyage-hull-icon mr-2" src="${ctx.getResourceUrl(hull.media)}">`;
    if (ship === null) {
      const hull = shipModel.HULLS.dinghy;
      const b = shipModel.DINGHY_BUILD;
      const costs = [costIcon(game.gp.media, b.gp, game.gp.amount, game.gp.name)];
      for (const { id, quantity } of b.items) {
        const item = game.items.getObjectByID(id);
        if (item !== undefined) costs.push(costIcon(item.media, quantity, game.bank.getQty(item), item.name));
      }
      const why = api.buildBlocker();
      return `<div class="d-flex align-items-center mb-2">${icon(hull)}<div><div>${t('MOD_VOY_PAGE_NO_SHIP_YET')}</div>` +
        `<small class="text-muted">${esc(t(shipModel.hullBlurbKey(hull.id)))}</small></div></div>` +
        `<div class="d-flex flex-wrap align-items-center mb-2"><span class="mr-2">${t('MOD_VOY_PAGE_BUILD_COST')}</span>${costs.join('')}</div>` +
        `<button type="button" class="btn btn-sm btn-success" data-voyage-action="build"${why ? ' disabled' : ''}>${t('MOD_VOY_PAGE_BUILD_BUTTON')}</button>` +
        (why ? ` <small class="text-warning ml-2">${esc(why)}</small>` : ` <small class="text-muted ml-2">${t('MOD_VOY_PAGE_BUILD_HINT')}</small>`);
    }
    const hull = shipModel.HULLS[ship.hull];
    const where = api.aboard() ? t('MOD_VOY_PAGE_ABOARD') : t('MOD_VOY_PAGE_MOORED', { where: esc(api.whereIs(ship)) });
    const off = !api.enabled() ? `<div><small class="text-warning">${t('MOD_VOY_PAGE_RULES_OFF')}</small></div>` : '';
    return `<div class="d-flex align-items-center">${icon(hull)}<div><div><b>${esc(t(shipModel.hullNameKey(hull.id)))}</b>: ${where}</div>` +
      `<small class="text-muted">${esc(t(shipModel.hullBlurbKey(hull.id)))}</small>${off}</div></div>` +
      (api.aboard() ? '' : `<button type="button" class="btn btn-sm btn-outline-info mt-2" data-voyage-action="find">${t('MOD_VOY_PAGE_FIND_SHIP')}</button>`);
  };

  const render = () => {
    const s = skill();
    if (s === undefined || document.getElementById(CONTAINER_ID) === null) return;
    const level = s.level;
    const rec = s.record;

    const ship = part('ship');
    if (ship !== null) ship.innerHTML = shipHtml();

    const travels = part('travels');
    if (travels !== null) {
      const total = rec.landHexes + rec.waterHexes;
      travels.innerHTML =
        `<div>${t('MOD_VOY_PAGE_HEXES_TRAVELLED', { total: numberWithCommas(total) })} <small class="text-muted">${t('MOD_VOY_PAGE_HEXES_SPLIT', { land: numberWithCommas(rec.landHexes), water: numberWithCommas(rec.waterHexes) })}</small></div>` +
        `<small class="text-muted">${t('MOD_VOY_PAGE_XP_NOTE', { land: `${model.XP_PER_HEX.land}`, water: `${model.XP_PER_HEX.water}` })}</small>` +
        (s.futureRaw !== undefined ? `<div><small class="text-warning">${t('MOD_VOY_PAGE_FUTURE_SAVE')}</small></div>` : '');
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
        : `<small class="text-warning">${t('MOD_VOY_PAGE_COMPASS_MISSING')}</small>`;
      compass.innerHTML = `<div class="voyage-compass-stages">${rows.join('')}</div><div class="mt-2">${note}</div>`;
    }
  };

  /** What the page depends on beyond the skill's own events. Cheap: read every frame while the page is open. */
  const signature = () => {
    const p = state.position();
    let logs = 0;
    for (const { id } of shipModel.DINGHY_BUILD.items) { const it = game.items.getObjectByID(id); if (it !== undefined) logs += game.bank.getQty(it); }
    return `${game.gp.amount}|${logs}|${p?.q},${p?.r}|${state.compass?.owned?.()}|${state.active()}`;
  };

  return { render, signature };
}
