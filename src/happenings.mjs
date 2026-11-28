// Port happenings (round 6) on the game side: the shortages and festivals of src/happenings-model.mjs in the sale
// price (through market.mjs), the bank's Sell block, the harbour board's "Word from the harbours", the Here panel's
// trade line, the Places card and the Welcome Back box. Blockades (.737) are rolled from the seas you sailed (your
// Pilotage hexes there) and the sea bands; encounters.mjs reads them (a tier worse, twice the odds, wins counted) and
// cargo.mjs pays the runs to and from the sea's port more.
//
// The knowledge rule: you are told only of happenings at markets you know, and only once the news has reached you
// (half an hour of game time a hex from where you stand). Standing at a market you see its happening at once.

/** How long the live happenings read for the prices are kept (the bank asks a price per item it draws). */
const VIEW_MS = 500;
/** Welcome Back tells at most this many happenings, the shortest time left first. */
const AWAY_MAX = 3;
const FEST_KEYS = {
  planting: ['MOD_VOY_HAPPEN_FEST_PLANTING', 'MOD_VOY_HAPPEN_FEST_PLANTING_GOODS'],
  regatta: ['MOD_VOY_HAPPEN_FEST_REGATTA', 'MOD_VOY_HAPPEN_FEST_REGATTA_GOODS'],
  harvest: ['MOD_VOY_HAPPEN_FEST_HARVEST', 'MOD_VOY_HAPPEN_FEST_HARVEST_GOODS'],
  midwinter: ['MOD_VOY_HAPPEN_FEST_MIDWINTER', 'MOD_VOY_HAPPEN_FEST_MIDWINTER_GOODS'],
};

