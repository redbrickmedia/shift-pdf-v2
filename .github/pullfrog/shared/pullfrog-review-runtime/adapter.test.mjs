import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadAdapter, planAdapter } from './adapter.mjs';

test('only a module inside the trusted checkout can provide a repository plan', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pullfrog-adapter-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.github/pullfrog'), { recursive: true });
  await writeFile(
    join(root, '.github/pullfrog/checkout.mjs'),
    'export const plan = async () => undefined;'
  );
  const adapter = await loadAdapter(root, '.github/pullfrog/checkout.mjs');
  assert.equal(await planAdapter(adapter, {}, 'trusted'), undefined);
  for (const path of [
    '../checkout.mjs',
    '/checkout.mjs',
    '.github/../checkout.mjs',
    'file://checkout.mjs',
  ]) {
    await assert.rejects(loadAdapter(root, path), /Invalid trusted/);
  }
});

test('trusted-config mismatch skips and genuine planner failures remain failures', async () => {
  const snapshot = { number: 7 };
  const skipped = await planAdapter(
    { plan: async () => undefined },
    snapshot,
    'base'
  );
  assert.equal(skipped, undefined);
  await assert.rejects(
    planAdapter(
      {
        plan: async () => {
          throw new Error('Git fetch failed');
        },
      },
      snapshot,
      'base'
    ),
    /Git fetch failed/
  );
  await assert.rejects(
    planAdapter({ plan: async () => ({ sparse: '' }) }, snapshot, 'base'),
    /Invalid repository/
  );
});

test('a repository plan supplies sparse patterns and its trusted specialist policy', async () => {
  const policy = {
    guidance: ['Browser instructions'],
    reviewers: [{ name: 'web-ui-code-reviewer' }],
  };
  const plan = { sparse: '/web-ui/\n/.agents/', policy };
  const adapter = {
    async plan(snapshot, trusted) {
      assert.equal(snapshot.number, 7);
      assert.equal(trusted, 'base');
      return plan;
    },
  };
  assert.equal(await planAdapter(adapter, { number: 7 }, 'base'), plan);
});

test('general requests get bounded adapter paths without querying a PR', async () => {
  const adapter = {
    plan() {
      assert.fail('General requests must not plan a PR');
    },
    async planGeneral(trusted) {
      assert.equal(trusted, 'trusted');
      return { sparse: '/AGENTS.md\n/.github/pullfrog/' };
    },
  };
  assert.equal(
    (await planAdapter(adapter, undefined, 'trusted')).sparse,
    '/AGENTS.md\n/.github/pullfrog/'
  );
  await assert.rejects(
    planAdapter(
      { planGeneral: async () => ({ sparse: '' }) },
      undefined,
      'trusted'
    ),
    /Invalid repository/
  );
});
