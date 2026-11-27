import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewLifecycle, watchReviewLifecycle } from './lifecycle.mjs';

const snapshot = {
  number: 7,
  head: 'a'.repeat(40),
  base: 'b'.repeat(40),
  mergeBase: 'c'.repeat(40),
  baseRef: 'main',
  runId: 313,
};
const context = { repositoryId: 42, runId: 313 };
const open = {
  number: 7,
  state: 'open',
  draft: false,
  head: { sha: snapshot.head, repo: { id: 42 } },
  base: { sha: snapshot.base, ref: 'main', repo: { id: 42 } },
};

test('closure or merge cancels only this run, once, and stays closed after reopening', async () => {
  for (const merged of [false, true]) {
    let pr = open;
    const writes = [];
    const lifecycle = reviewLifecycle(
      snapshot,
      context,
      { get: async () => pr },
      { request: async (...args) => writes.push(args) }
    );
    assert.deepEqual(await lifecycle.refresh(), { state: 'current' });
    assert.equal(writes.length, 0);
    pr = { ...open, state: 'closed', merged };
    assert.deepEqual(await lifecycle.refresh(), { state: 'closed' });
    assert.deepEqual(writes, [
      ['/actions/runs/313/cancel', { method: 'POST', empty: true }],
    ]);
    pr = open;
    assert.deepEqual(await lifecycle.refresh(), { state: 'closed' });
    assert.equal(writes.length, 1);
  }
});

test('failed cancellation remains closed and retries without letting a reopen restore eligibility', async () => {
  let pr = { ...open, state: 'closed' };
  let calls = 0;
  let failures = 0;
  const lifecycle = reviewLifecycle(
    snapshot,
    context,
    { get: async () => pr },
    {
      request: async () => {
        if (++calls === 1) throw Error('transport failure');
      },
    },
    () => failures++
  );
  assert.deepEqual(await lifecycle.refresh(), { state: 'closed' });
  pr = open;
  assert.deepEqual(await lifecycle.refresh(), { state: 'closed' });
  assert.deepEqual(await lifecycle.refresh(), { state: 'closed' });
  assert.equal(calls, 2);
  assert.equal(failures, 1);
});

test('polling and a simultaneous publish check share one cancellation request', async () => {
  let resolveCancel;
  const cancelled = new Promise((resolve) => {
    resolveCancel = resolve;
  });
  let calls = 0;
  const lifecycle = reviewLifecycle(
    snapshot,
    context,
    { get: async () => ({ ...open, state: 'closed' }) },
    {
      request: async () => {
        calls++;
        await cancelled;
      },
    }
  );
  const poll = lifecycle.refresh();
  const publish = lifecycle.refresh();
  assert.equal(poll, publish);
  resolveCancel();
  assert.deepEqual(await poll, { state: 'closed' });
  assert.equal(calls, 1);
});

test('a push, transient read failure, fork, or invalid snapshot does not request cancellation', async () => {
  const cancellation = {
    request: () => assert.fail('Must not cancel unrelated or unverified state'),
  };
  const pushed = { ...open, head: { ...open.head, sha: snapshot.mergeBase } };
  assert.equal(
    (
      await reviewLifecycle(
        snapshot,
        context,
        { get: async () => pushed },
        cancellation
      ).refresh()
    ).state,
    'superseded'
  );
  const fork = {
    ...open,
    state: 'closed',
    head: { ...open.head, repo: { id: 43 } },
  };
  assert.equal(
    (
      await reviewLifecycle(
        snapshot,
        context,
        { get: async () => fork },
        cancellation
      ).refresh()
    ).state,
    'ineligible'
  );
  await assert.rejects(
    reviewLifecycle(
      snapshot,
      context,
      {
        get: async () => {
          throw Error('temporary failure');
        },
      },
      cancellation
    ).refresh(),
    /temporary failure/
  );
  await assert.rejects(
    reviewLifecycle(
      snapshot,
      { ...context, runId: 314 },
      { get: async () => open },
      cancellation
    ).refresh(),
    /Invalid Pullfrog/
  );
});

test('the watcher cancels mid-flight without a tool call and releases its timer on shutdown', async () => {
  let pr = open;
  const writes = [];
  let tick;
  let cleared;
  const timer = { unref() {} };
  const lifecycle = reviewLifecycle(
    snapshot,
    context,
    { get: async () => pr },
    { request: async (...args) => writes.push(args) }
  );
  const stop = watchReviewLifecycle(lifecycle, {
    setInterval(callback, interval) {
      tick = callback;
      assert.equal(interval, 15_000);
      return timer;
    },
    clearInterval(value) {
      cleared = value;
    },
  });
  await tick();
  assert.equal(writes.length, 0);
  pr = { ...open, state: 'closed' };
  await tick();
  assert.deepEqual(writes, [
    ['/actions/runs/313/cancel', { method: 'POST', empty: true }],
  ]);
  stop();
  assert.equal(cleared, timer);
});
