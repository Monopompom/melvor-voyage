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

/** For every Swal we open: `didRender: state.popupDidRender`. */
export const didRender = (popup) => {
  skillNames(popup?.querySelector('.swal2-title'));
  skillNames(popup?.querySelector('.swal2-html-container'));
};
