// The Captain's Journal (phase 4): a diary of what the player has found out, opened as a full-page
// book (css/voyage.css, `.vj-*`; look signed off by the user on the design canvas, 16 Oct 2026).
//
// Records, into the Voyage skill's save (`journal`, voyage-model.mjs; operations in journal-model.mjs):
//  - finds: a zoned action (an ore, tree, fish, crop, thieving target, constellation) completed on a hex. Read in
//    GatheringSkill.action, which every gathering skill's timer calls once per completed action (skill.js, v1.3.1),
//    and Farming.plantPlot (a crop counts where it was planted: that is where its zone was checked). Only while the
//    zones apply, so every hex written is one where the action really works.
//  - misses: a zone refusal (gate.mjs calls miss()).
//  - places: combat areas entered (after CombatManager.checkAreaEntryRequirements passed) and trading places used
//    (Bank.processItemSale, Shop.buyItemOnClick). POIs come live from the map's discovered ones.
//  - guide pages: written the first time their rule matters (learn(), called by the gates, the ship and the trader).
// Found hexes count as known (visited), so the hints may point at them.
//
// Ways in: the book button on the skill minibar (Minibar.createMinibarItem, prepended to #skill-footer-minibar, which
// setSkill leaves alone: it only swaps pets and upgrades), the book in the page header left of the potion button
// (build .117), the book next to "Manage voyage" in the map panel, the "?"
// of each Voyage page block (opens its chapter), and the footer link of every lock popup (opens its guide page).

const CARTOGRAPHY_PAGE = 'melvorAoD:Cartography';
const ROOT_ID = 'voyage-journal';
/** "How it works" chapters, two to a spread. All but crafts are the Voyage page's "?" topics (voyage-page.mjs). */
/** Skills that work anywhere, named on the crafts page. */
const ANYWHERE = ['melvorD:Agility', 'melvorD:Prayer', 'melvorAoD:Cartography', 'melvorD:Astrology'];

