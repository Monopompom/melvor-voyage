// Skill names in our popups (the user 16 Oct 2026: "highlight skill names all the time in modals and
// add skill icon before name"): every skill name in a popup's title and body becomes the skill's icon and the name
// in bold. Done on the rendered DOM, so every string (en.json, templates, game names) follows without markup.
// Buttons, links, inputs and names already wrapped are left alone; `data-no-skill-names` opts a subtree out.

const SKIP = 'button, a, input, textarea, select, option, script, style, .voyage-skill-name, [data-no-skill-names]';
let pattern;
let byName;

/** A pattern for whole-word skill names, longest first (so "Alt Magic" wins over "Magic"); null without names. Pure. */
export function namePattern(names) {
  const list = [...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return list.length === 0 ? null : new RegExp(`(?<![\\p{L}\\p{N}])(${list.join('|')})(?![\\p{L}\\p{N}])`, 'gu');
}

/** `text` split into plain strings and { name } parts. Pure; resets the pattern itself (test() and matchAll share lastIndex). */
export function splitNames(text, pattern) {
  if (pattern === null || pattern === undefined) return [text];
  pattern.lastIndex = 0;
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push({ name: m[1] });
    last = m.index + m[1].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  pattern.lastIndex = 0;
  return parts;
}

const build = () => {
  byName = new Map();
  for (const s of game.skills.allObjects) if (s?.name && s?.media) byName.set(s.name, s);
  // The game names the Alt. Magic skill just "Magic"; our texts use its page name, so that is a name too (else
  // "Alt." is left outside the chip).
  try {
    const alt = getLangString('MOD_VOY_RULE_LABEL_Magic');
    if (game.altMagic?.media && alt && alt !== game.altMagic.name && !alt.startsWith('UNDEFINED')) byName.set(alt, game.altMagic);
  } catch {}
  pattern = namePattern(byName.keys());
};

const chip = (skill, name) => {
  const span = document.createElement('span');
  span.className = 'voyage-skill-name';
  const img = document.createElement('img');
  img.className = 'voyage-skill-name-icon';
  img.src = skill.media;
  img.alt = '';
  const b = document.createElement('b');
  b.textContent = name;
  span.append(img, b);
  return span;
};

/** Wraps every skill name under `root` (text only) in the icon-and-bold chip. Safe to call twice. */
export function skillNames(root) {
  try {
    if (!root) return;
    if (pattern === undefined) build();
    if (pattern === null) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits = [];
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      if (n.parentElement?.closest(SKIP)) continue;
      pattern.lastIndex = 0;
      if (pattern.test(n.nodeValue)) hits.push(n);
    }
    for (const n of hits) {
      const frag = document.createDocumentFragment();
      for (const part of splitNames(n.nodeValue, pattern)) frag.append(typeof part === 'string' ? part : chip(byName.get(part.name), part.name));
      n.replaceWith(frag);
    }
  } catch (e) { console.warn('[Voyage] skill names failed', e); }
}

const NBSP = '\u00a0';
// Popup titles that wrap (builds .261-.262; the user: "I certainly don't want '…' cause it may cut destination", then
// "is that grammatically correct to break the name"). No ellipsis: the title wraps, its lines balanced by the CSS, and
// these ties choose where it may break. Each is pure, for the tests; fitTitle applies them and undoes any that would
// push the title past the popup's edge (a phone's line holds about 17 letters of a 30 px title).
/** A hex's coordinates never split: "(2, 8)" stays whole. */
export const tieCoords = (text) => String(text).replace(/\((-?\d+), (-?\d+)\)/g, `($1,${NBSP}$2)`);
/** An article never ends a line: "The", "A" and "An" stay with the word after them. */
export const tieArticles = (text) => String(text).replace(/(^|[\s\u00a0])(The|the|A|An|an) (?=\S)/g, `$1$2${NBSP}`);
/** The last word keeps the one before it, so a title never ends on a word alone ("8)?", "Port?"). */
export const tieLast = (text) => {
  const s = String(text);
  const at = s.trimEnd().lastIndexOf(' ');
  return at <= 0 || s.slice(0, at).trim() === '' ? s : `${s.slice(0, at)}${NBSP}${s.slice(at + 1)}`;
};
/** All three on a plain title. */
export const tieTitle = (text) => tieLast(tieArticles(tieCoords(text)));
/** The class a place's name carries in a title (`titleName` in help-layout.mjs): kept on one line when it fits. */
export const TITLE_NAME = 'voyage-title-name';

const fitTitle = (title, tries = 0) => {
  try {
    if (!title) return;
    // Measured once the popup is laid out (didRender can come before it shows).
    if (title.clientWidth === 0) { if (tries < 20) requestAnimationFrame(() => fitTitle(title, tries + 1)); return; }
    // Swal's title breaks inside a word when it must (overflow-wrap), so nothing ever overflows it: measured with that
    // off, a tie too wide for the line shows as an overflow and is undone ("A Friendly Fisherma" / "n" otherwise).
    const wrap = [title.style.overflowWrap, title.style.wordBreak];
    title.style.overflowWrap = 'normal';
    title.style.wordBreak = 'normal';
    // Measured on the text's own boxes against the content edges: the title's padding hides an overflow from
    // scrollWidth (a tied "A Friendly Fisherman" ran 20 px into it and passed).
    const fits = () => {
      const box = title.getBoundingClientRect();
      const cs = getComputedStyle(title);
      const left = box.left + parseFloat(cs.paddingLeft) - 1;
      const right = box.right - parseFloat(cs.paddingRight) + 1;
      const range = document.createRange();
      range.selectNodeContents(title);
      return [...range.getClientRects()].every((r) => r.width === 0 || (r.left >= left && r.right <= right));
    };
    const texts = () => {
      const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
      const out = [];
      for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) out.push(n);
      return out;
    };
    /** Applies `fn` to the text nodes; undoes it when the title no longer fits. */
    const step = (nodes, fn) => {
      const before = nodes.map((n) => n.nodeValue);
      nodes.forEach((n) => { const v = fn(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; });
      if (!fits()) nodes.forEach((n, i) => { n.nodeValue = before[i]; });
    };
    step(texts(), tieCoords);
    step(texts(), tieArticles);
    title.querySelectorAll(`.${TITLE_NAME}`).forEach((el) => {
      // The "?" after a name goes with it: the end of a no-wrap span is a place to break ("Port" / "?" alone). Merged
      // into the name's text, so the last-word tie below sees "Outpost?" whole (as its own node it saw only "?").
      const next = el.nextSibling;
      const mark = next?.nodeType === 3 ? next.nodeValue.match(/^[?!.,:;]+/) : null;
      if (mark !== null) { el.append(mark[0]); el.normalize(); next.nodeValue = next.nodeValue.slice(mark[0].length); }
      el.style.whiteSpace = 'nowrap';
      if (!fits()) el.style.whiteSpace = '';
    });
    const all = texts().filter((n) => n.nodeValue.trim() !== '');
    if (all.length > 0) step([all[all.length - 1]], tieLast);
    [title.style.overflowWrap, title.style.wordBreak] = wrap;
  } catch (e) { console.warn('[Voyage] title ties failed', e); }
};

/** For every Swal we open: `didRender: state.popupDidRender`. */
export const didRender = (popup) => {
  skillNames(popup?.querySelector('.swal2-title'));
  fitTitle(popup?.querySelector('.swal2-title'));
  skillNames(popup?.querySelector('.swal2-html-container'));
};
