// Sea charts and rumours (phase 4). The harbour board's Sea charts tab sells the chart of the port's
// own sea and of the seas next to it; a chart clears the fog from its sea's hexes (fog only: they are not surveyed,
// the game's survey levels and Cartography XP stay the player's job). Rumours (Tavern Tale near towns and markets,
// Sailor's Rumour near ports) drop now and then while you work within a hex of a trading place; read from the bank, one
// clears the fog round the nearest place you have not found, or charts a resource country when no place is left.
// The rules are pure (charts-model.mjs); this module reads the game and draws.
//
// The save: `record.charted` (v14), the hexes cleared of fog, base64 bits like `visited`. The fog itself is the game's
// hex background alpha; src/overlay.mjs asks `state.charts.cleared(hex)` and draws a cleared hex without it.

const CHART_ART = 'assets/sea_chart.webp';
const RUMOUR_ART = { tavern: 'assets/rumour_tavern.webp', sailor: 'assets/rumour_sailor.webp' };
/** How many tales each rumour has (MOD_VOY_RUMOUR_TALE_<KIND>_<n>, languages/en.json). */
const TALES = 4;

export function install(ctx, { state, CM, model, rules, terrainMod, helpLayout, hexes, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const qty = (n) => numberWithCommas(n);
  const skill = () => state.voyageSkill?.();
  const usable = () => { const s = skill(); return s !== undefined && s.futureRaw === undefined; };
  const notify = (text, kind = 'success') => { try { notifyPlayer(skill(), text, kind); } catch {} };

  const seaMap = CM.seas(hexes, ['FakePort']);
  const neighbours = CM.seaNeighbours(seaMap);
  const byKey = new Map(hexes.map((h) => [`${h.q},${h.r}`, h]));
  const liveHex = (q, r) => { try { return game.cartography.activeMap?.getHex(new HexCoords(q, r)); } catch { return undefined; } };
  const portName = (poi) => state.cargo?.portName?.(poi) ?? poi.replace(/([a-z])([A-Z])/g, '$1 $2');

  // ---- the fog ---------------------------------------------------------------------------------------------------
  const record = () => (usable() ? skill().record : undefined);
  const isCharted = (q, r) => { const rec = record(); return rec !== undefined && model.isVisited(rec.charted, q, r); };
  /** A hex still under fog: not fully surveyed and not cleared by a chart or a rumour. */
  const underFog = (h) => { const g = liveHex(h.q, h.r); return g !== undefined && !g.isFullySurveyed && !isCharted(h.q, h.r); };
  const changed = () => { const s = skill(); if (s !== undefined) s.renderQueue.page = true; state.onSettingsChange(); };
  const redraw = (list) => {
    try {
      const rq = game.cartography?.renderQueue;
      if (rq === undefined) return;
      for (const h of list) { const g = liveHex(h.q, h.r); if (g !== undefined) rq.hexBackground.add(g); }
    } catch (e) { log('fog redraw failed', e); }
  };
  /** Clears the fog from `list` ({ q, r }): the save, the mod's knowledge (hints may point there), the map. */
  const clear = (list) => {
    const rec = record();
    if (rec === undefined || list.length === 0) return 0;
    const { visited, added } = model.markVisited(rec.charted, list);
    if (added === 0) return 0;
    rec.charted = visited;
    try { state.knowledge?.markMany(list); } catch (e) { log('chart knowledge failed', e); }
    redraw(list);
    changed();
    return added;
  };
  ctx.onCharacterLoaded(() => {
    try {
      const rec = record();
      if (rec === undefined || rec.charted === '') return;
      state.knowledge?.markMany(hexes.filter((h) => model.isVisited(rec.charted, h.q, h.r)));
    } catch (e) { log('charted hexes not marked known', e); }
  });

  // ---- sea charts --------------------------------------------------------------------------------------------------
  const fogOf = (poi) => (seaMap[poi] ?? []).filter(underFog);
  const priceOf = (fog) => CM.chartPrice(fog.map((h) => { try { return liveHex(h.q, h.r)?.getCombinedCost(1) ?? 0; } catch { return 0; } }));
  /** "The Frost Drift Port" -> "Frost Drift": the sea's name, as the canvas has it ("Chart of the Frost Drift sea"). */
  const seaName = (poi) => portName(poi).replace(/^The\s+/i, '').replace(/\s+(Port|Pier)$/i, '');
  const chartName = (poi) => t('MOD_VOY_CHART_NAME', { port: seaName(poi) });
  /** "Next sea west": the way from this port to the other sea's port. */
  const nextSea = (poi, sea) => {
    const a = seaMap[poi]?.[0];
    const b = seaMap[sea]?.[0];
    const dir = a === undefined || b === undefined ? undefined : terrainMod.directionLabel(a, b);
    return t('MOD_VOY_CHARTS_NEXT', { dir: dir ? getLangString(`MOD_VOY_DIR_${dir}`) : '' }).trim();
  };
  const icon = (src) => (src ? `<img class="voyage-skill-name-icon" src="${src}" alt="">` : '');
  const button = (cls, label, attrs, why) => (why === undefined
    ? `<button type="button" class="btn ${cls}" ${attrs}>${esc(label)}</button>`
    : `<button type="button" class="btn btn-outline-secondary" disabled title="${esc(why)}">${esc(label)}</button>`);
  const art = `<span class="voyage-cargo-art"><img class="voyage-cargo-box" src="${ctx.getResourceUrl(CHART_ART)}" alt=""></span>`;

  /** The Sea charts tab of the port `poi`'s harbour board. */
  const html = (poi) => {
    const list = CM.chartsAt(poi, seaMap, neighbours);
    const gp = game.gp.amount;
    let out = `<div class="voyage-cargo-bar"><span>${esc(t('MOD_VOY_CHARTS_INTRO'))}</span><span>${esc(t('MOD_VOY_CHARTS_HAVE'))} ${icon(game.gp.media)}<b>${qty(gp)}</b></span></div>`;
    if (list.length === 0) return `${out}<div class="voyage-cargo-empty">${esc(t('MOD_VOY_CHARTS_NONE_HERE'))}</div>`;
    for (const sea of list) {
      const fog = fogOf(sea);
      const price = priceOf(fog);
      const where = sea === poi ? t('MOD_VOY_CHARTS_OWN') : nextSea(poi, sea);
      const lines = [`<div><b>${esc(chartName(sea))}</b></div>`];
      let pay;
      let act;
      if (fog.length === 0) {
        lines.push(`<div class="text-muted">${esc(where)} · ${esc(t('MOD_VOY_CHARTS_CLEAR'))}</div>`);
        pay = `<div class="voyage-cargo-pay text-muted">${esc(t('MOD_VOY_CHARTS_NOTHING'))}</div>`;
        act = button('btn-success', t('MOD_VOY_CHARTS_BUY'), '', t('MOD_VOY_CHARTS_NOTHING'));
      } else {
        lines.push(`<div>${esc(where)} · ${esc(t(fog.length === 1 ? 'MOD_VOY_CHARTS_FOG_ONE' : 'MOD_VOY_CHARTS_FOG', { n: `${fog.length}` }))}</div>`);
        const short = gp < price;
        if (short) lines.push(`<div class="text-warning">${esc(t('MOD_VOY_CHARTS_SHORT'))}</div>`);
        pay = `<div class="voyage-cargo-pay"><div>${icon(game.gp.media)}<b>${qty(price)}</b> GP</div></div>`;
        act = button('btn-success', t('MOD_VOY_CHARTS_BUY'), `data-chart="buy" data-sea="${esc(sea)}"`, short ? t('MOD_VOY_CHARTS_SHORT') : undefined);
      }
      out += `<div class="voyage-cargo-row">${art}<div class="voyage-cargo-mid">${lines.join('')}</div>${pay}<div class="voyage-cargo-act">${act}</div></div>`;
    }
    return `${out}<div class="voyage-cargo-foot text-muted">${esc(t('MOD_VOY_CHARTS_FOOT'))}</div>`;
  };

  /** Buys the chart of `sea` at the board of `poi` (you stand there). */
  const buy = (sea, poi) => {
    if (!usable() || state.cargo?.portHere?.()?.poi !== poi || !CM.chartsAt(poi, seaMap, neighbours).includes(sea)) return false;
    const fog = fogOf(sea);
    if (fog.length === 0) return false;
    const price = priceOf(fog);
    if (game.gp.amount < price) { notify(t('MOD_VOY_CHARTS_SHORT'), 'danger'); return false; }
    game.gp.remove(price);
    const n = clear(fog);
    notify(t('MOD_VOY_CHARTS_BOUGHT', { name: chartName(sea), n: `${n}` }));
    try { state.journal?.learn('charts'); } catch {}
    try { const rec = state.cargo.portHere(); state.journal?.portUsed?.(poi, 'chart', rec); } catch (e) { log('journal port failed', e); }
    log(`chart of ${sea} bought for ${price} GP: ${n} hexes`);
    return true;
  };
  const onClick = (b, poi) => {
    if (b.dataset.chart === 'buy') buy(b.dataset.sea, poi);
  };
  /** A free chart (a rare cargo delivery reward): the fog of `sea` clears, with a notice. False when nothing was left. */
  const grant = (sea) => {
    const fog = fogOf(sea);
    if (fog.length === 0) return false;
    const n = clear(fog);
    try { game.notifications.createInfoNotification('voyage:chart', t('MOD_VOY_CHARTS_GIVEN', { name: chartName(sea), n: `${n}` }), ctx.getResourceUrl(CHART_ART)); } catch {}
    log(`chart of ${sea} given: ${n} hexes`);
    try { state.journal?.learn('charts'); } catch {}
    return n > 0;
  };

  // ---- rumours -----------------------------------------------------------------------------------------------------
  const rumourItem = (kind) => { try { return game.items.getObjectByID(`voyage:${CM.RUMOURS[kind]}`); } catch { return undefined; } };
  const kindOf = (item) => Object.keys(CM.RUMOURS).find((k) => item?.id === `voyage:${CM.RUMOURS[k]}`);
  /** Within a hex of a trading place: 'sailor' by a port, 'tavern' by a town or market; else undefined. */
  const nearTrade = () => {
    const pos = state.position?.();
    const rec = pos === undefined ? undefined : state.recordAt(pos);
    if (rec === undefined || state.terrain === undefined) return undefined;
    const around = [rec, ...state.terrain.neighbours(rec.q, rec.r)].filter((x) => x !== undefined && x.cloud !== true);
    const trading = around.filter(rules.isTradePlace);
    if (trading.length === 0) return undefined;
    return trading.some((x) => x.f.includes('port')) ? 'sailor' : 'tavern';
  };
  /** Places not found yet: [{ q, r, sea, name }], hidden ones and those under cloud or already cleared left out. */
  const unfound = () => {
    const out = [];
    try {
      game.cartography.activeMap?.pointsOfInterest.forEach((poi) => {
        if (poi.isDiscovered || poi.hidden !== undefined) return;
        const h = poi.hex;
        const rec = byKey.get(`${h.q},${h.r}`);
        if (rec === undefined || rec.cloud === true || !underFog(h)) return;
        out.push({ q: h.q, r: h.r, sea: rec.t === 'water' || rec.t === 'shoal', name: poi.name });
      });
    } catch (e) { log('unfound places failed', e); }
    return out;
  };
  /** Rumours stop dropping once there is nothing left for one to tell. */
  const worthTelling = () => unfound().length > 0 || state.journal?.canChartAny?.() === true;
  let tellCache = { at: 0, v: true };
  const stillWorth = () => {
    const now = Date.now();
    if (now - tellCache.at > 60000) tellCache = { at: now, v: worthTelling() };
    return tellCache.v;
  };
  const roll = (sk) => {
    if (!usable() || sk === undefined || sk.namespace === 'voyage') return;
    const chance = CM.perAction(sk.currentActionInterval, CM.RUMOUR_HOURS);
    if (chance <= 0 || Math.random() >= chance) return;
    const kind = nearTrade();
    if (kind === undefined || !stillWorth()) return;
    const item = rumourItem(kind);
    if (item === undefined) return;
    game.bank.addItem(item, 1, false, true, true, true, 'Voyage');
    try { game.notifications.createInfoNotification('voyage:rumour', t('MOD_VOY_RUMOUR_HEARD', { name: item.name, skill: sk.name }), item.media); } catch {}
    log(`rumour ${item.id} heard while ${sk.id}`);
    try { state.journal?.learn('rumour'); } catch {}
  };
  try {
    ctx.patch(GatheringSkill, 'addActionRewards').after(function () {
      try { roll(this); } catch (e) { log('rumour roll failed', e); }
    });
  } catch (e) { console.error('[Voyage] rumours: no drops', e); }

  /** A rumour for a Voyage task handed in (charts-model TASK_RUMOUR): the kind for where you stand. */
  const giveRumour = () => {
    const item = rumourItem(nearTrade() ?? 'tavern');
    if (item === undefined || !stillWorth()) return undefined;
    game.bank.addItem(item, 1, false, true, true, true, 'Voyage');
    try { state.journal?.learn('rumour', true); } catch {}
    return item;
  };

  /** The tale told: one of TALES lines, the same for the same place. */
  const taleOf = (kind, at) => t(`MOD_VOY_RUMOUR_TALE_${kind.toUpperCase()}_${1 + ((Math.abs(at.q * 31 + at.r * 17)) % TALES)}`);
  const dirWord = (dir) => (dir ? getLangString(`MOD_VOY_DIR_${dir}`) : '');
  /** Reads one rumour from the bank: the item goes, the fog clears (or a country is charted), and it says what. */
  const read = (item) => {
    const kind = kindOf(item);
    if (!usable() || kind === undefined || game.bank.getQty(item) < 1) return false;
    const pos = state.position?.();
    const target = CM.rumourTarget(pos, unfound(), kind === 'sailor');
    let sections;
    if (target !== undefined) {
      const ring = CM.ringOf(target, hexes);
      game.bank.removeItemQuantity(item, 1, false);
      const n = clear(ring);
      const d = pos === undefined ? 0 : CM.hexDist(pos, target);
      sections = [
        { body: [{ html: `<i>${esc(taleOf(kind, target))}</i>`, cls: 'voyage-rumour-tale' }] },
        { body: [
          { html: t(d <= 1 ? 'MOD_VOY_RUMOUR_CLEARS_NEXT' : 'MOD_VOY_RUMOUR_CLEARS', { n: `<b class="text-success">${n}</b>`, d: `${d}`, dir: esc(dirWord(terrainMod.directionLabel(pos ?? target, target))) }) },
          { html: esc(t('MOD_VOY_RUMOUR_PLACE')), cls: 'text-muted' },
        ] },
      ];
      log(`rumour read: ${n} hexes round ${target.q},${target.r}`);
    } else {
      const charted = state.journal?.chartAny?.();
      if (charted === undefined) { notify(t('MOD_VOY_RUMOUR_NOTHING'), 'info'); return false; }
      game.bank.removeItemQuantity(item, 1, false);
      sections = [{ body: [
        { html: `<i>${esc(t('MOD_VOY_RUMOUR_TALE_ZONE'))}</i>`, cls: 'voyage-rumour-tale' },
        { html: t('MOD_VOY_RUMOUR_ZONE', { name: `<b>${esc(charted.name)}</b>`, n: `${charted.count}` }) },
      ] }];
      log(`rumour read: charted ${charted.id}`);
    }
    tellCache.at = 0;
    try { state.journal?.learn('rumour', true); } catch {}
    readPopup(item, sections);
    return true;
  };
  /** The popup after reading a rumour or a Starlit Chart: what it told, in the help layout. */
  const readPopup = (item, sections) => {
    try {
      SwalLocale.fire({
        didRender: state.popupDidRender,
        title: `<img class="voyage-title-icon" src="${item.media}" alt="">${esc(item.name)}`,
        width: helpLayout.HELP_WIDTH,
        html: helpLayout.helpHtml(sections),
        // No Show on map: it zoomed onto the ring, and so onto the place (the user, 18 Oct 2026: "I don't wanna help
        // players with zoom on needed hex"). The popup gives the distance and the way, the fog clears, that is all.
        confirmButtonText: t('MOD_VOY_BUTTON_GOT_IT'),
        customClass: (() => { const c = { popup: 'voyage-ui', confirmButton: 'btn btn-success m-1' }; return typeof createSwalCustomClass === 'function' ? createSwalCustomClass(c) : c; })(),
      });
    } catch (e) { log('rumour popup failed', e); }
  };

  // ---- the Starlit Chart: the one night find (phase 4 wrap-up) ----------------------------------------
  const starItem = () => { try { return game.items.getObjectByID(`voyage:${CM.STAR_CHART}`); } catch { return undefined; } };
  const isStar = (item) => item !== undefined && item?.id === `voyage:${CM.STAR_CHART}`;
  /** The sea a Starlit Chart read here would chart: the one you are on, or the nearest from land. */
  const starSea = () => CM.seaAt(seaMap, state.position?.());
  /** A Starlit Chart could still tell something: some sea under fog, or a resource country to chart. */
  const starsWorth = () => Object.keys(seaMap).some((poi) => fogOf(poi).length > 0) || state.journal?.canChartAny?.() === true;
  /**
   * A move landed that lit `seaHexes` sea hexes at night (stores.mjs afterMove): now and then a Starlit Chart
   * (charts-model starChance), never once nothing is left for one to chart.
   */
  const rollStars = (seaHexes) => {
    if (!usable() || Math.random() >= CM.starChance(seaHexes)) return false;
    const item = starItem();
    if (item === undefined || !starsWorth()) return false;
    game.bank.addItem(item, 1, false, true, true, true, 'Voyage');
    try { game.notifications.createInfoNotification('voyage:stars', t('MOD_VOY_STAR_FOUND', { name: item.name }), item.media); } catch {}
    log(`star chart found after ${seaHexes} lit sea hexes`);
    try { state.journal?.learn('stars'); } catch {}
    return true;
  };
  /** Reads a Starlit Chart from the bank: the fog of the sea it is read on clears, or a country is charted. */
  const readStar = (item) => {
    if (!usable() || !isStar(item) || game.bank.getQty(item) < 1) return false;
    const sea = starSea();
    const fog = sea === undefined ? [] : fogOf(sea);
    let sections;
    if (fog.length > 0) {
      game.bank.removeItemQuantity(item, 1, false);
      const n = clear(fog);
      sections = [{ body: [
        { html: `<i>${esc(t('MOD_VOY_STAR_TALE'))}</i>`, cls: 'voyage-rumour-tale' },
        { html: t('MOD_VOY_STAR_CLEARS', { name: `<b>${esc(seaName(sea))}</b>`, n: `<b class="text-success">${n}</b>` }) },
      ] }];
      log(`star chart read: ${n} hexes of ${sea}`);
    } else {
      const charted = state.journal?.chartAny?.();
      if (charted === undefined) { notify(t('MOD_VOY_STAR_NOTHING'), 'info'); return false; }
      game.bank.removeItemQuantity(item, 1, false);
      sections = [{ body: [
        { html: `<i>${esc(t('MOD_VOY_STAR_TALE_ZONE'))}</i>`, cls: 'voyage-rumour-tale' },
        { html: t('MOD_VOY_RUMOUR_ZONE', { name: `<b>${esc(charted.name)}</b>`, n: `${charted.count}` }) },
      ] }];
      log(`star chart read: charted ${charted.id}`);
    }
    try { state.journal?.learn('stars', true); } catch {}
    readPopup(item, sections);
    return true;
  };
  /** The bank Read block's line for a Starlit Chart: what reading it here would chart. */
  const starLine = () => {
    const sea = starSea();
    const fog = sea === undefined ? [] : fogOf(sea);
    if (fog.length === 0) return t('MOD_VOY_STAR_READ_CLEAR');
    // Ashore it reads for the nearest sea (.215: the line said "the sea you are on" on a land hex too).
    const pos = state.position?.();
    const afloat = pos !== undefined && seaMap[sea].some((h) => h.q === pos.q && h.r === pos.r);
    return t(afloat ? 'MOD_VOY_STAR_READ_BODY' : 'MOD_VOY_STAR_READ_BODY_LAND', { name: seaName(sea), n: `${fog.length}` });
  };

  // The bank: a "Read" block under Sell for a rumour, in Sell's own look (as the hold's Stow block, src/hold.mjs).
  ctx.patch(BankSelectedItemMenuElement, 'setItem').after(function (_r, bankItem) {
    try {
      let box = this.querySelector('.voyage-rumour-read');
      const kind = isStar(bankItem?.item) ? 'star' : kindOf(bankItem?.item);
      if (kind === undefined || !usable()) { (box?.closest('.voyage-rumour-col') ?? box)?.classList.add('d-none'); return; }
      const sell = this.sellItemButton?.closest('.block');
      if (box === null) {
        box = document.createElement('div');
        const col = document.createElement('div');
        col.className = 'col-12 voyage-rumour-col';
        col.append(box);
        let after = sell;
        for (let i = 0; after !== null && after !== undefined && i < 4 && after.parentElement !== null; i++) {
          const css = getComputedStyle(after.parentElement);
          if (!(css.display.includes('flex') && !css.flexDirection.startsWith('column') && css.flexWrap === 'nowrap')) break;
          after = after.parentElement;
        }
        if (after) after.after(col); else this.selectedItemContainer?.append(col);
      }
      box.closest('.voyage-rumour-col')?.classList.remove('d-none');
      const look = (sell?.className ?? 'block block-rounded bg-combat-inner-dark').split(/\s+/).filter((c) => !/^col(-|$)/.test(c)).join(' ');
      box.className = `${look} voyage-rumour-read voyage-ui`;
      const headClass = sell?.querySelector('.block-header')?.className ?? 'block-header block-header-default';
      const titleClass = sell?.querySelector('.block-header > :first-child')?.className || 'font-size-sm font-w600 mb-0';
      const mainColClass = this.sellItemButton?.parentElement?.className || 'col-12 text-center';
      const mainClass = (this.sellItemButton?.className ?? 'btn btn-danger').replace('btn-danger', 'btn-success');
      box.innerHTML = `<div class="${headClass}"><h5 class="${titleClass}">${esc(t('MOD_VOY_RUMOUR_READ_TITLE'))}</h5></div>` +
        `<div class="col-12 pt-2"><div class="row no-gutters"><div class="col-12 py-1">${esc(kind === 'star' ? starLine() : t(`MOD_VOY_RUMOUR_READ_${kind.toUpperCase()}`))}</div>` +
        `<div class="${mainColClass}"><button type="button" class="${mainClass} voyage-rumour-go">${esc(t('MOD_VOY_RUMOUR_READ'))}</button></div></div></div>`;
      const item = bankItem.item;
      const menu = this;
      box.querySelector('.voyage-rumour-go')?.addEventListener('click', () => {
        if (!(kind === 'star' ? readStar(item) : read(item))) return;
        const left = game.bank.items.get(item);
        if (left !== undefined && left.quantity > 0) { try { menu.setItem(left, game.bank); } catch (e) { log('read redraw failed', e); } }
      });
    } catch (e) { log('rumour read block failed', e); }
  });

  const api = {
    html, onClick, grant, giveRumour, read, rollStars, readStar,
    /** A cargo delivery at `poi`: now and then its sea chart, free (charts-model CARGO_CHART). */
    rollDelivery: (poi) => (seaMap[poi] !== undefined && Math.random() < CM.CARGO_CHART ? grant(poi) : false), seaOf: (poi) => seaMap[poi], seas: () => Object.keys(seaMap),
    /** The overlay: a hex cleared of fog by a chart or a rumour and not surveyed yet. */
    cleared: (hex) => hex !== undefined && !hex.isFullySurveyed && isCharted(hex.q, hex.r),
    clear, isCharted,
  };
  state.charts = api;
  return api;
}
