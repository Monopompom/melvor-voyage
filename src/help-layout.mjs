// Help-style popup bodies: one grey band per idea with a short heading, one sentence
// a paragraph, numbers in small tables. Used by the Voyage page's "?" popups, the welcome and the dinghy notice.
//
// A section is { head?, warn?, body: [...] }. A body item is a plain string (escaped), { text, cls } (escaped, with a
// colour class), { html, cls } (trusted markup from en.json: bold names, coloured words) or { table: { cols, rows } },
// where a row is { cells: [label, ...values], cls?: [one class per value], icon? }.

export const HELP_WIDTH = 'min(38rem, 96vw)'; // on a phone the same 96vw as every message popup (.308, C2-23)

/**
 * A message popup's body (refusals, the trader, the panel's skill tip): trusted
 * HTML lines at the body size, always centred (build .259, the user: "Adrift modal have not centered text"; it was
 * left-aligned past two lines). Its one
 * picture goes on top through Swal's `imageUrl` (MSG_IMAGE), or a Swal icon when there is none (build .94).
 */
export const msgHtml = (lines) => '<div class="voyage-msg text-center">'
  + lines.map((l) => `<div>${l}</div>`).join('') + '</div>';
/**
 * A shown duration with the hourglass before it ("⌛ 7h 7m", build .301, the user: "sandclock icon and lowercase h, space,
 * lowercase m"). `time` is plain text.
 */
