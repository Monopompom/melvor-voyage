// The game side of the automatic safety copies (the rules are src/safety-model.mjs). Copies live in the browser's
// IndexedDB, outside the save, so a save made without this mod can't touch them. They stay on this device.
//
// A character whose save has no block for this mod is marked as soon as it loads; once the game is ready the best copy
// is written back, saved and the game reloaded. Voyage and Worker Folks share one save and one reload through a small
// queue on globalThis, so either can run alone and both together reload once. Their writes wait in that queue and run
// in `rank` order: Worker Folks' crew first, then Voyage, which puts its Folks back on their hexes and roads.

const QUEUE = '__melvorModSafety';
const RELOAD_MS = 800;
/** Tries per browser session, so a copy that can't be written back never becomes a reload loop. */
const MAX_TRIES = 2;

/** A small key-value store in IndexedDB; every call rejects if the browser refuses. */
export function idbStore(dbName) {
  let opening;
  const db = () => {
    opening ??= new Promise((res, rej) => {
      const r = indexedDB.open(dbName, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('copies');
      r.onsuccess = () => res(r.result);
      r.onerror = () => { opening = undefined; rej(r.error); };
      r.onblocked = () => { opening = undefined; rej(new Error('blocked')); };
    });
    return opening;
  };
  const run = async (mode, act) => {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction('copies', mode);
      const r = act(tx.objectStore('copies'));
      tx.oncomplete = () => res(r.result);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  };
  return { get: (key) => run('readonly', (s) => s.get(key)), put: (key, value) => run('readwrite', (s) => s.put(value, key)) };
}

/** localStorage or sessionStorage, quiet where the browser refuses it. */
const quietStorage = (name) => ({
  get: (k) => { try { return globalThis[name].getItem(k); } catch { return null; } },
  set: (k, v) => { try { globalThis[name].setItem(k, v); } catch {} },
  remove: (k) => { try { globalThis[name].removeItem(k); } catch {} },
});

/** This character as the copies know it. */
const gameWho = (M) => () => ({
  // The game keeps the open save slot in a top-level variable.
  // eslint-disable-next-line no-undef
  slot: typeof currentCharacter === 'number' ? currentCharacter : 0,
  name: String(game.characterName ?? ''),
  mode: String(game.currentGamemode?.id ?? ''),
  progress: M.progressOf([...game.skills.allObjects].map((s) => ({ xp: s.xp, modded: s.isModded === true }))),
});

const gameFinish = (failed) => {
  // After a failed write nothing is saved: the reload brings back the last save and the mark tries again.
  if (!failed) { try { saveData(); } catch (e) { console.error('[Safety copies] save failed', e); } }
  location.reload();
};

/**
 * `ns` the mod's namespace, `rank` its place in a shared restore (lowest first), `active` false while the mod has switched itself off, `hadSave` whether this save held the
 * mod's block, and from the backup: `take` a backup of the game now or undefined, `encode`, `decode`, `writeBack` (in
 * memory; no save, no reload), `notify` ({ xp, at }) the popup after the reload. The rest are for tests.
 */
export function install(ctx, deps) {
  const { M, ns, rank = 0, active = () => true, hadSave, take, encode, decode, writeBack, notify, log = () => {} } = deps;
  const store = deps.store ?? idbStore(`${ns}-safety-copies`);
  const who = deps.who ?? gameWho(M);
  const local = deps.local ?? quietStorage('localStorage');
  const session = deps.session ?? quietStorage('sessionStorage');
  const finish = deps.finish ?? gameFinish;
  const now = deps.now ?? (() => Date.now());
  const reloadMs = deps.reloadMs ?? RELOAD_MS;
  const doc = deps.doc ?? (typeof document === 'undefined' ? undefined : document);
  const queue = deps.queue ?? (globalThis[QUEUE] ??= { busy: 0, timer: 0, failed: false, chain: Promise.resolve() });
  queue.writes ??= [];
  const lostKey = (key) => `${ns}:safety-lost:${key}`;
  const triesKey = (key) => `${ns}:safety-tries:${key}`;
  const noteKey = `${ns}:safety-restored`;

  const reloadSoon = () => {
    clearTimeout(queue.timer);
    const go = () => {
      if (queue.busy > 0) { queue.timer = setTimeout(go, 200); return; }
      const writes = queue.writes.splice(0).sort((a, b) => a.rank - b.rank);
      for (const w of writes) {
        try { w.write(); } catch (e) {
          console.error(`[${w.ns}] safety copy could not be written back`, e);
          queue.failed = true;
        }
      }
      // One failure saves nothing for either mod: the marks stay and the next load tries again.
      if (!queue.failed) for (const w of writes) w.done();
      finish(queue.failed);
    };
    queue.timer = setTimeout(go, reloadMs);
  };

  /** A new copy when one is due. Never of a game whose block went missing and has not come back. */
  let copying = false;
  const copyNow = async (gap) => {
    if (copying) return false;
    copying = true;
    try {
      if (!active()) return false;
      const me = who();
      const key = M.slotKey(me.slot, me.name, me.mode);
      if (local.get(lostKey(key)) === '1') return false;
      const b = take();
      if (b === undefined || !(b.xp > 0)) return false;
      const { at: _at, ...rest } = b;
      const sig = M.signature(JSON.stringify(rest));
      const list = (await store.get(key)) ?? [];
      const at = now();
      if (!M.isDue(M.newest(list), sig, at, gap)) return false;
      const code = await encode(b);
      await store.put(key, M.keep(list, { at, xp: b.xp, name: me.name, mode: me.mode, progress: me.progress, sig, code }));
      return true;
    } catch (e) { log('safety copy failed', e); return false; } finally { copying = false; }
  };

  /** True when a copy was written back and the game is about to save and reload. */
  const heal = async (key, me) => {
    const best = M.candidates((await store.get(key)) ?? [], me);
    const tries = Number(session.get(triesKey(key))) || 0;
    // No copy: a first install or a new character. Out of tries: the mark stays for the next session.
    if (best.length === 0) { local.remove(lostKey(key)); return false; }
    if (tries >= MAX_TRIES) return true;
    for (const c of best) {
      const r = await decode(c.code);
      if (r?.backup === undefined) continue;
      session.set(triesKey(key), String(tries + 1));
      queue.writes.push({
        ns,
        rank,
        write: () => writeBack(r.backup),
        done: () => {
          local.remove(lostKey(key));
          session.set(noteKey, JSON.stringify({ xp: c.xp, at: c.at }));
          console.info(`[${ns}] progress restored from the safety copy of ${new Date(c.at).toISOString()}`);
        },
      });
      reloadSoon();
      return true;
    }
    local.remove(lostKey(key));
    return false;
  };

  const run = async () => {
    if (!active()) return;
    queue.busy++;
    try {
      const me = who();
      const key = M.slotKey(me.slot, me.name, me.mode);
      if (local.get(lostKey(key)) === '1' || !hadSave()) {
        local.set(lostKey(key), '1');
        if (await heal(key, me)) return;
      } else session.remove(triesKey(key));
      const raw = session.get(noteKey);
      if (raw !== null) {
        session.remove(noteKey);
        let note;
        try { note = JSON.parse(raw); } catch {}
        // One popup after another when both mods came back.
        if (note !== undefined) queue.chain = queue.chain.then(() => notify(note)).catch((e) => log('safety notice failed', e));
      }
      await copyNow();
      if (deps.timers !== false) setInterval(() => copyNow(), M.EVERY_MS);
      // Closing a page may cut this short; switching tabs or minimizing lets it finish.
      doc?.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') copyNow(M.LEAVE_MS); });
    } catch (e) { log('safety check failed', e); } finally { queue.busy--; }
  };

  // Marked at once: an autosave before the game is ready writes an empty block, and the mark outlives it.
  ctx.onCharacterLoaded(() => {
    try {
      if (!active() || hadSave()) return;
      const me = who();
      local.set(lostKey(M.slotKey(me.slot, me.name, me.mode)), '1');
    } catch (e) { log('safety mark failed', e); }
  });
  // Not returned to the game: its hooks wait for each other, and the other mod's check should start now.
  ctx.onInterfaceReady(() => { run(); });

  return { run, copyNow };
}
