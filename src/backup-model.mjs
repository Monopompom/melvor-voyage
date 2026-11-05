// Voyage backup codes (the user, 5 Nov 2026: "Export code only"; an automatic copy felt intrusive). The game keeps a
// skill's save only while its mod is loaded: a save made with Voyage off, uninstalled or failing to load throws the
// Voyage block away, and with it Voyage's bank items and shop purchases (the game keeps placeholders for its own items
// only). A backup is the player's own copy of all of it, made and restored by hand from the Voyage page's foot.
//
// Pure: the backup's shape, its checksum, the text code (deflated and base64), its checks on the way back in, and what
// a restore adds. The game side (reading the bank, the popups, saving and reloading) is src/backup.mjs; covered by
// tests/backup-model.test.mjs.

/** The code's first word, so a pasted text is known for what it is. `z` deflated, `j` plain JSON (no CompressionStream). */
export const PREFIX = 'VOYAGE-BACKUP';
export const FORMAT = 1;

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const count = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** FNV-1a, 32 bits, as 8 hex digits: a typo or a cut code, not tampering (the player owns the save anyway). */
export function checksum(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Only whole positive counts under `ns:` ids: the bank's items or the shop's purchases of one namespace. */
export function counts(map, ns = 'voyage') {
  const out = {};
  if (!isObj(map)) return out;
  for (const [id, n] of Object.entries(map)) if (id.startsWith(`${ns}:`) && count(n) > 0) out[id] = count(n);
  return out;
}

/**
 * Why a backup can't be made now, or undefined: a voyage under way or Adrift run on the real clock, so a copy of one
 * restored later would arrive at once or drift for nothing. Ashore or in port it is all on the game clock.
 */
export function blockedBy(record) {
  if (!isObj(record)) return 'empty';
  if (record.voyage != null) return 'voyage';
  if (record.adrift != null) return 'adrift';
  return undefined;
}

// ---- Worker Folks' side ------------------------------------------------------------------------------------------
// With Worker Folks loaded, Voyage's save and Folks' own hold two halves of one story: Voyage keeps the walks, the kept
// jobs, the tents going up and the travel-trait counts by Folk id; Worker Folks keeps each Folk's hex, its travel
// ('idle', 'with' you, 'walking' alone) and the Voyage traits it learned. A backup takes Folks' half too, so a restore
// puts the Folks back where the restored Voyage expects them. Without Worker Folks there is no half to take (null).

const TRAVEL = ['idle', 'with', 'walking'];
const FOLKS_MAX = 64;
const TRAITS_MAX = 24;
const isHex = (h) => isObj(h) && Number.isInteger(h.q) && Number.isInteger(h.r);
const hexCopy = (h) => (isHex(h) ? { q: h.q, r: h.r } : null);
const sameHex = (a, b) => (a === null ? b === null : b !== null && a.q === b.q && a.r === b.r);
/** A Folk's Voyage traits only ('voyage:…'), held and waiting alike, without repeats. */
const voyageTraits = (list) => [...new Set((Array.isArray(list) ? list : []).filter((x) => typeof x === 'string' && x.startsWith('voyage:') && x.length <= 80))].slice(0, TRAITS_MAX);

/** The Folks part of a backup: [{ id, name, place, travel, traits }], junk dropped; null when there was no Worker Folks. */
export function cleanFolks(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  const seen = new Set();
  for (const f of list) {
    if (out.length >= FOLKS_MAX) break;
    if (!isObj(f) || typeof f.id !== 'string' || f.id === '' || f.id.length > 80 || seen.has(f.id)) continue;
    seen.add(f.id);
    out.push({ id: f.id, name: typeof f.name === 'string' ? f.name.slice(0, 60) : '', place: hexCopy(f.place), travel: TRAVEL.includes(f.travel) ? f.travel : 'idle', traits: voyageTraits(f.traits) });
  }
  return out;
}

/**
 * What a restore does to Worker Folks: `now` the Folks there are now ({ id, name, place, travel, traits }, traits held
 * and waiting), `walks` the restored record's walks ({ folkId: walk }). Matched by id (Worker Folks never reuses one):
 * - `moves` [{ id, name, place, travel }]: a Folk back on its hex and travel. One walking in the backup whose walk the
 *   record doesn't hold stands still instead.
 * - `earn`, `drop` [[id, traitId]]: its Voyage traits as they were (other mods' traits untouched).
 * - `halt` [{ id, name }]: a Folk walking now with no walk in the restored record (hired after the backup, or sent
 *   since): it stops where it stands, or it would wait for a walk that is no longer there.
 * - `gone` [name]: Folks in the backup not hired now; Voyage drops their walks, jobs and tents as it finds them.
 * - `back` how many matched. `none` true when the backup was made without Worker Folks: only `halt` applies.
 */
export function folksPlan(backup, now, walks) {
  const roads = isObj(walks) ? walks : {};
  const list = Array.isArray(now) ? now.filter((f) => isObj(f) && typeof f.id === 'string') : [];
  const plan = { moves: [], earn: [], drop: [], halt: [], gone: [], back: 0, none: !Array.isArray(backup?.folks) };
  const byId = new Map(list.map((f) => [f.id, f]));
  const travelAfter = new Map(list.map((f) => [f.id, f.travel]));
  for (const bf of backup?.folks ?? []) {
    const f = byId.get(bf.id);
    if (f === undefined) { plan.gone.push(bf.name || bf.id); continue; }
    plan.back++;
    const travel = bf.travel === 'walking' && !isObj(roads[bf.id]) ? 'idle' : bf.travel;
    travelAfter.set(f.id, travel);
    if (!sameHex(hexCopy(f.place), bf.place) || f.travel !== travel) plan.moves.push({ id: f.id, name: f.name ?? bf.name, place: bf.place, travel });
    const has = voyageTraits(f.traits);
    for (const x of bf.traits) if (!has.includes(x)) plan.earn.push([f.id, x]);
    for (const x of has) if (!bf.traits.includes(x)) plan.drop.push([f.id, x]);
  }
  for (const f of list) if (travelAfter.get(f.id) === 'walking' && !isObj(roads[f.id])) plan.halt.push({ id: f.id, name: f.name ?? f.id });
  return plan;
}

// ---- all of Worker Folks ---------------------------------------------------------------------------------------
// One backup for both mods (the user, 5 Nov 2026: "one ... button backup all"): with a Worker Folks that makes its own
// backups (its API 8), Voyage's code carries Folks' whole code as it is, versioned by Folks, and a restore hands it back
// to Folks first. An older Voyage reading such a code drops the part and restores the rest.

/** Worker Folks' own backup code's first word. */
export const FOLKS_PREFIX = 'FOLKS-BACKUP';
const WHOLE_MAX = 4 * 1024 * 1024;
/** Folks' whole code when it looks like one (its own checks run when Folks reads it), else null. */
export const cleanWhole = (code) => (typeof code === 'string' && code.length <= WHOLE_MAX && code.startsWith(`${FOLKS_PREFIX}:`) ? code : null);

/**
 * The backup: `record` the Voyage save as its JSON text (so the save's own migrations read it back), `xp` the skill's,
 * `items` and `buys` Voyage's bank items and shop purchases ({ id: count }), `settings` the mod's settings by name,
 * `storage` its characterStorage by key, `folks` Worker Folks' side (cleanFolks; null without it), `whole` all of
 * Worker Folks as its own code (cleanWhole; null without it); `name` and `mode` the character, `mod` and `build` who
 * wrote it, `save` the record's version, `at` when (ms).
 */
export function make({ record, xp, items, buys, settings, storage, folks, whole, name, mode, mod, build, save, at }) {
  return {
    f: FORMAT,
    mod: String(mod ?? ''),
    build: String(build ?? ''),
    save: count(save),
    at: count(at),
    name: String(name ?? ''),
    mode: String(mode ?? ''),
    xp: Number.isFinite(xp) && xp > 0 ? xp : 0,
    record: String(record ?? ''),
    items: counts(items),
    buys: counts(buys),
    settings: isObj(settings) ? { ...settings } : {},
    storage: isObj(storage) ? { ...storage } : {},
    folks: cleanFolks(folks),
    whole: cleanWhole(whole),
  };
}

/** The text the code carries: the backup and its checksum. */
export const seal = (backup) => {
  const body = JSON.stringify(backup);
  return JSON.stringify({ body, sum: checksum(body) });
};

/**
 * A sealed text back to a backup: { backup } or { why } ('broken', 'checksum', 'format', 'newer', 'record').
 * `saveVersion` the record version this build reads: a newer one is refused, an older one migrates on restore.
 */
export function open(sealed, saveVersion) {
  let outer;
  try { outer = JSON.parse(sealed); } catch { return { why: 'broken' }; }
  if (!isObj(outer) || typeof outer.body !== 'string' || typeof outer.sum !== 'string') return { why: 'broken' };
  if (checksum(outer.body) !== outer.sum) return { why: 'checksum' };
  let b;
  try { b = JSON.parse(outer.body); } catch { return { why: 'broken' }; }
  if (!isObj(b) || b.f !== FORMAT) return { why: 'format' };
  let rec;
  try { rec = JSON.parse(b.record); } catch { return { why: 'record' }; }
  if (!isObj(rec) || !Number.isInteger(rec.v) || rec.v < 1) return { why: 'record' };
  if (rec.v > saveVersion) return { why: 'newer' };
  return { backup: make(b) };
}

/**
 * What a restore does to the bank and the shop: each item topped up to the backup's count (never doubled by a second
 * restore of the same code, never taking away what was gathered since), each purchase at least the backup's count.
 * `have` { items, buys } now. Returns { add: [[id, n]], buys: [[id, count]] }.
 */
export function restorePlan(backup, have = {}) {
  const now = { items: isObj(have.items) ? have.items : {}, buys: isObj(have.buys) ? have.buys : {} };
  const add = [];
  for (const [id, n] of Object.entries(backup.items)) {
    const more = n - count(now.items[id]);
    if (more > 0) add.push([id, more]);
  }
  const buys = [];
  for (const [id, n] of Object.entries(backup.buys)) if (n > count(now.buys[id])) buys.push([id, n]);
  return { add, buys };
}

// ---- the text code ----------------------------------------------------------------------------------------------
const toB64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64) => {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};
const pipe = async (bytes, stream) => {
  const w = stream.writable.getWriter();
  // A cut code rejects these too; the read below reports it, so they are only quieted here.
  w.write(bytes).catch(() => {});
  w.close().catch(() => {});
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
};
const canZip = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

