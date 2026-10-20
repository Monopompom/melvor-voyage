// Worker Folks: Hiring's API (mod.api.worker_folks), read by Voyage for phase 6. Voyage drives Folks only through an
// API it knows: an older Worker Folks (none, or a lower version) is left alone, said once in the console.

/** The lowest Worker Folks API version Voyage drives (6a: guards, places, events). */
export const FOLKS_API_MIN = 1;

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
