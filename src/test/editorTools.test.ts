import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LOGGER_EXTENSIONS,
  crbcArgs,
  filterInstructions,
  instructionSnippet,
  newProgramTemplate,
  runCrbc,
  wordAt,
  type Instruction,
} from '../editorTools';

const volt: Instruction = { name: 'VoltSe', kind: 'instruction', params: ['Dest', 'Reps', 'Range'], optional: [false, false, true], summary: '' };
const abs: Instruction = { name: 'ABS', kind: 'function', params: ['arg1'], optional: [false], summary: '' };

test('a snippet has a tab stop per required parameter', () => {
  assert.equal(instructionSnippet(volt), 'VoltSe(${1:Dest}, ${2:Reps})');
  assert.equal(instructionSnippet({ ...abs, params: [], optional: [] }), 'ABS()');
  assert.equal(instructionSnippet({ ...volt, params: [], optional: [] }), 'VoltSe');
  assert.equal(instructionSnippet({ ...abs, name: 'Chr$', params: ['a}b'] }), 'Chr\\$(${1:a\\}b})');
});

test('instructions filter by kind and by a case-insensitive name part', () => {
  assert.deepEqual(filterInstructions([volt, abs], 'volt', 'all'), [volt]);
  assert.deepEqual(filterInstructions([volt, abs], '', 'function'), [abs]);
  assert.deepEqual(filterInstructions([volt, abs], ' ', 'all'), [volt, abs]);
});

test('the template names its logger and every logger has its program extension', () => {
  assert.deepEqual(Object.keys(LOGGER_EXTENSIONS), ['cr6', 'cr1000x', 'cr300', 'cr350']);
  assert.match(newProgramTemplate('cr1000x'), /^'CR1000X Series Datalogger\n/);
  assert.match(newProgramTemplate('cr6'), /\nBeginProg\n[\s\S]*\nEndProg\n$/);
});

test('crbc gets the logger only when one is configured', () => {
  assert.deepEqual(crbcArgs('auto', '/p/Main.CR6'), ['--no-message-file', '/p/Main.CR6']);
  assert.deepEqual(crbcArgs('cr300', 'Main.CR300'), ['--logger', 'cr300', '--no-message-file', 'Main.CR300']);
});

test('the word under the cursor, at either edge of it', () => {
  assert.equal(wordAt('  VoltSe(T, 1)', 2), 'VoltSe');
  assert.equal(wordAt('  VoltSe(T, 1)', 8), 'VoltSe');
  assert.equal(wordAt('x = Chr$(65)', 6), 'Chr$');
  assert.equal(wordAt('   ', 1), undefined);
});

test('runCrbc returns the verdict even when crbc exits non-zero, and says when crbc is missing', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'crbc-'));
  const fake = join(dir, 'crbc');
  writeFileSync(fake, '#!/bin/sh\necho "$1 -- Compile Failed!"\nexit 1\n');
  chmodSync(fake, 0o755);
  assert.equal(await runCrbc(fake, ['Main.CR6'], dir), 'Main.CR6 -- Compile Failed!\n');
  await assert.rejects(runCrbc(join(dir, 'missing'), [], dir), /was not found; install it with `cargo install opencrbasic`/);
});
