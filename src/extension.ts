import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import * as vscode from 'vscode';
import {
  CloseAction,
  type ErrorHandler,
  LanguageClient,
  type LanguageClientOptions,
  ExecuteCommandRequest,
  type MessageSignature,
  type ServerOptions,
  Trace,
  TransportKind,
} from 'vscode-languageclient/node';
import { canNotify, planConfigurationChange } from './configChange';
import { registerLogger } from './logger';
import { ClientLifecycle, handleRequestFailure } from './clientLifecycle';
import {
  OUTPUT_COMMANDS,
  OUTPUT_SCHEME,
  type OutputKind,
  buildOutputUri,
  failureText,
  parseOutputQuery,
} from './outputCommands';
import {
  buildServerLaunch,
  initializationOptions,
  MIN_SERVER_VERSION,
  olderThan,
  resolvePythonPath,
  uvToolPython,
  type LaunchSettings,
  type ServerSettings,
} from './serverOptions';
import { ensureUv, locateUv, runUv } from './uvTasks';

const SECTION = 'opencrbasic';
const LANGUAGE_ID = 'crbasic';
const RESTART_KEYS = [
  `${SECTION}.pythonPath`,
  `${SECTION}.serverArgs`,
  `${SECTION}.serverEnv`,
];
const TRACE_KEY = `${SECTION}.trace.server`;
const CONFIGURATION_NOTIFICATION = 'workspace/didChangeConfiguration';
const INSTALL_ACTION = 'Install server with uv';
const INSTALL_UV_ACTION = 'Install uv and server';
const UPGRADE_ACTION = 'Upgrade server with uv';
const RETRY_ACTION = 'Retry';
const GUIDE_ACTION = 'Setup guide';
const GUIDE_URL = 'https://github.com/UtrechtUniversity/open-crbasic-vsix#readme';

let output: vscode.LogOutputChannel | undefined;
const lifecycle = new ClientLifecycle<LanguageClient>({
  create: createClient,
  afterStart: async (client) => {
    await applyTrace();
    void offerUpgrade(client.initializeResult?.serverInfo?.version);
  },
  onStartError: (err) => {
    const message = err instanceof Error ? err.message : String(err);
    output?.error(`server failed to start: ${message}`);
    void offerInstall(message);
  },
  onStopError: (err) => {
    output?.warn(`stopping previous server: ${err instanceof Error ? err.message : String(err)}`);
  },
});

// Content of the read-only output documents: the server command's answer for the document named
// in the uri, requested again whenever a command is run for it.
const outputChanged = new vscode.EventEmitter<vscode.Uri>();
const outputProvider: vscode.TextDocumentContentProvider = {
  onDidChange: outputChanged.event,
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const target = parseOutputQuery(uri.query);
    if (!target) {
      return '';
    }
    const command = OUTPUT_COMMANDS[target.kind];
    const current = lifecycle.client;
    if (!current || !current.isRunning()) {
      return failureText(command, 'The language server is not running.');
    }
    try {
      const text = await current.sendRequest(ExecuteCommandRequest.type, {
        command: command.serverCommand,
        arguments: [target.source],
      });
      return typeof text === 'string' ? text : '';
    } catch (err) {
      output?.warn(`${command.serverCommand}: ${err instanceof Error ? err.message : String(err)}`);
      return failureText(command, err);
    }
  },
};

async function openOutput(kind: OutputKind): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== LANGUAGE_ID || editor.document.uri.scheme !== 'file') {
    void vscode.window.showInformationMessage(
      `${OUTPUT_COMMANDS[kind].title}: open a CRBasic file first.`,
    );
    return;
  }
  const virtual = vscode.Uri.parse(buildOutputUri(kind, editor.document.uri.toString()), true);
  outputChanged.fire(virtual);
  const document = await vscode.workspace.openTextDocument(virtual);
  await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.Beside,
    preserveFocus: true,
    preview: true,
  });
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel(SECTION, { log: true });
  context.subscriptions.push(
    output,
    vscode.commands.registerCommand(`${SECTION}.restartServer`, () => restartClient()),
    vscode.workspace.registerTextDocumentContentProvider(OUTPUT_SCHEME, outputProvider),
    ...(Object.keys(OUTPUT_COMMANDS) as OutputKind[]).map((kind) =>
      vscode.commands.registerCommand(OUTPUT_COMMANDS[kind].clientCommand, () => openOutput(kind)),
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      const plan = planConfigurationChange({
        restartKeys: RESTART_KEYS.some((key) => event.affectsConfiguration(key)),
        section: event.affectsConfiguration(SECTION),
        trace: event.affectsConfiguration(TRACE_KEY),
      });
      if (plan.restart) {
        void restartClient();
      }
      if (plan.applyTrace) {
        void applyTrace();
      }
      if (plan.notify) {
        void notifySettings();
      }
    }),
  );
  registerLogger(context, output);
  void restartClient();
}

