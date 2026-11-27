import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

test('the installed review hook cannot reopen a PR and refuses closed checkout or publication', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pullfrog-hook-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'review-output'));
  for (const name of ['index.js', 'package.json'])
    await copyFile(
      new URL('./review-output/' + name, import.meta.url),
      join(root, 'review-output', name)
    );
  for (const name of ['gate.mjs', 'review-output.mjs'])
    await copyFile(
      new URL('../pullfrog-review-gate/' + name, import.meta.url),
      join(root, name)
    );
  const { default: plugin } = await import(
    pathToFileURL(join(root, 'review-output/index.js'))
  );
  const hooks = {};
  await plugin.setup({
    tool: {
      hook: async (name, hook) => {
        hooks[name] = hook;
      },
    },
  });
  const oldFetch = globalThis.fetch;
  const env = { ...process.env };
  t.after(() => {
    globalThis.fetch = oldFetch;
    process.env = env;
  });
  process.env.PULLFROG_CONTEXT_URL = 'http://127.0.0.1/fixture';
  const snapshot = {
    number: 7,
    head: 'a'.repeat(40),
    base: 'b'.repeat(40),
    mergeBase: 'c'.repeat(40),
    baseRef: 'main',
    runId: 313,
  };
  process.env.PULLFROG_SNAPSHOT = JSON.stringify(snapshot);
  process.env.GITHUB_REPOSITORY = 'shift/example';
  let status = 204;
  let reads = 0;
  globalThis.fetch = async () => {
    reads++;
    return { status };
  };
  for (const tool of [
    'pullfrog_reopen_current',
    'mcp/pullfrog/reopen_current',
  ]) {
    await assert.rejects(
      hooks['execute.before']({ tool, input: {} }),
      /must never reopen/
    );
  }
  assert.equal(reads, 0);
  await hooks['execute.before']({
    tool: 'pullfrog_checkout_pr',
    input: { pull_number: 7 },
  });
  const review = {
    tool: 'pullfrog_create_pull_request_review',
    input: { pull_number: 7, commit_id: snapshot.head, approved: true },
  };
  await hooks['execute.before'](review);
  assert.equal(review.input.approved, true);
  status = 412;
  await hooks['execute.before'](review);
  assert.equal(review.input.approved, false);
  await assert.rejects(
    hooks['execute.before']({ tool: 'pullfrog_checkout_pr', input: {} }),
    /no longer eligible/
  );
  status = 410;
  for (const tool of [
    'pullfrog_checkout_pr',
    'pullfrog_create_pull_request_review',
  ]) {
    await assert.rejects(
      hooks['execute.before']({ tool, input: {} }),
      /PR closed/
    );
  }
});
