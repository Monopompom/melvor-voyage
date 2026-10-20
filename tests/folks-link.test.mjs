import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folksApi, FOLKS_API_MIN } from '../src/folks-link.mjs';

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
