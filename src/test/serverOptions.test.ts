import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServerLaunch, initializationOptions } from '../serverOptions';

test('buildServerLaunch uses the configured interpreter and arguments', () => {
  const launch = buildServerLaunch(
    { pythonPath: '/venv/bin/python', serverArgs: ['-m', 'opencrbasic.lsp'], serverEnv: {} },
    { HOME: '/home/u' },
  );
  assert.equal(launch.command, '/venv/bin/python');
  assert.deepEqual(launch.args, ['-m', 'opencrbasic.lsp']);
  assert.deepEqual(launch.env, { HOME: '/home/u' });
});

test('buildServerLaunch lets serverEnv override the base environment', () => {
  const launch = buildServerLaunch(
    {
      pythonPath: 'python3',
      serverArgs: ['-m', 'opencrbasic.lsp'],
      serverEnv: { PYTHONPATH: '/work/src', HOME: '/override' },
    },
    { HOME: '/home/u', PATH: '/bin' },
  );
  assert.deepEqual(launch.env, { HOME: '/override', PATH: '/bin', PYTHONPATH: '/work/src' });
});

test('buildServerLaunch copies the argument array and does not mutate inputs', () => {
  const serverArgs = ['-m', 'opencrbasic.lsp'];
  const baseEnv = { HOME: '/home/u' };
  const launch = buildServerLaunch({ pythonPath: 'python3', serverArgs, serverEnv: { A: '1' } }, baseEnv);
  launch.args.push('--extra');
  assert.deepEqual(serverArgs, ['-m', 'opencrbasic.lsp']);
  assert.deepEqual(baseEnv, { HOME: '/home/u' });
});

test('initializationOptions picks only the server keys', () => {
  const options = initializationOptions({
    entries: ['**/*.CR6'],
    exclude: ['examples/**'],
    logger: 'cr1000x',
    encoding: 'utf-8',
    debounceMs: 250,
    analysisTimeoutMs: 5000,
    helpDirectory: '../extracted_chm',
  });
  assert.deepEqual(options, {
    entries: ['**/*.CR6'],
    exclude: ['examples/**'],
    logger: 'cr1000x',
    encoding: 'utf-8',
    debounceMs: 250,
    analysisTimeoutMs: 5000,
    helpDirectory: '../extracted_chm',
  });
});

test('initializationOptions drops client-only keys and copies lists', () => {
  const input = {
    entries: ['a.CR6'],
    exclude: [],
    logger: 'cr6',
    encoding: 'utf-8',
    debounceMs: 300,
    analysisTimeoutMs: 10000,
    helpDirectory: '',
    pythonPath: 'python3',
    serverArgs: ['-m', 'opencrbasic.lsp'],
  };
  const options = initializationOptions(input);
  assert.equal('pythonPath' in options, false);
  assert.equal('serverArgs' in options, false);
  options.entries.push('b.CR6');
  assert.deepEqual(input.entries, ['a.CR6']);
});
