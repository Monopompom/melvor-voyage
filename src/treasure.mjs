// Treasure maps (round 6). Three map items (a Torn Map, a Weathered Chart, a Captain's Map) drop from bands, the
// rival and wrecked seas; read from the bank, one becomes a map held: its clue, the hex its treasure lies on (never
// told), the hexes dug for it. Dig here on your own hex is a timer on the game clock, like a tent going up: moving off
// the hex loses it, a wrong hex marks the map, the third wrong one ends it, the right one pays its prize. A Captain's
// Map's treasure is guarded now and then; Run leaves it there, marked on the map.
// The rules are pure (treasure-model.mjs); this module reads the game and draws.
//
// The save: `record.maps` (v35), { n, held, left, dig }, cleaned where it is read.

const MAP_ART = { 1: 'assets/torn_map.webp', 2: 'assets/weathered_chart.webp', 3: 'assets/captains_map.webp' };
const DIG_WHY = {
  off: 'MOD_VOY_MAP_DIG_WHY_OFF', band: 'MOD_VOY_CAIRN_WHY_BAND', moving: 'MOD_VOY_CAIRN_WHY_MOVING', sea: 'MOD_VOY_MAP_DIG_WHY_SEA',
  dug: 'MOD_VOY_MAP_DIG_WHY_DUG', none: 'MOD_VOY_MAP_DIG_WHY_NONE', busy: 'MOD_VOY_MAP_DIG_WHY_BUSY',
};

