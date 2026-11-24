// The Captain's Journal's figures: a table of numbers drawn so its rows can be compared at a glance (bars, a scale
// around "as usual", crates, berths, tiles, a thermometer). Pure: cells come in as ready html plus their plain text, and
// every figure keeps the number written beside its mark, so nothing is told by colour or length alone.

const NUM = /\d{1,3}(?:[ ,]\d{3})+(?!\d)|\d+(?:[.,]\d+)?/;
const SCALE = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

/** The first number in a cell ("40 food", "×0.7 the time", "2.5M GP", "+6"), or undefined ("—"). */
export function figNumber(text) {
  const s = String(text).replace(/ /g, ' ');
  const m = NUM.exec(s);
  if (m === null) return undefined;
  const grouped = /[ ,]\d{3}(?!\d)/.test(m[0]);
  const n = Number(grouped ? m[0].replace(/[ ,]/g, '') : m[0].replace(',', '.'));
  const unit = SCALE[s[m.index + m[0].length]] ?? 1;
  const sign = /[-−]$/.test(s.slice(0, m.index)) ? -1 : 1;
  return Number.isFinite(n) ? sign * n * unit : undefined;
}
/** "1 in 10", "about 1 in 3": the chance as a share, or undefined. */
export function figOdds(text) {
  const m = /(\d+)\D+(\d+)/.exec(String(text));
  return m === null || Number(m[2]) === 0 ? undefined : Number(m[1]) / Number(m[2]);
}
/** A bar's width in percent of the longest; anything above nothing stays visible. */
export const barWidth = (value, max) => (!(value > 0) || !(max > 0) ? 0 : Math.min(100, Math.max(3, Math.round((value / max) * 100))));
/** A mark around a middle value: which side, and how far of the half track. */
export function pivotMark(value, at, reach) {
  if (!Number.isFinite(value) || value === at || !(reach > 0)) return { side: 'even', pct: 0 };
  return { side: value < at ? 'less' : 'more', pct: Math.min(50, Math.max(3, Math.round((Math.abs(value - at) / reach) * 50))) };
}

const track = (width) => `<span class="vj-fig-track" aria-hidden="true"><i style="width:${width}%"></i></span>`;
const fig = (html, mark) => `<span class="vj-fig"><span class="vj-fig-val">${html}</span>${mark}</span>`;
/** A cell's figure with a plain bar. */
export const barCell = (html, value, max) => fig(html, track(barWidth(value, max)));
/**
 * A cell's figure on a scale around `at`: the good side always grows right of the middle line in green, the bad side
 * left in red. `goodHigh`: more is good (a market's price); else less is (time, spoilage, food eaten).
 */
export function pivotCell(html, value, at, reach, goodHigh = false) {
  const { side, pct } = pivotMark(value, at, reach);
  const good = (side === 'more') === goodHigh;
  const tone = side === 'even' ? '' : good ? ' vj-fig-good' : ' vj-fig-bad';
  const place = `left:${good ? 50 : 50 - pct}%;width:${pct}%`;
  return fig(html, `<span class="vj-fig-track vj-fig-pivot${tone}" aria-hidden="true">${side === 'even' ? '' : `<i style="${place}"></i>`}</span>`);
}
const PIPS_MAX = 36;
const pipsCell = (html, n) => fig(html, `<span class="vj-pips" aria-hidden="true">${'<i></i>'.repeat(Math.min(PIPS_MAX, Math.max(0, Math.round(n))))}</span>`);
/** Crates in the hold's rows of six. */
const cratesCell = (html, n, extra) => {
  const count = Math.min(PIPS_MAX, Math.max(0, Math.round(n)));
  const rows = [];
  for (let left = count; left > 0; left -= 6) rows.push(`<span>${'<i></i>'.repeat(Math.min(6, left))}</span>`);
  return fig(html, `<span class="vj-crates${extra ? ' vj-crates-plus' : ''}" aria-hidden="true">${rows.join('')}</span>`);
};

const tiles = (cols, rows) => `<div class="vj-tiles-wrap"><div class="vj-tiles-cap">${cols[1] ?? ''}</div><div class="vj-tiles">`
  + rows.map((r) => `<div class="vj-tile"><b class="${r.cells[1]?.cls ?? ''}">${r.cells[1]?.html ?? ''}</b><small>${r.cells[0]?.html ?? ''}</small></div>`).join('') + '</div></div>';

/**
 * A table as a figure. `cols`: the header cells' html. `rows`: { cells: [{ html, text, cls }] }. `spec.kind`:
 * bars (spec.cols), pivot (spec.cols around spec.at, spec.goodHigh), odds (spec.cols), pips and crates (spec.col),
 * tiles, thermo (coldest row first), or words (a plain table whose long cells may wrap).
 */
