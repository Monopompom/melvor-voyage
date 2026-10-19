// The Captain's Journal's pure side: recording finds, misses, places and guide pages into the save's
// `journal` record (shape and cleaning in voyage-model.mjs), and the search. No game objects; covered by Node tests.
// Hexes are "q,r" strings in the game's axial coordinates, as WorldMap.getHex(new HexCoords(q, r)) takes them.

/**
 * The "How it works" chapters, in book order. Most render the Voyage page's "?" texts (voyage-page.mjs helpSections);
 * 'crafts' is the rule table; the ones in JOURNAL_WRITTEN are written for the book alone (the user, 16 Oct 2026:
 * "write it all down": reading the map, tricks, settings, removing the mod, Adventure's first coins). 'lands' (build
 * .113) adds two live ledgers from the rule table: what each kind of land and each feature lets a craft do.
 * 'road' (build .170, the user's ask) is the land upgrades and the Crossroads Sign (4.27, 4.28), with live ledgers.
 * 'clock' (build .219) is timed travel (phase 5a, 4.5); 'weather' (phase 5c-1, 4.24) the seasons, the bands and the ice. Cargo, markets, notices and planning were chapters here until
 * build .231; they are Guide pages now (JOURNAL_GUIDE_SECTIONS), written at their first moment.
 */
export const JOURNAL_CHAPTERS = ['foreword', 'crafts', 'map', 'lands', 'stores', 'ship', 'hold', 'travels', 'clock', 'weather', 'road', 'compass', 'tricks', 'settings', 'leaving', 'adventure', 'lighthouse'];
/**
 * The Old Man's Crew pages (build .116, the user's ask): a guide to Worker Folks: Hiring in the captain's voice, shown
 * as their own tab only while that mod is loaded. Written chapters like the ones below (MOD_VOY_JOURNAL_CH_CREW_*).
 */
export const JOURNAL_CREW = ['crew_hire', 'crew_ranks', 'crew_pay', 'crew_tips'];
/**
 * The first spread of How it works (build .179): the Old Man's chart and the
 * Manifest face each other before the foreword, so chapter spreads start at 1. Chapters keep their folios (i, ii, ...
 * from their place in the list); only the spread they sit on moves.
 */
export const FIRST_SPREADS = 1;
/** A folio in small roman numerals (the list stopped at xvi until build .220, so chapters 17 on read "17"). */
export function roman(n) {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return `${n}`;
  let out = '';
  for (const [v, s] of [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]) {
    while (n >= v) { out += s; n -= v; }
  }
  return out;
}
/** The How it works spread a chapter (index in the shown list) sits on, and how many spreads `count` chapters take. */
export const chapterSpread = (i) => FIRST_SPREADS + Math.floor(i / 2);
export const howSpreads = (count) => FIRST_SPREADS + Math.ceil(count / 2);
/**
 * The book-only chapters: their sections, each a heading and lines in en.json
 * (MOD_VOY_JOURNAL_CH_<CHAPTER>_<SECTION>_HEAD / _BODY, lines split on "\n"). `points`: the lines are a list.
 * `warn`: sections drawn with the amber edge. 'adventure' adds the live first-fight table (compass.mjs firstSteps).
 */
export const JOURNAL_WRITTEN = {
  // The lore (build .116): whose book this was, and the last page with the lighthouse.
  foreword: { sections: ['WHO', 'BOOK', 'YOU'] },
  lighthouse: { sections: ['LAST', 'LIGHT'] },
  crew_hire: { sections: ['START', 'WORKER', 'PORT'] },
  crew_ranks: { sections: ['TIERS', 'LICENCES', 'PROMOTE'] },
  crew_pay: { sections: ['WAGES', 'GRACE', 'STRIKE', 'EASIER'], warn: ['STRIKE'] },
  crew_tips: { sections: ['OWN'], points: true },
  map: { sections: ['TINT', 'PANEL', 'KEYS', 'MARKS'] },
  lands: { sections: ['KINDS', 'FEATURES'] },
  tricks: { sections: ['STORES', 'BOAT', 'TRADE', 'NIGHT', 'WAY', 'PAGE'], points: true },
  settings: { sections: ['EASIER', 'KEYS', 'WHY'] },
  leaving: { sections: ['WHAT', 'HOW'], warn: ['WHAT'] },
  adventure: { sections: ['FIRST', 'NEXT'] },
  road: { sections: ['MOUNTS', 'SIGN'] },
  // The ship's clock (phase 5a, build .219).
  clock: { sections: ['PACE', 'WAY', 'LAND', 'ASK', 'FOG', 'AWAY', 'OFF'] },
  // The weather (phase 5c-1).
  weather: { sections: ['SEASON', 'BANDS', 'HARVEST', 'ICE', 'WIND', 'RARE', 'OFF'] },
};

