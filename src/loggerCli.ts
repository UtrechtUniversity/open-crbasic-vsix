// Pure helpers for driving open-loggernet's `oln` command line. No `vscode` import: node:test loads
// this module directly. Every call runs `oln --json ...` and reads one JSON document back (JSON
// Lines for `watch`); `oln` prints `{"error": ...}` and exits 1 on failure.

export interface LoggerTarget {
  // A serial port such as COM5 or /dev/ttyACM0; wins over `model`.
  port?: string;
  // The attached logger of this model, e.g. CR300.
  model?: string;
}

export interface LoggerPort {
  port: string;
  model: string | null;
  description: string;
}

export interface ProgramInfo {
  model: string | null;
  port: string;
  serial_number: string;
  os_version: string;
  program_name: string;
  power_up_program: string;
  compile_result: string;
  compile_time: string;
  station_name?: string;
  state?: string;
  // From `oln info`: the newest OS open-loggernet knows of for this model.
  os_latest?: { latest: string | null; url: string | null; outdated: boolean };
}

// `oln flash --json`: what was sent, then the program statistics read back.
export interface FlashResult extends ProgramInfo {
  program: string;
  includes: string[];
  skipped: string[];
}

export interface ClockInfo {
  logger: string;
  host: string;
  offset: number;
  logger_after?: string;
  offset_after?: number;
}

// One row of `oln --json settings`: by name from the logger itself, or by number from DevConfig's
// library (`id` set, `name` possibly empty).
export interface SettingRow {
  id?: number | null;
  name: string;
  value: unknown;
  read_only: boolean;
  type?: string;
  range?: string;
  error?: string;
}

export interface TableField {
  name: string;
  type: number;
  count: number;
  units: string;
  processing: string;
}

export interface TableInfo {
  number: number;
  name: string;
  size: number;
  record_size: number;
  interval: number | null;
  fields: TableField[];
}

export interface FileEntry {
  name: string;
  size: number;
  modified: string;
  drive: boolean;
  flags: string[];
}

export interface WatchRow {
  record: number;
  time: string;
  values: Record<string, unknown>;
}

export type CollectFormat = 'toa5' | 'tob1' | 'csv' | 'jsonl';

// Arguments for one `oln` call: the logger selection and `--json` go before the subcommand.
export function olnArgs(target: LoggerTarget, command: readonly string[]): string[] {
  const args: string[] = [];
  if (target.port) {
    args.push('--port', target.port);
  } else if (target.model) {
    args.push('--model', target.model);
  }
  args.push('--json', ...command);
  return args;
}

export const commands = {
  ports: (): string[] => ['ports'],
  info: (): string[] => ['info'],
  flash: (program: string): string[] => ['flash', program, '--no-compile'],
  settings: (): string[] => ['settings'],
  setSetting: (name: string, value: string): string[] => ['settings', 'set', `${name}=${value}`],
  setValue: (spec: string, value: string): string[] => ['set', `${spec}=${value}`],
  sendOs: (image: string): string[] => ['os', image],
  status: (): string[] => ['status'],
  tables: (): string[] => ['tables'],
  files: (): string[] => ['files', 'ls'],
  programStatus: (): string[] => ['program', 'status'],
  run: (name: string, keepData = false): string[] => ['program', 'run', name, ...(keepData ? ['--keep-data'] : [])],
  stop: (deleteData = false): string[] => ['program', 'stop', ...(deleteData ? ['--delete-data'] : [])],
  resume: (): string[] => ['program', 'resume'],
  put: (local: string, remote?: string): string[] => ['files', 'put', local, ...(remote ? [remote] : [])],
  get: (remote: string, local: string): string[] => ['files', 'get', remote, '-o', local],
  remove: (...remote: string[]): string[] => ['files', 'rm', ...remote],
  collect: (table: string, output: string, format: CollectFormat, count?: number): string[] => [
    'collect',
    table,
    ...(count === undefined ? ['--all'] : ['--count', String(count)]),
    '--format',
    format,
    '-o',
    output,
  ],
  watch: (table: string, intervalSeconds: number): string[] => ['watch', table, '--interval', String(intervalSeconds)],
  clock: (): string[] => ['clock'],
  setClockUtc: (): string[] => ['clock', '--set-utc'],
  terminal: (text: string, waitSeconds = 1.5): string[] => ['terminal', '--send', text, '--wait', String(waitSeconds)],
};

