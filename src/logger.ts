// Logger actions backed by open-loggernet's `oln` command line: palette commands and the Logger
// panel. Only one program can hold a logger's serial port, so every `oln` call goes through one
// queue, and a running watch is paused while another call needs the port.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import * as vscode from 'vscode';
import {
  LineBuffer,
  OlnError,
  TABLE_FORMATS,
  buildSucceeded,
  clockOutOfSync,
  commands as oln,
  describeOffset,
  compileFailed,
  describeTarget,
  loggerFileName,
  olnArgs,
  parseResult,
  parseWatchLine,
  tableFileName,
  type ClockInfo,
  type CollectFormat,
  type FileEntry,
  type FlashResult,
  type LoggerPort,
  type LoggerTarget,
  type ProgramInfo,
  type SettingRow,
  type TableInfo,
  type WatchRow,
} from './loggerCli';
import { parseRequest, renderPanel, type PanelRequest } from './loggerPanel';
import {
  ListView,
  Node,
  VIEW_IDS,
  fileNodes,
  publicNodes,
  settingNodes,
  stationNodes,
  tableNodes,
  type ViewId,
} from './loggerViews';
import { MIN_OLN_VERSION, olderThan, parseOlnVersion, resolveOlnCommand, uvToolOln } from './serverOptions';
import { ensureUv, locateUv, runUv } from './uvTasks';

const SECTION = 'openloggernet';
const PORT_STATE = `${SECTION}.port`;
const INSTALL_HINT = 'Install open-loggernet (`uv tool install openloggernet`) or set openloggernet.command.';
const INSTALL_ACTION = 'Install open-loggernet with uv';
const INSTALL_UV_ACTION = 'Install uv and open-loggernet';
const UPGRADE_ACTION = 'Upgrade open-loggernet with uv';

// The installed `oln`'s version, or undefined when it does not run or does not print one (before 0.3.0).
function olnVersion(command: string[]): Promise<string | undefined> {
  const [program, ...prefix] = command;
  return new Promise((resolve) => {
    execFile(program, [...prefix, '--version'], { windowsHide: true, timeout: 30000 }, (err, stdout) =>
      resolve(err ? undefined : parseOlnVersion(stdout)),
    );
  });
}

interface Watch {
  table: string;
  interval: number;
  process: ChildProcess;
}

// Compiles a CRBasic file with the language server; resolves to its CR6Comp-style output.
export type Compile = (uri: vscode.Uri) => Promise<string>;

const PUBLIC = 'Public';

