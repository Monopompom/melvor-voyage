// The Voyage page's blocks move and fold (build .203, the user, 18 Oct 2026: "per device with folding"). Each block's
// title row is its handle: drag it within or between the two columns (the game's own SortableJS, as the bank's
// tabs), and the caret at its left folds the block to that row. The order and the folds are kept per browser in
// localStorage, not the save; Reset layout at the page's foot puts everything back. The rules are pure
// (layout-model.mjs).

const KEY = 'voyage-page-layout';

export function install(ctx, { container, L, t, tips, log }) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cols = { left: container.querySelector('[data-voyage="col-left"]'), right: container.querySelector('[data-voyage="col-right"]') };
  if (cols.left === null || cols.right === null) return undefined;
  const block = (id) => container.querySelector(`[data-voyage="${id}"]`);
  const foot = container.querySelector('[data-voyage="layout-foot"]');

  const read = () => { try { return L.clean(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return L.clean(null); } };
  let layout = read();
  const write = () => {
    try { if (L.isDefault(layout)) localStorage.removeItem(KEY); else localStorage.setItem(KEY, JSON.stringify(layout)); } catch {}
    footNow();
  };

  // ---- folding ----------------------------------------------------------------------------------------------------
  const showFold = (id) => {
    const b = block(id);
    const btn = b?.querySelector('.voyage-block-fold');
    if (b === null || btn == null) return;
    const folded = layout.folded.includes(id);
    b.classList.toggle('voyage-folded', folded);
    btn.setAttribute('aria-expanded', `${!folded}`);
    const label = t(folded ? 'MOD_VOY_PAGE_UNFOLD' : 'MOD_VOY_PAGE_FOLD');
    btn.setAttribute('aria-label', label);
    if (tips !== undefined) tips.set(btn, label); else btn.title = label;
    btn.querySelector('i')?.classList.replace(folded ? 'fa-caret-down' : 'fa-caret-right', folded ? 'fa-caret-right' : 'fa-caret-down');
  };
  const fold = (id, folded) => { layout = L.setFolded(layout, id, folded); showFold(id); write(); };

  /** Every block's head gets its caret (left) and, with SortableJS, its grip (right). Idempotent. */
  const dress = (id) => {
    const b = block(id);
    const head = b?.querySelector('.voyage-block-head');
    if (head == null || head.querySelector('.voyage-block-fold') !== null) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'voyage-block-fold';
    btn.innerHTML = '<i class="fa fa-caret-down"></i>';
    btn.onclick = () => fold(id, !layout.folded.includes(id));
    head.prepend(btn);
    if (typeof Sortable === 'function') {
      const grip = document.createElement('span');
      grip.className = 'voyage-block-grip';
      grip.innerHTML = '<i class="fa fa-grip-vertical"></i>';
      if (tips !== undefined) tips.set(grip, t('MOD_VOY_PAGE_DRAG')); else grip.title = t('MOD_VOY_PAGE_DRAG');
      head.append(grip);
    }
    showFold(id);
  };

  // ---- order --------------------------------------------------------------------------------------------------------
  const place = () => {
    for (const col of L.COLUMNS) layout[col].forEach((id) => { const b = block(id); if (b !== null) cols[col].append(b); });
  };
  const fromPage = () => {
    const ids = (col) => [...cols[col].children].map((el) => el.dataset?.voyage).filter((id) => L.BLOCKS.includes(id));
    layout = L.clean({ left: ids('left'), right: ids('right'), folded: layout.folded });
  };

  const footNow = () => {
    if (foot === null) return;
    const show = !L.isDefault(layout);
    foot.classList.toggle('d-none', !show);
    if (show && foot.firstChild === null) {
      foot.innerHTML = `<button type="button" class="btn btn-sm btn-outline-info">${esc(t('MOD_VOY_PAGE_RESET_LAYOUT'))}</button>`;
      const btn = foot.firstChild;
      if (tips !== undefined) tips.set(btn, t('MOD_VOY_PAGE_RESET_LAYOUT_HINT')); else btn.title = t('MOD_VOY_PAGE_RESET_LAYOUT_HINT');
      btn.onclick = () => { layout = L.clean(null); place(); L.BLOCKS.forEach(showFold); write(); };
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
  const lateStart = () => {
    late = L.COLUMNS.find((c) => shown(c).length === 0 && shown(L.COLUMNS.find((o) => o !== c)).length > 0);
    if (late !== undefined) cols[late].classList.add('voyage-col-late');
  };
  const lateEnd = () => {
    if (late === undefined) return;
    cols[late].classList.remove('voyage-col-late');
    const other = L.COLUMNS.find((c) => c !== late);
    // Only the left column moves when it comes late; the right one is after the left anyway.
    if (L.COLUMNS.indexOf(late) < L.COLUMNS.indexOf(other) && shown(late).length > 0 && shown(other).length > 0) {
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
      filter: 'button, a, input, select, textarea',
      preventOnFilter: false,
      delay: 200,
      delayOnTouchOnly: (() => { try { return getSortableDelayOnTouch(); } catch { return true; } })(),
      animation: 150,
      ghostClass: 'voyage-block-ghost',
      onStart: () => { lateStart(); container.classList.add('voyage-dragging'); swipe(true); try { tippy.hideAll(); } catch {} },
      onEnd: () => { container.classList.remove('voyage-dragging'); lateEnd(); swipe(false); fromPage(); write(); },
    };
    try { L.COLUMNS.forEach((col) => new Sortable(cols[col], options)); } catch (e) { log('page drag failed', e); }
  }

  return {
    /** Opens a folded block (the planner opens the plan when it sets one). */
    unfold: (id) => { if (layout.folded.includes(id)) fold(id, false); },
  };
}
