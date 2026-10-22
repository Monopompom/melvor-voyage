// Markets with prices (phase 4): what a sale fetches at the market you stand at or next to, the line
// under the bank's Sell block (this market's rate, the best and the worst you know), and the price lists the journal
// shows. The lists are pure (market-model.mjs); a market's list is known once the journal has noted the place (you
// stood within a hex of it, or traded there). The Here panel shows no prices (the user: the panel is too busy).

/** Where each skill's goods go: [category, processed]. */
const SKILL_CATEGORY = {
  'melvorD:Fishing': ['fish', false],
  'melvorD:Cooking': ['fish', true],
  'melvorD:Mining': ['ore', false],
  'melvorD:Smithing': ['ore', true],
  'melvorD:Woodcutting': ['logs', false],
  'melvorD:Fletching': ['logs', true],
  'melvorD:Farming': ['crops', false],
  'melvorD:Herblore': ['herbs', true],
  'melvorD:Runecrafting': ['runes', true],
  'melvorD:Crafting': ['gems', true],
};
const ESSENCES = ['melvorD:Rune_Essence', 'melvorTotH:Pure_Essence'];
const DUSTS = ['melvorF:Stardust', 'melvorF:Golden_Stardust'];

export function install(ctx, { state, MM, rules, hexes, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const markets = MM.marketsOf(hexes, rules.isTradePlace);
  const byId = new Map(markets.map((m) => [m.id, { ...m, prices: MM.pricesOf(m) }]));
  const hexMarket = new Map(hexes.filter(rules.isTradePlace).map((h) => [`${h.q},${h.r}`, MM.marketOf(h.poi)]).filter(([, id]) => id !== undefined));
  const enabled = () => state.mode !== 'dormant';

  /** A market's name as the game has it (its first POI; the Capital City by its own name). */
  const name = (id) => {
    if (id === 'CapitalCity') return t('MOD_VOY_MARKET_CAPITAL');
    const m = byId.get(id);
    try { return game.cartography.activeMap?.getHex(new HexCoords(m.q, m.r))?.pointOfInterest?.name ?? id; } catch { return id; }
  };

  // ---- goods ------------------------------------------------------------------------------------------------------
  let cats;
  /** Item id -> [category, processed], built once from the skills' goods. */
  const categories = () => {
    if (cats !== undefined) return cats;
    cats = new Map();
    // Our own goods (the empty sacks and crates are Crafting products) sell at their usual price.
    const set = (item, c, done) => { if (item !== undefined && item.namespace !== 'voyage' && !cats.has(item.id)) cats.set(item.id, [c, done]); };
    // Ash, charcoal, dusts and essences first: they would otherwise take their skill's category.
    set(game.items.getObjectByID('melvorF:Ash'), 'ash', false); // build .204: the real ids (were melvorD:, never found)
    set(game.items.getObjectByID('melvorTotH:Charcoal'), 'logs', true);
    DUSTS.forEach((id) => set(game.items.getObjectByID(id), 'stardust', false));
    ESSENCES.forEach((id) => set(game.items.getObjectByID(id), 'runes', false));
    for (const [skillId, [c, done]] of Object.entries(SKILL_CATEGORY)) {
      const sk = game.skills.getObjectByID(skillId);
      try {
        sk?.actions?.forEach((a) => {
          if (a.product !== undefined) set(a.product, a.product.type === 'Herb' ? 'herbs' : a.product.type === 'Gem' ? 'gems' : c, done && a.product.type !== 'Herb');
          if (Array.isArray(a.potions)) a.potions.forEach((p) => set(p, c, done));
        });
      } catch (e) { log(`market goods of ${skillId} failed`, e); }
    }
    try {
      game.items.forEach((item) => {
        if (item.type === 'Gem') set(item, 'gems', false);
        else if (item.type === 'Bones') set(item, 'bones', false);
        else if (item.type === 'Herb') set(item, 'herbs', false);
        else if (item.type === 'Raw Fish') set(item, 'fish', false);
        else if (item.type === 'Logs') set(item, 'logs', false);
      });
    } catch (e) { log('market item types failed', e); }
    return cats;
  };
  const categoryOf = (item) => (item === undefined ? undefined : categories().get(item.id));

  // ---- where you are and what you know -------------------------------------------------------------------------
  /** The market you stand at or next to (the grace hex of the trade gate), or undefined. */
  const here = () => {
    const pos = state.position?.();
    if (pos === undefined || state.terrain === undefined) return undefined;
    const own = hexMarket.get(`${pos.q},${pos.r}`);
    if (own !== undefined) return byId.get(own);
    const rec = state.recordAt(pos);
    if (rec === undefined) return undefined;
    const n = state.knownNeighbours(rec).map((x) => hexMarket.get(`${x.q},${x.r}`)).filter(Boolean).sort();
    return n.length > 0 ? byId.get(n[0]) : undefined;
  };
  /** A noted place whose point of interest is still undiscovered stays out, as in the journal's list. */
  const discovered = (hex) => {
    try {
      const [q, r] = hex.split(',').map(Number);
      return game.cartography.activeMap?.getHex(new HexCoords(q, r))?.pointOfInterest?.isDiscovered !== false;
    } catch { return true; }
  };
  /** The markets whose lists you know: the trading places the journal has noted (and lists). */
  const known = () => {
    const places = state.voyageSkill?.()?.record?.journal?.places ?? {};
    const out = new Set();
    for (const [key, hex] of Object.entries(places)) {
      if (!key.startsWith('trade|') || !discovered(hex)) continue;
      const id = hexMarket.get(hex);
      if (id !== undefined) out.add(id);
    }
    return [...out].map((id) => byId.get(id));
  };
  const marketAt = (q, r) => byId.get(hexMarket.get(`${q},${r}`));

  /** The percent this market pays for an item; 100 when it has no say. */
  const percent = (m, item) => {
    const c = categoryOf(item);
    return m === undefined || c === undefined ? 100 : MM.percentFor(m.prices, c[0], c[1]);
  };

  // ---- the sale price -------------------------------------------------------------------------------------------
  // Bank.getItemSalePrice is what the Sell block, the sale dialogs and the sale itself read. The one patch (build .386;
  // three patches composed in load order): the market's rate and a Haggler's percent, then a Merchant's rate at an
  // outpost where trade is locked (src/folk-traits.mjs outpostSale), then the trader's half while he is here
  // (src/trader.mjs): he sets the price himself, over any Merchant.
  ctx.patch(Bank, 'getItemSalePrice').after((price, item) => {
    try {
      if (!Number.isFinite(price)) return undefined;
      let out = price;
      if (enabled()) {
        const m = here();
        const p = percent(m, item);
        // Haggler within a hex (travel traits, 6f-3): its percent on top of the market's.
        const h = m === undefined ? undefined : state.folkTraits?.haggle?.();
        const atMarket = p === 100 ? out : MM.marketPrice(out, p);
        out = h === undefined ? atMarket : Math.floor((atMarket * (100 + h.pct)) / 100);
      }
      if (state.trader?.present?.() === true) out = Math.floor(out * (state.trader.HALF ?? 0.5));
      else if (state.tradeLocked?.() === true) {
        const s = state.folkTraits?.outpostSale?.();
        if (s !== undefined) out = Math.floor(out * s.rate);
      }
      return out === price ? undefined : out;
    } catch { return undefined; }
  });

  // ---- sold for nothing (build .276) ----------------------------------------------------------------------------------
  // A sale under 1 GP pays 0 and the item still goes (the user: "Sold for nothing", chosen over a 1 GP floor and over
  // refusing). The game's GP notice for 0 has no number, so a 0 notice is dropped and ours says what happened.
  ctx.patch(Currency, 'queueNotification').replace(function (original, amount) {
    if (amount === 0) return undefined;
    return original(amount);
  });
  /** Our notice for a sale that paid nothing (the bank's here, the hold's from hold.mjs). */
  const soldForNothing = (item, qty) => {
    try {
      const what = `${numberWithCommas(qty)} × ${item.name}`;
      // A count of 0 hides the notice's "+1" (the game hides a 0).
      game.notifications.createInfoNotification('voyage:nothing', t('MOD_VOY_MARKET_NOTHING', { what }), item.media, 0);
    } catch (e) { log('sold for nothing notice failed', e); }
  };
  ctx.patch(Bank, 'processItemSale').before(function (item, quantity) {
    try {
      const have = this.items.get(item)?.quantity ?? 0;
      const n = Math.min(have, quantity);
      if (n > 0 && item.sellsFor?.currency === game.gp && item.sellsFor.quantity > 0 && this.getItemSalePrice(item, n) === 0) soldForNothing(item, n);
    } catch (e) { log('sale check failed', e); }
    return undefined;
  });

  // ---- the bank's Sell block --------------------------------------------------------------------------------------
  const CAT_KEYS = {
    fish: ['MOD_VOY_MARKET_CAT_FISH', 'MOD_VOY_MARKET_CAT_FISH_DONE'],
    ore: ['MOD_VOY_MARKET_CAT_ORE', 'MOD_VOY_MARKET_CAT_ORE_DONE'],
    logs: ['MOD_VOY_MARKET_CAT_LOGS', 'MOD_VOY_MARKET_CAT_LOGS_DONE'],
    crops: ['MOD_VOY_MARKET_CAT_CROPS'],
    herbs: ['MOD_VOY_MARKET_CAT_HERBS', 'MOD_VOY_MARKET_CAT_HERBS_DONE'],
    runes: ['MOD_VOY_MARKET_CAT_RUNES', 'MOD_VOY_MARKET_CAT_RUNES_DONE'],
    gems: ['MOD_VOY_MARKET_CAT_GEMS', 'MOD_VOY_MARKET_CAT_GEMS_DONE'],
    bones: ['MOD_VOY_MARKET_CAT_BONES'],
    stardust: ['MOD_VOY_MARKET_CAT_STARDUST'],
    ash: ['MOD_VOY_MARKET_CAT_ASH'],
  };
  const catName = (c, done) => t(CAT_KEYS[c][done && CAT_KEYS[c].length > 1 ? 1 : 0]);
  /** Low, usual, high: amber below the usual price, plain at it, green above (a percent and the price it gives). */
  const tone = (p) => (p > 100 ? 'text-success' : p < 100 ? 'text-warning' : '');
  const pctHtml = (p) => `<span class="${tone(p)} font-w600">${p}%</span>`;
  /** A price after the GP icon, bold (build .263, the user: "GP icon and color", the price here low/mid/high). */
  const gpHtml = (n, cls = '') => `<img class="voyage-skill-name-icon" src="${esc(game.gp.media)}" alt=""><b class="${cls}">${numberWithCommas(n)}</b>`;
  /** The market the selected item's Sell block was drawn for ('' for none); a move to another redraws it. */
  let shownAt;
  ctx.patch(BankSelectedItemMenuElement, 'setItem').after(function (_r, bankItem) {
    try {
      shownAt = here()?.id ?? '';
      let line = this.querySelector('.voyage-market-line');
      const item = bankItem?.item;
      const c = categoryOf(item);
      const anchor = this.sellItemButton?.parentElement;
      if (!enabled() || c === undefined || anchor == null || item.sellsFor?.currency !== game.gp) { line?.classList.add('d-none'); return; }
      if (line === null) {
        line = document.createElement('div');
        line.className = 'col-12 voyage-market-line voyage-ui';
      }
      if (line.nextElementSibling !== anchor) anchor.before(line);
      const m = here();
      const parts = [];
      const goods = catName(c[0], c[1]);
      if (m !== undefined) {
        const p = percent(m, item);
        const each = MM.eachPrice(item.sellsFor.quantity, p);
        parts.push(`<div>${t(p === 100 ? 'MOD_VOY_MARKET_HERE_USUAL' : p > 100 ? 'MOD_VOY_MARKET_HERE_DEAR' : 'MOD_VOY_MARKET_HERE_CHEAP', { pct: pctHtml(p), market: `<b>${esc(name(m.id))}</b>`, goods: esc(goods.toLowerCase()) })}</div>`);
        // The price here coloured as its percent; the usual price plain, the one it is weighed against.
        if (p !== 100) parts.push(`<div>${esc(t('MOD_VOY_MARKET_EACH', { gp: '\u0000', was: '\u0001' })).replace('\u0000', gpHtml(each, tone(p))).replace('\u0001', gpHtml(item.sellsFor.quantity))}</div>`);
      }
      // At the wandering trader the bank says why the price is half (.308, scan B-65).
      try { if (m === undefined && state.trader?.present?.() === true) parts.push(`<div>${esc(t('MOD_VOY_MARKET_TRADER'))}</div>`); } catch {}
      // A Merchant at an outpost, a Haggler at a market (travel traits, 6f-3).
      try {
        const sale = m === undefined && state.trader?.present?.() !== true ? state.folkTraits?.outpostSale?.() : undefined;
        if (sale !== undefined) parts.push(`<div>${t('MOD_VOY_MARKET_MERCHANT', { name: `<b>${esc(sale.folk.name)}</b>`, pct: pctHtml(Math.round(sale.rate * 100)), outpost: esc(sale.outpost.name ?? '') })}</div>`);
        const h = m === undefined ? undefined : state.folkTraits?.haggle?.();
        if (h !== undefined) parts.push(`<div>${t('MOD_VOY_MARKET_HAGGLER', { name: `<b>${esc(h.folk.name)}</b>`, pct: `<span class="text-success font-w600">+${h.pct}%</span>` })}</div>`);
      } catch {}
      const bw = MM.bestAndWorst(known(), c[0], c[1]);
      if (bw !== undefined) {
        parts.push(`<div>${t('MOD_VOY_MARKET_BEST', { market: `<b>${esc(name(bw.best.id))}</b>`, pct: pctHtml(bw.best.percent) })}</div>`);
        if (bw.worst.id !== bw.best.id) parts.push(`<div>${t('MOD_VOY_MARKET_WORST', { market: `<b>${esc(name(bw.worst.id))}</b>`, pct: pctHtml(bw.worst.percent) })}</div>`);
      }
      line.innerHTML = parts.length > 0 ? `<div class="voyage-market-box">${parts.join('')}</div>` : '';
      line.classList.toggle('d-none', parts.length === 0);
    } catch (e) { log('market sell line failed', e); }
  });
  // The game draws the Sell block (its price, the total, our line) only when an item is picked: after a move to
  // another market's reach, draw the picked item again so the bank shows what a sale will now pay.
  const redrawSell = () => {
    try {
      const picked = game.bank.selectedBankItem;
      if (picked === undefined || shownAt === undefined || (here()?.id ?? '') === shownAt || typeof bankSideBarMenu === 'undefined') return;
      bankSideBarMenu.selectedMenu.setItem(picked, game.bank);
    } catch (e) { log('market sell redraw failed', e); }
  };
  ctx.patch(WorldMap, 'setPlayerPosition').after(function () {
    try { if (game.cartography?.activeMap === this) setTimeout(redrawSell, 0); } catch {}
  });

  // ---- the journal --------------------------------------------------------------------------------------------------
  /** A market's list for the journal, dearest first: [{ cat, done, percent }] including the worked goods. */
  const listOf = (m) => {
    const rows = [];
    for (const [c, p] of Object.entries(m.prices)) {
      rows.push({ cat: c, done: false, percent: p, name: catName(c, false) });
      if (MM.PROCESSED.includes(c)) rows.push({ cat: c, done: true, percent: MM.percentFor(m.prices, c, true), name: catName(c, true) });
    }
    return rows.sort((a, b) => b.percent - a.percent || (a.name < b.name ? -1 : 1));
  };

  const api = { enabled, here, known, marketAt, name, listOf, categoryOf, percent, soldForNothing, total: () => markets.length };
  state.market = api;
  return api;
}
