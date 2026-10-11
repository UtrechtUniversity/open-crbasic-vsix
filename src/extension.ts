import * as vscode from 'vscode';
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  Trace,
  TransportKind,
} from 'vscode-languageclient/node';
import { canNotify, planConfigurationChange } from './configChange';
import { stopLanguageClient } from './clientStop';
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
let client: LanguageClient | undefined;
// Restarts are serialized so overlapping settings changes cannot start two servers.
let restartQueue: Promise<void> = Promise.resolve();

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel(SECTION, { log: true });
  context.subscriptions.push(
    output,
    vscode.commands.registerCommand(`${SECTION}.restartServer`, () => restartClient()),
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

export function deactivate(): Thenable<void> | undefined {
  return stopClient();
}

function restartClient(): Promise<void> {
  restartQueue = restartQueue.then(replaceClient, replaceClient);
  return restartQueue;
}

async function replaceClient(): Promise<void> {
  await stopClient();
  const next = createClient();
  client = next;
  try {
    await next.start();
    await applyTrace();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    output?.error(`server failed to start: ${message}`);
    void vscode.window.showErrorMessage(`opencrbasic: language server failed to start (${message})`);
  }
}

async function stopClient(): Promise<void> {
  const previous = client;
  client = undefined;
  if (!previous) {
    return;
  }
  try {
    await stopLanguageClient(previous);
  } catch (err) {
    output?.warn(`stopping previous server: ${err instanceof Error ? err.message : String(err)}`);
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
  return new LanguageClient(SECTION, SECTION, serverOptions, clientOptions);
}

// The server pulls its settings on each notification (`settings: null`), so none are sent here.
async function notifySettings(): Promise<void> {
  const current = client;
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
  const current = client;
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
    helpDirectory: config.get<string>('helpDirectory', ''),
  };
}
