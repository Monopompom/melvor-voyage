// Voyage backups on the page's foot (the user, 5 Nov 2026: "Export code only"): Back up shows a code to copy or
// download; Restore takes a pasted code or a file, shows what it holds and, once confirmed, writes it back, saves and
// reloads the game, as the game itself does after changing a save. Nothing runs by itself. The shape, the code and the
// restore's arithmetic are src/backup-model.mjs.

const SWAL_CLASS = { popup: 'voyage-ui', confirmButton: 'btn btn-success m-1', cancelButton: 'btn btn-outline-info m-1' };
const SWAL_WARN = { ...SWAL_CLASS, confirmButton: 'btn btn-warning m-1' };

export function install(ctx, { state, model, B, helpLayout, BUILD, settingsIO, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const swalClass = (c) => (typeof createSwalCustomClass === 'function' ? createSwalCustomClass(c) : c);
  const skill = () => state.voyageSkill?.();
  const STORAGE_KEYS = ['save'];
  /** Why a pasted code was refused (backup-model decode's reasons). */
  const WHY = {
    empty: 'MOD_VOY_RESTORE_WHY_EMPTY', notCode: 'MOD_VOY_RESTORE_WHY_NOTCODE', broken: 'MOD_VOY_RESTORE_WHY_BROKEN',
    checksum: 'MOD_VOY_RESTORE_WHY_CHECKSUM', format: 'MOD_VOY_RESTORE_WHY_FORMAT', newer: 'MOD_VOY_RESTORE_WHY_NEWER',
    record: 'MOD_VOY_RESTORE_WHY_RECORD', cantUnzip: 'MOD_VOY_RESTORE_WHY_CANTUNZIP',
  };
  const when = (at) => { try { return new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return new Date(at).toISOString(); } };
  const level = (xp) => { try { return exp.xpToLevel(xp); } catch { return 1; } };
  const nameOf = (id, list) => { try { return list.getObjectByID(id)?.name ?? id; } catch { return id; } };
  /** A refusal or a failure: one sentence under the Swal sign, OK green, as the mod's other refusals (gate, fog). */
  const tell = (title, line, icon = 'info') => SwalLocale.fire({
    customClass: swalClass(SWAL_CLASS), icon, title, html: helpLayout.msgHtml([esc(line)]), confirmButtonText: t('MOD_VOY_BUTTON_OK'), didRender: state.popupDidRender,
  });

  // ---- the popups' look: the help bands, a heading each, amber-edged where something is lost (help-layout.mjs) -----
  const H = helpLayout;
  const num = (n) => { try { return numberWithCommas(Math.floor(n)); } catch { return `${Math.floor(n)}`; } };
  const count = (n, one, many) => t(n === 1 ? one : many, { n: num(n) });
  /** What a backup holds, as label and value rows: level, items, purchases, and Folks when it has Worker Folks' half. */
  const holdsRows = (b) => {
    const rows = [
      { cells: [t('MOD_VOY_BACKUP_ROW_LEVEL'), num(level(b.xp))] },
      { cells: [t('MOD_VOY_BACKUP_ROW_ITEMS'), count(Object.keys(b.items).length, 'MOD_VOY_BACKUP_KIND', 'MOD_VOY_BACKUP_KINDS')] },
      { cells: [t('MOD_VOY_BACKUP_ROW_BUYS'), num(Object.keys(b.buys).length)] },
    ];
    if (b.folks !== null && b.folks.length > 0) rows.push({ cells: [t('MOD_VOY_BACKUP_ROW_FOLKS'), count(b.folks.length, 'MOD_VOY_BACKUP_FOLK', 'MOD_VOY_BACKUP_FOLKS_N')] });
    return { table: { rows } };
  };
  /** The body around the bands, a closing line under them, and the popup's width (the help popups'). */
  const body = (sections, foot) => H.helpHtml(sections) + (foot === undefined ? '' : `<p class="voyage-help-p voyage-backup-foot-line">${esc(foot)}</p>`);
  const codeBox = (attrs) => `<textarea class="form-control voyage-backup-code" rows="4" spellcheck="false" autocomplete="off" aria-label="${esc(t('MOD_VOY_BACKUP_CODE'))}" ${attrs}`;

  // ---- what there is now ----------------------------------------------------------------------------------------
  const bankItems = () => {
    const out = {};
    try { for (const [item, b] of game.bank.items) if (item.namespace === 'voyage') out[item.id] = b.quantity; } catch (e) { log('backup: bank read failed', e); }
    return out;
  };
  const shopBuys = () => {
    const out = {};
    try { for (const [p, n] of game.shop.upgradesPurchased) if (p.namespace === 'voyage') out[p.id] = n; } catch (e) { log('backup: shop read failed', e); }
    return out;
  };
  /** Worker Folks when it is loaded and new enough, else undefined. */
  const folksApi = () => { try { return state.folksApi?.(); } catch { return undefined; } };
  /** Each Folk now as the backup keeps it: hex, travel and its traits held and waiting (backup-model cleanFolks). */
  const folksNow = (api) => {
    try {
      return api.folks().map((f) => {
        let traits = f.traits ?? [];
        try { const x = api.traitsOf?.(f.id); if (x !== undefined) traits = [...x.held, ...x.waiting]; } catch {}
        return { id: f.id, name: f.name, place: f.place, travel: f.travel, traits };
      });
    } catch (e) { log('backup: Folks read failed', e); return undefined; }
  };
  const names = (list) => list.map((x) => (typeof x === 'string' ? x : x.name)).join(', ');
  const storage = () => {
    const out = {};
    for (const k of STORAGE_KEYS) { try { const v = ctx.characterStorage.getItem(k); if (v !== undefined) out[k] = v; } catch {} }
    return out;
  };

  // ---- Back up ----------------------------------------------------------------------------------------------------
  const backUp = async () => {
    const s = skill();
    if (s === undefined) return;
    if (s.futureRaw !== undefined) { tell(t('MOD_VOY_BACKUP_TITLE'), t('MOD_VOY_BACKUP_FUTURE'), 'warning'); return; }
    const why = B.blockedBy(s.record);
    if (why === 'voyage' || why === 'adrift') { tell(t('MOD_VOY_BACKUP_TITLE'), t(why === 'voyage' ? 'MOD_VOY_BACKUP_NOT_AT_SEA' : 'MOD_VOY_BACKUP_NOT_ADRIFT'), 'warning'); return; }
    const backup = B.make({
      record: model.serializeSave(s.record), xp: s.xp, items: bankItems(), buys: shopBuys(),
      settings: settingsIO?.read?.() ?? {}, storage: storage(),
      folks: (() => { const api = folksApi(); return api === undefined ? null : folksNow(api) ?? null; })(),
      name: game.characterName, mode: game.currentGamemode?.id, mod: ctx.version, build: BUILD, save: model.SAVE_VERSION, at: Date.now(),
    });
    let code;
    try { code = await B.encode(backup); } catch (e) { log('backup: encode failed', e); tell(t('MOD_VOY_BACKUP_TITLE'), t('MOD_VOY_BACKUP_FAILED'), 'error'); return; }
    const file = B.fileName(backup.name, backup.at);
    const html = body([
      { head: t('MOD_VOY_BACKUP_IN_HEAD'), body: [holdsRows(backup), t('MOD_VOY_BACKUP_ALSO')] },
      { head: t('MOD_VOY_BACKUP_KEEP_HEAD'), warn: true, body: [t('MOD_VOY_BACKUP_KEEP')] },
      { head: t('MOD_VOY_BACKUP_CODE_HEAD'), body: [{ raw: `${codeBox('readonly')}>${esc(code)}</textarea>`
        + `<div class="voyage-backup-acts"><button type="button" class="btn btn-outline-info" data-voyage-backup="copy">${esc(t('MOD_VOY_BACKUP_COPY'))}</button>`
        + `<button type="button" class="btn btn-outline-info" data-voyage-backup="download">${esc(t('MOD_VOY_BACKUP_DOWNLOAD'))}</button></div>`
        + `<p class="voyage-help-p voyage-backup-note text-muted" data-voyage-backup="note" aria-live="polite">${esc(t('MOD_VOY_BACKUP_SIZE', { kb: num(Math.max(1, Math.round(code.length / 1024))) }))}</p>` }] },
    ]);
    SwalLocale.fire({
      customClass: swalClass(SWAL_CLASS),
      width: H.HELP_WIDTH,
      title: t('MOD_VOY_BACKUP_TITLE'),
      html,
      confirmButtonText: t('MOD_VOY_BACKUP_DONE'),
      didRender: (el) => {
        try { state.popupDidRender?.(el); } catch {}
        const box = el?.querySelector?.('.voyage-backup-acts');
        if (box == null || box.dataset.voyageBound === '1') return;
        box.dataset.voyageBound = '1';
        const note = el.querySelector('[data-voyage-backup="note"]');
        const area = el.querySelector('.voyage-backup-code');
        // What the last button did, under them: green when done, amber when it needs the player's hand.
        const say = (key, ok, vars) => { if (note === null) return; note.textContent = t(key, vars); note.className = `voyage-help-p voyage-backup-note ${ok ? 'text-success' : 'text-warning'}`; };
        box.addEventListener('click', async (e) => {
          const b = e.target instanceof Element ? e.target.closest('[data-voyage-backup]') : null;
          if (b === null) return;
          if (b.dataset.voyageBackup === 'copy') {
            // The old copy first: it runs inside the click and never waits. The clipboard API can hang without focus.
            let ok = false;
            try { area.focus(); area.select(); ok = document.execCommand('copy') === true; } catch {}
            if (!ok && navigator.clipboard?.writeText !== undefined) {
              try { ok = await Promise.race([navigator.clipboard.writeText(code).then(() => true), new Promise((res) => setTimeout(() => res(false), 2000))]); } catch {}
            }
            say(ok ? 'MOD_VOY_BACKUP_COPIED' : 'MOD_VOY_BACKUP_COPY_FAILED', ok);
          } else {
            try {
              const url = URL.createObjectURL(new Blob([code], { type: 'text/plain' }));
              const a = document.createElement('a');
              a.href = url; a.download = file; document.body.append(a); a.click(); a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 10_000);
              say('MOD_VOY_BACKUP_SAVED', true, { file });
            } catch (err) { log('backup: download failed', err); say('MOD_VOY_BACKUP_DOWNLOAD_FAILED', false); }
          }
        });
      },
    });
  };

  // ---- Restore ----------------------------------------------------------------------------------------------------
  /** The restored record's walks, for the Folks plan. */
  const walksOf = (b) => { try { return model.loadSave(b.record).save?.walks ?? {}; } catch { return {}; } };
  const planFolks = (b) => {
    const api = folksApi();
    if (api === undefined) return undefined;
    const now = folksNow(api);
    return now === undefined ? undefined : { api, plan: B.folksPlan(b, now, walksOf(b)) };
  };
  /**
   * Worker Folks' side, before the record: a Folk moved or stopped fires Voyage's own listeners (kept jobs, trait
   * counts), and those then touch the record being replaced, not the restored one.
   */
  const applyFolks = (b) => {
    const p = planFolks(b);
    if (p === undefined) return;
    const { api, plan } = p;
    for (const m of plan.moves) {
      try { api.setPlace(m.id, m.place); if (!api.setTravel(m.id, m.travel)) log(`backup: ${m.name} kept its travel`); } catch (e) { log(`backup: ${m.name} not moved`, e); }
    }
    for (const h of plan.halt) { try { api.setTravel(h.id, 'idle'); } catch (e) { log(`backup: ${h.name} not stopped`, e); } }
    for (const [id, x] of plan.drop) { try { api.dropTrait(id, x); } catch (e) { log(`backup: ${x} not dropped`, e); } }
    for (const [id, x] of plan.earn) { try { if (!api.earnTrait(id, x)) log(`backup: ${x} not learned by ${id}`); } catch (e) { log(`backup: ${x} not learned`, e); } }
    log(`backup: Folks ${plan.moves.length} moved, ${plan.halt.length} stopped, ${plan.earn.length} traits learned, ${plan.drop.length} dropped, ${plan.gone.length} not hired now`);
  };

  const apply = (b) => {
    const s = skill();
    applyFolks(b);
    const { save } = model.loadSave(b.record);
    s.futureRaw = undefined;
    s.record = save;
    s.setXP(b.xp);
    const plan = B.restorePlan(b, { items: bankItems(), buys: shopBuys() });
    for (const [id, n] of plan.add) { try { game.bank.addItemByID(id, n, false, false, true); } catch (e) { log(`backup: ${id} not added`, e); } }
    for (const [id, n] of plan.buys) {
      try { const p = game.shop.purchases.getObjectByID(id); if (p !== undefined) game.shop.upgradesPurchased.set(p, n); } catch (e) { log(`backup: ${id} not bought`, e); }
    }
    try { settingsIO?.write?.(b.settings); } catch (e) { log('backup: settings not restored', e); }
    for (const [k, v] of Object.entries(b.storage)) { if (STORAGE_KEYS.includes(k)) { try { ctx.characterStorage.setItem(k, v); } catch (e) { log('backup: storage not restored', e); } } }
    log(`backup restored: Voyage ${level(b.xp)}, ${plan.add.length} items topped up, ${plan.buys.length} purchases`);
    saveData();
    setTimeout(() => location.reload(), 300);
  };

  const confirmRestore = (b) => {
    const s = skill();
    const sections = [];
    // A Creator Toolkit zip has no version: the line leaves it out.
    const from = H.marked(t, b.mod !== '' ? 'MOD_VOY_RESTORE_FROM' : 'MOD_VOY_RESTORE_FROM_DEV', { mod: b.mod }, { name: H.mark.name(b.name || '?'), when: H.mark.name(when(b.at)) });
    sections.push({ head: t('MOD_VOY_BACKUP_IN_HEAD'), body: [{ html: from }, holdsRows(b), t('MOD_VOY_BACKUP_ALSO')] });
    // What is lost: the skill as it is now, and a backup of another character.
    const lost = [];
    if (s.xp > 0) lost.push({ html: H.marked(t, 'MOD_VOY_RESTORE_REPLACES', {}, { now: H.mark.name(num(level(s.xp))), then: H.mark.name(num(level(b.xp))) }) });
    if (b.name !== '' && b.name !== game.characterName) lost.push({ html: H.marked(t, 'MOD_VOY_RESTORE_OTHER', {}, { name: H.mark.name(b.name), here: H.mark.name(game.characterName) }) });
    if (lost.length > 0) sections.push({ head: t('MOD_VOY_RESTORE_LOST_HEAD'), warn: true, body: lost });
    // What comes back to the bank and the shop.
    const plan = B.restorePlan(b, { items: bankItems(), buys: shopBuys() });
    const bank = [];
    if (plan.add.length > 0) {
      const rows = plan.add.slice(0, 6).map(([id, n]) => { let it; try { it = game.items.getObjectByID(id); } catch {} return { cells: [it?.name ?? id, num(n)], icon: it?.media }; });
      bank.push({ table: { rows } });
      if (plan.add.length > 6) bank.push(t('MOD_VOY_RESTORE_ITEMS_MORE', { more: num(plan.add.length - 6) }));
    }
    if (plan.buys.length > 0) bank.push(t('MOD_VOY_RESTORE_BUYS', { buys: plan.buys.map(([id]) => nameOf(id, game.shop.purchases)).join(', ') }));
    if (bank.length === 0) bank.push(t('MOD_VOY_RESTORE_BANK_NONE'));
    sections.push({ head: t('MOD_VOY_RESTORE_BANK_HEAD'), body: bank });
    // Worker Folks' side: put back, made without it, or held by a backup while Worker Folks is off now.
    const fp = planFolks(b);
    let goKey = 'MOD_VOY_RESTORE_GO';
    if (fp === undefined) {
      if (b.folks !== null && b.folks.length > 0) {
        sections.push({ head: t('MOD_VOY_BACKUP_ROW_FOLKS'), warn: true, body: [t('MOD_VOY_RESTORE_FOLKS_OFF', { n: count(b.folks.length, 'MOD_VOY_BACKUP_FOLK', 'MOD_VOY_BACKUP_FOLKS_N') }), t('MOD_VOY_RESTORE_FOLKS_OFF_FIX')] });
        goKey = 'MOD_VOY_RESTORE_GO_NO_FOLKS';
      }
    } else {
      const f = fp.plan;
      const lines = [];
      if (f.none) lines.push(t('MOD_VOY_RESTORE_FOLKS_NONE'));
      else if (f.moves.length === 1) lines.push(t('MOD_VOY_RESTORE_FOLKS_ONE', { name: f.moves[0].name }));
      else if (f.moves.length > 1) lines.push(t('MOD_VOY_RESTORE_FOLKS', { n: num(f.moves.length) }));
      else if (f.back > 0 && f.earn.length + f.drop.length === 0) lines.push(t(f.back === 1 ? 'MOD_VOY_RESTORE_FOLKS_SAME_ONE' : 'MOD_VOY_RESTORE_FOLKS_SAME', { n: num(f.back) }));
      // Only the parts that happen: "1 learned again", "2 dropped", or both.
      if (f.earn.length > 0 || f.drop.length > 0) {
        const key = f.drop.length === 0 ? 'MOD_VOY_RESTORE_TRAITS_EARN' : f.earn.length === 0 ? 'MOD_VOY_RESTORE_TRAITS_DROP' : 'MOD_VOY_RESTORE_TRAITS';
        lines.push(t(key, { earn: num(f.earn.length), drop: num(f.drop.length) }));
      }
      if (f.halt.length > 0) lines.push(t('MOD_VOY_RESTORE_HALT', { names: names(f.halt) }));
      if (f.gone.length > 0) lines.push({ text: t('MOD_VOY_RESTORE_GONE', { names: names(f.gone) }), cls: 'text-warning' });
      if (lines.length > 0) sections.push({ head: t('MOD_VOY_BACKUP_ROW_FOLKS'), warn: f.gone.length > 0, body: lines });
    }
    SwalLocale.fire({
      customClass: swalClass(SWAL_WARN),
      width: H.HELP_WIDTH,
      title: t('MOD_VOY_RESTORE_TITLE'),
      html: body(sections, t('MOD_VOY_RESTORE_RELOAD')),
      showCancelButton: true,
      confirmButtonText: t(goKey),
      cancelButtonText: t('MOD_VOY_RESTORE_CANCEL'),
      didRender: (el) => { try { state.popupDidRender?.(el); } catch {} },
    }).then((res) => { if (res.isConfirmed) { try { apply(b); } catch (e) { log('backup: restore failed', e); tell(t('MOD_VOY_RESTORE_TITLE'), t('MOD_VOY_RESTORE_FAILED'), 'error'); } } });
  };

  const restore = () => {
    const s = skill();
    if (s === undefined) return;
    // A save from a newer Voyage is kept untouched by this one; a restore would overwrite it.
    if (s.futureRaw !== undefined) { tell(t('MOD_VOY_RESTORE_TITLE'), t('MOD_VOY_BACKUP_FUTURE'), 'warning'); return; }
    const why = B.blockedBy(s.record);
    if (why === 'voyage' || why === 'adrift') { tell(t('MOD_VOY_RESTORE_TITLE'), t(why === 'voyage' ? 'MOD_VOY_RESTORE_NOT_AT_SEA' : 'MOD_VOY_RESTORE_NOT_ADRIFT'), 'warning'); return; }
    const html = body([{ head: t('MOD_VOY_BACKUP_CODE_HEAD'), body: [t('MOD_VOY_RESTORE_PASTE'), { raw: `${codeBox('id="voyage-restore-code"')}></textarea>`
      + `<div class="voyage-backup-acts"><label class="btn btn-outline-info mb-0">${esc(t('MOD_VOY_RESTORE_FILE'))}`
      + `<input type="file" accept=".txt,text/plain" class="d-none" data-voyage-backup="file"></label></div>`
      + '<p class="voyage-help-p voyage-backup-note text-success" data-voyage-backup="loaded" aria-live="polite"></p>' }] }]);
    SwalLocale.fire({
      customClass: swalClass(SWAL_CLASS),
      width: H.HELP_WIDTH,
      title: t('MOD_VOY_RESTORE_TITLE'),
      html,
      showCancelButton: true,
      confirmButtonText: t('MOD_VOY_RESTORE_NEXT'),
      cancelButtonText: t('MOD_VOY_RESTORE_CANCEL'),
      didRender: (el) => {
        try { state.popupDidRender?.(el); } catch {}
        const input = el?.querySelector?.('[data-voyage-backup="file"]');
        if (input == null || input.dataset.voyageBound === '1') return;
        input.dataset.voyageBound = '1';
        // A new code or file clears the last refusal under the field: it was about the code before.
        const fresh = () => { try { Swal.resetValidationMessage(); } catch {} };
        el.querySelector('#voyage-restore-code')?.addEventListener('input', fresh);
        input.addEventListener('change', async () => {
          const f = input.files?.[0];
          if (f === undefined) return;
          fresh();
          const loaded = el.querySelector('[data-voyage-backup="loaded"]');
          try {
            document.getElementById('voyage-restore-code').value = await f.text();
            if (loaded !== null) { loaded.textContent = t('MOD_VOY_RESTORE_LOADED', { file: f.name }); loaded.className = 'voyage-help-p voyage-backup-note text-success'; }
          } catch (e) {
            log('backup: file read failed', e);
            if (loaded !== null) { loaded.textContent = t('MOD_VOY_RESTORE_LOAD_FAILED'); loaded.className = 'voyage-help-p voyage-backup-note text-warning'; }
          }
        });
      },
      preConfirm: async () => {
        const r = await B.decode(document.getElementById('voyage-restore-code')?.value ?? '', model.SAVE_VERSION);
        if (r.backup !== undefined) return r.backup;
        Swal.showValidationMessage(t(WHY[r.why] ?? WHY.broken));
        return false;
      },
    }).then((res) => { if (res.isConfirmed && res.value) confirmRestore(res.value); });
  };

  // ---- the page's foot --------------------------------------------------------------------------------------------
  const mount = (container) => {
    const foot = container?.querySelector?.('[data-voyage="backup-foot"]');
    if (foot == null || foot.firstChild !== null) return;
    foot.innerHTML = `<button type="button" class="btn btn-sm btn-outline-secondary" data-voyage-backup="out">${esc(t('MOD_VOY_BACKUP_BUTTON'))}</button>`
      + `<button type="button" class="btn btn-sm btn-outline-secondary" data-voyage-backup="in">${esc(t('MOD_VOY_RESTORE_BUTTON'))}</button>`;
    const [out, inn] = foot.querySelectorAll('button');
    const tip = (el, key) => { if (state.tips !== undefined) state.tips.set(el, t(key)); else el.title = t(key); };
    tip(out, 'MOD_VOY_BACKUP_HINT');
    tip(inn, 'MOD_VOY_RESTORE_HINT');
    out.onclick = () => { backUp().catch((e) => log('backup failed', e)); };
    inn.onclick = () => restore();
  };

  return { mount, backUp, restore };
}
