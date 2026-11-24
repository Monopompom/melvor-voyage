// Road moments (round 5), game side: three small questions a courier or a Folk walking alone may bring you, registered
// with Worker Folks' moments (API v13). Worker Folks picks when and which Folk (one open moment per Folk, a crew-wide gap
// of days), shows them, keeps them in its save and takes the default when one runs out; Voyage says which fit a Folk on
// the road and does what an answer says to its courier route or its walk. A moment never holds a walk: the Folk walks on
// while it waits, and an answer acts on the road from where the Folk stands then.
//   - ShortCut: a goatherd knows a short cut. Take it: most times the next hexes go by at once, else an hour is lost.
//   - Farmhouse: hurt, a hot meal and a bed. Stay: HP back, an hour lost.
//   - Traveller: a lost traveller asks the way. Walk them there: an hour lost, GP for it.
// The numbers are in road-moments-model.mjs.

const MOMENT_API = 13;
const NAMES = ['ShortCut', 'Farmhouse', 'Traveller'];

export function install(ctx, { state, RM, W, M, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const fmt = (n) => { try { return numberWithCommas(Math.round(n)); } catch { return `${Math.round(n)}`; } };
  const hours = (ms) => fmt(ms / 3600000);
  const gameNow = () => state.gameNow?.() ?? Date.now();
  const offlineNow = () => { try { return game._isInOnlineLoop === false; } catch { return false; } };
  const api = () => state.folksApi?.();

  // ---- where a Folk stands on its road ------------------------------------------------------------------------------
  /** `{ kind: 'courier' | 'walk', spot }` for a Folk on the road with a route or a walk of Voyage's, else undefined. */
  const onRoad = (view) => {
    if (view?.travel !== 'walking' || typeof view.id !== 'string') return undefined;
    try {
      if (view.job === M.COURIER_JOB) {
        const spot = RM.courierSpot(state.couriers?.all?.()?.[view.id]);
        return spot === undefined ? undefined : { kind: 'courier', spot };
      }
      const spot = RM.walkSpot(state.walks?.walks?.()?.[view.id], gameNow(), W.walkAt);
      return spot === undefined ? undefined : { kind: 'walk', spot };
    } catch (e) { log('road moments: road not read', e); return undefined; }
  };
  /** Changes the road of the Folk's courier route or walk with `fn(road, at)`, from where it stands now. */
  const editRoad = (view, fn) => {
    const here = onRoad(view);
    if (here === undefined) return false;
    try {
      if (here.kind === 'courier') return state.couriers.edit(view.id, (c) => ({ ...c, road: fn(c.road, c.reached) })) === true;
      return state.walks.edit(view.id, (w, now) => {
        const spot = RM.walkSpot(w, now, W.walkAt);
        return spot === undefined ? w : { ...w, road: fn(w.road, spot.at) };
      }) === true;
    } catch (e) { log('road moments: road not changed', e); return false; }
  };
  const tell = (text) => {
    if (offlineNow()) return;
    try { game.notifications.createInfoNotification('voyage:moment', text, state.voyageSkill?.()?.media); } catch {}
  };
  const named = (key, more) => (view) => t(key, { name: view?.name ?? '', ...(more?.(view) ?? {}) });

  // ---- the three moments --------------------------------------------------------------------------------------------
  const nothing = { tone: 'no', hint: () => t('MOD_VOY_MOMENT_HINT_NOTHING'), apply: () => {} };
  const DEFS = {
    ShortCut: {
      fits: (view) => RM.hexesAhead(onRoad(view)?.spot) > RM.SHORT_HEXES,
      text: named('MOD_VOY_MOMENT_ShortCut_TEXT'),
      answers: [
        {
          id: 'take',
          tone: 'risk',
          label: () => t('MOD_VOY_MOMENT_ShortCut_YES'),
          hint: () => t('MOD_VOY_MOMENT_ShortCut_HINT', { n: `${RM.SHORT_HEXES}`, odds: `${Math.round(RM.SHORT_ODDS * 3)}`, hours: hours(RM.LOST_MS) }),
          apply: (view) => {
            let won;
            const ok = editRoad(view, (road, at) => { const out = RM.shortCut({ road, at }); won = out.won; return out.road; });
            if (ok) tell(t(won ? 'MOD_VOY_MOMENT_ShortCut_WON' : 'MOD_VOY_MOMENT_ShortCut_LOST', { name: view.name, n: `${RM.SHORT_HEXES}`, hours: hours(RM.LOST_MS) }));
          },
        },
        { id: 'road', label: () => t('MOD_VOY_MOMENT_ShortCut_NO'), ...nothing },
      ],
      defaultAnswer: 'road',
    },
    Farmhouse: {
      fits: (view) => typeof api()?.heal === 'function' && RM.hurt(view.hp, view.maxHp) && onRoad(view) !== undefined,
      text: named('MOD_VOY_MOMENT_Farmhouse_TEXT'),
      answers: [
        {
          id: 'stay',
          label: () => t('MOD_VOY_MOMENT_Farmhouse_YES'),
          hint: () => t('MOD_VOY_MOMENT_Farmhouse_HINT', { pct: `${Math.round(RM.INN_HEAL * 100)}`, hours: hours(RM.INN_MS) }),
          apply: (view) => {
            if (!editRoad(view, (road, at) => RM.slow(road, at, RM.INN_MS))) return;
            const n = RM.innHeal(view.hp, view.maxHp);
            try { if (n > 0) api()?.heal?.(view.id, n, { cause: 'rest' }); } catch (e) { log('road moments: heal failed', e); }
          },
        },
        { id: 'on', label: () => t('MOD_VOY_MOMENT_Farmhouse_NO'), ...nothing },
      ],
      defaultAnswer: 'on',
    },
    Traveller: {
      fits: (view) => onRoad(view) !== undefined,
      text: named('MOD_VOY_MOMENT_Traveller_TEXT'),
      answers: [
        {
          id: 'guide',
          label: () => t('MOD_VOY_MOMENT_Traveller_YES'),
          hint: () => t('MOD_VOY_MOMENT_Traveller_HINT', { gp: fmt(RM.GUIDE_GP), hours: hours(RM.GUIDE_MS) }),
          apply: (view) => {
            if (!editRoad(view, (road, at) => RM.slow(road, at, RM.GUIDE_MS))) return;
            try { game.gp.add(RM.GUIDE_GP); } catch (e) { log('road moments: tip not paid', e); }
            tell(t('MOD_VOY_MOMENT_Traveller_PAID', { name: view.name, gp: fmt(RM.GUIDE_GP) }));
          },
        },
        { id: 'point', label: () => t('MOD_VOY_MOMENT_Traveller_NO'), ...nothing },
      ],
      defaultAnswer: 'point',
    },
  };

  // ---- registering with Worker Folks --------------------------------------------------------------------------------
  let registered = false;
  const register = () => {
    if (registered) return;
    const a = api();
    if (a === undefined || !(Number(a.version) >= MOMENT_API) || typeof a.registerMoment !== 'function') return;
    for (const name of NAMES) {
      try {
        a.registerMoment({ id: `voyage:${name}`, weight: RM.WEIGHT, ...DEFS[name] });
      } catch (e) { console.error(`[Voyage] road moment ${name} failed to register`, e); }
    }
    registered = true;
    log('road moments: registered with Worker Folks');
  };
  ctx.onCharacterSelectionLoaded(register);
  ctx.onCharacterLoaded(register);

  return {
    registered: () => registered,
    /** The numbers, for the Journal. */
    RM,
    /** Dev: which road moments fit each Folk on the road now. */
    fitting: () => (api()?.folks?.() ?? []).filter((f) => f.travel === 'walking').map((f) => ({
      id: f.id, name: f.name, road: onRoad(f)?.kind ?? 'none', fits: NAMES.filter((n) => { try { return DEFS[n].fits(f) === true; } catch { return false; } }),
    })),
    names: NAMES,
  };
}
