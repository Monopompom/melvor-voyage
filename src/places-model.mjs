// The map's Places card (1.8.1, a player's ask): the pure part. Groups of rows to draw (home, camps, ports, recent),
// sorted and searched. No game globals; src/places.mjs gathers the rows from the game.

/** The groups in the card's order. */
export const GROUPS = ['home', 'camps', 'ports', 'recent'];

/** Lower case, accents dropped, ß as ss, anything but a letter or digit a space: "Frost-Drift Port" and "frost drift" meet. */
export const fold = (s) => String(s ?? '').toLowerCase().replace(/ß/g, 'ss').replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** A test for one folded query word: it starts a word, or sits anywhere in one when it is Chinese (no spaces to start at). */
export const wordTest = (w) => (/\p{Script=Han}/u.test(w) ? (x) => x.includes(w) : (x) => x.startsWith(w));

/** True when every word of `query` starts a word of `name` ("fro dri" finds Frost Drift Port). An empty query finds all. */
export function matches(name, query) {
  const words = fold(query).split(' ').filter((w) => w !== '');
  if (words.length === 0) return true;
  const have = fold(name).split(' ');
  return words.map(wordTest).every((hit) => have.some(hit));
}

/** Rows nearest first (a row without a distance last), then by name; a new array. */
export function byDistance(rows) {
  const d = (r) => (Number.isFinite(r.distance) ? r.distance : Infinity);
  return [...rows].sort((a, b) => d(a) - d(b) || String(a.name).localeCompare(String(b.name)));
}

/**
 * The card's groups from `rows` = { home, camps, ports, recent } (arrays of { name, ... }), each kept in GROUPS order,
 * camps and ports nearest first, home and recent as given, filtered by `query`; groups left empty are dropped.
 * Returns [{ id, rows }].
 */
export function placeGroups(rows, query = '') {
  const out = [];
  for (const id of GROUPS) {
    const list = Array.isArray(rows?.[id]) ? rows[id] : [];
    const sorted = id === 'camps' || id === 'ports' ? byDistance(list) : list;
    const kept = sorted.filter((r) => matches(r.name, query));
    if (kept.length > 0) out.push({ id, rows: kept });
  }
  return out;
}
