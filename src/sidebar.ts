// The CRBasic side bar: the instructions of the active program's logger, help for the instruction
// under the cursor, and the program's data tables. Every answer comes from the language server
// (`opencrbasic.instructions`, `opencrbasic.instructionHelp`, `opencrbasic.dataTables`).
import * as vscode from 'vscode';
import {
  filterInstructions,
  instructionSnippet,
  wordAt,
  type Instruction,
  type InstructionKind,
} from './editorTools';

// Runs a server command; rejects when the server is not running or refuses.
export type ServerCommand = (command: string, ...args: unknown[]) => Promise<unknown>;

const LANGUAGE_ID = 'crbasic';

function activeProgram(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  return editor && editor.document.languageId === LANGUAGE_ID && editor.document.uri.scheme === 'file' ? editor : undefined;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

class Item extends vscode.TreeItem {
  constructor(
    label: string,
    readonly instruction?: Instruction,
    readonly children: Item[] = [],
  ) {
    super(label, children.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
  }
}

function note(text: string): Item {
  const item = new Item(text);
  item.iconPath = new vscode.ThemeIcon('info');
  return item;
}

// ---- Instructions --------------------------------------------------------------------------------

class InstructionsView implements vscode.TreeDataProvider<Item> {
  private items: Instruction[] = [];
  private problem: string | undefined;
  private loadedFor: string | undefined; // the program the list was asked for
  search = '';
  kind: InstructionKind = 'all';
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly run: ServerCommand) {}

  // The list depends on the program's logger, so it is asked for again when another file is active.
  async load(force = false): Promise<void> {
    const editor = activeProgram();
    const uri = editor?.document.uri.toString();
    if (!uri || (uri === this.loadedFor && !force)) {
      return;
    }
    try {
      this.items = (await this.run('opencrbasic.instructions', uri)) as Instruction[];
      this.problem = undefined;
      this.loadedFor = uri;
    } catch (err) {
      this.items = [];
      this.problem = message(err);
      this.loadedFor = undefined;
    }
    this.changed.fire();
  }

  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(item: Item): Item {
    return item;
  }

  getChildren(): Item[] {
    if (this.problem) {
      return [note(this.problem)];
    }
    return filterInstructions(this.items, this.search, this.kind).map((i) => {
      const item = new Item(i.name, i);
      item.description = i.kind === 'function' ? 'function' : undefined;
      item.tooltip = new vscode.MarkdownString(`\`${instructionSnippet(i).replace(/\$\{\d+:([^}]*)\}/g, '$1')}\``);
      if (i.summary) {
        item.tooltip.appendMarkdown(`\n\n${i.summary}`);
      }
      item.iconPath = new vscode.ThemeIcon(i.kind === 'function' ? 'symbol-function' : 'symbol-method');
      item.contextValue = 'instruction';
      item.command = { command: 'opencrbasic.instructions.help', title: 'Show Help', arguments: [item] };
      return item;
    });
  }

  get filterDescription(): string | undefined {
    const parts = [this.kind === 'all' ? '' : `${this.kind}s`, this.search ? `"${this.search}"` : ''].filter(Boolean);
    return parts.length ? parts.join(', ') : undefined;
  }
}

// ---- Instruction Help ---------------------------------------------------------------------------

class HelpView implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private shown: string | undefined; // the name shown
  private pending: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly run: ServerCommand) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: false, localResourceRoots: [] };
    this.render('<p>Place the cursor on an instruction, or select one in the Instructions view.</p>');
  }

  // The instruction under the cursor, shortly after the cursor stops moving.
  follow(editor: vscode.TextEditor): void {
    clearTimeout(this.pending);
    this.pending = setTimeout(() => {
      const position = editor.selection.active;
      const name = wordAt(editor.document.lineAt(position.line).text, position.character);
      if (name) {
        void this.show(editor.document.uri, name, true);
      }
    }, 300);
  }

  // `quiet`: a word with no help (a variable, a keyword without a signature) leaves the view as it is.
  async show(uri: vscode.Uri, name: string, quiet = false): Promise<void> {
    if (!this.view || name.toUpperCase() === this.shown?.toUpperCase()) {
      return;
    }
    let markdown: unknown;
    try {
      markdown = await this.run('opencrbasic.instructionHelp', uri.toString(), name);
    } catch (err) {
      if (!quiet) {
        this.render(`<p>${escapeHtml(message(err))}</p>`);
      }
      return;
    }
    if (typeof markdown !== 'string') {
      if (!quiet) {
        this.render(`<p>No help for ${escapeHtml(name)}.</p>`);
      }
      return;
    }
    this.shown = name;
    // The built-in Markdown extension renders it (without it, the raw text). Scripts are off and the
    // CSP blocks every load, so whatever HTML the text holds can only display.
    const html = await vscode.commands.executeCommand<string>('markdown.api.render', markdown).then(
      (out) => out,
      () => `<pre>${escapeHtml(markdown as string)}</pre>`,
    );
    this.render(html);
  }

  private render(body: string): void {
    if (!this.view) {
      return;
    }
    this.view.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground)}