/**
 * Guide pages that carry a whole account under their lesson (build .231, the user: "Move not yet written entries to
 * the Guides? We have all the pages with triggers there", then "partial merge and new guide pages"). Each section is
 * the old chapter's, MOD_VOY_JOURNAL_CH_<from>_<SECTION>_HEAD / _BODY, so the text did not move. Each page is written
 * when its account is first needed: cargo and board with the first harbour board opened (board also with a notice
 * taken or a chart read, for older saves), market by the first market, rumour with the first rumour, planning at the
 * planner's level. `points: false`: the page has no lesson points of its own.
 */
export const JOURNAL_GUIDE_SECTIONS = {
  cargo: { from: 'CARGO', sections: ['BOARD', 'TRADE', 'LOAD', 'DELIVER', 'DROP'] },
  board: { from: 'NOTICES', sections: ['TASKS', 'ONE', 'CHARTS'], points: false },
  market: { from: 'MARKETS', sections: ['PRICES', 'LEARN'] },
  rumour: { from: 'NOTICES', sections: ['RUMOURS'] },
  planning: { from: 'PLANNING', sections: ['WHERE', 'STOPS', 'CHARTS'], points: false },
};

/**
 * The "Did you know?" slips (build .127, the user's ask): a real-world sea fact the captain is reminded of by something
 * he saw, one per chapter, drawn before the chapter's note (MOD_VOY_JOURNAL_ASIDE_<KEY>_HEAD / _BODY).
 */
export const JOURNAL_ASIDES = { stores: 'LIMES', travels: 'KNOTS', tricks: 'MILKY' };

/**
 * The chapters that end with a note (MOD_VOY_JOURNAL_CH_<CHAPTER>_NOTE). Build .137, the user's pick: the author's notes
 * ("A note from the one who named the land") only where they say something, plus the captain's own (stores, ship,
 * hold); the other pages end on their text.
 */
export const JOURNAL_NOTES = ['foreword', 'lands', 'stores', 'ship', 'hold', 'travels', 'compass', 'settings', 'lighthouse', 'crew_pay'];

/** The book's bookmark tabs, in order (src/journal.mjs). */
export const JOURNAL_TABS = ['how', 'resources', 'places', 'guide', 'crew'];

/**
 * Worker Folks: Hiring's numbers for the crew pages, as of its version 1.1.0 (its src/pricing.mjs, wages.mjs,
 * shop-data.mjs; Standard difficulty). That mod has no API to read them from, so they are copied: check them when it
 * changes. Rank names and the tips are read live from its language keys (MOD_WF_ROLE_<tier>, MOD_WF_TIP_<n>).
 */
export const CREW_SKILL_ID = 'worker_folks:Hiring';
export const CREW_TIERS = [
  { tier: 'Newbie', rate: 60, wage: 75e3, hire: 5e5 },
  { tier: 'Junior', rate: 80, wage: 3e5, hire: 2.5e6 },
  { tier: 'Middle', rate: 100, wage: 1e6, hire: 1e7 },
  { tier: 'Senior', rate: 120, wage: 3e6, hire: 4e7 },
  { tier: 'Expert', rate: 140, wage: 8e6, hire: 1.2e8 },
];
export const CREW_LICENCES = [
  { tier: 'Newbie', level: 0, gp: 2.5e6, dungeon: 'melvorD:Frozen_Cove' },
  { tier: 'Junior', level: 20, gp: 2.5e7, dungeon: 'melvorD:Volcanic_Cave' },
  { tier: 'Middle', level: 40, gp: 1e8, dungeon: 'melvorF:Air_God_Dungeon' },
  { tier: 'Senior', level: 60, gp: 4e8, dungeon: 'melvorF:Fire_God_Dungeon' },
  { tier: 'Expert', level: 80, gp: 1e9, dungeon: 'melvorF:Into_the_Mist' },
];
/** Worker Folks' own tips, MOD_WF_TIP_<n>_HEAD / MOD_WF_TIP_<n>, n = 1..12; the crew page lists the ones it finds. */
export const CREW_TIPS = 12;
/** 2500000 -> "2.5M", 75000 -> "75k". */
export const shortGp = (n) => {
  const f = (x, unit) => `${Number.isInteger(x) ? x : x.toFixed(1).replace(/\.0$/, '')}${unit}`;
  if (n >= 1e9) return f(n / 1e9, 'B');
  if (n >= 1e6) return f(n / 1e6, 'M');
  if (n >= 1e3) return f(n / 1e3, 'k');
  return `${n}`;
};

/**
 * Crosslinks in the book's own texts (build .113, the user's ask): `[[ch:stores|Victuals and fuel]]` opens a chapter,
 * `[[guide:zone|...]]` a guide page, `[[tab:places|Places]]` a tab. Only MOD_VOY_JOURNAL_ texts may carry them (other
 * screens would show the brackets); tests/lang-keys.test.mjs checks every target.
 */
