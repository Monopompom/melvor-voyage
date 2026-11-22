// Practice fights: the encounter board played with your real deck against a band you pick. It lives in memory only and
// never touches the save's open encounter, your GP, the bank, your trick book or Battered. Opened from the Deck block,
// the Journal, or the board of the first band you ever meet (it comes back to that band when you leave).

const TIPS_KEY = 'voyage-practice-tips';

export function install(ctx, { state, F, M, log }) {
  const real = () => state.encounters;
  const t = (key, vars) => (vars === undefined ? getLangString(key) : templateLangString(key, vars));
  const readTips = () => { try { return localStorage.getItem(TIPS_KEY) !== 'off'; } catch { return true; } };
  const writeTips = (on) => { try { localStorage.setItem(TIPS_KEY, on ? 'on' : 'off'); } catch { /* kept for this session */ } };
  let tips = readTips();
  let pick;
  let cur; // { f, s }
  let from; // 'alone' (its own popup) or 'meet' (inside a real band's)
  const ui = { hint: false, toss: false };

  const setup = () => {
    const { E } = real();
    pick = M.cleanPick(pick, E);
    const c = real().practiceCost(pick);
    cur = { f: { practice: true, stage: 'setup', opt: { ...pick, battered: 0 }, purse: c.purse, actions: [], rule: 'gp', debt: 0 }, s: undefined };
    ui.hint = false;
    ui.toss = false;
  };
  const draw = () => { try { F.render(papi); } catch (e) { log('practice: render failed', e); } };
  const reset = () => { cur = undefined; from = undefined; };

  const start = () => {
    const { E } = real();
    const o = M.fightOpt({ pick, ...real().practiceKit(pick), ...real().practiceCost(pick) });
    cur = { f: { ...cur.f, stage: 'fight', opt: o, res: undefined, atWin: undefined }, s: E.newFight(o) };
    ui.hint = false;
    ui.toss = false;
    draw();
  };
  const finish = () => {
    const { R } = real();
    const { f, s } = cur;
    const r = M.reckon(s, { toll: f.opt.toll, purse: f.purse, gp: f.opt.gp }, R, f.atWin);
    if (s.over === 'win') f.atWin = r.atWin;
    const canPress = s.over === 'win';
    f.res = {
      head: { key: M.headKey(s), vars: {} }, tone: M.toneOf(s.over), lines: M.resultLines(r), purse: 0, loot: [],
      press: canPress, banked: !canPress, auto: false, done: 'fight', owed: 0,
      end: { you: [Math.max(0, s.you.resolve), s.you.max], band: [Math.max(0, s.band.nerve), s.band.max], captain: s.phase === 'press' },
    };
    f.stage = 'result';
  };
  const act = (a, i) => {
    const { E } = real();
    const s = cur?.s;
    if (s === undefined || cur.f.stage !== 'fight' || s.over) return;
    if (a === 'p') { if (!E.canPlay(s, i).ok) return; E.play(s, i); }
    else if (a === 't') { if (s.tossed || E.CARDS[s.hand[i]?.id]?.dead) return; E.toss(s, i); }
    else if (a === 'e') E.endRound(s);
    if (s.over) finish();
    draw();
  };
  const autoRound = () => {
    const { E } = real();
    const s = cur?.s;
    if (s === undefined || cur.f.stage !== 'fight' || s.over) return;
    E.aiRound(s, () => {});
    if (!s.over) E.endRound(s);
    if (s.over) finish();
    draw();
  };
  const pressOn = () => {
    const { E } = real();
    if (cur?.f.res?.press !== true) return;
    E.pressOn(cur.s);
    cur.f.stage = 'fight';
    cur.f.res.press = false;
    draw();
  };
  const take = () => {
    if (cur?.f.res === undefined) return;
    cur.f.res.press = false;
    cur.f.res.banked = true;
    draw();
  };
  const leave = () => {
    const back = from;
    reset();
    if (back === 'meet') F.show(real());
    else { try { Swal.close(); } catch {} }
  };

  const practiceAct = (a, v) => {
    if (cur === undefined) return;
    const { E } = real();
    if (a === 'pr-where') { pick = M.cleanPick({ ...pick, where: v }, E); setup(); draw(); }
    else if (a === 'pr-tier') { pick = M.cleanPick({ ...pick, tier: Number(v) }, E); setup(); draw(); }
    else if (a === 'pr-band') { pick = M.cleanPick({ ...pick, band: v }, E); setup(); draw(); }
    else if (a === 'pr-tips') { tips = !tips; writeTips(tips); draw(); }
    else if (a === 'pr-start' || a === 'pr-again') start();
    else if (a === 'pr-change') { setup(); draw(); }
    else if (a === 'pr-leave') leave();
  };

  // The board reads this as it reads the real encounter; what isn't here is the real one's (texts, models, your kit).
  let papi;
  const board = () => {
    papi = {
      ...real(), practice: true, ui, fight: () => cur, act, autoRound, pressOn, take, practiceAct, reset,
      startFight: () => {}, pay: () => {}, run: () => {}, autoResolve: () => {}, close: leave, patch: () => false, canPatch: () => false,
      pick: () => pick, cost: () => real().practiceCost(pick), tipsOn: () => tips, coach: (s) => M.coachOf(s, real().E),
      leaveKey: () => (from === 'meet' ? 'MOD_VOY_ENC_PRACTICE_BACK' : 'MOD_VOY_ENC_PRACTICE_LEAVE'),
    };
    return papi;
  };

  /** Opens a practice fight in its own popup; a band already waiting is answered first. */
  const open = () => {
    if (real()?.enc?.() === undefined) return;
    if (real().fightOpen()) { real().open(); return; }
    from = 'alone';
    setup();
    F.popup({ api: board(), onClosed: reset });
  };
  /** From the board of the first band you meet: the same popup, back to that band on leaving. */
  const fromMeet = () => {
    if (real()?.enc?.() === undefined) return;
    from = 'meet';
    setup();
    F.show(board());
  };
  /** A real band arrived while a practice fight had the screen: it gives way. */
  const closeForBand = () => {
    if (cur === undefined || from !== 'alone') return;
    reset();
    try { Swal.close(); } catch {}
    try { real().notify(t('MOD_VOY_ENC_PRACTICE_ENDED')); } catch {}
  };
  return { open, fromMeet, closeForBand };
}
