// Pure decision for an `opencrbasic` configuration change. No `vscode` import: node:test loads this module directly.

export interface ConfigChange {
  // pythonPath, serverArgs or serverEnv changed: the server process is replaced.
  restartKeys: boolean;
  // Any `opencrbasic.*` key changed.
  section: boolean;
  // trace.server changed.
  trace: boolean;
}

export interface ConfigPlan {
  restart: boolean;
  applyTrace: boolean;
  // Tell the current client that settings changed. Only a running client is told: see canNotify.
  notify: boolean;
}

// A restart already reads every setting (initializationOptions at start, then the server pulls
// `workspace/configuration` on `initialized`). Notifying the client being replaced is what raced
// with its stop in H-02, so a restart plans no notification.
export function planConfigurationChange(change: ConfigChange): ConfigPlan {
  if (change.restartKeys) {
    return { restart: true, applyTrace: false, notify: false };
  }
  return { restart: false, applyTrace: change.trace, notify: change.section };
}

// vscode-languageclient rejects sendNotification unless the client is Running, and its sync
// feature starts a client when it is Starting, which races a concurrent stop. A client that is not
// running is skipped: a client that is starting pulls the current settings on `initialized`.
export function canNotify(client: { isRunning(): boolean } | undefined): boolean {
  return client !== undefined && client.isRunning();
}