export const LINK_KINDS = ['ch', 'guide', 'tab'];
const LINK_RE = /\[\[([a-z]+):([a-z_]+)\|([^\]|]+)\]\]/g;
/** Text split into plain pieces `{ text }` and links `{ kind, id, text }`, in order. */
export function splitLinks(text) {
  const s = String(text);
  const out = [];
  let last = 0;
  for (const m of s.matchAll(LINK_RE)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    out.push({ kind: m[1], id: m[2], text: m[3] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}
/** True when a link's target exists in the book. `guides` is the list of guide page ids (voyage-model.mjs). */
export function linkTargetExists(kind, id, guides) {
  if (kind === 'ch') return JOURNAL_CHAPTERS.includes(id);
  if (kind === 'guide') return guides.includes(id);
  if (kind === 'tab') return JOURNAL_TABS.includes(id);
  return false;
}

export const hexStr = (q, r) => `${q},${r}`;
export function parseHex(s) {
  const [q, r] = String(s).split(',').map(Number);
  return Number.isInteger(q) && Number.isInteger(r) ? { q, r } : undefined;
}
export const hexDistance = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;

/**
 * Notes that `actionId` worked on (q, r). Returns 'new' for the action's first hex, 'more' for another one, undefined
 * when the hex was already there. Past `limit` hexes the ones nearest to `start` stay, so a long run
 * of finds far away never pushes out the places near home. A found hex is no longer a miss.
 */
export function addFound(journal, actionId, q, r, start, limit) {
  const key = hexStr(q, r);
  const list = journal.found[actionId] ?? [];
  if (list.includes(key)) return undefined;
  const first = list.length === 0;
  list.push(key);
  if (list.length > limit) {
    const from = start ?? { q, r };
    list.sort((a, b) => hexDistance(parseHex(a), from) - hexDistance(parseHex(b), from));
    list.length = limit;
  }
  journal.found[actionId] = list;
  const missed = journal.missed[actionId];
  if (missed !== undefined) {
    const i = missed.indexOf(key);
    if (i >= 0) missed.splice(i, 1);
    if (missed.length === 0) delete journal.missed[actionId];
  }
  return first ? 'new' : 'more';
}

/** Notes that the zone of `actionId` refused (q, r). The oldest miss goes past `limit`. True when it is new. */
export function addMiss(journal, actionId, q, r, limit) {
  const key = hexStr(q, r);
  if (journal.found[actionId]?.includes(key)) return false;
  const list = journal.missed[actionId] ?? [];
  if (list.includes(key)) return false;
  list.push(key);
  while (list.length > limit) list.shift();
  journal.missed[actionId] = list;
  return true;
}

/** Notes a place by kind and id at the hex it was first met on. True when it is new. */
export function addPlace(journal, kind, id, q, r) {
  const key = `${kind}|${id}`;
  if (journal.places[key] !== undefined) return false;
  journal.places[key] = hexStr(q, r);
  return true;
}

/**
 * Counts one deed at a port (`load`, `deliver`, `chart`, `take`, `hand`: voyage-model PORT_DEEDS) and notes the port
 * as a place used, at its hex (phase 4 wrap-up). True when the port is new to the journal.
 */
export function notePort(journal, poi, deed, q, r) {
  journal.ports ??= {};
  const deeds = (journal.ports[poi] ??= {});
  deeds[deed] = (deeds[deed] ?? 0) + 1;
  return addPlace(journal, 'port', poi, q, r);
}

/** The places of one kind: [{ id, q, r }], in the order they were met. */
export function placesOf(journal, kind) {
  const out = [];
  for (const [key, hex] of Object.entries(journal.places)) {
    const bar = key.indexOf('|');
    if (key.slice(0, bar) !== kind) continue;
    const h = parseHex(hex);
    if (h !== undefined) out.push({ id: key.slice(bar + 1), ...h });
  }
  return out;
}

/** Writes a guide page. True when it was not written yet; ids outside `known` are refused. */
export function learn(journal, guideId, known) {
  if (!known.includes(guideId) || journal.guides.includes(guideId)) return false;
  journal.guides.push(guideId);
  return true;
}

/** The hexes of a list ("q,r" strings) with their distance from `from`, nearest first. */
export function byDistance(list, from) {
  return (list ?? []).map(parseHex).filter((h) => h !== undefined)
    .map((h) => ({ ...h, distance: from === undefined ? 0 : hexDistance(h, from) }))
    .sort((a, b) => a.distance - b.distance);
}

/** Lower case, accents and punctuation folded away, so "raw shark" finds "Raw Shark" and "Shark". */
export const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Search (item names as well as action names). `entries` are [{ id, names: [...], skill? }]: an
 * action's own name, the names of the items it gives, and its skill's name. Every word of the query must start a word of one name. Returns the
 * ids in entry order.
 */
export function search(entries, query) {
  const words = fold(query).split(' ').filter((w) => w !== '');
  if (words.length === 0) return entries.map((e) => e.id);
  // The skill's name counts with every name (build .114, the user's ask): "mining" lists every Mining entry, "mining
  // cop" finds Copper.
  return entries.filter((e) => {
    const skill = e.skill === undefined ? [] : fold(e.skill).split(' ');
    return e.names.some((n) => {
      const parts = [...fold(n).split(' '), ...skill];
      return words.every((w) => parts.some((p) => p.startsWith(w)));
    });
  }).map((e) => e.id);
}

// ---------------------------------------------------------------- charting (build .116)
/** The reveal item of each zoned skill: item local id in the voyage namespace (data/package.json). */
export const CHART_ITEMS = {
  'melvorD:Mining': 'Prospectors_Notes',
  'melvorD:Woodcutting': 'Foresters_Survey',
  'melvorD:Fishing': 'Anglers_Log',
  'melvorD:Farming': 'Farmers_Almanac',
  'melvorD:Thieving': 'Fences_Ledger',
  'melvorD:Astrology': 'Star_Chart',
};
/** A reveal item comes about once per this many hours of its skill (the user, 17 Oct 2026). */
export const REVEAL_HOURS = 504;
/**
 * The chance of a reveal item on one completed zoned action that took `intervalMs`: interval / 3 weeks, so fast and
 * slow actions pay the same per hour (a 3 s action: 1 in 604,800). Replaced the Voyage-level rate of 4.26 (1 in
 * 20,000 rising to 1 in 10,000) in build .210.
 */
export const chartChance = (intervalMs) => (Number.isFinite(intervalMs) && intervalMs > 0 ? Math.min(1, intervalMs / (REVEAL_HOURS * 3600000)) : 0);
/** Free charts reached at `level` and not used yet. */
export const freeChartsLeft = (level, used, levels) => Math.max(0, levels.filter((l) => level >= l).length - used);
/** Charts an action. True when it was not charted yet. */
export function chart(journal, actionId) {
  if (journal.charted.includes(actionId)) return false;
  journal.charted.push(actionId);
  return true;
}

// ---------------------------------------------------------------- unread marks (build .116, the user's ask)
// Every entry, place and guide page that is new or changed since it was last read carries a mark: "New" or "Updated".
// Keys: "a:<action id>" (a resource entry), "p:<kind|id>" (a place), "g:<guide id>" (a guide page).
/** Marks a key unread. A key already marked 'new' stays 'new' until read; the newest goes last. */
export function markUnread(journal, key, kind, max) {
  const was = journal.unread[key];
  delete journal.unread[key];
  journal.unread[key] = was === 'new' ? 'new' : kind;
  const keys = Object.keys(journal.unread);
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) delete journal.unread[k];
}
/** Clears a key's mark. True when there was one. */
export function markRead(journal, key) {
  if (journal.unread[key] === undefined) return false;
  delete journal.unread[key];
  return true;
}
/** How many unread keys start with `prefix` ('a:', 'p:', 'g:'), or all of them. */
export const unreadCount = (journal, prefix = '') => Object.keys(journal.unread).filter((k) => k.startsWith(prefix)).length;

/**
 * The book's prose marks (the user, 19 Oct 2026: "Plain text is hard to read ... design those as well"): a text's lines
 * as blocks, so a long account reads like the pages with ledgers. A line "- x" is a point (consecutive points one
 * list), rows "| a | b |" one ledger (the first row its heads), "> x" a pencilled note; any other line a paragraph.
 * Returns [{ kind: 'p' | 'note', text } | { kind: 'points', items } | { kind: 'table', head, rows }].
 */
export function proseBlocks(lines) {
  const out = [];
  // A cell may hold a crosslink, [[ch:clock|The ship's clock]]: its bar is not a column.
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/\|(?![^[]*\]\])/).map((c) => c.trim());
  for (const raw of lines ?? []) {
    const line = String(raw);
    if (line.trim() === '') continue;
    const last = out[out.length - 1];
    if (/^\s*- /.test(line)) {
      const item = line.replace(/^\s*- /, '');
      if (last?.kind === 'points') last.items.push(item); else out.push({ kind: 'points', items: [item] });
    } else if (/^\s*\|.*\|\s*$/.test(line)) {
      if (last?.kind === 'table') last.rows.push(cells(line)); else out.push({ kind: 'table', head: cells(line), rows: [] });
    } else if (/^\s*> /.test(line)) out.push({ kind: 'note', text: line.replace(/^\s*> /, '') });
    else out.push({ kind: 'p', text: line });
  }
  return out;
}
