import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stopLanguageClient, type StoppableClient } from '../clientStop';

function fakeClient(options: { running: boolean; stop?: () => Promise<void>; dispose?: () => unknown }) {
  const calls: string[] = [];
  const client: StoppableClient = {
    isRunning: () => options.running,
    stop: async () => {
      calls.push('stop');
      await options.stop?.();
    },
    dispose: () => {
      calls.push('dispose');
      return options.dispose?.();
    },
  };
  return { client, calls };
}

test('a running client is stopped and not disposed', async () => {
  const { client, calls } = fakeClient({ running: true });
  assert.equal(await stopLanguageClient(client), 'stopped');
  assert.deepEqual(calls, ['stop']);
});

test('a client that never started is not stopped, only disposed', async () => {
  const { client, calls } = fakeClient({ running: false });
  assert.equal(await stopLanguageClient(client), 'dropped');
  assert.deepEqual(calls, ['dispose']);
});

test('a rejecting dispose on a client that is not running is ignored', async () => {
  const { client, calls } = fakeClient({
    running: false,
    dispose: () => Promise.reject(new Error("Client is not running and can't be stopped.")),
  });
  assert.equal(await stopLanguageClient(client), 'dropped');
  assert.deepEqual(calls, ['dispose']);
});

test('a dispose that throws synchronously on a client that is not running is ignored', async () => {
  const { client } = fakeClient({
    running: false,
    dispose: () => {
      throw new Error('boom');
    },
  });
  assert.equal(await stopLanguageClient(client), 'dropped');
});

test('a stop failure on a running client is rethrown and dispose is not attempted', async () => {
  const { client, calls } = fakeClient({
    running: true,
    stop: () => Promise.reject(new Error('shutdown timed out')),
  });
  await assert.rejects(stopLanguageClient(client), /shutdown timed out/);
  assert.deepEqual(calls, ['stop']);
});
