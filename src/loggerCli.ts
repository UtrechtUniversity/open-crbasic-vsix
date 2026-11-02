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

export type CollectFormat = 'toa5' | 'csv' | 'jsonl';

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
  status: (): string[] => ['status'],
  tables: (): string[] => ['tables'],
  files: (): string[] => ['files', 'ls'],
  programStatus: (): string[] => ['program', 'status'],
  run: (name: string, keepData = false): string[] => ['program', 'run', name, ...(keepData ? ['--keep-data'] : [])],
  stop: (deleteData = false): string[] => ['program', 'stop', ...(deleteData ? ['--delete-data'] : [])],
  resume: (): string[] => ['program', 'resume'],
  put: (local: string, remote?: string): string[] => ['files', 'put', local, ...(remote ? [remote] : [])],
  get: (remote: string, local: string): string[] => ['files', 'get', remote, '-o', local],
  remove: (remote: string): string[] => ['files', 'rm', remote],
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
