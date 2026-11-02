import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRequest, renderPanel } from '../loggerPanel';

test('requests from the webview are checked before use', () => {
  assert.deepEqual(parseRequest({ type: 'collect', table: 'Table1' }), { type: 'collect', table: 'Table1' });
  assert.equal(parseRequest({ type: 'collect' }), undefined);
  assert.equal(parseRequest({ type: 'watchStart', table: 'Public', interval: 0.01 }), undefined);
  assert.equal(parseRequest({ type: 'stop', deleteData: 'yes' }), undefined);
  assert.equal(parseRequest({ type: 'runShell', command: 'x' }), undefined);
  assert.equal(parseRequest(null), undefined);
});

test('the page runs only its own nonce-tagged script', () => {
  const html = renderPanel('abc123', 'vscode-resource:');
  assert.match(html, /script-src 'nonce-abc123'/);
  assert.equal((html.match(/<script nonce="abc123">/g) ?? []).length, 1);
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  assert.doesNotMatch(html, /innerHTML/);
});

test('every request the page sends is one the extension accepts', () => {
  const html = renderPanel('n', 'c');
  const sent = new Set([...html.matchAll(/send\(\{ type: '(\w+)'/g)].map((m) => m[1]));
  for (const type of sent) {
    assert.notEqual(parseRequest({ type, table: 'T', interval: 1, name: 'CPU:x', port: 'COM1', deleteData: false, text: '' }), undefined, type);
  }
});

test('logger settings stay out of the opencrbasic. keys the server mirrors', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
  const keys = Object.keys(manifest.contributes.configuration.properties);
  // open-crbasic's test_vscode_contributes_server_tuning_keys requires the opencrbasic.* keys to be
  // exactly the server's; the logger's own settings therefore carry another prefix.
  assert.ok(keys.includes('openloggernet.command') && keys.includes('openloggernet.port'));
  assert.ok(!keys.includes('opencrbasic.command') && !keys.includes('opencrbasic.port'));
});
