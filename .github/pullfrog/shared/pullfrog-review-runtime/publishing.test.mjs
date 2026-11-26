import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  authenticatedGitEnv,
  addNativeReviewInstructions,
  selectReviewers,
  writeReviewConfig,
} from './publish-config.mjs';

test('specialist selection uses directory boundaries and rejects unsafe source paths', () => {
  const frontend = { name: 'ui', file: '.agents/ui.md', paths: ['src/ui'] };
  const backend = {
    name: 'service',
    file: '.agents/api.md',
    paths: ['src/api'],
  };
  assert.deepEqual(
    selectReviewers(
      [frontend, backend],
      ['src/ui/component.ts', 'src/apis/other.ts']
    ),
    [frontend]
  );
  assert.deepEqual(selectReviewers([frontend, backend], ['README.md']), []);
  assert.throws(
    () =>
      selectReviewers(
        [{ ...frontend, file: '../unsafe.md' }],
        ['src/ui/component.ts']
      ),
    /Invalid/
  );
});

test('generated review configuration is exclusive and leaves an existing config intact', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pullfrog-review-config-'));
  const path = join(dir, 'opencode.json');
  t.after(async () => {
    await rm(path, { force: true });
    await rmdir(dir);
  });
  const config = { plugins: ['.git/shift-pullfrog-runtime/review-output'] };
  await writeReviewConfig(path, config);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), config);
  await assert.rejects(
    () => writeReviewConfig(path, {}),
    /existing file was preserved/
  );
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), config);
});

test('automatic and manual reviews receive trusted guidance without changing the native request', () => {
  const payload = {
    '~pullfrog': true,
    event: { trigger: 'pull_request_synchronize', before_sha: 'a'.repeat(40) },
    progressComment: { id: 42 },
    checkRun: { id: 43 },
    baseInstructions: 'Organization guidance.',
    eventInstructions: 'Incrementally re-review this PR.',
  };
  const instruction = 'Review commit abc using the repository specialist.';
  for (const prompt of ['', '@pullfrog review these changes']) {
    const request = { ...payload, prompt };
    assert.deepEqual(addNativeReviewInstructions(request, instruction), {
      ...request,
      baseInstructions: 'Organization guidance.\n\n' + instruction,
    });
  }
});

test('trusted Git reads retain scoped authentication for lazy comparison-blob fetches', () => {
  const env = { GH_TOKEN: 'fixture-token', PATH: 'fixture-path' };
  const scoped = authenticatedGitEnv(env);
  assert.equal(scoped.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
  assert.equal(
    Buffer.from(
      scoped.GIT_CONFIG_VALUE_0.slice('AUTHORIZATION: basic '.length),
      'base64'
    ).toString(),
    'x-access-token:fixture-token'
  );
  assert.equal(scoped.PATH, env.PATH);
  assert.equal(env.GIT_CONFIG_VALUE_0, undefined);
  const noToken = { PATH: 'fixture-path' };
  assert.equal(authenticatedGitEnv(noToken), noToken);
});
