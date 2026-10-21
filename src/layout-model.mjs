// The Voyage page's block layout (build .203, the user, 18 Oct 2026: the page grows, so the blocks move and fold):
// which blocks sit in which column, in what order, and which are folded to their title row. Kept per browser, not in
// the save. Pure: no DOM, no game.

/** The page's blocks, by their `data-voyage` name, and where they start. */
// Build .205: the Errands block went into the Hold; a saved layout that still names it drops it (clean()).
// Phase 6c: the Crew block, under the ship.
// Build .353 (the user, 20 Oct 2026: "a place for full-width panel placement"): a full-width row above the two columns
// and one below them, empty by default.
// Build .367 (the user approved the canvas "Voyage page: panels and default layout", 21 Oct 2026): by weight and use,
// the plan and the crew on the left, the stores, the hold and the ship on the right; the hold and the ship start folded
// (their title rows say what they hold).
export const DEFAULT = Object.freeze({ top: [], left: ['plan-block', 'crew-block'], right: ['stores-block', 'hold-block', 'ship-block'], bottom: [] });
export const DEFAULT_FOLDED = Object.freeze(['hold-block', 'ship-block']);
export const BLOCKS = [...DEFAULT.left, ...DEFAULT.right];
/** Every place a block can sit, in page order; SIDES are the two half-width columns. */
export const COLUMNS = ['top', 'left', 'right', 'bottom'];
export const SIDES = ['left', 'right'];

/**
 * A saved layout made safe: `{ top, left, right, bottom, folded }` with every block once, unknown names dropped, and a block the
 * saved layout doesn't have (new in a later build) put back in its default column after the blocks that come before
 * it there by default. Anything unreadable gives the default.
 */
export function clean(saved) {
  const out = { top: [], left: [], right: [], bottom: [], folded: [...DEFAULT_FOLDED] };
  const seen = new Set();
  if (saved !== null && typeof saved === 'object') {
    for (const col of COLUMNS) {
      if (!Array.isArray(saved[col])) continue;
      for (const id of saved[col]) {
        if (!BLOCKS.includes(id) || seen.has(id)) continue;
        seen.add(id);
        out[col].push(id);
      }
    }
    if (Array.isArray(saved.folded)) out.folded = [...new Set(saved.folded.filter((id) => BLOCKS.includes(id)))];
  }
  for (const col of COLUMNS) {
    DEFAULT[col].forEach((id, i) => {
      if (seen.has(id)) return;
      seen.add(id);
      // After the last of its default predecessors that sits in this column, else first.
      const before = DEFAULT[col].slice(0, i).filter((p) => out[col].includes(p));
      const at = before.length === 0 ? 0 : out[col].indexOf(before[before.length - 1]) + 1;
      out[col].splice(at, 0, id);
    });
  }
  return out;
}

/** True when `layout` (cleaned) is the default: the default orders and nothing folded. */
export const isDefault = (layout) => layout.folded.length === DEFAULT_FOLDED.length && DEFAULT_FOLDED.every((id) => layout.folded.includes(id))
  && COLUMNS.every((col) => layout[col].join() === DEFAULT[col].join());

/** `layout` with `id` folded or opened. */
export function setFolded(layout, id, folded) {
  const rest = layout.folded.filter((x) => x !== id);
  return { ...layout, folded: folded && BLOCKS.includes(id) ? [...rest, id] : rest };
}

/**
 * The phone's single column (build .367): the two columns taken in turn, left then right, so the blocks come by weight
 * (Plan, Stores, Crew, Hold, Ship by default); the row above first, the row below last.
 */
export function phoneOrder(layout) {
  const out = [...layout.top];
  for (let i = 0; i < Math.max(layout.left.length, layout.right.length); i++) {
    if (layout.left[i] !== undefined) out.push(layout.left[i]);
    if (layout.right[i] !== undefined) out.push(layout.right[i]);
  }
  return [...out, ...layout.bottom];
}

/**
 * The layout as shown (build .367): with no vessel yet and the layout as it came, the Ship block (where the dinghy is
 * built) leads the right column, open. A layout you have changed is shown as it is.
 */
export function situated(layout, { noVessel = false } = {}) {
  if (!noVessel || !isDefault(layout)) return layout;
  return { ...layout, right: ['ship-block', ...layout.right.filter((id) => id !== 'ship-block')], folded: layout.folded.filter((id) => id !== 'ship-block') };
}

const columnOf = (layout, id) => COLUMNS.find((col) => layout[col].includes(id));
/**
 * The moves a block can make from the keyboard (build .367; dragging takes a pointer): 'up' and 'down' within its
 * column or row, 'side' to the other column (from a row across the page: the left column), 'wide' to the row above
 * the columns.
 */
export function movesFor(layout, id) {
  const col = columnOf(layout, id);
  if (col === undefined) return [];
  const i = layout[col].indexOf(id);
  const moves = [];
  if (i > 0) moves.push('up');
  if (i < layout[col].length - 1) moves.push('down');
  moves.push('side');
  if (SIDES.includes(col)) moves.push('wide');
  return moves;
}
/** `layout` with `id` moved ('up', 'down', 'side', 'wide'); the same layout when that move isn't open to it. */
export function moveBlock(layout, id, how) {
  if (!movesFor(layout, id).includes(how)) return layout;
  const col = columnOf(layout, id);
  const out = { ...layout, ...Object.fromEntries(COLUMNS.map((c) => [c, [...layout[c]]])) };
  const list = out[col];
  const i = list.indexOf(id);
  if (how === 'up' || how === 'down') {
    const j = how === 'up' ? i - 1 : i + 1;
    [list[i], list[j]] = [list[j], list[i]];
    return out;
  }
  list.splice(i, 1);
  const to = how === 'wide' ? 'top' : col === 'left' ? 'right' : 'left';
  out[to].push(id);
  return out;
}
