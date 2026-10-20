// Worker Folks: Hiring's API (mod.api.worker_folks), read by Voyage for phase 6. Voyage drives Folks only through an
// API it knows: an older Worker Folks (none, or a lower version) is left alone, said once in the console.

/** The lowest Worker Folks API version Voyage drives (6a: guards, places, events; 6b: workerOf, location text; 6c: skills, assign, hurt). */
export const FOLKS_API_MIN = 3;

/** The API when it is there and new enough, else undefined. `warn` is told once why an older one is skipped. */
// The game declares `mod` with a top-level let: a global name, but not a property of globalThis (build .314 check).
const gameMods = () => (typeof mod === 'undefined' ? undefined : mod);

export function folksApi({ mods = gameMods(), warn = () => {} } = {}) {
  let api;
  try { api = mods?.api?.worker_folks; } catch { return undefined; }
  if (api === undefined || api === null || typeof api !== 'object') return undefined;
  if (typeof api.version !== 'number' || api.version < FOLKS_API_MIN) {
    warn(`Worker Folks API ${api.version ?? '(none)'} is older than ${FOLKS_API_MIN}: Folks stay as they are`);
    return undefined;
  }
  if (typeof api.registerGuard !== 'function') return undefined;
  return api;
}

/** A Folk's rank as Worker Folks names it (Trainee … Foreman); the tier id where its texts aren't loaded. */
export function rankName(tier) {
  const key = `MOD_WF_ROLE_${tier}`;
  try { const s = getLangString(key); return typeof s === 'string' && s !== '' && !s.includes(key) ? s : tier; } catch { return tier; }
}

const FOLK_STATUS = { idle: 'MOD_VOY_PANEL_FOLK_IDLE', strike: 'MOD_VOY_PANEL_FOLK_STRIKE', cooldown: 'MOD_VOY_PANEL_FOLK_REST', debt: 'MOD_VOY_PANEL_FOLK_DEBT' };
/** What a Folk is doing, in a word or two: Idle, On strike, Resting, Owes wages, or its skill's name. */
export function folkDoing(f) {
  try {
    const key = FOLK_STATUS[f.status];
    if (key !== undefined) return getLangString(key);
    return game.skills.getObjectByID(f.skillId ?? '')?.name ?? getLangString('MOD_VOY_PANEL_FOLK_IDLE');
  } catch { return ''; }
}
