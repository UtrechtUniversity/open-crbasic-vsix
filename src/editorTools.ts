// Pure helpers for the CRBasic side bar, the New Program command and the compiler choice. No
// `vscode` import: node:test loads this module directly.
import { execFile } from 'node:child_process';

// The logger profiles and the program extension each one compiles (open-crbasic `profiles.EXTENSIONS`).
export const LOGGER_EXTENSIONS: Readonly<Record<string, string>> = {
  cr6: '.CR6',
  cr1000x: '.CR1X',
  cr300: '.CR300',
  cr350: '.CR350',
};

const MODEL_NAMES: Readonly<Record<string, string>> = {
  cr6: 'CR6',
  cr1000x: 'CR1000X',
  cr300: 'CR300',
  cr350: 'CR350',
};

// A minimal program that compiles on every logger: battery voltage, an hourly table, a 5 s scan.
export function newProgramTemplate(logger: string): string {
  const model = MODEL_NAMES[logger] ?? logger.toUpperCase();
  return [
    `'${model} Series Datalogger`,
    '',
    "'Declare public variables",
    'Public BattV As Float',
    '',
    "'Define data tables",
    'DataTable(Hourly, True, -1)',
    '  DataInterval(0, 60, Min, 10)',
    '  Minimum(1, BattV, FP2, False, False)',
    'EndTable',
    '',
    "'Main program",
    'BeginProg',
    '  Scan(5, Sec, 0, 0)',
    '    Battery(BattV)',
    '    CallTable Hourly',
    '  NextScan',
    'EndProg',
    '',
  ].join('\n');
}

// One row of the server's `opencrbasic.instructions` answer.
export interface Instruction {
  name: string;
  kind: 'instruction' | 'function';
  params: string[];
  optional: boolean[];
  summary: string;
}

export type InstructionKind = 'all' | 'instruction' | 'function';

function snippetText(text: string): string {
  return text.replace(/[\\$}]/g, (c) => `\\${c}`);
}

// A snippet with a tab stop per required parameter (optional trailing ones are left out): an
// instruction is a statement (`VoltSe(...)`), a function call keeps its parentheses even when
// empty. Parameter names come from the help when the server has a help directory, else `argN`.
export function instructionSnippet(item: Instruction): string {
  let count = item.params.length;
  while (count > 0 && item.optional[count - 1]) {
    count -= 1;
  }
  const stops = item.params.slice(0, count).map((p, i) => `\${${i + 1}:${snippetText(p)}}`);
  if (stops.length === 0) {
    return item.kind === 'function' ? `${snippetText(item.name)}()` : snippetText(item.name);
  }
  return `${snippetText(item.name)}(${stops.join(', ')})`;
}

export function filterInstructions(items: readonly Instruction[], search: string, kind: InstructionKind): Instruction[] {
  const needle = search.trim().toUpperCase();
  return items.filter((i) => (kind === 'all' || i.kind === kind) && (!needle || i.name.toUpperCase().includes(needle)));
}

// The `crbc` command line for one program: the logger from the setting, or, with `auto`, from the
// program's extension as `crbc` infers it. Nothing is written next to the program.
export function crbcArgs(logger: string, program: string): string[] {
  return [...(logger === 'auto' ? [] : ['--logger', logger]), '--no-message-file', program];
}

// Runs `crbc` and resolves to its verdict (stdout). A program that does not compile still has a
// verdict, with a non-zero exit status; no verdict at all is an error that says why.
export function runCrbc(command: string, args: string[], cwd: string, timeoutMs = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (stdout) {
        resolve(stdout);
      } else if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
        reject(new Error(`${command} was not found; install it with \`cargo install opencrbasic\` or set opencrbasic.crbcPath`));
      } else if (err) {
        reject(new Error(`${command} failed: ${stderr.trim() || err.message}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

// The identifier at `column` of `line` (as the language's word pattern sees it), for the help view.
export function wordAt(line: string, column: number): string | undefined {
  for (const match of line.matchAll(/[A-Za-z_][A-Za-z0-9_]*\$?/g)) {
    const start = match.index ?? 0;
    if (start <= column && column <= start + match[0].length) {
      return match[0];
    }
  }
  return undefined;
}
