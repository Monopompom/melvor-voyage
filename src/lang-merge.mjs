// Pure helper: merge mod language strings into a game language object.
export function mergeLang(target, extra) {
  if (target == null || typeof target !== 'object') return target;
  if (extra == null || typeof extra !== 'object') return target;
  for (const [key, value] of Object.entries(extra)) {
    if (typeof value === 'string') target[key] = value;
  }
  return target;
}
