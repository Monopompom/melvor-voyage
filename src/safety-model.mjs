// Automatic safety copies (the user, 23 Nov 2026, after players lost their progress). When the game starts without
// this mod (its Mod Manager gives up on a slow update and offers to continue with no mods), its next autosave leaves
// out the mod's skill, items and purchases for good, and the mod can't run to stop it. So the mod keeps its own copies
// outside the save and, the next time it loads and finds its block missing, brings back the best one.
//
// Pure: which copies are kept, which may come back to this character, and when a new one is due.

/** How often a changed game gets a new copy. */
export const EVERY_MS = 10 * 60 * 1000;
/** The newest copies kept, beside the highest one. */
export const KEEP_NEWEST = 2;
/** The shortest gap between copies when the player leaves the tab. */
export const LEAVE_MS = 60 * 1000;

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isCopy = (c) => isObj(c) && typeof c.code === 'string' && c.code !== '' && Number.isFinite(c.at)
  && Number.isFinite(c.xp) && c.xp >= 0 && Number.isFinite(c.progress) && typeof c.name === 'string' && typeof c.mode === 'string';
const valid = (list) => (Array.isArray(list) ? list.filter(isCopy) : []);

/** One character's copies are stored under its save slot, game mode and name. */
export const slotKey = (slot, name, mode) => `${slot}|${mode}|${name}`;

/**
 * The XP of the game's own skills, `skills` [{ xp, modded }]. It only grows on one character and a mod can't take it
 * away, so it tells the same character carrying on from a new one given the same name in the same slot.
 */
export function progressOf(skills) {
  let sum = 0;
  for (const s of skills ?? []) if (s?.modded !== true && Number.isFinite(s?.xp) && s.xp > 0) sum += s.xp;
  return sum;
}

/** The newest copy, or undefined. */
export const newest = (list) => valid(list).reduce((a, c) => (a === undefined || c.at > a.at ? c : a), undefined);

/** The list with `copy` added: the newest few and the highest XP, so a run of poor copies can't push out the best. */
export function keep(list, copy) {
  const all = [...valid(list), copy].filter(isCopy).sort((a, b) => b.at - a.at);
  if (all.length === 0) return [];
  const best = all.reduce((a, c) => (c.xp > a.xp ? c : a));
  const out = all.slice(0, KEEP_NEWEST);
  if (!out.includes(best)) out.push(best);
  return out;
}

/**
 * The copies that may come back to this character, best first (highest XP, then newest): same name and game mode, and
 * made at no more progress in the game's own skills than it has now.
 */
export function candidates(list, { name, mode, progress }) {
  return valid(list)
    .filter((c) => c.xp > 0 && c.name === name && c.mode === mode && c.progress <= progress + 1)
    .sort((a, b) => b.xp - a.xp || b.at - a.at);
}

/** A new copy is due with none yet, or when the game has changed and the last one is at least `gap` old. */
export const isDue = (last, sig, now, gap = EVERY_MS) => last === undefined || (last.sig !== sig && now - last.at >= gap);

/** FNV-1a, 32 bits: whether anything changed since the last copy. */
export function signature(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
