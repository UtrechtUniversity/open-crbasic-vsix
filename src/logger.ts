// Logger actions backed by open-loggernet's `oln` command line: palette commands and the Logger
// panel. Only one program can hold a logger's serial port, so every `oln` call goes through one
// queue, and a running watch is paused while another call needs the port.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import {
  LineBuffer,
  OlnError,
  commands as oln,
  compileFailed,
  describeTarget,
  loggerFileName,
  olnArgs,
  parseResult,
  parseWatchLine,
  type CollectFormat,
  type FileEntry,
  type LoggerPort,
  type LoggerTarget,
  type ProgramInfo,
  type TableInfo,
} from './loggerCli';
import { parseRequest, renderPanel, type PanelRequest } from './loggerPanel';

const SECTION = 'openloggernet';
const PORT_STATE = `${SECTION}.port`;
const INSTALL_HINT = 'Install open-loggernet (`uv tool install openloggernet`) or set openloggernet.command.';

interface Watch {
  table: string;
  interval: number;
  process: ChildProcess;
}

export class LoggerService implements vscode.Disposable {
  private queue: Promise<unknown> = Promise.resolve();
  private watch: Watch | undefined;
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.LogOutputChannel,
  ) {}

  dispose(): void {
    this.watch?.process.kill();
    this.panel?.dispose();
  }

  // -- running oln --

  private command(): string[] {
    const configured = vscode.workspace.getConfiguration(SECTION).get<string[]>('command', ['oln']);
    return configured.length ? configured : ['oln'];
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
    void this.stopWatch(false);
    const child = this.spawnOln(olnArgs(this.target(), oln.watch(table, interval)));
    const lines = new LineBuffer();
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of lines.push(chunk.toString())) {
        const row = parseWatchLine(line);
        if (row) {
          void this.panel?.webview.postMessage({ type: 'watch', row });
        }
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', () => {
      if (this.watch?.process === child) {
        this.watch = undefined;
        void this.panel?.webview.postMessage({ type: 'watchState', running: false });
        if (stderr.trim()) {
          void this.panel?.webview.postMessage({ type: 'error', text: stderr.trim().replace(/^oln: /, '') });
        }
      }
    });
    this.watch = { table, interval, process: child };
    void this.panel?.webview.postMessage({ type: 'watchState', running: true, table });
  }

  private stopWatch(notify = true): Promise<void> {
    const current = this.watch;
    if (!current) {
      return Promise.resolve();
    }
    this.watch = undefined;
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
      ports.map((p) => ({ label: p.model ?? '?', description: p.port, detail: p.description, port: p.port })),
      { title: 'Logger to use' },
    );
    if (!pick) {
      return undefined;
    }
    await this.context.workspaceState.update(PORT_STATE, pick.port);
    return { port: pick.port };
  }

  // A logger is chosen once and remembered; with exactly one attached it is used without asking.
  async ensureTarget(): Promise<LoggerTarget | undefined> {
    const current = this.target();
    if (current.port) {
      return current;
    }
    const ports = await this.run<LoggerPort[]>(oln.ports(), undefined);
    if (ports.length === 1) {
      await this.context.workspaceState.update(PORT_STATE, ports[0].port);
      return { port: ports[0].port };
    }
    return this.selectLogger();
  }

  async sendProgram(uri: vscode.Uri | undefined): Promise<void> {
    const file = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!file || file.scheme !== 'file') {
      void vscode.window.showInformationMessage('Open a CRBasic program to send it to the logger.');
      return;
    }
    await vscode.workspace.save(file);
    const target = await this.ensureTarget();
    if (!target) {
      return;
    }
    const name = loggerFileName(file.fsPath);
    const info = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Sending ${name} to ${describeTarget(target)}` },
      async (progress) => {
        await this.run(oln.put(file.fsPath, name), target);
        progress.report({ message: 'compiling on the logger' });
        return this.run<ProgramInfo>(oln.run(name), target);
      },
    );
    this.output.info(`compile result: ${info.compile_result.trim()}`);
    if (compileFailed(info.compile_result)) {
      void vscode.window.showErrorMessage(`The logger did not compile ${name}: ${info.compile_result.trim()}`);
    } else {
      void vscode.window.showInformationMessage(`${name} is running: ${info.compile_result.trim()}`);
    }
    void this.refreshPanel();
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
    );
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
        await this.stopWatch();
        await this.context.workspaceState.update(PORT_STATE, request.port);
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

export function registerLogger(context: vscode.ExtensionContext, output: vscode.LogOutputChannel): void {
  const service = new LoggerService(context, output);
  const guard = (action: () => Promise<unknown> | void) => async () => {
    try {
      await action();
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      output.error(text);
      void vscode.window.showErrorMessage(`Logger: ${text}`);
    }
  };
  context.subscriptions.push(
    service,
    vscode.commands.registerCommand(`${SECTION}.openPanel`, guard(() => service.openPanel())),
    vscode.commands.registerCommand(`${SECTION}.selectLogger`, guard(() => service.selectLogger())),
    vscode.commands.registerCommand(`${SECTION}.showInfo`, guard(() => service.showInfo())),
    vscode.commands.registerCommand(`${SECTION}.sendProgram`, (uri?: vscode.Uri) => guard(() => service.sendProgram(uri))()),
    vscode.commands.registerCommand(`${SECTION}.collect`, guard(() => service.collect())),
    vscode.commands.registerCommand(`${SECTION}.stopProgram`, guard(() => service.programAction('stop'))),
    vscode.commands.registerCommand(`${SECTION}.resumeProgram`, guard(() => service.programAction('resume'))),
    vscode.commands.registerCommand(`${SECTION}.setClock`, guard(() => service.setClock())),
  );
}
