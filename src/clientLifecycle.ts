// Serialized start/stop of the language client. No `vscode` import: node:test loads this module.
import { stopLanguageClient, type StoppableClient } from './clientStop';

export interface ManagedClient extends StoppableClient {
  start(): Promise<void>;
}

// Providers can finish after stop has begun. Use their normal empty result then, before the
// language client's failure handler can show a toast (H-18). Running-client errors still surface.
export function handleRequestFailure<T>(
  client: Pick<ManagedClient, 'isRunning'>,
  defaultValue: T,
  onRunningFailure: () => T,
): T {
  return client.isRunning() ? onRunningFailure() : defaultValue;
}

export interface LifecycleHooks<C extends ManagedClient> {
  create(): C;
  afterStart(client: C): Promise<void>;
  onStartError(err: unknown): void;
  onStopError(err: unknown): void;
}

export class ClientLifecycle<C extends ManagedClient> {
  client: C | undefined;
  private queue: Promise<void> = Promise.resolve();
  private deactivated = false;

  constructor(private readonly hooks: LifecycleHooks<C>) {}

  // Restarts are serialized so overlapping settings changes cannot start two servers.
  restart(): Promise<void> {
    this.queue = this.queue.then(() => this.replace(), () => this.replace());
    return this.queue;
  }

  // The stop is chained behind any restart in flight, and later restarts become no-ops, so no
  // server is started after deactivation.
  deactivate(): Promise<void> {
    this.deactivated = true;
    this.queue = this.queue.then(() => this.stop(), () => this.stop());
    return this.queue;
  }

  async stop(): Promise<void> {
    const previous = this.client;
    this.client = undefined;
    if (!previous) {
      return;
    }
    try {
      await stopLanguageClient(previous);
    } catch (err) {
      this.hooks.onStopError(err);
    }
  }

  private async replace(): Promise<void> {
    if (this.deactivated) {
      return;
    }
    await this.stop();
    const next = this.hooks.create();
    this.client = next;
    try {
      await next.start();
      await this.hooks.afterStart(next);
    } catch (err) {
      this.hooks.onStartError(err);
    }
  }
}
