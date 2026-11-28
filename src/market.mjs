// Markets with prices (phase 4): what a sale fetches at the market you stand at or next to, the line
// under the bank's Sell block (this market's rate, the best and the worst you know), and the price lists the journal
// shows. The lists are pure (market-model.mjs); a market's list is known once the journal has noted the place (you
// stood within a hex of it, or traded there). The Here panel shows no prices (the user: the panel is too busy).
// Market pressure (round 6, market-pressure-model.mjs): what you sell at a market presses its price for that kind of
// goods, and the price comes back over a game day. Port happenings (round 6, src/happenings.mjs) change it further: a
// shortage pays its own percent for what it still wants, a festival pays more for its goods and takes more of them.

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
/** How long the sale prices' shared context (the market here, a Haggler, the trader, an outpost's Merchant) is kept. */
const SALE_CTX_MS = 500;

export function install(ctx, { state, MM, PM, C, rules, hexes, shortNumber, log }) {
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

  // ---- market pressure (round 6) --------------------------------------------------------------------------------
  // Each market keeps a pressure for each kind of goods (the categories and an "other goods" bucket), kept in the save
  // as the share of its depth still pressed. Only goods sold for GP press, never Voyage's own goods (they sell at
  // their usual price everywhere).
  const gameNow = () => { try { return state.gameNow?.() ?? Date.now(); } catch { return Date.now(); } };
  const level = () => { try { return state.voyageSkill?.()?.level ?? 1; } catch { return 1; } };
  const hexAt = new Map(hexes.map((h) => [`${h.q},${h.r}`, h]));
  /** A market's size: the Capital City, a city, a farm, a port, else a market POI. */
  const sizes = new Map();
  const sizeOf = (m) => {
    if (!sizes.has(m.id)) {
      const f = hexAt.get(`${m.q},${m.r}`)?.f ?? [];
      sizes.set(m.id, PM.sizeOf({ capital: m.id === 'CapitalCity' || f.includes('capital'), city: f.includes('city'), farm: MM.FARMS.includes(m.id), port: m.port === true }));
    }
    return sizes.get(m.id);
  };
  const depth = (m) => PM.depthOf(sizeOf(m), level());
  /** The depth a sale of an item presses against: a festival takes more of its goods before the price falls. */
  const depthFor = (m, item) => { let f = 1; try { f = state.happenings?.depthFactor?.(m, item) ?? 1; } catch {} return depth(m) * f; };
  const pressable = (item) => item !== undefined && item.namespace !== 'voyage' && item.sellsFor?.currency === game.gp && item.sellsFor.quantity > 0;
  const kindOf = (item) => PM.kindOf(categoryOf(item)?.[0]);
  let cleanedFor;
  /** The save's pressure entries, checked once per record. */
  const entries = () => {
    const rec = state.voyageSkill?.()?.record;
    if (rec === undefined) return undefined;
    if (cleanedFor !== rec) { rec.market = PM.cleanPressure(rec.market); cleanedFor = rec; }
    return rec.market.p;
  };
  const entryOf = (m, kind) => entries()?.[PM.keyOf(m.id, kind)];
  /** The multiplier a market pays for a kind now (1: not pressed). */
  const pressNow = (m, kind) => (m === undefined ? 1 : PM.pressAt(entryOf(m, kind), gameNow()));
  /** Game ms until a kind is back at its list price at a market (0: it is). */
  const backIn = (m, kind) => (m === undefined ? 0 : PM.msUntilFull(entryOf(m, kind), gameNow()));
  /** The multiplier a sale of `qty` of an item fetches: the average of the pressure it makes as it sells. */
  const saleMultiplier = (m, item, qty) => {
    if (m === undefined || !pressable(item)) return 1;
    const share = PM.shareAt(entryOf(m, kindOf(item)), gameNow());
    return PM.averagePress(share, item.sellsFor.quantity * Math.max(1, qty || 1), depthFor(m, item));
  };
  /** A duration in the game clock's words ("9h 5m"), or undefined while the clock is not loaded. */
  const duration = (ms) => { try { const d = C.durationText(ms, numberWithCommas); return t(d.key, d.vars); } catch { return undefined; } };
  /** A sale of `n` items went through at the market in reach (the bank's, or the hold's from hold.mjs). */
  const noteSale = (item, n) => {
    try {
      if (!enabled() || !pressable(item) || !(n > 0)) return;
      const m = saleContext().market;
      const p = m === undefined ? undefined : entries();
      if (p === undefined) return;
      const now = gameNow();
      const key = PM.keyOf(m.id, kindOf(item));
      // A shortage takes what it still wants first; only the rest presses the market.
      let value = item.sellsFor.quantity * n;
      try { value = state.happenings?.sold?.(m, item, value) ?? value; } catch (e) { log('shortage fill failed', e); }
      if (value > 0) p[key] = PM.sold(p[key], value, depthFor(m, item), now);
      if (Object.keys(p).length > PM.ENTRIES_MAX / 2) state.voyageSkill().record.market.p = PM.pruned(p, now);
      redrawSellSoon(true);
    } catch (e) { log('market pressure note failed', e); }
  };

  /** The percent this market pays for an item; 100 when it has no say. */
  const percent = (m, item) => {
    const c = categoryOf(item);
    return m === undefined || c === undefined ? 100 : MM.percentFor(m.prices, c[0], c[1]);
  };
  /**
   * What a sale of `qty` of an item fetches at a market now: { p: the list's percent, press: the pressure's multiplier,
   * pct: the percent of the usual price it all comes to, hap: the happening that changed it (a shortage, a festival) }.
   */
  const salePct = (m, item, qty = 1) => {
    const p = percent(m, item);
    if (m === undefined) return { p, press: 1, pct: p, hap: undefined };
    const press = saleMultiplier(m, item, qty);
    let hap;
    try { hap = state.happenings?.adjust?.(m, item, qty, p * press); } catch {}
    return { p, press, pct: hap?.pct ?? p * press, hap };
  };

  // ---- the sale price -------------------------------------------------------------------------------------------
  // Bank.getItemSalePrice is what the Sell block, the sale dialogs and the sale itself read. The one patch (build .386;
  // three patches composed in load order): the market's rate and a Haggler's percent, then a Merchant's rate at an
  // outpost where trade is locked (src/folk-traits.mjs outpostSale), then the trader's half while he is here
  // (src/trader.mjs): he sets the price himself, over any Merchant.
  // The bank asks the price per item it shows, so what every price shares at one spot is read once (build .401) and
  // kept SALE_CTX_MS or until you move: the market here (known neighbours), a Haggler and a Merchant (the Folks' views),
  // the trader, the trade lock. Only the item's own percent is per item.
  let saleCtx;
  const saleContext = () => {
    const now = performance.now();
    if (saleCtx !== undefined && now - saleCtx.at < SALE_CTX_MS) return saleCtx;
    const market = enabled() ? here() : undefined;
    const trader = state.trader?.present?.() === true;
    const locked = !trader && state.tradeLocked?.() === true;
    saleCtx = {
      at: now, market, trader, locked,
      // Haggler within a hex (travel traits, 6f-3): its percent on top of the market's.
      haggle: market === undefined ? undefined : state.folkTraits?.haggle?.(),
      outpost: locked ? state.folkTraits?.outpostSale?.() : undefined,
    };
    return saleCtx;
  };
  ctx.patch(Bank, 'getItemSalePrice').after((price, item, quantity = 1) => {
    try {
      if (!Number.isFinite(price)) return undefined;
      const c = saleContext();
      let out = price;
      if (enabled()) {
        // The market's percent, its pressure and a happening there, before a Haggler (round 6). `price` is the whole
        // sale's, so a big stack pays the average of the pressure it makes and of what a shortage still wants.
        const s = salePct(c.market, item, quantity);
        let atMarket;
        if (s.hap !== undefined) atMarket = Math.floor((out * s.pct) / 100);
        else {
          atMarket = s.p === 100 ? out : MM.marketPrice(out, s.p);
          if (s.press < 1) atMarket = Math.floor(atMarket * s.press);
        }
        out = c.haggle === undefined ? atMarket : Math.floor((atMarket * (100 + c.haggle.pct)) / 100);
      }
      if (c.trader) out = Math.floor(out * (state.trader.HALF ?? 0.5));
      else if (c.locked && c.outpost !== undefined) out = Math.floor(out * c.outpost.rate);
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
      const what = `${shortNumber(qty)} × ${item.name}`;
      // A count of 0 hides the notice's "+1" (the game hides a 0).
      game.notifications.createInfoNotification('voyage:nothing', t('MOD_VOY_MARKET_NOTHING', { what }), item.media, 0);
    } catch (e) { log('sold for nothing notice failed', e); }
  };
  /** The item a bank sale is selling and how many the bank held before it, so the sale's count presses the market. */
  let selling;
  ctx.patch(Bank, 'processItemSale').before(function (item, quantity) {
    selling = undefined;
    try {
      const have = this.items.get(item)?.quantity ?? 0;
      selling = { item, have };
      const n = Math.min(have, quantity);
      if (n > 0 && item.sellsFor?.currency === game.gp && item.sellsFor.quantity > 0 && this.getItemSalePrice(item, n) === 0) soldForNothing(item, n);
    } catch (e) { log('sale check failed', e); }
    return undefined;
  });
  ctx.patch(Bank, 'processItemSale').after(function (_r, item) {
    try {
      if (selling !== undefined && selling.item === item) noteSale(item, selling.have - (this.items.get(item)?.quantity ?? 0));
    } catch (e) { log('sale pressure failed', e); }
    selling = undefined;
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
    other: ['MOD_VOY_MARKET_CAT_OTHER'],
  };
  const catKey = (c, done) => CAT_KEYS[c][done && CAT_KEYS[c].length > 1 ? 1 : 0];
  const catName = (c, done) => t(catKey(c, done));
  /** A kind's name after "for" mid-sentence: the ones led by an adjective have their own form (German "für rohen Fisch"). */
  const FOR_FORM = { MOD_VOY_MARKET_CAT_FISH: 'MOD_VOY_MARKET_CAT_FISH_FOR', MOD_VOY_MARKET_CAT_FISH_DONE: 'MOD_VOY_MARKET_CAT_FISH_DONE_FOR', MOD_VOY_MARKET_CAT_OTHER: 'MOD_VOY_MARKET_CAT_OTHER_FOR' };
  /** A percent as each language writes it (French and German put a no-break space before "%"). */
  const pctOf = (n) => t('MOD_VOY_PERCENT', { n: `${n}` });
  /** A pressed share as the percent it takes off ("−18%"), amber while the price is below 90% of the list's. */
  const glutHtml = (press) => `<span class="${press < 0.9 ? 'text-warning' : ''} font-w600">\u2212${pctOf(Math.max(1, Math.round((1 - press) * 100)))}</span>`;
  /** Low, usual, high: amber below the usual price, plain at it, green above (a percent and the price it gives). */
  const tone = (p) => (p > 100 ? 'text-success' : p < 100 ? 'text-warning' : '');
  const pctHtml = (p) => `<span class="${tone(p)} font-w600">${pctOf(p)}</span>`;
  /** A price after the GP icon, bold (build .263, the user: "GP icon and color", the price here low/mid/high). */
  const gpHtml = (n, cls = '') => `<span class="text-nowrap"><img class="voyage-skill-name-icon" src="${esc(game.gp.media)}" alt=""><b class="${cls}">${numberWithCommas(n)}</b></span>`;
  /** The market the selected item's Sell block was drawn for ('' for none); a move to another redraws it. */
  let shownAt;
  ctx.patch(BankSelectedItemMenuElement, 'setItem').after(function (_r, bankItem) {
    try {
      shownAt = here()?.id ?? '';
      let line = this.querySelector('.voyage-market-line');
      const item = bankItem?.item;
      const c = categoryOf(item);
      const anchor = this.sellItemButton?.parentElement;
      const m0 = enabled() ? here() : undefined;
      const pressed = m0 !== undefined && pressable(item) ? pressNow(m0, kindOf(item)) : 1;
      if (!enabled() || (c === undefined && pressed >= 1) || anchor == null || item.sellsFor?.currency !== game.gp) { line?.classList.add('d-none'); return; }
      if (line === null) {
        line = document.createElement('div');
        line.className = 'col-12 voyage-market-line voyage-ui';
      }
      if (line.nextElementSibling !== anchor) anchor.before(line);
      const m = here();
      const parts = [];
      const goodsKey = c === undefined ? catKey('other', false) : catKey(c[0], c[1]);
      // Mid-sentence the kind is lower case in English and French; German nouns keep their capital, Chinese has none (.742).
      const lowGoods = (s) => (typeof setLang === 'string' && setLang === 'de' ? s : s.toLowerCase());
      const forGoods = FOR_FORM[goodsKey] !== undefined ? t(FOR_FORM[goodsKey]) : lowGoods(t(goodsKey));
      if (m !== undefined) {
        const p = percent(m, item);
        const press = pressable(item) ? pressNow(m, kindOf(item)) : 1;
        const s = salePct(m, item, 1);
        const pNow = s.hap === undefined ? p * press : s.pct;
        const exact = pNow === p ? MM.eachPrice(item.sellsFor.quantity, p) : Math.round(item.sellsFor.quantity * pNow) / 100;
        // Cents only where they matter: from 1000 GP up the price each is whole ("50000665.51" at 100M, 28 Nov 2026).
        const each = exact >= 1000 ? Math.round(exact) : exact;
        if (c !== undefined) parts.push(`<div>${t(p === 100 ? 'MOD_VOY_MARKET_HERE_USUAL' : p > 100 ? 'MOD_VOY_MARKET_HERE_DEAR' : 'MOD_VOY_MARKET_HERE_CHEAP', { pct: pctHtml(p), market: `<b>${esc(name(m.id))}</b>`, goods: esc(forGoods) })}</div>`);
        // A shortage or a festival here (round 6).
        try { for (const l of state.happenings?.sellLines?.(m, item) ?? []) parts.push(`<div>${l}</div>`); } catch (e) { log('happening sell lines failed', e); }
        // Pressed (round 6): what it takes off, for which goods, and when the full price is back.
        if (press < 1) {
          const time = duration(backIn(m, kindOf(item)));
          parts.push(`<div>${t(time === undefined ? 'MOD_VOY_MARKET_GLUT_NOW' : 'MOD_VOY_MARKET_GLUT', { pct: glutHtml(press), market: `<b>${esc(name(m.id))}</b>`, goods: esc(forGoods), time: `<span class="voyage-time">${esc(time ?? '')}</span>` })}</div>`);
        }
        // The price here coloured as its percent; the usual price plain, the one it is weighed against.
        const toneNow = tone(Math.round(pNow));
        if (p !== 100 || press < 1 || s.hap !== undefined) parts.push(`<div>${esc(t('MOD_VOY_MARKET_EACH', { gp: '\u0000', was: '\u0001' })).replace('\u0000', gpHtml(each, toneNow)).replace('\u0001', gpHtml(item.sellsFor.quantity))}</div>`);
      }
      // At the wandering trader the bank says why the price is half (.308, scan B-65).
      try { if (m === undefined && state.trader?.present?.() === true) parts.push(`<div>${esc(t('MOD_VOY_MARKET_TRADER'))}</div>`); } catch {}
      // A Merchant at an outpost, a Haggler at a market (travel traits, 6f-3).
      try {
        const sale = m === undefined && state.trader?.present?.() !== true ? state.folkTraits?.outpostSale?.() : undefined;
        if (sale !== undefined) parts.push(`<div>${t('MOD_VOY_MARKET_MERCHANT', { name: `<b>${esc(sale.folk.name)}</b>`, pct: pctHtml(Math.round(sale.rate * 100)), outpost: esc(sale.outpost.name ?? '') })}</div>`);
        const h = m === undefined ? undefined : state.folkTraits?.haggle?.();
        if (h !== undefined) parts.push(`<div>${t('MOD_VOY_MARKET_HAGGLER', { name: `<b>${esc(h.folk.name)}</b>`, pct: `<span class="text-success font-w600">+${pctOf(h.pct)}</span>` })}</div>`);
      } catch {}
      const bw = c === undefined ? undefined : MM.bestAndWorst(known(), c[0], c[1], (km, pct) => Math.round(pct * pressNow(km, c[0])));
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
  const redrawSell = (force = false) => {
    try {
      const picked = game.bank.selectedBankItem;
      if (picked === undefined || shownAt === undefined || (!force && (here()?.id ?? '') === shownAt) || typeof bankSideBarMenu === 'undefined') return;
      if (force && (game.bank.items.get(picked.item)?.quantity ?? 0) <= 0) return;
      bankSideBarMenu.selectedMenu.setItem(picked, game.bank);
    } catch (e) { log('market sell redraw failed', e); }
  };
  /** After a sale the picked item's line shows the new pressure (one redraw per burst of sales). */
  let pressQueued = false;
  const redrawSellSoon = () => {
    if (pressQueued) return;
    pressQueued = true;
    setTimeout(() => { pressQueued = false; redrawSell(true); }, 0);
  };
  // One deferred redraw per burst of moves (build .401): a catch-up replays a voyage hex by hex inside one run of ticks.
  let sellQueued = false;
  ctx.patch(WorldMap, 'setPlayerPosition').after(function () {
    try {
      saleCtx = undefined;
      if (game.cartography?.activeMap !== this || sellQueued) return;
      sellQueued = true;
      setTimeout(() => { sellQueued = false; redrawSell(); }, 0);
    } catch {}
  });

  // ---- the journal --------------------------------------------------------------------------------------------------
  /** A market's list for the journal, dearest first: [{ cat, done, percent }] including the worked goods. */
  // Each row's `now` is its percent as it stands (market pressure, round 6) and `back` the game ms until it is the list's
  // again; a kind the list leaves at 100% shows only while it is pressed (`pressedOnly`).
  const listOf = (m) => {
    const rows = [];
    const row = (c, done, p) => {
      const press = pressNow(m, c);
      rows.push({ cat: c, done, percent: p, now: Math.round(p * press), back: press < 1 ? backIn(m, c) : 0, name: catName(c, done) });
    };
    for (const [c, p] of Object.entries(m.prices)) {
      row(c, false, p);
      if (MM.PROCESSED.includes(c)) row(c, true, MM.percentFor(m.prices, c, true));
    }
    for (const c of PM.KINDS) {
      if (m.prices[c] !== undefined || pressNow(m, c) >= 1) continue;
      row(c, false, 100);
      rows[rows.length - 1].pressedOnly = true;
    }
    return rows.sort((a, b) => b.percent - a.percent || (a.name < b.name ? -1 : 1));
  };

  const api = {
    enabled, here, known, marketAt, name, listOf, categoryOf, percent, soldForNothing, noteSale, duration, total: () => markets.length,
    // For the port happenings (src/happenings.mjs): every market, its size and depth, the goods and their kinds.
    all: () => [...byId.values()], sizeOf, depth, pressable, kindOf, goods: categories, catName, pctHtml,
    redrawSell: () => redrawSellSoon(),
  };
  state.market = api;
  return api;
}
