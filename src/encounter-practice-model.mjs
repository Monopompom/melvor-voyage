// Practice fights: your real deck against a real band, with nothing at stake. The pick of band, what a real fight would
// have done to your GP, and the tips that walk a new player through a round. Pure: no game globals. The encounter models
// come in as `E` and `R` (game modules can't import each other).

export const TIERS = [1, 2, 3, 4];

/** A pick made safe: land or sea, a tier, and a band met there (the ground's first when the one asked for isn't). */
export function cleanPick(pick, E) {
  const where = pick?.where === 'sea' ? 'sea' : 'land';
  const tier = TIERS.includes(pick?.tier) ? pick.tier : 1;
  const bands = E.bandsOf(where);
  return { where, tier, band: bands.includes(pick?.band) ? pick.band : bands[0] };
}

/**
 * The fight's options: the kit you carry against the band picked, at the strength a real band of that ground and tier
 * has. Never Battered, and `learn` off: a trick fires here, but only a real fight writes it in your trick book.
 */
export const fightOpt = ({ kit, pick, strength, roll, seed, gp, toll, know = [] }) => ({
  ...kit, band: pick.band, tier: pick.tier, where: pick.where, seed, strength: strength * roll, gp, toll, battered: 0, know: [...know], learn: false,
});

/**
 * What the same ending would have done to your GP in a real fight: `{ net, toll, battered, atWin }`. `net` counts what
 * would be owed too. `atWin`: the win's settling, which Press on doubles or halves.
 */
export function reckon(s, { toll, purse, gp }, R, atWin) {
  if (s.over === 'presswin' || s.over === 'presslose') {
    const base = atWin ?? { now: 0, purse: 0 };
    const net = base.now + Math.round(base.purse * (s.over === 'presswin' ? 2 : 0.5));
    return { net, toll, battered: s.over === 'presslose', atWin: base };
  }
  const st = R.settle(s, { toll, purse, gp });
  return { net: st.now + st.purse - st.short, toll, battered: st.battered, atWin: { now: st.now, purse: st.purse } };
}

/** The result's heading for how the fight ended. */
export function headKey(s) {
  if (s.over === 'presswin') return 'MOD_VOY_ENC_RES_PRESS_WIN';
  if (s.over === 'presslose') return 'MOD_VOY_ENC_RES_PRESS_LOSE';
  if (s.over === 'win') return s.chaseFrom ? 'MOD_VOY_ENC_RES_WIN_CHASE' : 'MOD_VOY_ENC_RES_WIN';
  if (s.over === 'fled') return s.def?.keepGrabs === true ? 'MOD_VOY_ENC_RES_FLED_GRABS' : 'MOD_VOY_ENC_RES_FLED';
  if (s.over === 'draw') return 'MOD_VOY_ENC_RES_DRAW';
  return 'MOD_VOY_ENC_RES_LOSE';
}
/** The result banner's tone. */
export const toneOf = (over) => (over === 'win' || over === 'presswin' ? 'good' : over === 'lose' ? 'bad' : 'mid');

/** The result's lines: what a real fight would have done, what paying would have cost, and Battered if it would. */
export function resultLines(r) {
  return [
    { key: 'MOD_VOY_ENC_PRACTICE_REAL', vars: {}, gp: Math.round(r.net) },
    { key: 'MOD_VOY_ENC_PRACTICE_PAY_LINE', vars: {}, gp: -Math.round(r.toll) },
    ...(r.battered ? [{ key: 'MOD_VOY_ENC_PRACTICE_BATTERED', vars: {} }] : []),
    { key: 'MOD_VOY_ENC_PRACTICE_NOTHING', vars: {} },
  ];
}

const MOVE_TIP = {
  strike: 'MOD_VOY_ENC_PRACTICE_COACH_HIT', charge: 'MOD_VOY_ENC_PRACTICE_COACH_HIT', volley: 'MOD_VOY_ENC_PRACTICE_COACH_VOLLEY',
  board: 'MOD_VOY_ENC_PRACTICE_COACH_BOARD', grab: 'MOD_VOY_ENC_PRACTICE_COACH_GRAB', call: 'MOD_VOY_ENC_PRACTICE_COACH_CALL',
  brace: 'MOD_VOY_ENC_PRACTICE_COACH_BRACE', hex: 'MOD_VOY_ENC_PRACTICE_COACH_HEX', taunt: 'MOD_VOY_ENC_PRACTICE_COACH_TAUNT',
  flee: 'MOD_VOY_ENC_PRACTICE_COACH_CHASE',
};

/** Whether a card still in hand would add to a suit already played this round: the next step of a combo. */
function comboInHand(s, E) {
  return s.hand.some((c, i) => {
    const suit = E.CARDS[c.id]?.suit;
    return suit !== undefined && (s.suits[suit] ?? 0) > 0 && (s.suits[suit] ?? 0) < 3 && E.canPlay(s, i).ok;
  });
}

/** The tip for this moment of a fight, as a language key; undefined once it is over. */
export function coachOf(s, E) {
  if (s.over) return undefined;
  if (s.phase === 'chase') return 'MOD_VOY_ENC_PRACTICE_COACH_CHASE';
  if (s.phase === 'press') return 'MOD_VOY_ENC_PRACTICE_COACH_PRESS';
  if (!s.hand.some((_, i) => E.canPlay(s, i).ok)) return 'MOD_VOY_ENC_PRACTICE_COACH_END';
  if (E.seen(s) === null) return 'MOD_VOY_ENC_PRACTICE_COACH_HIDDEN';
  if (s.cardsThisRound === 0) return MOVE_TIP[s.intents[0]?.kind] ?? 'MOD_VOY_ENC_PRACTICE_COACH_PLAY';
  if (s.plays < 1) return 'MOD_VOY_ENC_PRACTICE_COACH_END';
  return comboInHand(s, E) ? 'MOD_VOY_ENC_PRACTICE_COACH_COMBO' : 'MOD_VOY_ENC_PRACTICE_COACH_PLAY';
}
