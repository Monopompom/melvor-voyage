// Every language key the code names must be in languages/en.json (Translatable text). Literal keys are found by
// scanning the sources; keys built at run time (`MOD_VOY_DIR_${dir}`) are listed in FAMILIES with their members.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as terrain from '../src/terrain.mjs';
import * as rules from '../src/rules.mjs';
import { JOURNAL_GUIDES } from '../src/voyage-model.mjs';
import { RESCUES, TOW_KINDS } from '../src/adrift-model.mjs';
import { SEASONS, BANDS } from '../src/weather-model.mjs';
import { TRAITS as TRAVEL_TRAITS } from '../src/folk-traits-model.mjs';
import { JOURNAL_CHAPTERS, JOURNAL_CREW, JOURNAL_WRITTEN, JOURNAL_GUIDE_SECTIONS, JOURNAL_ASIDES, JOURNAL_NOTES, CHART_ITEMS, splitLinks, linkTargetExists } from '../src/journal-model.mjs';

const root = new URL('../', import.meta.url);
const en = JSON.parse(readFileSync(new URL('languages/en.json', root), 'utf8'));
const sources = [
  'setup.mjs',
  ...readdirSync(new URL('src/', root)).filter((f) => f.endsWith('.mjs') && f !== 'dev.mjs').map((f) => `src/${f}`),
  'ui/templates.html',
];
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const localIds = Object.keys(rules.SKILL_RULES).map((id) => id.split(':').pop());
export const FAMILIES = {
  // the travel traits (phase 6f, src/folk-traits.mjs): name, effect, and how a bad one fades
  MOD_VOY_TRAIT_: TRAVEL_TRAITS.flatMap((tr) => [tr.id, `${tr.id}_DESC`, ...(tr.fade === undefined ? [] : [`${tr.id}_FADES`])]),
  MOD_VOY_DIR_: DIRS,
  MOD_VOY_DIR_SHORT_: DIRS,
  MOD_VOY_TERRAIN_: [...Object.keys(terrain.CLASS_INFO), 'CLOUD', 'ICE'],
  MOD_VOY_WX_SEASON_: SEASONS.map((s) => s.toUpperCase()),
  MOD_VOY_WX_BAND_: BANDS.map((b) => b.id.toUpperCase()),
  MOD_VOY_WX_PAGE_: [...SEASONS.map((s) => s.toUpperCase()), 'LEFT', 'FROM_TOWN'],
  MOD_VOY_FEATURE_: Object.keys(terrain.FEATURE_INFO),
  MOD_VOY_RULE_NOUN_: [...localIds, 'DEFAULT'],
  MOD_VOY_COMPASS_WORD_: ['HOT', 'WARM', 'COLD', 'FREEZING'],
  MOD_VOY_HULL_NAME_: ['DINGHY', 'LONGBOAT', 'BRIG', 'GALLEON'],
  MOD_VOY_HULL_BLURB_: ['DINGHY', 'LONGBOAT', 'BRIG', 'GALLEON'],
  MOD_VOY_HULL_TIER_: ['1', '2', '3', '4'],
  MOD_VOY_ISLAND_: ['WESTERN', 'GOLDEN', 'FROST', 'CURSED', 'OMINOUS', 'MAINLAND'],
  MOD_VOY_MILESTONE_: ['1', '2', '3', 'LONGBOAT', 'BRIG', 'GALLEON'], // LONGBOAT, GALLEON, BRIG: shipModel.UPGRADES, BIG_SHIPS (setup.mjs)
  // the six charts (build .116, setup.mjs): MOD_VOY_ITEM_<ID>_NAME / _DESC
  MOD_VOY_ITEM_: Object.values(CHART_ITEMS).flatMap((id) => [`${id.toUpperCase()}_NAME`, `${id.toUpperCase()}_DESC`]),
  MOD_VOY_PAGE_COMPASS_STAGE_: ['1', '2', '3'],
  // the Captain's Journal (src/journal.mjs): chapters, guide pages, place groups
  MOD_VOY_JOURNAL_CH_: [
    ...[...JOURNAL_CHAPTERS, ...JOURNAL_CREW].map((c) => c.toUpperCase()).flatMap((c) => [`${c}_TITLE`, `${c}_INTRO`]),
    ...JOURNAL_NOTES.map((c) => `${c.toUpperCase()}_NOTE`),
    ...Object.entries(JOURNAL_WRITTEN).flatMap(([c, spec]) => spec.sections.flatMap((x) => [`${c.toUpperCase()}_${x}_HEAD`, `${c.toUpperCase()}_${x}_BODY`])),
    // the old chapters' sections, now under their guide pages (build .231)
    ...Object.values(JOURNAL_GUIDE_SECTIONS).flatMap((spec) => spec.sections.flatMap((x) => [`${spec.from}_${x}_HEAD`, `${spec.from}_${x}_BODY`])),
    'MAP_KEYS_BODY_OFF',
    'FOREWORD_BOOK_BODY_OFF',
  ],
  MOD_VOY_JOURNAL_GUIDE_: JOURNAL_GUIDES.flatMap((g) => ['TITLE', 'BODY', ...(JOURNAL_GUIDE_SECTIONS[g]?.points === false ? [] : ['POINTS'])].map((x) => `${g.toUpperCase()}_${x}`)),
  // the Did you know slips (journal-model.mjs JOURNAL_ASIDES)
  MOD_VOY_JOURNAL_ASIDE_: Object.values(JOURNAL_ASIDES).flatMap((k) => [`${k}_HEAD`, `${k}_BODY`]),
  MOD_VOY_JOURNAL_PLACES_: ['COMBAT', 'TRADE', 'POI', 'PORT', 'ISLAND', 'OUTPOST'],
  // Ports used (phase 4 wrap-up, journal.mjs portDeeds): voyage-model PORT_DEEDS
  MOD_VOY_JOURNAL_PORT_: ['LOAD', 'DELIVER', 'CHART', 'TAKE', 'HAND'],
  // The shipwright's bill (build .178, journal.mjs shipBill).
  MOD_VOY_JOURNAL_BILL_WHERE_: ['DINGHY', 'LONGBOAT', 'BRIG', 'GALLEON'],
  MOD_VOY_JOURNAL_BILL_REBUILT_: ['LONGBOAT', 'GALLEON'],
  // Plan a voyage (src/planner.mjs VERDICT): the verdicts named by a plan's reason
  MOD_VOY_PLAN_VERDICT_: ['SHORT', 'FOOD', 'FUEL', 'ASHORE', 'HULL', 'NOWAY', 'UNCHARTED', 'HERE'],
  // Rumours (src/charts.mjs): the tales by kind, and the bank's Read line
  MOD_VOY_RUMOUR_TALE_: ['TAVERN', 'SAILOR'].flatMap((k) => [1, 2, 3, 4].map((n) => `${k}_${n}`)),
  MOD_VOY_RUMOUR_READ_: ['TAVERN', 'SAILOR', 'TITLE'],
  // Adrift (5b part two, src/adrift.mjs): why, the sea folk's popups and lines, who tows, what ended it
  MOD_VOY_ADRIFT_WHY_: ['FOOD', 'GP', 'HULL'],
  MOD_VOY_ADRIFT_RESCUE_: RESCUES.flatMap((r) => ['TITLE', 'BODY', 'OFFLINE'].map((x) => `${r.id.toUpperCase()}_${x}`)),
  MOD_VOY_ADRIFT_TOW_BY_: TOW_KINDS.map((k) => k.toUpperCase()),
  MOD_VOY_ADRIFT_ENDED_BY_: ['KRAKEN', 'NOODLE'],
  MOD_VOY_RULE_LABEL_: localIds.filter((id, i) => rules.ruleLabelKey(Object.keys(rules.SKILL_RULES)[i]) !== undefined),
};

