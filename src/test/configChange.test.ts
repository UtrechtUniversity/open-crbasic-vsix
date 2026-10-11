import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canNotify, planConfigurationChange } from '../configChange';

const none = { restartKeys: false, section: false, trace: false };

test('a restart key replaces the server and sends no notification to the client being replaced', () => {
  const plan = planConfigurationChange({ ...none, restartKeys: true, section: true });
  assert.deepEqual(plan, { restart: true, applyTrace: false, notify: false });
});

test('a restart key with a trace change still plans only the restart (the new client applies trace)', () => {
  const plan = planConfigurationChange({ restartKeys: true, section: true, trace: true });
  assert.deepEqual(plan, { restart: true, applyTrace: false, notify: false });
});

test('a settings change without a restart key notifies the client and does not restart', () => {
  const plan = planConfigurationChange({ ...none, section: true });
  assert.deepEqual(plan, { restart: false, applyTrace: false, notify: true });
});

test('a trace change applies trace and also notifies, as the section changed', () => {
  const plan = planConfigurationChange({ ...none, section: true, trace: true });
  assert.deepEqual(plan, { restart: false, applyTrace: true, notify: true });
});

test('an unrelated change plans nothing', () => {
  assert.deepEqual(planConfigurationChange(none), { restart: false, applyTrace: false, notify: false });
});

test('only a running client is notified', () => {
  assert.equal(canNotify({ isRunning: () => true }), true);
  assert.equal(canNotify({ isRunning: () => false }), false);
  assert.equal(canNotify(undefined), false);
});
