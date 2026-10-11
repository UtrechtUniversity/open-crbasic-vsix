// Pure stop policy for a LanguageClient. No `vscode` import: node:test loads this module directly.

export interface StoppableClient {
  isRunning(): boolean;
  stop(): Promise<void>;
  dispose(): unknown;
}

// vscode-languageclient 10.1.2 rejects stop() unless the client is Running ("Client is not running
// and can't be stopped"), and dispose() calls stop() and returns that rejection. A client that is
// not running is therefore dropped: dispose() is attempted and any rejection from it is ignored.
// A stop() failure on a running client is rethrown for the caller to report.
export async function stopLanguageClient(client: StoppableClient): Promise<'stopped' | 'dropped'> {
  if (client.isRunning()) {
    await client.stop();
    return 'stopped';
  }
  try {
    await client.dispose();
  } catch {
    // The client never reached Running (or already stopped); there is nothing else to release.
  }
  return 'dropped';
}