export function deactivate(): Thenable<void> {
  return lifecycle.deactivate();
}

// The install is offered only when nothing points at a server: no pythonPath set and no uv tool
// install. One offer or install at a time: a start that fails while one is pending, or while the
// install runs, adds no second notification, so the install cannot be started twice.
let installPending = false;
async function offerInstall(message: string): Promise<void> {
  const config = vscode.workspace.getConfiguration(SECTION);
  const offer = configuredPythonPath(config) === undefined && !existsSync(uvToolPython(process.env, process.platform, homedir()));
  if (offer && installPending) {
    return;
  }
  installPending = offer;
  try {
    const uv = offer ? locateUv() : undefined;
    const install = uv ? INSTALL_ACTION : INSTALL_UV_ACTION;
    const actions = offer ? [install, GUIDE_ACTION] : [GUIDE_ACTION];
    const text = !offer
      ? `opencrbasic: language server failed to start (${message}). Check opencrbasic.pythonPath.`
      : uv
        ? 'opencrbasic: the language server is not installed. Install it with uv (`uv tool install "opencrbasic[lsp]"`)?'
        : 'opencrbasic: the language server is not installed, and neither is uv. Download and run the uv installer from astral.sh, then install the server with uv?';
    const choice = await vscode.window.showErrorMessage(text, ...actions);
    if (choice === install) {
      await installServer(uv);
    } else if (choice === GUIDE_ACTION) {
      await vscode.env.openExternal(vscode.Uri.parse(GUIDE_URL));
    }
  } finally {
    installPending = false;
  }
}

// Once per session: a server older than this extension expects still starts, without the newer features.
let upgradeOffered = false;
async function offerUpgrade(version: string | undefined): Promise<void> {
  if (upgradeOffered || !olderThan(version, MIN_SERVER_VERSION)) {
    return;
  }
  upgradeOffered = true;
  const config = vscode.workspace.getConfiguration(SECTION);
  const uvTool = configuredPythonPath(config) === undefined && existsSync(uvToolPython(process.env, process.platform, homedir()));
  const uv = uvTool ? locateUv() : undefined;
  const text = `opencrbasic: the language server is version ${version}; this extension expects ${MIN_SERVER_VERSION} or later.`;
  if (!uv) {
    const choice = await vscode.window.showWarningMessage(
      `${text} Upgrade opencrbasic in the environment of opencrbasic.pythonPath.`,
      GUIDE_ACTION,
    );
    if (choice) {
      await vscode.env.openExternal(vscode.Uri.parse(GUIDE_URL));
    }
    return;
  }
  if ((await vscode.window.showWarningMessage(text, UPGRADE_ACTION)) !== UPGRADE_ACTION) {
    return;
  }
  try {
    await runUv(uv, 'upgrade opencrbasic', ['tool', 'upgrade', 'opencrbasic'], 'upgrading the server with uv failed');
  } catch (err) {
    return installFailed(err);
  }
  output?.info('opencrbasic upgraded with uv; restarting the server');
  await restartClient();
}

// Installs uv first when it is missing, then the server, each as a visible task. Success is uv's
// exit status and the interpreter existing where the extension looks for it; then the server
// restarts. A failure says so and offers to try again.
async function installServer(uv: string | undefined): Promise<void> {
  const python = uvToolPython(process.env, process.platform, homedir());
  try {
    const found = await ensureUv(uv);
    await runUv(found, 'install opencrbasic', ['tool', 'install', 'opencrbasic[lsp]'], 'installing the server with uv failed');
    if (!existsSync(python)) {
      throw new Error(`uv installed the server, but not at ${python}; set opencrbasic.pythonPath to its interpreter`);
    }
  } catch (err) {
    return installFailed(err, () => installServer(locateUv()));
  }
  output?.info('opencrbasic installed with uv; restarting the server');
  await restartClient();
}

async function installFailed(err: unknown, retry?: () => Promise<void>): Promise<void> {
  const what = err instanceof Error ? err.message : String(err);
  output?.error(what);
  const actions = retry ? [RETRY_ACTION, GUIDE_ACTION] : [GUIDE_ACTION];
  const choice = await vscode.window.showErrorMessage(`opencrbasic: ${what}; see the task output.`, ...actions);
  if (choice === RETRY_ACTION && retry) {
    await retry();
  } else if (choice === GUIDE_ACTION) {
    await vscode.env.openExternal(vscode.Uri.parse(GUIDE_URL));
  }
}

function restartClient(): Promise<void> {
  return lifecycle.restart();
}

// A server that fails to start is reported once, by onStartError with its install offer: while
// starting, the client's own notifications go only to the output channel and it does not retry.
// Crashes after a successful start keep the client's default notifications and restarts.
class RestartableLanguageClient extends LanguageClient {
  private starting = false;

