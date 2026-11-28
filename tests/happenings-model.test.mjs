import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../src/happenings-model.mjs';
import { SEASONS } from '../src/weather-model.mjs';

const HOUR = 60 * 60 * 1000;
const markets = [
  { id: 'harbour', depth: 24000, cheap: ['fish'] },
  { id: 'city', depth: 48000, cheap: [] },
  { id: 'farm', depth: 24000, cheap: ['crops'] },
  { id: 'capital', depth: 96000, cheap: [] },
];
const items = [
  { id: 'melvorD:Raw_Shrimp', kind: 'fish' },
  { id: 'melvorD:Oak_Logs', kind: 'logs' },
  { id: 'melvorD:Potato', kind: 'crops' },
  { id: 'melvorD:Topaz', kind: 'gems' },
  { id: 'melvorD:Iron_Bar', kind: 'bars' },
];
const seas = [
  { id: 'shallows', tier: 1, weight: 40 },
  { id: 'reach', tier: 2, weight: 10 },
  { id: 'deep', tier: 4, weight: 99 },
  { id: 'unsailed', tier: 1, weight: 0 },
];
const ctx = { seed: 'test-character', markets, items, seas, bands: ['pirates', 'smugglers'] };

test('a slot rolls the same happening for the same seed, and another seed differs somewhere', () => {
  for (let slot = 0; slot < 40; slot++) assert.deepEqual(H.rollSlot(slot, ctx), H.rollSlot(slot, ctx));
  const a = Array.from({ length: 40 }, (_, s) => JSON.stringify(H.rollSlot(s, ctx)));
  const b = Array.from({ length: 40 }, (_, s) => JSON.stringify(H.rollSlot(s, { ...ctx, seed: 'someone-else' })));
  assert.notDeepEqual(a, b);
});

test('a rolled shortage asks for goods you have owned that the market does not pay little for', () => {
  let shortages = 0;
  let blockades = 0;
  let none = 0;
  for (let slot = 0; slot < 400; slot++) {
    const h = H.rollSlot(slot, ctx);
    if (h === undefined) { none++; continue; }
    assert.equal(h.start, slot * H.SLOT_MS);
    assert.equal(h.id, `${slot}:${h.kind}`);
    if (h.kind === 'shortage') {
      shortages++;
      const m = markets.find((x) => x.id === h.market);
      const it = items.find((x) => x.id === h.item);
      assert.ok(m && it);
      assert.ok(!m.cheap.includes(it.kind), `${h.market} never wants its own cheap ${it.kind}`);
      assert.equal(h.want, m.depth * H.SHORTAGE_WANT);
      assert.equal(h.end - h.start, H.SHORTAGE_MS);
      assert.equal(h.sold, 0);
    } else {
      blockades++;
      assert.ok(['shallows', 'reach'].includes(h.sea), 'only tier 1-3 seas you have sailed');
      assert.equal(h.tier, seas.find((s) => s.id === h.sea).tier);
      assert.ok(ctx.bands.includes(h.band));
      assert.equal(h.end - h.start, H.BLOCKADE_MS);
      assert.equal(h.wins, 0);
    }
  }
  assert.ok(none > 50 && none < 160, `about a quarter of slots roll nothing (${none})`);
  assert.ok(shortages > blockades * 2, `shortages come about three times as often (${shortages} vs ${blockades})`);
});

test('nothing to want or nowhere sailed rolls nothing of that kind', () => {
  for (let slot = 0; slot < 100; slot++) {
    const h = H.rollSlot(slot, { ...ctx, items: [], seas: [] });
    assert.equal(h, undefined);
    const s = H.rollSlot(slot, { ...ctx, seas: [{ id: 'deep', tier: 4, weight: 9 }] });
    assert.ok(s === undefined || s.kind === 'shortage', 'a tier-4 sea is never blockaded');
  }
  assert.equal(H.rollSlot(3, undefined), H.rollSlot(3, {}), 'no game side: nothing, no throw');
});

test('the limits hold: three shortages at once, never two in one market or of one item, one blockade', () => {
  let st = { at: -1, live: [], told: {} };
  const start = 1000 * H.SLOT_MS;
  st = H.advance(st, start, ctx);
  for (let i = 1; i <= 30; i++) {
    st = H.advance(st, start + i * H.SLOT_MS, ctx);
    const live = H.liveAt(st, start + i * H.SLOT_MS);
    const sh = live.filter((h) => h.kind === 'shortage');
    const bl = live.filter((h) => h.kind === 'blockade');
    assert.ok(sh.length <= H.MAX_SHORTAGES, `slot ${i}: ${sh.length} shortages`);
    assert.ok(bl.length <= H.MAX_BLOCKADES);
    assert.equal(new Set(sh.map((h) => h.market)).size, sh.length);
    assert.equal(new Set(sh.map((h) => h.item)).size, sh.length);
  }
});

