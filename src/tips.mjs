// Melvor's own tooltips (tippy) instead of the browser's `title` boxes (the user, build .160). After a
// part of the page or the Here panel redraws, apply(root) turns every `title` under it into a tippy tooltip, plain
// text, no pictures (the user, build .161); an item icon carries `data-tip-item="<item id>"` and shows the item's name
// (its title text when it has one, e.g. "Normal Logs: 1 fuel each"). watch(root) applies them whenever root changes
// (the journal); set(el, text) gives one element its tooltip (the sidebar). Buttons that act on a tap show theirs on
// press-and-hold on a phone (`touch: 'hold'`). Tooltips of elements a redraw removed are destroyed.
// `data-tip-lines` (build .167, the user): a JSON list of lines, each a string or `{ text, cls }`, one line each; `cls`
// colours it (a buff in the game's green). Built as text, never as HTML.

export function install(ctx, { log }) {
  const live = new Set();

  const contentOf = (el, text) => {
    if (text) return text;
    try { return game.items.getObjectByID(el.dataset.tipItem)?.name ?? ''; } catch { return ''; }
  };

  // Text with line breaks keeps them (a list of buffs, one per line).
  const body = (text) => {
    if (!text.includes('\n')) return text;
    const div = document.createElement('div');
    div.style.whiteSpace = 'pre-line';
    div.textContent = text;
    return div;
  };

  const linesOf = (el) => {
    try { const v = JSON.parse(el.dataset.tipLines ?? ''); return Array.isArray(v) && v.length > 0 ? v : undefined; } catch { return undefined; }
  };
  const linesBody = (lines) => {
    const div = document.createElement('div');
    for (const line of lines) {
      const row = document.createElement('div');
      if (typeof line === 'string') row.textContent = line;
      else { row.textContent = line?.text ?? ''; if (line?.cls) row.className = line.cls; }
      div.append(row);
    }
    return div;
  };

  const make = (el, content, opts = {}) => {
    const inst = tippy(el, {
      content: Array.isArray(content) ? linesBody(content) : body(content), placement: 'top', interactive: false, animation: false,
      touch: el.matches('button, [role="button"], a') ? 'hold' : true, ...opts,
    });
    live.add(inst);
    return inst;
  };

  /** Turns the `title`s under `root` (and on it) into Melvor tooltips. */
  const apply = (root) => {
    if (root == null || typeof tippy !== 'function') return;
    for (const inst of [...live]) {
      if (!inst.reference.isConnected) { try { inst.destroy(); } catch {} live.delete(inst); }
    }
    const sel = '[title], [data-tip-item], [data-tip-lines]';
    const els = [...(root.matches?.(sel) ? [root] : []), ...root.querySelectorAll(sel)];
    for (const el of els) {
      const lines = linesOf(el);
      if (lines !== undefined) {
        el.removeAttribute('title');
        if (el._tippy === undefined) { try { make(el, lines); el.dataset.tipShown = el.dataset.tipLines; } catch (e) { log('tooltip failed', e); } }
        else if (el.dataset.tipShown !== el.dataset.tipLines) { el._tippy.setContent(linesBody(lines)); el.dataset.tipShown = el.dataset.tipLines; }
        continue;
      }
      const fresh = el.getAttribute('title');
      if (fresh !== null) { el.removeAttribute('title'); el.dataset.tipText = fresh; }
      const text = el.dataset.tipText ?? '';
      const tip = el._tippy;
      const content = contentOf(el, text);
      if (content === '') { if (tip !== undefined) { tip.destroy(); live.delete(tip); } continue; }
      if (tip !== undefined) { if (fresh !== null) tip.setContent(body(content)); continue; }
      try { make(el, content); } catch (e) { log('tooltip failed', e); }
    }
  };

  /** Applies the tooltips under `root` now and after every change in it (a frame later, once per frame). */
  const watch = (root) => {
    if (root == null || typeof MutationObserver !== 'function') return;
    let queued = false;
    const run = () => { queued = false; try { apply(root); } catch (e) { log('tooltips failed', e); } };
    new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } })
      .observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });
    run();
  };

  /** One element's tooltip: `text` ('' removes it); falls back to `title` without tippy. */
  const set = (el, text, opts) => {
    if (el == null) return;
    if (typeof tippy !== 'function') { el.title = text; return; }
    if (el.dataset.tipText === text && (text === '' || el._tippy !== undefined)) return;
    el.dataset.tipText = text;
    const tip = el._tippy;
    if (text === '') { if (tip !== undefined) { tip.destroy(); live.delete(tip); } return; }
    if (tip !== undefined) tip.setContent(body(text)); else { try { make(el, text, opts); } catch (e) { log('tooltip failed', e); } }
  };

  return { apply, watch, set };
}
