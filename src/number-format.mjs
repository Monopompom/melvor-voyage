// A big amount in a short form: GP, XP and bank counts read at a glance ("2.5M" beside "You have 12.3M"), the exact
// figure kept only where it matters (the user, 29 Oct 2026). Pure: the game's own formatters are used when they are
// there, so the thousands and decimal marks follow the player's number setting; plain output where they are not.

const UNITS = [
  { size: 1e12, fallback: 'T' },
  { size: 1e9, fallback: 'B' },
  { size: 1e6, fallback: 'M' },
  { size: 1e3, fallback: 'K' },
];

const whole = (n) => (typeof numberWithCommas === 'function' ? numberWithCommas(n) : `${n}`);
const tenth = (n) => (typeof formatFixed === 'function' ? formatFixed(n, 1) : n.toFixed(1));

/** The game's own letter for a unit (its short form of ten of them, digits stripped), so a translation carries over. */
function suffix(unit) {
  if (typeof formatNumber !== 'function') return unit.fallback;
  const s = String(formatNumber(unit.size * 10)).replace(/^[-\d\s.,  ']+/, '');
  return s === '' ? unit.fallback : s;
}

/**
 * "9,999" as it is, then "12.3K", "125K", "2.5M", "100M": rounded down, one decimal under 100 of a unit, no ".0".
 * The game's formatNumber drops the decimal ("2M" for 2,500,000), which misstates a price by a quarter.
 */
export function shortNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return `${value}`;
  const sign = n < 0 ? '-' : '';
  const abs = Math.floor(Math.abs(n));
  if (abs < 10000) return sign + whole(abs);
  const unit = UNITS.find((u) => abs >= u.size);
  const v = abs / unit.size;
  if (v >= 100) return `${sign}${whole(Math.floor(v))}${suffix(unit)}`;
  const t = Math.floor(v * 10) / 10;
  return `${sign}${Number.isInteger(t) ? whole(t) : tenth(t)}${suffix(unit)}`;
}

/**
 * A fraction with at most `digits` decimals and no trailing zeros, in the player's decimal mark: "0.5", "1.25", "2"
 * (a share in a rule, a weather multiplier).
 */
export function decimal(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return `${value}`;
  const scale = 10 ** digits;
  const r = Math.round(n * scale) / scale;
  if (Number.isInteger(r)) return whole(r);
  let d = 1;
  while (d < digits && Math.abs(Math.round(r * 10 ** d) - r * 10 ** d) > 1e-9) d += 1;
  return typeof formatFixed === 'function' ? formatFixed(r, d) : r.toFixed(d);
}