export class LoggerService implements vscode.Disposable {
  private queue: Promise<unknown> = Promise.resolve();
  private olnChecked: Promise<void> | undefined;
  private watch: Watch | undefined;
  private panel: vscode.WebviewPanel | undefined;
  readonly views = Object.fromEntries(VIEW_IDS.map((id) => [id, new ListView(id)])) as Record<ViewId, ListView>;
  private publicValues: Record<string, unknown> = {};
  private lastInfo: ProgramInfo | undefined;
  private osOffered = new Set<string>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.LogOutputChannel,
    private readonly compile: Compile,
  ) {}

  private get media(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.extensionUri, 'media');
  }

  dispose(): void {
    this.watch?.process.kill();
    this.panel?.dispose();
  }

  // -- running oln --

  // The value a user or workspace set, not the manifest default.
  private configuredCommand(): string[] | undefined {
    const value = vscode.workspace.getConfiguration(SECTION).inspect<string[]>('command');
    const set = value?.workspaceFolderValue ?? value?.workspaceValue ?? value?.globalValue;
    return set?.length ? set : undefined;
  }

  private uvOln(): string {
    return uvToolOln(process.env, process.platform, homedir());
  }

  private command(): string[] {
    return resolveOlnCommand(this.configuredCommand(), this.uvOln(), existsSync);
  }

  // Once per session, before the first `oln` call: offers to install open-loggernet with uv when no
  // `oln` runs, or to upgrade it when it is older than this extension drives. A configured command
  // is the user's to maintain and only gets a warning. A declined offer is not repeated; a failed
  // install is offered again on the next call.
  private ensureOln(): Promise<void> {
    this.olnChecked ??= this.checkOln().catch((err: unknown) => {
      this.olnChecked = undefined;
      throw err;
    });
    return this.olnChecked;
  }

  private async checkOln(): Promise<void> {
    const version = await olnVersion(this.command());
    if (version && !olderThan(version, MIN_OLN_VERSION)) {
      return;
    }
    // A configured command, or an `oln` on PATH that uv did not install, is the user's to upgrade. A
    // uv install of open-loggernet takes precedence over an `oln` on PATH that predates `--version`.
    const configured = this.configuredCommand() !== undefined;
    const uvTool = existsSync(this.uvOln());
    if (configured || (!uvTool && version !== undefined)) {
      void vscode.window.showWarningMessage(
        `open-loggernet ${version ?? '(version unknown)'} is older than ${MIN_OLN_VERSION}, which the logger actions need. Upgrade the oln that ${configured ? 'openloggernet.command runs' : 'is on PATH'}.`,
      );
      return;
    }
    const uv = locateUv();
    const install = uvTool ? UPGRADE_ACTION : uv ? INSTALL_ACTION : INSTALL_UV_ACTION;
    const text = uvTool
      ? `open-loggernet ${version ?? '(version unknown)'} is older than ${MIN_OLN_VERSION}, which the logger actions need. Upgrade it with uv?`
      : 'The logger actions need open-loggernet, which is not installed. Install it with uv (`uv tool install openloggernet`)?';
    if ((await vscode.window.showWarningMessage(text, install)) !== install) {
      return;
    }
    const found = await ensureUv(uv);
    if (uvTool) {
      await runUv(found, 'upgrade openloggernet', ['tool', 'upgrade', 'openloggernet'], 'upgrading open-loggernet with uv failed');
    } else {
      await runUv(found, 'install openloggernet', ['tool', 'install', 'openloggernet'], 'installing open-loggernet with uv failed');
    }
    const installed = await olnVersion(this.command());
    if (!installed || olderThan(installed, MIN_OLN_VERSION)) {
      throw new OlnError(`uv finished, but ${this.uvOln()} does not report open-loggernet ${MIN_OLN_VERSION} or later`);
    }
    this.output.info(`open-loggernet ${installed} installed with uv`);
  }

  target(): LoggerTarget {
    const port = this.context.workspaceState.get<string>(PORT_STATE)
      || vscode.workspace.getConfiguration(SECTION).get<string>('port', '');
    return port ? { port } : {};
  }

  private spawnOln(args: string[]): ChildProcess {
    const [program, ...prefix] = this.command();
    this.output.info(`oln ${args.join(' ')}`);
    return spawn(program, [...prefix, ...args], { windowsHide: true });
  }

  private exec<T>(args: string[], target: LoggerTarget | undefined): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const child = this.spawnOln(target === undefined ? ['--json', ...args] : olnArgs(target, args));
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', (err) => reject(new OlnError(`${err.message}. ${INSTALL_HINT}`)));
      child.on('close', (code) => {
        if (stderr.trim()) {
          this.output.debug(stderr.trim());
        }
        try {
          resolve(parseResult<T>(stdout, stderr, code));
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  // Runs one oln call on the port, after the calls queued before it; a watch is paused around it.
  run<T>(args: string[], target: LoggerTarget | undefined = this.target()): Promise<T> {
    const next = this.queue.then(async () => {
      await this.ensureOln();
      const paused = this.watch;
      if (paused && target !== undefined) {
        await this.stopWatch(false);
      }
      try {
        return await this.exec<T>(args, target);
      } finally {
        if (paused && target !== undefined) {
          this.startWatch(paused.table, paused.interval);
        }
      }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  // -- watch --

  startWatch(table: string, interval: number): void {
    void this.ensureOln().then(
      () => this.spawnWatch(table, interval),
      (err: unknown) => this.report(err),
    );
  }

  private spawnWatch(table: string, interval: number): void {
    void this.stopWatch(false);
    const child = this.spawnOln(olnArgs(this.target(), oln.watch(table, interval)));
    const lines = new LineBuffer();
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of lines.push(chunk.toString())) {
        const row = parseWatchLine(line);
        if (row) {
          void this.panel?.webview.postMessage({ type: 'watch', row });
          if (table === PUBLIC) {
            this.showPublic(row);
          }
        }
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', () => {
      if (this.watch?.process === child) {
        this.watch = undefined;
        this.watchEnded();
        void this.panel?.webview.postMessage({ type: 'watchState', running: false });
        if (stderr.trim()) {
          const text = stderr.trim().replace(/^oln: /, '');
          void this.panel?.webview.postMessage({ type: 'error', text });
          if (table === PUBLIC) {
            void vscode.window.showWarningMessage(`Logger: live values stopped: ${text}`);
          }
        }
      }
    });
    this.watch = { table, interval, process: child };
    void vscode.commands.executeCommand('setContext', 'openloggernet.connected', table === PUBLIC);
    void this.panel?.webview.postMessage({ type: 'watchState', running: true, table });
  }

  private stopWatch(notify = true): Promise<void> {
    const current = this.watch;
    if (!current) {
      return Promise.resolve();
    }
    this.watch = undefined;
    if (notify) {
      this.watchEnded();
    }
    return new Promise((resolve) => {
      current.process.once('close', () => resolve());
      current.process.kill();
      if (notify) {
        void this.panel?.webview.postMessage({ type: 'watchState', running: false });
      }
    });
  }

  // -- actions shared by the palette and the panel --

  async selectLogger(): Promise<LoggerTarget | undefined> {
    const ports = await this.run<LoggerPort[]>(oln.ports(), undefined);
    if (!ports.length) {
      void vscode.window.showWarningMessage('No Campbell logger is attached by USB.');
      return undefined;
    }
    const pick = await vscode.window.showQuickPick(
      [
        ...ports.map((p) => ({ label: p.model ?? '?', description: p.port, detail: p.description, port: p.port })),
        { label: 'Automatic', description: 'the only logger attached, found again on each call', detail: undefined, port: '' },
      ],
      { title: 'Serial port of the logger', placeHolder: `Now: ${this.target().port ?? 'automatic'}` },
    );
    if (!pick) {
      return undefined;
    }
    await this.setPort(pick.port);
    return pick.port ? { port: pick.port } : this.ensureTarget();
  }

  // A different logger: what the views showed belonged to the old one.
  private async setPort(port: string): Promise<void> {
    if (port === (this.context.workspaceState.get<string>(PORT_STATE) ?? '')) {
      return;
    }
    await this.stopWatch();
    await this.context.workspaceState.update(PORT_STATE, port || undefined);
    this.lastInfo = undefined;
    for (const view of Object.values(this.views)) {
      view.set(undefined);
    }
  }

  // A logger is chosen once and remembered; with exactly one attached it is used without asking.
  async ensureTarget(): Promise<LoggerTarget | undefined> {
    const current = this.target();
    if (current.port) {
      return current;
    }
    const ports = await this.run<LoggerPort[]>(oln.ports(), undefined);
    if (ports.length === 1) {
      return { port: ports[0].port };
    }
    return this.selectLogger();
  }

  // The CRBasic file a command acts on: the one it was given, else the active editor's; saved first.
  private async programFile(uri: vscode.Uri | undefined): Promise<vscode.Uri | undefined> {
    const file = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;
    if (!file || file.scheme !== 'file') {
      void vscode.window.showInformationMessage('Open a CRBasic program first.');
      return undefined;
    }
    await vscode.workspace.save(file);
    return file;
  }

  // Compiles with the language server. A failure shows the compiler output and returns false.
  async build(uri: vscode.Uri | undefined): Promise<boolean> {
    const file = await this.programFile(uri);
    if (!file) {
      return false;
    }
    const name = file.path.slice(file.path.lastIndexOf('/') + 1);
    const text = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: `Building ${name}` },
      () => this.compile(file),
    );
    this.output.info(`build ${name}:\n${text.trim()}`);
    if (buildSucceeded(text)) {
      void vscode.window.setStatusBarMessage(`$(check) ${name} compiled`, 5000);
      return true;
    }
    const lines = text.split(/\r?\n/).map((line) => line.trim());
    const first = lines.find((line) => /^line \d+/i.test(line)) ?? lines.find((line) => /error|failed/i.test(line)) ?? text.trim();
    const show = 'Show Compiler Output';
    void vscode.window.showErrorMessage(`${name} did not compile: ${first}`, show).then(async (choice) => {
      if (choice) {
        await vscode.window.showTextDocument(file);
        await vscode.commands.executeCommand('opencrbasic.openCompilerOutput');
      }
    });
    return false;
  }

  // Sends the program and the library files it includes (found next to it), then compiles and runs
  // it on the logger: `oln flash --no-compile`.
  // `ensureTarget` for a step that cannot go on without a logger.
  private async requireTarget(): Promise<LoggerTarget> {
    const target = await this.ensureTarget();
    if (!target) {
      throw new OlnError('no logger selected');
    }
    return target;
  }

  async sendProgram(uri: vscode.Uri | undefined, options: { build?: boolean; monitor?: boolean } = {}): Promise<void> {
    const file = await this.programFile(uri);
    if (!file || (options.build && !(await this.build(file)))) {
      return;
    }
    const target = await this.ensureTarget();
    if (!target) {
      return;
    }
    const name = loggerFileName(file.fsPath);
    if (options.monitor) {
      await this.stopWatch();
    }
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Sending ${name} and its includes to ${describeTarget(target)}, then running it` },
      () => this.run<FlashResult>(oln.flash(file.fsPath), target),
    );
    this.output.info(`sent ${[...result.includes, result.program].join(', ')}; compile result: ${result.compile_result.trim()}`);
    if (result.skipped.length) {
      void vscode.window.showWarningMessage(`Not sent, no local copy next to ${name}: ${result.skipped.join(', ')}`);
    }
    const includes = result.includes.length ? ` with ${result.includes.length} include file${result.includes.length === 1 ? '' : 's'}` : '';
    if (compileFailed(result.compile_result)) {
      void vscode.window.showErrorMessage(`The logger did not compile ${name}: ${result.compile_result.trim()}`);
    } else {
      void vscode.window.showInformationMessage(`${name}${includes} is running: ${result.compile_result.trim()}`);
    }
    void this.refreshPanel();
    await this.refreshFilled(['station', 'files', 'tables']);
    if (options.monitor) {
      await vscode.commands.executeCommand('openloggernet.public.focus');
      await this.connect();
    }
  }

  async collect(tableName?: string): Promise<void> {
    const target = await this.ensureTarget();
    if (!target) {
      return;
    }
    let table = tableName;
    if (!table) {
      const tables = await this.run<TableInfo[]>(oln.tables(), target);
      const pick = await vscode.window.showQuickPick(
        tables.filter((t) => t.size > 1).map((t) => ({ label: t.name, description: `${t.size} records`, detail: t.fields.map((f) => f.name).join(', ') })),
        { title: 'Table to collect' },
      );
      table = pick?.label;
    }
    if (!table) {
      return;
    }
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const destination = await vscode.window.showSaveDialog({
      defaultUri: folder ? vscode.Uri.joinPath(folder, `${table}.dat`) : undefined,
      filters: { 'TOA5 (LoggerNet .dat)': ['dat'], CSV: ['csv'], 'JSON Lines': ['jsonl'] },
      title: `Collect ${table}`,
    });
    if (!destination) {
      return;
    }
    const format: CollectFormat = destination.fsPath.endsWith('.csv') ? 'csv' : destination.fsPath.endsWith('.jsonl') ? 'jsonl' : 'toa5';
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Collecting ${table}` },
      () => this.run<{ records: number; seconds: number }>(oln.collect(table, destination.fsPath, format), target),
    );
    const open = await vscode.window.showInformationMessage(
      `${result.records} records of ${table} in ${result.seconds.toFixed(1)} s.`,
      'Open',
    );
    if (open) {
      await vscode.window.showTextDocument(destination);
    }
  }

  async showInfo(): Promise<void> {
    const target = await this.ensureTarget();
    if (!target) {
      return;
    }
    const info = await this.run<ProgramInfo>(oln.info(), target);
    void vscode.window.showInformationMessage(
      `${info.model ?? 'Logger'} ${info.serial_number}, OS ${info.os_version}: ${info.program_name || 'no program'} — ${info.compile_result.trim()}`,
    );
  }

  async programAction(action: 'stop' | 'resume'): Promise<void> {
    const target = await this.ensureTarget();
    if (!target) {
      return;
    }
    const info = await this.run<ProgramInfo>(action === 'stop' ? oln.stop(false) : oln.resume(), target);
    void vscode.window.showInformationMessage(`${info.program_name || 'No program'}: ${info.state ?? ''}`);
    void this.refreshPanel();
  }

  async setClock(): Promise<void> {
    const target = await this.ensureTarget();
    if (!target) {
      return;
    }
    const result = await this.run<{ offset: number; offset_after: number }>(oln.setClockUtc(), target);
    void vscode.window.showInformationMessage(
      `Logger clock was ${result.offset.toFixed(3)} s off UTC; now ${result.offset_after.toFixed(3)} s.`,
    );    await this.refreshFilled(['station']);
  }

  // -- side bar --

  private watchEnded(): void {
    void vscode.commands.executeCommand('setContext', 'openloggernet.connected', false);
    this.publicValues = {};
    this.views.public.set(undefined);
  }

  private showPublic(row: WatchRow): void {
    this.views.public.set(publicNodes(row.values, this.publicValues));
    this.publicValues = row.values;
  }

  // Live values hold the serial port until Disconnect; other calls pause them around themselves.
  async connect(): Promise<void> {
    if (!(await this.ensureTarget())) {
      return;
    }
    this.startWatch(PUBLIC, 1);
  }

  async disconnect(): Promise<void> {
    await this.stopWatch();
  }

  // Reads the views that already show something again (after a program change, say).
  private async refreshFilled(ids: ViewId[]): Promise<void> {
    for (const id of ids) {
      if (this.views[id].filled) {
        await this.scan(id);
      }
    }
  }

  async scan(id: ViewId): Promise<void> {
    if (id === 'public') {
      return this.connect();
    }
    const target = await this.ensureTarget();
    if (!target) {
      return;
    }
    const read = async () => {
      switch (id) {
        case 'station': {
          const info = await this.run<ProgramInfo>(oln.info(), target);
          const clock = await this.run<ClockInfo>(oln.clock(), target);
          this.lastInfo = info;
          this.views.station.set(stationNodes(info.port ?? target.port ?? '', info, clock, this.media));
          this.offerOsUpdate(info).catch((err: unknown) => this.notifyError(err));
          if (clockOutOfSync(clock.offset)) {
            this.offerClockSync(clock.offset).catch((err: unknown) => this.notifyError(err));
          }
          return;
        }
        case 'files': {
          const info = await this.run<ProgramInfo>(oln.programStatus(), target);
          const files = await this.run<FileEntry[]>(oln.files(), target);
          this.views.files.set(fileNodes(files, info, this.media));
          return;
        }
        case 'tables':
          this.views.tables.set(tableNodes(await this.run<TableInfo[]>(oln.tables(), target), this.media));
          return;
        case 'settings':
          this.views.settings.set(settingNodes((await this.run<{ settings: SettingRow[] }>(oln.settings(), target)).settings));
          return;
      }
    };
    await vscode.window.withProgress({ location: { viewId: `openloggernet.${id}` } }, read);
  }

  private async offerOsUpdate(info: ProgramInfo): Promise<void> {
    if (!info.os_latest?.outdated || this.osOffered.has(info.serial_number)) {
      return;
    }
    this.osOffered.add(info.serial_number);
    const update = 'Update OS…';
    const choice = await vscode.window.showWarningMessage(
      `The ${info.model ?? 'logger'} (serial ${info.serial_number}) runs ${info.os_version}; OS ${info.os_latest.latest} is available.`,
      update,
    );
    if (choice === update) {
      await this.updateOs();
    }
  }

  private async offerClockSync(offset: number): Promise<void> {
    const sync = 'Sync Clock';
    const choice = await vscode.window.showWarningMessage(`The logger clock is ${describeOffset(offset)} UTC.`, sync);
    if (choice === sync) {
      await this.setClock();
    }
  }

  async updateOs(): Promise<void> {
    const latest = this.lastInfo?.os_latest;
    const download = { label: '$(link-external) Open the download page', detail: latest?.url ?? 'https://www.campbellsci.com/downloads' };
    const send = { label: '$(cloud-upload) Send an OS image (.obj)…', detail: 'Stops the program, loads the new OS, then restarts the program' };
    const pick = await vscode.window.showQuickPick([download, send], {
      title: latest?.latest ? `Update to OS ${latest.latest}` : 'Update the operating system',
    });
    if (pick === download) {
      await vscode.env.openExternal(vscode.Uri.parse(download.detail));
      return;
    }
    if (pick !== send) {
      return;
    }
    const image = await vscode.window.showOpenDialog({ filters: { 'Operating system image': ['obj'] }, title: 'OS image to send' });
    const target = image && (await this.ensureTarget());
    if (!image?.[0] || !target) {
      return;
    }
    const sure = await vscode.window.showWarningMessage(
      `Send ${image[0].fsPath} as the logger's operating system? The program stops while it loads; settings are usually kept but can be reset.`,
      { modal: true },
      'Send OS',
    );
    if (!sure) {
      return;
    }
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Sending the operating system (several minutes)' },
      () => this.run<{ before: string; after: string }>(oln.sendOs(image[0].fsPath), target),
    );
    void vscode.window.showInformationMessage(`OS ${result.before} → ${result.after}`);
    await this.refreshFilled(['station', 'files']);
  }

  // Selected file nodes: the clicked one, or every selected one when it is among them.
  private static selection(node: Node | undefined, nodes: readonly Node[] | undefined): FileEntry[] {
    const picked = nodes?.length && node && nodes.includes(node) ? nodes : node ? [node] : [];
    return picked.map((n) => n.data).filter((d): d is FileEntry => !!d && typeof d === 'object' && 'flags' in d);
  }

  async uploadFiles(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: true,
      defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
      title: 'Files to upload to the logger (CPU:)',
    });
    const target = picked?.length && (await this.ensureTarget());
    if (!picked?.length || !target) {
      return;
    }
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Uploading' }, async (progress) => {
      for (const file of picked) {
        progress.report({ message: file.fsPath, increment: 100 / picked.length });
        await this.run(oln.put(file.fsPath), target);
      }
    });
    await this.scan('files');
  }

  async downloadFiles(node?: Node, nodes?: readonly Node[]): Promise<void> {
    const files = LoggerService.selection(node, nodes);
    const folder = files.length
      ? await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
          openLabel: 'Download here',
          title: `Download ${files.length === 1 ? files[0].name : `${files.length} files`}`,
        })
      : undefined;
    if (!folder?.[0]) {
      return;
    }
    const target = await this.ensureTarget();
    if (!target) {
      return;
    }
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Downloading' }, async (progress) => {
      for (const f of files) {
        progress.report({ message: f.name, increment: 100 / files.length });
        await this.run(oln.get(f.name, vscode.Uri.joinPath(folder[0], f.name.replace(/^[A-Z]+:/, '')).fsPath), target);
      }
    });
    void vscode.window.showInformationMessage(`Downloaded ${files.map((f) => f.name).join(', ')} to ${folder[0].fsPath}`);
  }

  async deleteFiles(node?: Node, nodes?: readonly Node[]): Promise<void> {
    const files = LoggerService.selection(node, nodes);
    if (!files.length) {
      return;
    }
    const running = files.filter((f) => f.flags.includes('running'));
    const sure = await vscode.window.showWarningMessage(
      `Delete ${files.map((f) => f.name).join(', ')} from the logger?${running.length ? ' The running program cannot be deleted while it runs.' : ''}`,
      { modal: true },
      'Delete',
    );
    if (!sure) {
      return;
    }
    await this.run(oln.remove(...files.map((f) => f.name)), await this.requireTarget());
    await this.scan('files');
  }

  async runFile(node?: Node, nodes?: readonly Node[]): Promise<void> {
    const files = LoggerService.selection(node, nodes);
    if (files.length !== 1) {
      void vscode.window.showInformationMessage('Select one program file to run.');
      return;
    }
    const name = files[0].name;
    const sure = await vscode.window.showWarningMessage(
      `Compile and run ${name} on the logger? A program with different tables replaces the old program's data.`,
      { modal: true },
      'Run',
    );
    if (!sure) {
      return;
    }
    const info = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Compiling ${name} on the logger` },
      async () => this.run<ProgramInfo>(oln.run(name), await this.requireTarget()),
    );
    const show = compileFailed(info.compile_result) ? vscode.window.showErrorMessage : vscode.window.showInformationMessage;
    void show(`${name}: ${info.compile_result.trim()}`);
    await this.refreshFilled(['station', 'files', 'tables']);
  }

  // Collects whole tables into the workspace folder as `<station>_<table>.<ext>`. With no names it
  // asks which, every data table preselected.
  async downloadTables(names?: string[]): Promise<void> {
    const target = await this.ensureTarget();
    if (!target) {
      return;
    }
    if (!names) {
      const tables = await this.run<TableInfo[]>(oln.tables(), target);
      const picks = await vscode.window.showQuickPick(
        tables.map((t) => ({ label: t.name, description: `room for ${t.size} record${t.size === 1 ? '' : 's'}`, picked: t.size > 1 })),
        { canPickMany: true, title: 'Data tables to download' },
      );
      names = picks?.map((p) => p.label);
    }
    if (!names?.length) {
      return;
    }
    const format = await vscode.window.showQuickPick(TABLE_FORMATS, { title: `Download ${names.length} table${names.length === 1 ? '' : 's'} as` });
    const folder = format && (vscode.workspace.workspaceFolders?.[0]?.uri ?? (await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true }))?.[0]);
    if (!format || !folder) {
      return;
    }
    const station = this.lastInfo?.station_name
      ?? (await this.run<{ values?: string[] }[]>(['get', 'Status.StationName'], target))[0]?.values?.[0]
      ?? '';
    const done: string[] = [];
    let records = 0;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Downloading tables', cancellable: true }, async (progress, token) => {
      for (const table of names) {
        if (token.isCancellationRequested) {
          break;
        }
        progress.report({ message: table, increment: 100 / names.length });
        const file = vscode.Uri.joinPath(folder, tableFileName(station, table, format.extension));
        const result = await this.run<{ records: number }>(oln.collect(table, file.fsPath, format.format as CollectFormat), target);
        records += result.records;
        done.push(file.path.slice(file.path.lastIndexOf('/') + 1));
      }
    });
    const reveal = 'Reveal';
    const choice = await vscode.window.showInformationMessage(`${records} records in ${done.join(', ')}`, reveal);
    if (choice && done.length) {
      await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.joinPath(folder, done[0]));
    }
  }

  async setVariable(node?: Node): Promise<void> {
    const name = typeof node?.data === 'string' ? node.data : undefined;
    if (!name) {
      return;
    }
    const current = this.publicValues[name];
    const value = typeof current === 'boolean'
      ? (await vscode.window.showQuickPick(['true', 'false'], { title: `Public.${name}` }))
      : await vscode.window.showInputBox({ title: `Public.${name}`, value: String(current ?? ''), prompt: 'New value; whole numbers are written as Long, others as IEEE4' });
    if (value === undefined || value === '') {
      return;
    }
    await this.run(oln.setValue(`${PUBLIC}.${name}`, value), await this.requireTarget());
  }

  async editSetting(node?: Node): Promise<void> {
    const setting = node?.data as SettingRow | undefined;
    if (!setting || setting.read_only) {
      return;
    }
    const key = setting.name || String(setting.id);
    const value = setting.type === 'Boolean'
      ? await vscode.window.showQuickPick(['True', 'False'], { title: key })
      : await vscode.window.showInputBox({
          title: `Setting ${key}`,
          value: String(setting.value ?? ''),
          prompt: [setting.type, setting.range && `range ${setting.range}`].filter(Boolean).join(', ') || undefined,
          password: /password|privatekey|encryptionkey/i.test(key),
        });
    if (value === undefined) {
      return;
    }
    await this.run(oln.setSetting(key, value), await this.requireTarget());
    setting.value = value;
    this.views.settings.set(settingNodes(this.settingsOf()));
  }

  private settingsOf(): SettingRow[] {
    return this.views.settings.getChildren().map((n) => n.data as SettingRow);
  }

  // -- panel --

  openPanel(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(`${SECTION}.panel`, 'Logger', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    this.panel = panel;
    panel.webview.html = renderPanel(randomBytes(16).toString('base64'), panel.webview.cspSource);
    panel.onDidDispose(() => {
      this.panel = undefined;
      void this.stopWatch(false);
    });
    panel.webview.onDidReceiveMessage((message: unknown) => {
      const request = parseRequest(message);
      if (request) {
        void this.handle(request).catch((err: unknown) => this.report(err));
      }
    });
  }

  private post(message: Record<string, unknown>): void {
    void this.panel?.webview.postMessage(message);
  }

  // For actions started from a notification button: they run outside the command guard.
  private notifyError(err: unknown): void {
    this.report(err);
    void vscode.window.showErrorMessage(`Logger: ${err instanceof Error ? err.message : String(err)}`);
  }

  private report(err: unknown): void {
    const text = err instanceof Error ? err.message : String(err);
    this.output.error(text);
    this.post({ type: 'error', text });
  }

  private async refreshPanel(): Promise<void> {
    if (!this.panel) {
      return;
    }
    try {
      const ports = await this.run<LoggerPort[]>(oln.ports(), undefined);
      let target = this.target();
      if (!target.port && ports.length) {
        target = { port: ports[0].port };
        await this.context.workspaceState.update(PORT_STATE, target.port);
      }
      this.post({ type: 'ports', ports, selected: target.port });
      if (!target.port) {
        this.post({ type: 'error', text: 'No logger attached' });
        return;
      }
      this.post({ type: 'busy', text: `Reading ${target.port}…` });
      const info = await this.run<ProgramInfo>(oln.programStatus(), target);
      this.post({ type: 'info', info });
      this.post({ type: 'tables', tables: await this.run<TableInfo[]>(oln.tables(), target) });
      this.post({ type: 'files', files: await this.run<FileEntry[]>(oln.files(), target) });
      this.post({ type: 'busy', text: `${info.model ?? ''} ${info.serial_number} on ${target.port}` });
    } catch (err) {
      this.report(err);
    }
  }

  private async handle(request: PanelRequest): Promise<void> {
    const target = this.target();
    switch (request.type) {
      case 'ready':
      case 'refresh':
        return this.refreshPanel();
      case 'selectLogger':
        await this.setPort(request.port);
        return this.refreshPanel();
      case 'collect':
        return this.collect(request.table);
      case 'watchStart':
        return this.startWatch(request.table, request.interval);
      case 'watchStop':
        return this.stopWatch();
      case 'filePut': {
        const picked = await vscode.window.showOpenDialog({ canSelectMany: false, title: 'File to send to the logger' });
        if (picked?.[0]) {
          await this.run(oln.put(picked[0].fsPath), target);
          this.post({ type: 'files', files: await this.run<FileEntry[]>(oln.files(), target) });
        }
        return;
      }
      case 'fileGet': {
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
        const local = request.name.split(':').pop() ?? request.name;
        const destination = await vscode.window.showSaveDialog({
          defaultUri: folder ? vscode.Uri.joinPath(folder, local) : undefined,
          title: `Save ${request.name}`,
        });
        if (destination) {
          await this.run(oln.get(request.name, destination.fsPath), target);
          this.post({ type: 'busy', text: `${request.name} saved` });
        }
        return;
      }
      case 'fileDelete': {
        const sure = await vscode.window.showWarningMessage(`Delete ${request.name} from the logger?`, { modal: true }, 'Delete');
        if (sure) {
          await this.run(oln.remove(request.name), target);
          this.post({ type: 'files', files: await this.run<FileEntry[]>(oln.files(), target) });
        }
        return;
      }
      case 'fileRun': {
        const sure = await vscode.window.showWarningMessage(
          `Compile and run ${request.name}? A program with different tables replaces the old program's data.`,
          { modal: true },
          'Run',
        );
        if (sure) {
          const info = await this.run<ProgramInfo>(oln.run(request.name), target);
          this.post({ type: 'info', info });
          this.post({ type: 'files', files: await this.run<FileEntry[]>(oln.files(), target) });
          this.post({ type: 'tables', tables: await this.run<TableInfo[]>(oln.tables(), target) });
        }
        return;
      }
      case 'stop':
      case 'resume': {
        const info = await this.run<ProgramInfo>(request.type === 'stop' ? oln.stop(request.deleteData) : oln.resume(), target);
        this.post({ type: 'info', info });
        this.post({ type: 'files', files: await this.run<FileEntry[]>(oln.files(), target) });
        return;
      }
      case 'clockCheck':
      case 'clockSet': {
        const result = await this.run<{ logger: string; host: string; offset: number; logger_after?: string; offset_after?: number }>(
          request.type === 'clockSet' ? oln.setClockUtc() : oln.clock(),
          target,
        );
        this.post({
          type: 'clock',
          logger: result.logger_after ?? result.logger,
          host: result.host,
          offset: result.offset_after ?? result.offset,
        });
        return;
      }
      case 'terminal': {
        const result = await this.run<{ output: string }>(oln.terminal(request.text), target);
        this.post({ type: 'terminal', text: result.output.replace(/\r\n?/g, '\n') });
        return;
      }
    }
  }
}