test('a first read rolls only the current slot, and a read in the same slot rolls nothing new', () => {
  const now = 500 * H.SLOT_MS + 3 * HOUR;
  const st = H.advance(undefined, now, ctx);
  assert.equal(st.at, 500);
  assert.ok(st.live.every((h) => h.slot === 500));
  assert.deepEqual(H.advance(st, now + HOUR, ctx), st);
});

test('a long time away rolls only the slots whose happening could still be live, and drops what ended', () => {
  const st = H.advance(undefined, 10 * H.SLOT_MS, ctx);
  const later = 10 * H.SLOT_MS + 30 * 24 * HOUR;
  const back = H.advance(st, later, ctx);
  assert.equal(back.at, H.slotOf(later));
  assert.ok(back.live.every((h) => h.end > later), 'nothing ended is kept');
  assert.ok(back.live.every((h) => h.slot > H.slotOf(later) - H.ROLL_BACK));
  assert.ok(back.live.length <= H.LIVE_MAX);
  assert.equal(H.ROLL_BACK, 6);
});

test('a shortage takes sales up to what it wants, then is filled', () => {
  const h = { id: '7:shortage', kind: 'shortage', slot: 7, start: 7 * H.SLOT_MS, end: 7 * H.SLOT_MS + H.SHORTAGE_MS, market: 'city', item: 'melvorD:Oak_Logs', want: 10000, sold: 0 };
  const now = h.start + HOUR;
  let st = { at: 7, live: [h], told: {} };
  assert.equal(H.shortageOf(st, 'city', 'melvorD:Oak_Logs', now).id, h.id);
  assert.equal(H.shortageOf(st, 'harbour', 'melvorD:Oak_Logs', now), undefined);
  assert.equal(H.shortageOf(st, 'city', 'melvorD:Oak_Logs', h.start - 1), undefined, 'not before it starts');
  let r = H.fill(st, h.id, 6000, now);
  assert.deepEqual([r.into, r.over, r.filled], [6000, 0, false]);
  st = r.state;
  assert.equal(H.wantLeft(st.live[0]), 4000);
  assert.equal(H.shortageMix(st.live[0], 2000, 100), H.SHORTAGE_PCT);
  assert.equal(H.shortageMix(st.live[0], 8000, 100), (4000 * 250 + 4000 * 100) / 8000, 'the part over it sells as usual');
  r = H.fill(st, h.id, 8000, now);
  assert.deepEqual([r.into, r.over, r.filled], [4000, 4000, true]);
  st = r.state;
  assert.equal(st.live[0].done, 'filled');
  assert.equal(H.shortageOf(st, 'city', 'melvorD:Oak_Logs', now), undefined, 'a filled shortage is over');
  r = H.fill(st, h.id, 500, now);
  assert.deepEqual([r.into, r.over, r.filled], [0, 500, false]);
  assert.equal(H.fill(st, h.id, 500, h.end).into, 0, 'an ended one takes nothing');
});

test('three wins on a blockaded sea lift it, and the bounty is ten purses', () => {
  const h = { id: '9:blockade', kind: 'blockade', slot: 9, start: 9 * H.SLOT_MS, end: 9 * H.SLOT_MS + H.BLOCKADE_MS, sea: 'shallows', tier: 1, band: 'pirates', wins: 0 };
  const now = h.start + HOUR;
  let st = { at: 9, live: [h], told: {} };
  assert.equal(H.blockadeOf(st, 'shallows', now).id, h.id);
  assert.equal(H.win(st, 'reach', now).blockade, undefined, 'a win elsewhere counts nothing');
  for (let i = 1; i <= 3; i++) {
    const r = H.win(st, 'shallows', now);
    st = r.state;
    assert.equal(r.lifted, i === 3);
    assert.equal(r.blockade.wins, i);
  }
  assert.equal(H.blockadeOf(st, 'shallows', now), undefined);
  assert.equal(H.win(st, 'shallows', now).lifted, false, 'a lifted blockade is not lifted twice');
  assert.equal(H.bountyOf(2000), 20000);
  assert.equal(H.bountyOf(undefined), 0);
});

test('festivals: one city market a season, its first day, none in the odd seasons', () => {
  const cities = ['city', 'capital'];
  const start = 1000 * HOUR;
  for (const key of SEASONS) {
    const f = H.festivalFor({ key, start }, 'seed', cities);
    if (['spring', 'summer', 'fall', 'winter'].includes(key)) {
      assert.ok(f, key);
      assert.ok(cities.includes(f.market));
      assert.equal(f.end - f.start, H.FESTIVAL_MS);
      assert.deepEqual(H.festivalFor({ key, start }, 'seed', cities), f, 'the same season, the same market');
    } else {
      assert.equal(f, undefined, `${key} holds none`);
    }
  }
  assert.equal(H.festivalFor({ key: 'spring', start }, 'seed', []), undefined, 'no city, no festival');
  assert.equal(H.festivalFor(undefined, 'seed', cities), undefined);
  const winter = H.festivalFor({ key: 'winter', start }, 'seed', cities);
  assert.ok(H.festivalWants(winter, 'gems', true));
  assert.ok(!H.festivalWants(winter, 'gems', false), 'uncut gems are not wanted');
  assert.ok(H.festivalWants(winter, 'logs', false));
  assert.ok(!H.festivalWants(winter, 'fish', true));
  const summer = H.festivalFor({ key: 'summer', start }, 'seed', cities);
  assert.ok(H.festivalWants(summer, 'fish', true) && H.festivalWants(summer, 'fish', false));
  const own = H.ownSeason(5 * H.OWN_SEASON_MS + HOUR);
  assert.deepEqual(own, { key: 'summer', start: 5 * H.OWN_SEASON_MS });
});

