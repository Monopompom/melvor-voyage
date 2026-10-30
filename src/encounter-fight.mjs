// The encounter popup (design 4.33): one popup from the meeting to the result. The meet (who they are, how they take
// each suit, what paying, running, winning and losing cost, and Fight, Pay, Run, Auto-resolve), the fight (their Nerve
// and move above, your Resolve, the round's plays and suits, your hand of cards at the foot), and the result (what it
// cost or brought, the loot, Press on). It draws what src/encounters.mjs holds and sends every press back to it.

const SUIT_ICON = { steel: 'fa-khanda', powder: 'fa-bomb', coin: 'fa-coins', wits: 'fa-chess-knight' };
const MOVE_ICON = { strike: 'fa-fist-raised', charge: 'fa-horse-head', volley: 'fa-crosshairs', board: 'fa-anchor', grab: 'fa-hand-holding-usd', call: 'fa-users', brace: 'fa-shield-alt', hex: 'fa-ghost', taunt: 'fa-pray', flee: 'fa-running' };
const HITS = ['strike', 'charge', 'volley', 'board'];
// The popup takes 90% of the game's screen both ways over a dimmed game (the user, 30 Oct 2026); a phone gets nearly
// all of it (css).
const POPUP_WIDTH = '90vw';

export function install(ctx, { state, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fa = (icon, cls = '') => `<i class="fa ${icon}${cls ? ` ${cls}` : ''}" aria-hidden="true"></i>`;
  const ROOT = 'voyage-enc-root';
  const root = () => document.getElementById(ROOT);

  const skillName = (id) => { try { return game.skills.allObjects.find((s) => s.localID === id)?.name ?? id; } catch { return id; } };
  const itemOf = (id) => { try { return game.items.getObjectByID(id); } catch { return undefined; } };
  const gpSign = (api, n) => `<span class="voyage-enc-num ${n >= 0 ? 'voyage-enc-plus' : 'voyage-enc-minus'}">${n >= 0 ? '+' : '−'}${esc(api.text(Math.abs(n)))} GP</span>`;
  /** A result line: its vars as words, a trick's cards joined as a run (→). */
  const resText = (api, l) => {
    const vars = {};
    for (const [k, v] of Object.entries(l.vars ?? {})) vars[k] = Array.isArray(v) ? v.map(api.text).join(' → ') : api.text(v);
    return t(l.key, vars);
  };

  // ---- pieces ------------------------------------------------------------------------------------------------------
  const head = (api, f) => {
    const { E } = api;
    const sea = f.opt.where === 'sea';
    return `<div class="voyage-enc-head"><span class="voyage-enc-title">${esc(api.bandName(f.opt.band))}</span>`
      + `<span class="voyage-enc-chip voyage-enc-chip-tier">${esc(t('MOD_VOY_ENC_TIER', { n: `${f.opt.tier}` }))}</span>`
      + `<span class="voyage-enc-chip ${sea ? 'voyage-enc-chip-sea' : 'voyage-enc-chip-land'}">${fa(sea ? 'fa-ship' : 'fa-mountain')}${esc(t(sea ? 'MOD_VOY_ENC_AT_SEA' : 'MOD_VOY_ENC_ON_LAND'))}</span>`
      + (f.opt.battered > 0 ? `<span class="voyage-enc-chip voyage-enc-chip-tier">${esc(t('MOD_VOY_ENC_BATTERED_CHIP', { n: `${f.opt.battered * E.BATTER}` }))}</span>` : '')
      + '</div>';
  };
  /** How the band takes each suit, and its other habits, as chips. */
  const traits = (api, def) => {
    const { E } = api;
    const out = [];
    for (const k of E.SUITS) {
      const x = E.suitMul(def, k);
      if (x !== 1) out.push(`<span class="voyage-enc-chip voyage-enc-trait ${x > 1 ? 'voyage-enc-weak' : 'voyage-enc-tough'} voyage-enc-s-${k}">${fa(SUIT_ICON[k])}${esc(t('MOD_VOY_ENC_TRAIT_SUIT', { suit: t(E.suitKey(k)), x: `${x}` }))}</span>`);
    }
    if (def.rattled) out.push(`<span class="voyage-enc-chip voyage-enc-trait voyage-enc-weak voyage-enc-s-wits">${fa('fa-chess-knight')}${esc(t('MOD_VOY_ENC_TRAIT_RATTLED'))}</span>`);
    if (def.hidden) out.push(`<span class="voyage-enc-chip voyage-enc-trait">${fa('fa-eye-slash')}${esc(t('MOD_VOY_ENC_TRAIT_HIDDEN'))}</span>`);
    if (def.flee) out.push(`<span class="voyage-enc-chip voyage-enc-trait">${fa('fa-running')}${esc(t('MOD_VOY_ENC_TRAIT_FLEE', { pct: `${Math.round(def.flee * 100)}` }))}</span>`);
    return `<div class="voyage-enc-traits">${out.join('')}</div>`;
  };
  /** A card as the hand and the deck show it (150 × 212 px). */
  // A card's text marked up (.459, the user): the game's terms with the icon and colour the board gives them (a burst for
  // a hit, .461), the number after one in bold. The words come from the language file (alternatives split by |), so a translation names
  // its own; the moves by their names, the suits in their colours.
  const MARKS = [
    // key, icon, class, whether it can stand as the card's emblem
    ['MOD_VOY_ENC_MARK_HIT', 'fa-bahai', 'voyage-enc-m-hit', true],
    ['MOD_VOY_ENC_MARK_GUARD', 'fa-shield-alt', 'voyage-enc-m-guard', true],
    ['MOD_VOY_ENC_MARK_HEAL', 'fa-heart', 'voyage-enc-m-heal', true],
    ['MOD_VOY_ENC_MARK_DRAW', 'fa-clone', 'voyage-enc-m-draw', true],
    ['MOD_VOY_ENC_MARK_EDGE', 'fa-dot-circle', 'voyage-enc-m-edge', false],
    ['MOD_VOY_ENC_MARK_STOP', '', 'voyage-enc-m-stop', false],
  ];
  let marker;
  const markerOf = (E) => {
    if (marker === undefined) {
      const words = (s) => String(s).split('|').map((w) => w.trim().replace(/[.*+?^${}()[\]\\]/g, '\\$&')).filter((w) => w !== '');
      const list = MARKS.map(([key, icon, cls, em]) => ({ words: words(t(key)), icon, cls, em }));
      for (const kind of ['strike', 'charge', 'volley', 'board', 'grab']) list.push({ words: words(t(E.kindKey(kind))), icon: MOVE_ICON[kind], cls: 'voyage-enc-m-move' });
      for (const suit of E.SUITS) list.push({ words: words(t(E.suitKey(suit))), icon: '', cls: `voyage-enc-m-${suit}` });
      const by = new Map();
      for (const m of list) for (const w of m.words) if (!by.has(w)) by.set(w, m);
      const alt = [...by.keys()].sort((a, b) => b.length - a.length).join('|');
      marker = { by, rx: alt === '' ? null : new RegExp(`(?<![\\w<])(${alt})(?![\\w>])((?:\\s*[−+])?\\s*(?:<b>[^<]*</b>|\\d+))?`, 'g') };
    }
    return marker;
  };
  /** A card's text with its terms marked; `found` collects each mark and its number. */
  const markText = (html, E, found = []) => {
    const { by, rx } = markerOf(E);
    if (rx === null) return html;
    return html.replace(rx, (all, word, num) => {
      const m = by.get(word.replace(/[.*+?^${}()[\]\\]/g, '\\$&'));
      if (m === undefined) return all;
      const n = num === undefined ? '' : num.includes('<b>') ? num : num.replace(/([−+]?\s*)(\d+)/, '$1<b>$2</b>');
      found.push({ m, word, n: n.replace(/<[^>]+>|\s/g, '') });
      return `<span class="voyage-enc-mark ${m.cls}">${m.icon ? fa(m.icon) : ''}${word}${n}</span>`;
    });
  };
  /**
   * A main line that is only values (Deal 5; Guard 1, Draw 1; Nerve −2) shows them large, as the card's emblem (.461,
   * the user): an icon and the number over the word. Anything else stays as text.
   */
  const emblemOf = (raw, found, E) => {
    const { rx } = markerOf(E);
    if (rx === null || found.length === 0 || found.length > 2 || !found.every((f) => f.m.em && f.n !== '')) return '';
    if (raw.replace(rx, '').replace(/[\s.,;]/g, '') !== '') return '';
    return `<div class="voyage-enc-ems" aria-hidden="true">${found.map((f) => `<div class="voyage-enc-em ${f.m.cls}"><div class="voyage-enc-em-v">${fa(f.m.icon)}${esc(f.n)}</div><div class="voyage-enc-em-cap">${esc(f.word)}</div></div>`).join('')}</div>`;
  };
  const SRC_TAG = { starter: 'MOD_VOY_ENC_TAG_COMMON', milestone: 'MOD_VOY_ENC_TAG_MILESTONE', shop: 'MOD_VOY_ENC_TAG_SHOP', folk: 'MOD_VOY_ENC_TAG_CREW', curse: 'MOD_VOY_ENC_TAG_UNPLAYABLE' };
  const cardFace = (api, id, s) => {
    const { E } = api;
    const d = E.CARDS[id];
    const suit = d.suit ?? 'curse';
    const n = d.n != null ? (s !== undefined ? E.cardN(s, { id }) : Math.max(1, d.n + (api.tilt()[d.skill] ?? 0))) : null;
    // The main effect, then (after a line break in the text) what else it does, in a panel of its own (.460, the user).
    const [mainRaw, ...moreRaw] = t(E.cardTextKey(id), { n: '\u0001' }).split('\n').map((part) => esc(part).replace('\u0001', `<b>${n ?? ''}</b>`));
    const found = [];
    const main = markText(mainRaw, E, found);
    const more = moreRaw.map((part) => markText(part, E));
    const emblem = emblemOf(mainRaw, found, E);
    const tl = d.skill ? (s !== undefined ? E.tiltOf(s, id) : api.tilt()[d.skill] ?? 0) : 0;
    const tags = [];
    // Quick and Rare show as their symbol alone, the word in the tooltip, so the tags keep to one row (.462, the user).
    if (d.quick) tags.push(`<span class="voyage-enc-tag voyage-enc-tag-sym voyage-enc-tag-fin" title="${esc(t('MOD_VOY_ENC_QUICK_TIP'))}">${fa('fa-bolt')}<span class="sr-only">${esc(t('MOD_VOY_ENC_QUICK'))}</span></span>`);
    if (d.src === 'crafted') tags.push(`<span class="voyage-enc-tag voyage-enc-tag-supply">${esc(t('MOD_VOY_ENC_TAG_SUPPLY'))}</span>`);
    if (d.where) tags.push(`<span class="voyage-enc-tag voyage-enc-tag-where">${esc(t(d.where === 'sea' ? 'MOD_VOY_ENC_TAG_SEA' : 'MOD_VOY_ENC_TAG_LAND'))}</span>`);
    if (d.src === 'ship') tags.push(`<span class="voyage-enc-tag">${esc(t('MOD_VOY_ENC_TAG_SHIP'))}</span>`);
    if (d.src === 'drop') tags.push(`<span class="voyage-enc-tag voyage-enc-tag-sym voyage-enc-tag-rare" title="${esc(t('MOD_VOY_ENC_TAG_RARE'))}">${fa('fa-gem')}<span class="sr-only">${esc(t('MOD_VOY_ENC_TAG_RARE'))}</span></span>`);
    if (d.finisher) tags.push(`<span class="voyage-enc-tag voyage-enc-tag-fin">${esc(t('MOD_VOY_ENC_TAG_FINISHER'))}</span>`);
    if (d.gp) {
      const cost = s !== undefined ? E.cardCost(s, id) : undefined;
      tags.push(`<span class="voyage-enc-tag voyage-enc-tag-gp">${esc(cost === 0 ? t('MOD_VOY_ENC_TAG_FREE') : cost !== undefined ? t('MOD_VOY_ENC_TAG_GP', { gp: api.text(cost) }) : t('MOD_VOY_ENC_TAG_TOLL', { pct: `${d.gp}` }))}</span>`);
    }
    // Every card wears a tag (the user): one with none of the above says where it comes from.
    if (tags.length === 0 && SRC_TAG[d.src]) tags.push(`<span class="voyage-enc-tag">${esc(t(SRC_TAG[d.src]))}</span>`);
    // The skill, its level and tilt at the head's right (.461, the user), leaving the foot to the tags.
    const skill = d.skill ? `<span class="voyage-enc-card-skill">${esc(skillName(d.skill))}${d.lvl ? ` ${d.lvl}` : ''}${tl > 0 ? ` <span class="voyage-enc-tilt-up" title="${esc(t('MOD_VOY_ENC_TILT_UP'))}">▲</span>` : tl < 0 ? ` <span class="voyage-enc-tilt-dn" title="${esc(t('MOD_VOY_ENC_TILT_DN'))}">▼</span>` : ''}</span>` : '';
    return `<div class="voyage-enc-card" data-suit="${suit}">`
      + `<div class="voyage-enc-card-top">${fa(SUIT_ICON[d.suit] ?? 'fa-ghost')}${esc(d.suit ? t(E.suitKey(d.suit)) : t('MOD_VOY_ENC_CURSE'))}${skill}</div>`
      + `<div class="voyage-enc-card-name">${esc(t(E.cardKey(id)))}</div>`
      // The body, centred over a faint suit mark: the emblem, or the main line as text.
      + `<div class="voyage-enc-card-body">${fa(`${SUIT_ICON[d.suit] ?? 'fa-ghost'} voyage-enc-card-wm`)}`
      + (emblem !== '' ? `${emblem}<span class="sr-only">${main}</span>` : `<div class="voyage-enc-card-text">${main}</div>`) + '</div>'
      + (more.length > 0 ? `<div class="voyage-enc-card-more">${more.join(' ')}</div>` : '')
      + `<div class="voyage-enc-card-foot">${tags.join('')}</div></div>`;
  };
  const btn = (act, label, { cls = 'btn-outline-secondary', icon, sub, disabled = false, title, pressed } = {}) =>
    `<button type="button" class="btn btn-sm ${cls} voyage-enc-btn" data-act="${act}"${disabled ? ' disabled' : ''}${title ? ` title="${esc(title)}"` : ''}${pressed === undefined ? '' : ` aria-pressed="${pressed}"`}>`
    + `<span>${icon ? `${fa(icon)} ` : ''}${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</button>`;

  // ---- the meet ----------------------------------------------------------------------------------------------------
  const lootLine = (api, f) => {
    const { L } = api;
    const at = L.lootAt(f.opt.band, f.opt.tier, api.grade(), api.has);
    const name = (id) => itemOf(id)?.name ?? id;
    const items = [...new Set(at.haul)].map(name);
    return t('MOD_VOY_ENC_STAKE_LOOT_LINE', {
      items: api.text(items), draws: `${at.draws}`, stash: at.stash ? name(at.stash) : '', stashPct: `${Math.round(at.stashOdds * 100)}`, rarePct: `${Math.round(at.rareOdds * 100)}`,
    });
  };
  /** The board's two sides at a glance, as the fight has them: you on the left, the band on the right. */
  const sideHtml = (who, icon, iconCls, label, cls, now, max, extra) => `<div class="voyage-enc-vs-side voyage-enc-vs-${who}">`
    + `<div class="voyage-enc-who">${fa(icon, iconCls)}${esc(label)}</div>`
    + `<div class="voyage-enc-bar ${cls}"><i style="width:${(100 * now / max).toFixed(1)}%"></i><span>${now} / ${max}</span></div>`
    + extra + '</div>';
  /** One outcome or choice spelled out: an icon in its colour, a word and what it means. */
  const outcome = (icon, cls, word, text) => `<div class="voyage-enc-out">${fa(icon, cls)}<div><b class="${cls}">${esc(word)}</b> ${esc(text)}</div></div>`;
  const meetHtml = (api, f) => {
    const { E, R } = api;
    const def = E.BANDS[f.opt.band];
    const s = E.newFight(f.opt);
    const o = api.oddsOf(f);
    const sea = f.opt.where === 'sea';
    const stake = R.stakeOf(f.opt.toll, f.opt.gp);
    const pct = (x) => `${Math.round(x * 100)}`;
    // A folded offline encounter: the claims of the bands met while you were away, nobody to run from.
    const away = f.away;
    const payLine = away !== undefined ? 'MOD_VOY_ENC_STAKE_PAY_AWAY' : f.rule === 'hold' ? 'MOD_VOY_ENC_STAKE_PAY_HOLD' : f.rule === 'fare' ? 'MOD_VOY_ENC_STAKE_PAY_FARE' : 'MOD_VOY_ENC_STAKE_PAY_GP';
    // A toll you can't cover in full: the rest is owed to them.
    const short = Math.max(0, f.opt.toll - f.opt.gp);
    const deckN = f.opt.deck.length + (sea ? f.opt.cannons + (f.opt.hull ? 1 : 0) : 0);
    const charms = (f.opt.charms ?? []).map((id) => `<span class="voyage-enc-chip">${fa('fa-gem', 'voyage-enc-s-wits')}${esc(t(E.charmKey(id)))}</span>`).join('');
    const you = sideHtml('you', 'fa-heart', 'voyage-enc-sea', t('MOD_VOY_ENC_YOUR_RESOLVE'), 'voyage-enc-resolve', s.you.max, s.you.max,
      `<div class="voyage-enc-vs-facts"><span class="voyage-enc-chip">${fa('fa-layer-group')}${esc(t('MOD_VOY_ENC_BTN_FIGHT_SUB', { n: `${deckN}` }))}</span>`
      + `<span class="voyage-enc-chip voyage-enc-num"><img class="voyage-enc-gp" src="${esc(game.gp.media)}" alt="">${esc(t('MOD_VOY_ENC_GP', { gp: api.text(f.opt.gp) }))}</span>${charms}</div>`);
    const them = sideHtml('them', 'fa-skull-crossbones', 'voyage-enc-hot', t('MOD_VOY_ENC_THEIR_NERVE'), 'voyage-enc-nerve', s.band.max, s.band.max,
      `<div class="voyage-enc-habit">${esc(t(`${def.key}_HABIT`))}</div>${traits(api, def)}`);
    const blows = outcome('fa-trophy', 'voyage-enc-good', t('MOD_VOY_ENC_STAKE_WIN'), t('MOD_VOY_ENC_STAKE_WIN_LINE', { gp: api.text(f.purse) }))
      + outcome('fa-gem', 'voyage-enc-rare', t('MOD_VOY_ENC_STAKE_LOOT'), lootLine(api, f))
      + outcome('fa-heart-broken', 'voyage-enc-bad', t('MOD_VOY_ENC_STAKE_LOSE'), t('MOD_VOY_ENC_STAKE_LOSE_LINE', { gp: api.text(stake) }))
      + (def.flee ? outcome('fa-running', 'voyage-enc-mid', t('MOD_VOY_ENC_STAKE_FLEE'), t(def.keepGrabs ? 'MOD_VOY_ENC_STAKE_FLEE_LINE_GRABS' : 'MOD_VOY_ENC_STAKE_FLEE_LINE', { pct: `${Math.round(def.flee * 100)}` })) : '')
      + outcome('fa-hourglass-end', 'voyage-enc-muted', t('MOD_VOY_ENC_STAKE_DRAW'), t('MOD_VOY_ENC_STAKE_DRAW_LINE', { n: `${E.MAX_ROUNDS}` }));
    const settle = outcome('fa-dice', 'voyage-enc-s-steel', t('MOD_VOY_ENC_BTN_AUTO'), t('MOD_VOY_ENC_AUTO_NOTE', { win: pct(o.win), fled: pct(o.fled), draw: pct(o.draw), lose: pct(o.lose) }))
      + outcome('fa-coins', 'voyage-enc-s-coin', t('MOD_VOY_ENC_STAKE_PAY'), t(payLine, { gp: api.text(f.opt.toll), pct: `${R.TOLL_PCT[f.opt.tier] + (f.debt > 0 ? R.DEBT_PCT : 0)}`, n: `${Math.min(R.AWAY_CAP, away?.n ?? 1)}` })
        + (short > 0 ? ` ${t('MOD_VOY_ENC_STAKE_PAY_SHORT', { gp: api.text(short) })}` : ''))
      + (away !== undefined ? '' : outcome('fa-running', 'voyage-enc-mid', t('MOD_VOY_ENC_STAKE_RUN'), sea ? t('MOD_VOY_ENC_STAKE_RUN_SEA', { wear: `${api.runWear()}` }) : t('MOD_VOY_ENC_STAKE_RUN_LAND', { pct: `${Math.round(R.RUN_LAND_DROP * 100)}` })));
    const others = (away?.n ?? 1) - 1;
    const lead = away !== undefined
      ? t(others === 0 ? 'MOD_VOY_ENC_MEET_AWAY_ONE' : others === 1 ? 'MOD_VOY_ENC_MEET_AWAY_TWO' : 'MOD_VOY_ENC_MEET_AWAY', { band: api.bandName(f.opt.band), n: `${others}`, nerve: `${s.band.max}` })
      : t(sea ? 'MOD_VOY_ENC_MEET_SEA' : 'MOD_VOY_ENC_MEET_LAND', { band: api.bandName(f.opt.band), nerve: `${s.band.max}` });
    const owed = f.debt > 0 ? `<div class="voyage-enc-owed">${fa('fa-file-invoice-dollar')} ${esc(t('MOD_VOY_ENC_MEET_OWED', { gp: api.text(f.debt), pct: `${R.DEBT_PCT}` }))}</div>` : '';
    return head(api, f) + '<div class="voyage-enc-body"><div class="voyage-enc-stage">'
      + `<div class="voyage-enc-lead">${esc(lead)}${owed}</div>`
      + `<div class="voyage-enc-vs">${you}<div class="voyage-enc-vs-mid" aria-hidden="true">${esc(t('MOD_VOY_ENC_VS'))}</div>${them}</div>`
      + '<div class="voyage-enc-panels">'
      + `<section class="voyage-enc-panel"><h3 class="voyage-enc-panel-ttl">${fa('fa-khanda')}${esc(t('MOD_VOY_ENC_IF_FIGHT'))}</h3>${blows}`
      + '</section>'
      + `<section class="voyage-enc-panel"><h3 class="voyage-enc-panel-ttl">${fa('fa-handshake')}${esc(t('MOD_VOY_ENC_NO_FIGHT'))}</h3>${settle}</section>`
      + '</div></div></div>'
      + `<div class="voyage-enc-dock"><div class="voyage-enc-choices${away !== undefined ? ' voyage-enc-choices-3' : ''}">`
      + btn('fight', t('MOD_VOY_ENC_BTN_FIGHT'), { cls: 'btn-primary', icon: 'fa-khanda', sub: t('MOD_VOY_ENC_BTN_FIGHT_SUB', { n: `${deckN}` }) })
      + btn('auto', t('MOD_VOY_ENC_BTN_AUTO'), { cls: 'btn-info', icon: 'fa-dice', sub: t('MOD_VOY_ENC_BTN_AUTO_SUB', { pct: pct(o.win + o.fled) }) })
      + btn('pay', t('MOD_VOY_ENC_BTN_PAY'), { cls: 'btn-warning', icon: 'fa-coins', sub: short > 0 ? t('MOD_VOY_ENC_BTN_PAY_SHORT', { gp: api.text(f.opt.gp), owed: api.text(short) }) : t('MOD_VOY_ENC_GP', { gp: api.text(f.opt.toll) }) })
      + (away !== undefined ? '' : btn('run', t('MOD_VOY_ENC_BTN_RUN'), { cls: 'btn-danger', icon: 'fa-running', sub: t(sea ? 'MOD_VOY_ENC_BTN_RUN_SUB_SEA' : 'MOD_VOY_ENC_BTN_RUN_SUB_LAND') }))
      + '</div></div>';
  };

  // ---- the fight ---------------------------------------------------------------------------------------------------
  const live = (api, s) => {
    const { E } = api;
    const m = s.intents[0];
    if (!E.seen(s)) return undefined;
    if (s.calledOff) return ['good', t('MOD_VOY_ENC_LIVE_STOPPED')];
    const attack = E.ATTACKS.includes(m.kind);
    if (attack && s.evade && s.evadeKinds.includes(m.kind)) return ['good', t('MOD_VOY_ENC_LIVE_MISS')];
    if (attack && s.outfoxed) return ['good', t('MOD_VOY_ENC_LIVE_OUTFOXED')];
    if (m.kind === 'call') return s.dealt >= m.stop ? ['good', t('MOD_VOY_ENC_LIVE_CALL_OK', { n: `${s.dealt}`, stop: `${m.stop}` })] : ['bad', t('MOD_VOY_ENC_LIVE_CALL', { n: `${s.dealt}`, stop: `${m.stop}` })];
    if (m.kind === 'grab') return s.you.guard >= m.stop ? ['good', t('MOD_VOY_ENC_LIVE_GRAB_OK', { n: `${s.you.guard}` })] : ['bad', t('MOD_VOY_ENC_LIVE_GRAB', { n: `${s.you.guard}`, stop: `${m.stop}`, gp: api.text(E.grabAmt(s, m.pct)) })];
    if (m.n && HITS.includes(m.kind)) {
      const got = E.incoming(s, m, s.you.guard);
      if (!got) return ['good', t('MOD_VOY_ENC_LIVE_BLOCKED')];
      return ['bad', m.kind === 'board' ? t('MOD_VOY_ENC_LIVE_HIT_GRAB', { n: `${got}`, gp: api.text(E.grabAmt(s, m.pct)) }) : t('MOD_VOY_ENC_LIVE_HIT', { n: `${got}` })];
    }
    return undefined;
  };
  const pips = (n, on, cls = '') => `<span class="voyage-enc-pips ${cls}">${Array.from({ length: n }, (_, i) => `<b class="${i < on ? 'on' : ''}"></b>`).join('')}</span>`;
  const seqHtml = (api, tr) => {
    const nm = (id) => `<span class="voyage-enc-s-${api.E.CARDS[id].suit}">${esc(t(api.E.cardKey(id)))}</span>`;
    return tr.across ? esc(t('MOD_VOY_ENC_SEQ_ACROSS', { a: '\u0001', b: '\u0002' })).replace('\u0001', nm(tr.seq[0])).replace('\u0002', nm(tr.seq[1])) : tr.seq.map(nm).join(' → ');
  };
  const last = { nerve: undefined, resolve: undefined, seed: undefined };
  const fightHtml = (api, f, s) => {
    const { E, R } = api;
    const b = s.band;
    const y = s.you;
    const it = s.intents[0];
    const hidden = !E.seen(s);
    const lv = live(api, s);
    const mt = hidden ? { head: t('MOD_VOY_ENC_HIDDEN'), sub: t('MOD_VOY_ENC_HIDDEN_SUB') } : { head: api.text(E.moveText(s, it).head), sub: api.text(E.moveText(s, it).sub) };
    const off = s.calledOff || lv?.[0] === 'good';
    if (last.seed !== f.opt.seed) { last.seed = f.opt.seed; last.nerve = undefined; last.resolve = undefined; }
    const nFlash = last.nerve !== undefined && b.nerve < last.nerve;
    const rFlash = last.resolve !== undefined && y.resolve < last.resolve;
    last.nerve = b.nerve;
    last.resolve = y.resolve;
    const ui = api.ui;
    let best = -1;
    if (ui.hint && !ui.toss) best = E.aiPick(s);
    const mixedN = E.SUITS.filter((k) => (s.suits[k] || 0) > 0).length;
    const suits = E.SUITS.map((k) => `<span class="voyage-enc-suitc voyage-enc-s-${k}" data-n="${Math.min(s.suits[k] || 0, 3)}" title="${esc(t(E.comboKey(k, (s.suits[k] || 0) < 2 ? 2 : 3)))}">${fa(SUIT_ICON[k])}${s.suits[k] || 0}</span>`).join('')
      + `<span class="voyage-enc-suitc" data-n="${Math.min(3, mixedN)}" title="${esc(`${t(E.comboKey('mixed', 3))} · ${t(E.comboKey('mixed', 4))}`)}">${fa('fa-th-large')}${esc(t('MOD_VOY_ENC_SUITS_N', { n: `${mixedN}` }))}</span>`;
    const run = s.chain.slice(-2).map((x) => (x.round < s.round ? t('MOD_VOY_ENC_LAST_ROUND', { name: t(E.cardKey(x.id)) }) : t(E.cardKey(x.id)))).join(' → ');
    const lt = s.lastTrick && s.lastTrick.round === s.round ? s.lastTrick : null;
    const ltT = lt ? E.TRICKS[lt.id] : null;
    const nxt = s.intents[1] && s.charms.has('compass') && !s.def.hidden ? `<div class="voyage-enc-then">${fa('fa-compass')} ${esc(t('MOD_VOY_ENC_THEN', { move: api.text(E.moveText(s, s.intents[1]).head) }))}</div>` : '';
    const stakeNow = Math.round(R.stakeOf(f.opt.toll, s.gp) * b.nerve / b.max);
    const status = [
      `<span>${fa('fa-hourglass-half')} ${esc(t('MOD_VOY_ENC_ROUND', { n: `${s.round}`, of: `${s.maxRounds}` }))}</span>`,
      `<span>${esc(t('MOD_VOY_ENC_PLAYS'))} ${pips(E.PLAYS, s.plays)}</span>`,
      `<span class="voyage-enc-suits">${suits}</span>`,
      s.hasFinisher ? `<span title="${esc(t('MOD_VOY_ENC_EDGE_TIP', { max: `${E.EDGE_MAX}` }))}">${esc(t('MOD_VOY_ENC_EDGE'))} ${pips(E.EDGE_MAX, s.edge, 'voyage-enc-edge')}</span>` : '',
      run ? `<span class="voyage-enc-run" title="${esc(t('MOD_VOY_ENC_RUN_TIP'))}">${esc(t('MOD_VOY_ENC_RUN_CHAIN', { cards: run }))}</span>` : '',
      `<span class="voyage-enc-num"><img class="voyage-enc-gp" src="${esc(game.gp.media)}" alt=""> ${esc(t('MOD_VOY_ENC_GP', { gp: api.text(s.gp) }))}</span>`,
      s.phase === 'fight' ? `<span title="${esc(t('MOD_VOY_ENC_STAKE_NOW_TIP'))}">${esc(t('MOD_VOY_ENC_STAKE_NOW'))} <b class="voyage-enc-minus">${esc(t('MOD_VOY_ENC_GP', { gp: api.text(stakeNow) }))}</b></span>` : '',
      s.soften.length ? `<span>${esc(t('MOD_VOY_ENC_SOFTEN', { n: `${s.soften[0]}` }))}</span>` : '',
      b.weaken ? `<span>${esc(t('MOD_VOY_ENC_WEAKEN', { n: `${b.weaken}` }))}</span>` : '',
      b.bonus ? `<span class="voyage-enc-minus">${esc(t('MOD_VOY_ENC_BONUS', { n: `${b.bonus}` }))}</span>` : '',
      s.fuse ? `<span>${fa('fa-fire')} ${esc(t('MOD_VOY_ENC_FUSE', { n: `${s.fuse}` }))}</span>` : '',
    ].filter(Boolean).join('');
    const hand = s.hand.map((c, i) => {
      const ok = ui.toss ? (E.CARDS[c.id].dead ? { ok: false, why: 'MOD_VOY_ENC_TOSS_DREAD' } : { ok: true }) : E.canPlay(s, i);
      const tr = !ui.toss && ok.ok ? E.trickIf(s, c.id) : null;
      const known = tr && api.enc().tricks.includes(tr.id);
      const name = t(E.cardKey(c.id));
      const tip = ok.ok ? (ui.toss ? t('MOD_VOY_ENC_TOSS_TIP', { name }) : known ? t('MOD_VOY_ENC_PLAY_TRICK_TIP', { name, trick: t(E.trickKey(tr.id)) }) : t('MOD_VOY_ENC_PLAY_TIP', { name })) : t(ok.why);
      return `<button type="button" class="voyage-enc-card-btn${i === best ? ' voyage-enc-hint' : ''}${known ? ' voyage-enc-trick' : ''}" data-act="${ui.toss ? 'toss' : 'play'}" data-i="${i}" aria-disabled="${!ok.ok}" title="${esc(tip)}">${cardFace(api, c.id, s)}${known ? `<span class="voyage-enc-trick-badge">${fa('fa-magic')} ${esc(t(E.trickKey(tr.id)))}</span>` : ''}</button>`;
    }).join('') || `<div class="voyage-enc-note">${esc(t('MOD_VOY_ENC_HAND_EMPTY'))}</div>`;
    const logHtml = s.log.slice().reverse().slice(0, 40).map((l) => `<div class="voyage-enc-log-${l.t}"><span class="voyage-enc-r">${l.r ? `R${l.r}` : ''}</span><span>${esc(api.line(l))}</span></div>`).join('');
    return head(api, f) + `<div class="voyage-enc-body voyage-enc-board">`
      // You on the left, the band on the right, as the game's own combat screen has it (the user, 30 Oct 2026).
      + '<div class="voyage-enc-side">'
      + `<div class="voyage-enc-who">${fa('fa-heart', 'voyage-enc-sea')}${esc(t('MOD_VOY_ENC_YOUR_RESOLVE'))}</div>`
      + `<div class="voyage-enc-guard" title="${esc(t('MOD_VOY_ENC_YOUR_GUARD_TIP'))}">${y.guard ? `${fa('fa-shield-alt')} ${y.guard}${y.carry ? ` ${esc(t('MOD_VOY_ENC_GUARD_KEPT'))}` : ''}` : ''}</div>`
      + `<div class="voyage-enc-bar voyage-enc-resolve${rFlash ? ' voyage-enc-flash' : ''}"><i style="width:${(100 * y.resolve / y.max).toFixed(1)}%"></i><span>${y.resolve} / ${y.max}</span></div>`
      + `<div class="voyage-enc-status">${status}</div>`
      + '</div><div class="voyage-enc-side">'
      + `<div class="voyage-enc-who">${fa('fa-skull-crossbones', 'voyage-enc-hot')}${esc(t(s.phase === 'press' ? 'MOD_VOY_ENC_CAPTAIN_NERVE' : 'MOD_VOY_ENC_THEIR_NERVE'))}</div>`
      + `<div class="voyage-enc-guard" title="${esc(t('MOD_VOY_ENC_THEIR_GUARD_TIP'))}">${b.guard ? `${fa('fa-shield-alt')} ${b.guard}` : ''}</div>`
      + `<div class="voyage-enc-bar voyage-enc-nerve${nFlash ? ' voyage-enc-flash' : ''}"><i style="width:${(100 * b.nerve / b.max).toFixed(1)}%"></i><span>${b.nerve} / ${b.max}</span></div>`
      + `<div class="voyage-enc-intent${hidden ? ' voyage-enc-hidden-move' : off ? ' voyage-enc-off' : ''}"><div class="voyage-enc-ico">${fa(hidden ? 'fa-question' : MOVE_ICON[it.kind] ?? 'fa-fist-raised')}</div>`
      + `<div><div class="voyage-enc-move">${esc(mt.head)}</div><div class="voyage-enc-sub">${esc(mt.sub)}</div>${lv ? `<div class="voyage-enc-live voyage-enc-live-${lv[0]}">${esc(lv[1])}</div>` : ''}</div></div>`
      + nxt
      + (s.phase === 'chase' ? `<div class="voyage-enc-chase">${fa('fa-running')} ${esc(t('MOD_VOY_ENC_CHASE_BANNER', { n: `${b.nerve}` }))}</div>` : s.phase === 'press' ? `<div class="voyage-enc-habit">${esc(t('MOD_VOY_ENC_PRESS_NOTE'))}</div>` : traits(api, s.def))
      + '</div>'
      + (ltT ? `<div class="voyage-enc-trick-strip${lt.first ? ' voyage-enc-new' : ''}">${fa('fa-magic')} ${esc(t(lt.first ? 'MOD_VOY_ENC_TRICK_FOUND' : 'MOD_VOY_ENC_TRICK_FIRED', { name: t(E.trickKey(lt.id)) }))} ${seqHtml(api, ltT)}: ${esc(t(E.trickTextKey(lt.id)))}</div>` : '')
      + `<div class="voyage-enc-hand${ui.toss ? ' voyage-enc-tossing' : ''}">${hand}</div>`
      + '</div>'
      + '<div class="voyage-enc-actions">'
      + btn('end', t('MOD_VOY_ENC_END_ROUND'), { cls: 'btn-primary', icon: 'fa-step-forward' })
      + btn('tossmode', s.tossed ? t('MOD_VOY_ENC_TOSSED') : ui.toss ? t('MOD_VOY_ENC_TOSS_PICK') : t('MOD_VOY_ENC_TOSS'), { icon: 'fa-trash-alt', disabled: s.tossed, pressed: ui.toss, title: t('MOD_VOY_ENC_TOSS_HELP') })
      + btn('hint', ui.hint ? t('MOD_VOY_ENC_HINT_HIDE') : t('MOD_VOY_ENC_HINT'), { icon: 'fa-lightbulb', pressed: ui.hint })
      + btn('autoround', t('MOD_VOY_ENC_AUTO_ROUND'), { icon: 'fa-robot', title: t('MOD_VOY_ENC_AUTO_ROUND_TIP') })
      + btn('tricks', t('MOD_VOY_DECK_TRICKS'), { icon: 'fa-book-open', cls: 'btn-outline-secondary voyage-enc-tricks-btn' })
      + `<span class="voyage-enc-piles voyage-enc-num"><span title="${esc(t('MOD_VOY_ENC_PILE_DRAW'))}">${fa('fa-layer-group')} ${s.drawPile.length}</span><span title="${esc(t('MOD_VOY_ENC_PILE_DISCARD'))}">${fa('fa-recycle')} ${s.discard.length}</span><span title="${esc(t('MOD_VOY_ENC_PILE_GONE'))}">${fa('fa-times-circle')} ${s.gone.length}</span></span>`
      + '</div>'
      + `<div class="voyage-enc-body voyage-enc-logwrap"><div class="voyage-enc-log">${logHtml}</div></div>`;
  };

  // ---- the result --------------------------------------------------------------------------------------------------
  // The result on the same board (the user, 30 Oct 2026: every screen of the card game keeps the board's size): a
  // banner with the outcome, the two sides as the fight left them, the reckoning beside the spoils, the buttons docked.
  const FIND_KEYS = { MOD_VOY_ENC_RES_TRICK: 'fa-magic', MOD_VOY_ENC_RES_CARD: 'fa-gem' };
  const HARM_KEYS = { MOD_VOY_ENC_RES_BATTERED: 'fa-user-injured', MOD_VOY_ENC_RES_RUN_HULL: 'fa-ship', MOD_VOY_ENC_RES_RUN_CRATES: 'fa-box-open', MOD_VOY_ENC_RES_RUN_STORES: 'fa-utensils', MOD_VOY_ENC_RES_RUN_TIME: 'fa-hourglass-half', MOD_VOY_ENC_RES_OWED: 'fa-file-invoice-dollar', MOD_VOY_ENC_RES_USED: 'fa-flask' };
  const bannerIcon = (r) => (r.done === 'pay' ? 'fa-coins' : r.done === 'run' ? 'fa-running' : r.head?.key === 'MOD_VOY_ENC_RES_PRESS_WIN' ? 'fa-crown'
    : r.tone === 'good' ? 'fa-trophy' : r.tone === 'bad' ? 'fa-heart-broken' : r.head?.key === 'MOD_VOY_ENC_RES_DRAW' ? 'fa-hourglass-end' : 'fa-flag');
  /** A spoil as a tile: an item with its count and worth, a trophy with its picture and rule, a trick or a rare card. */
  const lootTile = (api, x) => {
    if (x.trophy !== undefined) {
      return `<div class="voyage-enc-tile voyage-enc-tile-trophy"><img class="voyage-enc-tile-img" src="${esc(ctx.getResourceUrl(api.D.trophyArt(x.trophy, api.E)))}" alt="">`
        + `<div><div class="voyage-enc-tile-name">${esc(t(api.E.charmKey(x.trophy)))}</div><div class="voyage-enc-tile-sub">${esc(t('MOD_VOY_ENC_TROPHY_TILE'))}</div>`
        + `<div class="voyage-enc-tile-text">${esc(t(api.E.charmTextKey(x.trophy)))}</div></div></div>`;
    }
    const it = itemOf(x.id);
    const sells = it?.sellsFor?.currency === game.gp ? it.sellsFor.quantity * x.qty : 0;
    const mark = x.kind === 'stash' ? `<span class="voyage-enc-tile-mark" title="${esc(t('MOD_VOY_ENC_STASH_TIP'))}">${fa('fa-box')}</span>` : x.kind === 'rare' ? `<span class="voyage-enc-tile-mark voyage-enc-rare">${fa('fa-star')}</span>` : '';
    return `<div class="voyage-enc-tile${x.kind === 'rare' ? ' voyage-enc-tile-rare' : ''}"><span class="voyage-enc-tile-pic">${it?.media ? `<img class="voyage-enc-tile-img" src="${esc(it.media)}" alt="">` : fa('fa-question')}`
      + `<span class="voyage-enc-tile-qty voyage-enc-num">${esc(api.text(x.qty))}</span></span>`
      + `<div><div class="voyage-enc-tile-name">${mark}${esc(it?.name ?? x.id)}</div>${sells ? `<div class="voyage-enc-tile-sub voyage-enc-num">${esc(t('MOD_VOY_ENC_SELLS', { gp: api.text(sells) }))}</div>` : ''}</div></div>`;
  };
  const findTile = (api, l) => `<div class="voyage-enc-tile voyage-enc-tile-find"><span class="voyage-enc-tile-pic voyage-enc-s-wits">${fa(FIND_KEYS[l.key])}</span><div class="voyage-enc-tile-text">${esc(resText(api, l))}</div></div>`;
  const resultHtml = (api, f, s) => {
    const { E } = api;
    const r = f.res;
    const ledger = [];
    const harm = [];
    const finds = [];
    for (const l of r.lines) {
      if (FIND_KEYS[l.key]) finds.push(findTile(api, l));
      else if (HARM_KEYS[l.key]) harm.push(`<div class="voyage-enc-row voyage-enc-harm"><span>${fa(HARM_KEYS[l.key])} ${esc(resText(api, l))}</span></div>`);
      else ledger.push(`<div class="voyage-enc-row"><span>${esc(resText(api, l))}</span>${l.gp === undefined ? '' : gpSign(api, l.gp)}</div>`);
    }
    if (!r.banked && r.purse > 0) ledger.push(`<div class="voyage-enc-row voyage-enc-waits"><span>${fa('fa-hand-holding-usd')} ${esc(t('MOD_VOY_ENC_RES_PURSE_WAITS'))}</span>${gpSign(api, r.purse)}</div>`);
    const tiles = r.loot.map((x) => lootTile(api, x)).concat(finds);
    const e = r.end;
    const bars = e !== undefined
      ? `<div class="voyage-enc-vs voyage-enc-vs-end">${sideHtml('you', 'fa-heart', 'voyage-enc-sea', t('MOD_VOY_ENC_YOUR_RESOLVE'), 'voyage-enc-resolve', e.you[0], e.you[1], '')}`
        + `<div class="voyage-enc-vs-mid" aria-hidden="true">${esc(t('MOD_VOY_ENC_VS'))}</div>`
        + `${sideHtml('them', 'fa-skull-crossbones', 'voyage-enc-hot', t(e.captain ? 'MOD_VOY_ENC_CAPTAIN_NERVE' : 'MOD_VOY_ENC_THEIR_NERVE'), 'voyage-enc-nerve', e.band[0], e.band[1], '')}</div>`
      : '';
    const reckoning = ledger.length + harm.length > 0
      ? `<section class="voyage-enc-panel"><h3 class="voyage-enc-panel-ttl">${fa('fa-balance-scale')}${esc(t('MOD_VOY_ENC_RES_RECKONING'))}</h3><div class="voyage-enc-lines">${ledger.join('')}${harm.join('')}</div></section>` : '';
    const spoils = tiles.length > 0
      ? `<section class="voyage-enc-panel"><h3 class="voyage-enc-panel-ttl">${fa('fa-gem')}${esc(t('MOD_VOY_ENC_RES_SPOILS'))}`
        + (r.loot.length > 0 ? `<small>${esc(t(r.banked ? 'MOD_VOY_ENC_LOOT_BANKED' : 'MOD_VOY_ENC_LOOT_PENDING'))}</small>` : '') + `</h3><div class="voyage-enc-tiles">${tiles.join('')}</div></section>` : '';
    let press = '';
    if (r.press && !r.banked && s !== undefined) {
      const cap = Math.max(1, Math.round(13 * s.S));
      press = `<section class="voyage-enc-panel voyage-enc-press"><h3 class="voyage-enc-panel-ttl">${fa('fa-crown')}${esc(t('MOD_VOY_ENC_PRESS_HEAD'))}</h3>`
        + `<div>${esc(t('MOD_VOY_ENC_PRESS_TEXT', { n: `${cap}` }))}</div>`
        + `<div class="voyage-enc-note">${esc(t('MOD_VOY_ENC_PRESS_KEEP', { n: `${s.you.resolve}`, hand: `${E.HAND}` }))}</div>`
        + `<div class="voyage-enc-mini">${s.hand.map((c) => `<span class="voyage-enc-s-${E.CARDS[c.id].suit ?? 'curse'}">${esc(t(E.cardKey(c.id)))}</span>`).join('') || `<span>${esc(t('MOD_VOY_ENC_HAND_EMPTY'))}</span>`}</div></section>`;
    }
    const patch = api.canPatch() ? btn('patch', t('MOD_VOY_ENC_BTN_PATCH', { food: `${api.R.PATCH_FOOD}` }), { cls: 'btn-success', icon: 'fa-utensils', title: t('MOD_VOY_ENC_PATCH_TIP') }) : '';
    const acts = r.press && !r.banked
      ? btn('press', t('MOD_VOY_ENC_BTN_PRESS'), { cls: 'btn-warning', icon: 'fa-crown' }) + btn('take', t('MOD_VOY_ENC_BTN_TAKE'), { cls: 'btn-primary', icon: 'fa-coins' })
      : btn('close', t('MOD_VOY_ENC_BTN_GO_ON'), { cls: 'btn-primary', icon: 'fa-route' }) + patch;
    return head(api, f) + '<div class="voyage-enc-body"><div class="voyage-enc-stage">'
      + `<div class="voyage-enc-banner voyage-enc-${r.tone}"><span class="voyage-enc-banner-ico">${fa(bannerIcon(r))}</span><div>`
      + `<div class="voyage-enc-banner-head">${esc(resText(api, r.head))}</div>`
      + (r.auto ? `<span class="voyage-enc-chip">${fa('fa-dice')}${esc(t('MOD_VOY_ENC_BTN_AUTO'))}</span>` : '') + '</div></div>'
      + bars
      + (reckoning || spoils ? `<div class="voyage-enc-panels${reckoning && spoils ? '' : ' voyage-enc-one'}">${reckoning}${spoils}</div>` : '')
      + press
      + '</div></div>'
      + `<div class="voyage-enc-dock"><div class="voyage-enc-dock-row">${acts}</div></div>`;
  };

  // ---- the popup ---------------------------------------------------------------------------------------------------
  /** Draws the open encounter into the popup (each press redraws it). */
  const render = (api) => {
    const el = root();
    if (el === null) return;
    const v = api.fight();
    if (v === undefined) { el.innerHTML = ''; return; }
    const { f, s } = v;
    if (f.stage !== 'fight') { api.ui.toss = false; }
    // The frame around the popup is the band's own (css: the voyage-enc-popup[data-band] rules).
    const pop = el.closest('.voyage-enc-popup');
    if (pop !== null) pop.dataset.band = f.opt.band;
    el.dataset.stage = f.stage;
    el.innerHTML = f.stage === 'meet' ? meetHtml(api, f) : f.stage === 'fight' ? fightHtml(api, f, s) : resultHtml(api, f, s);
    balanceHand(el);
  };
  // Spread a hand that needs more than one row evenly over its rows: 6 cards as 3 + 3, not 5 + 1.
  const balanceHand = (el) => {
    const h = el.querySelector('.voyage-enc-hand');
    if (h === null) return;
    h.style.maxWidth = '';
    const n = h.children.length;
    if (n < 2 || !h.clientWidth || window.matchMedia('(max-width: 560px)').matches) return;
    const cs = getComputedStyle(h);
    const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const gap = parseFloat(cs.columnGap) || 8;
    const cw = h.children[0].getBoundingClientRect().width;
    const fit = Math.max(1, Math.floor((h.clientWidth - pad + gap) / (cw + gap)));
    const per = Math.ceil(n / Math.ceil(n / fit));
    if (per < n) { h.style.maxWidth = `${per * cw + (per - 1) * gap + pad}px`; h.style.marginInline = 'auto'; }
  };
  const onClick = (api, e) => {
    const b = e.target.closest('[data-act]');
    if (b === null || b.disabled || b.getAttribute('aria-disabled') === 'true') return;
    const a = b.dataset.act;
    const i = Number(b.dataset.i);
    const ui = api.ui;
    try {
      if (a === 'fight') api.startFight();
      else if (a === 'pay') api.pay();
      else if (a === 'run') api.run();
      else if (a === 'auto') api.autoResolve();
      else if (a === 'play') api.act('p', i);
      else if (a === 'toss') { ui.toss = false; api.act('t', i); }
      else if (a === 'end') { ui.toss = false; api.act('e'); }
      else if (a === 'tossmode') { ui.toss = !ui.toss; render(api); }
      else if (a === 'hint') { ui.hint = !ui.hint; render(api); }
      // The trick book opens over the fight: a popup of its own would end this one.
      else if (a === 'tricks') state.deck?.openTrickBook?.(Swal.getPopup());
      else if (a === 'autoround') { ui.toss = false; api.autoRound(); }
      else if (a === 'press') api.pressOn();
      else if (a === 'take') api.take();
      else if (a === 'patch') api.patch();
      else if (a === 'close') api.close();
    } catch (err) { log('encounter press failed', err); }
  };
  /** Opens the popup on the open encounter; `onClosed` when it closes (by Go on, or by another popup). */
  const popup = ({ api, onClosed }) => {
    const cls = { container: 'voyage-enc-backdrop', popup: 'voyage-ui voyage-enc-popup', htmlContainer: 'voyage-enc-html' };
    SwalLocale.fire({
      html: `<div id="${ROOT}" class="voyage-enc"></div>`,
      width: POPUP_WIDTH,
      showConfirmButton: false,
      allowOutsideClick: false,
      allowEscapeKey: false,
      customClass: typeof createSwalCustomClass === 'function' ? createSwalCustomClass(cls) : cls,
      didRender: state.popupDidRender,
      didOpen: () => {
        const el = root();
        if (el === null) return;
        el.addEventListener('click', (e) => onClick(api, e));
        render(api);
      },
    }).then(() => { state.deck?.closeTrickBook?.(); onClosed(); }, () => { state.deck?.closeTrickBook?.(); onClosed(); });
  };
  const onResize = () => { const el = root(); if (el !== null) balanceHand(el); };
  window.addEventListener('resize', onResize);
  return { popup, render, cardFace, seqHtml, POPUP_WIDTH };
}
