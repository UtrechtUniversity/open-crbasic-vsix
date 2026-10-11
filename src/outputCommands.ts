// Pure helpers for the two output commands. No `vscode` import: node:test loads this module directly.

export const OUTPUT_SCHEME = 'opencrbasic-output';

export type OutputKind = 'compilerOutput' | 'tableFields';

export interface OutputCommand {
  // Palette command registered by the extension.
  readonly clientCommand: string;
  // Command the server advertises in executeCommandProvider and executes.
  readonly serverCommand: string;
  readonly title: string;
  // Suffix of the virtual document's file name; it selects the editor's language mode.
  readonly label: string;
  readonly extension: string;
}

// The palette ids differ from the server ids: the language client registers every command the
// server advertises, and registering the same id twice fails.
export const OUTPUT_COMMANDS: Readonly<Record<OutputKind, OutputCommand>> = {
  compilerOutput: {
    clientCommand: 'opencrbasic.openCompilerOutput',
    serverCommand: 'opencrbasic.showCompilerOutput',
    title: 'opencrbasic: Show Compiler Output',
    label: 'compiler output',
    extension: '.txt',
  },
  tableFields: {
    clientCommand: 'opencrbasic.openTableFields',
    serverCommand: 'opencrbasic.showTableFields',
    title: 'opencrbasic: Show Table Fields',
    label: 'table fields',
    extension: '.md',
  },
};

export interface OutputTarget {
  kind: OutputKind;
  // URI string of the document the output is about (the argument of the server command).
  source: string;
}

function baseName(uri: string): string {
  const path = uri.replace(/[?#].*$/, '');
  const last = path.slice(path.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(last) || 'untitled';
  } catch {
    return last || 'untitled';
  }
}

// `opencrbasic-output:/<encoded name> <label><ext>?<kind>&<encoded source uri>`; the name only
// titles the tab, the query carries what the content provider needs.
export function buildOutputUri(kind: OutputKind, source: string): string {
  const command = OUTPUT_COMMANDS[kind];
  const name = encodeURIComponent(`${baseName(source)} ${command.label}${command.extension}`);
  return `${OUTPUT_SCHEME}:/${name}?${kind}&${encodeURIComponent(source)}`;
}

// The query of an output uri after one round of percent-decoding, which is what `vscode.Uri.query`
// holds: `<kind>&<source uri>`.
export function parseOutputQuery(query: string): OutputTarget | undefined {
  const split = query.indexOf('&');
  const kind = query.slice(0, split);
  if (split < 0 || (kind !== 'compilerOutput' && kind !== 'tableFields')) {
    return undefined;
  }
  const source = query.slice(split + 1);
  return source ? { kind, source } : undefined;
}

export function parseOutputUri(uri: string): OutputTarget | undefined {
  const mark = uri.indexOf('?');
  if (!uri.startsWith(`${OUTPUT_SCHEME}:/`) || mark < 0) {
    return undefined;
  }
  try {
    return parseOutputQuery(decodeURIComponent(uri.slice(mark + 1)));
  } catch {
    return undefined;
  }
}

// Text shown when the server refuses or fails; the document stays readable instead of failing to open.
export function failureText(command: OutputCommand, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${command.title}\n\n${message}\n`;
}
