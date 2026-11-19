import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LineBuffer,
  OlnError,
  commands,
  compileFailed,
  loggerFileName,
  olnArgs,
  parseResult,
  parseWatchLine,
  TABLE_FORMATS,
  buildSucceeded,
  clockOutOfSync,
  describeOffset,
  isProgramFile,
  isSecretSetting,
  tableFileName,
} from '../loggerCli';

test('the logger selection and --json come before the subcommand', () => {
  assert.deepEqual(olnArgs({ port: 'COM5', model: 'CR6' }, commands.info()), ['--port', 'COM5', '--json', 'info']);
  assert.deepEqual(olnArgs({ model: 'CR300' }, commands.tables()), ['--model', 'CR300', '--json', 'tables']);
  assert.deepEqual(olnArgs({}, commands.ports()), ['--json', 'ports']);
});

test('collect asks for every record unless a count is given', () => {
  assert.deepEqual(commands.collect('Table1', 'C:\\d\\T.dat', 'toa5'), [
    'collect', 'Table1', '--all', '--format', 'toa5', '-o', 'C:\\d\\T.dat',
  ]);
  assert.deepEqual(commands.collect('Fast', 'f.csv', 'csv', 10).slice(0, 4), ['collect', 'Fast', '--count', '10']);
});

test('a JSON result is returned and an {"error"} document raises', () => {
  assert.deepEqual(parseResult('[{"port": "COM4", "model": "CR300"}]\n', '', 0), [{ port: 'COM4', model: 'CR300' }]);
  assert.throws(
    () => parseResult('{"error": "no CR300 attached"}\n', 'oln: no CR300 attached\n', 1),
    (err: unknown) => err instanceof OlnError && err.message === 'no CR300 attached',
  );
});

test('a failure without JSON reports stderr without the oln: prefix', () => {
  assert.throws(() => parseResult('', 'oln: cannot open COM4\n', 1), /^OlnError: cannot open COM4$/);
  assert.throws(() => parseResult('', '', 2), /exited with code 2/);
});

test('watch lines split into record, time and values', () => {
  assert.deepEqual(parseWatchLine('{"record": 1264, "time": "2026-02-27T15:31:16+00:00", "PTemp": 19.7}'), {
    record: 1264,
    time: '2026-02-27T15:31:16+00:00',
    values: { PTemp: 19.7 },
  });
  assert.equal(parseWatchLine('not json'), undefined);
  assert.equal(parseWatchLine('{"error": "x"}'), undefined);
});

test('streamed output is cut into whole lines', () => {
  const buffer = new LineBuffer();
  assert.deepEqual(buffer.push('{"a":1}\r\n{"b"'), ['{"a":1}']);
  assert.deepEqual(buffer.push(':2}\n'), ['{"b":2}']);
});

test('a local program goes to CPU: under its own name', () => {
  assert.equal(loggerFileName('C:\\work\\crbasic\\Main.CR6'), 'CPU:Main.CR6');
  assert.equal(loggerFileName('/home/u/Main.CR1X'), 'CPU:Main.CR1X');
});

test('compile results as the logger reports them', () => {
  assert.equal(compileFailed('CPU:oln_fast.CR6 -- Compiled in PipelineMode.\r\n'), false);
  assert.equal(compileFailed('CPU:thermocouple-cr300.CR300 -- Compiled OK.\r\n'), false);
  assert.equal(compileFailed('CPU:Bad.CR6 -- Compile Failed!\r\nline 3: Undeclared variable X.'), true);
});

test('flash sends without compiling: the language server builds', () => {
  assert.deepEqual(olnArgs({ port: 'COM5' }, commands.flash('/w/Main.CR6')), ['--port', 'COM5', '--json', 'flash', '/w/Main.CR6', '--no-compile']);
  assert.deepEqual(commands.remove('CPU:a.crb', 'CPU:b.CR6'), ['files', 'rm', 'CPU:a.crb', 'CPU:b.CR6']);
  assert.deepEqual(commands.setSetting('StationName', 'Bench 6'), ['settings', 'set', 'StationName=Bench 6']);
});

test('a build succeeds only on "Compiled in" without "Compile Failed"', () => {
  assert.equal(buildSucceeded('Main.CR6 -- Compiled in SequentialMode.'), true);
  assert.equal(buildSucceeded('bad.CR6 -- Compile Failed!\nline 4: Invalid expression'), false);
  assert.equal(buildSucceeded(''), false);
});

test('collected tables are named as LoggerNet names them, safe for the file system', () => {
  assert.equal(tableFileName('27946', 'Shunt_Data', 'dat'), '27946_Shunt_Data.dat');
  assert.equal(tableFileName('Ridge Station/2', 'T', 'csv'), 'Ridge_Station_2_T.csv');
  assert.equal(tableFileName('', 'T', 'dat'), 'T.dat');
  assert.deepEqual(TABLE_FORMATS.map((f) => f.format), ['toa5', 'tob1', 'csv']);
});

test('clock sync is offered beyond one second; programs are told from libraries', () => {
  assert.equal(clockOutOfSync(0.4), false);
  assert.equal(clockOutOfSync(-21431233), true);
  assert.equal(isProgramFile('CPU:Main.CR6'), true);
  assert.equal(isProgramFile('CPU:Lib.crb'), false);
  assert.equal(isSecretSetting('WiFiPassword'), true);
  assert.equal(isSecretSetting('StationName'), false);
});

test('a clock offset reads in the largest sensible unit', () => {
  assert.equal(describeOffset(-3.24), '3.2 s behind');
  assert.equal(describeOffset(3600.9), '1 h 0 min ahead of');
  assert.equal(describeOffset(-21431233), '248 d 1 h behind');
});