test('news reaches a port half an hour of game time a hex away; a festival is cried at once', () => {
  const h = { kind: 'shortage', start: 100 * HOUR };
  assert.equal(H.newsAt(h, 0), h.start);
  assert.equal(H.newsAt(h, 6), h.start + 3 * HOUR);
  assert.ok(!H.heard(h, 6, h.start + 2 * HOUR));
  assert.ok(H.heard(h, 6, h.start + 3 * HOUR));
  assert.equal(H.newsAt({ kind: 'festival', start: 5 }, 40), 5);
});

test('clean keeps what is sound and drops junk', () => {
  const good = { id: '7:shortage', kind: 'shortage', slot: 7, start: 1, end: 2, market: 'city', item: 'melvorD:Oak_Logs', want: 10, sold: 50, done: 'filled' };
  const bl = { id: '8:blockade', kind: 'blockade', slot: 8, start: 3, end: 4, sea: 'shallows', tier: 2, band: 'pirates', wins: 9 };
  const c = H.cleanHappen({ at: 8, live: [good, good, bl, { id: '9:shortage', kind: 'shortage', slot: 3, start: 1, end: 2, market: 'x', item: 'y' }, { id: 'x' }, null, { ...bl, id: '10:blockade', slot: 10, tier: 4 }, { ...good, id: '11:shortage', slot: 11, market: '<b>' }], told: { a: true, b: 'yes' }, extra: 1 });
  assert.equal(c.at, 8);
  assert.deepEqual(c.live.map((h) => h.id), ['8:blockade', '7:shortage']);
  assert.equal(c.live[1].sold, 10, 'sold never passes want');
  assert.equal(c.live[0].wins, H.BLOCKADE_WINS);
  assert.deepEqual(c.told, { a: true });
  assert.equal(c.extra, undefined);
  assert.deepEqual(H.cleanHappen(undefined), { at: -1, live: [], told: {} });
  assert.deepEqual(H.cleanHappen([1, 2]), { at: -1, live: [], told: {} });
  assert.deepEqual(H.cleanHappen({ at: -5, live: 'x' }), { at: -1, live: [], told: {} });
});

test('a kind with nothing to pick never takes the slot: no seas sailed, every rolled slot is a shortage', () => {
  const noSeas = { ...ctx, seas: [] };
  let rolled = 0;
  for (let slot = 0; slot < 400; slot++) {
    const h = H.rollSlot(slot, noSeas);
    if (h === undefined) continue;
    rolled++;
    assert.equal(h.kind, 'shortage');
  }
  assert.ok(rolled > 240, `three slots in four still roll (${rolled})`);
  const full = [0, 1, 2].map((i) => ({ id: `${i}:shortage`, kind: 'shortage', market: markets[i].id, item: items[i].id, start: 0, end: 1e15 }));
  for (let slot = 0; slot < 50; slot++) assert.notEqual(H.rollSlot(slot, { ...ctx, live: full })?.kind, 'shortage', 'three shortages: none more');
});

test('the season festivals follow is kept while it lasts, and its start told from the hours left', () => {
  const now = 1000 * HOUR;
  const first = H.seasonFrom(undefined, 'spring', 60 * HOUR, now);
  assert.deepEqual(first, { key: 'spring', start: now - 12 * HOUR });
  assert.equal(H.seasonFrom(first, 'spring', 59 * HOUR, now + HOUR + 1234), first, 'the same season keeps its start');
  assert.deepEqual(H.seasonFrom(first, 'summer', 72 * HOUR, now + 60 * HOUR), { key: 'summer', start: now + 60 * HOUR });
  assert.deepEqual(H.seasonFrom(first, 'spring', 72 * HOUR, now + 8 * 72 * HOUR), { key: 'spring', start: now + 8 * 72 * HOUR }, 'a spring a year on is a new one');
  assert.deepEqual(H.seasonFrom(undefined, 'winter', undefined, now), { key: 'winter', start: now });
  assert.deepEqual(H.cleanHappen({ season: first }).season, first);
  assert.equal(H.cleanHappen({ season: { key: 'monsoon', start: 5 } }).season, undefined);
});
