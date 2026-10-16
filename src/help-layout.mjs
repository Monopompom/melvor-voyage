// Help-style popup bodies: one grey band per idea with a short heading, one sentence
// a paragraph, numbers in small tables. Used by the Voyage page's "?" popups, the welcome and the dinghy notice.
//
// A section is { head?, warn?, body: [...] }. A body item is a plain string (escaped), { text, cls } (escaped, with a
// colour class), { html, cls } (trusted markup from en.json: bold names, coloured words) or { table: { cols, rows } },
// where a row is { cells: [label, ...values], cls?: [one class per value], icon? }.

export const HELP_WIDTH = '38rem';

/**
 * A message popup's body (refusals, the trader, the panel's skill tip): trusted
 * HTML lines at the body size, centred when there are one or two, left-aligned when there are more. Its one
 * picture goes on top through Swal's `imageUrl` (MSG_IMAGE), or a Swal icon when there is none (build .94).
 */
export const msgHtml = (lines) => `<div class="voyage-msg ${lines.length <= 2 ? 'text-center' : 'text-left'}">`
  + lines.map((l) => `<div>${l}</div>`).join('') + '</div>';
/** The picture on top of a message popup: the action, area or coin it is about, as large as a Folk's portrait. */
export const MSG_IMAGE = { imageWidth: 64, imageHeight: 64, imageAlt: '' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const table = ({ cols, rows }) => {
  const head = cols.map((c, i) => `<div class="voyage-help-th${i > 0 ? ' text-right' : ''}">${esc(c)}</div>`).join('');
  const body = rows.map((r) => r.cells.map((c, i) => {
    if (i === 0) return `<div class="voyage-help-td">${r.icon ? `<img class="skill-icon-xs mr-1" src="${r.icon}" alt="">` : ''}${esc(c)}</div>`;
    return `<div class="voyage-help-td text-right font-w600 ${r.cls?.[i - 1] ?? ''}">${esc(c)}</div>`;
  }).join('')).join('');
  return `<div class="voyage-help-table" style="--voyage-help-cols:${cols.length - 1}">${head}${body}</div>`;
};

const item = (it) => {
  if (typeof it === 'string') return `<p class="voyage-help-p">${esc(it)}</p>`;
  if (it.table !== undefined) return table(it.table);
  if (it.html !== undefined) return `<p class="voyage-help-p ${it.cls ?? ''}">${it.html}</p>`;
  return `<p class="voyage-help-p ${it.cls ?? ''}">${esc(it.text)}</p>`;
};

/** The popup body: wrap it in nothing else; it carries `voyage-help-body`. */
export const helpHtml = (sections) => '<div class="text-left voyage-help-body">' + sections.map((s) =>
  `<div class="voyage-section voyage-help-section${s.warn ? ' voyage-help-warn border-warning' : ''}">`
  + `${s.head ? `<div class="voyage-help-head">${esc(s.head)}</div>` : ''}${s.body.map(item).join('')}</div>`).join('') + '</div>';
