// The Voyage page's block layout (build .203, the user, 18 Oct 2026: the page grows, so the blocks move and fold):
// which blocks sit in which column, in what order, and which are folded to their title row. Kept per browser, not in
// the save. Pure: no DOM, no game.

/** The page's blocks, by their `data-voyage` name, and where they start. */
// Build .205: the Errands block went into the Hold; a saved layout that still names it drops it (clean()).
// Phase 6c: the Crew block, under the ship.
export const DEFAULT = Object.freeze({ left: ['plan-block', 'hold-block'], right: ['stores-block', 'ship-block', 'crew-block'] });
export const BLOCKS = [...DEFAULT.left, ...DEFAULT.right];
export const COLUMNS = ['left', 'right'];

/**
 * A saved layout made safe: `{ left, right, folded }` with every block once, unknown names dropped, and a block the
 * saved layout doesn't have (new in a later build) put back in its default column after the blocks that come before
 * it there by default. Anything unreadable gives the default.
 */
export function clean(saved) {
  const out = { left: [], right: [], folded: [] };
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
export const isDefault = (layout) => layout.folded.length === 0 && COLUMNS.every((col) => layout[col].join() === DEFAULT[col].join());

/** `layout` with `id` folded or opened. */
export function setFolded(layout, id, folded) {
  const rest = layout.folded.filter((x) => x !== id);
  return { ...layout, folded: folded && BLOCKS.includes(id) ? [...rest, id] : rest };
}
