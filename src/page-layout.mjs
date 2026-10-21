// The Voyage page's blocks move and fold (build .203, the user, 18 Oct 2026: "per device with folding"). Each block's
// title row is its handle: drag it within or between the two columns (the game's own SortableJS, as the bank's
// tabs), or (build .353) into a row across the whole page above or below them; the caret at its left folds the block
// to that row. The order and the folds are kept per browser in
// localStorage, not the save; Reset layout at the page's foot puts everything back. The rules are pure
// (layout-model.mjs).

const KEY = 'voyage-page-layout';

export function install(ctx, { container, L, t, tips, log }) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cols = Object.fromEntries(L.COLUMNS.map((col) => [col, container.querySelector(`[data-voyage="col-${col}"]`)]));
  if (L.COLUMNS.some((col) => cols[col] === null)) return undefined;
  // The full-width rows name themselves while a drag shows them empty.
  for (const col of L.COLUMNS) if (!L.SIDES.includes(col)) cols[col].dataset.dropLabel = t('MOD_VOY_PAGE_DROP_WIDE');
  const block = (id) => container.querySelector(`[data-voyage="${id}"]`);
  const foot = container.querySelector('[data-voyage="layout-foot"]');

  const read = () => { try { return L.clean(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return L.clean(null); } };
  let layout = read();
  // What the page is in (build .367): with no vessel yet the Ship block leads, while the layout is untouched.
  let noVessel = false;
  const shownLayout = () => L.situated(layout, { noVessel });
  const write = () => {
    try { if (L.isDefault(layout)) localStorage.removeItem(KEY); else localStorage.setItem(KEY, JSON.stringify(layout)); } catch {}
    footNow();
  };

  // ---- folding ----------------------------------------------------------------------------------------------------
  const showFold = (id) => {
    const b = block(id);
    const btn = b?.querySelector('.voyage-block-fold');
    if (b === null || btn == null) return;
    const folded = shownLayout().folded.includes(id);
    b.classList.toggle('voyage-folded', folded);
    btn.setAttribute('aria-expanded', `${!folded}`);
    const name = b.querySelector('.voyage-block-head h5, .voyage-block-head h6')?.querySelector('lang-string, span')?.textContent.trim() ?? '';
    const label = name === '' ? t(folded ? 'MOD_VOY_PAGE_UNFOLD' : 'MOD_VOY_PAGE_FOLD') : t(folded ? 'MOD_VOY_PAGE_UNFOLD_OF' : 'MOD_VOY_PAGE_FOLD_OF', { name }); // the block's name (.308, A-17)
    btn.setAttribute('aria-label', label);
    if (tips !== undefined) tips.set(btn, label); else btn.title = label;
    btn.querySelector('i')?.classList.replace(folded ? 'fa-caret-down' : 'fa-caret-right', folded ? 'fa-caret-right' : 'fa-caret-down');
  };
  const fold = (id, folded) => { layout = L.setFolded(shownLayout(), id, folded); showFold(id); write(); };

  /** Every block's head gets its caret (left) and, with SortableJS, its grip (right). Idempotent. */
  const nameOf = (id) => block(id)?.querySelector('.voyage-block-head h5, .voyage-block-head h6')?.querySelector('lang-string, span')?.textContent.trim() ?? '';

  // ---- moving from the keyboard (build .367) -------------------------------------------------------------------------
  let menu = null;
  const closeMoves = (focusGrip) => {
    if (menu === null) return;
    const { el, grip } = menu;
    menu = null;
    el.remove();
    grip.setAttribute('aria-expanded', 'false');
    if (focusGrip) grip.focus({ preventScroll: true });
  };
  const MOVE_KEYS = { up: 'MOD_VOY_PAGE_MOVE_UP', down: 'MOD_VOY_PAGE_MOVE_DOWN', side: 'MOD_VOY_PAGE_MOVE_SIDE', wide: 'MOD_VOY_PAGE_MOVE_WIDE' };
  const openMoves = (id, grip) => {
    const again = menu?.grip === grip;
    closeMoves(false);
    if (again) return;
    const el = document.createElement('div');
    el.className = 'voyage-move-menu';
    el.setAttribute('role', 'menu');
    el.innerHTML = L.movesFor(shownLayout(), id).map((how) => `<button type="button" role="menuitem" data-move="${how}">${esc(t(MOVE_KEYS[how]))}</button>`).join('');
    el.onclick = (e) => {
      const how = e.target instanceof Element ? e.target.closest('[data-move]')?.dataset.move : undefined;
      if (how === undefined) return;
      e.stopPropagation();
      closeMoves(false);
      layout = L.moveBlock(shownLayout(), id, how);
      place();
      write();
      block(id)?.querySelector('.voyage-block-grip')?.focus({ preventScroll: true });
    };
    el.onkeydown = (e) => {
      const items = [...el.querySelectorAll('[data-move]')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); closeMoves(true); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
      else if (e.key === 'Tab') closeMoves(false);
    };
    grip.after(el);
    // Opens upward when the screen has no room below it (the last block on the page).
    if (el.getBoundingClientRect().bottom > window.innerHeight) el.classList.add('voyage-move-menu-up');
    grip.setAttribute('aria-expanded', 'true');
    menu = { el, grip };
    el.querySelector('[data-move]')?.focus({ preventScroll: true });
  };
  document.addEventListener('click', (e) => { if (menu !== null && !(e.target instanceof Element && menu.el.contains(e.target))) closeMoves(false); });

  const dress = (id) => {
    const b = block(id);
    const head = b?.querySelector('.voyage-block-head');
    if (head == null || head.querySelector('.voyage-block-fold') !== null) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'voyage-block-fold';
    btn.innerHTML = '<i class="fa fa-caret-down"></i>';
    btn.onclick = () => fold(id, !shownLayout().folded.includes(id));
    // Folded, the title row's summary is read with the caret (build .367).
    if (b.querySelector(`#voyage-sum-${id}`) !== null) btn.setAttribute('aria-describedby', `voyage-sum-${id}`);
    head.prepend(btn);
    // The grip drags the block and, pressed (build .367: dragging takes a pointer), opens its moves.
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'voyage-block-grip';
    grip.innerHTML = '<i class="fa fa-grip-vertical" aria-hidden="true"></i>';
    grip.setAttribute('aria-haspopup', 'menu');
    grip.setAttribute('aria-expanded', 'false');
    grip.setAttribute('aria-label', t('MOD_VOY_PAGE_MOVE_MENU', { name: nameOf(id) }));
    if (tips !== undefined) tips.set(grip, t('MOD_VOY_PAGE_DRAG')); else grip.title = t('MOD_VOY_PAGE_DRAG');
    grip.onclick = (e) => { e.stopPropagation(); openMoves(id, grip); };
    head.append(grip);
    showFold(id);
  };

  // ---- order --------------------------------------------------------------------------------------------------------
  const place = () => {
    const shown = shownLayout();
    for (const col of L.COLUMNS) shown[col].forEach((id) => { const b = block(id); if (b !== null) cols[col].append(b); });
    // On a phone the columns are one, in turn (build .367): each block's place in it.
    L.phoneOrder(shown).forEach((id, i) => block(id)?.style.setProperty('--voyage-phone-order', `${i + 1}`));
  };
  const fromPage = () => {
    const ids = (col) => [...cols[col].children].map((el) => el.dataset?.voyage).filter((id) => L.BLOCKS.includes(id));
    layout = L.clean({ ...Object.fromEntries(L.COLUMNS.map((col) => [col, ids(col)])), folded: layout.folded });
  };

  const footNow = () => {
    if (foot === null) return;
    const show = !L.isDefault(layout);
    foot.classList.toggle('d-none', !show);
    if (show && foot.firstChild === null) {
      foot.innerHTML = `<button type="button" class="btn btn-sm btn-outline-info">${esc(t('MOD_VOY_PAGE_RESET_LAYOUT'))}</button>`;
      const btn = foot.firstChild;
      if (tips !== undefined) tips.set(btn, t('MOD_VOY_PAGE_RESET_LAYOUT_HINT')); else btn.title = t('MOD_VOY_PAGE_RESET_LAYOUT_HINT');
      btn.onclick = () => { layout = L.clean(null); place(); L.BLOCKS.forEach(showFold); write(); try { document.querySelector('#voyage-container .voyage-block-fold')?.focus({ preventScroll: true }); } catch {} }; // (.308, A2-31)
    }
  };

  place();
  L.BLOCKS.forEach(dress);
  footNow();

  // Build .204 (found in game): a column with no block showing is hidden, and on a drag it came back FIRST in the row,
  // so the blocks shifted right under the pointer and every drag fell into it (no reordering within the column). Now
  // a column empty when the drag starts shows after the other (`voyage-col-late`), and a block dropped into it keeps
  // its side: the two columns swap their shown blocks, so what was on the left stays on the left.
  const shown = (col) => [...cols[col].children].filter((el) => el.classList.contains('voyage-block') && !el.classList.contains('d-none'));
  let late;
  // Build .353: the empty row above the columns opens when a drag starts and would push everything down under the
  // pointer, so the page scrolls by as much and the dragged block stays where it was.
  const scroller = () => {
    for (let el = container.parentElement; el !== null; el = el.parentElement) {
      const y = getComputedStyle(el).overflowY;
      if ((y === 'auto' || y === 'scroll') && el.scrollHeight > el.clientHeight) return el;
    }
    return document.scrollingElement;
  };
  const steady = (change) => {
    const mark = cols.left.getBoundingClientRect().top;
    change();
    const moved = cols.left.getBoundingClientRect().top - mark;
    if (moved !== 0) { const el = scroller(); if (el != null) el.scrollTop += moved; }
  };
  const lateStart = () => {
    late = L.SIDES.find((c) => shown(c).length === 0 && shown(L.SIDES.find((o) => o !== c)).length > 0);
    if (late !== undefined) cols[late].classList.add('voyage-col-late');
  };
  const lateEnd = () => {
    if (late === undefined) return;
    cols[late].classList.remove('voyage-col-late');
    const other = L.SIDES.find((c) => c !== late);
    // Only the left column moves when it comes late; the right one is after the left anyway.
    if (L.SIDES.indexOf(late) < L.SIDES.indexOf(other) && shown(late).length > 0 && shown(other).length > 0) {
      const mine = shown(late);
      const theirs = shown(other);
      theirs.forEach((b) => cols[late].append(b));
      mine.forEach((b) => cols[other].append(b));
    }
    late = undefined;
  };

  if (typeof Sortable === 'function') {
    const swipe = (on) => { try { if (typeof disableSwipeEvents !== 'undefined') disableSwipeEvents = on; } catch {} };
    const options = {
      group: 'voyage-page-blocks',
      handle: '.voyage-block-head',
      draggable: '.voyage-block',
      // The caret, "?" and anything else to press in a title row never starts a drag.
      filter: 'button:not(.voyage-block-grip), a, input, select, textarea',
      preventOnFilter: false,
      delay: 200,
      delayOnTouchOnly: (() => { try { return getSortableDelayOnTouch(); } catch { return true; } })(),
      animation: 150,
      ghostClass: 'voyage-block-ghost',
      onStart: () => { closeMoves(false); steady(() => { lateStart(); container.classList.add('voyage-dragging'); }); swipe(true); try { tippy.hideAll(); } catch {} },
      onEnd: () => { steady(() => { container.classList.remove('voyage-dragging'); lateEnd(); }); swipe(false); fromPage(); write(); },
    };
    try { L.COLUMNS.forEach((col) => new Sortable(cols[col], options)); } catch (e) { log('page drag failed', e); }
  }

  return {
    /** Opens a folded block (the planner opens the plan when it sets one). */
    unfold: (id) => { if (shownLayout().folded.includes(id)) fold(id, false); },
    /** The page's state (build .367): `noVessel` while there is no vessel yet. Redraws only on a change. */
    situate: ({ noVessel: nv }) => {
      if (nv === noVessel) return;
      noVessel = nv;
      place();
      L.BLOCKS.forEach(showFold);
    },
    /** True while `id` is folded on the page. */
    folded: (id) => shownLayout().folded.includes(id),
  };
}
