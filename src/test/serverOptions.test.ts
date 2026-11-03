import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildServerLaunch,
  findUv,
  initializationOptions,
  olderThan,
  parseOlnVersion,
  resolveOlnCommand,
  resolvePythonPath,
  uvInstaller,
  uvToolOln,
  uvToolPython,
} from '../serverOptions';

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
    maxFileBytes: 4096,
    maxQueuedJobs: 8,
    maxCacheMb: 64,
    helpDirectory: '../extracted_chm',
    inlayHints: { parameterNames: false },
  });
  assert.deepEqual(options, {
    entries: ['**/*.CR6'],
    exclude: ['examples/**'],
    logger: 'cr1000x',
    encoding: 'utf-8',
    debounceMs: 250,
    analysisTimeoutMs: 5000,
    maxFileBytes: 4096,
    maxQueuedJobs: 8,
    maxCacheMb: 64,
    helpDirectory: '../extracted_chm',
    inlayHints: { parameterNames: false },
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
    maxFileBytes: 2097152,
    maxQueuedJobs: 64,
    maxCacheMb: 256,
    helpDirectory: '',
    inlayHints: { parameterNames: true },
    pythonPath: 'python3',
    serverArgs: ['-m', 'opencrbasic.lsp'],
  };
  const options = initializationOptions(input);
  assert.equal('pythonPath' in options, false);
  assert.equal('serverArgs' in options, false);
  options.entries.push('b.CR6');
  options.inlayHints.parameterNames = false;
  assert.deepEqual(input.entries, ['a.CR6']);
  assert.equal(input.inlayHints.parameterNames, true);
});

test('uvToolPython follows uv tool directory defaults and overrides', () => {
  assert.equal(uvToolPython({}, 'darwin', '/Users/u'), '/Users/u/.local/share/uv/tools/opencrbasic/bin/python');
  assert.equal(uvToolPython({ XDG_DATA_HOME: '/x' }, 'linux', '/home/u'), '/x/uv/tools/opencrbasic/bin/python');
  assert.equal(uvToolPython({ UV_TOOL_DIR: '/t', XDG_DATA_HOME: '/x' }, 'linux', '/home/u'), '/t/opencrbasic/bin/python');
  assert.equal(
    uvToolPython({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'win32', 'C:\\Users\\u'),
    'C:\\Users\\u\\AppData\\Roaming\\uv\\data\\tools\\opencrbasic\\Scripts\\python.exe',
  );
});

test('resolvePythonPath prefers the setting, then the uv tool install, then python3', () => {
  assert.equal(resolvePythonPath('/venv/bin/python', '/uv/python', () => true), '/venv/bin/python');
  assert.equal(resolvePythonPath(undefined, '/uv/python', () => true), '/uv/python');
  assert.equal(resolvePythonPath(undefined, '/uv/python', () => false), 'python3');
});

test('findUv searches PATH first, then the installer directory', () => {
  const env = { PATH: '/usr/bin:/opt/homebrew/bin' };
  assert.equal(findUv(env, 'darwin', '/Users/u', (f) => f === '/opt/homebrew/bin/uv'), '/opt/homebrew/bin/uv');
  assert.equal(findUv(env, 'darwin', '/Users/u', (f) => f === '/Users/u/.local/bin/uv'), '/Users/u/.local/bin/uv');
  assert.equal(findUv({ XDG_BIN_HOME: '/b' }, 'linux', '/home/u', (f) => f === '/b/uv'), '/b/uv');
  assert.equal(findUv(env, 'linux', '/home/u', () => false), undefined);
  assert.equal(
    findUv({ Path: 'C:\\Windows' }, 'win32', 'C:\\Users\\u', (f) => f === 'C:\\Users\\u\\.local\\bin\\uv.exe'),
    'C:\\Users\\u\\.local\\bin\\uv.exe',
  );
});

test('uvInstaller runs the official installer for the platform', () => {
  assert.equal(uvInstaller('win32').command, 'powershell');
  assert.match(uvInstaller('win32').args.join(' '), /astral\.sh\/uv\/install\.ps1/);
  assert.deepEqual(uvInstaller('linux'), { command: 'sh', args: ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh'] });
});

test('olderThan compares release numbers and ignores unknown versions', () => {
  assert.equal(olderThan('1.0.0', '1.1.0'), true);
  assert.equal(olderThan('1.0', '1.0.1'), true);
  assert.equal(olderThan('1.1.0', '1.1.0'), false);
  assert.equal(olderThan('1.1.0.dev12', '1.1.0'), false);
  assert.equal(olderThan('1.10.0', '1.9.0'), false);
  assert.equal(olderThan('2.0.0', '1.1.0'), false);
  assert.equal(olderThan(undefined, '1.1.0'), false);
  assert.equal(olderThan('unknown', '1.1.0'), false);
});

test('uvToolOln is the oln of the openloggernet tool environment', () => {
  assert.equal(
    uvToolOln({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'win32', 'C:\\Users\\u'),
    'C:\\Users\\u\\AppData\\Roaming\\uv\\data\\tools\\openloggernet\\Scripts\\oln.exe',
  );
  assert.equal(uvToolOln({}, 'linux', '/home/u'), '/home/u/.local/share/uv/tools/openloggernet/bin/oln');
  assert.equal(uvToolOln({ UV_TOOL_DIR: '/t' }, 'darwin', '/home/u'), '/t/openloggernet/bin/oln');
});

test('resolveOlnCommand prefers the configured command, then the uv tool, then PATH', () => {
  const uvOln = '/t/openloggernet/bin/oln';
  assert.deepEqual(resolveOlnCommand(['uv', 'run', 'oln'], uvOln, () => true), ['uv', 'run', 'oln']);
  assert.deepEqual(resolveOlnCommand(undefined, uvOln, (f) => f === uvOln), [uvOln]);
  assert.deepEqual(resolveOlnCommand([], uvOln, () => false), ['oln']);
});

test('parseOlnVersion reads `oln --version` and nothing else', () => {
  assert.equal(parseOlnVersion('oln 0.3.0\n'), '0.3.0');
  assert.equal(parseOlnVersion('oln 0.3.1.dev4'), '0.3.1.dev4');
  assert.equal(parseOlnVersion('usage: oln [-h] ...'), undefined);
  assert.equal(parseOlnVersion(''), undefined);
});