pre,code{font-family:var(--vscode-editor-font-family)}pre{white-space:pre-wrap}</style></head><body>${body}</body></html>`;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

// ---- Data Tables ---------------------------------------------------------------------------------

interface TableField {
  name: string;
  type: string;
  units: string | null;
  process: string | null;
  dimension: number;
}
interface Table {
  name: string;
  interval: string | null;
  location: { uri: string; range: { start: { line: number; character: number } } } | null;
  fields: TableField[];
}

class TablesView implements vscode.TreeDataProvider<Item> {
  private nodes: Item[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly run: ServerCommand) {}

  async load(): Promise<void> {
    const editor = activeProgram();
    if (!editor) {
      return;
    }
    try {
      const answer = (await this.run('opencrbasic.dataTables', editor.document.uri.toString())) as {
        compiled: boolean;
        tables: Table[];
      };
      this.nodes = answer.compiled ? answer.tables.map(tableNode) : [note('The program does not compile, so it has no tables yet.')];
    } catch (err) {
      this.nodes = [note(message(err))];
    }
    this.changed.fire();
  }

  getTreeItem(item: Item): Item {
    return item;
  }

  getChildren(item?: Item): Item[] {
    return item ? item.children : this.nodes;
  }
}

function tableNode(table: Table): Item {
  const fields = table.fields.map((f) => {
    const name = f.dimension > 1 && f.type !== 'String' ? `${f.name}(${f.dimension})` : f.name;
    const item = new Item(name);
    item.description = [f.process, f.type, f.units].filter(Boolean).join(' · ');
    item.iconPath = new vscode.ThemeIcon('symbol-field');
    return item;
  });
  const item = new Item(table.name, undefined, fields);
  item.description = table.interval ?? undefined;
  item.iconPath = new vscode.ThemeIcon(table.location ? 'table' : 'database');
  item.tooltip = table.location ? undefined : 'A table the logger defines for every program';
  if (table.location) {
    const { line, character } = table.location.range.start;
    item.command = {
      command: 'vscode.open',
      title: 'Go to Table',
      arguments: [vscode.Uri.parse(table.location.uri), { selection: new vscode.Range(line, character, line, character) }],
    };
  }
  return item;
}

// ---- registration --------------------------------------------------------------------------------

// `reload` asks the server again: after it (re)starts, the first answers may have been refusals.
export function registerSidebar(context: vscode.ExtensionContext, run: ServerCommand): { reload: () => void } {
  const instructions = new InstructionsView(run);
  const help = new HelpView(run);
  const tables = new TablesView(run);
  const instructionTree = vscode.window.createTreeView('opencrbasic.instructions', { treeDataProvider: instructions });
  const describe = (): void => {
    instructionTree.description = instructions.filterDescription;
  };
  let tablesTimer: ReturnType<typeof setTimeout> | undefined;
  const reloadTables = (): void => {
    clearTimeout(tablesTimer);
    tablesTimer = setTimeout(() => void tables.load(), 500);
  };
  const activeChanged = (): void => {
    if (activeProgram()) {
      void instructions.load();
      reloadTables();
    }
  };

  context.subscriptions.push(
    instructionTree,
    vscode.window.createTreeView('opencrbasic.dataTables', { treeDataProvider: tables }),
    vscode.window.registerWebviewViewProvider('opencrbasic.instructionHelp', help),
    vscode.window.onDidChangeActiveTextEditor(activeChanged),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (event.textEditor === activeProgram()) {
        help.follow(event.textEditor);
      }
    }),
    // A new analysis publishes diagnostics: the tables may have changed.
    vscode.languages.onDidChangeDiagnostics((event) => {
      const editor = activeProgram();
      if (editor && event.uris.some((u) => u.toString() === editor.document.uri.toString())) {
        reloadTables();
      }
    }),
    vscode.commands.registerCommand('opencrbasic.instructions.search', async () => {
      const search = await vscode.window.showInputBox({ prompt: 'Show instructions whose name contains', value: instructions.search });
      if (search !== undefined) {
        instructions.search = search;
        instructions.refresh();
        describe();
      }
    }),
    vscode.commands.registerCommand('opencrbasic.instructions.filter', async () => {
      const kinds: { label: string; show: InstructionKind }[] = [
        { label: 'Instructions and functions', show: 'all' },
        { label: 'Instructions', show: 'instruction' },
        { label: 'Functions', show: 'function' },
      ];
      const choice = await vscode.window.showQuickPick(kinds, { placeHolder: 'Show' });
      if (choice) {
        instructions.kind = choice.show;
        instructions.refresh();
        describe();
      }
    }),
    vscode.commands.registerCommand('opencrbasic.instructions.clearFilter', () => {
      instructions.search = '';
      instructions.kind = 'all';
      instructions.refresh();
      describe();
    }),
    vscode.commands.registerCommand('opencrbasic.instructions.refresh', () => instructions.load(true)),
    vscode.commands.registerCommand('opencrbasic.instructions.insert', async (item?: Item) => {
      const editor = activeProgram() ?? vscode.window.visibleTextEditors.find((e) => e.document.languageId === LANGUAGE_ID);
      if (!item?.instruction || !editor) {
        void vscode.window.showInformationMessage('Insert Instruction: open a CRBasic file first.');
        return;
      }
      await editor.insertSnippet(new vscode.SnippetString(instructionSnippet(item.instruction)));
      await vscode.window.showTextDocument(editor.document, editor.viewColumn);
    }),
    vscode.commands.registerCommand('opencrbasic.instructions.help', async (item?: Item) => {
      const editor = activeProgram() ?? vscode.window.visibleTextEditors.find((e) => e.document.languageId === LANGUAGE_ID);
      if (item?.instruction && editor) {
        await vscode.commands.executeCommand('opencrbasic.instructionHelp.focus');
        await help.show(editor.document.uri, item.instruction.name);
      }
    }),
    vscode.commands.registerCommand('opencrbasic.dataTables.refresh', () => tables.load()),
  );
  activeChanged();
  return {
    reload: () => {
      void instructions.load(true);
      reloadTables();
    },
  };
}
