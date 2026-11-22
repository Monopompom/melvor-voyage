import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GROUPS, fold, matches, byDistance, placeGroups } from '../src/places-model.mjs';

test('the search matches the start of each word, without case or accents', () => {
  assert.equal(fold('Frost-Drift  Port'), 'frost drift port');
  assert.equal(matches('Frost Drift Port', 'fro dri'), true);
  assert.equal(matches('Frost Drift Port', 'port'), true);
  assert.equal(matches('Frost Drift Port', 'rift'), false, 'a word is matched from its start');
  assert.equal(matches('Café Port', 'cafe'), true);
  assert.equal(matches('Anything', ''), true);
  assert.equal(matches('Anything', '   '), true);
});

test('the search reads German and Chinese names', () => {
  assert.equal(fold('Große Brücke'), 'grosse brucke');
  assert.equal(matches('Große Brücke', 'gross bru'), true);
  assert.equal(matches('Große Brücke', 'rücke'), false, 'a German word is still matched from its start');
  assert.equal(matches('霜流港', '流港'), true, 'Chinese has no spaces: anywhere in the name');
  assert.equal(matches('霜流港', '雾'), false);
  assert.equal(matches('霜流港', '   '), true);
});

test('rows go nearest first, an unknown distance last, then by name', () => {
  const rows = [{ name: 'B', distance: 4 }, { name: 'C' }, { name: 'A', distance: 4 }, { name: 'D', distance: 1 }];
  assert.deepEqual(byDistance(rows).map((r) => r.name), ['D', 'A', 'B', 'C']);
  assert.equal(rows[0].name, 'B', 'the rows given are not changed');
});

test('the groups keep their order, sort camps and ports, keep home and recent as given and drop empty ones', () => {
  const rows = {
    recent: [{ name: 'Old Village' }, { name: 'Beginning Port' }],
    ports: [{ name: 'Snow Covered Pier', distance: 9 }, { name: 'Beginning Port', distance: 2 }],
    camps: [],
    home: [{ name: 'Beginning Port' }],
  };
  const all = placeGroups(rows);
  assert.deepEqual(all.map((g) => g.id), ['home', 'ports', 'recent']);
  assert.deepEqual(all[1].rows.map((r) => r.name), ['Beginning Port', 'Snow Covered Pier']);
  assert.deepEqual(all[2].rows.map((r) => r.name), ['Old Village', 'Beginning Port']);
  const snow = placeGroups(rows, 'snow');
  assert.deepEqual(snow.map((g) => g.id), ['ports']);
  assert.deepEqual(placeGroups(rows, 'nowhere'), []);
  assert.deepEqual(placeGroups(undefined), []);
  assert.deepEqual(GROUPS, ['home', 'camps', 'ports', 'recent']);
});
