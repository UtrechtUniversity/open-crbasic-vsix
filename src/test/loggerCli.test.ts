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
