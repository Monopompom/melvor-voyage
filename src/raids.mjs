// Raids (round 5, build .715), game side: a debt left unpaid for 7 days of game time brings its band to your places on
// the ground where it is owed, once a day, online and offline alike. The band raids a tent's depot there first, else an
// idle Folk's room there (for a sea's band: a place on that sea's coast), through Worker Folks' raidRoom (API v13):
// purse GP first, then the dearest goods, whole items, never gear, never past what is owed. What it takes is gone and
// the debt is lowered by its value; the debt itself never grows. With nothing of yours on its ground, that day has no
// raid. Online a notice says what was taken; offline the Welcome Back box does. The rules are in
// encounter-rules-model.mjs (raidsNow, raidIn, lowerDebt, raidTargets).

const RAID_API = 13;
/** How often the raids are looked at, in game ms: a day's raid comes within a minute of its time. */
const LOOK_MS = 60 * 1000;
/** Offline lines kept for one Welcome Back box: a long catch-up raids a day at a time, so a few at most. */
const AWAY_MAX = 8;

export function install(ctx, { state, R, shortNumber, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // The short form, as the Here panel's "Owed:" row shows the same debt ("222M", "12.1K").
  const gp = (n) => { try { return shortNumber ? shortNumber(Math.round(n)) : numberWithCommas(Math.round(n)); } catch { return `${Math.round(n)}`; } };
  const now = () => state.gameNow?.() ?? Date.now();
  const offlineNow = () => { try { return game._isInOnlineLoop === false; } catch { return false; } };
  const api = () => {
    const a = state.folksGuarded === true ? state.folksApi?.() : undefined;
    return a !== undefined && Number(a.version) >= RAID_API && typeof a.raidRoom === 'function' ? a : undefined;
  };

  // ---- the ground a debt is owed on ---------------------------------------------------------------------------------
  const NEAR = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const hexKey = (h) => `${h.q},${h.r}`;
  /** Whether hex `h` is on `ground`: a land ground by its terrain, a sea on it or next to it (its coast). */
  const onGroundOf = (ground) => {
    if (state.encounters?.isSea?.(ground) === true) {
      let sea = [];
      try { sea = state.charts?.seaOf?.(ground) ?? []; } catch {}
      const keys = new Set(sea.map(hexKey));
      return (h) => keys.has(hexKey(h)) || NEAR.some(([dq, dr]) => keys.has(`${h.q + dq},${h.r + dr}`));
    }
    return (h) => { try { return state.recordAt?.(h)?.t === ground; } catch { return false; } };
  };
  const targetsFor = (a, ground) => {
    let tents = [];
    let folks = [];
    try { tents = state.outposts?.list?.() ?? []; } catch {}
    try { folks = a.folks?.() ?? []; } catch {}
    return R.raidTargets({ tents, folks, onGround: onGroundOf(ground) });
  };

  // ---- telling ------------------------------------------------------------------------------------------------------
  let away = [];
  const icon = () => { try { return ctx.getResourceUrl('assets/icon.svg'); } catch { return ''; } };
  const placeText = (x) => t(x.kind === 'tent' ? 'MOD_VOY_RAID_AT_TENT' : 'MOD_VOY_RAID_AT_FOLK', { name: x.name });
  const tell = (who, x, took, left) => {
    const text = left > 0
      ? t('MOD_VOY_RAID_TOOK', { who, place: placeText(x), gp: gp(took), left: gp(left) })
      : t('MOD_VOY_RAID_TOOK_ALL', { who, place: placeText(x), gp: gp(took) });
    if (offlineNow()) { if (away.length < AWAY_MAX) away.push(text); return; }
    try { game.notifications.createInfoNotification('voyage:raid', text, icon()); } catch {}
  };
  try {
    ctx.patch(OfflineProgressElement, 'setMessages').after(function () {
      try {
        const lines = away;
        away = [];
        if (lines.length === 0 || this.messageContainer == null) return;
        const img = icon() ? `<img class="skill-icon-xs mr-1" src="${esc(icon())}" alt="">` : '';
        for (const text of lines) {
          const h = document.createElement('h5');
          h.className = 'font-w600 mb-1 text-warning';
          h.innerHTML = img + esc(text);
          this.messageContainer.append(h);
        }
      } catch (e) { log('raids: offline lines failed', e); }
    });
  } catch (e) { log('raids: offline summary not patched', e); }

  // ---- the raid -----------------------------------------------------------------------------------------------------
  /** That day's raid for debt `key`: the first place on its ground that gives up anything. What it took, in GP. */
  const raidOne = (a, key) => {
    const enc = state.encounters;
    const owed = enc.debts().find((d) => d.key === key);
    if (owed === undefined) return 0;
    let took = 0;
    for (const x of targetsFor(a, owed.ground)) {
      let r;
      try { r = a.raidRoom(x.target, owed.gp); } catch (e) { log('raids: raidRoom failed', e); }
      if (!(r?.gp > 0)) continue;
      took = r.gp;
      const left = enc.raidLower(key, r.gp);
      log(`raids: ${key} took ${r.gp} GP from ${x.kind} ${x.name}, ${left} GP still owed`);
      tell(owed.name, x, r.gp, left);
      break;
    }
    if (took === 0) log(`raids: ${key} found nothing of yours on its ground`);
    enc.raidMark(key);
    return took;
  };
  let lastLook = -Infinity;
  /** On the skill's passive tick, online and offline: every LOOK_MS of game time, the raids due run. */
  const tick = () => {
    const at = now();
    if (at - lastLook < LOOK_MS && at >= lastLook) return;
    lastLook = at;
    const a = api();
    const enc = state.encounters;
    if (a === undefined || enc?.raidsDue === undefined) return;
    for (const key of enc.raidsDue(at)) raidOne(a, key);
  };
  ctx.onCharacterLoaded(() => { lastLook = -Infinity; away = []; });

  const out = {
    tick,
    /** Dev: the places each debt's band would raid now. */
    targets: () => {
      const a = api();
      return a === undefined ? 'no Worker Folks API 13' : (state.encounters?.debts?.() ?? []).map((d) => ({ key: d.key, gp: d.gp, raidIn: state.encounters.raidIn(d.key), at: targetsFor(a, d.ground).map((x) => `${x.kind} ${x.name}`) }));
    },
    /** Dev: the raids due run now, without waiting for the minute's look. */
    now: () => { lastLook = -Infinity; tick(); },
  };
  return out;
}
