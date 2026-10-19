// Melvor's own tooltips (tippy) instead of the browser's `title` boxes (the user, build .160). After a
// part of the page or the Here panel redraws, apply(root) turns every `title` under it into a tippy tooltip; watch(root)
// applies them whenever root changes (the journal); set(el, text) gives one element its tooltip (the sidebar). Buttons
// that act on a tap show theirs on press-and-hold on a phone (`touch: 'hold'`). Tooltips of elements a redraw removed
// are destroyed.
// The look (the user, 17 Oct 2026; build .175): every tooltip's text is centred, and an item named in it has the
// item's icon before the name, as on the page. An item icon carries `data-tip-item="<item id>"`: its tooltip is the
// icon, then its title text (which starts with the name, e.g. "Normal Logs: 1 fuel each") or the item's name. A cost
// that is not an item (GP, a currency) carries `data-tip-media="<icon url>"` for the same look. No other pictures.
// `data-tip-lines` (build .167, the user): a JSON list of lines, each a string or `{ text, cls, item, media, mark }`, one
// line each; `cls` colours it (a buff in the game's green), `item` (an item id) or `media` puts an icon before it.
// Everything is built as DOM nodes, never as HTML from strings.

export function install(ctx, { log }) {
  const live = new Set();
  // Escape hides a tooltip that focus left showing (.308, scan C2-13: the header book's stayed up over the page).
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') for (const i of live) { try { i.hide(); } catch {} } });

  const itemOf = (id) => { try { return id ? game.items.getObjectByID(id) : undefined; } catch { return undefined; } };

  /** The centred box every tooltip sits in. */
  const box = () => {
    const div = document.createElement('div');
    div.className = 'voyage-tip';
    return div;
  };
  /** The small icon before an item's name. */
  const icon = (src) => {
    const img = document.createElement('img');
    img.className = 'voyage-tip-icon';
    img.src = src;
    img.alt = '';
    return img;
  };
  /**
   * One line: an optional icon, then the text (line breaks kept, a list of buffs one per line). `mark` ({ text, cls },
   * build .282) colours one word of it, the compass's "Freezing".
   */
  const line = (text, media, cls, mark) => {
    const row = document.createElement('div');
    row.className = `voyage-tip-line${cls ? ` ${cls}` : ''}`;
    if (media) row.append(icon(media));
    const at = mark?.text ? text.indexOf(mark.text) : -1;
    if (at < 0) { row.append(document.createTextNode(text)); return row; }
    const word = document.createElement('b');
    word.className = mark.cls ?? '';
    word.textContent = mark.text;
    row.append(document.createTextNode(text.slice(0, at)), word, document.createTextNode(text.slice(at + mark.text.length)));
    return row;
  };
  const body = (text, media) => { const div = box(); div.append(line(text, media)); return div; };

  const linesOf = (el) => {
    try { const v = JSON.parse(el.dataset.tipLines ?? ''); return Array.isArray(v) && v.length > 0 ? v : undefined; } catch { return undefined; }
  };
  const linesBody = (lines) => {
    const div = box();
    for (const l of lines) {
      if (typeof l === 'string') { div.append(line(l)); continue; }
      const item = itemOf(l?.item);
      div.append(line(l?.text ?? item?.name ?? '', l?.media ?? item?.media, l?.cls, l?.mark));
    }
    return div;
  };
  /** What an element's tooltip says: its title text, else the item's name; and the icon to put before it. */
  const contentOf = (el, text) => {
    const item = itemOf(el.dataset.tipItem);
    return { text: text || item?.name || '', media: item?.media ?? el.dataset.tipMedia };
  };

  const make = (el, content, opts = {}) => {
    const inst = tippy(el, {
      content, placement: 'top', interactive: false, animation: false,
      // `data-tip-touch="off"`: no tooltip on touch, the press-and-hold does something else (the Here strip's name, build .187).
      touch: el.dataset.tipTouch === 'off' ? false : el.closest('button, [role="button"], a') !== null ? 'hold' : true, ...opts, // the element or its button (.308, scan A-18/C-09)
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
    const sel = '[title], [data-tip-item], [data-tip-media], [data-tip-lines]';
    const els = [...(root.matches?.(sel) ? [root] : []), ...root.querySelectorAll(sel)];
    for (const el of els) {
      const lines = linesOf(el);
      if (lines !== undefined) {
        el.removeAttribute('title');
        // A little wider than tippy's 350px, so a compass row fits on one line (build .282).
        if (el._tippy === undefined) { try { make(el, linesBody(lines), { maxWidth: 400 }); el.dataset.tipShown = el.dataset.tipLines; } catch (e) { log('tooltip failed', e); } }
        else if (el.dataset.tipShown !== el.dataset.tipLines) { el._tippy.setContent(linesBody(lines)); el.dataset.tipShown = el.dataset.tipLines; }
        continue;
      }
      const fresh = el.getAttribute('title');
      if (fresh !== null) { el.removeAttribute('title'); el.dataset.tipText = fresh; }
      const tip = el._tippy;
      const { text, media } = contentOf(el, el.dataset.tipText ?? '');
      if (text === '') { if (tip !== undefined) { tip.destroy(); live.delete(tip); } continue; }
      if (tip !== undefined) { if (fresh !== null) tip.setContent(body(text, media)); continue; }
      try { make(el, body(text, media)); } catch (e) { log('tooltip failed', e); }
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
    if (tip !== undefined) tip.setContent(body(text)); else { try { make(el, body(text), opts); } catch (e) { log('tooltip failed', e); } }
  };

  return { apply, watch, set };
}
