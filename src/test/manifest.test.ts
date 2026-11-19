import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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

test('every icon the manifest names exists, in a light and a dark variant', () => {
  const root = join(__dirname, '../..');
  const paths: string[] = [manifest.contributes.viewsContainers.activitybar[0].icon];
  for (const entry of [...manifest.contributes.commands, ...manifest.contributes.languages]) {
    if (entry.icon && typeof entry.icon === 'object') {
      paths.push(entry.icon.light, entry.icon.dark);
    }
  }
  assert.ok(paths.length > 30);
  for (const path of paths) {
    assert.ok(existsSync(join(root, path)), path);
  }
});

test('every command a menu or welcome button runs is contributed', () => {
  const contributed = new Set(manifest.contributes.commands.map((c: { command: string }) => c.command));
  const used = new Set<string>();
  for (const items of Object.values(manifest.contributes.menus) as { command: string }[][]) {
    items.forEach((item) => used.add(item.command));
  }
  for (const welcome of manifest.contributes.viewsWelcome as { contents: string }[]) {
    for (const match of welcome.contents.matchAll(/\(command:([\w.]+)\)/g)) {
      used.add(match[1]);
    }
  }
  for (const command of used) {
    assert.ok(contributed.has(command), command);
  }
});
