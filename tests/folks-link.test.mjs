import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folksApi, folkDoing, FOLKS_API_MIN, COURIER_JOB } from '../src/folks-link.mjs';
import { COURIER_JOB as MODEL_COURIER_JOB } from '../src/courier-model.mjs';

test('Worker Folks API: used only when present and new enough; an older one is named once (build .314)', () => {
  const warnings = [];
  const warn = (m) => warnings.push(m);
  const api = { version: FOLKS_API_MIN, registerGuard() {} };
  assert.equal(folksApi({ mods: { api: { worker_folks: api } }, warn }), api);
  assert.equal(folksApi({ mods: { api: {} }, warn }), undefined);
  assert.equal(folksApi({ mods: undefined, warn }), undefined);
  assert.equal(warnings.length, 0, 'no Worker Folks is not a warning');
  assert.equal(folksApi({ mods: { api: { worker_folks: { version: 1, registerGuard() {} } } }, warn }), undefined);
  assert.equal(folksApi({ mods: { api: { worker_folks: { registerGuard() {} } } }, warn }), undefined);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], new RegExp(`older than ${FOLKS_API_MIN}`));
});

test('what a Folk is doing: a courier or a walker is on the road, never Idle (build .721)', () => {
  const had = { getLangString: globalThis.getLangString, game: globalThis.game };
  globalThis.getLangString = (key) => key;
  globalThis.game = { skills: { getObjectByID: (id) => (id === 'melvorD:Mining' ? { name: 'Mining' } : undefined) } };
  try {
    assert.equal(folkDoing({ job: 'voyage:Courier', status: 'idle', travel: 'walking' }), 'MOD_VOY_COURIER_JOB');
    assert.equal(folkDoing({ job: 'voyage:Courier', status: 'idle', travel: 'idle' }), 'MOD_VOY_COURIER_JOB', 'held by a band or resting at a stop');
    assert.equal(folkDoing({ status: 'idle', travel: 'walking' }), 'MOD_VOY_WALK_HEAD');
    assert.equal(folkDoing({ status: 'idle', travel: 'idle' }), 'MOD_VOY_PANEL_FOLK_IDLE');
    assert.equal(folkDoing({ status: 'strike', travel: 'idle', skillId: 'melvorD:Mining' }), 'MOD_VOY_PANEL_FOLK_STRIKE');
    assert.equal(folkDoing({ status: 'working', travel: 'idle', skillId: 'melvorD:Mining' }), 'Mining');
  } finally {
    globalThis.getLangString = had.getLangString;
    globalThis.game = had.game;
  }
});

test('the Courier job id here is the courier model\'s (build .723)', () => {
  assert.equal(COURIER_JOB, MODEL_COURIER_JOB);
});

test('runtime modules have no static relative imports: the game skips a mod whose module has one (build .723)', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../src/', import.meta.url);
  const files = [...readdirSync(dir).filter((f) => f.endsWith('.mjs')).map((f) => new URL(f, dir)), new URL('../setup.mjs', import.meta.url)];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    assert.doesNotMatch(text, /^\s*(import\s[^;]*?from\s*|import\s*|export\s[^;]*?from\s*)['"]\.{1,2}\//m, String(f));
  }
});
