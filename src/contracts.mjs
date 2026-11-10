// Port Slayer contracts (4.35, from player feedback): the harbour board's Slayer tab. Each port posts, every cargo
// season (72 hours), one contract for each Slayer tier you have unlocked: a monster of that tier fought near the port,
// in a place you know. Taking one costs the tier's roll, as the game charges for a new task, and makes it your Slayer
// task through the game's own selectTask (gate.mjs state.slayerTake), so kills, length, extension and rewards are all
// the game's. A running task is replaced after a confirm. The rules are pure (slayer-model.mjs); this module draws.
//
// The save: `record.slayer.taken` (v31), { "port_tier": { season, monster } } for the contracts taken this season.

const NO_CONTRACTS = ['FakePort'];

export function install(ctx, { state, SM, M, terrainMod, hexes, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const skill = () => state.voyageSkill?.();
  const notify = (text, kind = 'success') => { try { notifyPlayer(game.slayer, text, kind); } catch {} };
  const ports = new Map(hexes.filter((h) => h.cloud !== true && (h.f ?? []).includes('port') && !NO_CONTRACTS.includes(h.poi)).map((h) => [h.poi, { poi: h.poi, q: h.q, r: h.r }]));
  const here = () => state.cargo?.portHere?.()?.poi;
  const seedOf = () => { try { return game.characterName ?? 'captain'; } catch { return 'captain'; } };
  const season = () => M.seasonOf(Date.now());
  const known = (h) => state.knowledge?.isKnown(state.terrain.get(h.q, h.r) ?? h) ?? true;
  const changed = () => { const s = skill(); if (s !== undefined) s.renderQueue.page = true; state.onSettingsChange(); };

  /** The Slayer tiers the game lets you roll now, in its order (the Melvor realm; Abyss tiers are not on the map). */
  const tiers = () => {
    const sl = game.slayer;
    return game.combat.slayerTask.categories.allObjects.filter((c) => c.realm === game.defaultRealm && (c.abyssalLevel ?? 0) === 0
      && c.level <= sl.level && c.level <= (sl.currentLevelCap ?? Infinity));
  };
  /** A monster's area and its nearest known hex from `from`: { area, hex, d }; d 0 for an area fought anywhere. */
  const whereFrom = (monster, from) => {
    const area = game.getMonsterArea(monster);
    const places = area !== undefined && typeof area.id === 'string' ? state.terrain.placesFor(area.id) : [];
    if (places.length === 0) return { area, hex: undefined, d: 0 };
    let best;
    for (const h of places) {
      if (!known(h)) continue;
      const d = SM.hexDist(from, h);
      if (best === undefined || d < best.d) best = { hex: h, d };
    }
    return best === undefined ? { area, hex: undefined, d: Infinity } : { area, ...best };
  };
  /**
   * A port's contract for a tier this season: { tier, monster, area, hex, d }, or undefined. Picked from the game's own
   * list (requirements met) with the running task's monster put back, so taking one contract doesn't move another.
   * Each monster gets its own seeded score, so a list that grows with your Slayer level keeps the season's pick unless a
   * newcomer scores lower (slayer-model.mjs contractPick). Once taken this season, the row is the monster taken.
   */
  const contractFor = (poi, tier) => {
    const port = ports.get(poi);
    if (port === undefined) return undefined;
    const tookId = SM.takenMonster(state.slayerRec?.()?.taken, poi, tier.localID, season());
    const took = tookId === undefined ? undefined : game.monsters.getObjectByID(tookId);
    if (took !== undefined) return { tier, monster: took, ...whereFrom(took, port) };
    const task = game.combat.slayerTask;
    const list = [...(state.slayerList?.(tier) ?? [])];
    const cur = task.monster;
    try { if (cur !== undefined && !list.includes(cur) && cur.canSlayer && tier.getMonsterFilter()(cur)) list.push(cur); } catch {}
    const seed = `${seedOf()}|${poi}|${season()}|slayer|${tier.id}`;
    const where = list.map((m) => whereFrom(m, port));
    const i = SM.contractPick(where.map((w, n) => ({ id: n, d: w.d, s: M.rng(M.hash(`${seed}|${list[n].id}`))() })));
    return i === undefined ? undefined : { tier, monster: list[i], ...where[i] };
  };

  // ---- taking one --------------------------------------------------------------------------------------------------
  let ask;
  const take = (tierId, poi) => {
    const rec = state.slayerRec?.();
    const tier = game.combat.slayerTask.categories.getObjectByID(tierId);
    if (rec === undefined || tier === undefined || here() !== poi || SM.isTaken(rec.taken, poi, tier.localID, season())) return false;
    const c = contractFor(poi, tier);
    if (c === undefined) return false;
    if (!state.slayerTake(tier, c.monster)) { notify(getLangString('TOASTS_CANNOT_AFFORD_THAT'), 'danger'); return false; }
    rec.taken = SM.markTaken(rec.taken, poi, tier.localID, season(), c.monster.id);
    changed();
    notify(t('MOD_VOY_CONTRACT_DONE', { name: c.monster.name }));
    log(`contract ${tier.id} at ${poi}: ${c.monster.id}`);
    return true;
  };

  // ---- drawing -------------------------------------------------------------------------------------------------------
  const icon = (src) => (src ? `<img class="voyage-skill-name-icon" src="${src}" alt="">` : '');
  const button = (cls, label, attrs, why) => (why === undefined
    ? `<button type="button" class="btn ${cls}" ${attrs}>${esc(label)}</button>`
    : `<button type="button" class="btn btn-outline-secondary disabled" aria-disabled="true" title="${esc(why)}">${esc(label)}</button>`);
  const dirWord = (dir) => (dir ? getLangString(`MOD_VOY_DIR_${dir}`) : '');
  const costBlock = (tier) => {
    const costs = game.combat.slayerTask.getRollCosts(tier);
    const ok = costs.checkIfOwned();
    const parts = costs.isFree ? [`<b class="text-success">${esc(getLangString('COMBAT_MISC_COST_FREE'))}</b>`]
      : costs.getCurrencyQuantityArray().map(({ currency, quantity }) => `${icon(currency.media)}<b class="${ok ? 'text-success' : 'text-danger'}">${numberWithCommas(quantity)}</b>`);
    return { html: `<div class="voyage-cargo-pay">${parts.map((p) => `<div>${p}</div>`).join('')}</div>`, ok };
  };
  const row = (c, poi, rec) => {
    const port = ports.get(poi);
    const lines = [`<div><b>${esc(c.monster.name)}</b> <span class="text-muted">· ${esc(c.tier.name)}</span></div>`];
    const areaName = c.area?.name ?? '';
    lines.push(`<div class="text-muted">${esc(c.hex === undefined ? t('MOD_VOY_CONTRACT_ANYWHERE')
      : c.d === 0 ? t('MOD_VOY_CONTRACT_AT_HERE', { area: areaName })
      : t('MOD_VOY_CONTRACT_AT', { area: areaName, n: `${c.d}`, dir: dirWord(terrainMod.directionLabel(port, c.hex)) }))}</div>`);
    const cost = costBlock(c.tier);
    const taken = SM.isTaken(rec.taken, poi, c.tier.localID, season());
    const task = game.combat.slayerTask;
    let act;
    if (taken) act = `<span class="text-muted">${esc(t('MOD_VOY_CONTRACT_TAKEN'))}</span>`;
    else if (ask === c.tier.id) {
      lines.push(`<div class="text-warning">${esc(t('MOD_VOY_CONTRACT_REPLACE_SURE', { task: `${task.killsLeft} x ${task.monster?.name ?? ''}` }))}</div>`);
      // A pair, as the board's drop: Keep first, Replace last.
      act = button('btn-outline-info', t('MOD_VOY_CONTRACT_KEEP'), 'data-contract="keep"') + button('btn-danger', t('MOD_VOY_CONTRACT_REPLACE'), `data-contract="yes" data-tier="${esc(c.tier.id)}"`);
    } else act = button('btn-success', t('MOD_VOY_TASK_TAKE'), `data-contract="take" data-tier="${esc(c.tier.id)}"`, cost.ok ? undefined : getLangString('TOASTS_CANNOT_AFFORD_THAT'));
    return `<div class="voyage-cargo-row${taken ? ' voyage-contract-taken' : ''}"><span class="voyage-cargo-art"><img class="voyage-cargo-box" src="${c.monster.media}" alt=""></span>` +
      `<div class="voyage-cargo-mid">${lines.join('')}</div>${cost.html}<div class="voyage-cargo-act">${act}</div></div>`;
  };
  /** The Slayer tab of the port `poi`'s harbour board. */
  const html = (poi) => {
    const rec = state.slayerRec?.();
    if (rec === undefined) return `<div class="text-warning">${esc(t('MOD_VOY_PAGE_NO_SHIP'))}</div>`;
    if (NO_CONTRACTS.includes(poi)) return `<div class="voyage-cargo-empty">${esc(t('MOD_VOY_CARGO_FAKE'))}</div>`;
    let out = `<div class="voyage-cargo-head">${esc(t('MOD_VOY_CONTRACT_HEAD'))}</div>`;
    const list = tiers().map((tier) => contractFor(poi, tier)).filter((c) => c !== undefined);
    out += list.length === 0 ? `<div class="voyage-cargo-empty">${esc(t('MOD_VOY_CONTRACT_NONE'))}</div>` : list.map((c) => row(c, poi, rec)).join('');
    return `${out}<div class="voyage-cargo-foot text-muted">${esc(t('MOD_VOY_CONTRACT_FOOT', { when: state.cargo?.untilNext?.() ?? '' }))}</div>`;
  };
  const onClick = (b, poi) => {
    const w = b.dataset.contract;
    const task = game.combat.slayerTask;
    if (w === 'take') {
      // Any task monster counts: the game holds a new task inactive for a second after it is picked.
      if (task.monster !== undefined) ask = b.dataset.tier;
      else take(b.dataset.tier, poi);
    } else if (w === 'keep') ask = undefined;
    else if (w === 'yes') { ask = undefined; take(b.dataset.tier, poi); }
  };
  const api = { html, onClick, shown: () => state.slayerShown?.() === true, resetAsk: () => { ask = undefined; } };
  state.contracts = api;
  return api;
}