  override async start(): Promise<void> {
    this.starting = true;
    try {
      await super.start();
    } finally {
      this.starting = false;
    }
    // vscode-languageclient 10.1.2 resolves start() when the connection closes without restart
    // during startup (it clears its start promise), so a server that exited is detected here.
    if (!this.isRunning()) {
      throw new Error('the server process exited during startup; see the opencrbasic output');
    }
  }

  override error(message: string, data?: unknown, showNotification: boolean | 'force' = true): void {
    super.error(message, data, this.starting ? false : showNotification);
  }

  override createDefaultErrorHandler(maxRestartCount?: number): ErrorHandler {
    const base = super.createDefaultErrorHandler(maxRestartCount);
    return {
      error: (error, message, count) => base.error(error, message, count),
      closed: () => (this.starting ? { action: CloseAction.DoNotRestart, handled: true } : base.closed()),
    };
  }

  override handleFailedRequest<T>(
    type: MessageSignature,
    token: vscode.CancellationToken | undefined,
    error: unknown,
    defaultValue: T,
    showNotification = true,
    throwOnCancel = false,
  ): T {
    return handleRequestFailure(this, defaultValue, () =>
      super.handleFailedRequest(type, token, error, defaultValue, showNotification, throwOnCancel),
    );
  }
}

function createClient(): LanguageClient {
  const config = vscode.workspace.getConfiguration(SECTION);
  const launch = buildServerLaunch(readLaunchSettings(config), process.env);
  const serverOptions: ServerOptions = {
    command: launch.command,
    args: launch.args,
    transport: TransportKind.stdio,
    options: { env: launch.env },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: LANGUAGE_ID }],
    // No `synchronize.configurationSection`: the client's own sync would also notify a client that
    // is being replaced (H-02). Changes reach the running client through notifySettings.
    // Read at each (re)start, so a restart always sends current settings.
    // Without it the client shows the bare initialization error in a notification of its own.
    initializationFailedHandler: () => false,
    initializationOptions: () =>
      initializationOptions(readServerSettings(vscode.workspace.getConfiguration(SECTION))),
    outputChannel: output,
    traceOutputChannel: output,
  };
  return new RestartableLanguageClient(SECTION, SECTION, serverOptions, clientOptions);
}

// The server pulls its settings on each notification (`settings: null`), so none are sent here.
async function notifySettings(): Promise<void> {
  const current = lifecycle.client;
  if (!current || !canNotify(current)) {
    return;
  }
  try {
    await current.sendNotification(CONFIGURATION_NOTIFICATION, { settings: null });
  } catch (err) {
    output?.warn(`sending settings change: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function applyTrace(): Promise<void> {
  const current = lifecycle.client;
  if (!current) {
    return;
  }
  const value = vscode.workspace.getConfiguration(SECTION).get<string>('trace.server', 'off');
  const trace = value === 'verbose' ? Trace.Verbose : value === 'messages' ? Trace.Messages : Trace.Off;
  try {
    await current.setTrace(trace);
  } catch (err) {
    output?.warn(`setting trace: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// The value a user or workspace set, not the manifest default.
function configuredPythonPath(config: vscode.WorkspaceConfiguration): string | undefined {
  const value = config.inspect<string>('pythonPath');
  return value?.workspaceFolderValue ?? value?.workspaceValue ?? value?.globalValue;
}

function readLaunchSettings(config: vscode.WorkspaceConfiguration): LaunchSettings {
  return {
    pythonPath: resolvePythonPath(
      configuredPythonPath(config),
      uvToolPython(process.env, process.platform, homedir()),
      existsSync,
    ),
    serverArgs: config.get<string[]>('serverArgs', ['-m', 'opencrbasic.lsp']),
    serverEnv: config.get<Record<string, string>>('serverEnv', {}),
  };
}

function readServerSettings(config: vscode.WorkspaceConfiguration): ServerSettings {
  return {
    entries: config.get<string[]>('entries', ['**/*.CR6']),
    exclude: config.get<string[]>('exclude', []),
    logger: config.get<string>('logger', 'cr6'),
    encoding: config.get<string>('encoding', 'utf-8'),
    debounceMs: config.get<number>('debounceMs', 300),
    analysisTimeoutMs: config.get<number>('analysisTimeoutMs', 10000),
    maxFileBytes: config.get<number>('maxFileBytes', 2097152),
    maxQueuedJobs: config.get<number>('maxQueuedJobs', 64),
    maxCacheMb: config.get<number>('maxCacheMb', 256),
    helpDirectory: config.get<string>('helpDirectory', ''),
    inlayHints: { parameterNames: config.get<boolean>('inlayHints.parameterNames', true) },
  };
}
