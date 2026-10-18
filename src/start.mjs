// Random start (phase 4): on a character's first load, before the welcome, "Where do you start?":
// A New Start (the game's own start) or Random start, chosen once and kept in the save (`record.start`, v14). Random
// start puts the player on a land hex they can live and grow from (start-model.mjs), surveys that hex the way the game
// surveys its own start, and moves them there. Everything else is the game's own map.
//
// Asked only of a character still on the game's start hex with no Voyage travel yet; any other character is marked
// 'game' quietly (they have long since started).

const GATHER_SKILLS = ['melvorD:Woodcutting', 'melvorD:Fishing', 'melvorD:Mining'];

export function install(ctx, { state, SM, M, rules, shipModel, hexes, log }) {
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const skill = () => state.voyageSkill?.();
  const usable = () => { const s = skill(); return s !== undefined && s.futureRaw === undefined; };
  const map = () => { try { return game.cartography?.activeMap; } catch { return undefined; } };

  const tierOf = (() => {
    const byLandmass = new Map();
    return (rec) => {
      if (state.terrain === undefined) return 1;
      if (byLandmass.size === 0) {
        for (const island of shipModel.ISLANDS) {
          const a = state.terrain.poi(island.anchor);
          if (a !== undefined) byLandmass.set(state.terrain.landmass(a.q, a.r), island.tier);
        }
      }
      return byLandmass.get(state.terrain.landmass(rec.q, rec.r)) ?? 1;
    };
  })();
  /** Something to gather on the hex or next to it, under the Strict rules. */
  const gathers = (rec) => {
    const opts = { ...state.ruleOpts(), strictness: 'strict' };
    const around = [rec, ...state.terrain.neighbours(rec.q, rec.r)].filter((x) => x !== undefined && x.cloud !== true);
    return GATHER_SKILLS.some((id) => around.some((x) => rules.allowedAt(id, x, opts)));
  };
  const pick = () => {
    const m = map();
    const start = m?.startingLocation;
    const list = SM.startCandidates(hexes, { start: start === undefined ? undefined : { q: start.q, r: start.r }, tier: tierOf, gathers, trades: rules.isTradePlace });
    const seed = (() => { try { return game.characterName ?? 'captain'; } catch { return 'captain'; } })();
    return SM.pickStart(list, M.rng(M.hash(`${seed}|start|${Date.now()}`)));
  };

  /** Moves the player to `h` ({ q, r }) and surveys it, as the game does with its own start. */
  const place = (h) => {
    const m = map();
    const hex = m?.getHex(new HexCoords(h.q, h.r));
    if (hex === undefined) return false;
    const cart = game.cartography;
    if (!hex.isFullySurveyed) {
      hex.addSurveyXP(Hex.getXPFromLevel(hex.maxSurveyLevel) - hex.surveyXP);
      cart.renderQueue.hexBackground.add(hex);
      cart.onHexFullSurvey(hex);
    }
    m.setPlayerPosition(hex);
    cart.computeProvidedStats(true);
    cart.renderQueue.visionRange = true;
    cart.renderQueue.playerMarker = true;
    cart.renderQueue.hexPath = true;
    try { state.knowledge?.bump(); } catch {}
    // On an island: the boat that brought you is yours (ship.mjs), or the island may have no way off.
    try { state.ship?.startOverseas?.(); } catch (e) { log('random start boat failed', e); }
    state.onSettingsChange();
    return true;
  };

  /** True when this character may still choose: on the game's start, never travelled. */
  const mayChoose = (rec) => {
    const m = map();
    const pos = m?.playerPosition;
    return rec.landHexes + rec.waterHexes === 0 && pos !== undefined && pos === m.startingLocation;
  };

  const popupHtml = () => {
    const opt = (id, on, name, text, warn) => `<button type="button" class="voyage-start-opt${on ? ' on' : ''}" role="radio" aria-checked="${on}" data-start="${id}">` +
      `<span class="voyage-start-dot" aria-hidden="true"></span><span><span class="voyage-start-name">${esc(name)}</span>` +
      (warn ? `<span class="voyage-start-warn text-warning">${esc(warn)}</span>` : '') + `<span class="voyage-start-text">${esc(text)}</span></span></button>`;
    return `<div class="voyage-start text-left"><p class="voyage-help-p text-center">${esc(t('MOD_VOY_START_INTRO'))}</p>` +
      `<div class="voyage-start-opts" role="radiogroup" aria-label="${esc(t('MOD_VOY_START_TITLE'))}">` +
      opt('game', true, t('MOD_VOY_START_GAME'), t('MOD_VOY_START_GAME_TEXT')) +
      opt('random', false, t('MOD_VOY_START_RANDOM'), t('MOD_VOY_START_RANDOM_TEXT'), t('MOD_VOY_START_RANDOM_WARN')) +
      `</div><p class="voyage-help-p text-center text-warning voyage-start-once">${esc(t('MOD_VOY_START_ONCE'))}</p></div>`;
  };

  /**
   * Runs before the welcome (compass.mjs): asks once, then calls `next`. A character that may not choose any more is
   * marked 'game' and goes straight on.
   */
  const ask = (next) => {
    const go = () => { try { next(); } catch (e) { console.error('[Voyage] after the start choice', e); } };
    if (!usable()) { go(); return; }
    const rec = skill().record;
    if (rec.start !== '') { go(); return; }
    if (!mayChoose(rec)) { rec.start = 'game'; go(); return; }
    let choice = 'game';
    try {
      SwalLocale.fire({
        didRender: state.popupDidRender,
        title: esc(t('MOD_VOY_START_TITLE')),
        html: popupHtml(),
        width: '36rem',
        allowOutsideClick: false,
        allowEscapeKey: false,
        confirmButtonText: t('MOD_VOY_START_GO'),
        customClass: (() => { const c = { popup: 'voyage-ui', confirmButton: 'btn btn-success m-1 voyage-start-go' }; return typeof createSwalCustomClass === 'function' ? createSwalCustomClass(c) : c; })(),
        didOpen: (popup) => {
          popup.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => {
            choice = b.dataset.start;
            popup.querySelectorAll('[data-start]').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', `${on}`); });
          }));
        },
      }).then(() => {
        let done = 'game';
        if (choice === 'random') {
          const h = pick();
          if (h !== undefined && place(h)) { done = 'random'; log(`random start at ${h.q},${h.r}`); } else log('random start: no hex found, the game\'s start kept');
        }
        rec.start = done;
        state.onSettingsChange();
        setTimeout(go, 300);
      });
    } catch (e) { log('start choice failed', e); rec.start = 'game'; go(); }
  };
  state.startChoice = ask;
  return { ask, pick, place };
}
