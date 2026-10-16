import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const manifest = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));

test('unlimited hint length defaults apply only to the contributed CRBasic language', () => {
  const language = manifest.contributes.languages[0].id;
  assert.deepEqual(manifest.contributes.configurationDefaults, {
    [`[${language}]`]: { 'editor.inlayHints.maximumLength': 0 },
  });
});

test('Restricted Mode explains why the extension needs Workspace Trust', () => {
  const trust = manifest.capabilities.untrustedWorkspaces;
  assert.equal(trust.supported, false);
  assert.match(trust.description, /Python language server from the configured interpreter/);
});
