// The Deck block on the Voyage page (design 4.33, slice 3): the deck you carry into encounters, its presets, the three
// charm slots, the ship's cards at sea and the trick book; and the deck builder, a popup of every card you may put in
// it. The kit locks while a trip is under way or a band waits (encounters.mjs kitLocked): presets can still be saved.
// The rules are src/deck-model.mjs; the save is the encounters' record (`deck`, `presets`, `charms`).

const GROUP_KEYS = {
  starter: ['MOD_VOY_DECK_GROUP_STARTER', 'MOD_VOY_DECK_GROUP_STARTER_NOTE'],
  milestone: ['MOD_VOY_DECK_GROUP_MILESTONE', 'MOD_VOY_DECK_GROUP_MILESTONE_NOTE'],
  drop: ['MOD_VOY_DECK_GROUP_DROP', 'MOD_VOY_DECK_GROUP_DROP_NOTE'],
};
const SUIT_ICON = { steel: 'fa-khanda', powder: 'fa-bomb', coin: 'fa-coins', wits: 'fa-chess-knight' };

export function install(ctx, { state, F, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fa = (icon, cls = '') => `<i class="fa ${icon}${cls ? ` ${cls}` : ''}" aria-hidden="true"></i>`;
  const api = () => state.encounters;
  const ROOT = 'voyage-deck-root';
  const skillName = (id) => { try { return game.skills.allObjects.find((s) => s.localID === id)?.name ?? id; } catch { return id; } };
  const itemOf = (id) => { try { return game.items.getObjectByID(id); } catch { return undefined; } };

  // What the page shows between redraws: a delete asked once, a refusal under the preset form.
  const ui = { delAsk: null, note: '', noteWarn: false };
  const changed = () => { api()?.redraw?.(); };

  const suitChips = (deck) => {
    const { E, D } = api();
    return D.suitCounts(deck, E).map(([s, n]) => `<span class="voyage-deck-suit voyage-enc-s-${s}" title="${esc(t(E.suitKey(s)))}">${fa(SUIT_ICON[s])} ${n}</span>`).join('');
  };

  // ---- the block -------------------------------------------------------------------------------------------------
  const section = (html) => `<div class="voyage-section">${html}</div>`;
  // No grey buttons in the block (the user): light blue unless a button says otherwise.
  const button = (act, label, { cls = 'btn-info', disabled = false, title, data = '' } = {}) =>
    `<button type="button" class="btn btn-sm ${cls}" data-voyage-deck="${act}"${data}${disabled ? ' disabled' : ''}${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;

  const deckPart = (e, locked) => {
    const { E, D } = api();
    const sea = api().shipNow();
    const shipLine = sea.cannons > 0
      ? t('MOD_VOY_DECK_SEA_CARDS', { n: `${sea.cannons}` })
      : t('MOD_VOY_DECK_SEA_NONE');
    return section(`<div class="voyage-deck-head"><span class="voyage-travel-total">${e.deck.length}</span><span class="voyage-travel-label">${esc(t('MOD_VOY_DECK_CARDS_LABEL'))}</span>`
      + `<span class="voyage-deck-suits">${suitChips(e.deck)}</span>`
      + `<span class="ml-auto voyage-deck-build">${button('build', `${fa('fa-layer-group mr-1')}${esc(t('MOD_VOY_DECK_BUILD'))}`, { cls: 'btn-primary', disabled: locked })}</span></div>`
      + (locked ? `<div class="text-warning mt-2">${fa('fa-lock mr-1')}${esc(t('MOD_VOY_DECK_LOCKED'))}</div>` : '')
      + `<small class="d-block text-muted mt-2">${esc(t('MOD_VOY_DECK_RANGE', { min: `${E.DECK_MIN}`, max: `${E.DECK_MAX}` }))} ${esc(shipLine)}</small>`);
  };

  const presetsPart = (e, locked) => {
    const { E, D } = api();
    const rows = [{ name: t('MOD_VOY_DECK_PRESET_STARTER'), deck: E.STARTER, built: true }, ...e.presets];
    const cur = rows.findLastIndex((p) => D.sameDeck(p.deck, e.deck));
    const list = rows.map((p, i) => {
      const own = i - 1;
      const acts = i === cur
        ? `<span class="voyage-travel-chip voyage-chip-ok">${fa('fa-check mr-1')}${esc(t('MOD_VOY_DECK_EQUIPPED'))}</span>`
        : button('equip', esc(t('MOD_VOY_DECK_EQUIP')), { cls: 'btn-primary', disabled: locked, data: ` data-i="${i}"` });
      const more = p.built ? '' : ui.delAsk === own
        ? `<span class="text-muted">${esc(t('MOD_VOY_DECK_DELETE_ASK'))}</span>${button('del', esc(t('MOD_VOY_DECK_YES')), { cls: 'btn-danger', data: ` data-i="${own}"` })}${button('delno', esc(t('MOD_VOY_DECK_NO')))}`
        : (i !== cur ? button('over', esc(t('MOD_VOY_DECK_SAVE_OVER')), { title: t('MOD_VOY_DECK_SAVE_OVER_TIP'), data: ` data-i="${own}"` }) : '')
          + `<button type="button" class="btn btn-sm btn-danger" data-voyage-deck="delask" data-i="${own}" aria-label="${esc(t('MOD_VOY_DECK_DELETE', { name: p.name }))}">${fa('fa-trash-alt')}</button>`;
      return `<div class="voyage-deck-preset${i === cur ? ' voyage-deck-preset-on' : ''}"><div class="voyage-deck-preset-name">${esc(p.name)}${p.built ? ` <small class="text-muted">${esc(t('MOD_VOY_DECK_PRESET_BUILT'))}</small>` : ''}</div>`
        + `<div class="voyage-deck-preset-sum"><span>${esc(t('MOD_VOY_DECK_CARDS', { n: `${p.deck.length}` }))}</span>${suitChips(p.deck)}</div>`
        + `<div class="voyage-deck-preset-act">${acts}${more}</div></div>`;
    }).join('');
    const full = e.presets.length >= D.PRESETS_MAX;
    return section(`<div class="voyage-big-head mt-0">${esc(t('MOD_VOY_DECK_PRESETS'))}</div>`
      + `<small class="d-block text-muted mb-2">${esc(t('MOD_VOY_DECK_PRESETS_NOTE', { n: `${D.PRESETS_MAX}` }))}</small>`
      + `<div class="voyage-deck-presets">${list}</div>`
      + `<form class="voyage-deck-save" data-voyage-deck-form="1"><label for="voyage-deck-name" class="text-muted mb-0">${esc(t('MOD_VOY_DECK_SAVE_AS'))}</label>`
      + `<input id="voyage-deck-name" class="form-control form-control-sm" maxlength="${D.PRESET_NAME_MAX}" placeholder="${esc(t('MOD_VOY_DECK_SAVE_PLACEHOLDER'))}" autocomplete="off">`
      + `<button type="submit" class="btn btn-sm btn-primary">${esc(t('MOD_VOY_DECK_SAVE'))}</button></form>`
      + (ui.note !== '' ? `<small class="d-block mt-1 ${ui.noteWarn ? 'text-warning' : 'text-success'}">${esc(ui.note)}</small>` : full ? `<small class="d-block text-muted mt-1">${esc(t('MOD_VOY_DECK_FULL'))}</small>` : ''));
  };

  /** A charm's picture: a trophy's own art, else the first of its items the game has, else a medal. */
  const charmIcon = (id) => {
    const { D, E } = api();
    const art = D.trophyArt(id, E);
    if (art !== undefined) return `<img class="voyage-deck-charm-icon" src="${esc(ctx.getResourceUrl(art))}" alt="">`;
    for (const item of D.CHARM_ITEMS[id] ?? []) { const it = itemOf(item); if (it !== undefined) return `<img class="voyage-deck-charm-icon" src="${it.media}" alt="">`; }
    return `<span class="voyage-deck-charm-icon voyage-deck-charm-fa">${fa('fa-medal')}</span>`;
  };
  const charmRow = (id, acts, warn = '') => {
    const { E } = api();
    return `<div class="voyage-deck-charm">${charmIcon(id)}<div class="voyage-deck-charm-text"><div class="voyage-deck-charm-name${E.CHARMS[id]?.trophy !== undefined ? ' voyage-deck-charm-trophy' : ''}">${esc(t(E.charmKey(id)))}</div>`
      + `<small class="d-block">${esc(t(E.charmTextKey(id)))}</small>${warn}</div><div class="voyage-deck-charm-act">${acts}</div></div>`;
  };
  const charmsPart = (e, locked) => {
    const { E, D } = api();
    const have = api().have();
    const slotted = e.charms.map((id) => charmRow(id, button('unslot', esc(t('MOD_VOY_DECK_UNSLOT')), { cls: 'btn-warning', disabled: locked, data: ` data-id="${id}"` }),
      D.charmOwned(id, have, E) ? '' : `<small class="d-block text-warning">${esc(t('MOD_VOY_DECK_CHARM_NOT_OWNED'))}</small>`)).join('');
    const free = Object.keys(E.CHARMS).filter((id) => !e.charms.includes(id) && D.charmOwned(id, have, E));
    const full = e.charms.length >= D.CHARM_SLOTS;
    return section(`<div class="voyage-big-head mt-0">${esc(t('MOD_VOY_DECK_CHARMS'))} <small class="text-muted ml-2">${esc(t('MOD_VOY_DECK_CHARM_SLOTS', { n: `${e.charms.length}`, max: `${D.CHARM_SLOTS}` }))}</small></div>`
      + `<small class="d-block text-muted mb-2">${esc(t('MOD_VOY_DECK_CHARMS_NOTE'))}</small>`
      + slotted
      + (free.length > 0
        ? `<div class="voyage-deck-sub">${esc(t('MOD_VOY_DECK_CHARMS_FREE'))}</div>` + free.map((id) => charmRow(id, button('slot', esc(t('MOD_VOY_DECK_SLOT')), { cls: 'btn-primary', disabled: locked || full, data: ` data-id="${id}"` }))).join('')
        : e.charms.length === 0 ? `<small class="d-block text-muted">${esc(t('MOD_VOY_DECK_CHARMS_NONE'))}</small>` : ''));
  };

  const tricksPart = (e) => {
    const { E } = api();
    const all = Object.keys(E.TRICKS);
    const found = all.filter((id) => e.tricks.includes(id));
    const rows = found.map((id) => `<div class="voyage-deck-trick"><span class="voyage-deck-trick-name">${esc(t(E.trickKey(id)))}</span><span>${F.seqHtml(api(), E.TRICKS[id])}</span><span class="text-muted">${esc(t(E.trickTextKey(id)))}</span></div>`).join('');
    return section(`<div class="voyage-big-head mt-0">${esc(t('MOD_VOY_DECK_TRICKS'))} <small class="text-muted ml-2">${esc(t('MOD_VOY_DECK_TRICKS_COUNT', { found: `${found.length}`, all: `${all.length}` }))}</small></div>`
      + `<small class="d-block text-muted mb-2">${esc(t('MOD_VOY_DECK_TRICKS_NOTE'))}</small>`
      + (rows !== '' ? `<div class="voyage-deck-tricks">${rows}</div>` : `<small class="d-block text-muted">${esc(t('MOD_VOY_DECK_TRICKS_NONE'))}</small>`));
  };

  /** The block's inside, or '' with no save to read. */
  const html = () => {
    const e = api()?.enc?.();
    if (e === undefined) return '';
    const locked = api().kitLocked();
    return deckPart(e, locked) + presetsPart(e, locked) + charmsPart(e, locked) + tricksPart(e);
  };
  /** The folded block's title row: the deck's size and the charms slotted. */
  const sum = () => {
    const e = api()?.enc?.();
    if (e === undefined) return '';
    const n = `${e.deck.length}`;
    return e.charms.length === 0 ? t('MOD_VOY_DECK_CARDS', { n }) : e.charms.length === 1 ? t('MOD_VOY_DECK_SUM_ONE', { n }) : t('MOD_VOY_DECK_SUM', { n, charms: `${e.charms.length}` });
  };

  // ---- what the block's buttons do -------------------------------------------------------------------------------
  const say = (note, warn = false) => { ui.note = note; ui.noteWarn = warn; };
  const refuseLocked = () => { api().notify(t('MOD_VOY_DECK_LOCKED')); return false; };
  const equipDeck = (deck) => {
    const { E, D } = api();
    const e = api().enc();
    if (api().kitLocked()) return refuseLocked();
    const fit = D.fitDeck(deck, api().have(), E);
    if (fit.length < E.DECK_MIN) { say(t('MOD_VOY_DECK_EQUIP_SHORT', { n: `${fit.length}`, min: `${E.DECK_MIN}` }), true); return false; }
    e.deck = fit;
    return true;
  };
  const onAction = (b) => {
    const a = b.dataset.voyageDeck;
    const e = api()?.enc?.();
    if (e === undefined) return;
    const { E, D } = api();
    const i = Number(b.dataset.i);
    ui.note = '';
    if (a === 'build') { if (!api().kitLocked()) openBuilder(); else refuseLocked(); return; }
    if (a === 'equip') equipDeck(i === 0 ? E.STARTER : e.presets[i - 1]?.deck ?? []);
    else if (a === 'over' && e.presets[i] !== undefined) { e.presets = D.savePreset(e.presets, e.presets[i].name, e.deck, E).presets; say(t('MOD_VOY_DECK_SAVED', { name: e.presets[i].name })); }
    else if (a === 'delask') ui.delAsk = i;
    else if (a === 'delno') ui.delAsk = null;
    else if (a === 'del') { e.presets = e.presets.filter((_, k) => k !== i); ui.delAsk = null; }
    else if (a === 'slot') { if (api().kitLocked()) refuseLocked(); else if (e.charms.length < D.CHARM_SLOTS && !e.charms.includes(b.dataset.id)) e.charms = [...e.charms, b.dataset.id]; }
    else if (a === 'unslot') { if (api().kitLocked()) refuseLocked(); else e.charms = e.charms.filter((id) => id !== b.dataset.id); }
    else return;
    if (a !== 'delask') ui.delAsk = null;
    changed();
  };
  const onSave = (form) => {
    const e = api()?.enc?.();
    if (e === undefined) return;
    const { E, D } = api();
    const input = form.querySelector('input');
    const name = input?.value ?? '';
    input?.blur(); // the page holds its redraw while a box has focus
    const r = D.savePreset(e.presets, name, e.deck, E);
    if (r.ok) { e.presets = r.presets; say(t('MOD_VOY_DECK_SAVED', { name: D.presetName(name) })); }
    else say(t(r.why === 'full' ? 'MOD_VOY_DECK_FULL' : r.why === 'name' ? 'MOD_VOY_DECK_NAME_EMPTY' : 'MOD_VOY_DECK_SIZE'), true);
    changed();
  };
  /** Listens on the block's part once (it is redrawn as innerHTML). */
  const bind = (el) => {
    if (el === null || el.dataset.voyageDeckBound === '1') return;
    el.dataset.voyageDeckBound = '1';
    el.addEventListener('click', (ev) => {
      const b = ev.target instanceof Element ? ev.target.closest('[data-voyage-deck]') : null;
      if (b !== null && !b.disabled) { try { onAction(b); } catch (err) { log('deck action failed', err); } }
    });
    el.addEventListener('submit', (ev) => {
      const f = ev.target instanceof Element ? ev.target.closest('[data-voyage-deck-form]') : null;
      if (f === null) return;
      ev.preventDefault();
      try { onSave(f); } catch (err) { log('preset save failed', err); }
    });
  };

  // ---- the deck builder ------------------------------------------------------------------------------------------
  let draft = null;
  const builderHtml = () => {
    const { E, D } = api();
    const have = api().have();
    const n = draft.length;
    const ok = D.deckOk(draft, have, E);
    const groups = D.GROUPS.map((src) => {
      const [title, note] = GROUP_KEYS[src];
      const ids = D.groupCards(src, E);
      const cells = ids.map((id) => {
        const c = E.CARDS[id];
        const cap = D.capOf(id, have, E);
        const k = draft.filter((x) => x === id).length;
        const name = t(E.cardKey(id));
        const lockLine = cap === 0 && c.src === 'milestone' ? `<small class="voyage-deck-pick-lock">${fa('fa-lock mr-1')}${esc(skillName(c.skill))} ${c.lvl}</small>` : '';
        return `<div class="voyage-deck-pick${cap === 0 && k === 0 ? ' voyage-deck-pick-off' : ''}">${F.cardFace(api(), id)}${lockLine}`
          + `<div class="voyage-deck-stepper"><button type="button" class="btn btn-sm btn-outline-secondary" data-act="dec" data-id="${id}"${k > 0 ? '' : ' disabled'} aria-label="${esc(t('MOD_VOY_DECK_ONE_FEWER', { name }))}">−</button>`
          + `<span class="voyage-enc-num">${k} / ${cap}</span>`
          + `<button type="button" class="btn btn-sm btn-outline-secondary" data-act="inc" data-id="${id}"${k < cap && n < E.DECK_MAX ? '' : ' disabled'} aria-label="${esc(t('MOD_VOY_DECK_ONE_MORE', { name }))}">+</button></div></div>`;
      }).join('');
      return `<div class="voyage-deck-group"><div class="voyage-big-head">${esc(t(title))}</div><small class="d-block text-muted mb-2">${esc(t(note))}</small><div class="voyage-deck-grid">${cells}</div></div>`;
    }).join('');
    const ship = `<div class="voyage-deck-group"><div class="voyage-big-head">${esc(t('MOD_VOY_DECK_GROUP_SHIP'))}</div><small class="d-block text-muted mb-2">${esc(t('MOD_VOY_DECK_GROUP_SHIP_NOTE'))}</small>`
      + `<div class="voyage-deck-grid">${['broadside', 'brace'].map((id) => `<div class="voyage-deck-pick">${F.cardFace(api(), id)}</div>`).join('')}</div></div>`;
    const bad = n < E.DECK_MIN || n > E.DECK_MAX;
    return `<div class="voyage-enc-head"><span class="voyage-enc-title">${esc(t('MOD_VOY_DECK_B_TITLE'))}</span>`
      + `<span class="voyage-enc-chip ${bad ? 'voyage-deck-count-bad' : 'voyage-deck-count-ok'}">${esc(t('MOD_VOY_DECK_CARDS', { n: `${n}` }))}</span>`
      + `<span class="voyage-deck-suits">${suitChips(draft)}</span>`
      + `<small class="text-muted">${esc(t('MOD_VOY_DECK_RANGE', { min: `${E.DECK_MIN}`, max: `${E.DECK_MAX}` }))}</small></div>`
      + `<div class="voyage-enc-body">${groups}${ship}</div>`
      + `<div class="voyage-enc-actions">`
      + `<button type="button" class="btn btn-sm btn-primary voyage-enc-btn" data-act="equip"${ok ? '' : ' disabled'}><span>${fa('fa-check')} ${esc(t('MOD_VOY_DECK_B_EQUIP'))}</span></button>`
      + `<button type="button" class="btn btn-sm btn-warning voyage-enc-btn" data-act="reset"><span>${fa('fa-undo')} ${esc(t('MOD_VOY_DECK_B_RESET'))}</span></button>`
      + `<button type="button" class="btn btn-sm btn-danger voyage-enc-btn voyage-deck-cancel" data-act="cancel"><span>${esc(t('MOD_VOY_DECK_B_CANCEL'))}</span></button></div>`;
  };
  const drawBuilder = () => {
    const el = document.getElementById(ROOT);
    if (el === null || draft === null) return;
    const body = el.querySelector('.voyage-enc-body');
    const top = body?.scrollTop ?? 0;
    el.innerHTML = builderHtml();
    const nb = el.querySelector('.voyage-enc-body');
    if (nb !== null) nb.scrollTop = top;
  };
  const onBuilder = (ev) => {
    const b = ev.target instanceof Element ? ev.target.closest('[data-act]') : null;
    if (b === null || b.disabled) return;
    const { E, D } = api();
    const a = b.dataset.act;
    if (a === 'inc') draft = D.addCard(draft, b.dataset.id, api().have(), E);
    else if (a === 'dec') draft = D.removeCard(draft, b.dataset.id);
    else if (a === 'reset') draft = E.STARTER.slice();
    else if (a === 'cancel') { draft = null; Swal.close(); return; }
    else if (a === 'equip') {
      if (D.deckOk(draft, api().have(), E) && equipDeck(draft)) { draft = null; Swal.close(); changed(); }
      return;
    }
    drawBuilder();
  };
  const openBuilder = () => {
    const e = api()?.enc?.();
    if (e === undefined) return;
    draft = e.deck.slice();
    const cls = { container: 'voyage-enc-backdrop', popup: 'voyage-ui voyage-enc-popup voyage-deck-popup', htmlContainer: 'voyage-enc-html' };
    SwalLocale.fire({
      html: `<div id="${ROOT}" class="voyage-enc voyage-deck"></div>`,
      width: F.POPUP_WIDTH,
      showConfirmButton: false,
      customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass(cls) : cls,
      didRender: state.popupDidRender,
      didOpen: () => {
        const el = document.getElementById(ROOT);
        if (el === null) return;
        el.addEventListener('click', (ev) => { try { onBuilder(ev); } catch (err) { log('deck builder failed', err); } });
        drawBuilder();
      },
    }).then(() => { draft = null; }, () => { draft = null; });
  };

  return { html, sum, bind, openBuilder };
}
