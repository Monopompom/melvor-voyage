// Folks walking alone on a travel order (phase 6d). The rules are in walk-model.mjs; this file reads the map for it,
// sends a Folk, walks it on the clock and puts it to work where it arrives.
//
// Only to a place you know: the hexes the Journal found a resource on. Only a Folk with you or within a hex of you,
// and only with the shop's Walking Orders. Setting off packs its food (by rank) and fuel (as yours) from the stores;
// the walk then runs on the clock, online and offline (the Voyage skill's passive tick), one hex at a time on foot
// without a mount. Worker Folks keeps the Folk as travel 'walking' (API 4): no work, no healing, no orders but
// Stop here until it arrives. Without that API nobody walks.

const SEA = ['water', 'shoal'];
/** The shop purchase that unlocks sending (data/package.json). */
export const PURCHASE_ID = 'voyage:Walking_Orders';
/** The places a dialog offers for one resource at most: the nearest found hexes. */
const PLACES_MAX = 12;
// Modal buttons as the rest of Voyage's: confirm green, cancel blue outline.
const SWAL_CLASS = { popup: 'voyage-ui', confirmButton: 'btn btn-success m-1', cancelButton: 'btn btn-outline-info m-1' };

export function install(ctx, { state, W, S, C, helpLayout, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hexDistance = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
  const same = (a, b) => a != null && b != null && a.q === b.q && a.r === b.r;
  const now = () => state.clockNow?.() ?? Date.now();
  const offline = () => { try { return game._isInOnlineLoop === false; } catch { return false; } };

  /** The class of a hex a Folk may walk into: land you know (surveyed or charted). Undefined for sea or unknown. */
  const ground = (q, r) => {
    const rec = state.terrain?.get(q, r);
    if (rec === undefined || typeof rec.t !== 'string' || SEA.includes(rec.t) || rec.cloud === true) return undefined;
    return state.knowledge?.isKnown(rec) === false ? undefined : rec.t;
  };
  /** The quickest road on foot between two hexes { q, r }, or undefined (see walk-model findRoad). */
  const road = (from, to) => {
    try { return W.findRoad(from, to, ground); } catch (e) { log('walk road failed', e); return undefined; }
  };
  /** Worker Folks can send a Folk on its way (API 4). */
  const canWalk = () => (state.folksApi?.()?.version ?? 0) >= 4;
  const api = () => (state.folksGuarded && canWalk() ? state.folksApi?.() : undefined);
  const record = () => { const s = state.voyageSkill?.(); return s !== undefined && s.futureRaw === undefined ? s.record : undefined; };
  /** The walks in the save, cleaned. */
  const walks = () => W.cleanWalks(record()?.walks);
  const setWalks = (next) => { const r = record(); if (r !== undefined) r.walks = next; schedule(); };

  // ---- who may be sent -----------------------------------------------------------------------------------------------
  const purchase = () => { try { return game.shop.purchases.getObjectByID(PURCHASE_ID); } catch { return undefined; } };
  /** Walking Orders bought. */
  const owned = () => { const p = purchase(); try { return p !== undefined && game.shop.getPurchaseCount(p) > 0; } catch { return false; } };
  /** Sending is open: the rules on, Worker Folks API 4, the skill's save and the shop upgrade. */
  const usable = () => state.active?.() === true && api() !== undefined && record() !== undefined && owned();
  /** The hex a Folk sets off from: yours for a Folk with you, its own otherwise. */
  const folkHex = (f) => (f.travel === 'with' ? state.position() : f.place);
  /**
   * Why this Folk can't be sent now: undefined when it can, '' when no Send shows at all (no upgrade, walking already,
   * more than a hex away), a reason otherwise (under way, adrift, at sea).
   */
  const sendRefusal = (f) => {
    if (!usable() || f === undefined || f.travel === 'walking') return '';
    const pos = state.position();
    if (pos === undefined) return '';
    if (f.travel !== 'with' && (f.place === null || hexDistance(pos, f.place) > 1)) return '';
    const busy = state.crew?.busy?.();
    if (busy !== undefined) return busy;
    // A Folk with you steps off where you stand: on land.
    if (f.travel === 'with') return state.crew?.ashoreRefusal?.();
    return undefined;
  };

  // ---- what a walk costs, and the places --------------------------------------------------------------------------
  const provisions = () => state.stores?.enabled?.() === true;
  const stepCost = (step, f) => W.folkStepCost(S.stepCost({ cls: step.cls }, state.stores?.fmLevel?.() ?? 1, 0), state.crewModel?.foodShare?.(f.tier) ?? 1);
  /** The food and fuel a road takes from the stores for this Folk; nothing with provisions off. */
  const packFor = (r, f) => (provisions() ? W.roadPack(r, (s) => stepCost(s, f)) : { food: 0, fuel: 0 });
  const hexText = (h) => { try { const o = new HexCoords(h.q, h.r).to_oddq(); return `(${o.col}, ${o.row})`; } catch { return `(${h.q}, ${h.r})`; } };
  const duration = (ms) => { const p = C.durationParts(ms); return p.h > 0 ? t('MOD_VOY_CLOCK_H_M', { h: `${p.h}`, m: `${p.m}` }) : t('MOD_VOY_CLOCK_M', { m: `${p.m}` }); };
  const hexesText = (n) => t(n === 1 ? 'MOD_VOY_HEXES_ONE' : 'MOD_VOY_HEXES_MANY', { count: `${n}` });
  const actionOf = (skillId, actionId) => { try { return game.skills.getObjectByID(skillId)?.actions?.getObjectByID(actionId); } catch { return undefined; } };
  /** A place in words: "Iron Ore, Highlands (13, 9)". */
  const placeText = (hex, skillId, actionId) => {
    const a = actionOf(skillId ?? '', actionId ?? '');
    const land = state.landWords?.(hex)?.text ?? '';
    return t('MOD_VOY_WALK_PLACE', { what: a?.name ?? t('MOD_VOY_WALK_PLACE_NONE'), land, hex: hexText(hex) });
  };

  /** The resources the Journal found that a Folk can be given, grouped as the Journal does: [{ id, skillId, action }]. */
  const works = () => {
    const a = api();
    if (a === undefined) return [];
    const skills = new Set(a.skills().map((s) => s.id));
    return (state.journal?.finds?.() ?? []).filter((x) => skills.has(x.skillId));
  };
  /**
   * The places this Folk may be sent for `actionId`: that resource's found hexes, the nearest few, and your outposts
   * (phase 6e), each with its road, time, pack and, when it can't be picked, why (an outpost where the work can't be
   * done says so). Sorted as the dialog lists them (walk-model sortPlaces).
   */
  const places = (f, actionId) => {
    const find = works().find((x) => x.id === actionId);
    const from = folkHex(f);
    if (find === undefined || from == null) return [];
    const have = state.stores?.stores?.() ?? { food: 0, fuel: 0 };
    const near = find.found.map((h) => ({ ...h, distance: hexDistance(from, h) })).sort((a, b) => a.distance - b.distance).slice(0, PLACES_MAX);
    for (const o of state.outposts?.list?.() ?? []) if (!near.some((h) => same(h, o))) near.push({ q: o.q, r: o.r, distance: hexDistance(from, o), outpost: o.name });
    return W.sortPlaces(near.map((h) => {
      const r = same(from, h) ? [] : road(from, h);
      const p = { q: h.q, r: h.r, distance: h.distance, road: r, skillId: find.skillId, actionId: find.id, action: find.action, outpost: h.outpost };
      if (r === undefined) return { ...p, why: t('MOD_VOY_WALK_ACROSS_WATER', { name: f.name }) };
      if (r.length === 0) return { ...p, ms: 0, pack: { food: 0, fuel: 0 }, why: t('MOD_VOY_WALK_THERE_ALREADY', { name: f.name }) };
      const pack = packFor(r, f);
      const out = { ...p, ms: W.roadMs(r), pack };
      const work = state.folkWorkAt?.(f, find.skillId, find.action, h);
      if (work !== undefined) return { ...out, why: work };
      if (provisions() && (pack.food > have.food || pack.fuel > have.fuel + 1e-9)) return { ...out, why: t('MOD_VOY_WALK_SHORT', { amounts: state.stores.amounts(pack.food, pack.fuel) }) };
      return out;
    }));
  };

  // ---- sending, stopping, arriving --------------------------------------------------------------------------------------
  const notify = (text, kind = 'info') => {
    // During the offline catch-up the notice waits for the Welcome Back box.
    if (offline()) { tellAway(text, kind); return; }
    try {
      if (kind === 'danger') game.notifications.createErrorNotification('voyage:walk', text);
      else if (kind === 'success') game.notifications.createSuccessNotification('voyage:walk', text, ctx.getResourceUrl('assets/walking_orders.webp'));
      else game.notifications.createInfoNotification('voyage:walk', text, ctx.getResourceUrl('assets/walking_orders.webp'));
    } catch {}
  };
  const changed = () => {
    try { const s = state.voyageSkill?.(); if (s !== undefined) s.renderQueue.page = true; } catch {}
    try { state.herePanel?.render?.(); } catch {}
    try { api()?.refresh(); } catch {}
  };

  /** Sends a Folk to `hex` for `actionId` (a place from `places`). False, with a notice, when refused. */
  const send = (id, actionId, hex) => {
    const a = api();
    const f = a?.folkById(id);
    const why = sendRefusal(f);
    if (why !== undefined) { if (why !== '') notify(why, 'danger'); return false; }
    const p = places(f, actionId).find((x) => same(x, hex));
    if (p === undefined || p.why !== undefined) { if (p?.why) notify(p.why, 'danger'); return false; }
    const from = folkHex(f);
    if (provisions()) {
      const have = state.stores.stores();
      state.stores.set(have.food - p.pack.food, have.fuel - p.pack.fuel);
    }
    a.setPlace(id, { q: from.q, r: from.r });
    if (!a.setTravel(id, 'walking')) return false;
    // The Folk holding that skill now, if another: on arrival the skill moves from it, as Put ashore moves one.
    const holder = a.skills().find((s) => s.id === p.skillId)?.holder ?? null;
    const walk = W.cleanWalk({ from, road: p.road, start: now(), skillId: p.skillId, actionId: p.actionId, holder: holder === id ? null : holder });
    setWalks({ ...walks(), [id]: walk });
    log(`${f.name} walks to (${hex.q},${hex.r}) for ${actionId}: ${p.road.length} hexes, ${Math.round(p.ms / 60000)} min, pack ${p.pack.food} food ${p.pack.fuel} fuel`);
    notify(t('MOD_VOY_WALK_SENT', { name: f.name, to: placeText(hex, p.skillId, p.actionId), time: duration(p.ms) }), 'success');
    changed();
    return true;
  };

  /** The Folk arriving now (its work is given from afar: the guards let it through), or undefined. */
  let arrivingId;
  const ending = (id) => { const { [id]: _gone, ...rest } = walks(); setWalks(rest); };

  /** Stop here: the Folk stands on the hex it has reached, with no work. The food packed for the rest is gone. */
  const stopHere = (id) => {
    const a = api();
    const w = walks()[id];
    const f = a?.folkById(id);
    if (w === undefined || f === undefined) return false;
    const at = W.walkAt(w, now()).at ?? w.from;
    ending(id);
    a.setTravel(id, 'idle');
    a.setPlace(id, at);
    log(`${f.name} stopped at (${at.q},${at.r})`);
    notify(t('MOD_VOY_WALK_STOPPED', { name: f.name, where: `${state.landWords?.(at)?.text ?? ''} ${hexText(at)}`.trim() }));
    changed();
    return true;
  };

  /** Arrival: the Folk stands on the last hex and takes the work it was sent for, or says why it can't. */
  const arrive = (id, w) => {
    const a = api();
    const dest = w.road[w.road.length - 1];
    const f0 = a.folkById(id);
    ending(id);
    if (f0 === undefined) return;
    a.setPlace(id, { q: dest.q, r: dest.r });
    a.setTravel(id, 'idle');
    const f = a.folkById(id);
    const where = placeText(dest, w.skillId, w.actionId);
    const skill = w.skillId === null ? undefined : game.skills.getObjectByID(w.skillId);
    const action = actionOf(w.skillId ?? '', w.actionId ?? '');
    const say = (key, vars, kind) => { const text = t(key, { name: f.name, where, ...vars }); log(text); notify(text, kind); };
    if (skill === undefined) { say('MOD_VOY_WALK_ARRIVED_IDLE', {}, 'info'); changed(); return; }
    // Another Folk took the skill while it walked: it waits. The one that held it when you sent it gives it up.
    const holder = a.skills().find((s) => s.id === w.skillId)?.holder ?? null;
    const why = holder !== null && holder !== id && holder !== w.holder
      ? t('MOD_VOY_WALK_HELD', { skill: skill.name, other: a.folkById(holder)?.name ?? '' })
      : state.folkWorkAt?.(f, w.skillId, action, dest);
    if (why !== undefined) { say('MOD_VOY_WALK_ARRIVED_CANT', { why }, 'danger'); changed(); return; }
    let started = false;
    arrivingId = id;
    try {
      // Started through the skill's own buttons, as the planner does on arrival; a skill already running (you on it)
      // waits for its next start.
      const pl = state.planner;
      if (a.assign(id, w.skillId) && action !== undefined && pl?.startable?.(w.skillId) && !skill.isActive) started = pl.startAction(w.skillId, action) === true;
    } catch (e) { log('walk arrival failed', e); } finally { arrivingId = undefined; }
    if (a.folkById(id)?.skillId === w.skillId) say(started ? 'MOD_VOY_WALK_ARRIVED_WORKS' : 'MOD_VOY_WALK_ARRIVED_HOLDS', { skill: skill.name }, 'success');
    else say('MOD_VOY_WALK_ARRIVED_CANT', { why: t('MOD_VOY_WALK_REFUSED', { skill: skill.name }) }, 'danger');
    changed();
  };

  // ---- Welcome Back ---------------------------------------------------------------------------------------------------
  // What the walks did while away, under the game's own lines (as Adrift's): each arrival, then each Folk still on the
  // road. Not saved: the box comes in the same session as the catch-up.
  let away = [];
  let walkedAway = false;
  const awayLine = (text, kind) => `<img class="skill-icon-xs mr-1" src="${esc(ctx.getResourceUrl('assets/walking_orders.webp'))}" alt="">`
    + `<span class="${kind === 'danger' ? 'text-warning' : ''}">${esc(text)}</span>`;
  function tellAway(text, kind) { if (away.length < 12) away.push(awayLine(text, kind)); }
  try {
    ctx.patch(OfflineProgressElement, 'setMessages').after(function () {
      try {
        const lines = [...away];
        if (walkedAway) for (const { folk, walk } of walking()) lines.push(awayLine(t('MOD_VOY_WALK_OFFLINE_STILL', { name: folk.name, to: walk.to, left: walk.leftText }), 'info'));
        away = [];
        walkedAway = false;
        if (lines.length === 0 || this.messageContainer == null) return;
        for (const html of lines) { const h = document.createElement('h5'); h.className = 'font-w600 mb-1'; h.innerHTML = html; this.messageContainer.append(h); }
      } catch (e) { log('walk offline lines failed', e); }
    });
  } catch (e) { log('walk offline summary not patched', e); }

  // ---- the clock (the Voyage skill's passive tick, online and offline) ----------------------------------------------
  // `due` caches the next moment anything happens (a hex entered, an arrival), so a tick with nothing due is one
  // comparison. The card's minutes left are redrawn once a minute online.
  let due;
  let shown = 0;
  const schedule = () => { due = undefined; };
  const step = (id, w, at) => {
    const a = api();
    const f = a.folkById(id);
    if (f === undefined) { ending(id); return; }
    // Worker Folks set it back (an assignment, or the mod without Voyage for a while): the walk is over where it stands.
    if (f.travel !== 'walking') { ending(id); log(`${f.name}'s walk ended outside Voyage`); return; }
    const pos = W.walkAt(w, at);
    if (pos.done) { arrive(id, w); return; }
    if (pos.at !== undefined && !same(f.place, pos.at)) a.setPlace(id, pos.at);
  };
  const tick = () => {
    const all = walks();
    const ids = Object.keys(all);
    if (ids.length === 0 || api() === undefined) return;
    if (offline()) walkedAway = true;
    const at = now();
    if (due === undefined || at >= due) {
      for (const id of ids) step(id, all[id], at);
      const left = walks();
      const next = Object.values(left).map((w) => W.nextAt(w, at)).filter((x) => x !== undefined);
      due = next.length === 0 ? Infinity : Math.min(...next);
      changed();
    }
    if (!offline() && at - shown >= 60000) { shown = at; changed(); }
  };

  /** A walk for the card and the Crew block: { to, leftText, left, at, reached, hexes }, or undefined. */
  const describe = (id) => {
    const w = walks()[id];
    if (w === undefined) return undefined;
    const pos = W.walkAt(w, now());
    const dest = w.road[w.road.length - 1];
    return { to: placeText(dest, w.skillId, w.actionId), leftText: duration(pos.left), left: pos.left, at: pos.at, reached: pos.reached, hexes: w.road.length };
  };
  /** For the map: each walk's hex reached and the road still ahead, [{ id, at, ahead: [{ q, r }] }]. */
  const routes = () => Object.entries(walks()).map(([id, w]) => {
    const pos = W.walkAt(w, now());
    return { id, at: pos.at ?? w.from, ahead: w.road.slice(pos.reached).map((h) => ({ q: h.q, r: h.r })) };
  });
  /** The Folks walking now, as Worker Folks views, each with its walk described. */
  const walking = () => {
    const a = api();
    if (a === undefined) return [];
    return Object.keys(walks()).map((id) => ({ folk: a.folkById(id), walk: describe(id) })).filter((x) => x.folk !== undefined && x.walk !== undefined);
  };

  // ---- the Send dialog ------------------------------------------------------------------------------------------------
  /** The Folks that may be sent now: with you or within a hex, nothing in the way. */
  const sendable = () => { const a = api(); return a === undefined ? [] : a.folks().filter((f) => sendRefusal(f) === undefined); };
  /** A Journal resource a Folk could be sent for (its skill can be given to a Folk, and you have Walking Orders). */
  const canSendFor = (actionId) => usable() && works().some((x) => x.id === actionId);

  /**
   * The Send dialog. From the Crew block (`id`): pick the work, then the place. From a Journal resource (`actionId`):
   * the work is set; pick the Folk (with you or within a hex), then the place. `done` redraws the page.
   */
  const askSend = (id, done, actionId) => {
    const a = api();
    if (a === undefined) return;
    const fixed = actionId !== undefined;
    const all = fixed ? works().filter((x) => x.id === actionId) : works();
    const who = fixed ? sendable() : [];
    let f = fixed ? (who.find((x) => x.id === id) ?? who[0]) : a.folkById(id);
    if (fixed) {
      if (all.length === 0) return;
      if (f === undefined) { notify(t('MOD_VOY_WALK_NOBODY'), 'danger'); return; }
    } else {
      const why = sendRefusal(f);
      if (why !== undefined) { if (why !== '') notify(why, 'danger'); return; }
    }
    const holders = new Map(a.skills().map((s) => [s.id, s.holder]));
    const skillOf = (sid) => { try { return game.skills.getObjectByID(sid); } catch { return undefined; } };
    const first = all.find((x) => x.skillId === f.skillId) ?? all[0];
    let workPicked = first?.id;
    let skillPicked = first?.skillId;
    /** The works by skill, in the Journal's order. */
    const groups = new Map();
    for (const x of all) {
      if (!groups.has(x.skillId)) groups.set(x.skillId, []);
      groups.get(x.skillId).push(x);
    }
    // The picks as the game's own dropdowns (Bootstrap's data-toggle, as the planner's and the ship's clock's; the user,
    // 20 Oct 2026), not the browser's select: the Folk (from the Journal), the skill, then under it that skill's
    // resources, each with its icon, the picked one on the toggle. A list of one is a plain line: no dropdown of one.
    const workOf = (wid) => all.find((y) => y.id === wid);
    const ico = (media) => (media ? `<img class="voyage-plan-pick-ico" src="${esc(media)}" alt="">` : '');
    const skillFace = (sid) => { const sk = skillOf(sid); return `${ico(sk?.media)}<span>${esc(sk?.name ?? sid)}</span>`; };
    const workFace = (x) => `${ico(x?.action.media)}<span>${esc(x?.action.name ?? '')}</span>`;
    // A Folk by its work's icon (none: a plain figure), its name, and where it is.
    const folkFace = (x) => {
      const sk = x.skillId ? skillOf(x.skillId) : undefined;
      const lead = sk?.media ? ico(sk.media) : '<i class="fa fa-user voyage-plan-pick-ico" aria-hidden="true"></i>';
      return `${lead}<span>${esc(x.name)} <span class="voyage-walk-folk-where">${esc(t(x.travel === 'with' ? 'MOD_VOY_WALK_WHO_WITH' : 'MOD_VOY_WALK_WHO_NEAR'))}</span></span>`;
    };
    const one = (face) => `<div class="voyage-walk-one">${face}</div>`;
    const dd = (kind, label, face, items) => '<div class="dropdown voyage-plan-arrival voyage-clock-dd">'
      + `<button type="button" id="voyage-walk-${kind}-toggle" class="btn btn-light dropdown-toggle" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false" aria-labelledby="${label}">${face}</button>`
      + `<div class="dropdown-menu overflow-y-auto" aria-labelledby="voyage-walk-${kind}-toggle">${items}</div></div>`;
    const item = (attr, value, on, face) => `<a class="dropdown-item pointer-enabled${on ? ' active' : ''}" role="button" ${attr}="${esc(value)}">${face}</a>`;
    const whoHtml = () => (who.length === 1 ? one(folkFace(f))
      : dd('who', 'voyage-walk-who-label', folkFace(f), who.map((x) => item('data-walk-folk', x.id, x.id === f.id, folkFace(x))).join('')));
    const worksHtml = () => {
      const skills = [...groups.keys()];
      const items = groups.get(skillPicked) ?? [];
      return (skills.length === 1 ? one(skillFace(skillPicked))
        : dd('skill', 'voyage-walk-work-label', skillFace(skillPicked), skills.map((sid) => item('data-walk-skill', sid, sid === skillPicked, skillFace(sid))).join('')))
        + (items.length === 1 ? one(workFace(items[0]))
          : dd('work', 'voyage-walk-work-label', workFace(workOf(workPicked)), items.map((x) => item('data-walk-work', x.id, x.id === workPicked, workFace(x))).join('')));
    };
    /** The line under the work: the skill another Folk holds now moves to this one when it arrives. */
    const workNote = () => {
      const x = workOf(workPicked);
      const h = x === undefined ? null : holders.get(x.skillId) ?? null;
      if (h === null || h === f.id) return '';
      return esc(t('MOD_VOY_WALK_TAKES', { holder: a.folkById(h)?.name ?? '', skill: skillOf(x.skillId)?.name ?? x.skillId, name: f.name }));
    };
    // The places as the other pickers draw a choice: a full-width button, filled blue when picked, blue outline when
    // not; one it can't go to is a grey outline with its reason in amber.
    let picked;
    const placesHtml = () => {
      const list = places(f, workPicked);
      if (list.length === 0) { picked = undefined; return `<div class="text-muted">${esc(t('MOD_VOY_WALK_NO_PLACES'))}</div>`; }
      const firstOk = list.find((p) => p.why === undefined);
      picked = firstOk === undefined ? undefined : `${firstOk.q},${firstOk.r}`;
      return list.map((p) => {
        const key = `${p.q},${p.r}`;
        const off = p.why !== undefined;
        const on = key === picked;
        // Where it stands already: the reason alone, no road to count.
        const facts = p.road?.length === 0 ? [] : p.road === undefined ? [esc(hexesText(p.distance))]
          : [esc(hexesText(p.road.length)), helpLayout.timeHtml(duration(p.ms)), ...(provisions() ? [helpLayout.marked(t, 'MOD_VOY_WALK_EATS', {}, { amounts: state.stores.icons(p.pack.food, p.pack.fuel, false) })] : [])];
        const cls = off ? 'btn-outline-secondary' : on ? 'btn-info' : 'btn-outline-info';
        return `<button type="button" class="btn ${cls} voyage-walk-place" data-walk-place="${esc(key)}" aria-pressed="${on}"${off ? ' disabled' : ''}>`
          + `<span class="voyage-walk-place-name">${esc(p.outpost ?? `${state.landWords?.(p)?.text ?? ''} ${hexText(p)}`.trim())}</span>`
          + (facts.length === 0 ? '' : `<span class="voyage-walk-place-facts">${facts.join('<span class="voyage-walk-dot" aria-hidden="true">·</span>')}</span>`)
          + (off ? `<span class="voyage-walk-place-why text-warning">${esc(p.why)}</span>` : '')
          + '</button>';
      }).join('');
    };
    const pick = (key) => {
      picked = key;
      for (const b of document.querySelectorAll('#voyage-walk-places [data-walk-place]')) {
        if (b.disabled) continue;
        const on = b.dataset.walkPlace === key;
        b.classList.toggle('btn-info', on);
        b.classList.toggle('btn-outline-info', !on);
        b.setAttribute('aria-pressed', `${on}`);
      }
    };
    const section = (labelId, labelKey, inner, extra = '') => `<div class="voyage-section${extra}"><div class="font-w600 mb-2" id="${labelId}">${esc(t(labelKey))}</div>${inner}</div>`;
    const bodyHtml = () => helpLayout.msgHtml([fixed ? esc(t('MOD_VOY_WALK_HERE_TEXT')) : t('MOD_VOY_WALK_SEND_TEXT', { name: `<b>${esc(f.name)}</b>` })])
      + (fixed ? section('voyage-walk-who-label', 'MOD_VOY_WALK_WHO_LABEL', `<div id="voyage-walk-who" data-no-skill-names>${whoHtml()}</div>`, ' mt-3') : '')
      + section('voyage-walk-work-label', 'MOD_VOY_WALK_WORK_LABEL', `<div id="voyage-walk-works" data-no-skill-names>${worksHtml()}</div>`
        + `<div id="voyage-walk-work-note" class="voyage-walk-note text-muted">${workNote()}</div>`, fixed ? '' : ' mt-3')
      + section('voyage-walk-place-label', 'MOD_VOY_WALK_PLACE_LABEL', `<div id="voyage-walk-places" class="voyage-walk-places">${placesHtml()}</div>`)
      + (provisions() ? `<small class="d-block text-muted mt-3">${esc(t('MOD_VOY_WALK_PACK_HINT'))}</small>` : '');
    const body = all.length === 0 ? helpLayout.msgHtml([t('MOD_VOY_WALK_NO_WORKS')]) : `<div id="voyage-walk-body">${bodyHtml()}</div>`;
    SwalLocale.fire({
      didRender: (el) => {
        try { state.popupDidRender?.(el); } catch {}
        const box = document.getElementById('voyage-walk-body');
        if (box === null || box.dataset.voyageBound === '1') return;
        box.dataset.voyageBound = '1';
        box.addEventListener('click', (e) => {
          const at = e.target instanceof Element ? e.target : null;
          const place = at?.closest('[data-walk-place]');
          if (place != null) { if (!place.disabled) pick(place.dataset.walkPlace); return; }
          const fk = at?.closest('[data-walk-folk]');
          const sk = at?.closest('[data-walk-skill]');
          const wk = at?.closest('[data-walk-work]');
          if (fk != null && fk.dataset.walkFolk !== f.id) f = who.find((x) => x.id === fk.dataset.walkFolk) ?? f;
          // A new skill picks its first resource.
          else if (sk != null && sk.dataset.walkSkill !== skillPicked) { skillPicked = sk.dataset.walkSkill; workPicked = groups.get(skillPicked)?.[0]?.id; }
          else if (wk != null && wk.dataset.walkWork !== workPicked) workPicked = wk.dataset.walkWork;
          else return;
          box.innerHTML = bodyHtml();
          // The redrawn body gets its skill names' icons again (the pass is safe to run twice).
          try { state.popupDidRender?.(el); } catch {}
        });
      },
      // The menus open over the popup's buttons, as the ship's clock's.
      customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass({ ...SWAL_CLASS, htmlContainer: 'voyage-swal-menus' }) : { ...SWAL_CLASS, htmlContainer: 'voyage-swal-menus' },
      title: fixed ? t('MOD_VOY_WALK_HERE_TITLE', { what: all[0].action.name }) : t('MOD_VOY_WALK_SEND_TITLE', { name: f.name }),
      html: body,
      showConfirmButton: all.length > 0,
      showCancelButton: true,
      confirmButtonText: t('MOD_VOY_WALK_SEND_BUTTON'),
      cancelButtonText: t('MOD_VOY_WALK_SEND_CANCEL'),
      preConfirm: () => {
        if (picked === undefined) { Swal.showValidationMessage(t('MOD_VOY_WALK_PICK_PLACE')); return false; }
        const [q, r] = picked.split(',').map(Number);
        return { id: f.id, actionId: workPicked ?? '', hex: { q, r } };
      },
    }).then((res) => {
      if (!res.isConfirmed || res.value == null) return;
      try { if (send(res.value.id, res.value.actionId, res.value.hex)) done?.(); } catch (e) { log('walk send failed', e); }
    });
  };

  /** Stop here, asked first: the food packed for the rest of the road is lost. */
  const askStop = (id, done) => {
    const f = api()?.folkById(id);
    const w = describe(id);
    if (f === undefined || w === undefined) return;
    SwalLocale.fire({
      didRender: state.popupDidRender,
      customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass(SWAL_CLASS) : SWAL_CLASS,
      title: t('MOD_VOY_WALK_STOP_TITLE', { name: f.name }),
      html: helpLayout.msgHtml([t('MOD_VOY_WALK_STOP_TEXT', { name: `<b>${esc(f.name)}</b>`, to: esc(w.to) })]),
      showCancelButton: true,
      confirmButtonText: t('MOD_VOY_WALK_STOP_BUTTON'),
      cancelButtonText: t('MOD_VOY_WALK_STOP_CANCEL'),
    }).then((res) => { if (!res.isConfirmed) return; try { if (stopHere(id)) done?.(); } catch (e) { log('walk stop failed', e); } });
  };

  // A Walking Orders purchase shows the Send buttons at once.
  ctx.patch(Shop, 'buyItemOnClick').after(function (_ret, p) { try { if (p?.id === PURCHASE_ID) changed(); } catch {} });

  const out = {
    ground, road, canWalk, walks, owned, usable, sendRefusal, works, places, send, stopHere, askSend, askStop, tick, describe, walking, routes,
    canSendFor,
    /** The Journal's door: the work set, the Folk picked in the dialog. */
    askHere: (actionId, done) => askSend(undefined, done, actionId),
    arriving: () => arrivingId,
    /** Forgets the cached next moment (the dev console moved a walk's start). */
    reschedule: schedule,
    purchaseName: () => purchase()?.name ?? 'Walking Orders',
  };
  return out;
}