export function install(ctx, { state, model, journalModel: jm, shipModel, rules, terrainMod, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const iconUrl = ctx.getResourceUrl('assets/journal.png');
  const start = state.zoneTable?.start;
  const TABS = jm.JOURNAL_TABS;
  let minibarEl;
  let headerEl;

  /** The live journal record, or undefined (no skill, or a save from a newer build that is kept as it is). */
  const journal = () => {
    const s = state.voyageSkill?.();
    return s !== undefined && s.futureRaw === undefined ? s.record.journal : undefined;
  };
  /** zoned action id -> skill id (data/zones.json). */
  const zoned = new Map();
  for (const [skillId, s] of Object.entries(state.zoneTable?.skills ?? {})) for (const id of Object.keys(s.actions ?? {})) zoned.set(id, skillId);
  const zoneOf = (id) => state.zoneTable?.skills?.[zoned.get(id)]?.actions?.[id];
  const actionOf = (id) => { try { return game.skills.getObjectByID(zoned.get(id))?.actions?.getObjectByID(id); } catch { return undefined; } };
  const skillOf = (id) => { try { return game.skills.getObjectByID(id); } catch { return undefined; } };

  const notify = (text, media = iconUrl) => {
    try { game.notifications.createInfoNotification('voyage:journal', text, media); } catch (e) { log('journal notice failed', e); }
  };

  // ---------------------------------------------------------------------------------------------------- recording
  const markKnown = (hexes) => { try { state.knowledge?.markMany(hexes); } catch (e) { log('journal knowledge failed', e); } };
  /** An entry, place or guide page is new or changed: it carries "New" or "Updated" until it is read (build .116). */
  const unread = (j, key, kind) => { jm.markUnread(j, key, kind, model.JOURNAL_UNREAD_MAX); badge(); };
  const guideTitle = (id) => t(`MOD_VOY_JOURNAL_GUIDE_${id.toUpperCase()}_TITLE`);

  /** Writes a guide page. `quiet`: no notice (a lock popup's footer says it instead). True when the page is new. */
  const learn = (id, quiet = false) => {
    const j = journal();
    if (j === undefined || !jm.learn(j, id, model.JOURNAL_GUIDES)) return false;
    log(`journal: guide page ${id} written`);
    unread(j, `g:${id}`, 'new');
    if (!quiet) notify(t('MOD_VOY_JOURNAL_NEW_PAGE', { title: guideTitle(id) }));
    refresh();
    return true;
  };

  const found = (action, skillId) => {
    const j = journal();
    if (j === undefined || action === undefined || action === null || !zoned.has(action.id) || !state.zonesOn?.()) return;
    const pos = state.position();
    if (pos === undefined) return;
    const res = jm.addFound(j, action.id, pos.q, pos.r, start, model.JOURNAL_LIMITS.found);
    if (res === undefined) return;
    markKnown([pos]);
    unread(j, `a:${action.id}`, res === 'new' && !j.charted.includes(action.id) ? 'new' : 'more');
    if (res === 'new') notify(t('MOD_VOY_JOURNAL_NEW_ENTRY', { name: action.name ?? action.id }), action.media);
    // Worked by grace (one hex out from its place): the grace page.
    try { if (rules.graceFrom(skillId, state.recordAt(pos), state.ruleOpts()).length > 0) learn('grace'); } catch {}
    refresh();
  };
  /** A zone refusal (gate.mjs): "no Iron Ore at (12, 15)". */
  const miss = (action, pos) => {
    const j = journal();
    if (j === undefined || action === undefined || pos === undefined || !zoned.has(action.id)) return;
    if (jm.addMiss(j, action.id, pos.q, pos.r, model.JOURNAL_LIMITS.missed)) refresh();
  };
  const place = (kind, id, hex) => {
    const j = journal();
    if (j === undefined || hex === undefined || id === undefined) return;
    if (jm.addPlace(j, kind, id, hex.q, hex.r)) { markKnown([hex]); unread(j, `p:${kind}|${id}`, 'new'); refresh(); }
  };

  /** What a running gathering skill is doing (several trees at once for Woodcutting). */
  const running = (skill) => {
    try {
      switch (skill.id) {
        case 'melvorD:Mining': return [skill.selectedRock];
        case 'melvorD:Woodcutting': return [...(skill.activeTrees ?? [])];
        case 'melvorD:Fishing': return [skill.activeFish];
        case 'melvorD:Thieving': return [skill.currentNPC];
        case 'melvorD:Astrology': return [skill.studiedConstellation];
        default: return [];
      }
    } catch { return []; }
  };
  /** The Voyage skill's level, 1 without the skill. */
  const voyageLevel = () => { try { return state.voyageSkill?.()?.level ?? 1; } catch { return 1; } };
  const chartItem = (skillId) => { try { return game.items.getObjectByID(`voyage:${jm.CHART_ITEMS[skillId]}`); } catch { return undefined; } };
  /**
   * The reveal item roll (Charting a country): one completed zoned action of its skill while zones are
   * on, 1 in 2,000 rising with Voyage level to 1 in 1,000 at 99.
   */
  const rollChart = (action, skillId) => {
    if (journal() === undefined || action === undefined || action === null || !zoned.has(action.id) || !state.zonesOn?.()) return;
    if (Math.random() >= jm.chartChance(voyageLevel())) return;
    const item = chartItem(skillId);
    if (item === undefined) return;
    game.bank.addItem(item, 1, false, true, true, true, 'Voyage');
    log(`journal: ${item.id} dropped on ${action.id}`);
    notify(t('MOD_VOY_JOURNAL_CHART_DROP', { name: item.name }), item.media);
    refresh();
  };
  try {
    ctx.patch(GatheringSkill, 'action').replace(function (original, ...args) {
      let doing = [];
      try { if (zoned.size > 0 && state.zoneTable?.skills?.[this.id] !== undefined) doing = running(this); } catch {}
      const result = original(...args);
      for (const a of doing) {
        try { found(a, this.id); } catch (e) { log('journal find failed', e); }
        try { rollChart(a, this.id); } catch (e) { log('journal chart roll failed', e); }
      }
      return result;
    });
  } catch (e) { console.error('[Voyage] journal: finds are not recorded', e); }
  try {
    ctx.patch(Farming, 'plantPlot').after(function (interval, plot, recipe) {
      try { if (typeof interval === 'number' && interval > 0) found(recipe, this.id); } catch (e) { log('journal crop failed', e); }
    });
    // A crop rolls for its almanac when it is harvested: the plot is empty afterwards (a full bank leaves it planted).
    ctx.patch(Farming, 'harvestPlot').replace(function (original, plot, ...rest) {
      const recipe = plot?.plantedRecipe;
      const result = original(plot, ...rest);
      try { if (recipe !== undefined && plot.plantedRecipe !== recipe) rollChart(recipe, this.id); } catch (e) { log('journal almanac roll failed', e); }
      return result;
    });
  } catch (e) { log('journal: crops are not recorded', e); }
  // Free charts at Voyage 30, 50, 70 and 90: a notice when one is reached (the count itself is worked out from the level).
  try {
    ctx.patch(Skill, 'onLevelUp').after(function (ret, oldLevel, newLevel) {
      try {
        if (this.id !== model.SKILL_ID || journal() === undefined) return;
        const reached = model.FREE_CHART_LEVELS.filter((l) => oldLevel < l && newLevel >= l);
        if (reached.length === 0) return;
        notify(t('MOD_VOY_JOURNAL_CHART_FREE', { level: `${reached[reached.length - 1]}` }));
        badge();
        refresh();
      } catch (e) { log('journal free chart notice failed', e); }
    });
  } catch (e) { log('journal: free chart notices are off', e); }

  // Places. Combat: the area entered, at its own hex nearest to the player.
  ctx.patch(CombatManager, 'checkAreaEntryRequirements').after(function (ok, area) {
    try {
      if (ok !== true || !state.active() || typeof area?.id !== 'string') return;
      const places = state.terrain?.placesFor(area.id) ?? [];
      const near = terrainMod.nearestIn(places, state.position());
      if (near !== undefined) place('combat', area.id, near.hex);
    } catch (e) { log('journal combat place failed', e); }
  });
  /**
   * The trading place a sale or purchase went through: this hex, or the neighbour that is one (the grace hex, rules
   * tradeAllowedAt). Only a place the player knows is noted (build .173, the user): a trade on the Monolith went through
   * Whispering Port next door, undiscovered, and was listed as "Water". A market with no POI is always known.
   */
  const tradeKnown = (h) => { const poi = liveHex(h.q, h.r)?.pointOfInterest; return poi === undefined || poi.isDiscovered === true; };
  const tradePlace = () => {
    if (!state.active() || state.tradeLocked?.() || state.trader?.present?.()) return undefined;
    const rec = state.recordAt(state.position());
    if (rec === undefined) return undefined;
    const h = rules.isTradePlace(rec) ? rec : state.terrain.neighbours(rec.q, rec.r).filter((n) => rules.isTradePlace(n)).find(tradeKnown);
    return h !== undefined && tradeKnown(h) ? h : undefined;
  };
  const onTrade = () => { try { const h = tradePlace(); if (h !== undefined) place('trade', jm.hexStr(h.q, h.r), h); } catch (e) { log('journal trade place failed', e); } };
  ctx.patch(Bank, 'processItemSale').after(onTrade);
  ctx.patch(Shop, 'buyItemOnClick').after(onTrade);

  // Found hexes are known (4.15), from the first load on.
  ctx.onCharacterLoaded(() => {
    try {
      const j = journal();
      if (j === undefined) return;
      const hexes = [];
      for (const list of Object.values(j.found)) for (const h of list) { const p = jm.parseHex(h); if (p !== undefined) hexes.push(p); }
      for (const h of Object.values(j.places)) { const p = jm.parseHex(h); if (p !== undefined) hexes.push(p); }
      // Charted countries are known too, as the zone draws them now.
      for (const id of j.charted) for (const rec of state.zoneCandidates?.(id) ?? []) hexes.push({ q: rec.q, r: rec.r });
      markKnown(hexes);
      badge();
      // The compass came with the welcome: a character that has it knows its page.
      if (state.compass?.owned?.()) jm.learn(j, 'compass', model.JOURNAL_GUIDES);
    } catch (e) { log('journal load failed', e); }
  });

  // ---------------------------------------------------------------------------------------------------- words
  const live = () => game.cartography?.activeMap;
  const liveHex = (q, r) => { try { return live()?.getHex(new HexCoords(q, r)); } catch { return undefined; } };
  /** The game's display coordinates (the ones its map shows), else axial. */
  const at = (q, r) => { try { const o = liveHex(q, r)?.to_oddq(); if (o !== undefined) return `(${o.col}, ${o.row})`; } catch {} return `(${q}, ${r})`; };
  const land = (q, r) => {
    const rec = state.terrain?.get(q, r);
    if (rec === undefined) return '';
    return rec.cloud === true ? t(terrainMod.CLOUD_KEY) : t(terrainMod.classKey(rec.t));
  };
  const fromHere = (h) => {
    const p = state.position();
    if (p === undefined) return '';
    const d = terrainMod.hexDistance(p, h);
    if (d === 0) return t('MOD_VOY_JOURNAL_HERE');
    return `${t(d === 1 ? 'MOD_VOY_HEXES_ONE' : 'MOD_VOY_HEXES_MANY', { count: `${d}` })} ${t(`MOD_VOY_DIR_SHORT_${terrainMod.directionLabel(p, h)}`)}`;
  };
  const poiAt = (q, r) => { const poi = liveHex(q, r)?.pointOfInterest; return poi !== undefined && poi.isDiscovered ? poi : undefined; };
  const areaById = (id) => {
    for (const list of ['combatAreas', 'slayerAreas', 'dungeons', 'strongholds', 'abyssDepths']) {
      try { const a = game[list]?.getObjectByID(id); if (a !== undefined) return a; } catch {}
    }
    return undefined;
  };
  const termLabel = (kind, x) => (kind === 'class' ? t(terrainMod.classKey(x)) : kind === 'feature' ? t(terrainMod.featureKey(x)) : terrainMod.areaLabel(x));
  const rate = (r) => `${Math.round(r * 100)}%`;

  // ---------------------------------------------------------------------------------------------------- the book
  const view = { open: false, tab: 'how', spread: 0, crewSpread: 0, entry: undefined, place: undefined, guide: undefined, query: '', placeQuery: '', back: null, pick: undefined };
  let root;

  const ledger = (cols, rows) => `<table class="vj-ledger"><thead><tr>${cols.map((c, i) => `<th class="${i > 0 && rows.numeric?.[i] ? 'vj-num' : ''}">${esc(c)}</th>`).join('')}</tr></thead>`
    + `<tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i === 0 ? 'vj-first' : ''} ${c.cls ?? ''}"${c.plain ? ' data-no-skill-names' : ''}>${c.html ?? esc(c.text ?? c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  /**
   * Book text with its crosslinks (journal-model.mjs splitLinks) as buttons. A link whose target isn't in the book
   * (an Adventure-only chapter, a guide page not written yet) stays plain text.
   */
  const linkLive = (kind, id) => {
    if (kind === 'ch') return chapters().includes(id);
    if (kind === 'guide') return (journal()?.guides ?? []).includes(id);
    return kind === 'tab' && TABS.includes(id) && (id === 'how' || journal() !== undefined) && (id !== 'crew' || crewOn());
  };
  const rich = (text) => jm.splitLinks(text).map((p) => (p.kind !== undefined && linkLive(p.kind, p.id)
    ? `<button type="button" class="vj-link" data-vj-go="${p.kind}:${p.id}">${esc(p.text)}</button>` : esc(p.text))).join('');
  const runningHead = (left, right) => `<div class="vj-running"><span>${esc(left)}</span><span>${esc(right)}</span></div>`;
  const note = (text) => `<div class="vj-note"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z"></path><path d="M14 7l3 3"></path></svg><span>${rich(text)}</span></div>`;
  const dropCap = (text) => { const s = String(text); return `<p class="vj-p vj-lead"><span class="vj-dropcap">${esc(s.slice(0, 1))}</span>${rich(s.slice(1))}</p>`; };
  const mapButton = (kind, id) => `<button type="button" class="vj-btn" data-vj-map="${esc(kind)}" data-vj-id="${esc(id)}">`
    + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"></path><circle cx="12" cy="12" r="2.5"></circle></svg>'
    + `${esc(t('MOD_VOY_JOURNAL_SHOW_ON_MAP'))}</button>`;
  // Plan a voyage (build .119): the planner on the Voyage page, heading for this entry or place.
  const planButton = (kind, id) => state.planner?.open?.() !== true ? '' : `<button type="button" class="vj-btn" data-vj-plan="${esc(kind)}" data-vj-id="${esc(id)}">`
    + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17h18l-2 4H5z"></path><path d="M12 3v12"></path><path d="M12 4l6 9h-6"></path></svg>'
    + `${esc(t('MOD_VOY_PLAN_BUTTON'))}</button>`;
  const empty = (key) => `<p class="vj-p vj-faint">${esc(t(key))}</p>`;

  /** The Voyage page's help sections, in book form (help-layout.mjs shape: { head?, warn?, body: [...] }). */
  const bookSections = (sections) => sections.map((s) => {
    const body = s.body.map((it) => {
      if (typeof it === 'string') return `<p class="vj-p">${esc(it)}</p>`;
      if (it.table !== undefined) {
        const rows = it.table.rows.map((r) => r.cells.map((c, i) => (i === 0 ? { text: c } : { text: c, cls: `vj-num ${r.cls?.[i - 1] ?? ''}` })));
        rows.numeric = it.table.cols.map((_, i) => i > 0);
        return ledger(it.table.cols, rows);
      }
      if (it.html !== undefined) return `<p class="vj-p ${it.cls ?? ''}">${it.html}</p>`;
      return `<p class="vj-p ${it.cls ?? ''}">${esc(it.text)}</p>`;
    }).join('');
    return `<div class="vj-section${s.warn ? ' vj-warn' : ''}">${s.head ? `<h3 class="vj-h3">${esc(s.head)}</h3>` : ''}${body}</div>`;
  }).join('');

  /** A skill's name with its icon; "Alt. Magic" by its page label (the name pass would split it). */
  const skillChip = (id, skill) => {
    const label = rules.ruleLabelKey(id) !== undefined ? t(rules.ruleLabelKey(id)) : skill.name;
    return `<span class="voyage-skill-name"><img class="voyage-skill-name-icon" src="${skill.media}" alt=""><b>${esc(label)}</b></span>`;
  };
  /** The rules with a loaded skill: [id, rule, skill]. */
  const loadedRules = () => Object.entries(rules.SKILL_RULES).map(([id, rule]) => [id, rule, skillOf(id)]).filter(([, , s]) => s !== undefined);
  const dryLandLine = () => {
    const dry = loadedRules().filter(([, rule]) => rule.tier === 'land').map(([, , s]) => s.name);
    return dry.length > 0 ? `<p class="vj-p">${esc(t('MOD_VOY_JOURNAL_LANDS_DRY', { skills: dry.join(', ') }))}</p>` : '';
  };
  /** Lands: every kind of land (terrain.mjs CLASSES) with its map colour and the crafts its own ground allows. */
  const landsTable = () => {
    const rows = terrainMod.CLASSES.map((cls) => {
      const works = [];
      for (const [id, rule, skill] of loadedRules()) {
        if (rule.tier === 'land') continue;
        const r = rule.classes?.[cls];
        let bit = '';
        if (r !== undefined) bit = `${skillChip(id, skill)}${r < 1 ? ` ${rate(r)}` : ''}${rule.ship?.includes(cls) ? `, ${esc(t('MOD_VOY_JOURNAL_LANDS_BY_BOAT'))}` : ''}`;
        for (const [c, f, cr] of rule.combos ?? []) {
          if (c !== cls) continue;
          bit += `${bit === '' ? skillChip(id, skill) : ';'} ${esc(t('MOD_VOY_JOURNAL_LANDS_WITH', { feature: termLabel('feature', f) }))}${cr < 1 ? ` ${rate(cr)}` : ''}`;
        }
        if (bit !== '') works.push(bit);
      }
      const css = terrainMod.CLASS_INFO[cls]?.css ?? 'transparent';
      return [{ html: `<span class="vj-swatch" style="background:${css}" aria-hidden="true"></span>${esc(t(terrainMod.classKey(cls)))}`, plain: true },
        { html: works.length > 0 ? works.join(', ') : esc(t('MOD_VOY_JOURNAL_LANDS_NOTHING')) }];
    });
    return ledger([t('MOD_VOY_JOURNAL_COL_LAND'), t('MOD_VOY_JOURNAL_COL_CRAFTS_HERE')], rows) + dryLandLine();
  };
  /** Features and named places a rule looks for, in terrain.mjs FEATURES order, with the crafts each one allows. */
  const featuresTable = () => {
    const by = new Map();
    const add = (key, label, id, skill, r) => {
      if (!by.has(key)) by.set(key, { label, bits: [] });
      by.get(key).bits.push(`${skillChip(id, skill)}${r < 1 ? ` ${rate(r)}` : ''}`);
    };
    for (const f of terrainMod.FEATURES) {
      for (const [id, rule, skill] of loadedRules()) if (rule.features?.[f] !== undefined) add(`f:${f}`, termLabel('feature', f), id, skill, rule.features[f]);
    }
    for (const [id, rule, skill] of loadedRules()) {
      if (rule.flags?.coast !== undefined) add('coast', t('MOD_VOY_JOURNAL_LANDS_COAST'), id, skill, rule.flags.coast);
      for (const [p, r] of Object.entries({ ...rule.pois, ...rule.areas })) add(`p:${p}`, termLabel('place', p), id, skill, r);
    }
    const rows = [...by.values()].map((x) => [{ text: x.label, plain: true }, { html: x.bits.join(', ') }]);
    return ledger([t('MOD_VOY_JOURNAL_COL_FEATURE'), t('MOD_VOY_JOURNAL_COL_CRAFTS_HERE')], rows)
      + (state.settings.strictness() === 'relaxed' ? `<p class="vj-p text-info">${esc(t('MOD_VOY_JOURNAL_CRAFTS_RELAXED'))}</p>` : '');
  };

  /** Where each craft works, from the rule table (rules.mjs SKILL_RULES). */
  const craftsTable = () => {
    const rows = [];
    for (const [id, rule] of Object.entries(rules.SKILL_RULES)) {
      const skill = skillOf(id);
      if (skill === undefined) continue; // an expansion or Worker Folks not loaded
      const full = [];
      const slow = [];
      const put = (r, label) => (r >= 1 ? full : slow).push(r >= 1 ? label : `${label} ${rate(r)}`);
      if (rule.tier === 'land') full.push(t(rules.ruleNounKey(id)));
      for (const [c, r] of Object.entries(rule.classes ?? {})) if (!rule.ship?.includes(c)) put(r, termLabel('class', c));
      for (const [f, r] of Object.entries(rule.features ?? {})) put(r, termLabel('feature', f));
      for (const [p, r] of Object.entries({ ...rule.pois, ...rule.areas })) put(r, termLabel('place', p));
      for (const [c, f, r] of rule.combos ?? []) put(r, t('MOD_VOY_JOURNAL_COMBO', { a: termLabel('class', c), b: termLabel('feature', f) }));
      if (rule.flags?.coast !== undefined) put(rule.flags.coast, t('MOD_VOY_ZONE_COAST'));
      if (rule.ship !== undefined) full.push(t('MOD_VOY_JOURNAL_FROM_BOAT'));
      if (rule.grace !== undefined) full.push(t('MOD_VOY_JOURNAL_ONE_OUT'));
      // The skill cell carries its own chip (the name pass would split "Alt. Magic"); the terrain cells are left out
      // of the pass, since "Magic" there is the place, not the skill.
      rows.push([{ html: skillChip(id, skill) }, { text: full.join(', '), plain: true }, { text: slow.length > 0 ? slow.join(', ') : t('MOD_VOY_HELP_NONE'), plain: true }]);
    }
    const anywhere = ANYWHERE.map(skillOf).filter((s) => s !== undefined).map((s) => s.name);
    return ledger([t('MOD_VOY_JOURNAL_COL_CRAFT'), t('MOD_VOY_JOURNAL_COL_WORKS'), t('MOD_VOY_JOURNAL_COL_SLOWER')], rows)
      + `<p class="vj-p">${esc(t('MOD_VOY_JOURNAL_CRAFTS_ANYWHERE', { skills: anywhere.join(', ') }))}</p>`
      + (state.settings.strictness() === 'relaxed' ? `<p class="vj-p text-info">${esc(t('MOD_VOY_JOURNAL_CRAFTS_RELAXED'))}</p>` : '');
  };

  /** Adventure's chapter only where skills are bought; the "?" chapters only with the Voyage page loaded. */
  const adventure = () => { try { return game.currentGamemode?.allowSkillUnlock === true; } catch { return false; } };
  const chapters = () => jm.JOURNAL_CHAPTERS.filter((c) => (c === 'adventure' ? adventure() : c === 'planning' ? state.planner !== undefined
    : c === 'crafts' || jm.JOURNAL_WRITTEN[c] !== undefined || typeof state.helpSections === 'function'));

  /** A book-only chapter (journal-model.mjs JOURNAL_WRITTEN): its sections from en.json, plus the live parts. */
  const writtenBody = (id) => {
    const spec = jm.JOURNAL_WRITTEN[id];
    const key = id.toUpperCase();
    const nav = state.planner?.NAV;
    const vars = { key: state.settings.centreKey?.() || '', journal: state.settings.journalKey?.() || '',
      level: `${nav?.level ?? ''}`, planLevel: `${state.planner?.PLAN_LEVEL ?? ''}`, gp: nav === undefined ? '' : numberWithCommas(nav.gp), pitch: `${nav?.items?.[0]?.quantity ?? ''}`,
      signLevel: `${state.landModel?.SIGN.level ?? 35}`, map: state.settings.mapKey?.() || '' };
    const line = (k) => t(k, vars).split('\n').filter((x) => x.trim() !== '');
    let html = id === 'lighthouse' ? lighthouse() : '';
    for (const sec of spec.sections) {
      // The map's key line follows the setting: a cleared key turns the shortcut off.
      // So does the foreword's journal key line (build .118).
      const bodyKey = id === 'map' && sec === 'KEYS' && vars.key === '' ? `MOD_VOY_JOURNAL_CH_MAP_KEYS_BODY_OFF`
        : id === 'foreword' && sec === 'BOOK' && vars.journal === '' ? `MOD_VOY_JOURNAL_CH_FOREWORD_BOOK_BODY_OFF` : `MOD_VOY_JOURNAL_CH_${key}_${sec}_BODY`;
      const lines = line(bodyKey);
      // The map key (build .171) opens the map from any page: one more line while it is set.
      if (id === 'map' && sec === 'KEYS' && vars.map !== '') lines.unshift(t('MOD_VOY_JOURNAL_CH_MAP_KEYS_OPEN', vars));
      const body = spec.points ? `<ul class="vj-points">${lines.map((l) => `<li>${rich(l)}</li>`).join('')}</ul>` : lines.map((l) => `<p class="vj-p">${rich(l)}</p>`).join('');
      html += `<div class="vj-section${spec.warn?.includes(sec) ? ' vj-warn' : ''}"><h3 class="vj-h3">${esc(t(`MOD_VOY_JOURNAL_CH_${key}_${sec}_HEAD`))}</h3>${body}</div>`;
      if (id === 'foreword' && sec === 'WHO') html += galleon();
      if (id === 'settings' && sec === 'EASIER') html += settingsTable();
      if (id === 'settings' && sec === 'KEYS') html += keysTable();
      if (id === 'lands' && sec === 'KINDS') html += landsTable();
      if (id === 'lands' && sec === 'FEATURES') html += featuresTable();
      if (id === 'road' && sec === 'MOUNTS') html += mountsTable();
      if (id === 'road' && sec === 'SIGN') html += signLedger();
      if (id === 'crew_hire' && sec === 'START') html += crewAboard();
      if (id === 'crew_ranks' && sec === 'TIERS') html += crewTiers();
      if (id === 'crew_ranks' && sec === 'LICENCES') html += crewLicences();
      if (id === 'adventure' && sec === 'FIRST') { try { const band = state.compass?.firstSteps?.(0); if (band !== undefined) html += bookSections([{ ...band, head: undefined }]); } catch (e) { log('journal first steps failed', e); } }
    }
    if (id === 'crew_tips') html += crewTheirTips();
    return html;
  };

  // The road chapter (build .170): live from the shop and the sign's record.
  const shopPurchase = (id) => { try { return game.shop.purchases.getObjectByID(`voyage:${id}`); } catch { return undefined; } };
  const owns = (p) => { try { return p !== undefined && game.shop.getPurchaseCount(p) > 0; } catch { return false; } };
  /** A purchase's price as the shop has it: each currency and item as its icon, the count, then its name. */
  const priceHtml = (p) => {
    const bits = [];
    try {
      for (const c of p.costs.currencies ?? []) {
        const n = typeof c.cost === 'number' ? c.cost : 0;
        bits.push(`<span class="vj-cost"><img src="${c.currency.media}" alt="">${esc(numberWithCommas(n))} ${esc(c.currency.name)}</span>`);
      }
      for (const { item, quantity } of p.costs.items ?? []) bits.push(`<span class="vj-cost"><img src="${item.media}" alt="">${esc(numberWithCommas(quantity))} ${esc(item.name)}</span>`);
    } catch (e) { log('journal price failed', e); }
    return bits.join('');
  };
  const mountsTable = () => {
    const M = state.landModel;
    if (M === undefined) return '';
    const rows = M.MOUNTS.map((m) => {
      const p = shopPurchase(m.id);
      const mine = owns(p);
      // "Yours" under the name, not a column of its own: the page is narrow (build .172).
      return [{ html: `<span class="vj-mount">${p?.media ? `<img src="${p.media}" alt="">` : ''}<span><b>${esc(p?.name ?? m.id)}</b>${mine ? `<span class="vj-yes">${esc(t('MOD_VOY_JOURNAL_ROAD_YOURS'))}</span>` : ''}</span></span>` },
        { text: `${m.level}`, cls: 'vj-num' }, { text: `${Math.round(m.cut * 100)}%`, cls: 'vj-num' },
        { html: p === undefined ? '' : `<span class="vj-costs">${priceHtml(p)}</span>` }];
    });
    rows.numeric = [false, true, true, false];
    return ledger([t('MOD_VOY_JOURNAL_ROAD_COL_MOUNT'), t('MOD_VOY_JOURNAL_ROAD_COL_LEVEL'), t('MOD_VOY_JOURNAL_ROAD_COL_CUT'), t('MOD_VOY_JOURNAL_ROAD_COL_PRICE')], rows);
  };
  // The shipwright's bill (build .178, the hull chapter): every hull's price live from ship-model.mjs, laid out like
  // the mounts ledger: hull icon, name, Yours (or what it was rebuilt as), where and how it is had, reach and crates.
  const shipBill = () => {
    if (shipModel?.shipBill === undefined) return '';
    const boat = state.ship?.boat?.()?.hull;
    const big = state.ship?.big?.()?.hull;
    const item = (id) => { try { return game.items.getObjectByID(id); } catch { return undefined; } };
    const cost = (media, n, name) => `<span class="vj-cost">${media ? `<img src="${media}" alt="">` : ''}${esc(numberWithCommas(n))} ${esc(name)}</span>`;
    const rows = shipModel.shipBill().map((b) => {
      const key = b.id.toUpperCase();
      const mine = b.id === boat || b.id === big;
      const rebuiltAs = b.id === 'dinghy' && boat === 'longboat' ? 'LONGBOAT' : b.id === 'brig' && big === 'galleon' ? 'GALLEON' : undefined;
      const mark = mine ? `<span class="vj-yes">${esc(t('MOD_VOY_JOURNAL_ROAD_YOURS'))}</span>`
        : rebuiltAs !== undefined ? `<span class="vj-bill-line vj-bill-rebuilt">${esc(t(`MOD_VOY_JOURNAL_BILL_REBUILT_${rebuiltAs}`))}</span>` : '';
      const reach = Number.isFinite(b.reach) ? t('MOD_VOY_JOURNAL_BILL_REACH', { reach: `${b.reach}`, hold: `${b.hold}` }) : t('MOD_VOY_JOURNAL_BILL_ANY_SEA', { hold: `${b.hold}` });
      const name = `<span class="vj-hull"><img src="${ctx.getResourceUrl(shipModel.HULLS[b.id].media)}" alt=""><span><b>${esc(t(shipModel.hullNameKey(b.id)))}</b>${mark}`
        + `<span class="vj-bill-line">${esc(t(`MOD_VOY_JOURNAL_BILL_WHERE_${key}`))}</span><span class="vj-bill-line">${esc(reach)}</span></span></span>`;
      const price = [cost(game.gp.media, b.gp, game.gp.name)];
      for (const { id, quantity } of b.items) { const it = item(id); if (it !== undefined) price.push(cost(it.media, quantity, it.name)); }
      return [{ html: name }, { text: b.level > 0 ? `${b.level}` : '—', cls: 'vj-num' }, { html: `<span class="vj-costs">${price.join('')}</span>` }];
    });
    rows.numeric = [false, true, false];
    return `<div class="vj-section vj-bill"><h3 class="vj-h3">${esc(t('MOD_VOY_JOURNAL_BILL_HEAD'))}</h3><p class="vj-p">${esc(t('MOD_VOY_JOURNAL_BILL_BODY'))}</p>`
      + ledger([t('MOD_VOY_JOURNAL_BILL_COL_VESSEL'), t('MOD_VOY_JOURNAL_ROAD_COL_LEVEL'), t('MOD_VOY_JOURNAL_ROAD_COL_PRICE')], rows)
      + note(t('MOD_VOY_JOURNAL_BILL_BONES')) + '</div>';
  };
  const atHex = (hex) => { try { const o = hex.to_oddq(); return `(${o.col}, ${o.row})`; } catch { return `(${hex.q}, ${hex.r})`; } };
  /** Where the sign is now, and the places with buffs found so far (their buffs as the game writes them). */
  const signLedger = () => {
    const L = state.land;
    if (L === undefined) return '';
    const signP = shopPurchase(state.landModel?.SIGN.id ?? 'Crossroads_Sign');
    const level = `${state.landModel?.SIGN.level ?? 35}`;
    const here = L.signPoi();
    const now = !L.signOwned() ? t('MOD_VOY_JOURNAL_ROAD_SIGN_SHOP', { level })
      : here === undefined ? t('MOD_VOY_JOURNAL_ROAD_SIGN_CARRIED') : t('MOD_VOY_JOURNAL_ROAD_SIGN_AT', { place: `${here.name} ${atHex(here.hex)}` });
    let html = `<p class="vj-p"><b>${esc(now)}</b></p>`;
    if (!L.signOwned() && signP !== undefined) html += `<p class="vj-p vj-costs"><span>${esc(t('MOD_VOY_JOURNAL_ROAD_COL_PRICE'))}:</span>${priceHtml(signP)}</p>`;
    const found = [];
    let hidden = 0;
    try {
      for (const map of game.cartography.worldMaps.allObjects) {
        for (const poi of map.pointsOfInterest.allObjects) {
          if (poi.activeStats?.hasStats !== true) continue;
          if (poi.isDiscovered !== true) { hidden++; continue; }
          let buffs = [];
          try { buffs = poi.activeStats.describeAsSpans(1, game.cartography.hasCarthuluPet ? 2 : 1); } catch {}
          found.push({ poi, buffs });
        }
      }
    } catch (e) { log('journal sign places failed', e); }
    if (found.length > 0) {
      const rows = found.map(({ poi, buffs }) => [
        { html: `<b>${esc(poi.name)}</b> ${esc(atHex(poi.hex))}${here === poi ? ` <span class="vj-yes">${esc(t('MOD_VOY_JOURNAL_ROAD_SIGN_HERE'))}</span>` : ''}` },
        { html: `<span class="vj-buffs">${buffs.map((b) => `<span class="${esc(b.className || 'text-success')}">${esc(b.textContent)}</span>`).join('')}</span>` }]);
      html += `<h3 class="vj-h3">${esc(t('MOD_VOY_JOURNAL_ROAD_PLACES'))}</h3>` + ledger([t('MOD_VOY_JOURNAL_ROAD_COL_PLACE'), t('MOD_VOY_JOURNAL_ROAD_COL_BUFFS')], rows);
    }
    if (hidden > 0) html += `<p class="vj-p">${esc(t(found.length > 0 ? 'MOD_VOY_JOURNAL_ROAD_MORE' : 'MOD_VOY_JOURNAL_ROAD_NONE', { n: `${hidden}` }))}</p>`;
    return html;
  };

  // The lore's last page: the lighthouse, drawn in ink.
  const lighthouseUrl = ctx.getResourceUrl('assets/lighthouse.png');
  const lighthouse = () => `<figure class="vj-figure"><img src="${lighthouseUrl}" alt="${esc(t('MOD_VOY_JOURNAL_LIGHTHOUSE_ALT'))}"></figure>`;
  // The first page: his galleon, Patient Grace, in pencil (the user, build .123).
  const galleonUrl = ctx.getResourceUrl('assets/galleon.png');
  const galleon = () => `<figure class="vj-figure vj-galleon"><img src="${galleonUrl}" alt="${esc(t('MOD_VOY_JOURNAL_GALLEON_ALT'))}"><figcaption>${esc(t('MOD_VOY_JOURNAL_GALLEON_CAPTION'))}</figcaption></figure>`;

  // The Old Man's Crew (build .116): Worker Folks: Hiring, read live where it can be (never written to).
  const crewSkill = () => skillOf(jm.CREW_SKILL_ID);
  /** The tab shows only while Worker Folks is loaded (it may load after Voyage: asked each time). */
  const crewOn = () => crewSkill() !== undefined;
  const has = (key) => { try { return typeof loadedLangJson !== 'undefined' && typeof loadedLangJson[key] === 'string'; } catch { return false; } };
  const roleName = (tier) => { try { const n = crewSkill()?.roleName?.(tier); if (typeof n === 'string' && n !== '') return n; } catch {} return has(`MOD_WF_ROLE_${tier}`) ? getLangString(`MOD_WF_ROLE_${tier}`) : tier; };
  const gp = (n) => jm.shortGp(n);
  /** "Aboard now": the hands signed, from the Hiring skill's crew (read only). Nothing when there are none. */
  const crewAboard = () => {
    let folks = [];
    try { folks = crewSkill()?.crew?.all ?? []; } catch {}
    if (!Array.isArray(folks) || folks.length === 0) return '';
    const hiring = crewSkill();
    const rows = folks.map((f) => {
      let status = '';
      try { const k = hiring.statusOf(f); status = has(`MOD_WF_STATUS_${k}`) ? getLangString(`MOD_WF_STATUS_${k}`) : k; } catch {}
      return [{ text: f.name ?? '?' }, roleName(f.tier), f.skillId ? (skillOf(f.skillId)?.name ?? '') : t('MOD_VOY_JOURNAL_CREW_IDLE'), status];
    });
    return `<h3 class="vj-h3">${esc(t('MOD_VOY_JOURNAL_CREW_ABOARD'))}</h3>`
      + ledger([t('MOD_VOY_JOURNAL_CREW_COL_NAME'), t('MOD_VOY_JOURNAL_CREW_COL_RANK'), t('MOD_VOY_JOURNAL_CREW_COL_AT'), t('MOD_VOY_JOURNAL_CREW_COL_STATUS')], rows);
  };
  const crewTiers = () => {
    const rows = jm.CREW_TIERS.map((x) => [{ text: roleName(x.tier) }, { text: `${x.rate}`, cls: 'vj-num' }, { text: gp(x.wage), cls: 'vj-num' }, { text: gp(x.hire), cls: 'vj-num' }]);
    rows.numeric = [false, true, true, true];
    return ledger([t('MOD_VOY_JOURNAL_CREW_COL_RANK'), t('MOD_VOY_JOURNAL_CREW_COL_RATE'), t('MOD_VOY_JOURNAL_CREW_COL_WAGE'), t('MOD_VOY_JOURNAL_CREW_COL_HIRE')], rows);
  };
  const crewLicences = () => {
    const dungeon = (id) => { try { return game.dungeons.getObjectByID(id)?.name; } catch { return undefined; } };
    const rows = jm.CREW_LICENCES.map((x) => [{ text: roleName(x.tier) }, { text: x.level > 0 ? `${x.level}` : '—', cls: 'vj-num' }, { text: gp(x.gp), cls: 'vj-num' }, dungeon(x.dungeon) ?? '—']);
    rows.numeric = [false, true, true, false];
    return ledger([t('MOD_VOY_JOURNAL_CREW_COL_LICENCE'), t('MOD_VOY_JOURNAL_CREW_COL_LEVEL'), t('MOD_VOY_JOURNAL_CREW_COL_GP'), t('MOD_VOY_JOURNAL_CREW_COL_DUNGEON')], rows);
  };
  /** Worker Folks' own tips, as its author keeps them (its language keys). */
  const crewTheirTips = () => {
    const tips = [];
    for (let n = 1; n <= jm.CREW_TIPS; n++) if (has(`MOD_WF_TIP_${n}`)) tips.push({ head: has(`MOD_WF_TIP_${n}_HEAD`) ? getLangString(`MOD_WF_TIP_${n}_HEAD`) : '', body: getLangString(`MOD_WF_TIP_${n}`) });
    if (tips.length === 0) return '';
    return `<div class="vj-section"><h3 class="vj-h3">${esc(t('MOD_VOY_JOURNAL_CREW_THEIRS'))}</h3><ul class="vj-points">`
      + tips.map((x) => `<li>${x.head ? `<b>${esc(x.head)}.</b> ` : ''}${esc(x.body)}</li>`).join('') + '</ul></div>';
  };
  /** The settings as they are now (Mod Settings, section Voyage). */
  /** The keyboard shortcuts as set now (build .171, the user's ask): key, what it does; a cleared one says off. */
  const keysTable = () => {
    const s = state.settings;
    const row = (k, what) => [{ text: k || t('MOD_VOY_JOURNAL_OFF'), cls: k ? 'vj-key' : 'text-muted' }, { text: t(what), plain: true }];
    return ledger([t('MOD_VOY_JOURNAL_KEYS_COL_KEY'), t('MOD_VOY_JOURNAL_KEYS_COL_DOES')], [
      row(s.mapKey?.(), 'MOD_VOY_JOURNAL_KEYS_MAP'),
      row(s.centreKey?.(), 'MOD_VOY_JOURNAL_KEYS_CENTRE'),
      row(s.journalKey?.(), 'MOD_VOY_JOURNAL_KEYS_JOURNAL'),
    ]);
  };
  const settingsTable = () => {
    const s = state.settings;
    const onOff = (on) => ({ text: t(on ? 'MOD_VOY_JOURNAL_ON' : 'MOD_VOY_JOURNAL_OFF'), cls: `vj-num ${on ? 'text-success' : 'text-muted'}` });
    const rows = [
      [t('MOD_VOY_SETTING_RULES'), onOff(s.rules())],
      [t('MOD_VOY_SETTING_STRICTNESS'), { text: t(s.strictness() === 'relaxed' ? 'MOD_VOY_SETTING_STRICTNESS_RELAXED' : 'MOD_VOY_SETTING_STRICTNESS_STRICT'), cls: 'vj-num' }],
      [t('MOD_VOY_SETTING_ZONES'), onOff(s.zones())],
      [t('MOD_VOY_SETTING_COMBAT'), onOff(s.combat())],
      [t('MOD_VOY_SETTING_TRADE'), onOff(s.trade())],
      [t('MOD_VOY_SETTING_PROVISIONS'), onOff(s.provisions())],
      [t('MOD_VOY_SETTING_NIGHT'), onOff(s.night())],
    ].map(([a, b]) => [{ text: a, plain: true }, b]);
    rows.numeric = [false, true];
    return ledger([t('MOD_VOY_JOURNAL_COL_SETTING'), t('MOD_VOY_JOURNAL_COL_NOW')], rows);
  };
  /**
   * One chapter page; its foot holds the folio and, when there is one, the page turn (back on the left, on at the right).
   * The text scrolls in its own box and the foot stays put at the bottom of the page (the user, 16 Oct 2026: the turn
   * links moved with the length of the page).
   */
  /**
   * Slips the note in between two paragraphs or sections (build .138, the user's ask), not at the foot: the place is
   * picked from the chapter id, so it stays put between visits but differs from page to page. Between two sections
   * first; inside a section (between two plain paragraphs) only on a page of one section, since the short lines of a
   * section often read as one list. Never beside the Did you know? slip or between a section and its table.
   */
  const withNote = (id, content, noteHtml) => {
    if (noteHtml === '') return content;
    try {
      const tpl = document.createElement('template');
      tpl.innerHTML = content;
      let gaps = [];
      const top = [...tpl.content.children];
      top.forEach((el, i) => {
        const next = top[i + 1];
        if (next !== undefined && next.classList.contains('vj-section') && !el.classList.contains('vj-aside') && !el.matches('figure')) gaps.push({ after: el });
      });
      if (gaps.length === 0) {
        for (const el of top.filter((x) => x.classList.contains('vj-section') && !x.classList.contains('vj-warn'))) {
          const kids = [...el.children];
          kids.forEach((k, j) => { if (k.matches('p.vj-p') && kids[j + 1]?.matches('p.vj-p') && j > 1) gaps.push({ after: k }); });
        }
      }
      if (gaps.length === 0) return content + noteHtml;
      let h = 7;
      for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 9973;
      const gap = gaps[h % gaps.length];
      gap.after.insertAdjacentHTML('afterend', noteHtml);
      const out = document.createElement('div');
      out.append(tpl.content);
      return out.innerHTML;
    } catch (e) { log(`journal note placement ${id} failed`, e); return content + noteHtml; }
  };
  const chapterPage = (id, folio, turn = '', left = true) => {
    const key = id.toUpperCase();
    let body = '';
    try { body = id === 'crafts' ? craftsTable() : jm.JOURNAL_WRITTEN[id] !== undefined ? writtenBody(id) : bookSections(state.helpSections(id)); } catch (e) { log(`journal chapter ${id} failed`, e); }
    const noteHtml = jm.JOURNAL_NOTES.includes(id) ? note(t(`MOD_VOY_JOURNAL_CH_${key}_NOTE`)) : '';
    // Pencilled behind the print of the Lands chapter, slanted and faint (build .145, the user's ask): the warning
    // that sends people looking for goblins, and so to the golbin's purse.
    const scrawl = id !== 'lands' ? '' : '<div class="vj-scrawl" aria-hidden="true">'
      + `<span class="vj-scrawl-line">${esc(t('MOD_VOY_JOURNAL_GOBLIN_SCRAWL'))}</span><span class="vj-scrawl-line vj-scrawl-big">${esc(t('MOD_VOY_JOURNAL_GOBLIN_SCRAWL_WHAT'))}</span></div>`;
    return `<div class="vj-page-body${scrawl ? ' vj-has-scrawl' : ''}">` + scrawl + runningHead(t('MOD_VOY_JOURNAL_TITLE'), t(`MOD_VOY_JOURNAL_CH_${key}_TITLE`))
      + `<h2 class="vj-h1">${esc(t(`MOD_VOY_JOURNAL_CH_${key}_TITLE`))}</h2>`
      + dropCap(t(`MOD_VOY_JOURNAL_CH_${key}_INTRO`)) + withNote(id, body + (id === 'travels' ? levelsLedger() : '') + (id === 'ship' ? shipBill() : '') + aside(id), noteHtml) + '</div>'
      + chapterFoot(turn, folio, left);
  };
  // The Manifest button (build .179): in the foot of every left chapter page, right
  // beside "Turn back" (the user: "leave manifest button only near left return"); it opens the first spread. The word
  // hides at phone width, the anchor and label stay.
  const ANCHOR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<circle cx="12" cy="5" r="2.2"></circle><path d="M12 7.2V21"></path><path d="M8 11h8"></path><path d="M4 14c0 4 4 7 8 7s8-3 8-7"></path><path d="M4 14l-1.5-2M4 14l2-1M20 14l1.5-2M20 14l-2-1"></path></svg>';
  const manifestButton = () => `<button type="button" class="vj-manifest" data-vj-manifest="1" aria-label="${esc(t('MOD_VOY_JOURNAL_MANIFEST'))}">${ANCHOR}<span class="vj-manifest-word">${esc(t('MOD_VOY_JOURNAL_MANIFEST'))}</span></button>`;
  const chapterFoot = (turn, folio, left) => (left
    ? `<div class="vj-foot vj-foot-split"><span class="vj-foot-start">${turn}${manifestButton()}</span><span class="vj-folio">${folio}</span></div>`
    : `<div class="vj-foot${turn ? ' vj-foot-split' : ''}"><span class="vj-folio">${folio}</span>${turn}</div>`);
  /**
   * The first spread (build .179): the Old Man's chart in pencil on the left (no folio), the
   * Manifest on the right: every How it works chapter shown to this character with its folio, each a link to its
   * spread, then the Old Man's Crew chapters while that tab is on.
   */
  const chartUrl = ctx.getResourceUrl('assets/chart.png');
  const manifestRow = (attr, title, folio) => `<button type="button" class="vj-mrow" ${attr}><span class="vj-mrow-title">${esc(title)}</span>`
    + `<span class="vj-mrow-dots" aria-hidden="true"></span><span class="vj-folio">${folio}</span></button>`;
  const firstSpread = (list) => {
    const left = `<figure class="vj-chart"><img src="${chartUrl}" alt="${esc(t('MOD_VOY_JOURNAL_CHART_ALT'))}"></figure>`;
    const how = list.map((id, i) => manifestRow(`data-vj-go="ch:${id}"`, t(`MOD_VOY_JOURNAL_CH_${id.toUpperCase()}_TITLE`), roman(i + 1))).join('');
    const crew = !crewOn() ? '' : `<div class="vj-manifest-head">${esc(t('MOD_VOY_JOURNAL_TAB_CREW'))}</div><div class="vj-mrows">`
      + jm.JOURNAL_CREW.map((id, i) => manifestRow(`data-vj-crew="${i}"`, t(`MOD_VOY_JOURNAL_CH_${id.toUpperCase()}_TITLE`), roman(i + 1))).join('') + '</div>';
    const right = '<div class="vj-page-body">' + runningHead(t('MOD_VOY_JOURNAL_TITLE'), t('MOD_VOY_JOURNAL_MANIFEST'))
      + `<h2 class="vj-h1">${esc(t('MOD_VOY_JOURNAL_MANIFEST'))}</h2>` + dropCap(t('MOD_VOY_JOURNAL_MANIFEST_LEAD'))
      + `<div class="vj-manifest-head">${esc(t('MOD_VOY_JOURNAL_TAB_HOW'))}</div><div class="vj-mrows">${how}</div>` + crew
      + `<p class="vj-p vj-manifest-rest">${esc(t('MOD_VOY_JOURNAL_MANIFEST_REST'))}</p></div>`
      + `<div class="vj-foot vj-foot-end"><button type="button" class="vj-turn" data-vj-turn="1">${esc(t('MOD_VOY_JOURNAL_TURN'))} <span aria-hidden="true">›</span></button></div>`;
    return { pinned: true, chart: true, left, right };
  };
  /** A "Did you know?" slip pasted into the chapter (journal-model.mjs JOURNAL_ASIDES), or ''. */
  const aside = (id) => {
    const k = jm.JOURNAL_ASIDES?.[id];
    if (k === undefined) return '';
    return `<aside class="vj-aside"><div class="vj-aside-label">${esc(t('MOD_VOY_JOURNAL_ASIDE_LABEL'))}</div>`
      + `<div class="vj-aside-head">${esc(t(`MOD_VOY_JOURNAL_ASIDE_${k}_HEAD`))}</div>`
      + t(`MOD_VOY_JOURNAL_ASIDE_${k}_BODY`).split('\n').map((l) => `<p class="vj-aside-p">${rich(l)}</p>`).join('') + '</aside>';
  };
  /**
   * Every Voyage level that unlocks something (build .136): the skill's own milestones, so the ledger follows
   * data/skill.json, with the levels reached ticked. The game's Skill Mastery milestone is left out.
   */
  const levelsLedger = () => {
    const sk = state.voyageSkill?.();
    const ms = (sk?.milestones ?? []).filter((m) => typeof CustomSkillMilestone === 'undefined' || m instanceof CustomSkillMilestone)
      .slice().sort((a, b) => a.level - b.level);
    if (sk === undefined || ms.length === 0) return '';
    const rows = ms.map((m) => [{ text: `${m.level}` }, { text: m.name }, sk.level >= m.level ? { text: '✓', cls: 'vj-num text-success' } : { text: '', cls: 'vj-num' }]);
    rows.numeric = [false, false, true];
    return `<div class="vj-section"><h3 class="vj-h3">${esc(t('MOD_VOY_JOURNAL_LEVELS_HEAD'))}</h3><p class="vj-p">${esc(t('MOD_VOY_JOURNAL_LEVELS_BODY'))}</p>`
      + ledger([t('MOD_VOY_JOURNAL_COL_VOYAGE_LEVEL'), t('MOD_VOY_JOURNAL_COL_GIVES'), t('MOD_VOY_JOURNAL_COL_YOURS')], rows)
      // The balance pass: the reward every level gives (model.travelDiscount).
      + `<p class="vj-p">${esc(t('MOD_VOY_JOURNAL_LEVELS_DISCOUNT', { per: `${model.TRAVEL_DISCOUNT_PER_LEVEL}`, pct: `${model.travelDiscount(sk.level)}` }))}</p></div>`;
  };
  const roman = (n) => ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi'][n - 1] ?? `${n}`;
  /** Chapters two to a spread: How it works (`view.spread`) and the Old Man's Crew (`view.crewSpread`). */
  const howSpread = (list = chapters(), field = 'spread') => {
    // How it works opens on the chart and the Manifest (build .179); the Crew tab has no first spread of its own.
    const first = field === 'spread' ? jm.FIRST_SPREADS : 0;
    const spreads = first + Math.ceil(list.length / 2);
    view[field] = Math.max(0, Math.min(spreads - 1, view[field]));
    if (view[field] < first) return firstSpread(list);
    const at = view[field] - first;
    const a = list[at * 2];
    const b = list[at * 2 + 1];
    const turn = (dir, key) => `<button type="button" class="vj-turn" data-vj-turn="${dir}">${dir < 0 ? '<span aria-hidden="true">‹</span> ' : ''}${esc(t(key))}${dir > 0 ? ' <span aria-hidden="true">›</span>' : ''}</button>`;
    const back = view[field] > 0 ? turn(-1, 'MOD_VOY_JOURNAL_TURN_BACK') : '';
    const on = view[field] < spreads - 1 ? turn(1, 'MOD_VOY_JOURNAL_TURN') : '';
    return { pinned: true, left: chapterPage(a, roman(at * 2 + 1), back, true), right: b === undefined ? '' : chapterPage(b, roman(at * 2 + 2), on, false) };
  };

  // Resources: every journal entry, by skill, with the search over action and item names.
  const productNames = (a) => {
    const out = [];
    for (const k of ['product', 'primaryProduct']) if (a?.[k]?.name) out.push(a[k].name);
    try { a?.lootTable?.drops?.forEach((d) => { if (d.item?.name) out.push(d.item.name); }); } catch {}
    return out;
  };
  const entries = () => {
    const j = journal();
    if (j === undefined) return [];
    const ids = [...new Set([...Object.keys(j.found), ...Object.keys(j.missed), ...j.charted])].filter((id) => zoned.has(id));
    const order = [...zoned.keys()];
    return ids.sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((id) => {
      const a = actionOf(id);
      return { id, action: a, skillId: zoned.get(id), skill: skillOf(zoned.get(id))?.name, names: [a?.name ?? id, ...productNames(a)], found: j.found[id] ?? [], missed: j.missed[id] ?? [], charted: j.charted.includes(id) };
    });
  };
  const countText = (e) => [
    e.found.length > 0 ? t(e.found.length === 1 ? 'MOD_VOY_JOURNAL_HEXES_ONE' : 'MOD_VOY_JOURNAL_HEXES_MANY', { count: `${e.found.length}` }) : '',
    e.missed.length > 0 ? t(e.missed.length === 1 ? 'MOD_VOY_JOURNAL_MISSES_ONE' : 'MOD_VOY_JOURNAL_MISSES_MANY', { count: `${e.missed.length}` }) : '',
    e.charted ? t('MOD_VOY_JOURNAL_CHARTED_COUNT') : '',
  ].filter((x) => x !== '').join(', ');
  /** A search field with its label (Resources and Places). */
  const searchBox = (id, labelKey, value) => `<div class="vj-search"><label for="${id}">${esc(t(labelKey))}</label><div class="vj-search-box">`
    + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6"></circle><path d="M20 20l-4.5-4.5"></path></svg>'
    + `<input id="${id}" type="search" autocomplete="off" value="${esc(value)}"></div></div>`;
  const resultsHtml = () => {
    const all = entries();
    if (all.length === 0) return empty('MOD_VOY_JOURNAL_RESOURCES_EMPTY');
    const hits = new Set(jm.search(all, view.query));
    const shown = all.filter((e) => hits.has(e.id));
    if (shown.length === 0) return `<p class="vj-p vj-faint">${esc(t('MOD_VOY_JOURNAL_SEARCH_NONE', { query: view.query.trim() }))}</p>`;
    let html = '';
    let skill;
    for (const e of shown) {
      if (e.skillId !== skill) { skill = e.skillId; html += `<div class="vj-group">${esc(skillOf(skill)?.name ?? skill)}</div>`; }
      html += `<button type="button" class="vj-row${e.id === view.entry ? ' vj-on' : ''}" data-vj-entry="${esc(e.id)}" aria-pressed="${e.id === view.entry}">`
        + `<span class="vj-row-name">${e.action?.media ? `<img src="${e.action.media}" alt="">` : ''}<b>${esc(e.names[0])}</b>${unreadTag(`a:${e.id}`)}</span><span class="vj-row-count">${esc(countText(e))}</span></button>`;
    }
    return html;
  };
  const entryPage = (e) => {
    if (e === undefined) return runningHead(t('MOD_VOY_JOURNAL_TAB_RESOURCES'), '') + empty('MOD_VOY_JOURNAL_ENTRY_NONE');
    const skill = skillOf(e.skillId);
    const level = e.action?.level;
    const why = zoneOf(e.id)?.why;
    const from = state.position();
    const rows = jm.byDistance(e.found, from).map((h, i) => [{ text: at(h.q, h.r) }, land(h.q, h.r), i === 0 && from !== undefined && h.distance > 0 ? t('MOD_VOY_JOURNAL_NEAREST', { where: fromHere(h) }) : fromHere(h)]);
    const misses = e.missed.map(jm.parseHex).filter((h) => h !== undefined).map((h) => at(h.q, h.r));
    return runningHead(level !== undefined ? t('MOD_VOY_JOURNAL_SKILL_LEVEL', { skill: skill?.name ?? '', level: `${level}` }) : skill?.name ?? '', '')
      + `<div class="vj-entry-head">${e.action?.media ? `<img src="${e.action.media}" alt="">` : ''}<h2 class="vj-h1">${esc(e.names[0])}</h2>${heatButton(e)}</div>`
      + (why ? `<p class="vj-p vj-italic">${esc(t('MOD_VOY_JOURNAL_WHY', { why }))}</p>` : '')
      // The balance pass: the first saving-up trip, and the boat nearly halves it.
      + (e.id === 'melvorD:Coal_Ore' ? `<p class="vj-p vj-italic">${esc(t('MOD_VOY_JOURNAL_COAL_NOTE'))}</p>` : '')
      + (e.charted ? `<p class="vj-p vj-charted-line">${esc(t('MOD_VOY_JOURNAL_CHARTED_LINE', { count: `${chartedHexes(e.id).length}` }))}</p>` : '')
      + (rows.length > 0
        ? `<h3 class="vj-h3">${esc(t('MOD_VOY_JOURNAL_WHERE_FOUND'))}</h3>${ledger([t('MOD_VOY_JOURNAL_COL_HEX'), t('MOD_VOY_JOURNAL_COL_LAND'), t('MOD_VOY_JOURNAL_COL_FROM_HERE')], rows)}`
        : empty('MOD_VOY_JOURNAL_NOT_FOUND_YET'))
      + (misses.length > 0 ? `<h3 class="vj-h3">${esc(t('MOD_VOY_JOURNAL_WHERE_NOT'))}</h3><p class="vj-p">${esc(t('MOD_VOY_JOURNAL_MISSES_LINE', { name: e.names[0], hexes: misses.join(', ') }))}</p>` : '')
      + (rows.length > 0 ? `<div class="vj-foot vj-foot-end">${planButton('entry', e.id)}${mapButton('entry', e.id)}</div>` : '');
  };
  /** The heat map button next to an entry's name (src/heatmap.mjs): a hexagon with a glow in it. */
  const heatButton = (e) => {
    if (state.heatmap === undefined || (e.found.length === 0 && e.missed.length === 0 && !e.charted)) return '';
    const label = esc(t('MOD_VOY_JOURNAL_HEAT_OPEN', { name: e.names[0] }));
    return `<button type="button" class="vj-heat-btn" data-vj-heat="${esc(e.id)}" aria-label="${label}" title="${label}">`
      + '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z"></path><circle cx="12" cy="12" r="4.2" fill="currentColor" fill-opacity=".35"></circle><circle cx="12" cy="12" r="1.6" fill="currentColor"></circle></svg></button>';
  };
  const openHeat = (id, button) => {
    const e = entries().find((x) => x.id === id);
    if (e === undefined || state.heatmap === undefined) return;
    state.heatmap.open({
      container: root, title: e.names[0], media: e.action?.media,
      found: e.found.map(jm.parseHex).filter((h) => h !== undefined),
      missed: e.missed.map(jm.parseHex).filter((h) => h !== undefined),
      charted: e.charted ? chartedHexes(e.id) : [],
      describe: (q, r) => `${at(q, r)} · ${land(q, r)}`,
      surveyed: (q, r) => liveHex(q, r)?.isFullySurveyed === true,
      onClose: () => { try { if (button?.isConnected) button.focus(); else root.querySelector('.vj-heat-btn')?.focus(); } catch {} },
    });
  };
  const resourcesSpread = () => {
    const all = entries();
    if (view.entry === undefined || !all.some((e) => e.id === view.entry)) view.entry = all[0]?.id;
    const picker = view.pick !== undefined ? pickerPage() : undefined;
    if (picker === undefined && view.entry !== undefined) seen(`a:${view.entry}`);
    const left = runningHead(t('MOD_VOY_JOURNAL_TITLE'), t('MOD_VOY_JOURNAL_TAB_RESOURCES'))
      + `<h2 class="vj-h1">${esc(t('MOD_VOY_JOURNAL_RESOURCES_TITLE'))}</h2>`
      + chartsBand() + readAll('a:')
      + searchBox('vj-search', 'MOD_VOY_JOURNAL_SEARCH_LABEL', view.query)
      + `<div class="vj-results">${resultsHtml()}</div>`;
    return { left, right: picker ?? entryPage(all.find((e) => e.id === view.entry)) };
  };

  // ---------------------------------------------------------------------------------------------------- charting
  // Charting a country (build .116): a reveal item or a free chart marks the whole country of one action.
  /** The hexes of a charted country, as the zone draws them now. */
  const chartedHexes = (id) => (state.zoneCandidates?.(id) ?? []).map((rec) => ({ q: rec.q, r: rec.r }));
  const freeLeft = () => { const j = journal(); return j === undefined ? 0 : jm.freeChartsLeft(voyageLevel(), j.freeUsed, model.FREE_CHART_LEVELS); };
  /** Reveal items in the bank: [{ skillId, item, qty }], for skills the game has. */
  const heldCharts = () => Object.keys(jm.CHART_ITEMS).map((skillId) => {
    const item = chartItem(skillId);
    let qty = 0;
    try { qty = item === undefined ? 0 : game.bank.getQty(item); } catch {}
    return { skillId, item, qty };
  }).filter((c) => c.item !== undefined && c.qty > 0 && skillOf(c.skillId) !== undefined);
  /** With zones off there is nothing to chart. */
  const canChart = () => journal() !== undefined && state.zonesOn?.() === true;
  /** Where a chart can come from: each item held, and the free charts. */
  const chartSources = () => [
    ...heldCharts().map((c) => ({ key: c.skillId, name: c.item.name, media: c.item.media, count: c.qty })),
    ...(freeLeft() > 0 ? [{ key: 'free', name: t('MOD_VOY_JOURNAL_CHARTS_FREE'), media: iconUrl, count: freeLeft() }] : []),
  ];
  /** "Charts to use" at the top of Resources, only while there is one. */
  const chartsBand = () => {
    if (!canChart()) return '';
    const sources = chartSources();
    if (sources.length === 0) return '';
    return `<div class="vj-charts"><div class="vj-charts-head">${esc(t('MOD_VOY_JOURNAL_CHARTS_HEAD'))}</div><div class="vj-charts-list">`
      + sources.map((c) => `<span class="vj-chart-chip"><img src="${c.media}" alt=""><span>${esc(c.name)}</span><b>×${c.count}</b></span>`).join('')
      + `</div><button type="button" class="vj-btn" data-vj-pick="open">${esc(t('MOD_VOY_JOURNAL_CHART_BUTTON'))}</button></div>`;
  };
  /** The picker on the right page: what to use, (for a free chart) which craft, then what to chart, then confirm. */
  const pickerPage = () => {
    const p = view.pick;
    const sources = canChart() ? chartSources() : [];
    if (sources.length === 0) { view.pick = undefined; return undefined; }
    if (!sources.some((x) => x.key === p.source)) { p.source = sources.length === 1 ? sources[0].key : undefined; p.action = undefined; }
    const option = (attr, key, on, media, label, extra = '') => `<button type="button" class="vj-row${on ? ' vj-on' : ''}" ${attr}="${esc(key)}" aria-pressed="${on}">`
      + `<span class="vj-row-name">${media ? `<img src="${media}" alt="">` : ''}<b>${esc(label)}</b></span><span class="vj-row-count">${esc(extra)}</span></button>`;
    let html = runningHead(t('MOD_VOY_JOURNAL_TAB_RESOURCES'), '')
      + `<h2 class="vj-h1">${esc(t('MOD_VOY_JOURNAL_PICK_TITLE'))}</h2><p class="vj-p">${esc(t('MOD_VOY_JOURNAL_PICK_INTRO'))}</p>`
      + `<h3 class="vj-h3">${esc(t('MOD_VOY_JOURNAL_PICK_SOURCE'))}</h3>`
      + sources.map((x) => option('data-vj-pick-source', x.key, x.key === p.source, x.media, x.name, `×${x.count}`)).join('');
    const skillId = p.source === 'free' ? p.skill : p.source;
    if (p.source === 'free') {
      html += `<h3 class="vj-h3">${esc(t('MOD_VOY_JOURNAL_PICK_SKILL'))}</h3>`
        + Object.keys(jm.CHART_ITEMS).filter((id) => skillOf(id) !== undefined && state.zoneTable?.skills?.[id] !== undefined)
          .map((id) => option('data-vj-pick-skill', id, id === p.skill, skillOf(id).media, skillOf(id).name)).join('');
    }
    if (p.source !== undefined && skillId !== undefined) {
      const skill = skillOf(skillId);
      const j = journal();
      const list = [...zoned].filter(([, s]) => s === skillId).map(([id]) => actionOf(id))
        .filter((a) => a !== undefined && (a.level ?? 1) <= (skill?.level ?? 1) && !j.charted.includes(a.id));
      html += `<h3 class="vj-h3">${esc(t('MOD_VOY_JOURNAL_PICK_ACTION'))}</h3>`;
      if (list.length === 0) html += empty('MOD_VOY_JOURNAL_PICK_NONE');
      for (const a of list) {
        const known = (j.found[a.id]?.length ?? 0) > 0;
        html += option('data-vj-pick-action', a.id, a.id === p.action, a.media, a.name, `${t('MOD_VOY_JOURNAL_LEVEL_SHORT', { level: `${a.level ?? 1}` })}${known ? '' : ` · ${t('MOD_VOY_JOURNAL_PICK_UNMET')}`}`);
        if (a.id === p.action) {
          const source = p.source === 'free' ? t('MOD_VOY_JOURNAL_FREE_SOURCE') : chartItem(p.source)?.name ?? '';
          html += `<div class="vj-confirm" role="group" aria-label="${esc(t('MOD_VOY_JOURNAL_PICK_TITLE'))}"><p class="vj-p">${esc(t('MOD_VOY_JOURNAL_PICK_CONFIRM', { name: a.name, source }))}</p>`
            + `<div class="vj-confirm-buttons"><button type="button" class="vj-btn vj-btn-go" data-vj-pick-go="1">${esc(t('MOD_VOY_JOURNAL_PICK_GO'))}</button>`
            + `<button type="button" class="vj-btn" data-vj-pick-cancel="1">${esc(t('MOD_VOY_JOURNAL_PICK_CANCEL'))}</button></div></div>`;
        }
      }
    }
    if (p.action === undefined) html += `<div class="vj-foot vj-foot-end"><button type="button" class="vj-btn" data-vj-pick-cancel="1">${esc(t('MOD_VOY_JOURNAL_PICK_CANCEL'))}</button></div>`;
    return html;
  };
  /** Uses the chosen chart: the item (or a free chart) goes, the action is charted and its entry opens. */
  const doChart = () => {
    const p = view.pick;
    const j = journal();
    if (p === undefined || p.action === undefined || j === undefined || !canChart()) return;
    const id = p.action;
    const skillId = zoned.get(id);
    const action = actionOf(id);
    if (p.source === 'free') { if (freeLeft() <= 0) return; }
    else {
      const item = chartItem(p.source);
      if (item === undefined || p.source !== skillId || game.bank.getQty(item) < 1) return;
    }
    const had = (j.found[id]?.length ?? 0) + (j.missed[id]?.length ?? 0) > 0;
    if (!jm.chart(j, id)) return;
    if (p.source === 'free') j.freeUsed += 1;
    else game.bank.removeItemQuantity(chartItem(p.source), 1, false);
    const hexes = chartedHexes(id);
    markKnown(hexes);
    unread(j, `a:${id}`, had ? 'more' : 'new');
    log(`journal: ${id} charted (${hexes.length} hexes) with ${p.source}`);
    notify(t('MOD_VOY_JOURNAL_CHARTED_NOTICE', { name: action?.name ?? id, count: `${hexes.length}` }), action?.media);
    view.pick = undefined;
    view.entry = id;
    view.query = '';
    render();
    root.querySelector('.vj-right')?.focus();
  };

  // ---------------------------------------------------------------------------------------------------- unread
  /** "New" or "Updated" after a name while it is unread. */
  const unreadTag = (key) => {
    const kind = journal()?.unread?.[key];
    return kind === undefined ? '' : `<span class="vj-unread">${esc(t(kind === 'new' ? 'MOD_VOY_JOURNAL_UNREAD_NEW' : 'MOD_VOY_JOURNAL_UNREAD_MORE'))}</span>`;
  };
  /** The page shown is read. */
  const seen = (key) => { const j = journal(); if (j !== undefined && jm.markRead(j, key)) badge(); };
  /** "Mark all as read" under a tab's title, while it has unread marks. */
  const readAll = (prefix) => {
    const j = journal();
    return j === undefined || jm.unreadCount(j, prefix) === 0 ? ''
      : `<div class="vj-readall"><button type="button" class="vj-linkbtn" data-vj-readall="${prefix}">${esc(t('MOD_VOY_JOURNAL_MARK_READ'))}</button></div>`;
  };

  // Places: areas fought in, trading places used, points of interest discovered.
  const placeList = () => {
    const j = journal();
    const out = [];
    if (j === undefined) return out;
    for (const p of jm.placesOf(j, 'combat')) { const a = areaById(p.id); out.push({ key: `combat|${p.id}`, group: 'combat', name: a?.name ?? terrainMod.areaLabel(p.id), media: a?.media, q: p.q, r: p.r }); }
    // A trade noted before build .173 at a place still undiscovered waits until it is found (and is not left unread).
    for (const p of jm.placesOf(j, 'trade')) { if (!tradeKnown(p)) { jm.markRead(j, `p:trade|${p.id}`); continue; } const poi = poiAt(p.q, p.r); out.push({ key: `trade|${p.id}`, group: 'trade', name: poi?.name ?? land(p.q, p.r), media: poi?.media, q: p.q, r: p.r }); }
    try {
      live()?.forEach((hex) => {
        const poi = hex.pointOfInterest;
        // A market or port already under "Traded at" is not listed again.
        if (poi !== undefined && poi.isDiscovered && !out.some((p) => p.group === 'trade' && p.q === hex.q && p.r === hex.r)) out.push({ key: `poi|${poi.id}`, group: 'poi', name: poi.name, media: poi.media, q: hex.q, r: hex.r });
      });
    } catch (e) { log('journal POIs failed', e); }
    return out;
  };
  /**
   * Places search (build .116, the user's ask), as Resources does: a place's name, its land, its group ("Traded at")
   * and, for a combat area, the monsters in it ("goblin" finds the area it was fought in).
   */
  const placeSearchEntry = (p) => {
    const names = [p.name, land(p.q, p.r)];
    if (p.group === 'combat') { try { areaById(p.key.slice(p.key.indexOf('|') + 1))?.monsters?.forEach((m) => { if (m?.name) names.push(m.name); }); } catch {} }
    return { id: p.key, names, skill: t(`MOD_VOY_JOURNAL_PLACES_${p.group.toUpperCase()}`) };
  };
  // Search "goblin" and the Old Man's sketch turns up, his spelling put right the game's way (the user's idea, build
  // .116): the drawing, a line in his voice, then what "golbin" finds.
  const golbinUrl = ctx.getResourceUrl('assets/golbin.png');
  const golbin = () => `<figure class="vj-figure vj-golbin"><img src="${golbinUrl}" alt="${esc(t('MOD_VOY_JOURNAL_GOLBIN_ALT'))}"></figure>`
    + `<p class="vj-p vj-italic">${esc(t('MOD_VOY_JOURNAL_GOLBIN_NOTE'))}</p>`;
  const isGoblinQuery = (q) => /^goblins?$/.test(jm.fold(q ?? ''));

  // The golbin's purse (build .143, the user's ask): the first "goblin" search opens a letter from the Old Man over
  // the book, with the game's own fireworks (showFireworks, as for a level 99; the user: "there should be in game
  // confetti trigger"), and pays model.GOLBIN_GIFT once per character (journal.golbin). Forced, so they stay up while
  // the letter is open (unforced ones go when no Swal is open), and removed with it.
  let giftEl;
  const fireworks = (on) => {
    try {
      if (!on) { if (typeof removePyro === 'function') removePyro(); return; }
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      if (typeof showFireworks === 'function') showFireworks(true);
    } catch (e) { log('fireworks failed', e); }
  };
  const closeLetter = () => {
    if (giftEl === undefined) return;
    giftEl.remove();
    giftEl = undefined;
    fireworks(false);
    root?.querySelector('#vj-place-search')?.focus();
  };
  /** The Old Man's letter over the book (voyageDev.golbin shows it again without paying anything). */
  const showLetter = () => {
    if (root === undefined || !view.open) return;
    closeLetter();
    const g = model.GOLBIN_GIFT;
    const present = [`<span class="vj-present-item"><img src="${game.gp.media}" alt="">${esc(numberWithCommas(g.gp))} ${esc(game.gp.name)}</span>`];
    for (const { id, quantity } of g.items) {
      const item = game.items.getObjectByID(id);
      if (item !== undefined) present.push(`<span class="vj-present-item"><img src="${item.media}" alt="">${esc(numberWithCommas(quantity))} ${esc(item.name)}</span>`);
    }
    giftEl = document.createElement('div');
    giftEl.className = 'vj-gift';
    giftEl.setAttribute('role', 'dialog');
    giftEl.setAttribute('aria-modal', 'true');
    giftEl.setAttribute('aria-labelledby', 'vj-gift-title');
    giftEl.innerHTML = '<div class="vj-letter">'
      + `<div class="vj-aside-label">${esc(t('MOD_VOY_GOLBIN_GIFT_LABEL'))}</div>`
      + `<h2 class="vj-h1" id="vj-gift-title">${esc(t('MOD_VOY_GOLBIN_GIFT_TITLE'))}</h2>`
      + t('MOD_VOY_GOLBIN_GIFT_BODY').split('\n').map((line) => `<p class="vj-p">${esc(line)}</p>`).join('')
      + `<p class="vj-sign">${esc(t('MOD_VOY_GOLBIN_GIFT_SIGN'))}</p>`
      + `<div class="vj-present"><div class="vj-group">${esc(t('MOD_VOY_GOLBIN_GIFT_PRESENT'))}</div><div class="vj-present-items">${present.join('')}</div></div>`
      + `<div class="vj-gift-foot"><button type="button" class="btn btn-success vj-gift-ok">${esc(t('MOD_VOY_GOLBIN_GIFT_THANKS'))}</button></div>`
      + '</div>';
    root.append(giftEl);
    giftEl.addEventListener('click', (e) => {
      e.stopPropagation(); // not the backdrop's "click outside closes the book"
      if (e.target === giftEl || (e.target instanceof Element && e.target.closest('.vj-gift-ok'))) closeLetter();
    });
    giftEl.querySelector('.vj-gift-ok')?.focus();
    fireworks(true);
  };
  /** Pays the golbin's purse the first time, then shows the letter. */
  const golbinGift = () => {
    const j = journal();
    if (j === undefined || j.golbin === true) return;
    j.golbin = true;
    const g = model.GOLBIN_GIFT;
    try { game.gp.add(g.gp); } catch (e) { log('golbin gift GP failed', e); }
    for (const { id, quantity } of g.items) {
      try { const item = game.items.getObjectByID(id); if (item !== undefined) game.bank.addItem(item, quantity, false, true, true, false, 'Voyage'); } catch (e) { log('golbin gift item failed', e); }
    }
    log('golbin gift given', g);
    showLetter();
  };
  const placeResultsHtml = (all = placeList()) => {
    if (all.length === 0) return empty('MOD_VOY_JOURNAL_PLACES_EMPTY');
    const isGoblin = isGoblinQuery(view.placeQuery);
    const query = isGoblin ? 'golbin' : view.placeQuery;
    const hits = new Set(jm.search(all.map(placeSearchEntry), query));
    const shown = all.filter((p) => hits.has(p.key));
    if (shown.length === 0) return (isGoblin ? golbin() : '') + `<p class="vj-p vj-faint">${esc(t('MOD_VOY_JOURNAL_SEARCH_NONE', { query: view.placeQuery.trim() }))}</p>`;
    let list = isGoblin ? golbin() : '';
    for (const g of ['combat', 'trade', 'poi']) {
      const rows = shown.filter((p) => p.group === g);
      if (rows.length === 0) continue;
      list += `<div class="vj-group">${esc(t(`MOD_VOY_JOURNAL_PLACES_${g.toUpperCase()}`))}</div>`;
      for (const p of rows) {
        list += `<button type="button" class="vj-row${p.key === view.place ? ' vj-on' : ''}" data-vj-place="${esc(p.key)}" aria-pressed="${p.key === view.place}">`
          + `<span class="vj-row-name">${p.media ? `<img src="${p.media}" alt="">` : ''}<b>${esc(p.name)}</b>${unreadTag(`p:${p.key}`)}</span><span class="vj-row-count">${esc(at(p.q, p.r))}</span></button>`;
      }
    }
    return list;
  };
  /**
   * A POI's standing effects under its place page, as the game writes them, and whether the Crossroads Sign stands there
   * (build .173, the user).
   */
  const placeEffects = (p) => {
    const poi = poiAt(p.q, p.r);
    if (poi?.activeStats?.hasStats !== true) return '';
    let buffs = [];
    try { buffs = poi.activeStats.describeAsSpans(1, game.cartography.hasCarthuluPet ? 2 : 1); } catch (e) { log('journal place effects failed', e); }
    if (buffs.length === 0) return '';
    const signed = state.land?.signPoi?.() === poi;
    return `<h3 class="vj-h3">${esc(t('MOD_VOY_JOURNAL_PLACE_EFFECTS'))}</h3>`
      + `<p class="vj-p vj-buffs">${buffs.map((b) => `<span class="${esc(b.className || 'text-success')}">${esc(b.textContent)}</span>`).join('')}</p>`
      + (signed ? `<p class="vj-p vj-sign-here"><img src="${esc(state.land.signMedia())}" alt=""><span class="vj-yes">${esc(t('MOD_VOY_JOURNAL_PLACE_SIGNED'))}</span></p>` : '');
  };
  const placesSpread = () => {
    const all = placeList();
    if (view.place === undefined || !all.some((p) => p.key === view.place)) view.place = all[0]?.key;
    if (view.place !== undefined) seen(`p:${view.place}`);
    const left = runningHead(t('MOD_VOY_JOURNAL_TITLE'), t('MOD_VOY_JOURNAL_TAB_PLACES'))
      + `<h2 class="vj-h1">${esc(t('MOD_VOY_JOURNAL_PLACES_TITLE'))}</h2>` + readAll('p:')
      + (all.length === 0 ? '' : searchBox('vj-place-search', 'MOD_VOY_JOURNAL_PLACES_SEARCH_LABEL', view.placeQuery))
      + `<div class="vj-results vj-place-results">${placeResultsHtml(all)}</div>`;
    const p = all.find((x) => x.key === view.place);
    const right = p === undefined ? runningHead(t('MOD_VOY_JOURNAL_TAB_PLACES'), '') + empty('MOD_VOY_JOURNAL_ENTRY_NONE')
      : runningHead(t(`MOD_VOY_JOURNAL_PLACES_${p.group.toUpperCase()}`), '')
        + `<div class="vj-entry-head">${p.media ? `<img src="${p.media}" alt="">` : ''}<h2 class="vj-h1">${esc(p.name)}</h2></div>`
        + ledger([t('MOD_VOY_JOURNAL_COL_HEX'), t('MOD_VOY_JOURNAL_COL_LAND'), t('MOD_VOY_JOURNAL_COL_FROM_HERE')], [[{ text: at(p.q, p.r) }, land(p.q, p.r), fromHere(p)]])
        + placeEffects(p)
        + `<div class="vj-foot vj-foot-end">${planButton('place', p.key)}${mapButton('place', p.key)}</div>`;
    return { left, right };
  };

  // Guide: the pages written so far, in the order they were learnt; blank lines for the rest.
  const guideSpread = () => {
    const j = journal();
    const written = j?.guides ?? [];
    if (view.guide === undefined || !written.includes(view.guide)) view.guide = written[written.length - 1];
    if (view.guide !== undefined) seen(`g:${view.guide}`);
    const rows = written.map((id) => `<li><button type="button" class="vj-index${id === view.guide ? ' vj-on' : ''}" data-vj-guide="${id}" aria-current="${id === view.guide ? 'page' : 'false'}">${esc(guideTitle(id))}${unreadTag(`g:${id}`)}</button></li>`).join('')
      + model.JOURNAL_GUIDES.filter((id) => !written.includes(id)).map(() => `<li class="vj-blank"><span aria-hidden="true"></span><i>${esc(t('MOD_VOY_JOURNAL_NOT_WRITTEN'))}</i></li>`).join('');
    const left = runningHead(t('MOD_VOY_JOURNAL_TITLE'), t('MOD_VOY_JOURNAL_TAB_GUIDE'))
      + `<h2 class="vj-h1">${esc(t('MOD_VOY_JOURNAL_GUIDE_TITLE'))}</h2>${readAll('g:')}<p class="vj-p">${esc(t('MOD_VOY_JOURNAL_GUIDE_INTRO'))}</p><ol class="vj-list">${rows}</ol>`;
    if (view.guide === undefined) return { left, right: runningHead(t('MOD_VOY_JOURNAL_TAB_GUIDE'), '') + empty('MOD_VOY_JOURNAL_GUIDE_NONE') };
    const key = view.guide.toUpperCase();
    const [lead, ...rest] = t(`MOD_VOY_JOURNAL_GUIDE_${key}_BODY`).split('\n');
    const points = t(`MOD_VOY_JOURNAL_GUIDE_${key}_POINTS`).split('\n').filter((x) => x.trim() !== '');
    const right = runningHead(t('MOD_VOY_JOURNAL_TAB_GUIDE'), '')
      + `<h2 class="vj-h1">${esc(guideTitle(view.guide))}</h2>` + dropCap(lead) + rest.map((p) => `<p class="vj-p">${rich(p)}</p>`).join('')
      + (points.length > 0 ? `<ul class="vj-points">${points.map((p) => `<li>${rich(p)}</li>`).join('')}</ul>` : '')
      + (view.back !== null ? `<div class="vj-foot vj-foot-end"><button type="button" class="vj-btn" data-vj-back="1">${esc(t('MOD_VOY_JOURNAL_BACK'))}</button></div>` : '');
    return { left, right };
  };

  const TAB_UNREAD = { resources: 'a:', places: 'p:', guide: 'g:' };
  /**
   * Tab icons (the user, 17 Oct 2026: "icons for the journal tabs, only icons on phones"): line drawings in the
   * tab's text colour, above the name on the side tabs, alone on a phone (the name then in a Melvor tooltip and for
   * screen readers). How it works an open book, Resources a barrel, Places a map pin, Guide a compass, Crew two hands.
   */
  const TAB_SVG = (paths) => `<svg class="vj-tab-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const TAB_ICON = {
    how: TAB_SVG('<path d="M12 6.5C9.8 5 6.8 4.5 3.5 5v13c3.3-.5 6.3 0 8.5 1.5 2.2-1.5 5.2-2 8.5-1.5V5c-3.3-.5-6.3 0-8.5 1.5z"></path><path d="M12 6.5v13"></path>'),
    resources: TAB_SVG('<path d="M7 3.5h10c1.6 2.8 1.6 14.2 0 17H7c-1.6-2.8-1.6-14.2 0-17z"></path><path d="M5.4 8.5h13.2M5.4 15.5h13.2"></path>'),
    places: TAB_SVG('<path d="M12 21s-6.5-5.8-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21z"></path><circle cx="12" cy="10.5" r="2.3"></circle>'),
    guide: TAB_SVG('<circle cx="12" cy="12" r="8.5"></circle><path d="M15.5 8.5l-2.2 4.8-4.8 2.2 2.2-4.8z"></path>'),
    crew: TAB_SVG('<circle cx="9" cy="8" r="3"></circle><path d="M3.5 20c0-3.2 2.4-5.8 5.5-5.8s5.5 2.6 5.5 5.8"></path><circle cx="16.5" cy="9" r="2.4"></circle><path d="M15.6 14.3c2.8.3 4.9 2.6 4.9 5.7"></path>'),
  };
  /** Phone width (the journal's one-column layout, css/voyage.css): the tabs show their icon only. */
  const narrow = () => window.matchMedia?.('(max-width: 899px)').matches === true;
  const TAB_KEY = { how: 'MOD_VOY_JOURNAL_TAB_HOW', resources: 'MOD_VOY_JOURNAL_TAB_RESOURCES', places: 'MOD_VOY_JOURNAL_TAB_PLACES', guide: 'MOD_VOY_JOURNAL_TAB_GUIDE', crew: 'MOD_VOY_JOURNAL_TAB_CREW' };
  /** Draws the open book; `keepScroll` (a record changed under the reader) leaves the pages where they were. */
  const render = (keepScroll = false) => {
    if (!view.open || root === undefined) return;
    let spread;
    try {
      if (view.tab === 'crew' && !crewOn()) view.tab = 'how';
      spread = view.tab === 'resources' ? resourcesSpread() : view.tab === 'places' ? placesSpread() : view.tab === 'guide' ? guideSpread()
        : view.tab === 'crew' ? howSpread(jm.JOURNAL_CREW, 'crewSpread') : howSpread();
    } catch (e) { log('journal render failed', e); spread = { left: empty('MOD_VOY_JOURNAL_ENTRY_NONE'), right: '' }; }
    const searchHadFocus = ['vj-search', 'vj-place-search'].includes(document.activeElement?.id) ? document.activeElement.id : undefined;
    for (const [side, html] of [['.vj-left', spread.left], ['.vj-right', spread.right]]) {
      const page = root.querySelector(side);
      page.innerHTML = html;
      page.classList.toggle('vj-pinned', spread.pinned === true);
      page.classList.toggle('vj-chart-page', side === '.vj-left' && spread.chart === true);
      if (!keepScroll) page.scrollTop = 0;
    }
    // The phone layout scrolls the spread, not the pages: a new spread starts at its top there too.
    const spreadEl = root.querySelector('.vj-spread');
    if (spreadEl && !keepScroll) spreadEl.scrollTop = 0;
    const j = journal();
    root.querySelectorAll('[data-vj-tab]').forEach((b) => {
      const on = b.dataset.vjTab === view.tab;
      b.hidden = b.dataset.vjTab === 'crew' && !crewOn();
      // Unread marks on the tab: a count after its name.
      const prefix = TAB_UNREAD[b.dataset.vjTab];
      const n = prefix === undefined || j === undefined ? 0 : jm.unreadCount(j, prefix);
      b.innerHTML = `${TAB_ICON[b.dataset.vjTab]}<span class="vj-tab-name">${esc(t(TAB_KEY[b.dataset.vjTab]))}</span>${n > 0 ? `<span class="vj-tab-count" aria-hidden="true">${n}</span>` : ''}`;
      if (n > 0) b.setAttribute('aria-label', t('MOD_VOY_JOURNAL_TAB_UNREAD', { tab: t(TAB_KEY[b.dataset.vjTab]), count: `${n}` })); else b.removeAttribute('aria-label');
      b.classList.toggle('vj-tab-on', on);
      // The name is on the tab beside the icon, except on a phone: there it is the tab's tooltip (press and hold).
      state.tips?.set(b, narrow() ? t(TAB_KEY[b.dataset.vjTab]) : '');
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    try { state.skillNames?.(root.querySelector('.vj-spread')); } catch {}
    if (searchHadFocus) { const s = root.querySelector(`#${searchHadFocus}`); s?.focus(); s?.setSelectionRange(s.value.length, s.value.length); }
  };
  /** A crosslink: opens its chapter, guide page or tab, and puts focus on the page it lands on. */
  const goTo = (kind, id) => {
    let side = '.vj-left';
    if (kind === 'ch') {
      const i = chapters().indexOf(id);
      if (i < 0) return;
      view.tab = 'how';
      view.spread = jm.chapterSpread(i);
      if (i % 2 === 1) side = '.vj-right';
    } else if (kind === 'guide') { view.tab = 'guide'; view.guide = id; side = '.vj-right'; }
    else if (kind === 'tab' && TABS.includes(id) && (id !== 'crew' || crewOn())) view.tab = id;
    else return;
    view.back = null;
    render();
    showPage(side);
  };
  /** Redraws the open book after a record changed; cheap when it is closed. */
  function refresh() { if (view.open) render(true); }
  /**
   * Brings a page to its top: at phone width the pages stack in one scrolling spread, so a page landed on (a
   * crosslink, a Manifest or Crew row, an entry picked from the list) is scrolled to; on the wide book it is already
   * in view. `focus` moves keyboard focus there as well.
   */
  const showPage = (sel, focus = true) => {
    const page = root?.querySelector(sel);
    if (!page) return;
    if (focus) page.focus({ preventScroll: true });
    const sp = root.querySelector('.vj-spread');
    if (sp) sp.scrollTop += page.getBoundingClientRect().top - sp.getBoundingClientRect().top;
  };

  const build = () => {
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.className = 'vj-backdrop d-none';
    root.innerHTML = `<div class="vj-book voyage-ui" role="dialog" aria-modal="true" aria-label="${esc(t('MOD_VOY_JOURNAL_TITLE'))}">`
      + '<div class="vj-spread"><section class="vj-page vj-left" tabindex="-1"></section><section class="vj-page vj-right" tabindex="-1"></section></div>'
      + `<nav class="vj-tabs" aria-label="${esc(t('MOD_VOY_JOURNAL_SECTIONS'))}">`
      + `<button type="button" class="vj-close" data-vj-close="1" aria-label="${esc(t('MOD_VOY_JOURNAL_CLOSE'))}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button>`
      + TABS.map((id) => `<button type="button" class="vj-tab vj-tab-${id}" data-vj-tab="${id}">${TAB_ICON[id]}<span class="vj-tab-name">${esc(t(TAB_KEY[id]))}</span></button>`).join('')
      + '</nav></div>';
    document.body.append(root);
    // Melvor's tooltips for every title in the book and the heat map over it (build .161).
    state.tips?.watch(root);
    // The tab tooltips come and go with the phone layout.
    window.matchMedia?.('(max-width: 899px)').addEventListener?.('change', refresh);
    root.addEventListener('click', (e) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el === null) return;
      if (el === root || el.closest('[data-vj-close]')) { close(); return; }
      const tab = el.closest('[data-vj-tab]');
      if (tab !== null) { view.tab = tab.dataset.vjTab; view.back = null; view.pick = undefined; render(); return; }
      // The Manifest (build .179): its button opens the first spread, a Crew row opens that chapter's spread.
      if (el.closest('[data-vj-manifest]')) { view.tab = 'how'; view.spread = 0; view.back = null; render(); showPage('.vj-right'); return; }
      const crewRow = el.closest('[data-vj-crew]');
      if (crewRow !== null && crewOn()) {
        const i = Number(crewRow.dataset.vjCrew);
        view.tab = 'crew'; view.crewSpread = Math.floor(i / 2); view.back = null; render();
        showPage(i % 2 === 1 ? '.vj-right' : '.vj-left'); return;
      }
      const turn = el.closest('[data-vj-turn]');
      if (turn !== null) { view[view.tab === 'crew' ? 'crewSpread' : 'spread'] += Number(turn.dataset.vjTurn); render(); return; }
      const entry = el.closest('[data-vj-entry]');
      if (entry !== null) { view.entry = entry.dataset.vjEntry; view.pick = undefined; render(); showPage('.vj-right', false); return; }
      const pl = el.closest('[data-vj-place]');
      if (pl !== null) { view.place = pl.dataset.vjPlace; render(); showPage('.vj-right', false); return; }
      const guide = el.closest('[data-vj-guide]');
      if (guide !== null) { view.guide = guide.dataset.vjGuide; view.back = null; render(); showPage('.vj-right', false); return; }
      if (el.closest('[data-vj-pick="open"]')) { view.pick = {}; render(); showPage('.vj-right'); return; }
      const src = el.closest('[data-vj-pick-source]');
      if (src !== null) { view.pick = { source: src.dataset.vjPickSource }; render(); return; }
      const psk = el.closest('[data-vj-pick-skill]');
      if (psk !== null) { view.pick = { ...view.pick, skill: psk.dataset.vjPickSkill, action: undefined }; render(); return; }
      const pac = el.closest('[data-vj-pick-action]');
      if (pac !== null) { view.pick = { ...view.pick, action: pac.dataset.vjPickAction }; render(); root.querySelector('[data-vj-pick-go]')?.focus(); return; }
      if (el.closest('[data-vj-pick-go]')) { doChart(); return; }
      if (el.closest('[data-vj-pick-cancel]')) { if (view.pick?.action !== undefined) view.pick = { ...view.pick, action: undefined }; else view.pick = undefined; render(); return; }
      const ra = el.closest('[data-vj-readall]');
      if (ra !== null) { const jr = journal(); if (jr !== undefined) { for (const k of Object.keys(jr.unread)) if (k.startsWith(ra.dataset.vjReadall)) delete jr.unread[k]; badge(); } render(); return; }
      const heat = el.closest('[data-vj-heat]');
      if (heat !== null) { openHeat(heat.dataset.vjHeat, heat); return; }
      const go = el.closest('[data-vj-go]');
      if (go !== null) { const [kind, id] = go.dataset.vjGo.split(':'); goTo(kind, id); return; }
      const map = el.closest('[data-vj-map]');
      if (map !== null) { showOnMap(map.dataset.vjMap, map.dataset.vjId); return; }
      const plan = el.closest('[data-vj-plan]');
      if (plan !== null) { planFrom(plan.dataset.vjPlan, plan.dataset.vjId); return; }
      if (el.closest('[data-vj-back]')) { const back = view.back; close(); back?.(); }
    });
    root.addEventListener('input', (e) => {
      if (!(e.target instanceof HTMLInputElement)) return;
      let list = null;
      if (e.target.id === 'vj-search') { view.query = e.target.value; list = root.querySelector('.vj-results'); if (list !== null) list.innerHTML = resultsHtml(); }
      else if (e.target.id === 'vj-place-search') { view.placeQuery = e.target.value; list = root.querySelector('.vj-place-results'); if (list !== null) list.innerHTML = placeResultsHtml(); }
      if (list !== null) { try { state.skillNames?.(list); } catch {} }
      if (e.target.id === 'vj-place-search' && isGoblinQuery(view.placeQuery)) golbinGift();
    });
    root.addEventListener('keydown', (e) => {
      const heatEl = state.heatmap?.isOpen() ? state.heatmap.element() : undefined;
      // Esc closes the Old Man's letter or the heat map first, then the book.
      if (e.key === 'Escape') { e.stopPropagation(); if (giftEl !== undefined) closeLetter(); else if (heatEl !== undefined) state.heatmap.close(); else close(); return; }
      if (e.key !== 'Tab') return;
      // Keep focus in the book while it is open (a modal dialog), or in the letter or heat map over it.
      const all = [...(giftEl ?? heatEl ?? root).querySelectorAll('button, input, a[href], canvas[tabindex]')].filter((x) => x.offsetParent !== null);
      if (all.length === 0) return;
      const first = all[0];
      const last = all[all.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  };

  let opener = null;
  /**
   * Opens the book. `tab` 'how' | 'resources' | 'places' | 'guide'; `chapter` (a Voyage page "?" topic) opens its
   * spread; `guide` opens that page; `back` (a function) adds "Back to the lock" on a guide page.
   */
  const open = ({ tab, chapter, guide, entry, back } = {}) => {
    try {
      if (journal() === undefined && tab !== 'how' && chapter === undefined) { tab = 'how'; }
      if (root === undefined) build();
      clearMarks();
      let onRight = false;
      if (chapter !== undefined) { view.tab = 'how'; const i = chapters().indexOf(chapter); view.spread = i < 0 ? 0 : jm.chapterSpread(i); onRight = i % 2 === 1; }
      else if (guide !== undefined) { view.tab = 'guide'; view.guide = guide; }
      else if (entry !== undefined) { view.tab = 'resources'; view.entry = entry; }
      else if (tab !== undefined) view.tab = TABS.includes(tab) ? tab : 'how';
      view.back = typeof back === 'function' ? back : null;
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      view.open = true;
      root.classList.remove('d-none');
      document.body.classList.add('vj-locked');
      render();
      root.querySelector('.vj-close')?.focus();
      // At phone width the pages stack: a chapter on the right page is scrolled to, not left below the other one.
      if (onRight) showPage('.vj-right', false);
    } catch (e) { log('journal open failed', e); }
  };
  function close() {
    if (root === undefined || !view.open) return;
    try { state.heatmap?.close(); } catch {}
    closeLetter();
    view.open = false;
    root.classList.add('d-none');
    document.body.classList.remove('vj-locked');
    try { opener?.focus(); } catch {}
    opener = null;
  }

  // ---------------------------------------------------------------------------------------------------- show on map
  // The entry's hexes are drawn gold on the map through the overlay (src/overlay.mjs reads state.mapMarks) until the
  // player moves or opens the journal again; the map centres on the nearest and a notice names it.
  state.mapMarks = new Set();
  function clearMarks() {
    if (state.mapMarks.size === 0) return;
    state.mapMarks.clear();
    state.overlay?.refresh();
  }
  /** Hands an entry or a place to the planner (build .119) and closes the book. */
  const planFrom = (kind, id) => {
    const pl = state.planner;
    if (pl === undefined) return;
    let target;
    if (kind === 'entry') {
      const e = entries().find((x) => x.id === id);
      if (e === undefined) return;
      target = pl.forAction(e.skillId, e.action, [], e.names[0]);
    } else {
      const p = placeList().find((x) => x.key === id);
      if (p === undefined) return;
      const area = p.group === 'combat' ? areaById(p.key.slice(p.key.indexOf('|') + 1)) : undefined;
      target = area !== undefined ? { ...pl.forArea(area), hexes: [{ q: p.q, r: p.r }] } : { name: p.name, media: p.media, hexes: [{ q: p.q, r: p.r }] };
    }
    close();
    pl.planTo(target);
  };
  const showOnMap = (kind, id) => {
    let hexes = [];
    let name = '';
    if (kind === 'entry') {
      const e = entries().find((x) => x.id === id);
      if (e === undefined) return;
      hexes = e.found.map(jm.parseHex).filter((h) => h !== undefined);
      name = e.names[0];
    } else {
      const p = placeList().find((x) => x.key === id);
      if (p === undefined) return;
      hexes = [p];
      name = p.name;
    }
    if (hexes.length === 0) return;
    const pos = state.position();
    const nearest = jm.byDistance(hexes.map((h) => jm.hexStr(h.q, h.r)), pos)[0];
    close();
    state.mapMarks.clear();
    for (const h of hexes) state.mapMarks.add(terrainMod.hexKey(h.q, h.r));
    try { state.openPage(game.pages.getObjectByID(CARTOGRAPHY_PAGE)); } catch (e) { log('journal map page failed', e); }
    whenMapReady(() => {
      state.overlay?.refresh();
      try {
        const hex = liveHex(nearest.q, nearest.r);
        if (hex !== undefined) {
          const c = cartographyMap.viewport.center;
          // A camera with no position yet can't be animated from (the game would put NaN in it): jump instead.
          if (Number.isFinite(c?.x) && Number.isFinite(c?.y) && Number.isFinite(cartographyMap.viewport.scaled)) cartographyMap.animateMoveToHex(hex, 1);
          else cartographyMap.moveToHex(hex, 1);
        }
      } catch (e) { log('journal map move failed', e); }
      notify(t('MOD_VOY_JOURNAL_MARKED', { name, at: at(nearest.q, nearest.r), where: fromHere(nearest) }));
    });
  };
  /**
   * Runs `fn` once the map page has drawn the active map at its size. The first time after a load the game sets the
   * map up asynchronously (spritesheets, then the viewport size); moving the camera before that left it at NaN, a black
   * map (seen on build .111). Gives up after about 5 s and runs `fn` anyway.
   */
  const whenMapReady = (fn, tries = 50) => {
    let ready = false;
    try {
      const vp = cartographyMap.viewport;
      ready = cartographyMap._initialized === true && cartographyMap.lastDrawnMap === game.cartography?.activeMap
        && vp?.screenWidth > 0 && vp?.screenHeight > 0;
    } catch {}
    if (ready || tries <= 0) fn(); else setTimeout(() => whenMapReady(fn, tries - 1), 100);
  };
  ctx.patch(WorldMap, 'setPlayerPosition').after(function () {
    try { if (game.cartography?.activeMap === this) clearMarks(); } catch {}
  });

  // ---------------------------------------------------------------------------------------------------- ways in
  /** The lock popup a footer link was clicked in, to open again from "Back to the lock". */
  let reopenLock = null;
  /**
   * A lock popup's footer: the guide page it teaches, written now if new ("A new page in your journal: ...").
   * `reopen` shows the popup again (the guide page's back button).
   */
  const footer = (guide, reopen) => {
    if (journal() === undefined || !model.JOURNAL_GUIDES.includes(guide)) return undefined;
    reopenLock = typeof reopen === 'function' ? reopen : null;
    const fresh = learn(guide, true);
    const text = fresh ? t('MOD_VOY_JOURNAL_FOOTER_NEW', { title: guideTitle(guide) }) : t('MOD_VOY_JOURNAL_FOOTER', { title: guideTitle(guide) });
    return `<a href="#" class="voyage-journal-footer" data-voyage-journal="${guide}"><img src="${iconUrl}" alt="">${esc(text)}</a>`;
  };
  // Footer links live inside Swal popups (not ours to wire one by one): one listener for all of them.
  document.addEventListener('click', (e) => {
    const link = e.target instanceof Element ? e.target.closest('[data-voyage-journal]') : null;
    if (link === null) return;
    e.preventDefault();
    const back = reopenLock;
    reopenLock = null;
    try { if (typeof Swal !== 'undefined') Swal.close(); } catch {}
    open({ guide: link.dataset.voyageJournal, back });
  });

  ctx.onInterfaceReady(() => {
    // The skill minibar's book button.
    try {
      const mb = game.minibar;
      const item = mb.createMinibarItem('voyage-minibar-journal', iconUrl, `<div class="text-center"><small>${esc(t('MOD_VOY_JOURNAL_TITLE'))}</small></div>`, { onClick: () => { open(); item.element.blur(); } });
      item.element.setAttribute('aria-label', t('MOD_VOY_JOURNAL_OPEN'));
      item.element.classList.add('voyage-minibar-journal');
      minibarEl = item.element;
      badge();
      mb.minibarElement?.prepend(item.element);
    } catch (e) { console.error('[Voyage] journal minibar button failed', e); }
    // The page header's book button (build .117, user ask): left of the potion and equipment buttons, in their look.
    try {
      const potions = document.getElementById('page-header-potions-dropdown')?.parentElement;
      if (potions) {
        const wrap = document.createElement('div');
        wrap.className = 'd-inline-block mr-1';
        wrap.innerHTML = `<button type="button" class="btn btn-sm btn-dual text-combat-smoke voyage-header-journal" aria-label="${esc(t('MOD_VOY_JOURNAL_OPEN'))}"><img class="skill-icon-xxs" src="${iconUrl}" alt=""></button>`;
        headerEl = wrap.firstElementChild;
        if (state.tips !== undefined) state.tips.set(headerEl, t('MOD_VOY_JOURNAL_TITLE'), { placement: 'bottom' }); else headerEl.title = t('MOD_VOY_JOURNAL_TITLE');
        headerEl.addEventListener('click', () => { open(); headerEl.blur(); });
        potions.before(wrap);
        badge();
      }
    } catch (e) { console.error('[Voyage] journal header button failed', e); }
    // Fonts for the book, bundled (assets/fonts, SIL OFL): loaded here because a CSS url() would not resolve against
    // the mod's resource URLs.
    try {
      const font = (family, file, weight, style) => `@font-face{font-family:'${family}';src:url('${ctx.getResourceUrl(`assets/fonts/${file}`)}') format('woff2');font-weight:${weight};font-style:${style};font-display:swap}`;
      const style = document.createElement('style');
      style.textContent = font('Voyage Garamond', 'EBGaramond.woff2', '400 600', 'normal') + font('Voyage Garamond', 'EBGaramond-Italic.woff2', '400', 'italic')
        + font('Voyage Fell', 'IMFellEnglish.woff2', '400', 'normal');
      document.head.append(style);
    } catch (e) { log('journal fonts failed', e); }
  });

  /** The minibar and header books show a dot while anything in the journal is unread. */
  function badge() {
    try {
      const j = journal();
      const on = j !== undefined && jm.unreadCount(j) > 0;
      minibarEl?.classList.toggle('voyage-unread', on);
      headerEl?.classList.toggle('voyage-unread', on);
    } catch {}
  }

  /** The hexes where an action was found, as { q, r } (the planner heads for the nearest, build .119). */
  const foundHexes = (actionId) => (journal()?.found[actionId] ?? []).map(jm.parseHex).filter((h) => h !== undefined);
  const api = { open, close, learn, miss, footer, iconUrl, isOpen: () => view.open, refresh, badge, foundHexes, golbinLetter: showLetter };
  state.journal = api;
  return api;
}
