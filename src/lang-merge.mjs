/** Items whose name and description come from MOD_VOY_ITEM_<ID>_NAME / _DESC at load. */
export const TEXT_ITEMS = ['Sack', 'Crate', 'Grapeshot', 'Smoke_Pot', 'Hot_Meal', 'Curing_Salt', 'Bitter_Draught_I', 'Bitter_Draught_II', 'Bitter_Draught_III', 'Bitter_Draught_IV', 'Torn_Map', 'Weathered_Chart', 'Captains_Map'];
/** Shop entries with a name of their own: MOD_VOY_SHOP_<ID>_NAME / _DESC. */
export const TEXT_SHOP = ['Sturdy_Boots', 'Pack_Yak', 'Riding_Horse', 'Unicorn', 'Crossroads_Sign', 'Walking_Orders', 'Couriers_Licence', 'Supply_Contracts', 'Dry_Casks'];

// Pure helper: merge mod language strings into a game language object.
export function mergeLang(target, extra) {
  if (target == null || typeof target !== 'object') return target;
  if (extra == null || typeof extra !== 'object') return target;
  for (const [key, value] of Object.entries(extra)) {
    if (typeof value === 'string') target[key] = value;
  }
  return target;
}

/** A translation laid over the English, as a new object: a key it lacks or leaves empty still reads in English. */
export function overEnglish(en, translated) {
  const out = { ...(en ?? {}) };
  if (translated == null || typeof translated !== 'object') return out;
  for (const [key, value] of Object.entries(translated)) {
    if (typeof value === 'string' && value !== '') out[key] = value;
  }
  return out;
}

// German place names from the game carry their own article ("Der überschattete Hafen"), which reads wrong after a
// preposition ("bei Der überschattete Hafen"). After one, such a name goes in quotes: bei „Der überschattete Hafen“
// (the user, 28 Nov 2026).
const DE_ARTICLE = /^((?:<[^>]*>)*)((?:Der|Die|Das) [^<]*)((?:<\/[^>]*>)*)$/;
const DE_PREPOSITION = /(?:^|[\s(])(?:bei|beim|in|im|nach|von|vom|zu|zum|zur|aus|an|am|auf|vor|für|mit|über|unter|gegen|um|ab|bis|durch|hinter|neben|zwischen|seit|ohne|gen)\s+$/i;

/**
 * The template's values with every German name that starts with an article quoted where it follows a preposition in
 * `template` (markup between them is ignored). Other values, and names nowhere after a preposition, are left as they are.
 */
export function quoteGermanNames(template, vars) {
  if (typeof template !== 'string' || vars == null || typeof vars !== 'object') return vars;
  let out = vars;
  for (const [name, value] of Object.entries(vars)) {
    if (typeof value !== 'string') continue;
    const m = DE_ARTICLE.exec(value);
    if (m === null) continue;
    const mark = `\${${name}}`;
    let at = template.indexOf(mark);
    let after = false;
    while (at >= 0 && !after) {
      after = DE_PREPOSITION.test(template.slice(0, at).replace(/(?:<[^>]*>)+$/, ''));
      at = template.indexOf(mark, at + mark.length);
    }
    if (!after) continue;
    if (out === vars) out = { ...vars };
    out[name] = `${m[1]}„${m[2]}“${m[3]}`;
  }
  return out;
}