test('every literal key in the sources is in en.json', () => {
  const missing = [];
  for (const file of sources) {
    const text = readFileSync(new URL(file, root), 'utf8');
    for (const [key] of text.matchAll(/\b(?:MOD_VOY_[A-Z0-9_]*[A-Z0-9]|SKILL_NAME_Voyage)\b/g)) {
      if (Object.keys(FAMILIES).includes(`${key}_`) || Object.keys(FAMILIES).includes(key)) continue;
      if (!(key in en)) missing.push(`${file}: ${key}`);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

test('every key family is complete in en.json', () => {
  const missing = [];
  for (const [prefix, members] of Object.entries(FAMILIES)) for (const m of members) if (!(`${prefix}${m}` in en)) missing.push(`${prefix}${m}`);
  assert.deepEqual(missing, []);
});

test('en.json values are non-empty strings', () => {
  for (const [key, value] of Object.entries(en)) assert.ok(typeof value === 'string' && value.length > 0, key);
});

test('labels kept in the pure modules match en.json', () => {
  for (const [cls, info] of Object.entries(terrain.CLASS_INFO)) assert.equal(en[terrain.classKey(cls)], info.label, cls);
  assert.equal(en[terrain.CLOUD_KEY], terrain.CLOUD_INFO.label);
  for (const [f, info] of Object.entries(terrain.FEATURE_INFO)) assert.equal(en[terrain.featureKey(f)], info.label, f);
  for (const id of Object.keys(rules.SKILL_RULES)) {
    assert.equal(en[rules.ruleNounKey(id)], rules.ruleNoun(id), id);
    const k = rules.ruleLabelKey(id);
    if (k !== undefined) assert.equal(en[k], rules.ruleLabel(id), id);
  }
});

test('every key in en.json is used', () => {
  const text = sources.map((file) => readFileSync(new URL(file, root), 'utf8')).join('\n');
  const used = (key) => new RegExp(`\\b${key}\\b`).test(text)
    || Object.entries(FAMILIES).some(([prefix, members]) => members.some((m) => `${prefix}${m}` === key))
    || key === 'MOD_VOY_RULE_NOUN_DEFAULT';
  assert.deepEqual(Object.keys(en).filter((k) => !used(k)), []);
});

test('journal crosslinks: only in journal texts, every target in the book, no stray brackets', () => {
  const bad = [];
  for (const [key, value] of Object.entries(en)) {
    const links = splitLinks(value).filter((p) => p.kind !== undefined);
    const stray = splitLinks(value).some((p) => p.kind === undefined && /\[\[|\]\]/.test(p.text));
    if (stray) bad.push(`${key}: malformed link`);
    if (links.length > 0 && !key.startsWith('MOD_VOY_JOURNAL_')) bad.push(`${key}: links outside the journal`);
    for (const l of links) if (!linkTargetExists(l.kind, l.id, JOURNAL_GUIDES)) bad.push(`${key}: ${l.kind}:${l.id}`);
  }
  assert.deepEqual(bad, []);
});