export function install(ctx, { state, T, hexes, terrainMod, helpLayout, shortNumber, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const skill = () => state.voyageSkill?.();
  const usable = () => { const s = skill(); return s !== undefined && s.futureRaw === undefined; };
  const notify = (text, kind = 'success') => { try { notifyPlayer(skill(), text, kind); } catch {} };
  const gameNow = () => { try { return state.gameNow?.() ?? Date.now(); } catch { return Date.now(); } };
  const offlineNow = () => { try { return game._isInOnlineLoop === false; } catch { return false; } };
  const seedOf = () => { try { return game.characterName ?? 'captain'; } catch { return 'captain'; } };
  const count = (n) => (typeof shortNumber === 'function' ? shortNumber(n) : numberWithCommas(n));
  // A time never breaks across lines ("(1h" / "0m)" in a narrow popup, .742): its spaces are non-breaking.
  const duration = (ms) => {
    const m = Math.max(1, Math.ceil(ms / 60000));
    return (m >= 60 ? t('MOD_VOY_CLOCK_H_M', { h: `${Math.floor(m / 60)}`, m: `${m % 60}` }) : t('MOD_VOY_CLOCK_M', { m: `${m}` })).replace(/ /g, ' ');
  };
  const byKey = new Map(hexes.map((h) => [`${h.q},${h.r}`, h]));
  const same = (a, b) => a != null && b != null && a.q === b.q && a.r === b.r;

  // ---- the save ------------------------------------------------------------------------------------------------------
  const record = () => (usable() ? skill().record : undefined);
  let cleanedFor;
  /** `record.maps`, cleaned the first time it is read for a save. */
  const maps = () => {
    const rec = record();
    if (rec === undefined) return undefined;
    if (cleanedFor !== rec) { rec.maps = T.cleanMaps(rec.maps); cleanedFor = rec; }
    return rec.maps;
  };
  const held = () => maps()?.held ?? [];
  const mapById = (id) => held().find((m) => m.id === id);
  let stamp = 0;
  const changed = () => {
    stamp += 1;
    const s = skill();
    if (s !== undefined) s.renderQueue.page = true;
    try { state.herePanel?.render?.(); } catch {}
    try { refreshMarkers(); } catch (e) { log('treasure markers failed', e); }
    try { state.journal?.refresh?.(); } catch {}
  };

  // ---- the table and what you know -----------------------------------------------------------------------------------
  let prepared;
  const P = () => {
    const regions = state.pilotage?.regions?.() ?? new Map();
    if (prepared === undefined || prepared.regions !== regions) prepared = T.prepare(hexes, regions);
    return prepared;
  };
  const liveHex = (q, r) => { try { return game.cartography.activeMap?.getHex(new HexCoords(q, r)); } catch { return undefined; } };
  const known = () => new Set(hexes.filter((h) => state.knowledge?.isKnown?.(h) === true).map((h) => `${h.q},${h.r}`));
  /** The places you have found, by the table's POI id. */
  const named = () => {
    const out = new Set();
    for (const h of P().places.values()) { if (liveHex(h.q, h.r)?.pointOfInterest?.isDiscovered === true) out.add(h.poi); }
    return out;
  };
  const placeName = (poi) => {
    const h = P().places.get(poi);
    const p = h === undefined ? undefined : liveHex(h.q, h.r)?.pointOfInterest;
    return p?.name ?? String(poi).replace(/([a-z])([A-Z])/g, '$1 $2');
  };

  // ---- the items -----------------------------------------------------------------------------------------------------
  const mapItem = (grade) => { try { return game.items.getObjectByID(`voyage:${T.MAP_ITEMS[grade]}`); } catch { return undefined; } };
  const gradeOf = (item) => (item?.id?.startsWith?.('voyage:') ? T.gradeOfItem(item.id) : undefined);
  const itemName = (grade) => mapItem(grade)?.name ?? getLangString(`MOD_VOY_ITEM_${T.MAP_ITEMS[grade].toUpperCase()}_NAME`);
  /** A map held's name: "Torn Map no. 3". */
  const mapName = (m) => t('MOD_VOY_MAP_NAME', { name: itemName(m.grade), n: m.id.replace(/^m/, '') });
  /** The same name in two lines, the map's number always on the second: ["Torn Map", "no. 3"] (the user, 28 Nov 2026). */
  const mapNameLines = (m) => {
    const mark = '\u0001';
    const whole = t('MOD_VOY_MAP_NAME', { name: mark, n: m.id.replace(/^m/, '') });
    const at = whole.indexOf(mark);
    if (at < 0) return [whole];
    const first = `${whole.slice(0, at)}${itemName(m.grade)}`.trim();
    const second = whole.slice(at + mark.length).trim();
    return second === '' ? [first] : [first, second];
  };
  /** A map to the bank, as a find: from a band's loot, the rival, a wreck. */
  const giveMap = (grade, why) => {
    const item = mapItem(grade);
    if (item === undefined) return undefined;
    game.bank.addItem(item, 1, false, true, true, true, 'Voyage');
    log(`treasure: ${item.id} found (${why})`);
    return item;
  };
  /** A cargo delivered at `poi`: a wrecked sea gives a map now and then, of the sea's grade. */
  const rollWreck = (poi) => {
    const sea = state.charts?.seaOf?.(poi);
    if (!Array.isArray(sea) || !sea.some((h) => Array.isArray(h.f) && h.f.includes('wreckage'))) return undefined;
    if (Math.random() >= T.WRECK_CHANCE) return undefined;
    const tier = state.encounters?.R?.SEA_TIER?.[poi] ?? 1;
    const item = giveMap(T.gradeOfTier(tier), `wreck by ${poi}`);
    if (item !== undefined) { try { game.notifications.createInfoNotification('voyage:map', t('MOD_VOY_MAP_WRECK', { name: item.name }), item.media); } catch {} }
    return item;
  };

  // ---- the clue in words ---------------------------------------------------------------------------------------------
  const word = (key, fallback) => { const s = getLangString(key); return s === '' || s === undefined ? fallback : s; };
  const feature = (f) => word(`MOD_VOY_FEATURE_${f}`, f);
  /** One fact of a clue as the Journal's hand writes it. */
  const factText = (x) => {
    switch (x?.k) {
      case 'class': return t('MOD_VOY_MAP_FACT_CLASS', { ground: word(`MOD_VOY_TERRAIN_${x.t}`, x.t) });
      case 'look': return t('MOD_VOY_MAP_FACT_LOOK', { feature: feature(x.f) });
      case 'coast': return t('MOD_VOY_MAP_FACT_COAST');
      case 'region': return t('MOD_VOY_MAP_FACT_REGION', { area: state.pilotage?.nameOf?.(x.area) ?? x.area });
      case 'near': return t(x.d === 1 ? 'MOD_VOY_MAP_FACT_NEAR_ONE' : 'MOD_VOY_MAP_FACT_NEAR', { kind: feature(x.kind), n: `${x.d}` });
      case 'range': return t('MOD_VOY_MAP_FACT_RANGE', { kind: feature(x.kind), lo: `${x.lo}`, hi: `${x.hi}` });
      case 'from': return t(x.d === 1 ? 'MOD_VOY_MAP_FACT_FROM_ONE' : 'MOD_VOY_MAP_FACT_FROM', { place: placeName(x.place), n: `${x.d}` });
      case 'dir': return t('MOD_VOY_MAP_FACT_DIR', { place: placeName(x.place), dir: getLangString(`MOD_VOY_DIR_${x.dir}`) });
      default: return '';
    }
  };
  /** A held map whose target no longer answers its own clue (the table changed): still the answer, the Journal says so. */
  const isOld = (m) => { const h = P().byKey.get(`${m.q},${m.r}`); return h === undefined || !m.facts.every((x) => T.fits(h, x, P())); };
  const clueHtml = (m) => `<ul class="voyage-map-clue mb-0">${m.facts.map((x) => `<li>${esc(factText(x))}</li>`).join('')}</ul>`;

  // ---- reading a map -------------------------------------------------------------------------------------------------
  const cartLevel = () => { try { return game.cartography?.level ?? 1; } catch { return 1; } };
  /** Why a map of `grade` can't be read now: 'level', 'full', or ''. */
  const readWhy = (grade) => {
    if (cartLevel() < (T.READ_LEVEL[grade] ?? 1)) return 'level';
    if (held().length >= T.MAX_HELD) return 'full';
    return '';
  };
  const readLine = (grade) => {
    const why = readWhy(grade);
    if (why === 'level') return { text: t('MOD_VOY_MAP_READ_LEVEL', { level: `${T.READ_LEVEL[grade]}` }), why };
    if (why === 'full') return { text: t('MOD_VOY_MAP_READ_FULL', { max: `${T.MAX_HELD}` }), why };
    return { text: t('MOD_VOY_MAP_READ_BODY', { n: `${held().length}`, max: `${T.MAX_HELD}` }), why };
  };
  const popup = (title, media, sections) => {
    try {
      SwalLocale.fire({
        didRender: state.popupDidRender,
        title: esc(title),
        ...(media ? { imageUrl: media, ...helpLayout.MSG_IMAGE } : {}),
        width: helpLayout.HELP_WIDTH,
        html: helpLayout.helpHtml(sections, { notice: true }),
        confirmButtonText: t('MOD_VOY_BUTTON_GOT_IT'),
        customClass: (() => { const c = { popup: 'voyage-ui', confirmButton: 'btn btn-success m-1' }; return typeof createSwalCustomClass === 'function' ? createSwalCustomClass(c) : c; })(),
      });
    } catch (e) { log('treasure popup failed', e); }
  };
  /** Reads one map from the bank: it goes, and a map held with its clue takes its place. */
  const read = (item) => {
    const grade = gradeOf(item);
    if (!usable() || grade === undefined || game.bank.getQty(item) < 1) return false;
    const why = readWhy(grade);
    if (why !== '') { notify(readLine(grade).text, 'danger'); return false; }
    const m = maps();
    const id = `m${m.n + 1}`;
    const map = T.readMap(`${seedOf()}|${id}`, grade, P(), known(), named());
    if (map === undefined) { notify(t('MOD_VOY_MAP_READ_NONE'), 'info'); return false; }
    game.bank.removeItemQuantity(item, 1, false);
    m.n += 1;
    const entry = { id, grade: map.grade, q: map.q, r: map.r, facts: map.facts, dug: [], at: gameNow() };
    m.held.push(entry);
    log(`treasure: ${item.id} read as ${id}, grade ${map.grade}, ${map.facts.length} facts`);
    try { state.journal?.learn?.('treasure', true); } catch {}
    const body = [{ html: `<i>${esc(t(`MOD_VOY_MAP_TALE_${map.grade}`))}</i>`, cls: 'voyage-rumour-tale' }];
    const clue = [{ html: clueHtml(entry) }];
    if (map.grade < grade) clue.push({ html: esc(t('MOD_VOY_MAP_READ_LOWER', { name: itemName(map.grade) })), cls: 'text-warning' });
    clue.push({ html: esc(t('MOD_VOY_MAP_READ_HOW', { time: duration(T.DIG_MS[map.grade]), n: `${T.MAX_WRONG}` })), cls: 'text-muted' });
    popup(mapName(entry), item.media, [{ body }, { body: clue }]);
    changed();
    return true;
  };

  // The bank: a "Read" block under Sell for a map, in Sell's own look (as the rumours', src/charts.mjs).
  ctx.patch(BankSelectedItemMenuElement, 'setItem').after(function (_r, bankItem) {
    try {
      let box = this.querySelector('.voyage-map-read');
      const grade = gradeOf(bankItem?.item);
      if (grade === undefined || !usable()) { (box?.closest('.voyage-map-col') ?? box)?.classList.add('d-none'); return; }
      const sell = this.sellItemButton?.closest('.block');
      if (box === null) {
        box = document.createElement('div');
        const col = document.createElement('div');
        col.className = 'col-12 voyage-map-col';
        col.append(box);
        let after = sell;
        for (let i = 0; after !== null && after !== undefined && i < 4 && after.parentElement !== null; i++) {
          const css = getComputedStyle(after.parentElement);
          if (!(css.display.includes('flex') && !css.flexDirection.startsWith('column') && css.flexWrap === 'nowrap')) break;
          after = after.parentElement;
        }
        if (after) after.after(col); else this.selectedItemContainer?.append(col);
      }
      box.closest('.voyage-map-col')?.classList.remove('d-none');
      const look = (sell?.className ?? 'block block-rounded bg-combat-inner-dark').split(/\s+/).filter((c) => !/^col(-|$)/.test(c)).join(' ');
      box.className = `${look} voyage-map-read voyage-ui`;
      const headClass = sell?.querySelector('.block-header')?.className ?? 'block-header block-header-default';
      const titleClass = sell?.querySelector('.block-header > :first-child')?.className || 'font-size-sm font-w600 mb-0';
      const mainColClass = this.sellItemButton?.parentElement?.className || 'col-12 text-center';
      const mainClass = (this.sellItemButton?.className ?? 'btn btn-danger').replace('btn-danger', 'btn-success');
      const line = readLine(grade);
      const button = line.why === ''
        ? `<button type="button" class="${mainClass} voyage-map-go">${esc(t('MOD_VOY_RUMOUR_READ'))}</button>`
        : `<button type="button" class="${mainClass.replace('btn-success', 'btn-outline-secondary')} disabled voyage-map-go" aria-disabled="true" title="${esc(line.text)}">${esc(t('MOD_VOY_RUMOUR_READ'))}</button>`;
      box.innerHTML = `<div class="${headClass}"><h5 class="${titleClass}">${esc(t('MOD_VOY_RUMOUR_READ_TITLE'))}</h5></div>`
        + `<div class="col-12 pt-2"><div class="row no-gutters"><div class="col-12 py-1${line.why === '' ? '' : ' text-warning'}">${esc(line.text)}</div>`
        + `<div class="${mainColClass}">${button}</div></div></div>`;
      const item = bankItem.item;
      const menu = this;
      box.querySelector('.voyage-map-go')?.addEventListener('click', (ev) => {
        if (ev.currentTarget?.getAttribute?.('aria-disabled') === 'true') { notify(readLine(grade).text, 'danger'); return; }
        if (!read(item)) return;
        const left = game.bank.items.get(item);
        if (left !== undefined && left.quantity > 0) { try { menu.setItem(left, game.bank); } catch (e) { log('map read redraw failed', e); } }
      });
    } catch (e) { log('map read block failed', e); }
  });

  // ---- digging -------------------------------------------------------------------------------------------------------
  const dig = () => maps()?.dig;
  const recAt = (p) => (p === undefined ? undefined : byKey.get(`${p.q},${p.r}`));
  /** The maps that may be dug on `pos`: held, this hex not dug for them yet. */
  const diggable = (pos) => held().filter((m) => !m.dug.some(([q, r]) => q === pos.q && r === pos.r));
  /** Why Dig here is greyed on your hex: a DIG_WHY key, or ''. */
  const digWhy = () => {
    if (!usable()) return 'off';
    const pos = state.position?.();
    if (pos === undefined) return 'off';
    if (held().length === 0) return 'none';
    if (dig() !== undefined) return 'busy';
    if (state.encounters?.fightOpen?.() === true) return 'band';
    if (state.clock?.running?.() === true) return 'moving';
    const rec = recAt(pos);
    if (rec === undefined || rec.t === 'water' || rec.cloud === true) return 'sea';
    if (diggable(pos).length === 0) return 'dug';
    return '';
  };
  /** Starts digging for map `id` on your hex: the game clock runs it. */
  const start = (id) => {
    if (digWhy() !== '') return false;
    const pos = state.position();
    const m = diggable(pos).find((x) => x.id === id);
    if (m === undefined) return false;
    const now = gameNow();
    maps().dig = { id: m.id, q: pos.q, r: pos.r, start: now, end: now + T.DIG_MS[m.grade] };
    log(`treasure: digging for ${m.id} on ${pos.q},${pos.r}`);
    changed();
    return true;
  };
  /** Stops the dig: the time spent is lost, the hex is not marked. */
  const stop = (why = 'stop') => {
    const m = maps();
    if (m?.dig === undefined) return false;
    const was = mapById(m.dig.id);
    delete m.dig;
    log(`treasure: dig stopped (${why})`);
    if (why === 'moved' && was !== undefined) notify(t('MOD_VOY_MAP_DIG_LOST', { name: mapName(was) }), 'info');
    changed();
    return true;
  };
  const digLeft = () => { const d = dig(); return d === undefined ? 0 : Math.max(0, d.end - gameNow()); };

  // The tier and ground of a treasure's hex: land by its ground, a shoal by its sea; at least 1.
  const groundOf = (m) => {
    const rec = recAt(m);
    const R = state.encounters?.R;
    if (rec === undefined || R === undefined) return { where: 'land', tier: 1, ground: rec?.t ?? '' };
    if (rec.t === 'shoal') {
      const sea = state.charts?.seaAt?.(rec);
      return { where: 'sea', tier: Math.max(1, R.seaTier(sea, false)), ground: sea ?? '' };
    }
    const d = (Math.abs(rec.q - R.HIDEOUT_HEX.q) + Math.abs(rec.r - R.HIDEOUT_HEX.r) + Math.abs(rec.q + rec.r - R.HIDEOUT_HEX.q - R.HIDEOUT_HEX.r)) / 2;
    return { where: 'land', tier: Math.max(1, R.landTier(rec.t, d)), ground: rec.t };
  };
  const bandFor = (where, key) => {
    const list = state.encounters?.E?.bandsOf?.(where) ?? [];
    return list.length === 0 ? undefined : list[T.hash(key) % list.length];
  };
  const giveItem = (id, qty) => {
    try {
      const it = game.items.getObjectByID(id);
      if (it === undefined || qty <= 0) return undefined;
      game.bank.addItem(it, qty, false, true, true, true, 'Voyage');
      return it;
    } catch (e) { log(`treasure: ${id} not given`, e); return undefined; }
  };
  /** Pays map `m`'s prize: GP, Pitch and its extra rolls, then the map is gone. A popup tells what. */
  const payPrize = (m) => {
    const g = groundOf(m);
    const E = state.encounters;
    const purse = E?.R?.purseOf?.(g.where, g.tier) ?? 0;
    const prize = T.prizeOf(m.grade, purse);
    const lines = [];
    const itemLine = (it, qty) => ({ html: `${it?.media ? `<img class="voyage-skill-name-icon" src="${it.media}" alt="">` : ''}${esc(t('MOD_VOY_MAP_PRIZE_ITEM', { name: it?.name ?? '', n: count(qty) }))}` });
    if (prize.gp > 0) { game.gp.add(prize.gp); lines.push({ html: t('MOD_VOY_MAP_PRIZE_GP', { gp: `<span class="text-success">${esc(count(prize.gp))}</span>` }) }); }
    const pitch = giveItem('voyage:Pitch', prize.pitch);
    if (pitch !== undefined) lines.push(itemLine(pitch, prize.pitch));
    const L = E?.L;
    for (const x of prize.extra) {
      if (x === 'bankslot') { const it = giveItem(L?.BANK_SLOT_TOKEN ?? 'melvorF:Bank_Slot_Token', 1); if (it) lines.push(itemLine(it, 1)); }
      else if (x === 'signet') { const id = (L?.SIGNET_HALVES ?? [])[Math.random() < 0.5 ? 0 : 1]; const it = id && giveItem(id, 1); if (it) lines.push(itemLine(it, 1)); }
      else if (x === 'token') {
        const band = bandFor(g.where, `${m.id}|token`);
        const id = band === undefined ? undefined : L?.TOKENS?.[L?.LOOT?.[band]?.skill];
        const qty = 1 + Math.floor(Math.random() * 3);
        const it = id && giveItem(id, qty);
        if (it) lines.push(itemLine(it, qty));
      } else if (x === 'card') {
        const c = E?.giveCard?.();
        if (c !== undefined) lines.push({ html: esc(t('MOD_VOY_ENC_RES_CARD', { name: c })) });
      } else if (x === 'relic') {
        try {
          const s = skill();
          if (game.currentGamemode?.allowAncientRelicDrops === true && typeof s?.rollForAncientRelics === 'function') s.rollForAncientRelics(Math.max(1, Math.floor(s.level)), game.defaultRealm);
        } catch (e) { log('treasure relic roll failed', e); }
      }
    }
    const mm = maps();
    mm.held = mm.held.filter((x) => x.id !== m.id);
    mm.left = mm.left.filter((x) => !same(x, m));
    mm.found = (Number.isInteger(mm.found) ? mm.found : 0) + 1;
    log(`treasure: ${m.id} found at ${m.q},${m.r}: ${prize.gp} GP, ${prize.pitch} Pitch, ${prize.extra.join(', ') || 'no extra'}`);
    popup(t('MOD_VOY_MAP_FOUND_TITLE'), mapItem(m.grade)?.media, [
      { body: [{ html: `<i>${esc(t(`MOD_VOY_MAP_FOUND_TALE_${m.grade}`))}</i>`, cls: 'voyage-rumour-tale' }] },
      { body: lines },
    ]);
    changed();
  };
  /** The guard's fight is over (encounters.mjs close): beaten, the prize is yours; else it stays guarded there. */
  const guardDone = (id, beaten) => {
    const m = mapById(id);
    if (m === undefined) return;
    if (beaten) { payPrize(m); return; }
    log(`treasure: ${id} still guarded at ${m.q},${m.r}`);
    changed();
  };
  let forceGuard; // a dev hook's guard for the next grade 3 find
  /** The dig is done: nothing (the hex marked), the map falling apart, or the treasure (perhaps guarded). */
  const finish = () => {
    const d = dig();
    const m = d === undefined ? undefined : mapById(d.id);
    const mm = maps();
    if (m === undefined) { if (mm !== undefined) delete mm.dig; return; }
    const out = T.digOutcome(m, d);
    delete mm.dig;
    if (out === 'nothing') {
      m.dug.push([d.q, d.r]);
      notify(t('MOD_VOY_MAP_DUG_NOTHING', { name: mapName(m), n: `${T.MAX_WRONG - m.dug.length}` }), 'info');
      log(`treasure: ${m.id} dug ${d.q},${d.r}: nothing (${m.dug.length} wrong)`);
    } else if (out === 'apart') {
      mm.held = mm.held.filter((x) => x.id !== m.id);
      mm.lost = (Number.isInteger(mm.lost) ? mm.lost : 0) + 1;
      popup(mapName(m), mapItem(m.grade)?.media, [{ body: [{ html: esc(t('MOD_VOY_MAP_APART', { n: `${T.MAX_WRONG}` })) }] }]);
      log(`treasure: ${m.id} fell apart`);
    } else {
      const left = mm.left.find((x) => same(x, m));
      const guarded = m.grade === 3 && (left !== undefined || (forceGuard ?? Math.random() < T.GUARD_CHANCE));
      forceGuard = undefined;
      if (!guarded) { payPrize(m); return; }
      const g = groundOf(m);
      const band = left?.band ?? bandFor(g.where, `${m.id}|guard`);
      if (left === undefined && band !== undefined) { mm.left.push({ q: m.q, r: m.r, grade: m.grade, band }); if (mm.left.length > T.LEFT_MAX) mm.left.shift(); }
      const began = band !== undefined && state.encounters?.guardFight?.({ id: `treasure:${m.id}`, name: mapName(m), guard: { band, tier: g.tier, ground: g.ground } }) === true;
      if (!began) { payPrize(m); return; }
      log(`treasure: ${m.id} guarded by ${band}`);
    }
    changed();
  };
  /** The game clock's tick (the Voyage skill's passive tickers): moving off the hex stops the dig; done, it is read. */
  let passiveTicks = 0;
  const tick = () => {
    const d = dig();
    if (d === undefined) return;
    const pos = state.position?.();
    if (pos !== undefined && !same(pos, d)) { stop('moved'); return; }
    if (gameNow() < d.end || offlineNow() || state.encounters?.fightOpen?.() === true) return;
    finish();
  };
  const passiveTick = () => {
    passiveTicks += 1;
    if (passiveTicks < (offlineNow() ? 200 : 20)) return;
    passiveTicks = 0;
    tick();
  };
  let shown = '';
  setInterval(() => {
    try {
      if (!usable()) return;
      tick();
      const d = dig();
      const sig = d === undefined ? '' : `${d.id}:${duration(digLeft())}`;
      if (sig !== shown) { shown = sig; try { state.herePanel?.render?.(); } catch {} }
    } catch (e) { log('treasure dig failed', e); }
  }, 1000);

  // ---- the Here panel ------------------------------------------------------------------------------------------------
  const digBtn = (act, cls, label, attrs = '') => `<button type="button" class="btn btn-sm ${cls} voyage-row-btn voyage-dig-btn" data-dig-act="${act}"${attrs}>${esc(label)}</button>`;
  const panelHtml = () => {
    if (!usable()) return '';
    const pos = state.position?.();
    if (pos === undefined) return '';
    const label = `<span class="voyage-here-label">${esc(t('MOD_VOY_MAP_LABEL'))}</span> `;
    let html = '';
    const left = maps()?.left?.find((x) => same(x, pos));
    if (left !== undefined) {
      // The shield and the first word sit on the "Treasure map:" line (the user, 28 Nov 2026); the rest wraps after them.
      const said = t('MOD_VOY_MAP_LEFT_HERE', { band: state.encounters?.bandName?.(left.band) ?? left.band });
      const cut = said.indexOf(' ');
      const head = cut < 0 ? Array.from(said)[0] ?? '' : said.slice(0, cut);
      const rest = said.slice(head.length);
      html += `<div class="voyage-here-ship voyage-dig-row"><span>${label}<span class="text-warning"><span class="text-nowrap"><i class="fa fa-shield-alt mr-1" aria-hidden="true"></i>${esc(head)}</span>${esc(rest)}</span></span></div>`;
    }
    const d = dig();
    if (d !== undefined) {
      const m = mapById(d.id);
      html += `<div class="voyage-here-ship voyage-dig-row"><span title="${esc(t('MOD_VOY_MAP_DIG_GOING_TIP'))}">${label}${esc(t('MOD_VOY_MAP_DIG_GOING', { name: m === undefined ? '' : mapName(m), time: duration(digLeft()) }))}</span>`
        + `${digBtn('stop', 'btn-outline-danger', t('MOD_VOY_MAP_DIG_STOP'))}</div>`;
      return html;
    }
    if (held().length === 0) return html;
    const why = digWhy();
    const text = t(held().length === 1 ? 'MOD_VOY_MAP_DIG_ONE' : 'MOD_VOY_MAP_DIG_MANY', { n: `${held().length}` });
    const btn = why === ''
      ? digBtn('start', 'btn-success', t('MOD_VOY_MAP_DIG'))
      : digBtn('start', 'btn-outline-secondary disabled', t('MOD_VOY_MAP_DIG'), ` aria-disabled="true" title="${esc(t(DIG_WHY[why] ?? DIG_WHY.off))}"`);
    return `${html}<div class="voyage-here-ship voyage-dig-row"><span>${label}${esc(text)}</span>${btn}</div>`;
  };
  /** Dig here with more than one map that may be dug: pick which, each with its clue. */
  const pick = (list, done) => {
    try {
      const rows = list.map((m) => `<div class="voyage-map-pick-row text-left mb-2"><div class="d-flex justify-content-between align-items-center"><b>${esc(mapName(m))}</b>`
        + `<button type="button" class="btn btn-sm btn-success voyage-map-pick" data-map="${esc(m.id)}">${esc(t('MOD_VOY_MAP_DIG'))}</button></div>${clueHtml(m)}`
        + `<small class="text-muted">${esc(t('MOD_VOY_MAP_DIG_TAKES', { time: duration(T.DIG_MS[m.grade]) }))}</small></div>`).join('');
      SwalLocale.fire({
        title: esc(t('MOD_VOY_MAP_PICK_TITLE')),
        width: helpLayout.HELP_WIDTH,
        html: `<div class="voyage-help-body">${rows}</div>`,
        showConfirmButton: false,
        showCancelButton: true,
        cancelButtonText: t('MOD_VOY_OUTPOST_CANCEL'),
        customClass: (() => { const c = { popup: 'voyage-ui', cancelButton: 'btn btn-secondary m-1' }; return typeof createSwalCustomClass === 'function' ? createSwalCustomClass(c) : c; })(),
        didRender: (el) => {
          try { state.popupDidRender?.(el); } catch {}
          for (const b of (el ?? document).querySelectorAll('.voyage-map-pick')) {
            b.addEventListener('click', () => { try { Swal.close(); } catch {} if (start(b.dataset.map)) done?.(); });
          }
        },
      });
    } catch (e) { log('map pick failed', e); }
  };
  const click = (btn, done) => {
    const act = btn?.dataset?.digAct;
    if (act === 'stop') { stop('stop'); done?.(); return; }
    if (act !== 'start') return;
    const why = digWhy();
    if (why !== '') { notify(t(DIG_WHY[why] ?? DIG_WHY.off), 'danger'); return; }
    const list = diggable(state.position());
    if (list.length === 1) { if (start(list[0].id)) done?.(); return; }
    pick(list, done);
  };
  /** Set off while a dig runs on the hex you leave: the ask says the dig is lost. '' with none. */
  const digLeftHtml = () => {
    const d = dig();
    const pos = state.position?.();
    if (d === undefined || !same(pos, d)) return '';
    return `<div class="voyage-storm-ahead voyage-tent-left"><i class="fa fa-map-marked-alt" aria-hidden="true"></i><span><b>${esc(t('MOD_VOY_MAP_DIG_LEFT_HEAD'))}</b> `
      + `${esc(t('MOD_VOY_MAP_DIG_LEFT', { time: duration(Math.max(60000, digLeft())) }))}</span></div>`;
  };

  // ---- the map: a cross on every hex dug for a map held, a shield where a guarded prize was left ---------------------
  const marks = new Map();
  const MARK_H = 100;
  const drawMark = (kind) => {
    const g = new PIXI.Graphics();
    g.eventMode = 'none';
    if (kind === 'left') {
      g.lineStyle(5, 0x24262b, 1).beginFill(0x8a5a2b, 1).drawRoundedRect(-40, -60, 80, 52, 8).endFill();
      g.lineStyle(5, 0x24262b, 1).beginFill(0xc9a24a, 1).drawRect(-40, -44, 80, 10).endFill();
      g.lineStyle(4, 0x24262b, 1).beginFill(0xc0392b, 1).drawPolygon([18, -60, 18, -MARK_H - 20, 52, -MARK_H - 8, 18, -MARK_H + 4]).endFill();
    } else {
      g.lineStyle(18, 0x24262b, 1).moveTo(-30, -80).lineTo(30, -20).moveTo(30, -80).lineTo(-30, -20);
      g.lineStyle(10, 0xc0392b, 1).moveTo(-30, -80).lineTo(30, -20).moveTo(30, -80).lineTo(-30, -20);
    }
    return g;
  };
  const refreshMarkers = () => {
    if (typeof cartographyMap === 'undefined' || cartographyMap === null) return;
    const layer = cartographyMap.markerLayer;
    const map = cartographyMap._lastDrawnMap ?? game.cartography?.activeMap;
    if (layer === undefined || map === undefined) return;
    const want = new Map();
    if (usable()) {
      for (const m of held()) for (const [q, r] of m.dug) want.set(`dug:${q},${r}`, { q, r, kind: 'dug' });
      for (const x of maps()?.left ?? []) want.set(`left:${x.q},${x.r}`, { q: x.q, r: x.r, kind: 'left' });
    }
    for (const [key, g] of marks) {
      if (want.has(key) && !g.destroyed) continue;
      try { if (!g.destroyed) g.destroy(); } catch {}
      marks.delete(key);
    }
    const tall = HexCoords.SQRT3 * map.hexScale.y;
    for (const [key, o] of want) {
      let g = marks.get(key);
      if (g === undefined) { g = drawMark(o.kind); marks.set(key, g); }
      if (g.parent !== layer) layer.addChildAt(g, 0);
      let hd;
      try { hd = cartographyMap.getHexDisplay(map.getHex(new HexCoords(o.q, o.r))); } catch {}
      g.visible = hd !== undefined;
      if (!g.visible) continue;
      // The middle of the hex's left edge (the cairn stands on the right one), a fifth of the hex tall.
      g.scale.set((tall * 0.2) / MARK_H);
      g.x = hd.x - 2 * map.hexScale.x * 0.38;
      g.y = hd.y + tall * 0.1;
    }
  };
  ctx.patch(WorldMapDisplayElement, 'movePlayerMarker').after(() => { try { refreshMarkers(); } catch (e) { log('treasure markers failed', e); } });
  ctx.onInterfaceReady(() => { try { refreshMarkers(); } catch (e) { log('treasure markers failed', e); } });

  // ---- for the Journal -----------------------------------------------------------------------------------------------
  /** Throws a held map away: gone, its dug hexes with it. */
  const throwAway = (id) => {
    const mm = maps();
    if (mm === undefined || mapById(id) === undefined) return false;
    const m = mapById(id);
    if (mm.dig?.id === id) delete mm.dig;
    mm.held = mm.held.filter((x) => x.id !== id);
    // A guarded prize it led to goes with it: nothing else could dig there.
    mm.left = mm.left.filter((x) => !same(x, m));
    log(`treasure: ${id} thrown away`);
    changed();
    return true;
  };

  const api = {
    held, mapById, mapName, mapNameLines, itemName, factText, clueHtml, isOld, read, readWhy, giveMap, rollWreck,
    gradeOfItem: T.gradeOfItem, maxWrong: T.MAX_WRONG, art: (grade) => ctx.getResourceUrl(MAP_ART[grade] ?? MAP_ART[1]),
    digWhy, start, stop, dig, digLeft, finish, guardDone, passiveTick, panelHtml, click, digLeftHtml, refreshMarkers, throwAway,
    left: () => maps()?.left ?? [],
    counts: () => { const mm = maps(); return { read: mm?.n ?? 0, found: Number.isInteger(mm?.found) ? mm.found : 0, lost: Number.isInteger(mm?.lost) ? mm.lost : 0 }; },
    stamp: () => stamp,
    /** For voyageDev.map (src/dev.mjs). */
    force: {
      list: () => ({ ...maps(), held: held().map((m) => ({ id: m.id, grade: m.grade, dug: m.dug, clue: m.facts.map(factText) })) }),
      give: (grade = 1, n = 1) => { for (let i = 0; i < n; i++) giveMap(Math.min(3, Math.max(1, grade)), 'dev'); return `${n} × ${itemName(grade)}`; },
      answer: (id) => { const m = id === undefined ? held()[0] : mapById(id); return m === undefined ? 'no map held' : { id: m.id, q: m.q, r: m.r }; },
      done: () => { const d = dig(); if (d === undefined) return 'no dig running'; d.end = gameNow(); tick(); return 'dug'; },
      guard: (on = true) => { forceGuard = on === true; return `next grade 3 find ${forceGuard ? 'guarded' : 'unguarded'}`; },
    },
  };
  state.treasure = api;
  return api;
}
