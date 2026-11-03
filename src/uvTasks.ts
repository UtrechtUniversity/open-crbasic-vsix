// uv installs run as visible VS Code tasks, shared by the language server and the logger tools.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { findUv, uvInstaller } from './serverOptions';

export function locateUv(): string | undefined {
  return findUv(process.env, process.platform, homedir(), existsSync);
}

// No shell between: arguments such as `opencrbasic[lsp]` reach the process unquoted and unglobbed.
export function runTask(name: string, command: string, args: string[]): Promise<number | undefined> {
  const task = new vscode.Task(
    { type: 'process', task: name },
    vscode.TaskScope.Global,
    name,
    'opencrbasic',
    new vscode.ProcessExecution(command, args),
  );
  return new Promise((resolve, reject) => {
    const ended = vscode.tasks.onDidEndTaskProcess((event) => {
      if (event.execution.task === task) {
        ended.dispose();
        resolve(event.exitCode);
      }
    });
    vscode.tasks.executeTask(task).then(undefined, (err: unknown) => {
      ended.dispose();
      reject(err);
    });
  });
}

// The uv executable, running Astral's installer first when uv is missing. Throws when that fails.
export async function ensureUv(uv: string | undefined): Promise<string> {
  if (uv) {
    return uv;
  }
  const installer = uvInstaller(process.platform);
  if ((await runTask('install uv', installer.command, installer.args)) !== 0) {
    throw new Error('installing uv failed');
  }
  const installed = locateUv();
  if (!installed) {
    throw new Error('uv was installed but not found');
  }
  return installed;
}

// Runs `uv <args>` as a task; throws `what` unless it exits 0.
export async function runUv(uv: string, name: string, args: string[], what: string): Promise<void> {
  if ((await runTask(name, uv, args)) !== 0) {
    throw new Error(what);
  }
}
