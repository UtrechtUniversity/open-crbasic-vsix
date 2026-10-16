import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClientLifecycle, handleRequestFailure, type ManagedClient } from '../clientLifecycle';

class FakeClient implements ManagedClient {
  state: 'created' | 'starting' | 'running' | 'stopping' | 'stopped' = 'created';
  constructor(readonly log: string[], readonly id: number, private readonly gate?: Promise<void>) {}
  async start(): Promise<void> {
    this.state = 'starting';
    this.log.push(`start ${this.id}`);
    await this.gate;
    this.state = 'running';
  }
  isRunning(): boolean {
    return this.state === 'running';
  }
  async stop(): Promise<void> {
    this.state = 'stopped';
    this.log.push(`stop ${this.id}`);
  }
  dispose(): unknown {
    this.log.push(`dispose ${this.id}`);
    return undefined;
  }
}

function lifecycle(log: string[], gates: Promise<void>[] = []) {
  let n = 0;
  const created: FakeClient[] = [];
  const subject = new ClientLifecycle<FakeClient>({
    create: () => {
      const c = new FakeClient(log, ++n, gates[n - 1]);
      created.push(c);
      return c;
    },
    afterStart: async () => {},
    onStartError: (err) => log.push(`start error ${String(err)}`),
    onStopError: (err) => log.push(`stop error ${String(err)}`),
  });
  return { subject, created };
}

test('a restart stops the previous client before starting the next', async () => {
  const log: string[] = [];
  const { subject } = lifecycle(log);
  await subject.restart();
  await subject.restart();
  assert.deepEqual(log, ['start 1', 'stop 1', 'start 2']);
});

test('deactivate waits for a client that is still starting, then stops it', async () => {
  const log: string[] = [];
  let open!: () => void;
  const { subject, created } = lifecycle(log, [new Promise<void>((r) => (open = r))]);
  const starting = subject.restart();
  await new Promise((r) => setImmediate(r));
  const stopping = subject.deactivate();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(log, ['start 1']);
  assert.equal(created[0].state, 'starting');
  open();
  await Promise.all([starting, stopping]);
  assert.deepEqual(log, ['start 1', 'stop 1']);
  assert.equal(created[0].state, 'stopped');
  assert.equal(subject.client, undefined);
});

test('a restart queued before deactivate starts no server', async () => {
  const log: string[] = [];
  let open!: () => void;
  const { subject, created } = lifecycle(log, [new Promise<void>((r) => (open = r))]);
  const first = subject.restart();
  await new Promise((r) => setImmediate(r));
  const second = subject.restart();
  const stopping = subject.deactivate();
  open();
  await Promise.all([first, second, stopping]);
  assert.equal(created.length, 1);
  assert.deepEqual(log, ['start 1', 'stop 1']);
});

test('a restart after deactivate does nothing', async () => {
  const log: string[] = [];
  const { subject, created } = lifecycle(log);
  await subject.restart();
  await subject.deactivate();
  await subject.restart();
  assert.equal(created.length, 1);
  assert.deepEqual(log, ['start 1', 'stop 1']);
});

test('a restart still queued when deactivate is called starts no server', async () => {
  const log: string[] = [];
  const { subject, created } = lifecycle(log);
  const queued = subject.restart();
  await subject.deactivate();
  await queued;
  assert.equal(created.length, 0);
});

test('provider failures during start, stop and after stop return the default without reporting', () => {
  const client = new FakeClient([], 1);
  const report = () => { throw new Error('Starting server failed'); };
  for (const state of ['created', 'starting', 'stopping', 'stopped'] as const) {
    client.state = state;
    assert.equal(handleRequestFailure(client, null, report), null);
    assert.equal(handleRequestFailure(client, undefined, report), undefined);
  }
});

test('a provider request begun while running can fail after stop without reporting', async () => {
  const client = new FakeClient([], 1);
  await client.start();
  const request = Promise.reject(new Error('Starting server failed')).catch(() =>
    handleRequestFailure(client, null, () => { throw new Error('reported'); }),
  );
  await client.stop();
  assert.equal(await request, null);
});

test('provider failures while running still use the language client failure handler', async () => {
  const client = new FakeClient([], 1);
  await client.start();
  const error = new Error('server error');
  assert.throws(() => handleRequestFailure(client, null, () => { throw error; }), error);
  assert.equal(handleRequestFailure(client, null, () => 'handled'), 'handled');
});
