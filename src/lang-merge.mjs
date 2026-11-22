/** Items whose name and description come from MOD_VOY_ITEM_<ID>_NAME / _DESC at load. */
export const TEXT_ITEMS = ['Sack', 'Crate', 'Grapeshot', 'Smoke_Pot', 'Hot_Meal', 'Curing_Salt', 'Bitter_Draught_I', 'Bitter_Draught_II', 'Bitter_Draught_III', 'Bitter_Draught_IV'];
/** Shop entries with a name of their own: MOD_VOY_SHOP_<ID>_NAME / _DESC. */
export const TEXT_SHOP = ['Sturdy_Boots', 'Pack_Yak', 'Riding_Horse', 'Unicorn', 'Crossroads_Sign', 'Walking_Orders', 'Dry_Casks'];

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