/** A backup as its code: "VOYAGE-BACKUP:z:<base64>", plain JSON in base64 where the browser can't deflate. */
export async function encode(backup) {
  const bytes = new TextEncoder().encode(seal(backup));
  if (canZip()) return `${PREFIX}:z:${toB64(await pipe(bytes, new CompressionStream('deflate-raw')))}`;
  return `${PREFIX}:j:${toB64(bytes)}`;
}

/**
 * A pasted or loaded code back to { backup } or { why }: 'empty', 'notCode' (not a Voyage backup), 'folks' (Worker
 * Folks' own code: restored on its Hiring page), 'cantUnzip' (a deflated code where the browser can't inflate), or
 * open()'s reasons. Spaces and line breaks in it are ignored.
 */
export async function decode(text, saveVersion) {
  const s = String(text ?? '').replace(/\s+/g, '');
  if (s === '') return { why: 'empty' };
  if (s.startsWith(`${FOLKS_PREFIX}:`)) return { why: 'folks' };
  const m = /^VOYAGE-BACKUP:([zj]):([A-Za-z0-9+/=]+)$/.exec(s);
  if (m === null) return { why: 'notCode' };
  let bytes;
  try { bytes = fromB64(m[2]); } catch { return { why: 'broken' }; }
  if (m[1] === 'z') {
    if (!canZip()) return { why: 'cantUnzip' };
    try { bytes = await pipe(bytes, new DecompressionStream('deflate-raw')); } catch { return { why: 'broken' }; }
  }
  let sealed;
  try { sealed = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return { why: 'broken' }; }
  return open(sealed, saveVersion);
}

/** The download's name: voyage-backup-<character>-<yyyy-mm-dd>.txt, the name cut to safe letters. */
export function fileName(name, at) {
  const slug = String(name ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'character';
  const d = new Date(count(at));
  const pad = (n) => String(n).padStart(2, '0');
  return `voyage-backup-${slug}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.txt`;
}
