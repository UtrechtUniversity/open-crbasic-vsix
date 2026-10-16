import * as vscode from 'vscode';
import {
  LanguageClient,
  type LanguageClientOptions,
  ExecuteCommandRequest,
  type MessageSignature,
  type ServerOptions,
  Trace,
  TransportKind,
} from 'vscode-languageclient/node';
import { canNotify, planConfigurationChange } from './configChange';
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
  type LaunchSettings,
  type ServerSettings,
} from './serverOptions';

const SECTION = 'opencrbasic';
const LANGUAGE_ID = 'crbasic';
const RESTART_KEYS = [
  `${SECTION}.pythonPath`,
  `${SECTION}.serverArgs`,
  `${SECTION}.serverEnv`,
];
const TRACE_KEY = `${SECTION}.trace.server`;
const CONFIGURATION_NOTIFICATION = 'workspace/didChangeConfiguration';

let output: vscode.LogOutputChannel | undefined;
const lifecycle = new ClientLifecycle<LanguageClient>({
  create: createClient,
  afterStart: () => applyTrace(),
  onStartError: (err) => {
    const message = err instanceof Error ? err.message : String(err);
    output?.error(`server failed to start: ${message}`);
    void vscode.window.showErrorMessage(`opencrbasic: language server failed to start (${message})`);
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
  void restartClient();
}

export function deactivate(): Thenable<void> {
  return lifecycle.deactivate();
}

function restartClient(): Promise<void> {
  return lifecycle.restart();
}

class RestartableLanguageClient extends LanguageClient {
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

function readLaunchSettings(config: vscode.WorkspaceConfiguration): LaunchSettings {
  return {
    pythonPath: config.get<string>('pythonPath', 'python3'),
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