export function registerLogger(context: vscode.ExtensionContext, output: vscode.LogOutputChannel, compile: Compile): void {
  const service = new LoggerService(context, output, compile);
  const guard = <A extends unknown[]>(action: (...args: A) => Promise<unknown> | void) => async (...args: A) => {
    try {
      await action(...args);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      output.error(text);
      void vscode.window.showErrorMessage(`Logger: ${text}`);
    }
  };
  const command = <A extends unknown[]>(name: string, action: (...args: A) => Promise<unknown> | void) =>
    vscode.commands.registerCommand(`${SECTION}.${name}`, guard(action));
  context.subscriptions.push(
    service,
    ...VIEW_IDS.map((id) =>
      vscode.window.createTreeView(`${SECTION}.${id}`, { treeDataProvider: service.views[id], canSelectMany: id === 'files', showCollapseAll: false }),
    ),
    command('openPanel', () => service.openPanel()),
    command('selectLogger', () => service.selectLogger()),
    command('showInfo', () => service.showInfo()),
    command('build', (uri?: vscode.Uri) => service.build(uri)),
    command('sendProgram', (uri?: vscode.Uri) => service.sendProgram(uri)),
    command('buildSendRun', (uri?: vscode.Uri) => service.sendProgram(uri, { build: true })),
    command('buildSendRunMonitor', (uri?: vscode.Uri) => service.sendProgram(uri, { build: true, monitor: true })),
    command('collect', () => service.collect()),
    command('downloadTables', () => service.downloadTables()),
    command('downloadTable', (node?: Node) => service.downloadTables(node ? [(node.data as TableInfo).name] : undefined)),
    command('downloadAllTables', () =>
      service.downloadTables(service.views.tables.getChildren().map((n) => n.data as TableInfo).filter((t) => t.size > 1).map((t) => t.name)),
    ),
    command('stopProgram', () => service.programAction('stop')),
    command('resumeProgram', () => service.programAction('resume')),
    command('setClock', () => service.setClock()),
    command('updateOs', () => service.updateOs()),
    ...VIEW_IDS.filter((id) => id !== 'public').map((id) => command(`scan.${id}`, () => service.scan(id))),
    command('connect', () => service.connect()),
    command('disconnect', () => service.disconnect()),
    command('uploadFiles', () => service.uploadFiles()),
    command('downloadFiles', (node?: Node, nodes?: readonly Node[]) => service.downloadFiles(node, nodes)),
    command('deleteFiles', (node?: Node, nodes?: readonly Node[]) => service.deleteFiles(node, nodes)),
    command('runFile', (node?: Node, nodes?: readonly Node[]) => service.runFile(node, nodes)),
    command('setVariable', (node?: Node) => service.setVariable(node)),
    command('editSetting', (node?: Node) => service.editSetting(node)),
  );
}
