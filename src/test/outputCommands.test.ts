import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posix, win32 } from 'node:path';
import {
  OUTPUT_COMMANDS,
  OUTPUT_SCHEME,
  buildOutputUri,
  failureText,
  parseOutputQuery,
  parseOutputUri,
} from '../outputCommands';

test('server command ids are the ones the server advertises', () => {
  assert.equal(OUTPUT_COMMANDS.compilerOutput.serverCommand, 'opencrbasic.showCompilerOutput');
  assert.equal(OUTPUT_COMMANDS.tableFields.serverCommand, 'opencrbasic.showTableFields');
});

test('palette ids differ from server ids, so the language client can register the server ones', () => {
  for (const command of Object.values(OUTPUT_COMMANDS)) {
    assert.notEqual(command.clientCommand, command.serverCommand);
    assert.match(command.clientCommand, /^opencrbasic\./);
  }
  assert.equal(new Set(Object.values(OUTPUT_COMMANDS).map((c) => c.clientCommand)).size, 2);
});

test('titles follow the "opencrbasic: ..." palette convention', () => {
  assert.equal(OUTPUT_COMMANDS.compilerOutput.title, 'opencrbasic: Show Compiler Output');
  assert.equal(OUTPUT_COMMANDS.tableFields.title, 'opencrbasic: Show Table Fields');
});

test('an output uri names the document, picks the language by extension and round-trips', () => {
  const source = 'file:///work/My%20Station/Main.CR6';
  const compiler = buildOutputUri('compilerOutput', source);
  const tables = buildOutputUri('tableFields', source);
  assert.ok(compiler.startsWith(`${OUTPUT_SCHEME}:`));
  assert.match(decodeURIComponent(compiler.split('?')[0]), /Main\.CR6 compiler output\.txt$/);
  assert.match(decodeURIComponent(tables.split('?')[0]), /Main\.CR6 table fields\.md$/);
  assert.deepEqual(parseOutputUri(compiler), { kind: 'compilerOutput', source });
  assert.deepEqual(parseOutputUri(tables), { kind: 'tableFields', source });
});

test('output titles have no root separator with local or remote host path conventions', () => {
  for (const source of ['file:///work/Main.CR6', 'file:///c%3A/work/Main.CR6']) {
    for (const kind of ['compilerOutput', 'tableFields'] as const) {
      const uri = new URL(buildOutputUri(kind, source));
      const path = decodeURIComponent(uri.pathname);
      const expected = `Main.CR6 ${OUTPUT_COMMANDS[kind].label}${OUTPUT_COMMANDS[kind].extension}`;
      // Windows UI fsPath conversion followed by a POSIX basename models the Remote-WSL label.
      for (const label of [path, path.replaceAll('/', '\\')]) {
        assert.equal(posix.basename(label), expected);
        assert.equal(win32.basename(label), expected);
      }
    }
  }
});

test('a source uri with query characters and non-ASCII text round-trips', () => {
  const source = 'file:///c%3A/dir/%C3%89%20space.crb?x=1&y=2#frag';
  assert.deepEqual(parseOutputUri(buildOutputUri('tableFields', source)), { kind: 'tableFields', source });
});

test('the same document and kind give the same uri, a different kind another', () => {
  const source = 'file:///a/B.CR6';
  assert.equal(buildOutputUri('tableFields', source), buildOutputUri('tableFields', source));
  assert.notEqual(buildOutputUri('tableFields', source), buildOutputUri('compilerOutput', source));
});

test('foreign or malformed uris are not output uris', () => {
  assert.equal(parseOutputUri('file:///a/B.CR6'), undefined);
  assert.equal(parseOutputUri(`${OUTPUT_SCHEME}:/x`), undefined);
  assert.equal(parseOutputUri(`${OUTPUT_SCHEME}:/x?other&file%3A%2F%2F%2Fa`), undefined);
  assert.equal(parseOutputUri(`${OUTPUT_SCHEME}:/x?tableFields&%E0%A4%A`), undefined);
});

test('a failure becomes readable document text with the title and the message', () => {
  const text = failureText(OUTPUT_COMMANDS.tableFields, new Error('Cannot show table fields: pending'));
  assert.match(text, /^opencrbasic: Show Table Fields\n\nCannot show table fields: pending\n$/);
  assert.match(failureText(OUTPUT_COMMANDS.compilerOutput, 'plain'), /plain/);
});

test('the query as VS Code holds it (decoded once) gives the target', () => {
  const source = 'file:///c%3A/dir/%C3%89%20space.crb';
  const query = decodeURIComponent(buildOutputUri('compilerOutput', source).split('?')[1]);
  assert.equal(query, `compilerOutput&${source}`);
  assert.deepEqual(parseOutputQuery(query), { kind: 'compilerOutput', source });
  assert.equal(parseOutputQuery('compilerOutput&'), undefined);
  assert.equal(parseOutputQuery('nothing'), undefined);
});