export function install(ctx, { state, H, terrainMod, shortNumber, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const M = () => state.market;
  const on = () => state.mode !== 'dormant' && M()?.enabled?.() === true;
  const gameNow = () => { try { return state.gameNow?.() ?? Date.now(); } catch { return Date.now(); } };
  const seedOf = () => { try { return game.characterName ?? 'captain'; } catch { return 'captain'; } };
  const record = () => state.voyageSkill?.()?.record;
  /** The encounter rules (the sea tiers and purses), from the encounters module once it is loaded. */
  const R = () => state.encounters?.R;
  /** Your Pilotage hexes on a chart sea. */
  const hexesOn = (sea) => { try { return state.pilotage?.hexesIn?.(`sea_${sea}`) ?? 0; } catch { return 0; } };
  const seaName = (sea) => { try { return state.charts?.seaName?.(sea) ?? sea; } catch { return sea; } };
  const bandName = (b) => { try { return state.encounters?.bandName?.(b) ?? b; } catch { return b; } };

  // ---- the save ---------------------------------------------------------------------------------------------------
  let cleanedFor;
  /** The save's `happen`, checked once per record. */
  const data = () => {
    const rec = record();
    if (rec === undefined) return undefined;
    if (cleanedFor !== rec) { rec.happen = H.cleanHappen(rec.happen); cleanedFor = rec; view = undefined; }
    return rec.happen;
  };
  const put = (h) => { const rec = record(); if (rec !== undefined) rec.happen = h; view = undefined; };

  // ---- what a slot can roll -------------------------------------------------------------------------------------
  /** The goods a shortage may ask for: the market's goods you hold now or have ever found, sold for GP. */
  const owned = () => {
    const out = [];
    for (const [id, [kind]] of M().goods()) {
      const item = game.items.getObjectByID(id);
      if (!M().pressable(item)) continue;
      let had = (game.bank.items.get(item)?.quantity ?? 0) > 0;
      // ⚠ to see in game: the game's own count of an item found.
      if (!had) { try { had = game.stats.itemFindCount(item) > 0; } catch {} }
      if (had) out.push({ id, kind });
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  };
  const rollCtx = () => ({
    seed: seedOf(),
    markets: M().all().map((m) => ({ id: m.id, depth: M().depth(m), cheap: Object.entries(m.prices).filter(([, p]) => p < 100).map(([c]) => c) })),
    items: owned(),
    seas: Object.entries(R()?.SEA_TIER ?? {}).map(([id, tier]) => ({ id, tier, weight: hexesOn(id) })),
    bands: (() => { try { return state.encounters?.E?.bandsOf?.('sea') ?? []; } catch { return []; } })(),
  });
  /** The happenings brought up to now: the missed slots rolled (once a slot), what ended dropped. */
  let rolledSlot;
  const advance = () => {
    const d = data();
    if (d === undefined) return undefined;
    const now = gameNow();
    const slot = H.slotOf(now);
    if (rolledSlot === slot && d.at >= slot) return d;
    try {
      const next = H.advance(d, now, d.at < slot ? rollCtx() : {});
      put(next);
      rolledSlot = slot;
      return next;
    } catch (e) { log('happenings roll failed', e); rolledSlot = slot; return d; }
  };

  // ---- festivals --------------------------------------------------------------------------------------------------
  const cities = () => M().all().filter((m) => ['city', 'capital'].includes(M().sizeOf(m))).map((m) => m.id).sort();
  /** The season festivals follow now: Township's (its start kept in the save), else the mod's own. */
  const seasonNow = (d, now) => {
    let w;
    try { w = state.weather?.season?.(); } catch {}
    if (w === undefined || w.noTown) return H.ownSeason(now);
    const s = H.seasonFrom(d.season, w.key, w.msLeft, now);
    if (s !== d.season) d.season = s;
    return s;
  };
  let festMemo;
  /** Checks only (voyageDev.happen): a festival set by hand, kept until its day is over. Not saved. */
  let forcedFest;
  const festivalNow = (d, now) => {
    if (forcedFest !== undefined && forcedFest.start <= now && now < forcedFest.end) return forcedFest;
    const s = seasonNow(d, now);
    const key = `${s.key}|${s.start}`;
    if (festMemo?.key !== key) festMemo = { key, f: H.festivalFor(s, seedOf(), cities()) };
    const f = festMemo.f;
    return f !== undefined && f.start <= now && now < f.end ? f : undefined;
  };

  // ---- what is on now ---------------------------------------------------------------------------------------------
  let view;
  /** { at, now, live: the shortages and blockades on, fest: the festival on } for this moment, kept VIEW_MS. */
  const current = () => {
    const at = performance.now();
    if (!on()) return { at, now: gameNow(), live: [], fest: undefined };
    if (view !== undefined && at - view.at < VIEW_MS && view.happen === record()?.happen) return view;
    const d = advance();
    const now = gameNow();
    view = { at, happen: record()?.happen, now, live: d === undefined ? [] : H.liveAt(d, now), fest: d === undefined ? undefined : festivalNow(d, now) };
    return view;
  };
  const shortageAt = (marketId, itemId) => current().live.find((h) => h.kind === 'shortage' && h.market === marketId && h.item === itemId);
  const festivalAt = (marketId, item) => {
    const f = current().fest;
    if (f === undefined || f.market !== marketId) return undefined;
    const c = M().categoryOf(item);
    return c !== undefined && H.festivalWants(f, c[0], c[1]) ? f : undefined;
  };

  // ---- blockades (encounters.mjs, cargo.mjs) ---------------------------------------------------------------------
  /** The blockade holding a chart sea now, or undefined. Read on every step at sea, so from the kept view. */
  const blockadeOn = (sea) => (sea === undefined || sea === '' ? undefined : current().live.find((h) => h.kind === 'blockade' && h.sea === sea));
  /**
   * A fight won on `sea` (a chart sea's id): undefined where no blockade holds, else { sea, wins, need, lifted, bounty,
   * pilot }. The win that lifts it pays the bounty (the caller adds the GP) and gives a Pilotage level's worth of
   * hexes on that sea (given here).
   */
  const wonAt = (sea) => {
    const h = blockadeOn(sea);
    const d = data();
    if (h === undefined || d === undefined) return undefined;
    const r = H.win(d, sea, gameNow());
    put(r.state);
    const out = { sea, wins: r.blockade?.wins ?? h.wins, need: H.BLOCKADE_WINS, lifted: r.lifted, bounty: 0, pilot: 0 };
    if (r.lifted) {
      out.bounty = H.bountyOf(R()?.purseOf?.('sea', h.tier) ?? 0);
      try {
        const area = `sea_${sea}`;
        const lv = state.pilotage?.levelIn?.(area) ?? 1;
        const n = Math.max(0, (state.pilotage?.hexesFor?.(lv + 1) ?? 0) - (state.pilotage?.hexesFor?.(lv) ?? 0));
        if (n > 0 && state.pilotage?.gift?.(area, n) !== undefined) out.pilot = n;
      } catch (e) { log('blockade Pilotage gift failed', e); }
      log(`blockade of ${sea} lifted: bounty ${out.bounty} GP, ${out.pilot} Pilotage hexes`);
    }
    return out;
  };
  /** A cargo run's pay (GP) with a blockade on the sea of its start or end port: CARGO_BONUS more while it holds. */
  const cargoPay = (run, gp) => (blockadeOn(run?.from) !== undefined || blockadeOn(run?.to) !== undefined ? Math.round(gp * (1 + H.CARGO_BONUS)) : gp);

  // ---- the price (market.mjs) ---------------------------------------------------------------------------------
  /** A festival takes FESTIVAL_DEPTH × the market's depth of its goods before the price falls. */
  const depthFactor = (m, item) => (festivalAt(m.id, item) === undefined ? 1 : H.FESTIVAL_DEPTH);
  /**
   * The percent a sale of `qty` fetches with a happening at the market, from `pct` (the list's percent and the
   * pressure): { pct, kind } or undefined when nothing is on there for the item.
   */
  const adjust = (m, item, qty, pct) => {
    if (!M().pressable(item)) return undefined;
    const fest = festivalAt(m.id, item);
    const base = fest === undefined ? pct : pct * H.FESTIVAL_MULT;
    const sh = shortageAt(m.id, item.id);
    if (sh !== undefined) return { pct: H.shortageMix(sh, item.sellsFor.quantity * Math.max(1, qty || 1), base), kind: 'shortage' };
    return fest === undefined ? undefined : { pct: base, kind: 'festival' };
  };
  /** A sale of `value` GP of base value went through: a shortage takes its part; the value left to press is returned. */
  const sold = (m, item, value) => {
    const sh = shortageAt(m.id, item.id);
    if (sh === undefined) return value;
    const d = data();
    if (d === undefined) return value;
    const r = H.fill(d, sh.id, value, gameNow());
    put(r.state);
    if (r.filled) {
      try { game.notifications.createInfoNotification(`voyage:shortage:${sh.id}`, t('MOD_VOY_HAPPEN_FILLED', { item: item.name, market: M().name(m.id) }), item.media, 0); } catch {}
    }
    return r.over;
  };

  // ---- words ------------------------------------------------------------------------------------------------------
  const timeLeft = (h, now) => M().duration(Math.max(0, h.end - now)) ?? `${Math.ceil(Math.max(0, h.end - now) / 3600000)}h`;
  const timeHtml = (h, now) => `<span class="voyage-time">${esc(timeLeft(h, now))}</span>`;
  const itemOf = (id) => { try { return game.items.getObjectByID(id); } catch { return undefined; } };
  /** How many of the item a shortage still wants (its base value left over the item's own). */
  const leftCount = (h, item) => Math.ceil(H.wantLeft(h) / Math.max(1, item?.sellsFor?.quantity ?? 1));
  const festName = (f) => t(FEST_KEYS[f.festival]?.[0] ?? 'MOD_VOY_HAPPEN_FEST_PLANTING');
  const festGoods = (f) => t(FEST_KEYS[f.festival]?.[1] ?? 'MOD_VOY_HAPPEN_FEST_PLANTING_GOODS');
  const PCT_HTML = () => `<span class="text-success font-w600">${H.SHORTAGE_PCT}%</span>`;
  const MULT_HTML = () => `<span class="text-success font-w600">×${H.FESTIVAL_MULT}</span>`;

  /** The Sell block's lines for an item at the market here (HTML): a shortage, a festival. */
  const sellLines = (m, item) => {
    if (!on() || !M().pressable(item)) return [];
    const { now } = current();
    const out = [];
    const sh = shortageAt(m.id, item.id);
    if (sh !== undefined) out.push(t('MOD_VOY_HAPPEN_SELL_SHORTAGE', { market: `<b>${esc(M().name(m.id))}</b>`, pct: PCT_HTML(), item: esc(item.name), n: esc(shortNumber(leftCount(sh, item))), time: timeHtml(sh, now) }));
    const f = festivalAt(m.id, item);
    if (f !== undefined) out.push(t('MOD_VOY_HAPPEN_SELL_FEST', { festival: `<b>${esc(festName(f))}</b>`, market: `<b>${esc(M().name(m.id))}</b>`, mult: MULT_HTML(), time: timeHtml(f, now) }));
    return out;
  };

  // ---- the news ---------------------------------------------------------------------------------------------------
  const marketById = (id) => M().all().find((m) => m.id === id);
  const away = (m) => { const pos = state.position?.(); const d = pos === undefined || m === undefined ? undefined : terrainMod.hexDistance(pos, m); return Number.isFinite(d) ? d : undefined; };
  /**
   * What you have heard of now: [{ h, m, hexes }] at the markets you know, once the news reached where you stand (the
   * market you stand at, at once), the shortest time left first.
   */
  const heard = () => {
    if (!on()) return [];
    const { now, live, fest } = current();
    const known = new Set((M().known?.() ?? []).map((m) => m.id));
    const hereId = M().here?.()?.id;
    const out = [];
    for (const h of [...live.filter((x) => x.kind === 'shortage'), ...(fest === undefined ? [] : [fest])]) {
      if (h.market !== hereId && !known.has(h.market)) continue;
      const m = marketById(h.market);
      const hexes = h.market === hereId ? 0 : away(m);
      if (hexes === undefined || !H.heard(h, hexes, now)) continue;
      out.push({ h, m, hexes });
    }
    // A blockade: only on a sea you sailed (it rolls nowhere else), told from its port; on that sea, at once.
    let seaHere;
    try { seaHere = state.charts?.seaAt?.(state.position?.()); } catch {}
    for (const h of live.filter((x) => x.kind === 'blockade')) {
      const m = marketById(h.sea);
      const hexes = seaHere === h.sea || hereId === h.sea || m === undefined ? 0 : away(m);
      if (hexes === undefined || !H.heard(h, hexes, now)) continue;
      out.push({ h, m, hexes });
    }
    out.sort((a, b) => a.h.end - b.h.end);
    // The first word heard writes the Guide page; after this read, as the Journal may be drawing it now.
    if (out.length > 0 && !taught) { taught = true; setTimeout(() => { try { state.journal?.learn?.('happenings'); } catch {} }, 0); }
    return out;
  };
  let taught = false;
  /**
   * A rumour read (src/charts.mjs): among the places not found yet (`unfound`: [{ q, r, … }]), a market with a shortage
   * or festival on, so the tale names it and what is on there. { …the place, words } or undefined.
   */
  const rumourPick = (unfound) => {
    if (!on() || !Array.isArray(unfound)) return undefined;
    const { now, live, fest } = current();
    const wanted = [...live.filter((x) => x.kind === 'shortage'), ...(fest === undefined ? [] : [fest])].sort((a, b) => a.end - b.end);
    for (const h of wanted) {
      const m = marketById(h.market);
      const p = m === undefined ? undefined : unfound.find((x) => M().marketAt?.(x.q, x.r)?.id === m.id);
      if (p === undefined) continue;
      const w = wordsOf({ h, m }, now);
      return { ...p, words: `${w.title}: ${w.line}` };
    }
    return undefined;
  };
  /** One happening's title and line, in plain words (the board's row, the Places mark, Welcome Back). */
  const wordsOf = ({ h, m }, now) => {
    if (h.kind === 'blockade') {
      const sea = seaName(h.sea);
      return {
        title: t('MOD_VOY_HAPPEN_ROW_BLOCKADE', { band: bandName(h.band), sea }),
        line: t('MOD_VOY_HAPPEN_ROW_BLOCKADE_LINE', { won: `${h.wins}`, need: `${H.BLOCKADE_WINS}`, time: timeLeft(h, now) }),
        more: t('MOD_VOY_HAPPEN_ROW_BLOCKADE_CARGO', { port: m === undefined ? sea : M().name(m.id), pct: `+${Math.round(H.CARGO_BONUS * 100)}%` }),
      };
    }
    const market = M().name(m.id);
    if (h.kind === 'festival') return { title: t('MOD_VOY_HAPPEN_ROW_FEST', { festival: festName(h), market }), line: t('MOD_VOY_HAPPEN_ROW_FEST_LINE', { goods: festGoods(h), mult: `×${H.FESTIVAL_MULT}`, time: timeLeft(h, now) }) };
    const item = itemOf(h.item);
    return { title: t('MOD_VOY_HAPPEN_ROW_SHORTAGE', { market, item: item?.name ?? h.item }), line: t('MOD_VOY_HAPPEN_ROW_SHORTAGE_LINE', { pct: `${H.SHORTAGE_PCT}%`, n: shortNumber(leftCount(h, item)), time: timeLeft(h, now) }) };
  };
  const hexWords = (n) => t(n === 1 ? 'MOD_VOY_HEXES_ONE' : 'MOD_VOY_HEXES_MANY', { count: `${n}` });
  const festMedia = () => { try { return state.weather?.season?.()?.media || ctx.getResourceUrl('assets/icon.webp'); } catch { return ctx.getResourceUrl('assets/icon.webp'); } };
  /** A happening's picture: the item wanted, the season's, the sea's port for a blockade. */
  const mediaOf = (h) => {
    if (h.kind === 'festival') return festMedia();
    if (h.kind === 'blockade') {
      const m = marketById(h.sea);
      try { return (m === undefined ? undefined : game.cartography.activeMap?.getHex(new HexCoords(m.q, m.r))?.pointOfInterest?.media) || ctx.getResourceUrl('assets/icon.webp'); } catch { return ctx.getResourceUrl('assets/icon.webp'); }
    }
    return itemOf(h.item)?.media ?? '';
  };
  /** A blockade's bounty after the GP icon, for the board's pay column. */
  const bountyHtml = (h) => {
    const gp = H.bountyOf(R()?.purseOf?.('sea', h.tier) ?? 0);
    let media = '';
    try { media = game.gp.media; } catch {}
    return `<img class="voyage-skill-name-icon" src="${esc(media)}" alt=""><b class="text-success">${esc(shortNumber(gp))}</b>`;
  };

  /** The harbour board's "Word from the harbours" (the Notices tab, src/tasks.mjs): '' when nothing is heard. */
  const boardHtml = () => {
    try {
      const list = heard();
      if (list.length === 0) return '';
      const { now } = current();
      const rows = list.map((x) => {
        const w = wordsOf(x, now);
        const media = mediaOf(x.h);
        const art = `<span class="voyage-cargo-art"><img class="voyage-cargo-box" src="${esc(media)}" alt=""></span>`;
        const where = x.hexes === 0 ? t('MOD_VOY_PLACES_HERE') : hexWords(x.hexes);
        const pay = x.h.kind === 'festival' ? MULT_HTML() : x.h.kind === 'blockade' ? bountyHtml(x.h) : PCT_HTML();
        const more = w.more === undefined ? '' : `<div class="text-muted">${esc(w.more)}</div>`;
        return `<div class="voyage-cargo-row">${art}<div class="voyage-cargo-mid"><div><b>${esc(w.title)}</b></div><div class="${x.h.kind === 'blockade' ? 'text-warning' : 'text-muted'}">${esc(w.line)}</div>${more}<div class="text-muted">${esc(where)}</div></div><div class="voyage-cargo-pay"><div>${pay}</div></div><div class="voyage-cargo-act"></div></div>`;
      });
      return `<div class="voyage-cargo-head">${esc(t('MOD_VOY_HAPPEN_WORD'))}</div>${rows.join('')}`;
    } catch (e) { log('board word failed', e); return ''; }
  };

  /** After the Here panel's "Trade: Open": what is on at the market here, in a few words ('' for nothing). */
  const hereWords = () => {
    try {
      if (!on()) return '';
      const m = M().here?.();
      if (m === undefined) return '';
      const { live, fest } = current();
      const parts = [];
      for (const h of live) {
        if (h.kind !== 'shortage' || h.market !== m.id) continue;
        parts.push(t('MOD_VOY_HAPPEN_HERE_SHORTAGE', { item: itemOf(h.item)?.name ?? h.item, pct: `${H.SHORTAGE_PCT}%` }));
      }
      if (fest !== undefined && fest.market === m.id) parts.push(festName(fest));
      return parts.join(' · ');
    } catch (e) { log('here happening words failed', e); return ''; }
  };

  /** The Here panel's Blockade line, on the blockaded sea or at its port ('' for none). */
  const panelHtml = () => {
    try {
      if (!on()) return '';
      let seaHere;
      try { seaHere = state.charts?.seaAt?.(state.position?.()); } catch {}
      const hereId = M().here?.()?.id;
      const h = current().live.find((x) => x.kind === 'blockade' && (x.sea === seaHere || x.sea === hereId));
      if (h === undefined) return '';
      const { now } = current();
      const text = t('MOD_VOY_HAPPEN_HERE_BLOCKADE', { band: bandName(h.band), sea: seaName(h.sea), won: `${h.wins}`, need: `${H.BLOCKADE_WINS}`, time: timeLeft(h, now) });
      return `<div class="voyage-here-place"><span class="voyage-here-label">${esc(t('MOD_VOY_HAPPEN_HERE_BLOCKADE_LABEL'))}</span> <span class="text-warning">${esc(text)}</span></div>`;
    } catch (e) { log('blockade panel line failed', e); return ''; }
  };

  /** The Places card's mark on a port's row: the happening heard there in words, or undefined. */
  const markAt = (q, r) => {
    try {
      const m = M().marketAt?.(q, r);
      if (m === undefined) return undefined;
      const x = heard().filter((y) => y.m?.id === m.id);
      if (x.length === 0) return undefined;
      const { now } = current();
      return x.map((y) => { const w = wordsOf(y, now); return `${w.title}: ${w.line}`; }).join('\n');
    } catch { return undefined; }
  };

  // ---- Welcome Back -----------------------------------------------------------------------------------------------
  // The happenings on that you would have heard of while away, AWAY_MAX at most, each told once.
  const awayLines = () => {
    const d = data();
    if (d === undefined) return [];
    const { now } = current();
    const fresh = heard().filter((x) => d.told[x.h.id] !== true).slice(0, AWAY_MAX);
    if (fresh.length === 0) return [];
    const live = new Set(heard().map((x) => x.h.id));
    d.told = Object.fromEntries([...Object.keys(d.told).filter((id) => live.has(id)), ...fresh.map((x) => x.h.id)].map((id) => [id, true]));
    return fresh.map((x) => {
      const media = mediaOf(x.h);
      const w = wordsOf(x, now);
      return `<img class="skill-icon-xs mr-1" src="${esc(media)}" alt="">${esc(t('MOD_VOY_HAPPEN_AWAY', { title: w.title, line: w.line }))}`;
    });
  };
  try {
    ctx.patch(OfflineProgressElement, 'setMessages').after(function () {
      try {
        if (this.messageContainer == null) return;
        for (const html of awayLines()) { const h = document.createElement('h5'); h.className = 'font-w600 mb-1'; h.innerHTML = html; this.messageContainer.append(h); }
      } catch (e) { log('happenings offline lines failed', e); }
    });
  } catch (e) { log('happenings offline summary not patched', e); }

  // ---- checks only (dev.mjs voyageDev.happen) -----------------------------------------------------------------
  const force = {
    /** A shortage of an item at a market (the one in reach by default) that began `hoursAgo` of game time ago. */
    shortage(itemId, marketId = M().here?.()?.id, hoursAgo = 0) {
      const d = advance();
      const item = itemOf(itemId);
      const m = marketById(marketId);
      if (d === undefined || item === undefined || m === undefined) return 'needs a loaded save, an item id and a market (stand at one or name it)';
      const now = gameNow();
      const s = H.slotOf(now);
      const start = Math.max(0, now - hoursAgo * 3600000);
      const h = { id: `${s}:shortage`, kind: 'shortage', slot: s, start, end: start + H.SHORTAGE_MS, market: m.id, item: item.id, want: Math.round(M().depth(m) * H.SHORTAGE_WANT), sold: 0 };
      put({ ...d, live: [h, ...d.live.filter((x) => x.id !== h.id)] });
      M().redrawSell?.();
      return h;
    },
    /** A festival of a season's (spring, summer, fall, winter) at a market (the one in reach by default) from now; none with no key. */
    festival(key, marketId = M().here?.()?.id) {
      view = undefined;
      if (key === undefined) { forcedFest = undefined; return 'festival cleared'; }
      const now = gameNow();
      const f = H.festivalFor({ key, start: now }, seedOf(), [marketId].filter(Boolean));
      forcedFest = f;
      M().redrawSell?.();
      return f ?? 'no festival that season, or no market';
    },
    /** A blockade of a chart sea (the one you are on by default) by a sea band (the first by default), from now. */
    blockade(sea, band) {
      const d = advance();
      let seaHere;
      try { seaHere = state.charts?.seaAt?.(state.position?.()); } catch {}
      const id = sea ?? seaHere;
      const tier = R()?.SEA_TIER?.[id];
      const bands = rollCtx().bands;
      const b = band ?? bands[0];
      if (d === undefined || !H.BLOCKADE_TIERS.includes(tier) || !bands.includes(b)) return `needs a chart sea of tier 1-3 (${Object.keys(R()?.SEA_TIER ?? {}).join(', ')}) and a sea band (${bands.join(', ')})`;
      const now = gameNow();
      const s = H.slotOf(now);
      const h = { id: `${s}:blockade`, kind: 'blockade', slot: s, start: now, end: now + H.BLOCKADE_MS, sea: id, tier, band: b, wins: 0 };
      put({ ...d, live: [h, ...d.live.filter((x) => x.id !== h.id && x.kind !== 'blockade')] });
      return h;
    },
    /** Every happening off: the save's list emptied, the slots up to now counted as rolled. */
    clear() { const d = advance(); if (d === undefined) return 'no save'; put({ ...d, live: [], told: {} }); forcedFest = undefined; return 'cleared'; },
    /** The save's happenings and what is on now. */
    list() { return { save: data(), now: current() }; },
  };

  const api = { current, shortageAt, festivalAt, depthFactor, adjust, sold, sellLines, heard, boardHtml, hereWords, panelHtml, markAt, blockadeOn, wonAt, cargoPay, rumourPick, force };
  state.happenings = api;
  return api;
}