export function figureTable(spec, cols, rows) {
  if (spec.kind === 'tiles') return tiles(cols, rows);
  const figCols = spec.cols ?? (spec.col !== undefined ? [spec.col] : []);
  const read = spec.kind === 'odds' ? figOdds : figNumber;
  const stats = new Map(figCols.map((c) => {
    const xs = rows.map((r) => read(r.cells[c]?.text ?? '')).filter((x) => x !== undefined);
    return [c, { max: Math.max(0, ...xs), reach: Math.max(0, ...xs.map((x) => Math.abs(x - (spec.at ?? 0)))) }];
  }));
  // Multipliers in side-by-side columns share one scale, so the same figure draws the same length in each.
  const sharedReach = Math.max(0, ...[...stats.values()].map((s) => s.reach));
  const cell = (c, i) => {
    if (!figCols.includes(i)) {
      const html = spec.kind === 'thermo' && i === 1 ? c.html.replace(/^([^:<]{1,20}):/, '<b>$1</b>:') : c.html;
      return `<td class="${i === 0 ? 'vj-first' : ''} ${c.cls ?? ''}">${html}</td>`;
    }
    const v = read(c.text ?? '');
    if (v === undefined) return `<td class="vj-figcell ${c.cls ?? ''}">${c.html}</td>`;
    const { max } = stats.get(i);
    const inner = spec.kind === 'pivot' ? pivotCell(c.html, v, spec.at, sharedReach, spec.goodHigh === true)
      : spec.kind === 'pips' ? pipsCell(c.html, v)
      : spec.kind === 'crates' ? cratesCell(c.html, v, String(c.text).trim().startsWith('+'))
      : barCell(c.html, v, max);
    return `<td class="vj-figcell ${c.cls ?? ''}">${inner}</td>`;
  };
  return `<table class="vj-ledger vj-figtable${spec.kind === 'thermo' ? ' vj-thermo' : ''}"><thead><tr>`
    + cols.map((c, i) => `<th class="${figCols.includes(i) ? 'vj-figcol' : ''}" data-no-skill-names>${c}</th>`).join('') + '</tr></thead><tbody>'
    + rows.map((r) => `<tr>${r.cells.map(cell).join('')}</tr>`).join('') + '</tbody></table>';
}