export const timeHtml = (time) => `<span class="voyage-time"><i class="fa fa-hourglass-half" aria-hidden="true"></i>${esc(time)}</span>`;
/** A sentence with a duration in its `${time}` ("turns in ${time}"): escaped, the time marked with the hourglass. */
export const withTime = (key, vars) => esc(templateLangString(key, { ...vars, time: '\u0001' })).replace('\u0001', timeHtml(vars.time));
/** The picture on top of a message popup: the action, area or coin it is about, as large as a Folk's portrait. */
export const MSG_IMAGE = { imageWidth: 64, imageHeight: 64, imageAlt: '' };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * The marks a message popup's body puts on what matters (build .259, the user: "make them consistent, compare with
 * phase 4 modals"): a name in bold, as the lock popups and the trader have it; a time bold in blue and a price bold in
 * amber (red when you can't pay) after the GP icon, as the page's Ways out lines have them.
 */
export const mark = {
  name: (s) => `<b>${esc(s)}</b>`,
  time: (s) => `<b class="text-info">${esc(s)}</b>`,
  gp: (media, text, short = false) => `<img class="voyage-skill-name-icon" src="${esc(media)}" alt=""><b class="${short ? 'text-danger' : 'text-warning'}">${esc(text)}</b>`,
};
/**
 * A place's name in a popup title (build .262): kept on one line when it fits the popup, else broken between its words
 * but never after "The" (skill-names.mjs fitTitle). Never cut with "…".
 */
/**
 * A pick as the game's own dropdown, the look every Voyage pick has (Bootstrap's data-toggle; the user, builds .233
 * and .367: "unify dropdowns", never the browser's select): a toggle showing the picked choice's icon and words, a menu
 * of choices each with its icon, the value in a hidden input under `id`. `choices`: [{ value, label, media? }], one
 * with no media gets the pause icon (doing nothing). `labelId` names the pick. Wire it in the popup's didOpen with
 * bindPick.
 */
const pickFace = (c) => `${c?.media ? `<img class="voyage-plan-pick-ico" src="${esc(c.media)}" alt="">` : '<i class="fa fa-pause-circle voyage-plan-pick-ico" aria-hidden="true"></i>'}<span>${esc(c?.label ?? '')}</span>`;
export const pickHtml = (id, labelId, choices, value) => {
  const on = choices.find((c) => c.value === value) ?? choices[0];
  return `<div class="dropdown voyage-plan-arrival voyage-clock-dd"><input type="hidden" id="${id}" value="${esc(on?.value ?? '')}">`
    + `<button type="button" class="btn btn-light dropdown-toggle" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false" aria-labelledby="${labelId}" data-voyage-pick="${id}">${pickFace(on)}</button>`
    + `<div class="dropdown-menu overflow-y-auto">${choices.map((c) => `<a class="dropdown-item pointer-enabled${c === on ? ' active' : ''}" role="button" data-voyage-pick-for="${id}" data-value="${esc(c.value)}">${pickFace(c)}</a>`).join('')}</div></div>`;
};
/** Wires a pickHtml inside `el`: a choice sets the hidden value, the toggle's face and the menu's active row. */
export const bindPick = (el, id) => {
  const input = el.querySelector(`#${id}`);
  const toggle = el.querySelector(`[data-voyage-pick="${id}"]`);
  el.querySelectorAll(`[data-voyage-pick-for="${id}"]`).forEach((a) => a.addEventListener('click', () => {
    if (input !== null) input.value = a.dataset.value ?? '';
    if (toggle !== null) toggle.innerHTML = a.innerHTML;
    el.querySelectorAll(`[data-voyage-pick-for="${id}"]`).forEach((b) => b.classList.toggle('active', b === a));
  }));
};

export const titleName = (s) => `<span class="voyage-title-name">${esc(s)}</span>`;
/**
 * A band of ways to choose from in a popup (build .386; the user, 21 Oct 2026: the pirates' and the stowaway's popups
 * were three plain centred lines): the Adrift block's "Ways out" look, one row a way, its icon, a bold lead and the
 * rest. `rows`: [{ icon (a Font Awesome class such as 'fa-coins', or an <img> string), lead, html (trusted), cls? }].
 * The rows read left (a list of options, as the requirement rows do); the popup around them stays centred.
 */
export const waysHtml = (head, rows) => `<div class="voyage-section voyage-ways text-left">${head ? `<div class="voyage-clock-head">${esc(head)}</div>` : ''}`
  + rows.map((r) => `<div class="voyage-adrift-way${r.cls ? ` ${r.cls}` : ''}">${r.icon.startsWith('<') ? r.icon : `<i class="fa fa-fw ${r.icon} text-muted" aria-hidden="true"></i>`}<span><b>${esc(r.lead)}</b> ${r.html}</span></div>`).join('')
  + '</div>';
/**
 * A lang string as one escaped HTML line, with some of its vars marked: `marks` maps a var to its HTML (from `mark`),
 * the other vars go in as plain text. `tf` is the file's `t(key, vars)`.
 */
export const marked = (tf, key, vars, marks = {}) => {
  const keys = Object.keys(marks);
  const ph = Object.fromEntries(keys.map((k, i) => [k, `\u0000${i}\u0000`]));
  let s = esc(tf(key, { ...vars, ...ph }));
  keys.forEach((k) => { s = s.split(ph[k]).join(marks[k]); });
  return s;
};

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

/** The popup body: wrap it in nothing else; it carries `voyage-help-body`. It reads centred like every other popup:
 *  a notice built with the bands (the welcome, the dinghy notice, a rumour or chart read; build .307) and, since
 *  build .354, a "?" help too (the user, 20 Oct 2026: "let's center all of them"). A notice passes `notice: true` and
 *  has its picture on top through MSG_IMAGE, not in the title (build .310, scan C-07). Tables stay left so their
 *  columns line up. */
export const helpHtml = (sections, { notice = false } = {}) => `<div class="text-center voyage-help-body${notice ? ' voyage-help-notice' : ''}">` + sections.map((s) =>
  `<div class="voyage-section voyage-help-section${s.warn ? ' voyage-help-warn' : ''}">`
  + `${s.head ? `<div class="voyage-help-head">${esc(s.head)}</div>` : ''}${s.body.map(item).join('')}</div>`).join('') + '</div>';

/**
 * A purchase on the Voyage page asks first (build .386; the user, 21 Oct 2026: Navigator's Charts, 300,000 GP and
 * 100 Pitch, went at once from a button beside the Shipwright's fold). The game's own "Show Shop Purchase
 * Confirmations" setting decides: off, `yes` runs at once; on, a message popup with the price in a band, each cost as
 * its icon, the amount (bold amber, red when short) and its name; Buy green, Not now blue outline, the thing bought on
 * top. `costs` is a game Costs; `picture` its picture; `didRender` the mod's popup pass.
 */
export const confirmBuy = ({ name, picture, didRender, costs }, yes) => {
  let ask = true;
  try { ask = game.settings.showShopConfirmations !== false; } catch {}
  if (!ask) { yes(); return; }
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const num = (n) => { try { return numberWithCommas(Math.floor(n)); } catch { return `${Math.floor(n)}`; } };
  const row = (media, need, have, label) => `<span class="voyage-buy-cost">${mark.gp(media, num(need), have < need)}<span>${esc(label)}</span></span>`;
  const rows = [];
  try {
    for (const { currency, quantity } of costs.getCurrencyQuantityArray()) if (quantity > 0) rows.push(row(currency.media, quantity, currency.amount, currency.name));
    for (const { item, quantity } of costs.getItemQuantityArray()) if (quantity > 0) rows.push(row(item.media, quantity, game.bank.getQty(item), item.name));
  } catch {}
  const cls = { popup: 'voyage-ui', confirmButton: 'btn btn-success m-1', cancelButton: 'btn btn-outline-info m-1' };
  SwalLocale.fire({
    title: marked(t, 'MOD_VOY_BUY_TITLE', {}, { name: titleName(name) }),
    imageUrl: picture,
    ...MSG_IMAGE,
    html: msgHtml([mark.name(name)])
      + `<div class="voyage-section voyage-buy-band"><div class="voyage-clock-head">${esc(t('MOD_VOY_BUY_PRICE'))}</div><div class="voyage-buy-costs">${rows.join('')}</div></div>`,
    showCancelButton: true,
    confirmButtonText: t('MOD_VOY_BUY_CONFIRM'),
    cancelButtonText: t('MOD_VOY_BUY_CANCEL'),
    didRender,
    customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass(cls) : cls,
  }).then((r) => { if (r.isConfirmed) yes(); });
};