export class OlnError extends Error {
  override name = 'OlnError';
}

// The JSON document an `oln --json` call printed. A failure is `{"error": ...}` on stdout, with the
// same text on stderr; either is turned into an OlnError.
export function parseResult<T>(stdout: string, stderr: string, exitCode: number | null): T {
  const text = stdout.trim();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text.split(/\r?\n/).pop() ?? '') : undefined;
  } catch {
    parsed = undefined;
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'error' in parsed) {
    throw new OlnError(String((parsed as { error: unknown }).error));
  }
  if (exitCode !== 0 || parsed === undefined) {
    const message = stderr.trim().replace(/^oln: /, '') || `oln exited with code ${exitCode}`;
    throw new OlnError(message);
  }
  return parsed as T;
}

// One line of `oln --json watch`: {"record": n, "time": iso, field: value, ...}.
export function parseWatchLine(line: string): WatchRow | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || !('record' in parsed) || !('time' in parsed)) {
    return undefined;
  }
  const { record, time, ...values } = parsed as Record<string, unknown>;
  return { record: Number(record), time: String(time), values };
}

// Splits streamed stdout into complete lines, keeping a partial last line for the next chunk.
export class LineBuffer {
  private pending = '';

  push(chunk: string): string[] {
    this.pending += chunk;
    const lines = this.pending.split(/\r?\n/);
    this.pending = lines.pop() ?? '';
    return lines.filter((line) => line.length > 0);
  }
}

// The logger-side name of a local program file: `CPU:` + its base name.
export function loggerFileName(localPath: string): string {
  const base = localPath.slice(Math.max(localPath.lastIndexOf('/'), localPath.lastIndexOf('\\')) + 1);
  return `CPU:${base}`;
}

// A compile result that reports an error, e.g. "line 12: Undeclared variable" or "Compile Failed".
export function compileFailed(result: string): boolean {
  return /error|fail/i.test(result) && !/compiled (ok|in)/i.test(result);
}

export function describeTarget(target: LoggerTarget): string {
  return target.port ?? target.model ?? 'the attached logger';
}

// The language server's compiler output (CR6Comp's wording) reports a compiled program.
export function buildSucceeded(output: string): boolean {
  return /Compiled in/.test(output) && !/Compile Failed/i.test(output);
}

// A clock this far off the host's UTC is offered a sync.
export const CLOCK_TOLERANCE_SECONDS = 1;

export function clockOutOfSync(offset: number): boolean {
  return Math.abs(offset) > CLOCK_TOLERANCE_SECONDS;
}

// "3.2 s behind", "2 h 5 min ahead of", "248 d 1 h behind": a logger clock offset for people.
export function describeOffset(offset: number): string {
  const s = Math.abs(offset);
  const amount = s < 60 ? `${s.toFixed(1)} s`
    : s < 3600 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`
      : s < 86400 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`
        : `${Math.floor(s / 86400)} d ${Math.round((s % 86400) / 3600)} h`;
  return `${amount} ${offset < 0 ? 'behind' : 'ahead of'}`;
}

export const TABLE_FORMATS: ReadonlyArray<{ format: CollectFormat; label: string; detail: string; extension: string }> = [
  { format: 'toa5', label: 'TOA5 (.dat)', detail: "LoggerNet's ASCII table format", extension: 'dat' },
  { format: 'tob1', label: 'TOB1 (.dat)', detail: "LoggerNet's binary table format", extension: 'dat' },
  { format: 'csv', label: 'CSV (.csv)', detail: 'One header line, then one row per record', extension: 'csv' },
];

// LoggerNet's default name for a collected table, `<station>_<table>.dat`, safe as a file name.
export function tableFileName(station: string, table: string, extension: string): string {
  const safe = (text: string) => text.replace(/[^\w.-]+/g, '_');
  return `${station ? `${safe(station)}_` : ''}${safe(table)}.${extension}`;
}

// Settings that hold a secret are not shown in the tree.
export function isSecretSetting(name: string): boolean {
  return /password|privatekey|encryptionkey|eappassword/i.test(name);
}

// A program file the logger can compile and run (not a .crb library or a data file).
export function isProgramFile(name: string): boolean {
  return /\.(cr6|cr1x|cr300|cr350|cr8|cr1)$/i.test(name);
}