/** The Voyage page's help sections in the book: a heading's icon and how its tables are drawn, in order. */
export const HELP_DRESS = {
  MOD_VOY_HELP_HEAD_BANDS: { icon: 'fa-skull-crossbones' },
  MOD_VOY_HELP_HEAD_BERTHS: { icon: 'fa-bed', figs: [{ kind: 'pips', col: 1 }] },
  MOD_VOY_HELP_HEAD_CARGO: { icon: 'fa-box' },
  MOD_VOY_HELP_HEAD_COMPASS_SEE: { icon: 'fa-compass' },
  MOD_VOY_HELP_HEAD_COSTS: { icon: 'fa-drumstick-bite', figs: [{ kind: 'bars', cols: [1, 2] }] },
  MOD_VOY_HELP_HEAD_CREW_ASHORE: { icon: 'fa-anchor' },
  MOD_VOY_HELP_HEAD_CREW_HAUL: { icon: 'fa-suitcase' },
  MOD_VOY_HELP_HEAD_CREW_OUTPOST: { icon: 'fa-campground' },
  MOD_VOY_HELP_HEAD_CREW_STORES: { icon: 'fa-utensils', figs: [{ kind: 'pivot', cols: [1], at: 100 }] },
  MOD_VOY_HELP_HEAD_CREW_TRAITS: { icon: 'fa-certificate', figs: [{ kind: 'words' }] },
  MOD_VOY_HELP_HEAD_CREW_WALK: { icon: 'fa-walking' },
  MOD_VOY_HELP_HEAD_DISCOUNT: { icon: 'fa-tag' },
  MOD_VOY_HELP_HEAD_FORAGE: { icon: 'fa-leaf', figs: [{ kind: 'bars', cols: [1, 2] }] },
  MOD_VOY_HELP_HEAD_LOADING: { icon: 'fa-dolly', figs: [{ kind: 'bars', cols: [1, 2] }] },
  MOD_VOY_HELP_HEAD_NIGHT: { icon: 'fa-moon', figs: [{ kind: 'tiles' }] },
  MOD_VOY_HELP_HEAD_NO_XP: { icon: 'fa-ban' },
  MOD_VOY_HELP_HEAD_REMOVING: { icon: 'fa-exclamation-triangle' },
  MOD_VOY_HELP_HEAD_REPAIR: { icon: 'fa-hammer' },
  MOD_VOY_HELP_HEAD_ROOM: { icon: 'fa-warehouse', figs: [{ kind: 'tiles' }] },
  MOD_VOY_HELP_HEAD_SKILLS: { icon: 'fa-fire' },
  MOD_VOY_HELP_HEAD_SLOTS: { icon: 'fa-th', figs: [{ kind: 'crates', col: 1 }] },
  MOD_VOY_HELP_HEAD_SPOIL: { icon: 'fa-hourglass-half', figs: [{ kind: 'pivot', cols: [1, 2], at: 1 }] },
  MOD_VOY_HELP_HEAD_STOW: { icon: 'fa-boxes' },
  MOD_VOY_HELP_HEAD_STOWAWAY: { icon: 'fa-user-secret' },
  MOD_VOY_HELP_HEAD_SUPPLY: { icon: 'fa-store', figs: [{ kind: 'bars', cols: [1, 2] }] },
  MOD_VOY_HELP_HEAD_WEAR: { icon: 'fa-water', figs: [{ kind: 'tiles' }] },
  MOD_VOY_HELP_HEAD_XP: { icon: 'fa-arrow-up', figs: [{ kind: 'tiles' }] },
};
/** The written chapters' tables, by chapter and section, in the order the text has them. */
export const WRITTEN_FIGS = {
  clock: { PACE: [{ kind: 'bars', cols: [1] }, { kind: 'bars', cols: [1] }] },
  // Three columns of words: on a phone each row stacks under its first cell.
  crew_couriers: { STOPS: [{ kind: 'stack' }] },
  weather: { BANDS: [{ kind: 'thermo' }], WIND: [{ kind: 'pivot', cols: [1], at: 1 }], STORMS: [{ kind: 'odds', cols: [1] }] },
};
/** The written chapters' and guide accounts' heading icons. */
export const SECTION_ICONS = {
  map: { TINT: 'fa-palette', PANEL: 'fa-crosshairs', FOLDED: 'fa-compress-alt', PLACES: 'fa-map-marker-alt', KEYS: 'fa-keyboard', MARKS: 'fa-bookmark' },
  lands: { KINDS: 'fa-mountain', FEATURES: 'fa-landmark' },
  tricks: { STORES: 'fa-drumstick-bite', BOAT: 'fa-ship', TRADE: 'fa-coins', NIGHT: 'fa-moon', WAY: 'fa-search', PAGE: 'fa-book-open' },
  settings: { EASIER: 'fa-sliders-h', KEYS: 'fa-keyboard', WHY: 'fa-question-circle' },
  leaving: { WHAT: 'fa-exclamation-triangle', KEEP: 'fa-save', SAFETY: 'fa-life-ring', HOW: 'fa-sign-out-alt' },
  adventure: { FIRST: 'fa-flag', NEXT: 'fa-route' },
  road: { MOUNTS: 'fa-horse', SIGN: 'fa-map-signs' },
  clock: { PACE: 'fa-stopwatch', WAY: 'fa-route', LAND: 'fa-flag-checkered', ASK: 'fa-random', FOG: 'fa-smog', AWAY: 'fa-bed', OFF: 'fa-power-off' },
  weather: { SEASON: 'fa-calendar-alt', BANDS: 'fa-thermometer-half', HARVEST: 'fa-seedling', ICE: 'fa-snowflake', WIND: 'fa-wind', STORMS: 'fa-bolt', RARE: 'fa-star', OFF: 'fa-power-off' },
  crew_hire: { START: 'fa-file-signature', WORKER: 'fa-hammer', PORT: 'fa-anchor' },
  crew_ranks: { TIERS: 'fa-layer-group', LICENCES: 'fa-id-card', PROMOTE: 'fa-arrow-up' },
  crew_pay: { WAGES: 'fa-coins', GRACE: 'fa-hourglass-half', STRIKE: 'fa-fist-raised', DISMISS: 'fa-user-times', EASIER: 'fa-hand-holding-usd' },
  crew_couriers: { JOB: 'fa-id-badge', ROUTE: 'fa-route', PACKETS: 'fa-ship', FOOD: 'fa-drumstick-bite', CONTRACTS: 'fa-file-contract', COMMISSIONS: 'fa-scroll', STOPS: 'fa-exclamation-triangle' },
  crew_tips: { OWN: 'fa-lightbulb' },
  CARGO: { BOARD: 'fa-clipboard-list', TRADE: 'fa-exchange-alt', LOAD: 'fa-box', DELIVER: 'fa-ship', DROP: 'fa-trash-alt' },
  NOTICES: { TASKS: 'fa-clipboard-list', ONE: 'fa-hand-point-up', CHARTS: 'fa-map', RUMOURS: 'fa-comment-dots' },
  MARKETS: { PRICES: 'fa-balance-scale', LEARN: 'fa-book' },
  PLANNING: { WHERE: 'fa-map-marked-alt', PREFER: 'fa-directions', STOPS: 'fa-drumstick-bite', CHARTS: 'fa-map' },
};
/** Lists drawn as cards, an icon for each point in order: the answers to a band and what a fight can end in. */
export const LIST_CARDS = {
  'encounters.ANSWER': ['fa-khanda', 'fa-coins', 'fa-running', 'fa-dice', 'fa-file-invoice-dollar'],
  'encounters.STAKES': ['fa-trophy', 'fa-fist-raised', 'fa-running', 'fa-handshake', 'fa-heart-broken'],
};
/** Lists whose order matters, drawn with numbers. */
export const LIST_NUMBERED = ['leaving.HOW'];
